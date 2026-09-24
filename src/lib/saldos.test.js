const {
  signoEnSaldo, enLaCuenta, ultimaAncla, saldoDeCuenta, desvioDeAncla, pagosDeTarjetaDesde,
  saldoTotal, tieneSaldo, monedaDeLaCuenta, sentidoPorTipo, sentidoDelExtracto,
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

  // El extracto escribe lo mismo en las dos cuentas de una venta de dólares: por el
  // texto, la cuenta que recibe los pesos restaba.
  test('un neutro con sentido le gana al texto', () => {
    expect(signoEnSaldo({ tipo: 'neutro', detalle: 'VENTA MONEDA EXTRANJERA', sentido: 'entra' })).toBe(1)
    expect(signoEnSaldo({ tipo: 'neutro', detalle: 'VENTA MONEDA EXTRANJERA', sentido: 'sale' })).toBe(-1)
    expect(signoEnSaldo({ tipo: 'neutro', detalle: 'DEPOSITO A PLAZO FIJO', sentido: 'sale' })).toBe(-1)
  })

  test('sin sentido, un neutro se sigue decidiendo por el texto', () => {
    expect(signoEnSaldo({ tipo: 'neutro', detalle: 'VENTA MONEDA EXTRANJERA', sentido: null })).toBe(-1)
  })

  test('el sentido no cambia un gasto ni un ingreso', () => {
    expect(signoEnSaldo({ tipo: 'gasto', sentido: 'entra' })).toBe(-1)
    expect(signoEnSaldo({ tipo: 'ingreso', sentido: 'sale' })).toBe(1)
  })
})

describe('sentido de un movimiento', () => {
  test('el tipo lo dice para gasto e ingreso, no para un neutro', () => {
    expect(sentidoPorTipo('ingreso')).toBe('entra')
    expect(sentidoPorTipo('gasto')).toBe('sale')
    expect(sentidoPorTipo('neutro')).toBe(null)
  })

  test('del extracto: un neutro solo entra si la IA dijo que es un crédito', () => {
    expect(sentidoDelExtracto({ tipo: 'ingreso' })).toBe('entra')
    expect(sentidoDelExtracto({ tipo: 'gasto', es_credito: true })).toBe('sale')
    expect(sentidoDelExtracto({ tipo: 'neutro', es_credito: true })).toBe('entra')
    // false es el valor por defecto: no prueba que la plata haya salido.
    expect(sentidoDelExtracto({ tipo: 'neutro', es_credito: false })).toBe(null)
    expect(sentidoDelExtracto(null)).toBe(null)
  })
})

