import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SaldoCuenta, { tieneSaldo } from './SaldoCuenta'

// Respuestas que devuelve la base en cada test. Se setean antes de renderizar.
const respuestas = { account_balances: { data: [], error: null }, transactions: { data: [], error: null } }
const inserts = []

jest.mock('../lib/supabase', () => {
  const thenable = (resultado) => {
    const obj = {}
    for (const m of ['select', 'eq', 'in', 'order']) obj[m] = () => obj
    obj.then = (res, rej) => Promise.resolve(resultado).then(res, rej)
    obj.insert = (fila) => { obj._insertada = fila; return obj }
    return obj
  }
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
      from: (tabla) => {
        // eslint-disable-next-line global-require
        const { respuestas: r, inserts: ins } = require('./SaldoCuenta.test.js')
        const base = thenable(r[tabla])
        base.insert = (fila) => { ins.push({ tabla, fila }); return thenable({ error: r[tabla].errorInsert || null }) }
        return base
      },
    },
  }
})
module.exports.respuestas = respuestas
module.exports.inserts = inserts

const styles = {
  summaryCard: {}, summaryLabel: {}, summaryValue: {}, summarySubval: {},
}
const CA = 'caja-ahorro'
const cuentaCA = { id: CA, nombre: 'Caja de ahorro', tipo: 'debito' }

const montar = (props = {}) => render(
  <SaldoCuenta account={cuentaCA} accounts={[cuentaCA]} transactions={[]}
    darkMode={false} styles={styles} {...props} />
)

beforeEach(() => {
  respuestas.account_balances = { data: [], error: null }
  respuestas.transactions = { data: [], error: null }
  inserts.length = 0
})

describe('qué cuentas llevan saldo', () => {
  test('una caja de ahorro y el efectivo sí', () => {
    expect(tieneSaldo({ tipo: 'debito' })).toBe(true)
    expect(tieneSaldo({ tipo: 'efectivo' })).toBe(true)
  })

  test('una tarjeta no: tiene deuda, y ese número sale del resumen del banco', () => {
    expect(tieneSaldo({ tipo: 'credito' })).toBe(false)
  })

  test('la cuenta "Ingresos" tampoco: es una vista, no un lugar donde viva plata', () => {
    expect(tieneSaldo({ tipo: 'ingreso' })).toBe(false)
  })

  // Se define por exclusión justamente para esto: una cuenta tipeada de una forma
  // que hoy no existe igual tiene saldo, en vez de no mostrar nada sin explicación.
  test('una cuenta con un tipo nuevo igual lleva saldo', () => {
    expect(tieneSaldo({ tipo: 'billetera' })).toBe(true)
    expect(tieneSaldo({})).toBe(false)
  })
})

