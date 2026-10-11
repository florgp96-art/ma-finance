// Fotos para leer con la IA (api/analyzeImage.js).
//
// Vercel corta cualquier pedido de más de 4,5 MB y la foto viaja en base64 (+33 %):
// una foto del celular de 4 MB nunca llegaba ("Load failed"). Se achica antes de
// mandarla al tamaño que usa la IA de todos modos (ella misma reduce cualquier imagen
// a 1568 px de lado y ~1,15 megapíxeles), así que se lee igual de bien.

export const LADO_MAXIMO = 1568
export const PIXELES_MAXIMOS = 1_150_000
// Hasta esto se manda tal cual si ya es un formato que la IA acepta.
export const BYTES_SIN_ACHICAR = 1_500_000
const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// Ancho y alto finales: nunca más grandes que el original.
export const medidasAjustadas = (ancho, alto) => {
  if (!(ancho > 0) || !(alto > 0)) return { ancho: 0, alto: 0 }
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto), Math.sqrt(PIXELES_MAXIMOS / (ancho * alto)))
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) }
}

const leerComoDataURL = (blob) => new Promise((resolve, reject) => {
  const lector = new FileReader()
  lector.onload = () => resolve(lector.result)
  lector.onerror = () => reject(new Error('No se pudo leer la imagen.'))
  lector.readAsDataURL(blob)
})

const abrirImagen = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen.')) }
  img.src = url
})

// Devuelve { base64, mediaType } listo para mandar.
export async function prepararImagen(file) {
  if (TIPOS_ACEPTADOS.includes(file.type) && file.size <= BYTES_SIN_ACHICAR) {
    const dataUrl = await leerComoDataURL(file)
    return { base64: dataUrl.split(',')[1], mediaType: file.type }
  }
  let img
  try {
    img = await abrirImagen(file)
  } catch {
    throw new Error('No se pudo abrir la foto. Probá con una captura de pantalla o una foto en JPG o PNG.')
  }
  const { ancho, alto } = medidasAjustadas(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const ctx = canvas.getContext('2d')
  // Fondo blanco: un PNG con transparencia pasado a JPG quedaría con fondo negro.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, ancho, alto)
  ctx.drawImage(img, 0, 0, ancho, alto)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('No se pudo preparar la foto. Probá con una captura de pantalla.')
  const dataUrl = await leerComoDataURL(blob)
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' }
}
