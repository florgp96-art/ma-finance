import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import RepartoSocios from './RepartoSocios'

const mockBase = { movimientos: [], consultas: [] }

jest.mock('../lib/supabase', () => {
  const consulta = () => {
    const q = {}
    for (const m of ['select', 'eq', 'gte', 'lt']) q[m] = (...args) => { mockBase.consultas.push([m, ...args]); return q }
    q.then = (res, rej) => Promise.resolve({ data: mockBase.movimientos, error: null }).then(res, rej)
    return q
  }
  return { supabase: { from: () => consulta() } }
})

const cuentas = [
  { id: 'efe', nombre: 'Dol Efectivo' },
  { id: 'rev', nombre: 'Valen Revolut' },
  { id: 'mc', nombre: 'Flor Mastercard' },
]
const styles = { input: {}, label: {}, modalButtons: {}, cancelBtn: {} }
const sem = { negativo: 'red', positivo: 'green' }

const montar = (config) => {
  const onCambiarConfig = jest.fn()
  render(<RepartoSocios config={config} onCambiarConfig={onCambiarConfig} accounts={cuentas} userId="u1"
    cotizacionesVivas={{ USD: 1500, EUR: 1700 }} refreshKey={0} styles={styles} darkMode={false} sem={sem}
    onCerrar={() => {}} />)
  return { onCambiarConfig }
}

beforeEach(() => {
  mockBase.consultas.length = 0
  mockBase.movimientos = [
    { account_id: 'efe', tipo: 'ingreso', moneda: 'ARS', monto: 900000 },
    { account_id: 'rev', tipo: 'gasto', moneda: 'USD', monto: 100 },
    { account_id: 'mc', tipo: 'gasto', moneda: 'ARS', monto: 30000 },
  ]
})

test('usa la cotización del primer pago del mes y dice quién le da a quién', async () => {
  const hoy = new Date()
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const pago = { de: 'Dol', a: 'Valen', monto: 100000, cotizacion: { usd: 1560, eur: 1700, fecha: `${mes}-10` } }
  montar({ socios: ['Flor', 'Valen', 'Dol'], meses: { [mes]: { transferencias: [pago] } } })
  // Neto con el dólar a 1.560: 900.000 − 156.000 − 30.000 = 714.000 → 238.000 cada
  // uno. Dol tiene 900.000 menos los 100.000 que ya le pasó a Valen; Valen puso
  // 156.000 de su bolsillo y Flor 30.000.
  expect(await screen.findByText('$ 238.000')).toBeInTheDocument()
  expect(screen.getAllByText(/le da a/).map(el => el.textContent.replace(/\u00A0/g, ' '))).toEqual([
    'Dol le da a Valen $ 294.000',
    'Dol le da a Flor $ 268.000',
  ])
  expect(screen.getByText(/quedó fijo con el primer pago/)).toBeInTheDocument()
  expect(mockBase.consultas).toContainEqual(['eq', 'user_id', 'u1'])
})

