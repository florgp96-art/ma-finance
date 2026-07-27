import { secretsMatch } from './_lib/secretsMatch.js'

// Escapa HTML antes de interpolar campos controlados por quien se registra
// (el nombre completo lo elige el propio usuario en el form de alta) — si no,
// se puede inyectar markup en el mail que llega al owner.
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Recibe el Database Webhook de Supabase en auth.users (evento INSERT) y
// avisa por mail cada vez que alguien se registra. Protegido con un secreto
// compartido (no con el token del usuario: acá todavía no hay sesión propia,
// el registro puede requerir confirmación por email antes de existir una).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (!secretsMatch(req.headers['authorization'], `Bearer ${process.env.SUPABASE_WEBHOOK_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const notifyEmail = process.env.NOTIFY_EMAIL
  const resendKey = process.env.RESEND_API_KEY
  if (notifyEmail && resendKey) {
    const record = req.body?.record || {}
    const email = record.email || 'desconocido'
    const nombre = record.raw_user_meta_data?.full_name || '—'
    const fecha = record.created_at || new Date().toISOString()

    const html = `<div style="font-family: sans-serif; font-size: 14px;">
      <p style="margin:4px 0"><strong>Usuario:</strong> ${esc(email)}</p>
      <p style="margin:4px 0"><strong>Nombre:</strong> ${esc(nombre)}</p>
      <p style="margin:4px 0"><strong>Fecha:</strong> ${esc(fecha)}</p>
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
          subject: `🆕 Nuevo registro — ${email}`,
          html,
        })
      })
    } catch (e) {
      console.error('Error enviando email de notificación de registro:', e.message)
    }
  }

  res.status(200).json({ ok: true })
}
