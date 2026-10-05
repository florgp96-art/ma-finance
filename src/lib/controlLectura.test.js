import { controlDeLectura, lineasDelControl } from './controlLectura'

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
