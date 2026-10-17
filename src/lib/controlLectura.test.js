import { controlDeLectura, consumoDelResumen, lineasDelControl } from './controlLectura'

const tx = (monto, tipo, extra = {}) => ({ monto, tipo, moneda: 'ARS', ...extra })

test('resumen pagado entero: consumos − devoluciones = total, aunque no traiga saldo anterior', () => {
  const control = controlDeLectura({
    tipo_documento: 'tarjeta', total_pesos: 150000, total_dolares: 0,
    transacciones: [tx(100000, 'gasto'), tx(60000, 'gasto'), tx(10000, 'ingreso'), tx(500000, 'neutro')],
  })
  expect(control).toMatchObject({ aplica: true, cuadra: true })
  expect(control.monedas).toHaveLength(1) // en dólares no hay nada que controlar
})

test('si falta un movimiento, no cuadra y dice cuánto', () => {
  const control = controlDeLectura({
    tipo_documento: 'tarjeta', total_pesos: 3929478.22,
    transacciones: [tx(3870000, 'gasto')],
  })
  expect(control.cuadra).toBe(false)
  expect(lineasDelControl(control)).toEqual(['Pesos: el resumen dice $ 3.929.478,22 y lo leído da $ 3.870.000 (faltan $ 59.478,22).'])
})

test('con saldo anterior: saldo − pagos + consumos − devoluciones', () => {
  const resumen = {
    tipo_documento: 'tarjeta', total_pesos: 250000, saldo_anterior_pesos: 300000,
    transacciones: [tx(200000, 'neutro'), tx(160000, 'gasto'), tx(10000, 'ingreso')],
  }
  expect(controlDeLectura(resumen).cuadra).toBe(true)
  // Sin el saldo anterior, la misma lectura parecería tener plata de más.
  expect(controlDeLectura({ ...resumen, saldo_anterior_pesos: null }).cuadra).toBe(false)
})

test('cada moneda por separado, con su margen de redondeo', () => {
  const control = controlDeLectura({
    tipo_documento: 'tarjeta', total_pesos: 100000.4, total_dolares: 21.99,
    transacciones: [tx(100000, 'gasto'), tx(20, 'gasto', { moneda: 'USD' })],
  })
  expect(control.monedas.map(m => [m.moneda, m.cuadra])).toEqual([['ARS', true], ['USD', false]])
  expect(lineasDelControl(control)).toEqual(['Dólares: el resumen dice U$S 21,99 y lo leído da U$S 20,00 (faltan U$S 1,99).'])
})

test('un consumo que un alias pasó a neutro sigue contando como consumo', () => {
  const control = controlDeLectura({
    tipo_documento: 'tarjeta', total_pesos: 50000,
    transacciones: [tx(50000, 'neutro', { sentido: 'sale' })],
  })
  expect(control.cuadra).toBe(true)
})

test('saldo a favor: el total viene negativo', () => {
  const control = controlDeLectura({
    tipo_documento: 'tarjeta', total_dolares: -5, saldo_anterior_dolares: 0,
    transacciones: [tx(5, 'ingreso', { moneda: 'USD' })],
  })
  expect(control.cuadra).toBe(true)
})

test('extractos de banco sin saldos y resúmenes sin total no se controlan', () => {
  expect(controlDeLectura({ tipo_documento: 'banco', total_pesos: 1, transacciones: [] })).toEqual({ tipo: 'banco', aplica: false, cuadra: null, monedas: [] })
  expect(controlDeLectura({ tipo_documento: 'tarjeta', total_pesos: null, transacciones: [tx(1, 'gasto')] }).aplica).toBe(false)
})

// Extractos de banco: saldo final = saldo inicial + lo que entró − lo que salió.
const extracto = (transacciones, extra = {}) => ({
  tipo_documento: 'banco', saldo_inicial_pesos: 100000, saldo_final_pesos: 150000, transacciones, ...extra,
})