describe('en qué cuenta cuenta un movimiento', () => {
  test('un gasto cuenta en la cuenta donde se hizo', () => {
    expect(enLaCuenta(mov('2026-09-05', 1000, 'gasto'), CA)).toBe(true)
    expect(enLaCuenta(mov('2026-09-05', 1000, 'gasto'), 'otra')).toBe(false)
  })

  // Un ingreso vive en la cuenta que recibió la plata, venga de un extracto o
  // cargado a mano. La cuenta "Ingresos" es una vista que los junta todos, no el
  // lugar donde viven.
  test('un ingreso cuenta en la cuenta que recibió la plata', () => {
    const sueldo = { account_id: CA, tipo: 'ingreso', fecha: '2026-09-05', monto: 100 }
    expect(enLaCuenta(sueldo, CA)).toBe(true)
    expect(enLaCuenta(sueldo, 'ingresos')).toBe(false)
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

// Pagar la tarjeta saca plata de la caja de ahorro, pero la app guarda el pago como
// un neutro en la cuenta de crédito. Sin esto, la caja de ahorro no se enteraba nunca
// y su saldo quedaba de más por el monto más grande del mes.
describe('los pagos de tarjeta salen de la cuenta que la paga', () => {
  const CARD = 'mastercard'
  const cuentas = [
    { id: CA, tipo: 'debito', nombre: 'Caja de ahorro' },
    { id: CARD, tipo: 'credito', nombre: 'Mastercard', cuenta_pago_id: CA },
  ]
  const pagoEnTarjeta = (fecha, monto, nombre = 'Pago Mastercard', extra = {}) =>
    ({ account_id: CARD, tipo: 'neutro', fecha, monto, moneda: 'ARS', nombre, ...extra })

  test('el pago baja el saldo de la caja de ahorro', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-08-31', 3000000)],
      transactions: [pagoEnTarjeta('2026-09-01', 1465058.14), pagoEnTarjeta('2026-09-01', 500000)],
      accounts: cuentas,
      accountId: CA,
    })
    expect(r.pagosDeTarjeta).toBe(1965058.14)
    expect(r.saldo).toBe(1034941.86)
  })

  test('una tarjeta que se paga desde otra cuenta no toca esta', () => {
    const otras = [cuentas[0], { ...cuentas[1], cuenta_pago_id: 'otra-cuenta' }]
    const r = saldoDeCuenta({
      anclas: [ancla('2026-08-31', 3000000)],
      transactions: [pagoEnTarjeta('2026-09-01', 500000)],
      accounts: otras,
      accountId: CA,
    })
    expect(r.pagosDeTarjeta).toBe(0)
    expect(r.saldo).toBe(3000000)
  })

  test('sin cuenta_pago_id configurada no se le atribuye a nadie', () => {
    const sinConfigurar = [cuentas[0], { id: CARD, tipo: 'credito', nombre: 'Mastercard' }]
    const r = saldoDeCuenta({
      anclas: [ancla('2026-08-31', 3000000)],
      transactions: [pagoEnTarjeta('2026-09-01', 500000)],
      accounts: sinConfigurar,
      accountId: CA,
    })
    expect(r.saldo).toBe(3000000)
  })

  // Si además se importa el extracto del banco, el mismo pago entra dos veces:
  // como neutro en la tarjeta y como "PAGO TARJETA" en la caja de ahorro.
  test('si el extracto del banco ya lo trajo, se resta una sola vez', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-08-31', 3000000)],
      transactions: [
        pagoEnTarjeta('2026-09-01', 500000),
        mov('2026-09-01', 500000, 'neutro', { nombre: 'PAGO TARJETA VISA' }),
      ],
      accounts: cuentas,
      accountId: CA,
    })
    expect(r.saldo).toBe(2500000)
  })

  test('empareja aunque el banco y el resumen lo fechen distinto', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-08-31', 3000000)],
      transactions: [
        pagoEnTarjeta('2026-09-03', 500000),
        mov('2026-09-01', 500000, 'neutro', { nombre: 'Pago tarjeta' }),
      ],
      accounts: cuentas,
      accountId: CA,
    })
    expect(r.saldo).toBe(2500000)
  })

  test('cada línea del extracto cancela un solo pago, no todos los iguales', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-08-31', 3000000)],
      transactions: [
        pagoEnTarjeta('2026-09-01', 500000),
        pagoEnTarjeta('2026-09-01', 500000),
        mov('2026-09-01', 500000, 'neutro', { nombre: 'Pago tarjeta' }),
      ],
      accounts: cuentas,
      accountId: CA,
    })
    // Dos pagos reales de $500.000; el extracto trajo uno. Se restan los dos, una vez cada uno.
    expect(r.saldo).toBe(2000000)
  })

  test('un neutro que no es pago de tarjeta no cancela un pago', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-08-31', 3000000)],
      transactions: [
        pagoEnTarjeta('2026-09-01', 500000),
        mov('2026-09-01', 500000, 'neutro', { nombre: 'Constitución plazo fijo' }),
      ],
      accounts: cuentas,
      accountId: CA,
    })
    // Son dos salidas distintas que casualmente coinciden en monto y día.
    expect(r.saldo).toBe(2000000)
  })

  test('el pago en dólares no baja el saldo en pesos', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-08-31', 3000000)],
      transactions: [pagoEnTarjeta('2026-09-01', 103.65, 'Pago Tarjeta', { moneda: 'USD' })],
      accounts: cuentas,
      accountId: CA,
    })
    expect(r.saldo).toBe(3000000)
  })

  test('los pagos anteriores al ancla ya están en el saldo que cargó el usuario', () => {
    const r = saldoDeCuenta({
      anclas: [ancla('2026-09-05', 1000000)],
      transactions: [pagoEnTarjeta('2026-09-01', 500000)],
      accounts: cuentas,
      accountId: CA,
    })
    expect(r.saldo).toBe(1000000)
  })

  test('sin tarjetas asociadas devuelve lista vacía', () => {
    expect(pagosDeTarjetaDesde({
      transactions: [pagoEnTarjeta('2026-09-01', 500000)],
      accounts: [cuentas[0]], accountId: CA, moneda: 'ARS', desde: '2026-08-31',
    })).toEqual([])
  })

  // Mercado Pago (y otras) se pueden pagar en dos monedas desde dos cuentas
  // distintas: la parte en pesos de una caja de ahorro en pesos, la parte en
  // dólares de una caja de ahorro en dólares. Un solo cuenta_pago_id no alcanza.
  describe('la misma tarjeta pagada en dos monedas desde dos cuentas', () => {
    const CA_USD = 'caja-ahorro-usd'
    const dosCuentas = [
      { id: CA, tipo: 'debito', nombre: 'Caja de ahorro' },
      { id: CA_USD, tipo: 'debito', nombre: 'Caja de ahorro USD' },
      { id: CARD, tipo: 'credito', nombre: 'Mercado Pago', cuenta_pago_id: CA, cuenta_pago_id_usd: CA_USD },
    ]

    test('el pago en pesos baja la cuenta en pesos', () => {
      const r = saldoDeCuenta({
        anclas: [ancla('2026-08-31', 3000000)],
        transactions: [pagoEnTarjeta('2026-09-01', 500000)],
        accounts: dosCuentas,
        accountId: CA,
      })
      expect(r.pagosDeTarjeta).toBe(500000)
      expect(r.saldo).toBe(2500000)
    })

    test('el pago en dólares baja la cuenta en dólares, no la de pesos', () => {
      const rArs = saldoDeCuenta({
        anclas: [ancla('2026-08-31', 3000000)],
        transactions: [pagoEnTarjeta('2026-09-01', 103.65, 'Pago Tarjeta', { moneda: 'USD' })],
        accounts: dosCuentas,
        accountId: CA,
      })
      expect(rArs.pagosDeTarjeta).toBe(0)
      expect(rArs.saldo).toBe(3000000)

      const rUsd = saldoDeCuenta({
        anclas: [{ ...ancla('2026-08-31', 1000), account_id: CA_USD, moneda: 'USD', id: 'usd' }],
        transactions: [pagoEnTarjeta('2026-09-01', 103.65, 'Pago Tarjeta', { moneda: 'USD' })],
        accounts: dosCuentas,
        accountId: CA_USD,
        moneda: 'USD',
      })
      expect(rUsd.pagosDeTarjeta).toBe(103.65)
      expect(rUsd.saldo).toBe(896.35)
    })
  })
})

