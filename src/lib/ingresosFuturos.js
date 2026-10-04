// INGRESOS A FUTURO: lo que se espera cobrar, anotado aparte de las cuentas.
//
// Se anotan dentro de una liquidación de las que "te pagan" (concepto, monto, moneda
// y la fecha en que se espera) y viven en su propia tabla: no son movimientos, no
// tocan ningún saldo ni el balance del mes. Sirven para saber cuánto falta entrar.
//
// Cada uno se tacha solo cuando en alguna cuenta se carga el ingreso que le
// corresponde (ver cruzarConIngresos). Si no lo reconoce —el cliente pagó otro monto,
// o mucho después—, se puede tachar a mano.

// Desde cuántos días antes y hasta cuántos días después de la fecha esperada se busca
// el ingreso: un cliente que paga del 1 al 10 puede adelantarse o atrasarse bastante.
export const DIAS_ANTES = 15
export const DIAS_DESPUES = 45
// Cuánto puede diferir el monto. Con el nombre en común se tolera más: el ingreso
// puede llegar con una comisión descontada (€ 500 anotados, € 497 recibidos).
export const TOLERANCIA_SIN_NOMBRE = 0.02
export const TOLERANCIA_CON_NOMBRE = 0.1

const norm = (f) => String(f || '').slice(0, 10)
const diasEntre = (a, b) => (new Date(`${norm(b)}T00:00:00`) - new Date(`${norm(a)}T00:00:00`)) / 86400000

// Palabras de 4 letras o más, sin tildes ni mayúsculas: "Juampi Fórmula · Septiembre"
// y "JUAMPI F3" comparten "juampi".
const palabras = (texto) => new Set(
  String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(p => p.length >= 4))

const compartenNombre = (esperado, ingreso) => {
  const deEsperado = palabras(esperado.concepto)
  if (deEsperado.size === 0) return false
  const deIngreso = palabras(`${ingreso.nombre || ''} ${ingreso.detalle || ''} ${ingreso.tag || ''}`)
  return [...deEsperado].some(p => deIngreso.has(p))
}

// ¿Este ingreso de una cuenta puede ser el esperado? Devuelve qué tan bien encaja
// (menor es mejor) o null si no encaja.
const encaje = (esperado, ingreso) => {
  if ((ingreso.moneda || 'ARS') !== (esperado.moneda || 'ARS')) return null
  if (ingreso.pendiente) return null
  const dias = diasEntre(esperado.fecha, ingreso.fecha)
  if (!Number.isFinite(dias) || dias < -DIAS_ANTES || dias > DIAS_DESPUES) return null
  const monto = Number(esperado.monto)
  const recibido = Math.abs(Number(ingreso.monto))
  if (!(monto > 0) || !(recibido > 0)) return null
  const diferencia = Math.abs(recibido - monto) / monto
  const conNombre = compartenNombre(esperado, ingreso)
  if (diferencia > (conNombre ? TOLERANCIA_CON_NOMBRE : TOLERANCIA_SIN_NOMBRE)) return null
  // El nombre en común pesa más que todo lo demás; después, el monto más parecido y
  // la fecha más cercana.
  return (conNombre ? 0 : 1000) + diferencia * 100 + Math.abs(dias) / 100
}

// Qué ingreso de las cuentas corresponde a cada esperado: Map(idEsperado → ingreso).
//
// Cada ingreso se usa una sola vez: dos cuotas iguales esperadas en meses seguidos no
// se pueden tachar con el mismo pago. Se reparten en orden de fecha esperada, y cada
// esperado se queda con el ingreso que mejor le encaja de los que quedan. Los tachados
// a mano no consumen ningún ingreso.
export const cruzarConIngresos = (esperados, ingresos) => {
  const usados = new Set()
  const cruce = new Map()
  const ordenados = [...(esperados || [])]
    .filter(e => !e.cobrado_a_mano)
    .sort((a, b) => norm(a.fecha).localeCompare(norm(b.fecha)) || String(a.id).localeCompare(String(b.id)))
  for (const esperado of ordenados) {
    let mejor = null
    let mejorPuntaje = Infinity
    for (const ingreso of ingresos || []) {
      if (ingreso.tipo && ingreso.tipo !== 'ingreso') continue
      if (usados.has(ingreso.id)) continue
      const puntaje = encaje(esperado, ingreso)
      if (puntaje !== null && puntaje < mejorPuntaje) { mejor = ingreso; mejorPuntaje = puntaje }
    }
    if (mejor) { usados.add(mejor.id); cruce.set(esperado.id, mejor) }
  }
  return cruce
}

// Desde qué fecha hay que traer los ingresos de las cuentas para poder cruzarlos.
export const desdeCuandoBuscar = (esperados) => {
  const fechas = (esperados || []).map(e => norm(e.fecha)).filter(Boolean).sort()
  if (fechas.length === 0) return null
  const d = new Date(`${fechas[0]}T00:00:00`)
  d.setDate(d.getDate() - DIAS_ANTES)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Cuánto falta entrar y cuánto ya entró, por moneda.
export const totalesPorMoneda = (esperados, cruce) => {
  const falta = {}
  const entro = {}
  for (const e of esperados || []) {
    const moneda = e.moneda || 'ARS'
    const destino = (e.cobrado_a_mano || cruce?.has(e.id)) ? entro : falta
    destino[moneda] = (destino[moneda] || 0) + (Number(e.monto) || 0)
  }
  return { falta, entro }
}
