import { diaDeLaSemana, formatCantidad, formatMonto } from './formato'

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