// El "Balance de caja" del resumen mensual es un FLUJO (cuánto entró y salió este
// mes) y el saldo es un STOCK (cuánta plata hay). saldoTotal es lo que conecta las
// dos vistas: sale de las mismas anclas que la card de cada cuenta, así que las dos
// pantallas no pueden discrepar.
describe('saldoTotal — la plata que hay sumando todas las cuentas', () => {
  const EFE = 'efectivo'
  const cuentas = [
    { id: CA, nombre: 'Caja de ahorro', tipo: 'debito' },
    { id: EFE, nombre: 'Efectivo', tipo: 'efectivo' },
  ]
  const anclaDe = (accountId, fecha, saldo, moneda = 'ARS') =>
    ({ id: `${accountId}-${moneda}-${fecha}`, account_id: accountId, moneda, fecha, saldo })

  test('suma las cuentas y no convierte monedas', () => {
    const r = saldoTotal({
      anclas: [anclaDe(CA, '2026-09-01', 500000), anclaDe(CA, '2026-09-01', 1200, 'USD'), anclaDe(EFE, '2026-09-01', 80000)],
      transactions: [],
      accounts: cuentas,
    })
    expect(r.porMoneda).toEqual([{ moneda: 'ARS', saldo: 580000 }, { moneda: 'USD', saldo: 1200 }])
  })

  test('descuenta los movimientos posteriores a cada ancla', () => {
    const r = saldoTotal({
      anclas: [anclaDe(CA, '2026-09-01', 500000), anclaDe(EFE, '2026-09-01', 80000)],
      transactions: [
        { id: 'g1', account_id: CA, tipo: 'gasto', fecha: '2026-09-04', monto: 30000, moneda: 'ARS' },
        { id: 'g2', account_id: EFE, tipo: 'gasto', fecha: '2026-09-05', monto: 5000, moneda: 'ARS' },
      ],
      accounts: cuentas,
    })
    expect(r.porMoneda).toEqual([{ moneda: 'ARS', saldo: 545000 }])
  })

  test('el pago de tarjeta baja del total, igual que en la card de la cuenta', () => {
    const tarjeta = { id: 'mc', nombre: 'Mastercard', tipo: 'credito', cuenta_pago_id: CA }
    const r = saldoTotal({
      anclas: [anclaDe(CA, '2026-08-31', 3000000)],
      transactions: [{ id: 'p1', account_id: 'mc', tipo: 'neutro', fecha: '2026-09-01', monto: 500000, moneda: 'ARS', nombre: 'Pago Mastercard' }],
      accounts: [...cuentas, tarjeta],
    })
    expect(r.porMoneda).toEqual([{ moneda: 'ARS', saldo: 2500000 }])
  })

  // Un total al que le falta una cuenta no se puede mostrar como si estuviera
  // completo: es la diferencia entre "tenés esto" y "de lo que cargaste, tenés esto".
  test('nombra las cuentas que todavía no tienen saldo cargado', () => {
    const r = saldoTotal({
      anclas: [anclaDe(CA, '2026-09-01', 500000)],
      transactions: [],
      accounts: cuentas,
    })
    expect(r.porMoneda).toEqual([{ moneda: 'ARS', saldo: 500000 }])
    expect(r.sinSaldoCargado.map(c => c.nombre)).toEqual(['Efectivo'])
  })

  test('una tarjeta no cuenta como cuenta sin saldo: no lleva saldo nunca', () => {
    const r = saldoTotal({
      anclas: [anclaDe(CA, '2026-09-01', 500000), anclaDe(EFE, '2026-09-01', 1000)],
      transactions: [],
      accounts: [...cuentas, { id: 'mc', nombre: 'Mastercard', tipo: 'credito' }],
    })
    expect(r.sinSaldoCargado).toEqual([])
  })

  test('acotado a una fecha, ignora lo posterior', () => {
    const r = saldoTotal({
      anclas: [anclaDe(CA, '2026-09-01', 500000)],
      transactions: [{ id: 'g1', account_id: CA, tipo: 'gasto', fecha: '2026-09-20', monto: 100000, moneda: 'ARS' }],
      accounts: [cuentas[0]],
      hasta: '2026-09-10',
    })
    expect(r.porMoneda).toEqual([{ moneda: 'ARS', saldo: 500000 }])
  })

  test('sin ninguna cuenta con saldo cargado no inventa un total', () => {
    const r = saldoTotal({ anclas: [], transactions: [], accounts: cuentas })
    expect(r.porMoneda).toEqual([])
    expect(r.detalle).toEqual([])
    expect(r.sinSaldoCargado).toHaveLength(2)
  })

  test('el detalle dice cuánto hay en cada cuenta', () => {
    const r = saldoTotal({
      anclas: [anclaDe(CA, '2026-09-01', 500000), anclaDe(EFE, '2026-09-01', 80000)],
      transactions: [],
      accounts: cuentas,
    })
    expect(r.detalle).toEqual([
      { account_id: CA, nombre: 'Caja de ahorro', moneda: 'ARS', saldo: 500000 },
      { account_id: EFE, nombre: 'Efectivo', moneda: 'ARS', saldo: 80000 },
    ])
  })
})

