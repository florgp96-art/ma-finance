import React from 'react'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import Liquidacion from './Liquidacion'
import * as datos from '../lib/liquidacionDatos'

const mockDb = { meses: [], dias: [], fallar: new Set(), id: 0 }

// CRA reinicia los mocks antes de cada test (resetMocks): las implementaciones van en beforeEach.
jest.mock('../lib/liquidacionDatos', () => ({
  nuevoId: () => `id-${++mockDb.id}`,
  leerMeses: jest.fn(),
  leerDias: jest.fn(),
  crearMes: jest.fn(),
  leerMesPorClave: jest.fn(),
  actualizarMes: jest.fn(),
  insertarDia: jest.fn(),
  actualizarDia: jest.fn(),
  borrarDia: jest.fn(),
  actualizarLiquidacion: jest.fn(),
  borrarLiquidacion: jest.fn(),
}))

const resultado = (op, data = null) =>
  Promise.resolve(mockDb.fallar.has(op) ? { data: null, error: { message: 'sin red' } } : { data, error: null })

const TOTALES = { '2026-03': 142200, '2026-04': 584800, '2026-05': 622500, '2026-06': 420000, '2026-07': 431250, '2026-08': 482400 }
const AGOSTO = [
  [4, 3, 2], [5, 3, 2], [6, 7.5, 2], [7, 4, 2], [11, 3, 2], [13, 3, 0], [14, 3, 2], [18, 5, 2],
  [20, 3, 2], [21, 4.5, 2], [24, 3, 1], [25, 3.5, 2], [26, 3, 1], [27, 2.5, 2], [28, 6, 2], [31, 3, 1],
]

beforeEach(() => {
  mockDb.id = 0
  mockDb.fallar = new Set()
  mockDb.meses = Object.entries(TOTALES).map(([clave, total]) => ({
    id: `m${clave.slice(5)}`, clave, valor_hora: 7500, valor_viatico: 1200, valor_jornada: 25000, cerrado: true, total_cerrado: total,
  }))
  datos.leerMeses.mockImplementation(() => resultado('leerMeses', mockDb.meses.map(m => ({ ...m }))))
  datos.leerDias.mockImplementation((mesId) => resultado('leerDias', mockDb.dias.filter(d => d.mes_id === mesId).map(d => ({ ...d }))))
  datos.crearMes.mockImplementation((mes) => resultado('crearMes', { ...mes, cerrado: false, total_cerrado: null }))
  datos.leerMesPorClave.mockImplementation(() => resultado('leerMesPorClave'))
  datos.actualizarMes.mockImplementation(() => resultado('actualizarMes'))
  datos.insertarDia.mockImplementation(() => resultado('insertarDia'))
  datos.actualizarDia.mockImplementation(() => resultado('actualizarDia'))
  datos.borrarDia.mockImplementation(() => resultado('borrarDia'))
  datos.actualizarLiquidacion.mockImplementation(() => resultado('actualizarLiquidacion'))
  datos.borrarLiquidacion.mockImplementation(() => resultado('borrarLiquidacion'))
  mockDb.dias = AGOSTO.map(([dia, horas, viajes], i) => ({
    id: `a${i}`, mes_id: 'm08', dia, tipo: 'horas', horas, viajes, created_at: `2026-08-${String(dia).padStart(2, '0')}T12:00:00Z`,
  }))
})

const EMPLEADA = { id: 'liq-1', nombre: 'Sueldo de la empleada', tipo: 'pago' }
const montar = (props = {}) => render(<Liquidacion userId="u1" liquidacion={EMPLEADA} darkMode={false} styles={{ input: {} }} {...props} />)
const abrirSeptiembre = async () => {
  montar()
  await screen.findByRole('heading', { name: 'Septiembre 2026' })
  await waitFor(() => expect(screen.getByRole('button', { name: '+ Sumar un día' })).toBeEnabled())
}
const texto = (el) => el.textContent.replace(/ /g, ' ')

