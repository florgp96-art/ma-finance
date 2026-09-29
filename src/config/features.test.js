const { puedeVerCobroFacturacion, puedeVerLiquidacion } = require('./features')

describe('cobrado / facturado solo en la cuenta de GPK', () => {
  test('la cuenta de GPK ve los botones, sin importar mayúsculas ni espacios', () => {
    expect(puedeVerCobroFacturacion('video33lut@gmail.com')).toBe(true)
    expect(puedeVerCobroFacturacion(' Video33lut@Gmail.com ')).toBe(true)
  })

  test('cualquier otra cuenta no los ve', () => {
    expect(puedeVerCobroFacturacion('florgp96@gmail.com')).toBe(false)
    expect(puedeVerCobroFacturacion(null)).toBe(false)
    expect(puedeVerCobroFacturacion(undefined)).toBe(false)
  })

  test('no cambia quién ve Liquidación', () => {
    expect(puedeVerLiquidacion('florgp96@gmail.com')).toBe(true)
    expect(puedeVerLiquidacion('video33lut@gmail.com')).toBe(false)
  })
})
