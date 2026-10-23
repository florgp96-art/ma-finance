import { useSyncExternalStore } from 'react'
import { importarModulo } from '../lib/cargaDiferida'

// Idioma de la interfaz. La app está escrita en español; el inglés se pone encima
// (ver traduccionEnVivo.js) y su diccionario se descarga solo si alguien lo elige.
// Vive en localStorage, como el tema: lo elige cada persona en este dispositivo y
// tiene que sobrevivir a un refresh y al login.
//
// Un link con ?lang=en (o ?lang=es) abre la app directamente en ese idioma: sirve
// para mandársela a alguien que no habla español.

export const IDIOMAS = ['es', 'en']
const CLAVE = 'idioma_ma'

export const idiomaValido = (idioma) => (idioma === 'en' ? 'en' : 'es')

const delLink = () => {
  try {
    const pedido = new URLSearchParams(window.location.search).get('lang')
    return IDIOMAS.includes(pedido) ? pedido : null
  } catch {
    return null
  }
}

let actual = (() => {
  if (typeof window === 'undefined') return 'es'
  const pedido = delLink()
  if (pedido) {
    try { localStorage.setItem(CLAVE, pedido) } catch {}
    return pedido
  }
  try { return idiomaValido(localStorage.getItem(CLAVE)) } catch { return 'es' }
})()

const suscriptos = new Set()
let pedidos = 0

export const leerIdioma = () => actual

let inglesPedido = false

const cargarIngles = () => {
  inglesPedido = true
  return importarModulo(() => Promise.all([
    import('./traduccionEnVivo'),
    import('./en.json'),
  ]))
}

// Deja la página en el idioma pedido. Si se cambia dos veces seguidas antes de que
// baje el diccionario, gana el último pedido.
export const aplicarIdiomaAlDocumento = async (idioma = actual) => {
  const elegido = idiomaValido(idioma)
  const pedido = ++pedidos
  if (typeof document !== 'undefined') document.documentElement.lang = elegido
  // En español no hay nada que poner encima: si nunca se pidió el inglés, no se baja.
  if (elegido === 'es' && !inglesPedido) return
  try {
    const [vivo, diccionario] = await cargarIngles()
    if (pedido !== pedidos) return
    if (elegido === 'en') vivo.activarTraduccion(diccionario.default || diccionario)
    else vivo.desactivarTraduccion()
  } catch (e) {
    // Sin el diccionario la app sigue andando, en español.
    if (elegido === 'en') console.warn('No se pudo cargar la traducción al inglés:', e)
  }
}

export const cambiarIdioma = (idioma) => {
  const elegido = idiomaValido(idioma)
  if (elegido === actual) return
  actual = elegido
  try { localStorage.setItem(CLAVE, elegido) } catch {}
  suscriptos.forEach((avisar) => avisar())
  aplicarIdiomaAlDocumento(elegido)
}

const suscribir = (avisar) => {
  suscriptos.add(avisar)
  return () => suscriptos.delete(avisar)
}

export const useIdioma = () => useSyncExternalStore(suscribir, leerIdioma, () => 'es')
