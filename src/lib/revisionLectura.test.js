import { controlDeLectura } from './controlLectura'
import {
  listaParaRevision, bloqueRevision, aplicarRevision, compararControles,
  claveDeFormato, etiquetaDeFormato, limpiarNotaFormato,
} from './revisionLectura'

const consumo = (fecha, nombre, monto, extra = {}) =>
  ({ fecha, nombre_original: nombre, nombre_limpio: nombre, monto, moneda: 'ARS', tipo: 'gasto', es_credito: false, cuotas_total: 1, cuota_numero: 1, ...extra })

// Resumen de $ 150.000 en el que la primera lectura se salteó el IVA de $ 21.000.
const resumen = (transacciones) => ({
  tipo_documento: 'tarjeta', total_pesos: 150000, total_dolares: 0,
  saldo_anterior_pesos: null, saldo_anterior_dolares: null, transacciones,
})
const leido = resumen([consumo('2026-09-03', 'SUPER', 100000), consumo('2026-09-10', 'NAFTA', 29000)])
const iva = consumo('2026-09-30', 'IVA RG 4240', 21000)

describe('bloqueRevision — lo que se le dice a la IA en la segunda lectura', () => {
  test('lleva la diferencia concreta y la lista numerada de lo leído', () => {
    const bloque = bloqueRevision(leido)
    expect(bloque).toContain('faltan $ 21.000')
    expect(bloque).toContain('#0 2026-09-03 | SUPER | 100000 ARS | consumo')
    expect(bloque).toContain('#1 2026-09-10 | NAFTA | 29000 ARS | consumo')
  })
  test('le prohíbe poner datos de la persona en la nota', () => {
    expect(bloqueRevision(leido)).toMatch(/PROHIBIDO incluir cualquier dato/)
  })
  test('las devoluciones y los pagos se ven como tales', () => {
    expect(listaParaRevision([consumo('2026-09-01', 'DEV', 10, { tipo: 'ingreso', es_credito: true }), consumo('2026-09-02', 'SU PAGO', 5, { tipo: 'neutro' })]))
      .toBe('#0 2026-09-01 | DEV | 10 ARS | devolución\n#1 2026-09-02 | SU PAGO | 5 ARS | pago')
  })
})

describe('aplicarRevision — la corrección sobre la primera lectura', () => {
  test('agrega lo que faltaba, marcado como encontrado en la revisión', () => {
    const { resultado, agregados, quitados } = aplicarRevision(leido, { quitar: [], agregar: [iva] })
    expect(agregados).toBe(1)
    expect(quitados).toBe(0)
    expect(resultado.transacciones).toHaveLength(3)
    expect(resultado.transacciones[2]).toMatchObject({ nombre_original: 'IVA RG 4240', revisado: true })
    expect(controlDeLectura(resultado).cuadra).toBe(true)
  })
  test('corrige un monto mal leído: saca el viejo y agrega el bueno', () => {
    const malLeido = resumen([consumo('2026-09-03', 'SUPER', 100000), consumo('2026-09-10', 'NAFTA', 50000)])
    const { resultado } = aplicarRevision(malLeido, { quitar: [1], agregar: [consumo('2026-09-10', 'NAFTA', 29000), iva] })
    expect(resultado.transacciones.map(t => t.monto)).toEqual([100000, 29000, 21000])
  })
  test('puede corregir el saldo anterior si se había leído mal', () => {
    const { resultado } = aplicarRevision(leido, { quitar: [], agregar: [], saldo_anterior_pesos: 21000 })
    expect(resultado.saldo_anterior_pesos).toBe(21000)
  })
  test('una revisión que no cambia nada no es una corrección', () => {
    expect(aplicarRevision(leido, { quitar: [], agregar: [], saldo_anterior_pesos: null, saldo_anterior_dolares: null })).toBeNull()
  })
  test('no puede borrar media lectura de un saque', () => {
    const muchos = resumen(Array.from({ length: 10 }, (_, i) => consumo('2026-09-01', `X${i}`, 15000)))
    expect(aplicarRevision(muchos, { quitar: [0, 1, 2, 3], agregar: [] })).toBeNull()
  })
  test('ignora índices que no existen y movimientos sin fecha o monto', () => {
    const r = aplicarRevision(leido, { quitar: [7, -1], agregar: [iva, { fecha: 'ayer', monto: 5, nombre_original: 'X' }, { fecha: '2026-09-01', monto: 0, nombre_original: 'Y' }] })
    expect(r.quitados).toBe(0)
    expect(r.agregados).toBe(1)
  })
})

