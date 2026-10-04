import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
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

const texto = (el) => el.textContent.replace(/\u00A0/g, ' ')

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
  expect(texto((await screen.findByText('A cada uno (÷ 3)')).nextSibling)).toBe('$ 238.000')
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
  const selectGasto = await screen.findByRole('combobox', { name: 'Gasto' })
  fireEvent.change(selectGasto, { target: { value: 'cc' } })
  fireEvent.change(screen.getByRole('textbox', { name: /por mes/ }), { target: { value: '25' } })
  fireEvent.click(within(selectGasto.closest('form')).getByRole('button', { name: 'Agregar' }))
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
  const campos = [...screen.queryAllByRole('textbox'), ...screen.queryAllByRole('spinbutton')]
  expect(campos.map(el => el.getAttribute('aria-label'))).not.toContain('Dólar blue')
  // Neto con el dólar a 1.500: 900.000 − 150.000 − 30.000 = 720.000 → 240.000 cada uno.
  expect(texto(screen.getByText('A cada uno (÷ 3)').nextSibling)).toBe('$ 240.000')
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

test('un trabajo por fuera: quien lo hizo 60 % y los otros dos 20 % cada uno', async () => {
  mockBase.movimientos = [
    { id: 'ing', account_id: 'efe', tipo: 'ingreso', moneda: 'ARS', monto: 900000, nombre: 'Cliente' },
    { id: 'br', account_id: 'rev', tipo: 'ingreso', moneda: 'EUR', monto: 150, nombre: 'Classic Brunch Party' },
  ]
  const { onCambiarConfig } = montar({ socios: ['Flor', 'Valen', 'Dol'], meses: {}, cuotas: [], trabajos: [] })
  const select = await screen.findByRole('combobox', { name: 'Movimiento del trabajo' })
  fireEvent.change(select, { target: { value: 'br' } })
  expect(screen.getByText('Flor 20 % · Valen 60 % · Dol 20 %')).toBeInTheDocument()
  fireEvent.click(within(select.closest('form')).getByRole('button', { name: 'Agregar' }))
  expect(onCambiarConfig.mock.calls[0][0].trabajos).toEqual([{
    movimientoId: 'br', concepto: 'Classic Brunch Party', socio: 'Valen',
    porcentajes: { Flor: 20, Valen: 60, Dol: 20 },
  }])
})

test('se puede elegir de quién fue el laburo aunque la plata haya entrado en la cuenta de otro', async () => {
  mockBase.movimientos = [
    { id: 'ing', account_id: 'efe', tipo: 'ingreso', moneda: 'ARS', monto: 900000, nombre: 'Cliente' },
    { id: 'pag', account_id: 'efe', tipo: 'ingreso', moneda: 'ARS', monto: 150000, nombre: 'Página web' },
  ]
  const { onCambiarConfig } = montar({ socios: ['Flor', 'Valen', 'Dol'], meses: {}, cuotas: [], trabajos: [] })
  const select = await screen.findByRole('combobox', { name: 'Movimiento del trabajo' })
  fireEvent.change(select, { target: { value: 'pag' } })
  const quien = screen.getByRole('combobox', { name: 'De quién fue el laburo' })
  expect(quien).toHaveValue('Dol') // por defecto, el dueño de la cuenta
  fireEvent.change(quien, { target: { value: 'Flor' } })
  expect(screen.getByText('Flor 60 % · Valen 20 % · Dol 20 %')).toBeInTheDocument()
  fireEvent.click(within(select.closest('form')).getByRole('button', { name: 'Agregar' }))
  expect(onCambiarConfig.mock.calls[0][0].trabajos).toEqual([{
    movimientoId: 'pag', concepto: 'Página web', socio: 'Flor',
    porcentajes: { Flor: 60, Valen: 20, Dol: 20 },
  }])
})

test('muestra de dónde sale cada número y con cuánto se queda cada uno', async () => {
  mockBase.movimientos = [
    { id: 'nas', account_id: 'efe', tipo: 'ingreso', moneda: 'ARS', monto: 900000, nombre: 'Nasello Cables' },
    { id: 'hig', account_id: 'rev', tipo: 'gasto', moneda: 'USD', monto: 100, nombre: 'Higgsfield' },
    { id: 'pag', account_id: 'mc', tipo: 'ingreso', moneda: 'ARS', monto: 150000, nombre: 'Página web (Flor)' },
  ]
  montar({ socios: ['Flor', 'Valen', 'Dol'], meses: {}, cuotas: [], trabajos: [
    { movimientoId: 'pag', concepto: 'Página web (Flor)', socio: 'Flor', porcentajes: { Flor: 60, Valen: 20, Dol: 20 } },
  ] })
  // En partes iguales: 900.000 − (100 × 1.500) = 750.000 → 250.000 cada uno. La página va aparte:
  // es laburo de Flor (60 % de 150.000 = 90.000) y los otros dos se llevan 20 % cada uno (30.000).
  expect(await screen.findByText('Nasello Cables · Dol')).toBeInTheDocument()
  expect(texto(screen.getByText('Higgsfield · Valen').nextSibling)).toBe('U$S 100 → $ 150.000')
  expect(texto(screen.getByText('Total en partes iguales').nextSibling)).toBe('$ 750.000')
  expect(texto(screen.getByText('A cada uno (÷ 3)').nextSibling)).toBe('$ 250.000')
  const laburo = within(screen.getByText('Laburo de cada uno').parentElement)
  expect(texto(laburo.getByText('Laburo de Flor').nextSibling)).toBe('$ 90.000')
  expect(laburo.getByText('Laburo de Valen')).toBeInTheDocument()
  expect(laburo.getByText('60 % de $ 150.000')).toBeInTheDocument()
  const deLosDemas = laburo.getAllByRole('button', { name: /Su parte de lo que laburaron los demás \(1\)/ })
  expect(deLosDemas.map(b => texto(b.lastChild))).toEqual(['+ $ 30.000', '+ $ 30.000'])
  fireEvent.click(deLosDemas[0])
  expect(screen.getAllByText('20 % de $ 150.000')).toHaveLength(1)
  // Lo que entró y salió de las cuentas de cada uno.
  expect(texto(screen.getByText('Cuentas de Flor').nextSibling)).toBe('tiene $ 150.000')
  expect(texto(screen.getByText('Cuentas de Valen').nextSibling)).toBe('tiene − $ 150.000')
  const quedan = screen.getAllByText(/^se queda con/).map(texto)
  expect(quedan).toEqual(['se queda con $ 340.000', 'se queda con $ 280.000', 'se queda con $ 280.000'])
  fireEvent.click(screen.getByRole('button', { name: /Ingresos \(1\)/ }))
  expect(screen.queryByText('Nasello Cables · Dol')).not.toBeInTheDocument()
})
