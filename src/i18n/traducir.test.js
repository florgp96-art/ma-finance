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
    expect(traducir('No se encontró la cuenta. Probá de nuevo.')).toBe('No se encontró la cuenta. Try again.')
  })

  test('un mensaje de varias líneas se traduce línea por línea', () => {
    expect(traducir('Guardar\nProbá de nuevo.')).toBe('Save\nTry again.')
  })
})
