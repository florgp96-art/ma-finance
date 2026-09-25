const {
  calcularReparto, socioDeLaCuenta, normalizarConfigReparto, rangoDelMes, moverMes, nombreDelMes, cuotasDelMes,
  cotizacionFijaDelMes, repartoDelMes, repartoDelPeriodo, fraccionesDeReparto, porcentajesTrabajo,
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
  mov('rev', 'gasto', 150, 'USD'), mov('rev', 'gasto', 20, 'USD'), { ...mov('rev', 'gasto', 300, 'EUR'), id: 'capcut' },
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
      .toEqual({ socios: ['Flor', 'Valen'], meses: {}, cuotas: [], trabajos: [] })
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

// CapCut: Valen pagó 300 € el 1/9. A cada uno le tocan 100 €; Flor y Dol se los
// devuelven de a 25 € por mes entre los dos (12,50 € cada uno), 8 meses.
const capcut = { movimientoId: 'capcut', concepto: 'CapCut', pagoDe: 'Valen', monto: 300, moneda: 'EUR', desde: '2026-09', porMes: 25 }

describe('gastos que se devuelven en cuotas', () => {
  test('septiembre: CapCut no entra entero y Flor y Dol le devuelven su cuota a Valen', () => {
    const r = calcularReparto({
      socios, cuentas, movimientos: septiembre, transferencias, cotizaciones: { USD: 1560, EUR: 1750 },
      cuotas: [capcut], mes: '2026-09',
    })
    expect(r.gastos).toBeCloseTo(356302, 2)
    expect(r.parte).toBeCloseTo(556649.33, 2)
    expect(r.cuotas.map(c => [c.de, c.a, c.monto, c.numero, c.total])).toEqual([
      ['Flor', 'Valen', 12.5, 1, 8],
      ['Dol', 'Valen', 12.5, 1, 8],
    ])
    expect(r.pagos).toEqual([
      { de: 'Dol', a: 'Valen', monto: 799349 },
      { de: 'Dol', a: 'Flor', monto: 401876 },
    ])
  })

  test('la última cuota es la de abril, y en mayo ya no hay nada', () => {
    const abril = cuotasDelMes({ cuotas: [capcut], socios, mes: '2027-04' })
    expect(abril.map(c => [c.de, c.monto, c.numero])).toEqual([['Flor', 12.5, 8], ['Dol', 12.5, 8]])
    expect(cuotasDelMes({ cuotas: [capcut], socios, mes: '2027-05' })).toEqual([])
    expect(cuotasDelMes({ cuotas: [capcut], socios, mes: '2026-08' })).toEqual([])
  })

  test('al final cada uno devolvió exactamente su parte', () => {
    let total = 0
    for (let i = 0; i < 12; i++) {
      total += cuotasDelMes({ cuotas: [capcut], socios, mes: moverMes('2026-09', i) })
        .filter(c => c.de === 'Flor').reduce((s, c) => s + c.monto, 0)
    }
    expect(total).toBeCloseTo(100, 2)
  })

  test('una cuota que no cierra justo termina con el resto', () => {
    const c = { ...capcut, monto: 290 } // 96,67 € cada uno a 12,50 €: 7 cuotas y un resto
    const octava = cuotasDelMes({ cuotas: [c], socios, mes: '2027-04' })
    expect(octava[0].monto).toBeCloseTo(9.17, 2)
    expect(octava[0].total).toBe(8)
  })

  test('ignora cuotas rotas en vez de romper la cuenta', () => {
    expect(cuotasDelMes({ cuotas: [{ ...capcut, pagoDe: 'Nadie' }, { ...capcut, porMes: 0 }, null], socios, mes: '2026-09' })).toEqual([])
  })
})

describe('repartoDelMes y repartoDelPeriodo (calculadora y tarjeta "Socios")', () => {
  const conFecha = (t, fecha) => ({ ...t, fecha })
  const config = {
    socios,
    cuotas: [capcut],
    meses: { '2026-09': { usd: 9999, transferencias } },
  }

  test('la cotización fija es la del primer pago que la tenga; las claves viejas no cuentan', () => {
    expect(cotizacionFijaDelMes({ usd: 9999, cotizacionFija: { usd: 1, fecha: '2026-09-01' }, transferencias })).toBe(null)
    const fija = { usd: 1560, eur: 1750, fecha: '2026-09-26' }
    expect(cotizacionFijaDelMes({ transferencias: [...transferencias, { de: 'Dol', a: 'Flor', monto: 1, cotizacion: fija }] })).toEqual(fija)
  })

  test('un mes desde la configuración da lo mismo que la calculadora a mano', () => {
    const r = repartoDelMes({ config, mes: '2026-09', movimientos: septiembre, cuentas, cotizacionesVivas: { USD: 1560, EUR: 1750 } })
    expect(r.fija).toBe(null)
    expect(r.cotizaciones).toEqual({ USD: 1560, EUR: 1750 })
    expect(r.pagos).toEqual([
      { de: 'Dol', a: 'Valen', monto: 799349 },
      { de: 'Dol', a: 'Flor', monto: 401876 },
    ])
  })

  test('el período suma mes por mes, cada uno con sus pagos y sus cuotas', () => {
    const octubre = [mov('efe', 'ingreso', 300000)]
    const movimientos = [
      ...septiembre.map(t => conFecha(t, '2026-09-01')),
      ...octubre.map(t => conFecha(t, '2026-10-05')),
    ]
    const vivas = { USD: 1560, EUR: 1750 }
    const sep = repartoDelMes({ config, mes: '2026-09', movimientos: movimientos.filter(t => t.fecha.startsWith('2026-09')), cuentas, cotizacionesVivas: vivas })
    const oct = repartoDelMes({ config, mes: '2026-10', movimientos: movimientos.filter(t => t.fecha.startsWith('2026-10')), cuentas, cotizacionesVivas: vivas })
    const r = repartoDelPeriodo({ config, meses: ['2026-09', '2026-10'], movimientos, cuentas, cotizacionesVivas: vivas })
    expect(r.parte).toBeCloseTo(sep.parte + oct.parte, 2)
    for (const s of r.porSocio) {
      const enSep = sep.porSocio.find(x => x.socio === s.socio)
      const enOct = oct.porSocio.find(x => x.socio === s.socio)
      expect(s.tiene).toBeCloseTo(enSep.tiene + enOct.tiene, 2)
      expect(s.diferencia).toBeCloseTo(enSep.diferencia + enOct.diferencia, 2)
    }
    // En octubre corre la cuota 2 de 8 de CapCut (Flor y Dol).
    expect(oct.cuotas.map(c => c.numero)).toEqual([2, 2])
  })
})

// Los trabajos por fuera de septiembre: las páginas de Flor y el brunch de Valen,
// 50 % para quien lo hizo y 25 % para cada uno de los otros dos (gastos incluidos).
describe('trabajos por fuera', () => {
  const cuentasConGalicia = [...cuentas, { id: 'gal', nombre: 'Flor Caja Ahorro Galicia' }]
  const trabajosSep = [
    { ...mov('gal', 'ingreso', 150000), id: 'pag1' },
    { ...mov('gal', 'ingreso', 60, 'USD'), id: 'pag2' },
    { ...mov('mc', 'gasto', 10, 'USD'), id: 'dom' },
    { ...mov('rev', 'ingreso', 150, 'EUR'), id: 'brunch' },
    { ...mov('rev', 'gasto', 75, 'EUR'), id: 'video' },
  ]
  const deFlor = porcentajesTrabajo('Flor', socios, 50)
  const deValen = porcentajesTrabajo('Valen', socios, 50)
  const trabajos = [
    { movimientoId: 'pag1', porcentajes: deFlor }, { movimientoId: 'pag2', porcentajes: deFlor },
    { movimientoId: 'dom', porcentajes: deFlor },
    { movimientoId: 'brunch', porcentajes: deValen }, { movimientoId: 'video', porcentajes: deValen },
  ]

  test('el que lo hizo se queda con el 50 % y el resto va parejo', () => {
    expect(deFlor).toEqual({ Flor: 50, Valen: 25, Dol: 25 })
    expect(fraccionesDeReparto({ Flor: 2, Valen: 1, Dol: 1 }, socios)).toEqual({ Flor: 0.5, Valen: 0.25, Dol: 0.25 })
    expect(fraccionesDeReparto({ Nadie: 100 }, socios)).toBe(null)
  })

  test('septiembre con las páginas de Flor y el brunch de Valen', () => {
    const r = calcularReparto({
      socios, cuentas: cuentasConGalicia, movimientos: [...septiembre, ...trabajosSep], transferencias,
      cotizaciones: { USD: 1550, EUR: 1721 }, cuotas: [capcut], mes: '2026-09', trabajos,
    })
    // La parte común no cambia: los trabajos se reparten aparte.
    expect(r.parte).toBeCloseTo(555272.5, 2)
    const porSocio = Object.fromEntries(r.porSocio.map(s => [s.socio, s]))
    expect(porSocio.Flor.leToca).toBeCloseTo(679778.75, 2)
    expect(porSocio.Valen.leToca).toBeCloseTo(719710, 2)
    expect(porSocio.Dol.leToca).toBeCloseTo(622903.75, 2)
    // Lo que le toca a cada uno suma exactamente todo lo que hay.
    expect(r.porSocio.reduce((s, x) => s + x.leToca, 0)).toBeCloseTo(r.neto, 2)
    expect(r.pagos).toEqual([
      { de: 'Dol', a: 'Valen', monto: 794120 },
      { de: 'Dol', a: 'Flor', monto: 318976 },
    ])
  })

  test('un movimiento en cuotas no se reparte además como trabajo', () => {
    const r = calcularReparto({
      socios, cuentas, movimientos: septiembre, transferencias, cotizaciones: { USD: 1560, EUR: 1750 },
      cuotas: [capcut], mes: '2026-09', trabajos: [{ movimientoId: 'capcut', porcentajes: deValen }],
    })
    expect(r.netoTrabajos).toBeCloseTo(0, 6)
  })
})