describe('tieneSaldo (ahora en lib)', () => {
  test('caja de ahorro y efectivo sí; tarjeta e Ingresos no', () => {
    expect(tieneSaldo({ tipo: 'debito' })).toBe(true)
    expect(tieneSaldo({ tipo: 'efectivo' })).toBe(true)
    expect(tieneSaldo({ tipo: 'credito' })).toBe(false)
    expect(tieneSaldo({ tipo: 'ingreso' })).toBe(false)
  })
})

// Cargar U$S 33 con el selector en "$" guardaba un ancla en pesos, y ese saldo se
// sumaba al total en pesos sin que se viera el error. Caso real: "Caja de Ahorro USD
// Galicia — $ 33" sumando dentro de $ 72.998.
describe('monedaDeLaCuenta — con qué moneda arranca el formulario de saldo', () => {
  const cuentaUSD = { id: 'ca-usd', nombre: 'Caja de Ahorro USD Galicia', tipo: 'debito' }

  test('la decide los movimientos de la cuenta, que es el dato real', () => {
    const r = monedaDeLaCuenta({
      account: cuentaUSD,
      transactions: [
        { account_id: 'ca-usd', moneda: 'USD', monto: 100 },
        { account_id: 'ca-usd', moneda: 'USD', monto: 50 },
        { account_id: 'ca-usd', moneda: 'ARS', monto: 10 },
      ],
    })
    expect(r).toBe('USD')
  })

  test('no mira los movimientos de otras cuentas', () => {
    const r = monedaDeLaCuenta({
      account: cuentaUSD,
      transactions: [{ account_id: 'otra', moneda: 'ARS', monto: 999999 }],
    })
    // Sin movimientos propios cae al nombre, que dice USD.
    expect(r).toBe('USD')
  })

  test('sin movimientos, el nombre es la pista', () => {
    expect(monedaDeLaCuenta({ account: cuentaUSD, transactions: [] })).toBe('USD')
    expect(monedaDeLaCuenta({ account: { nombre: 'Cuenta en dólares' }, transactions: [] })).toBe('USD')
    expect(monedaDeLaCuenta({ account: { nombre: 'Ahorro EUR' }, transactions: [] })).toBe('EUR')
  })

  test('una caja de ahorro común arranca en pesos', () => {
    expect(monedaDeLaCuenta({ account: { id: 'ca', nombre: 'Caja de Ahorro Galicia' }, transactions: [] })).toBe('ARS')
    expect(monedaDeLaCuenta({ account: { nombre: 'Efectivo' }, transactions: [] })).toBe('ARS')
  })

  test('sin cuenta ni movimientos no se rompe', () => {
    expect(monedaDeLaCuenta({})).toBe('ARS')
  })

  test('empatadas, el resultado no depende del orden de las filas', () => {
    const txs = [
      { account_id: 'ca', moneda: 'USD', monto: 1 },
      { account_id: 'ca', moneda: 'ARS', monto: 1 },
    ]
    const a = monedaDeLaCuenta({ account: { id: 'ca', nombre: 'X' }, transactions: txs })
    const b = monedaDeLaCuenta({ account: { id: 'ca', nombre: 'X' }, transactions: [...txs].reverse() })
    expect(a).toBe(b)
  })
})

