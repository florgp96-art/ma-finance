import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const rateLimitMap = new Map()

function checkRateLimit(ip) {
  const now = Date.now()
  const windowMs = 60 * 1000
  const limit = 10
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  const entry = rateLimitMap.get(ip)
  if (now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

// Crea una suscripción recurrente en Mercado Pago (preapproval) para el
// usuario logueado y devuelve la URL de checkout a la que redirigirlo. El
// estado real (autorizada/pausada/cancelada) se confirma después por
// webhook (ver mp-webhook.js) — este endpoint no marca a nadie como premium.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' })

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
