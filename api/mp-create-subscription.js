import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from './_lib/rateLimit.js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)


// Crea una suscripción recurrente en Mercado Pago (preapproval) para el
// usuario logueado y devuelve la URL de checkout a la que redirigirlo. El
// estado real (autorizada/pausada/cancelada) se confirma después por
// webhook (ver mp-webhook.js) — este endpoint no marca a nadie como premium.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (!await checkRateLimit(`mp-create:${ip}`, 10)) return res.status(429).json({ error: 'Too many requests' })

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!accessToken) {
    console.error('Falta MERCADOPAGO_ACCESS_TOKEN')
    return res.status(500).json({ error: 'Suscripciones no disponibles todavía' })
  }

  // Sin este chequeo, abandonar un checkout y tocar "Suscribirme" de nuevo
  // crea una segunda preapproval en Mercado Pago y pisa la referencia a la
  // primera en nuestra base — si esa primera se termina autorizando, queda
  // cobrando todos los meses sin que la app pueda verla ni cancelarla.
  const { data: existente } = await supabaseAdmin
    .from('user_profiles')
    .select('mp_status')
    .eq('id', user.id)
    .maybeSingle()
  if (existente?.mp_status === 'authorized' || existente?.mp_status === 'pending') {
    return res.status(409).json({ error: 'Ya tenés una suscripción activa o pendiente de confirmación' })
  }

  const precioArs = Number(process.env.MERCADOPAGO_PRICE_ARS || 3999)
  const origin = req.headers.origin || `https://${req.headers.host}`

  const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: "Mom's Assist Premium — suscripción mensual",
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: precioArs,
        currency_id: 'ARS',
      },
      back_url: `${origin}/dashboard?mp=return`,
      payer_email: user.email,
      external_reference: user.id,
      status: 'pending',
    }),
  })

  const mpData = await mpResponse.json()
  if (!mpResponse.ok) {
    console.error('Error creando suscripción en Mercado Pago:', mpData)
    return res.status(502).json({ error: 'No se pudo crear la suscripción', detail: mpData?.message })
  }

  await supabaseAdmin.from('user_profiles').upsert(
    { id: user.id, mp_preapproval_id: mpData.id, mp_status: mpData.status },
    { onConflict: 'id' }
  )

  res.status(200).json({ checkoutUrl: mpData.init_point || mpData.sandbox_init_point })
}