// El bug tal como se vio en pantalla: el ancla en la moneda equivocada hace que un
// saldo en dólares se sume al total en pesos.
describe('un ancla en la moneda equivocada no puede pasar desapercibida', () => {
  const cuentas = [
    { id: 'efe', nombre: 'Efectivo', tipo: 'efectivo' },
    { id: 'ca', nombre: 'Caja de Ahorro Galicia', tipo: 'debito' },
    { id: 'ca-usd', nombre: 'Caja de Ahorro USD Galicia', tipo: 'debito' },
  ]

  test('así se veía el $ 72.998: los 33 dólares sumados como pesos', () => {
    const r = saldoTotal({
      anclas: [
        { id: '1', account_id: 'efe', moneda: 'ARS', fecha: '2026-09-10', saldo: 42100 },
        { id: '2', account_id: 'ca', moneda: 'ARS', fecha: '2026-09-10', saldo: 30865 },
        { id: '3', account_id: 'ca-usd', moneda: 'ARS', fecha: '2026-09-10', saldo: 33 },
      ],
      transactions: [], accounts: cuentas,
    })
    expect(r.porMoneda).toEqual([{ moneda: 'ARS', saldo: 72998 }])
  })

  test('con el ancla en dólares, cada moneda queda en su total', () => {
    const r = saldoTotal({
      anclas: [
        { id: '1', account_id: 'efe', moneda: 'ARS', fecha: '2026-09-10', saldo: 42100 },
        { id: '2', account_id: 'ca', moneda: 'ARS', fecha: '2026-09-10', saldo: 30865 },
        { id: '3', account_id: 'ca-usd', moneda: 'USD', fecha: '2026-09-10', saldo: 33 },
      ],
      transactions: [], accounts: cuentas,
    })
    expect(r.porMoneda).toEqual([{ moneda: 'ARS', saldo: 72965 }, { moneda: 'USD', saldo: 33 }])
  })
})

