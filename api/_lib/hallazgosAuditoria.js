import crypto from 'node:crypto'

// Memoria del mail de auditoría de los viernes (api/cron-auditoria.js). Antes mandaba
// cada semana la lista entera de hallazgos, aunque fueran los mismos de la semana
// anterior. Ahora se guarda qué se avisó (tabla auditoria_hallazgos, ver
// supabase/migrations/20261011000000_auditoria_hallazgos.sql) y el mail lleva solo lo
// nuevo. Lo que se resolvió se borra de la tabla: si vuelve a aparecer, es nuevo.

// La fila que marca que la memoria ya arrancó. Sin ella no se distingue "primera vez"
// de "no quedó ningún hallazgo abierto".
export const CLAVE_INICIO = '__inicio__'

export const claveDeHallazgo = (userId, texto) =>
  crypto.createHash('sha256').update(`${userId}|${texto}`).digest('hex')

// actuales: [{ userId, texto }] de esta corrida. avisadas: las claves guardadas.
// Devuelve qué mandar y qué guardar.
export const compararConAvisados = (actuales, avisadas) => {
  const yaAvisadas = new Set(avisadas || [])
  const primeraVez = !yaAvisadas.has(CLAVE_INICIO)
  const porClave = new Map()
  for (const h of actuales || []) {
    const clave = claveDeHallazgo(h.userId, h.texto)
    if (!porClave.has(clave)) porClave.set(clave, { clave, ...h })
  }
  const vigentes = [...porClave.values()]
  const nuevos = primeraVez ? [] : vigentes.filter(h => !yaAvisadas.has(h.clave))
  const resueltas = [...yaAvisadas].filter(c => c !== CLAVE_INICIO && !porClave.has(c))
  return {
    primeraVez,
    nuevos,
    siguen: primeraVez ? vigentes.length : vigentes.length - nuevos.length,
    vigentes,
    resueltas,
  }
}

// { userId, texto }[] → [{ userId, hallazgos: [texto] }], en el orden en que llegaron.
export const agruparPorUsuario = (hallazgos) => {
  const grupos = new Map()
  for (const h of hallazgos) {
    if (!grupos.has(h.userId)) grupos.set(h.userId, [])
    grupos.get(h.userId).push(h.texto)
  }
  return [...grupos].map(([userId, lista]) => ({ userId, hallazgos: lista }))
}
