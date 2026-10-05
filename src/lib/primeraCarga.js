// PRIMERA CARGA GUIADA: después del alta, la lista de cuentas a las que todavía les
// falta un resumen cargado (ver components/PrimeraCarga.js).
//
// La idea es que una persona que no conoce a la dueña de la app arranque sola: sube
// el último resumen de cada tarjeta y el último extracto de cada cuenta, el lector
// controla que cada uno cierre con su total (y si no, lo revisa solo), y la app
// queda con datos reales desde el primer día. Las cuentas salen del alta (bancos y
// tarjetas que eligió) o se crean solas al importar.

// Efectivo e Ingresos no tienen resumen que subir.
export const cuentasACargar = (accounts) => (accounts || []).filter(a => a.tipo === 'credito' || a.tipo === 'debito')

// idsConDatos: las cuentas que ya tienen algún resumen o movimiento cargado.
export const estadoPrimeraCarga = (accounts, idsConDatos) => {
  const conDatos = idsConDatos instanceof Set ? idsConDatos : new Set(idsConDatos || [])
  const cuentas = cuentasACargar(accounts).map(a => ({ id: a.id, nombre: a.nombre, tipo: a.tipo, cargada: conDatos.has(a.id) }))
  const cargadas = cuentas.filter(c => c.cargada).length
  return { cuentas, cargadas, total: cuentas.length, completa: cuentas.length > 0 && cargadas === cuentas.length }
}
