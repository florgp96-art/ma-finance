import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const rateLimitMap = new Map()

function checkRateLimit(ip) {
  const now = Date.now()
  const windowMs = 60 * 1000
  const limit = 30
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

// Notificación de Mercado Pago sobre cambios en una suscripción (preapproval).
// No confiamos en el estado que venga en el body de la notificación: siempre
// volvemos a pedirle el estado real a la API de Mercado Pago con nuestro
// propio access token antes de actualizar algo — así, aunque alguien mande
// un POST falso a esta URL, lo único que puede pasar es que releamos el
// estado real de un preapproval (nunca que se le asigne premium a nadie con
// datos inventados). Para configurar la URL de este webhook en el panel de
// Mercado Pago, agregale "?secret=<MERCADOPAGO_WEBHOOK_SECRET>" como query
// param una vez que esa variable esté configurada en Vercel.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' })

  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (webhookSecret && req.query?.secret !== webhookSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const preapprovalId = req.body?.data?.id || req.body?.id || req.query?.id
  const tipo = req.body?.type || req.body?.topic
  if (!preapprovalId || (tipo && tipo !== 'subscription_preapproval' && tipo !== 'preapproval')) {
    return res.status(200).json({ ok: true, ignored: true })
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!accessToken) {
    console.error('Falta MERCADOPAGO_ACCESS_TOKEN')
    return res.status(200).json({ ok: true })
  }

  const mpResponse = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })
  if (!mpResponse.ok) {
    console.error('Error consultando preapproval en Mercado Pago:', await mpResponse.text())
    return res.status(200).json({ ok: true })
  }
  const preapproval = await mpResponse.json()

  const userId = preapproval.external_reference
  if (!userId) return res.status(200).json({ ok: true })

  const update = {
    id: userId,
    mp_preapproval_id: preapproval.id,
    mp_status: preapproval.status,
  }

  if (preapproval.status === 'authorized') {
    // Cobro al día: sin tope de gracia, y guardamos next_payment_date para
    // saber hasta cuándo vale el período ya pagado si el día de mañana se
    // cancela o se pausa por una tarjeta rechazada.
    update.plan = 'premium'
    update.premium_hasta = null
    update.tuvo_premium = true
    if (preapproval.next_payment_date) update.mp_next_payment_date = preapproval.next_payment_date
  } else if (preapproval.status === 'paused') {
    // Mercado Pago pausa la preapproval cuando falla un cobro (ej. tarjeta
    // vencida) — damos 7 días de margen para actualizar el medio de pago
    // antes de cortar el acceso. No pisamos premium_hasta si ya estaba
    // seteado, para no reiniciar la cuenta atrás en cada notificación repetida.
    const { data: actual } = await supabaseAdmin
      .from('user_profiles')
      .select('plan, premium_hasta')
      .eq('id', userId)
      .maybeSingle()
    update.plan = actual?.plan === 'premium' ? 'premium' : 'free'
    update.premium_hasta = actual?.premium_hasta || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  } else if (preapproval.status === 'cancelled') {
    // Si se canceló desde el botón de la app, mp-cancel-subscription.js ya
    // dejó esto resuelto. Esto cubre que se cancele directo desde Mercado
    // Pago: el límite es el último next_payment_date que conocíamos (el
    // período que ya se pagó), no el de esta respuesta — una vez cancelada,
    // Mercado Pago puede devolverlo vacío.
    const { data: actual } = await supabaseAdmin
      .from('user_profiles')
      .select('mp_next_payment_date')
      .eq('id', userId)
      .maybeSingle()
    const limite = actual?.mp_next_payment_date ? new Date(actual.mp_next_payment_date) : null
    if (limite && limite > new Date()) {
      update.plan = 'premium'
      update.premium_hasta = limite.toISOString()
    } else {
      update.plan = 'free'
      update.premium_hasta = null
    }
  } else {
    update.plan = 'free'
    update.premium_hasta = null
  }

  await supabaseAdmin.from('user_profiles').upsert(update, { onConflict: 'id' })

  res.status(200).json({ ok: true })
}
