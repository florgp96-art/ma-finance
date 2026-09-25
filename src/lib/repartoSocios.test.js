const {
  calcularReparto, socioDeLaCuenta, normalizarConfigReparto, rangoDelMes, moverMes, nombreDelMes,
} = require('./repartoSocios')

const socios = ['Flor', 'Valen', 'Dol']
const cuentas = [
  { id: 'efe', nombre: 'Dol Efectivo' },
  { id: 'mp', nombre: 'Dol Mercado Pago' },
  { id: 'rev', nombre: 'Valen Revolut' },
  { id: 'mc', nombre: 'Flor Mastercard' },
]
const mov = (account_id, tipo, monto, moneda = 'ARS') => ({ account_id, tipo, monto, moneda })

// Septiembre de la agencia, tal cual quedó cargado.
const septiembre = [
  mov('efe', 'ingreso', 600000), mov('efe', 'ingreso', 350000), mov('efe', 'ingreso', 500000),
  mov('mp', 'ingreso', 200000), mov('rev', 'ingreso', 215, 'EUR'),
  mov('rev', 'gasto', 150, 'USD'), mov('rev', 'gasto', 20, 'USD'), mov('rev', 'gasto', 300, 'EUR'),
  mov('mp', 'gasto', 14000), mov('mc', 'gasto', 14000),
  mov('mc', 'gasto', 9.99, 'USD'), mov('mc', 'gasto', 20, 'USD'), mov('mc', 'gasto', 10.46, 'USD'),
]
const transferencias = [
  { de: 'Valen', a: 'Flor', monto: 210000 },
  { de: 'Valen', a: 'Dol', monto: 200000 },
  { de: 'Dol', a: 'Valen', monto: 100000 },
]

describe('calcularReparto', () => {
  test('septiembre: Dol le da a Valen y a Flor, y todos quedan con su parte', () => {
    const r = calcularReparto({
      socios, cuentas, movimientos: septiembre, transferencias, cotizaciones: { USD: 1560, EUR: 1750 },
    })
    expect(r.ingresos).toBeCloseTo(2026250, 2)
    expect(r.gastos).toBeCloseTo(881302, 2)
    expect(r.parte).toBeCloseTo(381649.33, 2)
    const tiene = Object.fromEntries(r.porSocio.map(s => [s.socio, s.tiene]))
    expect(tiene.Dol).toBeCloseTo(1736000, 2)
    expect(tiene.Valen).toBeCloseTo(-723950, 2)
    expect(tiene.Flor).toBeCloseTo(132898, 2)
    expect(r.pagos).toEqual([
      { de: 'Dol', a: 'Valen', monto: 1105599 },
      { de: 'Dol', a: 'Flor', monto: 248751 },
    ])
  })

  test('hechos esos pagos, están a mano', () => {
    const r = calcularReparto({
      socios, cuentas, movimientos: septiembre, cotizaciones: { USD: 1560, EUR: 1750 },
      transferencias: [...transferencias, { de: 'Dol', a: 'Valen', monto: 1105599 }, { de: 'Dol', a: 'Flor', monto: 248751 }],
    })
    expect(r.pagos).toEqual([])
  })

  test('un neutro no es plata ganada ni gastada', () => {
    const r = calcularReparto({ socios, cuentas, movimientos: [mov('efe', 'neutro', 50000)], cotizaciones: {} })
    expect(r.neto).toBe(0)
    expect(r.pagos).toEqual([])
  })

  test('avisa qué cuentas no son de ningún socio y qué moneda no tiene cotización', () => {
    const r = calcularReparto({
      socios, cuentas: [...cuentas, { id: 'x', nombre: 'Caja común' }],
      movimientos: [mov('x', 'ingreso', 1000), mov('rev', 'ingreso', 10, 'EUR')],
      cotizaciones: {},
    })
    expect(r.sinSocio).toEqual(['Caja común'])
    expect(r.sinCotizacion).toEqual(['EUR'])
    expect(r.ingresos).toBe(0)
  })

  test('ignora transferencias rotas en vez de romper la cuenta', () => {
    const r = calcularReparto({
      socios, cuentas, movimientos: [], cotizaciones: {},
      transferencias: [{ de: 'Flor', a: 'Flor', monto: 10 }, { de: 'Nadie', a: 'Dol', monto: 10 }, { de: 'Dol', a: 'Flor', monto: -5 }],
    })
    expect(r.porSocio.every(s => s.transferencias === 0)).toBe(true)
  })
})

describe('socioDeLaCuenta', () => {
  test('el nombre de la cuenta empieza con el del socio', () => {
    expect(socioDeLaCuenta({ nombre: 'Dol Mercado Pago' }, socios)).toBe('Dol')
    expect(socioDeLaCuenta({ nombre: 'valen revolut' }, socios)).toBe('Valen')
    expect(socioDeLaCuenta({ nombre: 'Dolores Efectivo' }, socios)).toBe(null)
    expect(socioDeLaCuenta({ nombre: 'Efectivo' }, socios)).toBe(null)
  })
})

describe('normalizarConfigReparto', () => {
  test('hacen falta al menos dos socios', () => {
    expect(normalizarConfigReparto({ socios: ['Flor'] })).toBe(null)
    expect(normalizarConfigReparto(null)).toBe(null)
    expect(normalizarConfigReparto('texto')).toBe(null)
    expect(normalizarConfigReparto({ socios: [' Flor ', 'Valen', 'Valen', ''] }))
      .toEqual({ socios: ['Flor', 'Valen'], meses: {} })
  })
})

describe('rangoDelMes', () => {
  test('del 1 del mes al 1 del siguiente', () => {
    expect(rangoDelMes('2026-09')).toEqual({ desde: '2026-09-01', hasta: '2026-10-01' })
    expect(rangoDelMes('2026-12')).toEqual({ desde: '2026-12-01', hasta: '2027-01-01' })
    expect(rangoDelMes('2026-13')).toBe(null)
    expect(rangoDelMes('')).toBe(null)
  })
})

describe('moverMes y nombreDelMes', () => {
  test('cruza el cambio de año para los dos lados', () => {
    expect(moverMes('2026-09', -1)).toBe('2026-08')
    expect(moverMes('2026-12', 1)).toBe('2027-01')
    expect(moverMes('2027-01', -1)).toBe('2026-12')
  })

  test('el nombre sale en castellano', () => {
    expect(nombreDelMes('2026-09')).toBe('Septiembre 2026')
    expect(nombreDelMes('2027-01')).toBe('Enero 2027')
  })
})
