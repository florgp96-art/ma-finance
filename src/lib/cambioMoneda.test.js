const { armarCambioDeMoneda, tipoDeCambioImplicito, pareceCambioDeMoneda } = require('./cambioMoneda')
const { saldoDeCuenta } = require('./saldos')

const USD = 'caja-usd'
const ARS = 'caja-pesos'
const venta = (extra = {}) => ({
  userId: 'u1',
  fecha: '2026-09-24',
  origen: { accountId: USD, moneda: 'USD', monto: '181' },
  destino: { accountId: ARS, moneda: 'ARS', monto: '262450' },
  ...extra,
})

describe('armarCambioDeMoneda', () => {
  test('una venta de dólares son dos neutros: sale U$S de una cuenta, entran $ en otra', () => {
    const { movimientos, error } = armarCambioDeMoneda(venta())
    expect(error).toBeUndefined()
    const [sale, entra] = movimientos
    expect(sale).toMatchObject({ account_id: USD, moneda: 'USD', monto: 181, tipo: 'neutro', sentido: 'sale', user_id: 'u1', fecha: '2026-09-24' })
    expect(entra).toMatchObject({ account_id: ARS, moneda: 'ARS', monto: 262450, tipo: 'neutro', sentido: 'entra' })
    expect(sale.nombre).toBe(entra.nombre)
  })

  test('la pata en dólares guarda el tipo de cambio real de la operación', () => {
    const { movimientos: [sale, entra] } = armarCambioDeMoneda(venta({ tipoCambioUSD: 1500 }))
    expect(sale.fx_rate).toBe(1450)
    expect(entra.fx_rate).toBe(null)
  })

  test('sin pesos del otro lado, la pata en dólares usa el tipo de cambio de referencia', () => {
    const { movimientos: [, entra] } = armarCambioDeMoneda(venta({
      origen: { accountId: 'caja-eur', moneda: 'EUR', monto: 100 },
      destino: { accountId: USD, moneda: 'USD', monto: 108 },
      tipoCambioUSD: 1500,
    }))
    expect(entra.fx_rate).toBe(1500)
  })

  test('sin la columna en la base no manda sentido, y el texto sigue dando bien', () => {
    const { movimientos: [sale, entra] } = armarCambioDeMoneda(venta({ conSentido: false }))
    expect(sale).not.toHaveProperty('sentido')
    expect(entra).not.toHaveProperty('sentido')
    const anclas = [
      { id: 'a1', account_id: USD, moneda: 'USD', fecha: '2026-09-01', saldo: 500 },
      { id: 'a2', account_id: ARS, moneda: 'ARS', fecha: '2026-09-01', saldo: 10000 },
    ]
    const transactions = [sale, entra]
    expect(saldoDeCuenta({ anclas, transactions, accountId: USD, moneda: 'USD' }).saldo).toBe(319)
    expect(saldoDeCuenta({ anclas, transactions, accountId: ARS, moneda: 'ARS' }).saldo).toBe(272450)
  })

  test('mueve los dos saldos con la columna', () => {
    const { movimientos } = armarCambioDeMoneda(venta())
    const anclas = [
      { id: 'a1', account_id: USD, moneda: 'USD', fecha: '2026-09-01', saldo: 500 },
      { id: 'a2', account_id: ARS, moneda: 'ARS', fecha: '2026-09-01', saldo: 10000 },
    ]
    expect(saldoDeCuenta({ anclas, transactions: movimientos, accountId: USD, moneda: 'USD' }).saldo).toBe(319)
    expect(saldoDeCuenta({ anclas, transactions: movimientos, accountId: ARS, moneda: 'ARS' }).saldo).toBe(272450)
  })

  // Una billetera como Mercado Pago tiene saldo en pesos y en dólares.
  test('las dos patas pueden ser la misma cuenta, en monedas distintas', () => {
    const { movimientos, error } = armarCambioDeMoneda(venta({ destino: { accountId: USD, moneda: 'ARS', monto: 262450 } }))
    expect(error).toBeUndefined()
    expect(movimientos.map(m => [m.account_id, m.moneda])).toEqual([[USD, 'USD'], [USD, 'ARS']])
  })

  // Del efectivo a la caja de ahorro, en pesos: la misma plata en otra cuenta.
  test('con la misma moneda es una transferencia: sale de una cuenta y entra en la otra por el mismo monto', () => {
    const { movimientos, error } = armarCambioDeMoneda(venta({
      origen: { accountId: 'efectivo', moneda: 'ARS', monto: '478000', nombre: 'Efectivo' },
      destino: { accountId: ARS, moneda: 'ARS', monto: '', nombre: 'Caja de Ahorro Galicia' },
    }))
    expect(error).toBeUndefined()
    const [sale, entra] = movimientos
    expect(sale).toMatchObject({ account_id: 'efectivo', moneda: 'ARS', monto: 478000, tipo: 'neutro', sentido: 'sale', nombre: 'Transferencia a Caja de Ahorro Galicia', fx_rate: null })
    expect(entra).toMatchObject({ account_id: ARS, moneda: 'ARS', monto: 478000, tipo: 'neutro', sentido: 'entra', nombre: 'Transferencia desde Efectivo' })
    const anclas = [
      { id: 'a1', account_id: 'efectivo', moneda: 'ARS', fecha: '2026-09-01', saldo: 500000 },
      { id: 'a2', account_id: ARS, moneda: 'ARS', fecha: '2026-09-01', saldo: 10000 },
    ]
    expect(saldoDeCuenta({ anclas, transactions: movimientos, accountId: 'efectivo' }).saldo).toBe(22000)
    expect(saldoDeCuenta({ anclas, transactions: movimientos, accountId: ARS }).saldo).toBe(488000)
  })

  test('una transferencia en dólares no se rompe por no tener tipo de cambio propio', () => {
    const { movimientos, error } = armarCambioDeMoneda(venta({
      destino: { accountId: 'mp', moneda: 'USD', monto: '' }, tipoCambioUSD: 1450,
    }))
    expect(error).toBeUndefined()
    expect(movimientos.map(m => [m.monto, m.fx_rate])).toEqual([[181, 1450], [181, 1450]])
    // Sin el sentido en la base, el texto de la pata que entra igual la hace sumar.
    const { movimientos: sinColumna } = armarCambioDeMoneda(venta({ destino: { accountId: 'mp', moneda: 'USD', monto: '' }, conSentido: false }))
    const anclas = [{ id: 'a1', account_id: 'mp', moneda: 'USD', fecha: '2026-09-01', saldo: 0 }]
    expect(saldoDeCuenta({ anclas, transactions: sinColumna, accountId: 'mp', moneda: 'USD' }).saldo).toBe(181)
  })

  test('rechaza lo que no es un cambio ni una transferencia', () => {
    expect(armarCambioDeMoneda(venta({ destino: { accountId: USD, moneda: 'USD', monto: 10 } })).error).toMatch(/dos cuentas distintas/)
    expect(armarCambioDeMoneda(venta({ destino: { accountId: ARS, moneda: 'USD', monto: 10 }, origen: { accountId: USD, moneda: 'USD', monto: '' } })).error).toMatch(/monto/)
    expect(armarCambioDeMoneda(venta({ origen: { accountId: USD, moneda: 'USD', monto: '0' } })).error).toMatch(/montos/)
    expect(armarCambioDeMoneda(venta({ origen: { accountId: USD, moneda: 'USD', monto: '-5' } })).error).toMatch(/montos/)
    expect(armarCambioDeMoneda(venta({ destino: { accountId: ARS, moneda: 'ARS', monto: 'abc' } })).error).toMatch(/montos/)
    expect(armarCambioDeMoneda(venta({ origen: { accountId: '', moneda: 'USD', monto: 1 } })).error).toMatch(/cuenta/)
    expect(armarCambioDeMoneda(venta({ origen: { accountId: USD, moneda: 'BTC', monto: 1 } })).error).toMatch(/moneda/)
    expect(armarCambioDeMoneda(venta({ fecha: '2026-02-30' })).error).toMatch(/fecha/)
    expect(armarCambioDeMoneda(venta({ userId: null })).error).toMatch(/sesión/)
  })
})

