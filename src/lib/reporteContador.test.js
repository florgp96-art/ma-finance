jest.mock('./supabase', () => ({ supabase: {} }))

import * as XLSX from 'xlsx'
import { armarReporteContador, filasDeIngresos, nombreArchivoReporte, compartirODescargar } from './reporteContador'

const aPesos = (t) => (t.moneda === 'ARS' ? Number(t.monto) : t.moneda === 'USD' ? Number(t.monto) * 1550 : null)
const ingresos = [
  { fecha: '2026-09-30', nombre: 'Nasello Cables', monto: 600000, moneda: 'ARS', facturacion: 'facturado', accounts: { nombre: 'Efectivo' }, tag: 'Clientes' },
  { fecha: '2026-09-01', nombre: 'Página web', monto: 60, moneda: 'USD', facturacion: 'sin_facturar', accounts: { nombre: 'Galicia' } },
  { fecha: '2026-09-15', nombre: 'Sueldo', monto: 900000, moneda: 'ARS', facturacion: 'no_corresponde' },
  { fecha: '2026-09-20', nombre: 'Clase', monto: 215, moneda: 'EUR' },
]

test('una fila por ingreso, del más viejo al más nuevo, con los montos como número', () => {
  expect(filasDeIngresos(ingresos, aPesos)).toEqual([
    ['01/09/2026', 'Página web', 'Galicia', '', 'USD', 60, 1550, 93000, 'Sin facturar'],
    ['15/09/2026', 'Sueldo', '', '', 'ARS', 900000, '', 900000, 'No corresponde'],
    ['20/09/2026', 'Clase', '', '', 'EUR', 215, '', '', 'Sin indicar'],
    ['30/09/2026', 'Nasello Cables', 'Efectivo', 'Clientes', 'ARS', 600000, '', 600000, 'Facturado'],
  ])
})

test('el Excel trae el resumen por estado y la lista de ingresos', () => {
  const libro = armarReporteContador({ ingresos, aPesos, periodo: 'Septiembre 2026', titular: 'ana@x.com', generado: new Date('2026-10-01T12:00:00Z') })
  expect(libro.SheetNames).toEqual(['Resumen', 'Ingresos'])
  const resumen = XLSX.utils.sheet_to_json(libro.Sheets.Resumen, { header: 1 })
  expect(resumen.slice(0, 4)).toEqual([['Reporte de ingresos'], ['Período', 'Septiembre 2026'], ['Titular', 'ana@x.com'], ['Generado', '01/10/2026']])
  expect(resumen[5]).toEqual(['Facturación', 'Cantidad', 'Monto ARS', 'Monto USD', 'Monto EUR', 'Equivalente en $'])
  expect(resumen[6]).toEqual(['Facturado', 1, 600000, 0, 0, 600000])
  expect(resumen[7]).toEqual(['Sin facturar', 1, 0, 60, 0, 93000])
  expect(resumen[8]).toEqual(['No corresponde', 1, 900000, 0, 0, 900000])
  expect(resumen[9]).toEqual(['Sin indicar', 1, 0, 0, 215, 0])
  expect(resumen[10]).toEqual(['Total', 4, 1500000, 60, 215, 1593000])
  expect(resumen.at(-1)[0]).toMatch(/1 ingreso\(s\) en moneda extranjera sin cotización/)
  const filas = XLSX.utils.sheet_to_json(libro.Sheets.Ingresos)
  expect(filas).toHaveLength(4)
  expect(filas[3]).toMatchObject({ Descripción: 'Nasello Cables', Monto: 600000, Facturación: 'Facturado' })
})

test('el nombre del archivo no lleva tildes ni espacios', () => {
  expect(nombreArchivoReporte('Septiembre 2026')).toBe('ingresos-septiembre-2026.xlsx')
  expect(nombreArchivoReporte('Agosto 2026 a Septiembre 2026')).toBe('ingresos-agosto-2026-a-septiembre-2026.xlsx')
})

describe('compartirODescargar', () => {
  const libro = () => armarReporteContador({ ingresos, aPesos, periodo: 'Septiembre 2026' })
  const navegador = {}
  beforeEach(() => {
    navegador.canShare = navigator.canShare
    navegador.share = navigator.share
    global.URL.createObjectURL = jest.fn(() => 'blob:x')
    global.URL.revokeObjectURL = jest.fn()
  })
  afterEach(() => {
    navigator.canShare = navegador.canShare
    navigator.share = navegador.share
  })

  test('en el celular abre el menú de compartir con el archivo', async () => {
    navigator.canShare = jest.fn(() => true)
    navigator.share = jest.fn(() => Promise.resolve())
    await expect(compartirODescargar(libro(), 'ingresos.xlsx', { titulo: 'T' })).resolves.toBe('compartido')
    expect(navigator.share.mock.calls[0][0].files[0].name).toBe('ingresos.xlsx')
  })

  test('si la persona cierra el menú, no se descarga nada', async () => {
    navigator.canShare = jest.fn(() => true)
    navigator.share = jest.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })))
    await expect(compartirODescargar(libro(), 'ingresos.xlsx')).resolves.toBe('cancelado')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  test('donde no se pueden compartir archivos, se descarga', async () => {
    navigator.canShare = undefined
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await expect(compartirODescargar(libro(), 'ingresos.xlsx')).resolves.toBe('descargado')
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })
})
