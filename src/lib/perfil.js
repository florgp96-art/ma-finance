// PERFIL DEL ALTA: lo que se le pregunta al cliente en los primeros pasos y qué hace
// la app con cada respuesta. Cada pregunta tiene que cambiar algo; una respuesta que
// solo quedara guardada sería pedir un dato de más.
//
// Las respuestas se guardan como preferencias (user_rules "__pref__<clave>", igual que
// el resto de las preferencias del Dashboard) y se cambian después desde Configuración.

// Sin auto, estas subcategorías de Transporte no se ofrecen al cargar o editar un
// gasto. Solo las del sistema: una que el cliente creó a mano la creó por algo.
export const SUBCATEGORIAS_DE_AUTO = ['Auto', 'Nafta', 'Service Auto', 'Telepase', 'Estacionamiento']

export const subcategoriasParaElegir = (subcategorias, { tieneAuto } = {}) => {
  if (tieneAuto !== false) return subcategorias || []
  const deAuto = new Set(SUBCATEGORIAS_DE_AUTO)
  return (subcategorias || []).filter(s => !(deAuto.has(s.nombre) && !s.user_id))
}

// Con mascotas se crea esta categoría propia (Veterinaria hoy vive dentro de Casa).
export const CATEGORIA_MASCOTAS = 'Mascotas'
export const SUBCATEGORIAS_MASCOTAS = ['Veterinaria', 'Alimento', 'Peluquería', 'Accesorios']

// Bancos y billeteras que se ofrecen en el alta. En un banco la cuenta es la caja de
// ahorro; una billetera es la cuenta misma.
export const BANCOS = ['Galicia', 'Santander', 'BBVA', 'Macro', 'Nación', 'Provincia', 'ICBC']
export const BILLETERAS = ['Mercado Pago', 'Ualá', 'Brubank', 'Naranja X']
export const TARJETAS = ['Visa', 'Mastercard', 'American Express', 'Naranja', 'Cabal']

const clave = (nombre) => String(nombre || '').trim().toLowerCase()

// Las cuentas que hay que crear por lo que eligió en el alta, sin repetir las que ya
// tiene (un reintento del alta no las duplica).
//
// Una tarjeta lleva el nombre del banco cuando eligió uno solo ("Visa Galicia"): con
// dos bancos no se puede saber de cuál es, y queda "Visa" para que la renombre.
export const cuentasDelAlta = ({ bancos = [], billeteras = [], tarjetas = [], existentes = [] }) => {
  const yaEsta = new Set((existentes || []).map(a => clave(a.nombre)))
  const nuevas = []
  const agregar = (cuenta) => {
    if (yaEsta.has(clave(cuenta.nombre))) return
    yaEsta.add(clave(cuenta.nombre))
    nuevas.push(cuenta)
  }
  bancos.forEach(b => agregar({ nombre: `Caja de Ahorro ${b}`, tipo: 'debito' }))
  billeteras.forEach(b => agregar({ nombre: b, tipo: 'debito' }))
  const unSoloBanco = bancos.length === 1 ? bancos[0] : null
  tarjetas.forEach(t => agregar({ nombre: unSoloBanco && t !== 'Naranja' ? `${t} ${unSoloBanco}` : t, tipo: 'credito' }))
  return nuevas
}