describe('la card se renderiza', () => {
  test('sin la migración corrida avisa, no se rompe', async () => {
    respuestas.account_balances = { data: null, error: { message: 'relation "account_balances" does not exist' } }
    montar()
    expect(await screen.findByText(/Falta correr la migración/i)).toBeInTheDocument()
  })

  test('sin ancla invita a cargar el saldo', async () => {
    montar()
    expect(await screen.findByText(/Todavía no cargaste el saldo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar saldo' })).toBeInTheDocument()
  })

  test('con ancla muestra el saldo y de dónde sale', async () => {
    respuestas.account_balances = {
      data: [{ id: 'a1', account_id: CA, moneda: 'ARS', fecha: '2026-09-01', saldo: 500000 }],
      error: null,
    }
    montar({ transactions: [
      { id: 't1', account_id: CA, tipo: 'gasto', fecha: '2026-09-04', monto: 30000, moneda: 'ARS' },
      { id: 't2', account_id: CA, tipo: 'ingreso', fecha: '2026-09-03', monto: 120000, moneda: 'ARS' },
    ] })
    expect(await screen.findByText('$ 590.000')).toBeInTheDocument()
    expect(screen.getByText(/desde \$ 500.000 del 01\/09\/2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actualizar saldo' })).toBeInTheDocument()
  })

  test('el pago de la tarjeta se resta y se aclara aparte', async () => {
    const tarjeta = { id: 'mc', nombre: 'Mastercard', tipo: 'credito', cuenta_pago_id: CA }
    respuestas.account_balances = {
      data: [{ id: 'a1', account_id: CA, moneda: 'ARS', fecha: '2026-08-31', saldo: 3000000 }],
      error: null,
    }
    respuestas.transactions = {
      data: [{ id: 'p1', account_id: 'mc', tipo: 'neutro', fecha: '2026-09-01', monto: 500000, moneda: 'ARS', nombre: 'Pago Mastercard' }],
      error: null,
    }
    montar({ accounts: [cuentaCA, tarjeta] })
    expect(await screen.findByText('$ 2.500.000')).toBeInTheDocument()
    expect(screen.getByText(/incluye \$ 500.000 de tarjetas/)).toBeInTheDocument()
  })

  test('avisa cuando una tarjeta no tiene cuenta de pago configurada', async () => {
    const sinConfigurar = { id: 'visa', nombre: 'Visa Galicia', tipo: 'credito' }
    montar({ accounts: [cuentaCA, sinConfigurar] })
    expect(await screen.findByText(/No configuraste de qué cuenta se paga Visa Galicia/i)).toBeInTheDocument()
  })
})

describe('cargar un saldo', () => {
  const abrirFormulario = async () => {
    montar({ transactions: [{ id: 't1', account_id: CA, tipo: 'gasto', fecha: '2026-09-04', monto: 30000, moneda: 'ARS' }] })
    fireEvent.click(await screen.findByRole('button', { name: /Cargar saldo|Actualizar saldo/ }))
  }

  test('un valor no numérico no se guarda', async () => {
    await abrirFormulario()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Poné un número.')).toBeInTheDocument()
    expect(inserts).toHaveLength(0)
  })

  // El input es type="number": el valor llega como "1234.56". Antes se le quitaban
  // los puntos antes de parsear y ese saldo se guardaba como 123456.
  test('guarda los centavos tal cual, sin comerse el punto decimal', async () => {
    respuestas.account_balances = {
      data: [{ id: 'a1', account_id: CA, moneda: 'ARS', fecha: '2026-09-01', saldo: 500000 }],
      error: null,
    }
    await abrirFormulario()
    fireEvent.change(screen.getByPlaceholderText('saldo de hoy'), { target: { value: '1234.56' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(inserts).toHaveLength(1))
    expect(inserts[0].tabla).toBe('account_balances')
    expect(inserts[0].fila.saldo).toBe(1234.56)
  })

  test('guarda también lo que la app venía calculando, para poder ver el desvío', async () => {
    respuestas.account_balances = {
      data: [{ id: 'a1', account_id: CA, moneda: 'ARS', fecha: '2026-09-01', saldo: 500000 }],
      error: null,
    }
    await abrirFormulario()
    fireEvent.change(screen.getByPlaceholderText('saldo de hoy'), { target: { value: '400000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(inserts).toHaveLength(1))
    // 500.000 de ancla menos el gasto de 30.000 = 470.000 calculado.
    expect(inserts[0].fila.saldo_calculado).toBe(470000)
    expect(inserts[0].fila.moneda).toBe('ARS')
  })

  test('muestra el desvío antes de guardar', async () => {
    respuestas.account_balances = {
      data: [{ id: 'a1', account_id: CA, moneda: 'ARS', fecha: '2026-09-01', saldo: 500000 }],
      error: null,
    }
    await abrirFormulario()
    fireEvent.change(screen.getByPlaceholderText('saldo de hoy'), { target: { value: '450000' } })
    expect(await screen.findByText(/Hay \$ 20.000 menos de lo calculado/)).toBeInTheDocument()
  })

  test('una fecha futura no se guarda', async () => {
    await abrirFormulario()
    fireEvent.change(screen.getByPlaceholderText('saldo de hoy'), { target: { value: '100' } })
    fireEvent.change(screen.getByDisplayValue(new Date().toISOString().slice(0, 10)), { target: { value: '2099-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('La fecha no puede ser futura.')).toBeInTheDocument()
    expect(inserts).toHaveLength(0)
  })
})
