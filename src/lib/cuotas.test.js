import { cuotasFuturasCargadas, cuotaEnCiclo } from './cuotas'

// Las reglas de "qué cuota todavía se debe" ya se rompieron varias veces al tocar
// otra cosa. Se fijan acá para que un cambio futuro tenga que romper un test.
const HOY = new Date(2026, 7, 3) // 3 de agosto de 2026

const cuota = (props) => ({
  tipo: 'gasto', cuotas_total: 3, cuota_numero: 2, moneda: 'ARS',
  monto: 1000, statement_id: null, ...props,
})

describe('cuotasFuturasCargadas — el corte es por mes, no por día', () => {
  test('una cuota del mes en curso no es pendiente, sea cual sea su día', () => {
    // El día de una cuota es el de la compra original arrastrado mes a mes: el 2 y
    // el 28 de agosto son las dos del mismo ciclo y las dos van a "A pagar".
    const txs = [
      cuota({ id: 'temprana', fecha: '2026-08-02' }),
      cuota({ id: 'tardia', fecha: '2026-08-28' }),
    ]
    expect(cuotasFuturasCargadas(txs, HOY, new Map())).toEqual([])
  })

  test('una cuota de un mes que viene sí es pendiente', () => {
    const txs = [cuota({ id: 'sept', fecha: '2026-09-28' })]
    expect(cuotasFuturasCargadas(txs, HOY, new Map()).map(t => t.id)).toEqual(['sept'])
  })

  test('una cuota de un mes ya pasado no es pendiente', () => {
    const txs = [cuota({ id: 'julio', fecha: '2026-07-28' })]
    expect(cuotasFuturasCargadas(txs, HOY, new Map())).toEqual([])
  })

  test('alquiler y expensas nunca cuentan como cuota', () => {
    const txs = [cuota({ id: 'alq', fecha: '2026-09-05', subcategories: { nombre: 'Alquiler' } })]
    expect(cuotasFuturasCargadas(txs, HOY, new Map())).toEqual([])
  })
})

describe('cuotaEnCiclo — el día de cierre no mueve una cuota de mes', () => {
  // Compra de julio en 3 cuotas: julio, agosto y septiembre. La cuota de agosto la
  // factura el resumen de agosto, cierre la tarjeta el 9 o el 20.
  const cuotaAgosto = { fecha: '2026-08-28' }

  test('la cuota de agosto entra en el ciclo que cierra en agosto, cierre el 9', () => {
    expect(cuotaEnCiclo(cuotaAgosto, '2026-07-09', '2026-08-09')).toBe(true)
  })

  test('...y también si esa tarjeta cierra el 20', () => {
    // Con comparación por día, el 28 caía después del 20 y se iba al ciclo siguiente.
    expect(cuotaEnCiclo(cuotaAgosto, '2026-07-20', '2026-08-20')).toBe(true)
  })

  test('...y también si cierra el 1, antes que cualquier día de compra', () => {
    expect(cuotaEnCiclo(cuotaAgosto, '2026-07-01', '2026-08-01')).toBe(true)
  })

  test('no entra en el ciclo que cierra en septiembre', () => {
    expect(cuotaEnCiclo(cuotaAgosto, '2026-08-09', '2026-09-09')).toBe(false)
  })

  test('no entra en el ciclo que cierra en julio, ni con el día a favor', () => {
    expect(cuotaEnCiclo({ fecha: '2026-07-02' }, '2026-06-09', '2026-07-09')).toBe(true)
    expect(cuotaEnCiclo(cuotaAgosto, '2026-06-09', '2026-07-09')).toBe(false)
  })

  test('ciclo abierto: cuenta hasta el mes del tope, sin mirar el día', () => {
    // hasta = hoy (3 de agosto): la cuota del 28 de agosto igual cuenta, es de este mes.
    expect(cuotaEnCiclo(cuotaAgosto, '2026-07-09', '2026-08-03')).toBe(true)
    // La de septiembre no: es de un mes que no llegó.
    expect(cuotaEnCiclo({ fecha: '2026-09-28' }, '2026-07-09', '2026-08-03')).toBe(false)
  })

  test('un hueco largo sin resúmenes no hace desaparecer las cuotas del medio', () => {
    expect(cuotaEnCiclo({ fecha: '2026-07-28' }, '2026-06-09', '2026-08-03')).toBe(true)
  })
})

describe('cuotasFuturasCargadas — si un resumen la facturó, decide el resumen', () => {
  test('resumen ya pagado: la cuota deja de ser pendiente aunque su fecha no llegó', () => {
    // Este es el caso reportado: las cuotas de agosto de una Visa ya pagada seguían
    // figurando como pendientes porque se caía a comparar la fecha contra hoy.
    const txs = [cuota({ id: 'visa', fecha: '2026-08-28', statement_id: 'st-visa' })]
    expect(cuotasFuturasCargadas(txs, HOY, new Map())).toEqual([])
  })

  test('resumen impago: la cuota se debe aunque su fecha ya haya pasado', () => {
    const txs = [cuota({ id: 'vieja', fecha: '2026-07-10', statement_id: 'st-1' })]
    const saldo = new Map([['st-1', { ars: 50000, usd: 0 }]])
    expect(cuotasFuturasCargadas(txs, HOY, saldo).map(t => t.id)).toEqual(['vieja'])
  })

  test('resumen pagado en pesos que todavía debe dólares: la cuota en pesos no cuenta', () => {
    // Visa con $ 0 y U$S 3,03 pendientes: tres dólares no pueden dejar como
    // pendientes a todas las cuotas en pesos de esa tarjeta.
    const saldo = new Map([['st-2', { ars: 0, usd: 3.03 }]])
    const txs = [
      cuota({ id: 'pesos', fecha: '2026-09-15', statement_id: 'st-2' }),
      cuota({ id: 'dolares', fecha: '2026-09-15', statement_id: 'st-2', moneda: 'USD', monto: 3.03 }),
    ]
    expect(cuotasFuturasCargadas(txs, HOY, saldo).map(t => t.id)).toEqual(['dolares'])
  })
})
