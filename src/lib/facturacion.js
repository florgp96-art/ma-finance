import { supabase } from './supabase'

// Si un ingreso se facturó. Lo pidió una contadora para ofrecerles la app a sus
// clientes: ellos marcan cada ingreso y le mandan el reporte del mes (ver
// reporteContador.js). null = todavía no se indicó.
export const ESTADOS_FACTURACION = [
  { valor: 'facturado', etiqueta: 'Facturado' },
  { valor: 'sin_facturar', etiqueta: 'Sin facturar' },
  { valor: 'no_corresponde', etiqueta: 'No corresponde' },
]
export const SIN_INDICAR = 'Sin indicar'

export const facturacionValida = (valor) => valor === null || ESTADOS_FACTURACION.some(e => e.valor === valor)

const normalizar = (valor) => (facturacionValida(valor ?? null) ? (valor ?? null) : null)

// El estado de un movimiento. La cuenta de GPK tenía antes su propio facturado
// sí/no (columna facturado): si todavía no se marcó con estos estados, cuenta.
export const estadoFacturacion = (t) => {
  const valor = normalizar(t?.facturacion)
  if (valor) return valor
  return t?.facturado === true ? 'facturado' : null
}

export const etiquetaFacturacion = (valor) =>
  ESTADOS_FACTURACION.find(e => e.valor === valor)?.etiqueta || SIN_INDICAR

// ¿La base ya tiene transactions.facturacion? Mismo criterio que
// hayColumnaSentido: la migración la corre el dueño aparte (docs/PENDIENTES.md)
// y hasta entonces todo esto se oculta. Solo se recuerda el sí.
let hayColumna = false

export const hayColumnaFacturacion = async () => {
  if (hayColumna) return true
  const { error } = await supabase.from('transactions').select('facturacion').limit(1)
  hayColumna = !error
  return hayColumna
}

// Totales por estado (y "sin indicar"), con cada moneda por separado y el
// equivalente en pesos. aPesos(t) devuelve los pesos de un movimiento, o null si
// no hay cotización para pasarlo.
export const resumenFacturacion = (ingresos, aPesos) => {
  const nuevaFila = (valor) => ({ valor, etiqueta: etiquetaFacturacion(valor), cantidad: 0, porMoneda: {}, pesos: 0, sinCotizacion: 0 })
  const filas = [...ESTADOS_FACTURACION.map(e => e.valor), null].map(nuevaFila)
  const total = { ...nuevaFila(null), etiqueta: 'Total' }
  for (const t of ingresos || []) {
    const monto = Math.abs(Number(t.monto) || 0)
    const moneda = t.moneda || 'ARS'
    const pesos = aPesos(t)
    for (const fila of [filas.find(f => f.valor === estadoFacturacion(t)), total]) {
      fila.cantidad += 1
      fila.porMoneda[moneda] = (fila.porMoneda[moneda] || 0) + monto
      if (pesos === null || pesos === undefined) fila.sinCotizacion += 1
      else fila.pesos += pesos
    }
  }
  return { filas, total }
}
