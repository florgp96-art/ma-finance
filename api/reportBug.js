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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' })

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { mensaje, pagina } = req.body
  if (!mensaje || typeof mensaje !== 'string' || !mensaje.trim()) {
    return res.status(400).json({ error: 'Falta describir el error' })
  }
  if (mensaje.length > 4000) {
    return res.status(400).json({ error: 'El mensaje es demasiado largo' })
  }

  const notifyEmail = process.env.NOTIFY_EMAIL
  const resendKey = process.env.RESEND_API_KEY
  if (notifyEmail && resendKey) {
    const html = `<div style="font-family: sans-serif; font-size: 14px;">
      <p style="margin:4px 0"><strong>Usuario:</strong> ${user.email}</p>
      <p style="margin:4px 0"><strong>Página:</strong> ${pagina || '—'}</p>
      <p style="margin:4px 0"><strong>Fecha:</strong> ${new Date().toISOString()}</p>
      <p style="margin:12px 0 4px 0"><strong>Descripción:</strong></p>
      <p style="margin:4px 0; white-space: pre-wrap;">${mensaje.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    </div>`

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: "Mom's Assist <onboarding@resend.dev>",
          to: notifyEmail,
          subject: `🐞 Reporte de error — ${user.email}`,
          html,
        })
      })
    } catch (e) {
      console.error('Error enviando email de reporte de bug:', e.message)
      return res.status(502).json({ error: 'No se pudo enviar el reporte' })
    }
  }

  res.status(200).json({ ok: true })
}
