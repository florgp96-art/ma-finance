import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const rateLimitMap = new Map()

function checkRateLimit(ip) {
  const now = Date.now()
  const windowMs = 60 * 1000
  const limit = 20
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
        ['Usuario', userEmail],
        ['Archivo', nombreArchivo || '—'],
        ['Tipo', tipo],
        ['Error', errorMensaje || '—'],
      ]
    : [
        ['Usuario', userEmail],
        ['Archivo', nombreArchivo || '—'],
        ['Tipo', tipo],
        ['Detectado', tarjetaDetectada || '—'],
        ['Documento', tipoDocumento || '—'],
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

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' })

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { tipo, nombreArchivo, estado, errorMensaje, tarjetaDetectada, tipoDocumento, transaccionesDetectadas } = req.body
  if (!tipo || !estado || (estado !== 'exito' && estado !== 'error')) {
    return res.status(400).json({ error: 'Faltan campos o estado inválido' })
  }

  await supabaseAdmin.from('import_logs').insert({
    user_id: user.id,
    tipo,
    nombre_archivo: nombreArchivo || null,
    estado,
    error_mensaje: errorMensaje || null,
    tarjeta_detectada: tarjetaDetectada || null,
    tipo_documento: tipoDocumento || null,
    transacciones_detectadas: transaccionesDetectadas ?? null,
  })

  await enviarNotificacion({
    estado, tipo, nombreArchivo, errorMensaje, tarjetaDetectada, tipoDocumento, transaccionesDetectadas,
    userEmail: user.email,
  })

  res.status(200).json({ ok: true })
}
