import { eurosPorTipoDeDolar, tipoDeEuro, filasDeCotizacionDelMes, euroPorMes } from './cotizaciones'

describe('eurosPorTipoDeDolar', () => {
  test('el euro de cada tipo de dólar sale del oficial por el mismo salto que el dólar', () => {
    // Dólar oficial 1.475 y blue 1.580; euro oficial 1.707 → euro blue 1.829.
    expect(eurosPorTipoDeDolar({ oficial: 1475, blue: 1580, mep: 1560, tarjeta: 1918, eur: 1707 })).toEqual({
      eur_oficial: 1707, eur_blue: 1829, eur_mep: 1805, eur_tarjeta: 2220,
    })
  })

  test('sin dólar oficial no hay cruce: solo el euro oficial', () => {
    expect(eurosPorTipoDeDolar({ blue: 1580, eur: 1707 })).toEqual({ eur_oficial: 1707 })
  })

  test('sin euro no hay nada', () => {
    expect(eurosPorTipoDeDolar({ oficial: 1475, blue: 1580 })).toEqual({})
    expect(eurosPorTipoDeDolar()).toEqual({})
  })
})

describe('tipoDeEuro', () => {
  test('el oficial se guarda como "euro", como siempre', () => {
    expect(tipoDeEuro('oficial')).toBe('euro')
    expect(tipoDeEuro(undefined)).toBe('euro')
    expect(tipoDeEuro('blue')).toBe('euro_blue')
  })
})

describe('filasDeCotizacionDelMes', () => {
  test('guarda cada dólar y cada euro del mes', () => {
    const map = { oficial: 1475, blue: 1580, eur: 1707, ...eurosPorTipoDeDolar({ oficial: 1475, blue: 1580, eur: 1707 }) }
    expect(filasDeCotizacionDelMes(map, '2026-10')).toEqual([
      { periodo: '2026-10', tipo: 'blue', valor: 1580 },
      { periodo: '2026-10', tipo: 'oficial', valor: 1475 },
      { periodo: '2026-10', tipo: 'euro_blue', valor: 1829 },
      { periodo: '2026-10', tipo: 'euro', valor: 1707 },
    ])
  })

  test('sin cotizaciones no guarda nada', () => {
    expect(filasDeCotizacionDelMes({}, '2026-10')).toEqual([])
  })
})

describe('euroPorMes', () => {
  const filas = [
    { periodo: '2026-09', tipo: 'euro', valor: 1707 },
    { periodo: '2026-10', tipo: 'euro', valor: 1707 },
    { periodo: '2026-10', tipo: 'euro_blue', valor: 1829 },
    { periodo: '2026-10', tipo: 'blue', valor: 1580 },
  ]

  test('usa el euro del tipo de dólar elegido y, si el mes no lo tiene, el oficial', () => {
    expect(euroPorMes(filas, 'blue')).toEqual({ '2026-09': 1707, '2026-10': 1829 })
    expect(euroPorMes(filas, 'oficial')).toEqual({ '2026-09': 1707, '2026-10': 1707 })
    expect(euroPorMes([], 'blue')).toEqual({})
  })
})