// El motivo por el que el saldo se veía "estático": uno pone "hoy tengo $X" y
// enseguida carga los gastos del día, y con la fecha sola esos gastos no contaban
// nunca. El saldo quedaba clavado en el número tipeado.
describe('un movimiento del mismo día que el ancla', () => {
  const ancla10 = { id: 'a1', account_id: CA, moneda: 'ARS', fecha: '2026-09-10', saldo: 500000, created_at: '2026-09-10T10:00:00Z' }
  const gastoEseDia = (created_at) =>
    ({ id: 'g1', account_id: CA, tipo: 'gasto', fecha: '2026-09-10', monto: 30000, moneda: 'ARS', created_at })

  test('cuenta si se cargó DESPUÉS de poner el saldo', () => {
    const r = saldoDeCuenta({
      anclas: [ancla10], transactions: [gastoEseDia('2026-09-10T11:00:00Z')], accountId: CA,
    })
    expect(r.saldo).toBe(470000)
    expect(r.cantidadMovimientos).toBe(1)
  })

  test('no cuenta si ya estaba cargado cuando se puso el saldo', () => {
    const r = saldoDeCuenta({
      anclas: [ancla10], transactions: [gastoEseDia('2026-09-10T09:00:00Z')], accountId: CA,
    })
    expect(r.saldo).toBe(500000)
    expect(r.cantidadMovimientos).toBe(0)
  })

  test('sin created_at se cae al criterio de solo fecha, como antes', () => {
    const r = saldoDeCuenta({
      anclas: [ancla10], transactions: [gastoEseDia(undefined)], accountId: CA,
    })
    expect(r.saldo).toBe(500000)
  })

  // Lo importante del límite: un movimiento con fecha ANTERIOR no cuenta nunca,
  // aunque se cargue después. Si importás hoy el resumen de agosto, esa plata ya
  // salió antes de que contaras y ya está descontada en el saldo que pusiste.
  test('un movimiento más viejo no cuenta ni cargándolo después', () => {
    const r = saldoDeCuenta({
      anclas: [ancla10],
      transactions: [{ id: 'g2', account_id: CA, tipo: 'gasto', fecha: '2026-08-15', monto: 900000, moneda: 'ARS', created_at: '2026-09-14T12:00:00Z' }],
      accountId: CA,
    })
    expect(r.saldo).toBe(500000)
  })

  test('un pago de tarjeta del mismo día también cuenta si se cargó después', () => {
    const tarjeta = { id: 'mc', nombre: 'Mastercard', tipo: 'credito', cuenta_pago_id: CA }
    const r = saldoDeCuenta({
      anclas: [ancla10],
      transactions: [{ id: 'p1', account_id: 'mc', tipo: 'neutro', fecha: '2026-09-10', monto: 100000, moneda: 'ARS', nombre: 'Pago Mastercard', created_at: '2026-09-10T18:00:00Z' }],
      accounts: [{ id: CA, tipo: 'debito' }, tarjeta],
      accountId: CA,
    })
    expect(r.saldo).toBe(400000)
  })

  test('un movimiento posterior cuenta siempre, con o sin created_at', () => {
    const r = saldoDeCuenta({
      anclas: [ancla10],
      transactions: [{ id: 'g3', account_id: CA, tipo: 'gasto', fecha: '2026-09-12', monto: 20000, moneda: 'ARS' }],
      accountId: CA,
    })
    expect(r.saldo).toBe(480000)
  })
})
