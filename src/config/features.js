// Pantallas que se muestran solo a una cuenta. Es visibilidad, no seguridad: lo
// que protege los datos son las políticas RLS de cada tabla.

// Liquidación del sueldo de la empleada (components/Liquidacion.js).
export const LIQUIDACION_USER_EMAIL = 'florgp96@gmail.com'

export const puedeVerLiquidacion = (email) =>
  typeof email === 'string' && email.trim().toLowerCase() === LIQUIDACION_USER_EMAIL

// Cobrado / a cobrar, pagado / a pagar y facturado en cada movimiento: solo para la
// cuenta donde se lleva la contabilidad de GPK Marketing (la lee su oficina de agentes).
export const GPK_USER_EMAIL = 'video33lut@gmail.com'

export const puedeVerCobroFacturacion = (email) =>
  typeof email === 'string' && email.trim().toLowerCase() === GPK_USER_EMAIL

// Percepciones de los consumos en dólares que el banco no cobra cuando los dólares se
// pagan con dólares: el resumen las trae igual, y sin esto quedaban como saldo
// pendiente (ver calcularStatementsPendientes, descontarPercepciones).
export const PERCEPCIONES_USER_EMAIL = 'florgp96@gmail.com'

export const descuentaPercepcionesEnDolares = (email) =>
  typeof email === 'string' && email.trim().toLowerCase() === PERCEPCIONES_USER_EMAIL
