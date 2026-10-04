import { subcategoriasParaElegir, cuentasDelAlta } from './perfil'

describe('subcategoriasParaElegir — sin auto no se ofrecen las del auto', () => {
  const subs = [
    { id: 1, nombre: 'Nafta', user_id: null },
    { id: 2, nombre: 'Uber/Cabify', user_id: null },
    { id: 3, nombre: 'Telepase', user_id: null },
    { id: 4, nombre: 'Nafta', user_id: 'u1' },
  ]
  test('sin auto saca las del sistema y deja las que creó el cliente', () => {
    expect(subcategoriasParaElegir(subs, { tieneAuto: false }).map(s => s.id)).toEqual([2, 4])
  })
  test('con auto, o si no contestó, quedan todas', () => {
    expect(subcategoriasParaElegir(subs, { tieneAuto: true })).toHaveLength(4)
    expect(subcategoriasParaElegir(subs, {})).toHaveLength(4)
  })
})

describe('cuentasDelAlta — las cuentas que se crean con lo que eligió', () => {
  test('un solo banco: caja de ahorro y tarjetas con el nombre del banco', () => {
    expect(cuentasDelAlta({ bancos: ['Galicia'], tarjetas: ['Visa', 'Mastercard', 'Naranja'] })).toEqual([
      { nombre: 'Caja de Ahorro Galicia', tipo: 'debito' },
      { nombre: 'Visa Galicia', tipo: 'credito' },
      { nombre: 'Mastercard Galicia', tipo: 'credito' },
      { nombre: 'Naranja', tipo: 'credito' },
    ])
  })
  test('dos bancos: las tarjetas quedan sin banco, para renombrar', () => {
    const cuentas = cuentasDelAlta({ bancos: ['Galicia', 'Santander'], billeteras: ['Mercado Pago'], tarjetas: ['Visa'] })
    expect(cuentas.map(c => c.nombre)).toEqual(['Caja de Ahorro Galicia', 'Caja de Ahorro Santander', 'Mercado Pago', 'Visa'])
  })
  test('no repite las que ya tiene', () => {
    const cuentas = cuentasDelAlta({ bancos: ['Galicia'], tarjetas: ['Visa'], existentes: [{ nombre: 'caja de ahorro galicia' }] })
    expect(cuentas).toEqual([{ nombre: 'Visa Galicia', tipo: 'credito' }])
  })
})