describe('tipoDeCambioImplicito', () => {
  test('con pesos de un lado, siempre pesos por unidad extranjera', () => {
    expect(tipoDeCambioImplicito({ origen: { moneda: 'USD', monto: 100 }, destino: { moneda: 'ARS', monto: 145000 } }))
      .toEqual({ moneda: 'USD', en: 'ARS', valor: 1450 })
    expect(tipoDeCambioImplicito({ origen: { moneda: 'ARS', monto: 150000 }, destino: { moneda: 'USD', monto: 100 } }))
      .toEqual({ moneda: 'USD', en: 'ARS', valor: 1500 })
  })

  test('sin los dos montos no hay tipo de cambio', () => {
    expect(tipoDeCambioImplicito({ origen: { moneda: 'USD', monto: '' }, destino: { moneda: 'ARS', monto: 1 } })).toBe(null)
  })
})

describe('pareceCambioDeMoneda', () => {
  test.each([
    'VENTA DE MONEDA EXTRANJERA',
    'COMPRA DOLARES',
    'Venta de USD',
    'Compra de dólares',
    'DOLAR MEP',
    'OPERACION DE CAMBIO',
    'Conversión a ARS',
    // Dólar MEP: se compra el bono con dólares y se vende en pesos.
    'COMP. TITULOS / VAL. AL30 BONO REP.ARGENT Nro Operacion: 23130',
    'VENTA DE TITULOS / VALORES - AL30 BONO REP.ARGENTINA USD 2030 - Nro Operacion: 230385151',
  ])('reconoce "%s"', (texto) => {
    expect(pareceCambioDeMoneda(texto)).toBe(true)
  })

  test.each([
    'COMPRA DEBITO NETFLIX.COM USD',
    'PAGO TARJETA VISA',
    'TRANSFERENCIA A TERCEROS',
    'Compra en Mercado Libre',
    '',
    null,
  ])('no confunde "%s"', (texto) => {
    expect(pareceCambioDeMoneda(texto)).toBe(false)
  })
})
