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

// El tema vive en localStorage porque lo elige el usuario desde el Dashboard y
// tiene que sobrevivir a un refresh. Las pantallas de afuera del Dashboard
// (onboarding, login) lo leen de acá para no quedar en claro cuando el resto de la
// app está en oscuro.
export const leerDarkMode = () =>
  typeof window !== 'undefined' && localStorage.getItem('darkmode_ma') === 'true'
