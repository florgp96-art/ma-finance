import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from './_lib/rateLimit.js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)


// Cancela la suscripción del usuario logueado. El preapproval_id se busca en
// nuestra propia base (nunca se toma del cliente) para que nadie pueda
// cancelar la suscripción de otra persona.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (!await checkRateLimit(`mp-cancel:${ip}`, 10)) return res.status(429).json({ error: 'Too many requests' })

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

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('mp_preapproval_id, mp_next_payment_date')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.mp_preapproval_id) {
    return res.status(400).json({ error: 'No tenés una suscripción activa' })
  }

  const mpResponse = await fetch(`https://api.mercadopago.com/preapproval/${profile.mp_preapproval_id}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'cancelled' }),
  })

  const mpData = await mpResponse.json()
  if (!mpResponse.ok) {
    console.error('Error cancelando suscripción en Mercado Pago:', mpData)
    return res.status(502).json({ error: 'No se pudo cancelar la suscripción' })
  }

  // Ya pagó este período: mantiene premium hasta la fecha del próximo cobro
  // que ya conocíamos (guardada en cada notificación 'authorized'), no lo
  // cortamos al toque.
  const limite = profile.mp_next_payment_date ? new Date(profile.mp_next_payment_date) : null
  const premiumHasta = limite && limite > new Date() ? limite.toISOString() : null

  await supabaseAdmin.from('user_profiles').update({
    plan: premiumHasta ? 'premium' : 'free',
    mp_status: mpData.status,
    premium_hasta: premiumHasta,
  }).eq('id', user.id)

  res.status(200).json({ ok: true, premiumHasta })
}
