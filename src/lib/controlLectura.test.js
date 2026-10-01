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

test('extractos de banco y resúmenes sin total no se controlan', () => {
  expect(controlDeLectura({ tipo_documento: 'banco', total_pesos: 1, transacciones: [] })).toEqual({ aplica: false, cuadra: null, monedas: [] })
  expect(controlDeLectura({ tipo_documento: 'tarjeta', total_pesos: null, transacciones: [tx(1, 'gasto')] }).aplica).toBe(false)
})
