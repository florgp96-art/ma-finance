import { cruzarConIngresos, desdeCuandoBuscar, totalesPorMoneda } from './ingresosFuturos'

const esperado = (id, concepto, monto, fecha, extra = {}) => ({ id, concepto, monto, fecha, moneda: 'ARS', cobrado_a_mano: false, ...extra })
const ingreso = (id, nombre, monto, fecha, extra = {}) => ({ id, tipo: 'ingreso', nombre, monto, fecha, moneda: 'ARS', ...extra })

describe('cruzarConIngresos — se tacha cuando el ingreso entra en una cuenta', () => {
  test('mismo monto y fecha cercana, aunque el nombre no coincida', () => {
    const cruce = cruzarConIngresos(
      [esperado('e1', 'Clases de octubre', 150000, '2026-10-05')],
      [ingreso('t1', 'Transferencia recibida', 150000, '2026-10-08')])
    expect(cruce.get('e1')?.id).toBe('t1')
  })

  // Caso real: € 500 anotados, € 497 recibidos (comisión).
  test('con el nombre en común tolera una diferencia chica de monto', () => {
    const cruce = cruzarConIngresos(
      [esperado('e1', "Dani's Catering Marbella", 500, '2026-10-01', { moneda: 'EUR' })],
      [ingreso('t1', 'Dani', 497, '2026-10-01', { moneda: 'EUR' })])
    expect(cruce.get('e1')?.id).toBe('t1')
  })

  test('sin el nombre en común, una diferencia de 5 % no alcanza', () => {
    const cruce = cruzarConIngresos(
      [esperado('e1', 'Clases', 100000, '2026-10-05')],
      [ingreso('t1', 'Transferencia', 95000, '2026-10-05')])
    expect(cruce.size).toBe(0)
  })

  test('otra moneda, muy lejos en el tiempo o pendiente no cuentan', () => {
    const cruce = cruzarConIngresos(
      [esperado('e1', 'Maia', 250000, '2026-10-01')],
      [
        ingreso('t1', 'Maia', 250000, '2026-10-01', { moneda: 'USD' }),
        ingreso('t2', 'Maia', 250000, '2026-12-30'),
        ingreso('t3', 'Maia', 250000, '2026-10-02', { pendiente: true }),
        { ...ingreso('t4', 'Maia', 250000, '2026-10-02'), tipo: 'gasto' },
      ])
    expect(cruce.size).toBe(0)
  })

  // Dos cuotas iguales en meses seguidos no se tachan con un mismo pago.
  test('cada ingreso tacha uno solo, y en orden de fecha', () => {
    const cruce = cruzarConIngresos(
      [esperado('nov', 'Cuota', 100000, '2026-11-05'), esperado('oct', 'Cuota', 100000, '2026-10-05')],
      [ingreso('t1', 'Cuota', 100000, '2026-10-06')])
    expect(cruce.get('oct')?.id).toBe('t1')
    expect(cruce.has('nov')).toBe(false)
  })

  test('entre varios candidatos gana el que comparte el nombre', () => {
    const cruce = cruzarConIngresos(
      [esperado('e1', 'Nasello Cables', 600000, '2026-10-05')],
      [ingreso('t1', 'Otro cliente', 600000, '2026-10-05'), ingreso('t2', 'NASELLO', 600000, '2026-10-09')])
    expect(cruce.get('e1')?.id).toBe('t2')
  })

  test('uno tachado a mano no consume ningún ingreso', () => {
    const cruce = cruzarConIngresos(
      [esperado('e1', 'Cuota', 100000, '2026-10-05', { cobrado_a_mano: true }), esperado('e2', 'Cuota', 100000, '2026-10-06')],
      [ingreso('t1', 'Cuota', 100000, '2026-10-06')])
    expect(cruce.has('e1')).toBe(false)
    expect(cruce.get('e2')?.id).toBe('t1')
  })
})

test('desdeCuandoBuscar: 15 días antes del primero esperado', () => {
  expect(desdeCuandoBuscar([esperado('a', 'x', 1, '2026-11-01'), esperado('b', 'y', 1, '2026-10-10')])).toBe('2026-09-25')
  expect(desdeCuandoBuscar([])).toBeNull()
})

test('totalesPorMoneda: lo que falta y lo que ya entró, sin mezclar monedas', () => {
  const lista = [
    esperado('a', 'x', 100000, '2026-10-01'),
    esperado('b', 'y', 50000, '2026-10-02', { cobrado_a_mano: true }),
    esperado('c', 'z', 100, '2026-10-03', { moneda: 'USD' }),
    esperado('d', 'w', 30000, '2026-10-04'),
  ]
  const cruce = new Map([['d', ingreso('t1', 'w', 30000, '2026-10-04')]])
  expect(totalesPorMoneda(lista, cruce)).toEqual({ falta: { ARS: 100000, USD: 100 }, entro: { ARS: 80000 } })
})