test('"Hecho" guarda el pago con la cotización del día adentro', async () => {
  const { onCambiarConfig } = montar({ socios: ['Flor', 'Valen', 'Dol'], meses: {} })
  const [primero] = await screen.findAllByRole('button', { name: 'Hecho' })
  fireEvent.click(primero)
  const [delMes] = Object.values(onCambiarConfig.mock.calls[0][0].meses)
  expect(delMes.transferencias).toHaveLength(1)
  expect(delMes.transferencias[0]).toMatchObject({ de: 'Dol', cotizacion: { usd: 1500, eur: 1700 } })
  expect(delMes.transferencias[0].cotizacion.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(delMes).not.toHaveProperty('cotizacionFija')
})

test('las flechas cambian de mes y se leen los movimientos de ese mes', async () => {
  montar({ socios: ['Flor', 'Valen', 'Dol'], meses: {} })
  await screen.findAllByRole('button', { name: 'Hecho' })
  fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }))
  const hoy = new Date()
  const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
  const desde = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}-01`
  await screen.findAllByRole('button', { name: 'Hecho' })
  expect(mockBase.consultas).toContainEqual(['gte', 'fecha', desde])
})

test('un gasto de este mes se pasa a cuotas y queda guardado con quién lo pagó', async () => {
  const hoy = new Date()
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  mockBase.movimientos = [
    { id: 'ing', account_id: 'efe', tipo: 'ingreso', moneda: 'ARS', monto: 900000, nombre: 'Cliente' },
    { id: 'cc', account_id: 'rev', tipo: 'gasto', moneda: 'EUR', monto: 300, nombre: 'CapCut (anual)' },
  ]
  const { onCambiarConfig } = montar({ socios: ['Flor', 'Valen', 'Dol'], meses: {}, cuotas: [] })
  fireEvent.change(await screen.findByRole('combobox', { name: 'Gasto' }), { target: { value: 'cc' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: /por mes/ }), { target: { value: '25' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Agregar' }).at(-1))
  expect(onCambiarConfig.mock.calls[0][0].cuotas).toEqual([{
    movimientoId: 'cc', concepto: 'CapCut (anual)', pagoDe: 'Valen', monto: 300, moneda: 'EUR', desde: mes, porMes: 25,
  }])
})

test('la cotización no se edita: es la del día (promedio compra/venta) y las claves viejas no cuentan', async () => {
  const hoy = new Date()
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  montar({ socios: ['Flor', 'Valen', 'Dol'], meses: { [mes]: { usd: 1560, eur: 1750, cotizacionFija: { usd: 1600, eur: 1800, fecha: `${mes}-01` } } } })
  await screen.findAllByRole('button', { name: 'Hecho' })
  expect(screen.getByText('Dólar blue').nextSibling).toHaveTextContent('$ 1.500')
  expect(screen.getByText('Euro').nextSibling).toHaveTextContent('$ 1.700')
  expect(screen.getByText(/Promedio entre compra y venta de hoy/)).toBeInTheDocument()
  // Los únicos campos numéricos son los de montos (transferencias), no cotizaciones.
  expect(screen.getAllByRole('spinbutton').map(el => el.getAttribute('aria-label'))).not.toContain('Dólar blue')
  // Neto con el dólar a 1.500: 900.000 − 150.000 − 30.000 = 720.000 → 240.000 cada uno.
  expect(screen.getByText('$ 240.000')).toBeInTheDocument()
})

test('con la cotización ya fija, un pago nuevo usa la misma', async () => {
  const hoy = new Date()
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const fija = { usd: 1560, eur: 1750, fecha: `${mes}-02` }
  const { onCambiarConfig } = montar({ socios: ['Flor', 'Valen', 'Dol'], meses: { [mes]: { transferencias: [{ de: 'Dol', a: 'Flor', monto: 1000, cotizacion: fija }] } } })
  const [primero] = await screen.findAllByRole('button', { name: 'Hecho' })
  fireEvent.click(primero)
  const { transferencias } = Object.values(onCambiarConfig.mock.calls[0][0].meses)[0]
  expect(transferencias.map(t => t.cotizacion)).toEqual([fija, fija])
})

test('borrar el pago que fijó la cotización (un "Hecho" sin querer) la devuelve a la del día', async () => {
  const hoy = new Date()
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const onCambiarConfig = jest.fn()
  const props = { onCambiarConfig, accounts: cuentas, userId: 'u1', cotizacionesVivas: { USD: 1500, EUR: 1700 },
    refreshKey: 0, styles, darkMode: false, sem, onCerrar: () => {} }
  const conPago = { socios: ['Flor', 'Valen', 'Dol'], meses: { [mes]: {
    transferencias: [{ de: 'Dol', a: 'Valen', monto: 1000, cotizacion: { usd: 1560, eur: 1750, fecha: `${mes}-02` } }] } } }
  const { rerender } = render(<RepartoSocios config={conPago} {...props} />)
  expect(await screen.findByText(/quedó fijo con el primer pago/)).toBeInTheDocument()
  expect(screen.getByText('Dólar blue').nextSibling).toHaveTextContent('$ 1.560')

  fireEvent.click(await screen.findByRole('button', { name: 'Quitar' }))
  const sinPago = onCambiarConfig.mock.calls[0][0]
  expect(Object.values(sinPago.meses)[0].transferencias).toEqual([])
  rerender(<RepartoSocios config={sinPago} {...props} />)
  expect(screen.getByText('Dólar blue').nextSibling).toHaveTextContent('$ 1.500')
  expect(screen.getByText(/Promedio entre compra y venta de hoy/)).toBeInTheDocument()
})
