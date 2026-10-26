import { eurosPorTipoDeDolar, filasDeCotizacionDelMes } from '../../src/lib/cotizaciones.js'

// Guarda las cotizaciones de hoy como las del mes en exchange_rates: cada dólar (blue,
// MEP, oficial, tarjeta), el euro oficial y el euro de cada tipo de dólar. Con eso la
// app convierte los movimientos de un mes que ya pasó con el TC de ese mes y no con el
// de hoy. Antes no lo hacía nadie para el dólar (la tabla se cortaba en mayo de 2026),
// y el navegador solo puede guardar el euro oficial: las políticas de la tabla no le
// dejan escribir otra cosa, así que esto va acá, con la service role, una vez por día.

const promedio = ({ compra, venta } = {}) => (compra != null && venta != null
  ? Math.round((compra + venta) / 2)
  : Math.round(venta || compra || 0))

const CASA_A_TIPO = { blue: 'blue', bolsa: 'mep', oficial: 'oficial', tarjeta: 'tarjeta' }

// El mes en Argentina: el cron corre a las 3 UTC, que allá es medianoche.
export const mesArgentino = (ahora = new Date()) =>
  new Date(ahora.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)

export async function guardarCotizacionesDelMes(supabase, { fetch: pedir = fetch, ahora = new Date() } = {}) {
  const leer = async (url) => {
    try {
      const res = await pedir(url)
      return res.ok ? await res.json() : null
    } catch {
      return null
    }
  }
  const [dolares, euro] = await Promise.all([
    leer('https://dolarapi.com/v1/dolares'),
    leer('https://dolarapi.com/v1/cotizaciones/eur'),
  ])
  const cotizaciones = {}
  for (const d of Array.isArray(dolares) ? dolares : []) {
    const tipo = CASA_A_TIPO[d?.casa]
    if (tipo && promedio(d) > 0) cotizaciones[tipo] = promedio(d)
  }
  if (promedio(euro || {}) > 0) cotizaciones.eur = promedio(euro)
  Object.assign(cotizaciones, eurosPorTipoDeDolar(cotizaciones))

  const filas = filasDeCotizacionDelMes(cotizaciones, mesArgentino(ahora))
  if (filas.length === 0) return { guardadas: 0 }
  const { error } = await supabase.from('exchange_rates').upsert(filas, { onConflict: 'periodo,tipo' })
  return error ? { guardadas: 0, error: error.message } : { guardadas: filas.length }
}
