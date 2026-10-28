import { crearTraductor } from './traducir'

const traducir = crearTraductor({
  'Guardar': 'Save',
  'Cuotas': 'Installments',
  'Octubre': 'October',
  'Error al guardar: {0}': 'Error saving: {0}',
  'Error al guardar la regla: {0}': 'Error saving the rule: {0}',
  'No se pudo {0}: {1}': "Couldn't {0}: {1}",
  'guardar la regla': 'save the rule',
  '{0} transacciones importadas.{1}': '{0} transactions imported.{1}',
  '{0} omitidas.': '{0} skipped.',
  'Se agregaron {0} cuotas futuras.': '{0} future installments added.',
  '{0} movimiento{1} que no se ve{2} en la tabla': '{0} transaction{1} not shown in the table',
  'Probá de nuevo.': 'Try again.',
  '{0} {1}': 'no debería usarse: no tiene texto fijo',
  '{0} de {1}': '{0} of {1}',
  'De {0}': 'By {0}',
  'Pago': 'Payment',
  'falta el PDF': 'PDF missing',
})

describe('crearTraductor', () => {
  test('texto conocido, con los espacios de los bordes intactos', () => {
    expect(traducir('Guardar')).toBe('Save')
    expect(traducir('  Guardar ')).toBe('  Save ')
    expect(traducir('Guardar\n    ')).toBe('Save\n    ')
  })

  test('lo que no conoce devuelve null', () => {
    expect(traducir('PAGO TARJETA VISA 1234')).toBeNull()
    expect(traducir('1.234,56')).toBeNull()
    expect(traducir('')).toBeNull()
  })

  test('sin distinguir mayúsculas, copia la forma del original', () => {
    expect(traducir('GUARDAR')).toBe('SAVE')
    expect(traducir('cuotas')).toBe('installments')
  })

  test('lo que rodea al texto y no es letra queda igual', () => {
    expect(traducir('Octubre 2026')).toBe('October 2026')
    expect(traducir('12 cuotas')).toBe('12 installments')
    expect(traducir('✓ Guardar')).toBe('✓ Save')
  })

  test('plantillas: la más específica gana y el hueco también se traduce', () => {
    expect(traducir('Error al guardar: timeout')).toBe('Error saving: timeout')
    expect(traducir('Error al guardar la regla: timeout')).toBe('Error saving the rule: timeout')
    expect(traducir('No se pudo guardar la regla: sin conexión')).toBe("Couldn't save the rule: sin conexión")
    expect(traducir('3 movimientos que no se ven en la tabla')).toBe('3 transactions not shown in the table')
  })

  test('una plantilla sin texto fijo no se usa', () => {
    expect(traducir('Casa Grande')).toBeNull()
  })

  test('oraciones pegadas se traducen de a una', () => {
    expect(traducir('12 transacciones importadas. 3 omitidas. Se agregaron 2 cuotas futuras.'))
      .toBe('12 transactions imported. 3 skipped. 2 future installments added.')
  })

  test('entre una frase mitad y mitad y una entera en español, la entera', () => {
    expect(traducir('No se encontró la cuenta. Probá de nuevo.')).toBeNull()
    // "cuotas" es una palabra de la app que quedó sin traducir dentro del hueco.
    expect(traducir('Error al guardar: faltan cuotas')).toBeNull()
  })

  test('una plantilla sin palabras propias no traduce a medias lo que escribió el usuario', () => {
    expect(traducir('3 de 10')).toBe('3 of 10')
    expect(traducir('Pago de expensas')).toBeNull()
    expect(traducir('Pago de tarjeta de crédito')).toBeNull()
    expect(traducir('De Flor')).toBe('By Flor')
    expect(traducir('De paseo por ahí')).toBeNull()
  })

  test('un texto armado con puntos medios se traduce tramo por tramo', () => {
    expect(traducir('💳 Mastercard · Octubre 2026 · falta el PDF')).toBe('💳 Mastercard · October 2026 · PDF missing')
  })

  test('un mensaje de varias líneas se traduce línea por línea', () => {
    expect(traducir('Guardar\nProbá de nuevo.')).toBe('Save\nTry again.')
  })
})
