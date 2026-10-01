jest.mock('./supabase', () => ({ supabase: {} }))

const { etiquetaFacturacion, facturacionValida, resumenFacturacion, estadoFacturacion } = require('./facturacion')

test('etiquetas y valores válidos', () => {
  expect(etiquetaFacturacion('facturado')).toBe('Facturado')
  expect(etiquetaFacturacion('sin_facturar')).toBe('Sin facturar')
  expect(etiquetaFacturacion('no_corresponde')).toBe('No corresponde')
  expect(etiquetaFacturacion(null)).toBe('Sin indicar')
  expect(etiquetaFacturacion('cualquiera')).toBe('Sin indicar')
  expect(facturacionValida(null)).toBe(true)
  expect(facturacionValida('facturado')).toBe(true)
  expect(facturacionValida('si')).toBe(false)
})

test('resumen por estado, con cada moneda aparte y el equivalente en pesos', () => {
  const aPesos = (t) => (t.moneda === 'ARS' ? t.monto : t.moneda === 'USD' ? t.monto * 1500 : null)
  const ingresos = [
    { monto: 600000, moneda: 'ARS', facturacion: 'facturado' },
    { monto: 100, moneda: 'USD', facturacion: 'facturado' },
    { monto: 350000, moneda: 'ARS', facturacion: 'sin_facturar' },
    { monto: 900000, moneda: 'ARS', facturacion: 'no_corresponde' },
    { monto: 215, moneda: 'EUR' }, // sin indicar y sin cotización
    { monto: 50000, moneda: 'ARS', facturacion: 'otra cosa' }, // dato raro: sin indicar
  ]
  const { filas, total } = resumenFacturacion(ingresos, aPesos)
  const porEstado = Object.fromEntries(filas.map(f => [f.etiqueta, f]))
  expect(porEstado.Facturado).toMatchObject({ cantidad: 2, porMoneda: { ARS: 600000, USD: 100 }, pesos: 750000 })
  expect(porEstado['Sin facturar']).toMatchObject({ cantidad: 1, pesos: 350000 })
  expect(porEstado['No corresponde']).toMatchObject({ cantidad: 1, pesos: 900000 })
  expect(porEstado['Sin indicar']).toMatchObject({ cantidad: 2, porMoneda: { EUR: 215, ARS: 50000 }, pesos: 50000, sinCotizacion: 1 })
  expect(total).toMatchObject({ etiqueta: 'Total', cantidad: 6, pesos: 2050000, sinCotizacion: 1 })
})

test('el facturado sí/no que ya tenía GPK cuenta mientras no se marque con los estados nuevos', () => {
  expect(estadoFacturacion({ facturado: true })).toBe('facturado')
  expect(estadoFacturacion({ facturado: false })).toBe(null)
  expect(estadoFacturacion({ facturado: true, facturacion: 'no_corresponde' })).toBe('no_corresponde')
  expect(estadoFacturacion({ facturacion: 'raro' })).toBe(null)
  const { filas } = resumenFacturacion([{ monto: 100, moneda: 'ARS', facturado: true }], t => t.monto)
  expect(filas.find(f => f.valor === 'facturado').cantidad).toBe(1)
})
