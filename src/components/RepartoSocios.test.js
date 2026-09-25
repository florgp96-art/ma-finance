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

test('usa las cotizaciones guardadas del mes y dice quién le da a quién', async () => {
  const hoy = new Date()
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  montar({ socios: ['Flor', 'Valen', 'Dol'], meses: { [mes]: { usd: 1560 } } })
  // Neto: 900.000 − 156.000 − 30.000 = 714.000 → 238.000 cada uno. Dol tiene los
  // 900.000; Valen puso 156.000 y Flor 30.000 de su bolsillo.
  expect(await screen.findByText('$ 238.000')).toBeInTheDocument()
  expect(screen.getAllByText(/le da a/).map(el => el.textContent)).toEqual([
    'Dol le da a Valen $ 394.000',
    'Dol le da a Flor $ 268.000',
  ])
  expect(mockBase.consultas).toContainEqual(['eq', 'user_id', 'u1'])
})

test('"Ya lo hice" guarda la transferencia junto con las cotizaciones en uso', async () => {
  const { onCambiarConfig } = montar({ socios: ['Flor', 'Valen', 'Dol'], meses: {} })
  const [primero] = await screen.findAllByRole('button', { name: 'Ya lo hice' })
  fireEvent.click(primero)
  const guardado = onCambiarConfig.mock.calls[0][0]
  const [delMes] = Object.values(guardado.meses)
  expect(delMes).toMatchObject({ usd: 1500, eur: 1700 })
  expect(delMes.transferencias).toHaveLength(1)
  expect(delMes.transferencias[0]).toMatchObject({ de: 'Dol' })
})
