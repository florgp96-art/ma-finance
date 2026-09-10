const {
  signoEnSaldo, enLaCuenta, ultimaAncla, saldoDeCuenta, desvioDeAncla,
} = require('./saldos')

const CA = 'caja-ahorro'
const ancla = (fecha, saldo, extra = {}) => ({ id: `a-${fecha}`, account_id: CA, moneda: 'ARS', fecha, saldo, ...extra })
const mov = (fecha, monto, tipo, extra = {}) => ({ account_id: CA, fecha, monto, tipo, moneda: 'ARS', ...extra })

describe('signoEnSaldo', () => {
  test('un gasto sale y un ingreso entra', () => {
    expect(signoEnSaldo({ tipo: 'gasto' })).toBe(-1)
    expect(signoEnSaldo({ tipo: 'ingreso' })).toBe(1)
  })

  test('un pago de tarjeta es neutro pero sale de la cuenta igual', () => {
    expect(signoEnSaldo({ tipo: 'neutro', nombre: 'Pago Mastercard' })).toBe(-1)
  })

  test('un plazo fijo sale y su rescate vuelve a entrar', () => {
    expect(signoEnSaldo({ tipo: 'neutro', nombre: 'Constitución plazo fijo' })).toBe(-1)
    expect(signoEnSaldo({ tipo: 'neutro', nombre: 'Rescate FIMA Premium' })).toBe(1)
    expect(signoEnSaldo({ tipo: 'neutro', detalle: 'ACREDITACION PLAZO FIJO' })).toBe(1)
  })
})

describe('en qué cuenta cuenta un movimiento', () => {
  test('un gasto cuenta en la cuenta donde se hizo', () => {
    expect(enLaCuenta(mov('2026-09-05', 1000, 'gasto'), CA)).toBe(true)
    expect(enLaCuenta(mov('2026-09-05', 1000, 'gasto'), 'otra')).toBe(false)
  })

  // Al importar un extracto, el ingreso se guarda en la cuenta "Ingresos" para que
  // los gráficos lo agrupen — pero la plata entró a la caja de ahorro.
  test('un ingreso importado cuenta en la cuenta que recibió la plata', () => {
    const sueldo = { account_id: 'ingresos', cuenta_destino_id: CA, tipo: 'ingreso', fecha: '2026-09-05', monto: 100 }
    expect(enLaCuenta(sueldo, CA)).toBe(true)
    expect(enLaCuenta(sueldo, 'ingresos')).toBe(false)
  })

  test('un ingreso cargado a mano usa la cuenta que eligió el usuario', () => {
    const manual = { account_id: CA, tipo: 'ingreso', fecha: '2026-09-05', monto: 100 }
    expect(enLaCuenta(manual, CA)).toBe(true)
  })
})

describe('saldo a partir del ancla', () => {
  test('sin ancla no hay saldo — la app no lo inventa', () => {
    expect(saldoDeCuenta({ anclas: [], transactions: [mov('2026-09-05', 1000, 'gasto')], accountId: CA })).toBeNull()
  })

  test('suma ingresos y resta gastos y pagos posteriores al ancla', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-09-01', 500000)],
      transactions: [
        mov('2026-09-03', 120000, 'ingreso'),
        mov('2026-09-04', 30000, 'gasto'),
        mov('2026-09-05', 100000, 'neutro', { nombre: 'Pago Mastercard' }),
      ],
      accountId: CA,
    })
    expect(r.saldo).toBe(490000)
    expect(r.entradas).toBe(120000)
    expect(r.salidas).toBe(130000)
    expect(r.cantidadMovimientos).toBe(3)
  })

  test('lo del mismo día del ancla ya está adentro: no se cuenta de nuevo', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-09-01', 500000)],
      transactions: [mov('2026-09-01', 90000, 'gasto'), mov('2026-09-02', 10000, 'gasto')],
      accountId: CA,
    })
    expect(r.saldo).toBe(490000)
  })

  test('lo anterior al ancla tampoco cuenta', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-09-01', 500000)],
      transactions: [mov('2026-08-15', 300000, 'gasto')],
      accountId: CA,
    })
    expect(r.saldo).toBe(500000)
  })

  test('una moneda no se mezcla con la otra', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-09-01', 500000), { ...ancla('2026-09-01', 1200), moneda: 'USD', id: 'usd' }],
      transactions: [mov('2026-09-03', 200, 'gasto', { moneda: 'USD' }), mov('2026-09-03', 50000, 'gasto')],
      accountId: CA,
      moneda: 'USD',
    })
    expect(r.saldo).toBe(1000)
  })

  test('el ancla vigente es la última, y las anteriores quedan atrás', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-08-01', 999999), ancla('2026-09-01', 500000)],
      transactions: [mov('2026-08-15', 400000, 'gasto'), mov('2026-09-02', 10000, 'gasto')],
      accountId: CA,
    })
    expect(r.ancla.fecha).toBe('2026-09-01')
    expect(r.saldo).toBe(490000)
  })

  test('el resultado no depende del orden en que llegaron las anclas', () => {
    const anclas = [ancla('2026-09-01', 500000), ancla('2026-08-01', 999999)]
    const dir = saldoDeCuenta({ anclas, transactions: [], accountId: CA })
    const inv = saldoDeCuenta({ anclas: [...anclas].reverse(), transactions: [], accountId: CA })
    expect(dir.saldo).toBe(inv.saldo)
    expect(dir.ancla.fecha).toBe('2026-09-01')
  })
})

describe('ultimaAncla', () => {
  test('acotada a una fecha, ignora las posteriores', () => {
    const encontrada = ultimaAncla([ancla('2026-08-01', 100), ancla('2026-09-10', 200)], CA, 'ARS', '2026-09-01')
    expect(encontrada.fecha).toBe('2026-08-01')
  })

  test('no devuelve el ancla de otra cuenta', () => {
    expect(ultimaAncla([{ ...ancla('2026-09-01', 100), account_id: 'otra' }], CA)).toBeNull()
  })
})

describe('desvío al cargar una nueva ancla', () => {
  const estimado = saldoDeCuenta({
    anclas: [ancla('2026-09-01', 500000)],
    transactions: [mov('2026-09-04', 30000, 'gasto')],
    accountId: CA,
  })

  test('si coincide con lo calculado, no falta nada', () => {
    expect(desvioDeAncla(470000, estimado)).toBe(0)
  })

  test('si hay menos plata de la calculada, falta cargar gastos', () => {
    expect(desvioDeAncla(450000, estimado)).toBe(-20000)
  })

  test('si hay más plata de la calculada, sobra algo cargado o falta un ingreso', () => {
    expect(desvioDeAncla(480000, estimado)).toBe(10000)
  })

  test('la primera ancla de una cuenta no tiene desvío', () => {
    expect(desvioDeAncla(500000, null)).toBeNull()
  })
})
