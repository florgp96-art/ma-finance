// Pantallas que se muestran solo a una cuenta. Es visibilidad, no seguridad: lo
// que protege los datos son las políticas RLS de cada tabla.

// Liquidación del sueldo de la empleada (components/Liquidacion.js).
export const LIQUIDACION_USER_EMAIL = 'florgp96@gmail.com'

export const puedeVerLiquidacion = (email) =>
  typeof email === 'string' && email.trim().toLowerCase() === LIQUIDACION_USER_EMAIL
