import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from './_lib/rateLimit.js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Escapa HTML antes de interpolar cualquier campo controlado por el usuario
// (nombre de archivo, mensaje de error) en el mail — si no, un nombre de
// archivo o error con markup se inyecta tal cual en el mail que llega al owner.
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function enviarNotificacion({ estado, tipo, nombreArchivo, errorMensaje, tarjetaDetectada, tipoDocumento, transaccionesDetectadas, userEmail }) {
  const notifyEmail = process.env.NOTIFY_EMAIL
  const resendKey = process.env.RESEND_API_KEY
  if (!notifyEmail || !resendKey) return

  const esError = estado === 'error'
  const asunto = esError
    ? `❌ Error leyendo ${tipo} — ${userEmail}`
    : `✅ Resumen leído — ${userEmail}`
  const filas = esError
    ? [
        ['Usuario', esc(userEmail)],
        ['Archivo', esc(nombreArchivo || '—')],
        ['Tipo', esc(tipo)],
        ['Error', esc(errorMensaje || '—')],
      ]
    : [
        ['Usuario', esc(userEmail)],
        ['Archivo', esc(nombreArchivo || '—')],
        ['Tipo', esc(tipo)],
        ['Detectado', esc(tarjetaDetectada || '—')],
        ['Documento', esc(tipoDocumento || '—')],
        ['Transacciones', transaccionesDetectadas ?? '—'],
      ]
  const html = `<div style="font-family: sans-serif; font-size: 14px;">
    ${filas.map(([k, v]) => `<p style="margin:4px 0"><strong>${k}:</strong> ${v}</p>`).join('')}
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
        subject: asunto,
        html,
      })
    })
  } catch (e) {
    console.error('Error enviando email de notificación:', e.message)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  if (!await checkRateLimit(`logImport:${user.id}`, 20)) return res.status(429).json({ error: 'Too many requests' })

  const { tipo, nombreArchivo, estado, errorMensaje, tarjetaDetectada, tipoDocumento, transaccionesDetectadas } = req.body
  if (!tipo || !estado || (estado !== 'exito' && estado !== 'error')) {
    return res.status(400).json({ error: 'Faltan campos o estado inválido' })
  }

  const { error: insertError } = await supabaseAdmin.from('import_logs').insert({
    user_id: user.id,
    tipo,
    nombre_archivo: nombreArchivo || null,
    estado,
    error_mensaje: errorMensaje || null,
    tarjeta_detectada: tarjetaDetectada || null,
    tipo_documento: tipoDocumento || null,
    transacciones_detectadas: transaccionesDetectadas ?? null,
  })
  if (insertError) console.error('Error guardando import_log:', insertError.message)

  await enviarNotificacion({
    estado, tipo, nombreArchivo, errorMensaje, tarjetaDetectada, tipoDocumento, transaccionesDetectadas,
    userEmail: user.email,
  })

  res.status(200).json({ ok: true })
}