test('extracto: cierra con el saldo final, neutros incluidos según su columna', () => {
  const control = controlDeLectura(extracto([
    tx(200000, 'ingreso'),
    tx(80000, 'gasto'),
    tx(50000, 'neutro', { sentido: 'sale' }),
    tx(-20000, 'neutro', { sentido: 'sale' }),
  ]))
  expect(control).toMatchObject({ tipo: 'banco', aplica: true, cuadra: true })
})

test('extracto: si falta un movimiento, dice cuánto en palabras de extracto', () => {
  const control = controlDeLectura(extracto([tx(200000, 'ingreso'), tx(80000, 'gasto')]))
  expect(control.cuadra).toBe(false)
  expect(lineasDelControl(control)).toEqual(['Pesos: el saldo final del extracto es $ 150.000 y con lo leído da $ 220.000 ($ 70.000 más).'])
})

test('extracto: lo que leyó la IA de la columna manda sobre el tipo', () => {
  expect(controlDeLectura(extracto([tx(50000, 'gasto', { sentido: 'entra' })])).cuadra).toBe(true)
})

test('extracto: con un neutro sin lado, esa moneda no se controla', () => {
  expect(controlDeLectura(extracto([tx(50000, 'neutro')])).aplica).toBe(false)
  expect(controlDeLectura(extracto([tx(50000, 'neutro', { es_credito: true })])).cuadra).toBe(true)
})

test('extracto: cada moneda con sus propios saldos', () => {
  const control = controlDeLectura({
    tipo_documento: 'banco', saldo_inicial_dolares: 1000, saldo_final_dolares: 900,
    transacciones: [tx(100, 'gasto', { moneda: 'USD' })],
  })
  expect(control.monedas.map(m => [m.moneda, m.cuadra])).toEqual([['USD', true]])
})

describe('consumoDelResumen — lo gastado en el período, no lo que quedó por pagar', () => {
  test('los pagos adelantados no bajan lo consumido', () => {
    // Caso real: Visa que cierra el 15/10/26. Saldo anterior $ 1.069.530,02, pagos por
    // $ 2.044.825,17 ($ 1.000.000 adelantados), $ 1.015.590,12 a pagar.
    const resumen = {
      tipo_documento: 'tarjeta', total_pesos: 1015590.12, saldo_anterior_pesos: 1069530.02,
      total_dolares: 203.9, saldo_anterior_dolares: 54.41,
      transacciones: [
        tx(844825.17, 'neutro'), tx(200000, 'neutro'), tx(1000000, 'neutro'),
        tx(54.41, 'neutro', { moneda: 'USD' }),
        tx(2016278.65, 'gasto'), tx(25393.38, 'ingreso'),
        tx(203.9, 'gasto', { moneda: 'USD' }),
      ],
    }
    expect(controlDeLectura(resumen).cuadra).toBe(true)
    expect(consumoDelResumen(resumen)).toEqual({ ARS: 1990885.27, USD: 203.9 })
  })

  test('un consumo que un alias pasó a neutro no se cuenta como pago', () => {
    const resumen = {
      tipo_documento: 'tarjeta', total_pesos: 150000, saldo_anterior_pesos: 100000,
      transacciones: [tx(100000, 'neutro'), tx(50000, 'neutro', { sentido: 'sale' }), tx(100000, 'gasto')],
    }
    expect(consumoDelResumen(resumen).ARS).toBe(150000)
  })

  test('sin saldo anterior no se despeja: null', () => {
    expect(consumoDelResumen({
      tipo_documento: 'tarjeta', total_pesos: 150000, total_dolares: 10,
      transacciones: [tx(150000, 'gasto')],
    })).toEqual({ ARS: null, USD: null })
  })

  test('solo en resúmenes de tarjeta', () => {
    expect(consumoDelResumen({ tipo_documento: 'banco', saldo_inicial_pesos: 0, saldo_final_pesos: 10 }))
      .toEqual({ ARS: null, USD: null })
    expect(consumoDelResumen(null)).toEqual({ ARS: null, USD: null })
  })
})
