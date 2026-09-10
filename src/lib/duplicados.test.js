const { filtrarYaCargados } = require('./duplicados')

const CARD = 'mastercard'
const pago = (fecha, monto, detalle, extra = {}) =>
  ({ account_id: CARD, tipo: 'neutro', fecha, monto, moneda: 'ARS', detalle, ...extra })
const gasto = (fecha, monto, detalle, extra = {}) =>
  ({ account_id: CARD, tipo: 'gasto', fecha, monto, moneda: 'ARS', detalle, ...extra })

// El caso real: el usuario carga el pago a mano para ver la deuda al día, y cuando
// llega el PDF el banco lo trae con otro texto. Sin esto entraba dos veces, y un
// pago contado dos veces borra deuda que existe.
describe('un pago ya cargado no vuelve a entrar aunque el banco lo llame distinto', () => {
  test('"SU PAGO" del PDF reconoce el "Pago Mastercard" cargado a mano', () => {
    const { nuevos, omitidos } = filtrarYaCargados(
      [pago('2026-09-01', 500000, 'SU PAGO')],
      [pago('2026-09-01', 500000, 'Pago Mastercard')],
    )
    expect(nuevos).toHaveLength(0)
    expect(omitidos).toBe(1)
  })

  // Caso real de los datos: el resumen fechaba el pago el 02-Ago y en la app estaba
  // cargado el 03-Ago.
  test('tolera que el banco y el usuario lo fechen distinto', () => {
    const { nuevos } = filtrarYaCargados(
      [pago('2026-08-02', 1500000, 'SU PAGO')],
      [pago('2026-08-03', 1500000, 'Pago Mastercard')],
    )
    expect(nuevos).toHaveLength(0)
  })

  test('pero no colapsa pagos separados por mucho tiempo', () => {
    const { nuevos } = filtrarYaCargados(
      [pago('2026-08-20', 1500000, 'SU PAGO')],
      [pago('2026-08-03', 1500000, 'Pago Mastercard')],
    )
    expect(nuevos).toHaveLength(1)
  })

  test('un pago por otro monto sí es un pago distinto', () => {
    const { nuevos } = filtrarYaCargados(
      [pago('2026-09-01', 360000, 'SU PAGO')],
      [pago('2026-09-01', 500000, 'Pago tarjeta')],
    )
    expect(nuevos).toHaveLength(1)
  })

  test('el pago en dólares no se confunde con el de pesos', () => {
    const { nuevos } = filtrarYaCargados(
      [pago('2026-09-01', 103.65, 'SU PAGO U$S', { moneda: 'USD' })],
      [pago('2026-09-01', 103.65, 'Pago tarjeta')],
    )
    expect(nuevos).toHaveLength(1)
  })

  test('un pago no tapa un gasto del mismo monto y día', () => {
    const { nuevos } = filtrarYaCargados(
      [pago('2026-09-01', 500000, 'SU PAGO')],
      [gasto('2026-09-01', 500000, 'BIND*TERRAMUNDISA_')],
    )
    expect(nuevos).toHaveLength(1)
  })

  // Los tres pagos del 01/09 de la Mastercard, cargados a mano, contra el resumen
  // siguiente que los trae todos como "SU PAGO".
  test('reconoce varios pagos del mismo día con montos distintos', () => {
    const { nuevos, omitidos } = filtrarYaCargados(
      [pago('2026-09-01', 1465058.14, 'SU PAGO'), pago('2026-09-01', 500000, 'SU PAGO'), pago('2026-08-31', 360000, 'SU PAGO')],
      [pago('2026-09-01', 1465058.14, 'Pago tarjeta'), pago('2026-09-01', 500000, 'Pago tarjeta'), pago('2026-08-31', 360000, 'Pago Tarjeta Mastercard')],
    )
    expect(nuevos).toHaveLength(0)
    expect(omitidos).toBe(3)
  })

  test('dos pagos iguales el mismo día y uno solo cargado: entra el que falta', () => {
    const { nuevos, omitidos } = filtrarYaCargados(
      [pago('2026-09-01', 500000, 'SU PAGO'), pago('2026-09-01', 500000, 'SU PAGO')],
      [pago('2026-09-01', 500000, 'Pago tarjeta')],
    )
    expect(nuevos).toHaveLength(1)
    expect(omitidos).toBe(1)
  })

  test('un pago de otra cuenta no cuenta como ya cargado', () => {
    const { nuevos } = filtrarYaCargados(
      [pago('2026-09-01', 500000, 'SU PAGO')],
      [pago('2026-09-01', 500000, 'Pago Visa', { account_id: 'visa' })],
    )
    expect(nuevos).toHaveLength(1)
  })
})

describe('en un gasto la descripción sigue siendo parte de la identidad', () => {
  test('mismo día y monto, comercio distinto: son dos gastos', () => {
    const { nuevos } = filtrarYaCargados(
      [gasto('2026-09-01', 5000, 'PANADERIA HOUSE BROT')],
      [gasto('2026-09-01', 5000, 'PILAR FRESH-PILAR FRES')],
    )
    expect(nuevos).toHaveLength(1)
  })

  test('el mismo gasto no se duplica al reimportar el resumen', () => {
    const { nuevos, omitidos } = filtrarYaCargados(
      [gasto('2026-09-01', 5000, 'PANADERIA HOUSE BROT')],
      [gasto('2026-09-01', 5000, 'panaderia house brot')],
    )
    expect(nuevos).toHaveLength(0)
    expect(omitidos).toBe(1)
  })

  test('en un gasto la fecha no tiene tolerancia', () => {
    const { nuevos } = filtrarYaCargados(
      [gasto('2026-09-02', 5000, 'PANADERIA HOUSE BROT')],
      [gasto('2026-09-01', 5000, 'PANADERIA HOUSE BROT')],
    )
    expect(nuevos).toHaveLength(1)
  })

  test('dos gastos idénticos en el PDF y uno cargado: entra el que falta', () => {
    const { nuevos, omitidos } = filtrarYaCargados(
      [gasto('2026-09-01', 6000, 'MERPAGO*HEHAIJIN'), gasto('2026-09-01', 6000, 'MERPAGO*HEHAIJIN')],
      [gasto('2026-09-01', 6000, 'MERPAGO*HEHAIJIN')],
    )
    expect(nuevos).toHaveLength(1)
    expect(omitidos).toBe(1)
  })
})

describe('bordes', () => {
  test('sin nada cargado, entran todos', () => {
    const { nuevos, omitidos } = filtrarYaCargados([gasto('2026-09-01', 100, 'X')], [])
    expect(nuevos).toHaveLength(1)
    expect(omitidos).toBe(0)
  })

  test('sin candidatos no se rompe', () => {
    expect(filtrarYaCargados(null, null)).toEqual({ nuevos: [], omitidos: 0 })
  })
})
