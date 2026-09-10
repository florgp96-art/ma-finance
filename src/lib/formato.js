// Formato de montos y fechas. Vive en lib y no en un componente porque lo usa
// media app — y porque tenerlo en AccountDetail obligaba a cualquier componente
// nuevo a importar desde ahí, lo que crea un ciclo apenas AccountDetail importa
// ese componente de vuelta.

export const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(monto)

export const formatMontoFull = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)

export const formatFecha = (f) => f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : ''

// Fecha corta para las tablas de movimientos. Se omite el año SOLO si es del año
// en curso: mezclado con movimientos viejos, "28/06" no dice de qué año es (y en
// una lista con cosas de 2023 y de hoy eso es directamente confuso). En ese caso
// se agrega el año en dos dígitos, que entra en el ancho de columna existente.
export const formatFechaCorta = (f) => {
  if (!f) return ''
  const corta = f.slice(8, 10) + '/' + f.slice(5, 7)
  const esDeEsteAnio = f.slice(0, 4) === String(new Date().getFullYear())
  return esDeEsteAnio ? corta : corta + '/' + f.slice(2, 4)
}
