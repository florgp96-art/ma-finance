import { lazy } from 'react'

// Las partes pesadas de la app (cada pantalla, pdf.js, xlsx) se descargan recién
// cuando hacen falta. El riesgo: cada despliegue cambia los nombres de esos archivos,
// y alguien que tenía la app abierta desde antes pide uno que ya no existe. Acá se
// reintenta una vez (por si fue la red) y, si sigue sin estar, es que hay una versión
// nueva: una pantalla se recarga sola; en medio de una importación se avisa.

const CLAVE_RECARGA = 'ma_recarga_por_version'
export const MENSAJE_VERSION_NUEVA = 'La app se actualizó. Recargá la página para seguir.'

export const esErrorDeCarga = (e) => e?.name === 'ChunkLoadError' ||
  /Loading (CSS )?chunk|dynamically imported module|Importing a module script failed/i.test(String(e?.message || ''))

// Recarga la página, pero no dos veces seguidas: si después de recargar el archivo
// sigue sin aparecer, el problema es otro y recargar en bucle no lo arregla.
const recargarUnaVez = () => {
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE_RECARGA) || 0)
    if (Date.now() - ultima < 30000) return false
    sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export const importarModulo = async (importar, { recargar = false } = {}) => {
  try {
    return await importar()
  } catch (e) {
    if (!esErrorDeCarga(e)) throw e
    try {
      return await importar()
    } catch (e2) {
      if (!esErrorDeCarga(e2)) throw e2
      // La página se está recargando: esta promesa no hace falta que termine.
      if (recargar && recargarUnaVez()) return new Promise(() => {})
      throw new Error(MENSAJE_VERSION_NUEVA)
    }
  }
}

// React.lazy con lo de arriba: una pantalla que no se pudo bajar recarga la app.
export const lazyConRecarga = (importar) => lazy(() => importarModulo(importar, { recargar: true }))