test('abre el mes siguiente al último cerrado, con las tarifas heredadas, y muestra el historial', async () => {
  await abrirSeptiembre()
  expect(datos.leerMeses).toHaveBeenCalledWith('liq-1')
  expect(datos.crearMes).toHaveBeenCalledWith({ id: 'id-1', user_id: 'u1', liquidacion_id: 'liq-1', clave: '2026-09', valor_hora: 7500, valor_viatico: 1200, valor_jornada: 25000 })
  expect(screen.getByText('0 jornadas · 0 hs · 0 viajes · 0 días')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Agosto 2026' })).toBeInTheDocument()
  expect(screen.getByText('$ 482.400')).toBeInTheDocument()
  expect(screen.getByText('$ 2.683.150')).toBeInTheDocument() // acumulado de marzo a agosto
})

test('"Sumar un día" escribe en el momento y la fila aparece con su día de la semana', async () => {
  await abrirSeptiembre()
  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  expect(datos.insertarDia).toHaveBeenCalledWith(expect.objectContaining({ id: 'id-2', mes_id: 'id-1', dia: 1, tipo: 'horas', horas: 0, viajes: 0 }))
  expect(screen.getByText('martes')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  expect(datos.insertarDia).toHaveBeenLastCalledWith(expect.objectContaining({ dia: 2, tipo: 'horas' }))
  expect(screen.getByText('miércoles')).toBeInTheDocument()
  expect(await screen.findByText('Guardado')).toBeInTheDocument()
})

test('el tipeo se guarda a los 500 ms como mucho, con horas y viajes juntos', async () => {
  await abrirSeptiembre()
  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  fireEvent.change(screen.getByLabelText('Horas del día 1'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('Viajes del día 1'), { target: { value: '2' } })
  expect(datos.actualizarDia).not.toHaveBeenCalled()
  expect(screen.getAllByText('$ 24.900').length).toBeGreaterThan(0)
  await waitFor(() => expect(datos.actualizarDia).toHaveBeenCalledWith('id-2', { horas: 3, viajes: 2 }))
  expect(datos.actualizarDia).toHaveBeenCalledTimes(1)
  expect(await screen.findByText('Guardado')).toBeInTheDocument()
  expect(screen.getByText('0 jornadas · 3 hs · 2 viajes · 1 día')).toBeInTheDocument()
})

test('al ocultar la página, en pagehide y al desmontar se manda lo pendiente sin esperar', async () => {
  const { unmount } = montar()
  await screen.findByRole('heading', { name: 'Septiembre 2026' })
  await waitFor(() => expect(screen.getByRole('button', { name: '+ Sumar un día' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))

  fireEvent.change(screen.getByLabelText('Horas del día 1'), { target: { value: '4' } })
  const visibilidad = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  visibilidad.mockRestore()
  await waitFor(() => expect(datos.actualizarDia).toHaveBeenCalledWith('id-2', { horas: 4, viajes: 0 }))

  fireEvent.change(screen.getByLabelText('Horas del día 1'), { target: { value: '5' } })
  act(() => { window.dispatchEvent(new Event('pagehide')) })
  await waitFor(() => expect(datos.actualizarDia).toHaveBeenCalledWith('id-2', { horas: 5, viajes: 0 }))

  fireEvent.change(screen.getByLabelText('Horas del día 1'), { target: { value: '6' } })
  unmount()
  await waitFor(() => expect(datos.actualizarDia).toHaveBeenCalledWith('id-2', { horas: 6, viajes: 0 }))
  expect(datos.actualizarDia).toHaveBeenCalledTimes(3)
})

test('jornada: se guarda en el momento, cambian los rótulos y suma la jornada', async () => {
  await abrirSeptiembre()
  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  fireEvent.click(screen.getByRole('button', { name: 'Por hora' }))
  // Sale en cuanto vuelve el insert de esa fila (nunca antes: sería un update de una fila que no existe).
  await waitFor(() => expect(datos.actualizarDia).toHaveBeenCalledWith('id-2', { tipo: 'jornada' }))
  expect(screen.getByLabelText('Hs extra del día 1')).toBeInTheDocument()
  expect(screen.getByLabelText('Viajes extra del día 1')).toBeInTheDocument()
  expect(screen.getAllByText('$ 25.000').length).toBeGreaterThan(0)
  expect(screen.getByText('1 jornada · 0 hs · 0 viajes · 1 día')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  expect(datos.insertarDia).toHaveBeenLastCalledWith(expect.objectContaining({ dia: 2, tipo: 'jornada' }))
  expect(await screen.findByText('Guardado')).toBeInTheDocument()
})

test('un día fuera del mes no se guarda y vuelve al anterior', async () => {
  await abrirSeptiembre()
  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  const dia = screen.getByLabelText('Día')
  fireEvent.focus(dia)
  fireEvent.change(dia, { target: { value: '31' } })
  fireEvent.blur(dia)
  expect(dia).toHaveValue(1)
  fireEvent.focus(dia)
  fireEvent.change(dia, { target: { value: '15' } })
  fireEvent.blur(dia)
  await waitFor(() => expect(datos.actualizarDia).toHaveBeenCalledWith('id-2', { dia: 15 }))
  expect(datos.actualizarDia).toHaveBeenCalledTimes(1)
  expect(screen.getByText('martes')).toBeInTheDocument()
})

test('si agregar el día falla dos veces, la fila se va y se avisa', async () => {
  await abrirSeptiembre()
  mockDb.fallar.add('insertarDia')
  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  expect(screen.getByLabelText('Día')).toBeInTheDocument()
  expect(await screen.findByText('No se pudo agregar el día. Probá de nuevo.', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(datos.insertarDia).toHaveBeenCalledTimes(2)
  expect(screen.queryByLabelText('Día')).not.toBeInTheDocument()
})

test('borrar un día escribe en el momento', async () => {
  await abrirSeptiembre()
  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  fireEvent.click(screen.getByRole('button', { name: 'Borrar el día 1' }))
  await waitFor(() => expect(datos.borrarDia).toHaveBeenCalledWith('id-2'))
  expect(screen.queryByLabelText('Día')).not.toBeInTheDocument()
})

test('cerrar el mes guarda el total y deja abierto el siguiente', async () => {
  await abrirSeptiembre()
  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  fireEvent.change(screen.getByLabelText('Horas del día 1'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar el mes' }))
  await waitFor(() => expect(datos.actualizarMes).toHaveBeenCalledWith('id-1', { cerrado: true, total_cerrado: 15000 }))
  // Lo tipeado sale antes del cierre.
  expect(datos.actualizarDia).toHaveBeenCalledWith('id-2', { horas: 2, viajes: 0 })
  expect(await screen.findByRole('heading', { name: 'Octubre 2026' })).toBeInTheDocument()
  expect(datos.crearMes).toHaveBeenLastCalledWith(expect.objectContaining({ clave: '2026-10', valor_hora: 7500 }))
  expect(screen.getByRole('button', { name: 'Septiembre 2026' })).toBeInTheDocument()
  expect(screen.getByText('$ 15.000')).toBeInTheDocument()
})

test('un mes cerrado se ve sin editar y se puede volver a abrir', async () => {
  await abrirSeptiembre()
  fireEvent.click(screen.getByRole('button', { name: 'Agosto 2026' }))
  expect(await screen.findByRole('heading', { name: 'Agosto 2026' })).toBeInTheDocument()
  await waitFor(() => expect(screen.getAllByLabelText('Día')).toHaveLength(16))
  expect(screen.getByText('0 jornadas · 60 hs · 27 viajes · 16 días')).toBeInTheDocument()
  expect(screen.getAllByLabelText('Día')[0]).toBeDisabled()
  expect(screen.queryByRole('button', { name: '+ Sumar un día' })).not.toBeInTheDocument()
  expect(texto(screen.getByText(/Mes cerrado en/))).toBe('Mes cerrado en $ 482.400.')

  const aviso = screen.getByText(/Mes cerrado en/).parentElement
  fireEvent.click(within(aviso).getByRole('button', { name: 'Volver a abrir' }))
  await waitFor(() => expect(datos.actualizarMes).toHaveBeenCalledWith('m08', { cerrado: false }))
  await waitFor(() => expect(screen.getAllByLabelText('Día')[0]).toBeEnabled())
  expect(screen.getByRole('button', { name: '+ Sumar un día' })).toBeInTheDocument()
})

test('las tarifas se editan y se guardan; el subtotal usa la nueva', async () => {
  await abrirSeptiembre()
  fireEvent.click(screen.getByRole('button', { name: '+ Sumar un día' }))
  fireEvent.change(screen.getByLabelText('Horas del día 1'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: /Tarifas del mes/ }))
  fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '8000' } })
  expect(screen.getAllByText('$ 16.000').length).toBeGreaterThan(0)
  await waitFor(() => expect(datos.actualizarMes).toHaveBeenCalledWith('id-1', { valor_hora: 8000, valor_viatico: 1200, valor_jornada: 25000 }))
  fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '-5' } })
  fireEvent.blur(screen.getByLabelText('Hora'))
  expect(screen.getByLabelText('Hora')).toHaveValue(8000)
})

test('si no se puede leer la liquidación, lo dice y deja reintentar', async () => {
  mockDb.fallar.add('leerMeses')
  montar()
  expect(await screen.findByText('No se pudo leer la liquidación.', {}, { timeout: 3000 })).toBeInTheDocument()
  mockDb.fallar.delete('leerMeses')
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  expect(await screen.findByRole('heading', { name: 'Septiembre 2026' })).toBeInTheDocument()
})

// La liquidación de la empleada se veía como si fuera la de la dueña de la cuenta:
// ahora cada una dice qué es, y el nombre se cambia tocándolo, como el de una cuenta.
describe('nombre y tipo de la liquidación', () => {
  test('el encabezado dice de quién es y si la pagás o te la pagan', async () => {
    await abrirSeptiembre()
    expect(screen.getByRole('button', { name: 'Editar Sueldo de la empleada' })).toHaveTextContent('Sueldo de la empleada · pagás')
    expect(screen.getByText('Acumulado pagado')).toBeInTheDocument()
  })

  test('tocar el nombre deja cambiarlo y el tipo, y avisa con lo guardado', async () => {
    const onCambiada = jest.fn()
    montar({ onCambiada })
    await screen.findByRole('heading', { name: 'Septiembre 2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Editar Sueldo de la empleada' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '  Sueldo   de Renata ' } })
    fireEvent.click(screen.getByRole('button', { name: /Te la pagan/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(datos.actualizarLiquidacion).toHaveBeenCalledWith('liq-1', { nombre: 'Sueldo de Renata', tipo: 'cobro' }))
    expect(onCambiada).toHaveBeenCalledWith({ id: 'liq-1', nombre: 'Sueldo de Renata', tipo: 'cobro' })
    await waitFor(() => expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument())
  })

  test('un nombre vacío no se guarda', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Septiembre 2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Editar Sueldo de la empleada' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(/Poné un nombre/)).toBeInTheDocument()
    expect(datos.actualizarLiquidacion).not.toHaveBeenCalled()
  })

  test('borrarla pide confirmación con cuántos meses se lleva', async () => {
    const onBorrada = jest.fn()
    const confirmar = jest.spyOn(window, 'confirm')
    montar({ onBorrada })
    await screen.findByRole('heading', { name: 'Septiembre 2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Editar Sueldo de la empleada' }))

    confirmar.mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Borrar esta liquidación' }))
    expect(confirmar).toHaveBeenLastCalledWith('¿Borrar "Sueldo de la empleada" con sus 7 meses? No se puede deshacer.')
    expect(datos.borrarLiquidacion).not.toHaveBeenCalled()

    confirmar.mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'Borrar esta liquidación' }))
    await waitFor(() => expect(onBorrada).toHaveBeenCalledWith('liq-1'))
    expect(datos.borrarLiquidacion).toHaveBeenCalledWith('liq-1')
    confirmar.mockRestore()
  })

  // Las tarifas de la empleada no tienen nada que ver con lo que cobra otro trabajo.
  test('una liquidación nueva arranca sin tarifas, con el nombre para editar y las tarifas a la vista', async () => {
    mockDb.meses = []
    montar({ liquidacion: { id: 'liq-2', nombre: 'Nueva liquidación', tipo: 'cobro' }, editarAlAbrir: true })
    await screen.findByRole('heading', { name: /2026/ })
    expect(datos.crearMes).toHaveBeenCalledWith(expect.objectContaining({ liquidacion_id: 'liq-2', valor_hora: 0, valor_viatico: 0, valor_jornada: 0 }))
    expect(screen.getByLabelText('Nombre')).toHaveValue('Nueva liquidación')
    expect(screen.getByText('Cargá cuánto vale la hora, el viaje o la jornada.')).toBeInTheDocument()
    expect(screen.getByLabelText('Hora')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar Nueva liquidación' })).toHaveTextContent('Nueva liquidación · cobrás')
  })
})
