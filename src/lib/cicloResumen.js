// Qué resumen ya cargado es "el mismo" que el que se está subiendo, y con qué
// nombre de mes guardar el nuevo.
//
// Un resumen se identifica por su CICLO —la fecha de cierre—, no por el nombre del
// mes. El nombre sale del mes de cierre, y una tarjeta que cierra el 1/10 y de nuevo
// el 29/10 tiene dos resúmenes "Octubre 2026" que son ciclos distintos: comparar por
// nombre hacía que el segundo se ofreciera como reemplazo del primero, y al
// aceptarlo se borraba un resumen real.
//
// Los resúmenes se reciben con el cierre ya calculado ({ id, periodo, cierre }, ver
// cierreDe en AccountDetail): este módulo no sabe de dónde sale cada fecha.

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_NORMALIZADOS = MESES.map(m => m.toLowerCase())

// Dos ciclos de la misma tarjeta cierran con ~4 semanas de diferencia. Hasta 15
// días se toma como el mismo cierre leído distinto: cuando el PDF no trae la fecha
// de cierre se estima desde el vencimiento, y esa estimación puede correrse una
// semana.
export const DIAS_MISMO_CICLO = 15

const MS_POR_DIA = 24 * 60 * 60 * 1000
const aDia = (fechaISO) => Date.parse(`${String(fechaISO).slice(0, 10)}T00:00:00Z`)
export const diasEntre = (a, b) => Math.round(Math.abs(aDia(a) - aDia(b)) / MS_POR_DIA)

// "Octubre 2026" → { anio: 2026, mes: 9 }; cualquier otra cosa → null.
const leerPeriodo = (periodo) => {
  const m = String(periodo || '').trim().match(/^([a-záéíóúñ]+)\s+(\d{4})$/i)
  if (!m) return null
  const mes = MESES_NORMALIZADOS.indexOf(m[1].toLowerCase())
  return mes === -1 ? null : { anio: Number(m[2]), mes }
}

// "Octubre 2026", -1 → "Septiembre 2026". null si el período no es un mes.
export const correrPeriodo = (periodo, meses) => {
  const p = leerPeriodo(periodo)
  if (!p) return null
  const total = p.anio * 12 + p.mes + meses
  return `${MESES[((total % 12) + 12) % 12]} ${Math.floor(total / 12)}`
}

// El resumen ya cargado que corresponde al mismo ciclo que `nuevo`, o null.
// Con las dos fechas de cierre, manda la fecha: el nombre del mes no se mira. Solo
// cuando falta alguna se compara por nombre, porque es lo único que queda.
export const buscarMismoCiclo = (nuevo, previos) => {
  const lista = previos || []
  if (nuevo?.cierre) {
    const cercano = lista
      .filter(p => p.cierre && diasEntre(p.cierre, nuevo.cierre) <= DIAS_MISMO_CICLO)
      .sort((a, b) => diasEntre(a.cierre, nuevo.cierre) - diasEntre(b.cierre, nuevo.cierre))[0]
    if (cercano) return cercano
  }
  if (!nuevo?.periodo) return null
  return lista.find(p => p.periodo === nuevo.periodo && (!p.cierre || !nuevo.cierre)) || null
}

// Con qué nombre guardar el resumen nuevo para que no haya dos ciclos de la misma
// cuenta con el mismo mes (el gráfico "Total facturado por resumen" junta por nombre
// y, de dos con el mismo, muestra uno solo).
//
// Si choca, se corre al mes que quedó vacío: el de cierre más temprano pasa al mes
// anterior o, si ese está ocupado, el de cierre más tardío pasa al siguiente. Con
// cierres 27/08, 01/10 y 29/10, el del 01/10 es el de septiembre (factura casi todo
// septiembre) y el del 29/10 queda como octubre. A veces el que se corre es el que
// ya estaba cargado: va en `renombrar`.
//
// `previos` son los resúmenes que quedan en la cuenta (sin el que se reemplaza).
// Devuelve { periodo, renombrar: { id, periodo } | null }.
export const periodoSinRepetir = (nuevo, previos) => {
  const sinCambios = { periodo: nuevo?.periodo || null, renombrar: null }
  const lista = previos || []
  const choque = nuevo?.periodo ? lista.find(p => p.periodo === nuevo.periodo) : null
  // Sin las dos fechas no se sabe cuál va primero; con la misma fecha es el mismo
  // ciclo cargado aparte a propósito: se deja como está.
  if (!choque || !choque.cierre || !nuevo.cierre || choque.cierre === nuevo.cierre) return sinCambios

  const ocupados = new Set(lista.map(p => p.periodo).filter(Boolean))
  const libre = (periodo) => periodo && !ocupados.has(periodo)
  const nuevoEsElPrimero = nuevo.cierre < choque.cierre

  const anterior = correrPeriodo(nuevo.periodo, -1)
  if (libre(anterior)) {
    return nuevoEsElPrimero
      ? { periodo: anterior, renombrar: null }
      : { periodo: nuevo.periodo, renombrar: { id: choque.id, periodo: anterior } }
  }
  const siguiente = correrPeriodo(nuevo.periodo, 1)
  if (libre(siguiente)) {
    return nuevoEsElPrimero
      ? { periodo: nuevo.periodo, renombrar: { id: choque.id, periodo: siguiente } }
      : { periodo: siguiente, renombrar: null }
  }
  return sinCambios
}
