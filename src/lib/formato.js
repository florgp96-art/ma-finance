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

const DIAS_DE_LA_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Día de la semana de un día de un mes: diaDeLaSemana('2026-09', 1) → 'martes'.
// '' si el día no existe en ese mes (ej. 31 de septiembre).
export const diaDeLaSemana = (mes, dia) => {
  const partes = /^(\d{4})-(\d{2})$/.exec(String(mes || ''))
  const numero = Number(dia)
  if (!partes || !Number.isInteger(numero) || numero < 1) return ''
  const indiceMes = Number(partes[2]) - 1
  const fecha = new Date(Number(partes[1]), indiceMes, numero)
  return fecha.getMonth() === indiceMes ? DIAS_DE_LA_SEMANA[fecha.getDay()] : ''
}

// Cantidades que pueden tener decimales (horas): "60", "4,5", "2,25".
export const formatCantidad = (n) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n)

// Un importe tipeado a mano, como número, o null si no se entiende.
//
// Los campos de importe son de texto y no type="number": el teclado numérico del
// iPhone en español trae coma y no punto, y un type="number" la rechaza, así que no
// había forma de cargar centavos desde el celular. Acá se aceptan las dos formas:
//   "898212"      → 898212
//   "898212,50"   → 898212.5     coma decimal (la del teclado del celular)
//   "898.212,50"  → 898212.5     puntos de miles y coma decimal
//   "1.234.567"   → 1234567      solo puntos de miles
//   "1.500"       → 1500         un punto y tres cifras: en Argentina son miles
//   "1234.56"     → 1234.56      punto decimal (teclado de computadora)
// Acepta el signo menos adelante: un saldo puede ser negativo (cuenta en descubierto).
export const parseMonto = (valor) => {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  let texto = String(valor).replace(/\s/g, '')
  const negativo = texto.startsWith('-')
  if (negativo) texto = texto.slice(1)
  if (!/^[\d.,]+$/.test(texto)) return null
  const comas = (texto.match(/,/g) || []).length
  const puntos = (texto.match(/\./g) || []).length
  if (comas > 1) return null
  if (comas === 1) {
    if (puntos > 0 && !/^\d{1,3}(\.\d{3})+,\d*$/.test(texto)) return null
    texto = texto.replace(/\./g, '').replace(',', '.')
  } else if (puntos > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(texto)) return null
    texto = texto.replace(/\./g, '')
  } else if (/^[1-9]\d{0,2}\.\d{3}$/.test(texto)) {
    texto = texto.replace('.', '')
  }
  if (!/\d/.test(texto)) return null
  const n = Number(texto)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

// Un número guardado, listo para precargar un campo de importe: con coma decimal,
// como se tipea en el celular. Con punto, un monto de 1,234 quedaba "1.234" en el
// campo y parseMonto lo volvía a leer como mil doscientos treinta y cuatro.
export const montoParaEditar = (valor) => {
  const n = Number(valor)
  return valor === null || valor === undefined || valor === '' || !Number.isFinite(n) ? '' : String(n).replace('.', ',')
}
