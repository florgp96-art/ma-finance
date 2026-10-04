import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import IngresosFuturos from './IngresosFuturos'
import * as datos from '../lib/liquidacionDatos'

const mockDb = { esperados: [], ingresos: [], id: 0 }

// CRA reinicia los mocks antes de cada test (resetMocks): las implementaciones van en beforeEach.
jest.mock('../lib/liquidacionDatos', () => ({
  nuevoId: () => `nuevo-${++mockDb.id}`,
  leerIngresosFuturos: jest.fn(),
  leerIngresosDeCuentas: jest.fn(),
  crearIngresoFuturo: jest.fn(),
  actualizarIngresoFuturo: jest.fn(),
  borrarIngresoFuturo: jest.fn(),
}))

const ok = (data = null) => Promise.resolve({ data, error: null })
const estilos = {
  c: { border: '#ccc', text: '#000', textSecondary: '#555', textTertiary: '#888', primary: '#5C4F5C' },
  sem: { negativo: 'red' }, input: {}, caja: {}, rotulo: {}, botonChico: {},
}
const esperado = (id, concepto, monto, fecha, extra = {}) =>
  ({ id, liquidacion_id: 'liq-1', concepto, monto, moneda: 'ARS', fecha, cobrado_a_mano: false, ...extra })

beforeEach(() => {
  mockDb.id = 0
  mockDb.esperados = [
    esperado('e1', 'Nasello Cables', 600000, '2026-10-05'),
    esperado('e2', 'Maia', 250000, '2026-10-01'),
    esperado('e3', 'Otra liquidación', 999, '2026-10-01', { liquidacion_id: 'liq-2' }),
  ]
  mockDb.ingresos = [
    { id: 't1', tipo: 'ingreso', nombre: 'Maia', monto: 250000, moneda: 'ARS', fecha: '2026-10-03', accounts: { nombre: 'Caja de Ahorro Galicia' } },
  ]
  datos.leerIngresosFuturos.mockImplementation(() => ok(mockDb.esperados.map(e => ({ ...e }))))
  datos.leerIngresosDeCuentas.mockImplementation(() => ok(mockDb.ingresos))
  datos.crearIngresoFuturo.mockImplementation((fila) => { mockDb.esperados.push({ ...fila, cobrado_a_mano: false }); return ok(fila) })
  datos.actualizarIngresoFuturo.mockImplementation(() => ok())
  datos.borrarIngresoFuturo.mockImplementation(() => ok())
})

const montar = () => render(<IngresosFuturos userId="u1" liquidacionId="liq-1" estilos={estilos} />)
const texto = (el) => el.textContent.replace(/ /g, ' ')

test('lo que entró en una cuenta se tacha solo, y dice cuándo y dónde', async () => {
  montar()
  await screen.findByText(/Nasello Cables/)
  expect(datos.leerIngresosDeCuentas).toHaveBeenCalledWith('u1', '2026-09-16')
  // Pendiente: solo Nasello. Lo de la otra liquidación no se muestra.
  expect(texto(screen.getByText('Falta entrar').nextSibling)).toBe('$ 600.000,00')
  expect(texto(screen.getByText('Ya entró').nextSibling)).toBe('$ 250.000,00')
  expect(screen.queryByText(/Otra liquidación/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Ya entraron \(1\)/ }))
  const maia = screen.getByTestId('futuro-e2')
  expect(within(maia).getByText(/Entró el 03\/10 en Caja de Ahorro Galicia/)).toBeInTheDocument()
})

test('se anota con la coma del celular y no toca las cuentas', async () => {
  montar()
  await screen.findByText(/Nasello Cables/)
  fireEvent.change(screen.getByLabelText('Qué es'), { target: { value: '  Cue   Rental ' } })
  fireEvent.change(screen.getByLabelText('Monto esperado'), { target: { value: '200.000,50' } })
  fireEvent.change(screen.getByLabelText('Fecha esperada'), { target: { value: '2026-10-10' } })
  fireEvent.click(screen.getByRole('button', { name: '+ Anotar' }))
  await waitFor(() => expect(datos.crearIngresoFuturo).toHaveBeenCalledWith({
    id: 'nuevo-1', user_id: 'u1', liquidacion_id: 'liq-1', concepto: 'Cue Rental', monto: 200000.5, moneda: 'ARS', fecha: '2026-10-10',
  }))
  expect(await screen.findByText(/Cue Rental/)).toBeInTheDocument()
})

test('un monto que no es número no se guarda', async () => {
  montar()
  await screen.findByText(/Nasello Cables/)
  fireEvent.change(screen.getByLabelText('Qué es'), { target: { value: 'Algo' } })
  fireEvent.change(screen.getByLabelText('Monto esperado'), { target: { value: 'mucho' } })
  fireEvent.click(screen.getByRole('button', { name: '+ Anotar' }))
  expect(await screen.findByText(/Poné un monto válido/)).toBeInTheDocument()
  expect(datos.crearIngresoFuturo).not.toHaveBeenCalled()
})

test('si no lo reconoce, se tacha a mano y se puede destachar', async () => {
  montar()
  await screen.findByText(/Nasello Cables/)
  fireEvent.click(screen.getByRole('button', { name: 'Ya entró Nasello Cables' }))
  await waitFor(() => expect(datos.actualizarIngresoFuturo).toHaveBeenCalledWith('e1', { cobrado_a_mano: true }))
  fireEvent.click(screen.getByRole('button', { name: /Ya entraron \(2\)/ }))
  expect(within(screen.getByTestId('futuro-e1')).getByText('Tachado a mano')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Destachar Nasello Cables' }))
  await waitFor(() => expect(datos.actualizarIngresoFuturo).toHaveBeenLastCalledWith('e1', { cobrado_a_mano: false }))
})

test('borrar pide confirmación', async () => {
  const confirmar = jest.spyOn(window, 'confirm').mockReturnValueOnce(true)
  montar()
  await screen.findByText(/Nasello Cables/)
  fireEvent.click(screen.getByRole('button', { name: 'Borrar Nasello Cables' }))
  expect(confirmar).toHaveBeenCalledWith('¿Borrar "Nasello Cables" ($ 600.000,00)?')
  await waitFor(() => expect(screen.queryByText(/Nasello Cables/)).not.toBeInTheDocument())
  expect(datos.borrarIngresoFuturo).toHaveBeenCalledWith('e1')
  confirmar.mockRestore()
})
