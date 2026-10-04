import { diaDeLaSemana, formatCantidad, formatMonto, parseMonto, montoParaEditar } from './formato'

test('diaDeLaSemana', () => {
  expect(diaDeLaSemana('2026-09', 1)).toBe('martes')
  expect(diaDeLaSemana('2026-08', 31)).toBe('lunes')
  expect(diaDeLaSemana('2026-09', 27)).toBe('domingo')
  expect(diaDeLaSemana('2026-09', 31)).toBe('')
  expect(diaDeLaSemana('2026-09', 0)).toBe('')
  expect(diaDeLaSemana('2026-09', 2.5)).toBe('')
  expect(diaDeLaSemana('septiembre', 1)).toBe('')
})

test('formatCantidad: hasta dos decimales, con coma', () => {
  expect(formatCantidad(60)).toBe('60')
  expect(formatCantidad(4.5)).toBe('4,5')
  expect(formatCantidad(2.25)).toBe('2,25')
})

test('formatMonto: miles con punto, sin decimales', () => {
  expect(formatMonto(482400)).toBe('482.400')
})

// El teclado del iPhone en español solo tiene coma: un type="number" la rechazaba y
// no había forma de cargar centavos desde el celular.
describe('parseMonto: lo que se tipea en un campo de importe', () => {
  test('con coma decimal, la del teclado del celular', () => {
    expect(parseMonto('898212,50')).toBe(898212.5)
    expect(parseMonto('10,46')).toBe(10.46)
    expect(parseMonto(',5')).toBe(0.5)
  })
  test('con puntos de miles', () => {
    expect(parseMonto('898.212,50')).toBe(898212.5)
    expect(parseMonto('1.234.567')).toBe(1234567)
    expect(parseMonto('1.500')).toBe(1500)
  })
  test('con punto decimal, como en la computadora', () => {
    expect(parseMonto('1234.56')).toBe(1234.56)
    expect(parseMonto('10.46')).toBe(10.46)
    expect(parseMonto('0.500')).toBe(0.5)
  })
  test('enteros, negativos y números que ya vienen como número', () => {
    expect(parseMonto('898212')).toBe(898212)
    expect(parseMonto(' 497 ')).toBe(497)
    expect(parseMonto('-1.500,25')).toBe(-1500.25)
    expect(parseMonto(42.5)).toBe(42.5)
  })
  test('lo que no es un importe da null', () => {
    expect(parseMonto('')).toBeNull()
    expect(parseMonto(null)).toBeNull()
    expect(parseMonto(',')).toBeNull()
    expect(parseMonto('1,2,3')).toBeNull()
    expect(parseMonto('12.34,5.6')).toBeNull()
    expect(parseMonto('abc')).toBeNull()
    expect(parseMonto(NaN)).toBeNull()
  })
})

test('montoParaEditar: con coma, para que parseMonto lo vuelva a leer igual', () => {
  expect(montoParaEditar(1.234)).toBe('1,234')
  expect(parseMonto(montoParaEditar(1.234))).toBe(1.234)
  expect(montoParaEditar('103.650')).toBe('103,65')
  expect(montoParaEditar(-20.65)).toBe('-20,65')
  expect(montoParaEditar(1500)).toBe('1500')
  expect(montoParaEditar(null)).toBe('')
  expect(montoParaEditar('')).toBe('')
})
