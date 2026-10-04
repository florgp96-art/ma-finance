export const APP_NAME = 'MAF'

export const COLORS = {
  bg:             '#F0EDEC',
  primary:        'var(--m-5c4f5c)',
  surface:        '#FFFFFF',
  text:           '#1d1d1f',
  textSecondary:  '#6e6e73',
  textTertiary:   '#8e8e93',
  border:         'var(--m-e2dde0)',
  inputBg:        'var(--m-f7f5f6)',
  inputBorder:    'var(--m-d0c8cc)',
  errorText:      '#c0392b',
  errorBg:        '#fff0f0',
  errorBorder:    '#fcc',
}

export const FONT = {
  family: '"Montserrat", sans-serif',
}

export const RADIUS = {
  sm:  '10px',
  md:  '12px',
  lg:  '20px',
  xl:  '24px',
}

export const SIDEBAR_WIDTH = 240

// Paleta por tema, en un solo lugar. Antes cada archivo repetía sus hex a mano
// (111 colores distintos en la app, 47 de ellos usados una sola vez, con grupos a
// un punto de diferencia entre sí), y una pantalla entera —el onboarding— se había
// quedado sin modo oscuro y con un violeta de acento que no era el de la app.
export const paleta = (dark) => ({
  bg:            dark ? '#1C1A1C' : '#F0EDEC',
  surface:       dark ? 'var(--m-241f24)' : '#FFFFFF',
  surfaceAlt:    dark ? '#2A272A' : 'var(--m-f7f5f8)',
  text:          dark ? '#F0EDEC' : '#1d1d1f',
  textSecondary: dark ? 'var(--m-c0b0c0)' : '#6e6e73',
  textTertiary:  dark ? 'var(--m-9a8a9a)' : '#8e8e93',
  border:        dark ? 'var(--m-3a333a)' : 'var(--m-e2dde0)',
  primary:       dark ? 'var(--m-8c7b8c)' : 'var(--m-5c4f5c)',
  primarySoft:   dark ? 'var(--m-3a2f4a)' : 'var(--m-ede8f4)',
  errorText:     dark ? '#E88A8A' : '#c0392b',
})

// Verde/rojo/azul de significado (saldo a favor, saldo en contra, importes en
// dólares, vencimiento cerca). Los hex originales se eligieron mirando el modo
// claro y se usaban igual en oscuro: ahí el verde de un balance quedaba en
// 2,95:1 contra el panel y el rojo de un porcentaje en 2,72:1, los dos por
// debajo del mínimo legible. El azul del USD fallaba al revés, en claro, sobre
// su tarjeta celeste (3,4:1). Cada uno necesita su variante por tema.
export const semaforo = (dark) => ({
  positivo: dark ? '#6FBF87' : '#3a7d44',
  negativo: dark ? '#F0847A' : '#c0392b',
  alerta:   dark ? '#E0A050' : '#9c5f18',
  usd:      dark ? '#8FC4E0' : '#3d6f8f',
  teal:     dark ? '#5FC49E' : '#2e8b6a',
})

// El tema vive en localStorage porque lo elige el usuario desde el Dashboard y
// tiene que sobrevivir a un refresh. Las pantallas de afuera del Dashboard
// (onboarding, login) lo leen de acá para no quedar en claro cuando el resto de la
// app está en oscuro.
export const leerDarkMode = () =>
  typeof window !== 'undefined' && localStorage.getItem('darkmode_ma') === 'true'

// MOM'S ASSIST / DAD'S ASSIST. Lo elige cada persona (en el alta o en Configuración
// → Mi perfil); la app no lo deduce de nada. Cambia el logo, el nombre de la pestaña
// y los colores de marca: los violetas de la interfaz son variables CSS (--m-xxxxxx,
// ver index.css) que con data-modo="dad" pasan a un azul acero con el mismo brillo.
// Vive en localStorage para que el login ya salga con el logo que corresponde, y en
// las preferencias de la cuenta para que siga a la persona en otro dispositivo.
export const MODOS = {
  mom: { nombre: "Mom's Assist", logo: '/logo.png' },
  dad: { nombre: "Dad's Assist", logo: '/logo-dad.png' },
}
const CLAVE_MODO = 'modo_ma'

export const modoValido = (modo) => (modo === 'dad' ? 'dad' : 'mom')

export const leerModo = () => {
  try { return modoValido(typeof window !== 'undefined' ? localStorage.getItem(CLAVE_MODO) : null) } catch { return 'mom' }
}

export const logoDelModo = (modo = leerModo()) => (process.env.PUBLIC_URL || '') + MODOS[modoValido(modo)].logo

export const aplicarModoAlDocumento = (modo = leerModo()) => {
  const elegido = modoValido(modo)
  try { localStorage.setItem(CLAVE_MODO, elegido) } catch {}
  if (typeof document === 'undefined') return
  document.documentElement.dataset.modo = elegido
  document.title = `${MODOS[elegido].nombre} Finance`
}

// Deja el tema elegido en <html data-theme>, para las reglas de index.css que no
// se pueden escribir como estilo inline (el relleno automático del navegador).
// Se llama al arrancar y cada vez que se toca el interruptor del Dashboard.
export const aplicarTemaAlDocumento = (dark = leerDarkMode()) => {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  // theme-color pinta la barra del navegador y el fondo que asoma al hacer
  // scroll de más. Arrancaba fijo en el violeta de marca y solo cambiaba al
  // tocar el interruptor: ahora sigue al fondo real de la app desde el arranque.
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#1C1A1C' : '#F0EDEC')
}
