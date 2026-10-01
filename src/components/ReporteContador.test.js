import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ReporteContador from './ReporteContador'
import { compartirODescargar } from '../lib/reporteContador'

jest.mock('../lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { email: 'ana@x.com' } } }) } },
}))
jest.mock('../lib/reporteContador', () => ({
  ...jest.requireActual('../lib/reporteContador'),
  compartirODescargar: jest.fn(),
}))

const aPesos = (t) => (t.moneda === 'ARS' ? t.monto : null)
const ingresos = [
  { fecha: '2026-09-30', nombre: 'Cliente A', monto: 600000, moneda: 'ARS', facturacion: 'facturado' },
  { fecha: '2026-09-15', nombre: 'Cliente B', monto: 350000, moneda: 'ARS', facturacion: 'sin_facturar' },
  { fecha: '2026-09-10', nombre: 'Cliente C', monto: 100000, moneda: 'ARS' },
]
const texto = (el) => el.textContent.replace(/ /g, ' ')

test('muestra cuánto se facturó y avisa de lo que falta indicar', () => {
  render(<ReporteContador ingresos={ingresos} aPesos={aPesos} periodo="Septiembre 2026" darkMode={false} onCerrar={() => {}} />)
  expect(screen.getByText('Septiembre 2026 · 3 ingresos')).toBeInTheDocument()
  expect(texto(screen.getByText('Facturado').nextSibling)).toBe('$ 600.000')
  expect(texto(screen.getByText('Sin facturar').nextSibling)).toBe('$ 350.000')
  expect(texto(screen.getByText('Total').nextSibling)).toBe('$ 1.050.000')
  expect(screen.getByText(/Hay 1 ingreso sin indicar si se facturó/)).toBeInTheDocument()
})

test('"Compartir Excel" arma el archivo con el mail del titular; si se descargó, lo dice', async () => {
  compartirODescargar.mockResolvedValue('descargado')
  render(<ReporteContador ingresos={ingresos} aPesos={aPesos} periodo="Septiembre 2026" darkMode={false} onCerrar={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Compartir Excel' }))
  expect(await screen.findByText(/Se descargó ingresos-septiembre-2026.xlsx/)).toBeInTheDocument()
  const [libro, nombre] = compartirODescargar.mock.calls[0]
  expect(nombre).toBe('ingresos-septiembre-2026.xlsx')
  expect(libro.SheetNames).toEqual(['Resumen', 'Ingresos'])
})

test('si se compartió, se cierra solo', async () => {
  compartirODescargar.mockResolvedValue('compartido')
  const onCerrar = jest.fn()
  render(<ReporteContador ingresos={ingresos} aPesos={aPesos} periodo="Septiembre 2026" darkMode={false} onCerrar={onCerrar} />)
  fireEvent.click(screen.getByRole('button', { name: 'Compartir Excel' }))
  await waitFor(() => expect(onCerrar).toHaveBeenCalled())
})
