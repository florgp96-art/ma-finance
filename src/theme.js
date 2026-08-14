export const APP_NAME = 'MAF'

export const COLORS = {
  bg:             '#F0EDEC',
  primary:        '#5C4F5C',
  surface:        '#FFFFFF',
  text:           '#1d1d1f',
  textSecondary:  '#6e6e73',
  textTertiary:   '#8e8e93',
  border:         '#E2DDE0',
  inputBg:        '#F7F5F6',
  inputBorder:    '#D0C8CC',
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
  surface:       dark ? '#241F24' : '#FFFFFF',
  surfaceAlt:    dark ? '#2A272A' : '#F7F5F8',
  text:          dark ? '#F0EDEC' : '#1d1d1f',
  textSecondary: dark ? '#C0B0C0' : '#6e6e73',
  textTertiary:  dark ? '#9A8A9A' : '#8e8e93',
  border:        dark ? '#3A333A' : '#E2DDE0',
  primary:       dark ? '#8C7B8C' : '#5C4F5C',
  primarySoft:   dark ? '#3A2F4A' : '#EDE8F4',
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
