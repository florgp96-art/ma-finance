import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CambioMoneda from './CambioMoneda'

// Lo que devuelve la base: si la columna `sentido` existe y lo que se insertó.
const mockBase = { hayColumna: true, inserts: [] }

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      insert: async (filas) => { mockBase.inserts.push(filas); return { error: null } },
    }),
  },
}))
jest.mock('../lib/columnaSentido', () => ({
  hayColumnaSentido: async () => mockBase.hayColumna,
}))

const styles = { field: {}, label: {}, input: {}, modalButtons: {}, cancelBtn: {}, saveBtn: {} }
const sem = { negativo: 'red' }
const cuentas = [
  { id: 'visa', nombre: 'Visa Galicia', tipo: 'credito' },
  { id: 'pesos', nombre: 'Caja de ahorro Galicia', tipo: 'debito' },
  { id: 'usd', nombre: 'Caja de ahorro USD', tipo: 'debito' },
]

const montar = (props = {}) => {
  const onGuardado = jest.fn()
  render(<CambioMoneda accounts={cuentas} styles={styles} darkMode={false} sem={sem} tipoCambio="1400"
    onCancelar={() => {}} onGuardado={onGuardado} {...props} />)
  return { onGuardado }
}

const completarMontos = (sale, entra) => {
  const [montoSale, montoEntra] = screen.getAllByRole('spinbutton')
  fireEvent.change(montoSale, { target: { value: sale } })
  fireEvent.change(montoEntra, { target: { value: entra } })
}

beforeEach(() => {
  mockBase.hayColumna = true
  mockBase.inserts.length = 0
})

test('arranca vendiendo dólares de la caja en dólares hacia la de pesos, sin ofrecer la tarjeta', () => {
  montar()
  const [cuentaSale, monedaSale, cuentaEntra, monedaEntra] = screen.getAllByRole('combobox')
  expect(cuentaSale).toHaveValue('usd')
  expect(monedaSale).toHaveValue('USD')
  expect(cuentaEntra).toHaveValue('pesos')
  expect(monedaEntra).toHaveValue('ARS')
  expect(screen.queryByRole('option', { name: 'Visa Galicia' })).toBeNull()
})

test('muestra el tipo de cambio y guarda las dos patas con su sentido', async () => {
  const { onGuardado } = montar()
  completarMontos('181', '262450')
  expect(screen.getByText(/Tipo de cambio/)).toHaveTextContent('U$S 1 = $ 1.450')

  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }))
  await waitFor(() => expect(onGuardado).toHaveBeenCalled())
  expect(mockBase.inserts).toHaveLength(1)
  const [sale, entra] = mockBase.inserts[0]
  expect(sale).toMatchObject({ account_id: 'usd', moneda: 'USD', monto: 181, tipo: 'neutro', sentido: 'sale' })
  expect(entra).toMatchObject({ account_id: 'pesos', moneda: 'ARS', monto: 262450, tipo: 'neutro', sentido: 'entra' })
})

test('sin la columna en la base guarda igual, sin mandarla', async () => {
  mockBase.hayColumna = false
  const { onGuardado } = montar()
  completarMontos('100', '145000')
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambio' }))
  await waitFor(() => expect(onGuardado).toHaveBeenCalled())
  mockBase.inserts[0].forEach(fila => expect(fila).not.toHaveProperty('sentido'))
})

// Pasar plata de una cuenta a otra en la misma moneda (del efectivo a la caja).
test('con la misma moneda es una transferencia: un solo monto y las dos patas', async () => {
  const { onGuardado } = montar()
  const [cuentaSale, monedaSale] = screen.getAllByRole('combobox')
  fireEvent.change(cuentaSale, { target: { value: 'usd' } })
  fireEvent.change(monedaSale, { target: { value: 'ARS' } })
  // El lado que entra no pide monto: es el mismo que sale.
  expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '478000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar transferencia' }))
  await waitFor(() => expect(onGuardado).toHaveBeenCalledWith({ esTransferencia: true }))
  const [sale, entra] = mockBase.inserts[0]
  expect(sale).toMatchObject({ account_id: 'usd', moneda: 'ARS', monto: 478000, sentido: 'sale', nombre: 'Transferencia a Caja de ahorro Galicia' })
  expect(entra).toMatchObject({ account_id: 'pesos', moneda: 'ARS', monto: 478000, sentido: 'entra', nombre: 'Transferencia desde Caja de ahorro USD' })
})

test('la misma cuenta y la misma moneda de los dos lados avisa y no guarda', async () => {
  const { onGuardado } = montar()
  const [, , cuentaEntra, monedaEntra] = screen.getAllByRole('combobox')
  fireEvent.change(cuentaEntra, { target: { value: 'usd' } })
  fireEvent.change(monedaEntra, { target: { value: 'USD' } })
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar transferencia' }))
  expect(await screen.findByText(/elegí dos cuentas distintas/)).toBeInTheDocument()
  expect(mockBase.inserts).toHaveLength(0)
  expect(onGuardado).not.toHaveBeenCalled()
})

test('sin cuentas con saldo explica qué falta', () => {
  montar({ accounts: [cuentas[0]] })
  expect(screen.getByText(/hace falta al menos una cuenta que no sea tarjeta/)).toBeInTheDocument()
})