describe('compararControles — si la revisión dejó la lectura mejor', () => {
  const antes = controlDeLectura(leido)
  test('cierra', () => {
    expect(compararControles(antes, controlDeLectura(resumen([...leido.transacciones, iva])))).toBe('cuadra')
  })
  test('se acerca sin cerrar', () => {
    expect(compararControles(antes, controlDeLectura(resumen([...leido.transacciones, consumo('2026-09-30', 'SELLOS', 1000)])))).toBe('mejoro')
  })
  test('empeora o queda igual: se descarta', () => {
    expect(compararControles(antes, controlDeLectura(resumen([...leido.transacciones, consumo('2026-09-30', 'INVENTADO', 50000)])))).toBe('no_mejoro')
    expect(compararControles(antes, antes)).toBe('no_mejoro')
  })
  test('arreglar los pesos a costa de los dólares no es mejorar', () => {
    const conDolares = { ...leido, total_dolares: 10, transacciones: [...leido.transacciones, consumo('2026-09-05', 'APPLE', 10, { moneda: 'USD' })] }
    const despues = { ...conDolares, transacciones: [...leido.transacciones, iva] }
    expect(compararControles(controlDeLectura(conDolares), controlDeLectura(despues))).toBe('no_mejoro')
  })
})

describe('claveDeFormato / etiquetaDeFormato — a qué resúmenes aplica una nota', () => {
  test('el nivel de la tarjeta no cambia la clave', () => {
    expect(claveDeFormato({ entidad: 'Galicia', producto: 'Mastercard Black' })).toBe('galicia|mastercard|tarjeta')
    expect(claveDeFormato({ entidad: 'Banco Galicia', producto: 'Mastercard Platinum' })).toBe('banco galicia|mastercard|tarjeta')
    expect(claveDeFormato({ entidad: 'Santander', producto: 'American Express' })).toBe('santander|american express|tarjeta')
  })
  test('sin entidad no hay clave', () => {
    expect(claveDeFormato({ entidad: '', producto: 'Visa' })).toBeNull()
    expect(claveDeFormato(null)).toBeNull()
  })
  test('la etiqueta que ven los demás no lleva números', () => {
    expect(etiquetaDeFormato({ entidad: 'Galicia', producto: 'Visa 4517 6901' })).toEqual({ entidad: 'Galicia', producto: 'Visa' })
  })
})

describe('limpiarNotaFormato — la nota compartida no lleva datos de nadie', () => {
  const nombres = ['GALLO PROT FLORENCIA', 'FEDERICO GALLO PROT']
  test('una nota de formato pasa tal cual', () => {
    const nota = 'Los consumos en dólares están en una tabla aparte al final, rotulada "Detalle en moneda extranjera".'
    expect(limpiarNotaFormato(nota, { nombres })).toBe(nota)
  })
  test('saca montos, fechas, números de tarjeta y de cuenta', () => {
    const nota = limpiarNotaFormato('El IVA de $ 21.000 del 30/09/26 figura en la página 3 de la tarjeta 4517 6901 junto a los cargos.', { nombres })
    expect(nota).not.toMatch(/\d/)
    expect(nota).not.toContain('$')
    expect(nota).toContain('figura en la página')
  })
  test('saca el nombre de los titulares y adicionales', () => {
    const nota = limpiarNotaFormato('Los consumos de Federico Gallo van en una sección propia por adicional, después del titular.', { nombres })
    expect(nota).not.toMatch(/federico|gallo/i)
    expect(nota).toContain('van en una sección propia por adicional')
  })
  test('saca mails y direcciones web', () => {
    const nota = limpiarNotaFormato('Los cargos de cierre están abajo de todo; consultas a ayuda@banco.com o www.banco.com.ar.', { nombres })
    expect(nota).not.toMatch(/@|www/)
  })
  test('no rompe palabras que contienen "ars"', () => {
    expect(limpiarNotaFormato('Los cargos suelen usarse como renglón aparte al pie del detalle de consumos.')).toContain('usarse')
  })
  test('si no queda nada útil, no hay nota', () => {
    expect(limpiarNotaFormato('$ 21.000 30/09', { nombres })).toBeNull()
    expect(limpiarNotaFormato(null)).toBeNull()
  })
  test('nunca pasa de 300 caracteres', () => {
    expect(limpiarNotaFormato('Los cargos de cierre aparecen en una sección aparte. '.repeat(20)).length).toBeLessThanOrEqual(301)
  })
})
