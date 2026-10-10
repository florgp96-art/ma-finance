import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from './_lib/rateLimit.js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Todo lo que manda el cliente se escapa antes de ir al HTML del mail.
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  if (!await checkRateLimit(`reportBug:${user.id}`, 10)) return res.status(429).json({ error: 'Too many requests' })

  // adjunto: el resumen que se leyó mal, cuando el aviso sale del botón "Algo no se
  // leyó bien" de la importación. Lo manda la persona a propósito, sabiendo que lo
  // recibe quien administra la app (ver reportarLecturaMala en el Dashboard).
  const { mensaje, pagina, adjunto } = req.body
  if (!mensaje || typeof mensaje !== 'string' || !mensaje.trim()) {
    return res.status(400).json({ error: 'Falta describir el error' })
  }
  if (mensaje.length > 4000) {
    return res.status(400).json({ error: 'El mensaje es demasiado largo' })
  }
  // El cuerpo de una función de Vercel no puede pasar de 4,5 MB: un PDF más grande
  // ni siquiera llega, y la app lo manda sin adjunto.
  const adjuntoValido = adjunto && typeof adjunto.base64 === 'string' && adjunto.base64.length <= 4_200_000 &&
    typeof adjunto.nombre === 'string' && adjunto.nombre.trim()
  if (adjunto && !adjuntoValido) return res.status(400).json({ error: 'Adjunto inválido' })

  const notifyEmail = process.env.NOTIFY_EMAIL
  const resendKey = process.env.RESEND_API_KEY
  if (notifyEmail && resendKey) {
    const html = `<div style="font-family: sans-serif; font-size: 14px;">
      <p style="margin:4px 0"><strong>Usuario:</strong> ${esc(user.email)}</p>
      <p style="margin:4px 0"><strong>Página:</strong> ${esc(typeof pagina === 'string' ? pagina.slice(0, 200) : '—')}</p>
      <p style="margin:4px 0"><strong>Fecha:</strong> ${new Date().toISOString()}</p>
      <p style="margin:12px 0 4px 0"><strong>Descripción:</strong></p>
      <p style="margin:4px 0; white-space: pre-wrap;">${esc(mensaje)}</p>
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
          subject: adjuntoValido ? `📄 Resumen que no se leyó bien — ${user.email}` : `🐞 Reporte de error — ${user.email}`,
          html,
          ...(adjuntoValido ? { attachments: [{ filename: adjunto.nombre.trim().slice(0, 120), content: adjunto.base64 }] } : {}),
        })
      })
    } catch (e) {
      console.error('Error enviando email de reporte de bug:', e.message)
      return res.status(502).json({ error: 'No se pudo enviar el reporte' })
    }
  }

  res.status(200).json({ ok: true })
}
