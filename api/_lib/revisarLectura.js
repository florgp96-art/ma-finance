import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { buildAnalysisPrompt } from './analyzePrompt.js'
import { checkRateLimit } from './rateLimit.js'
import { getUserPlan } from './plan.js'
import { leerNotasFormato, guardarNotaFormato, avisarNotaNueva } from './formatosLectura.js'
import { controlDeLectura } from '../../src/lib/controlLectura.js'
import {
  bloqueRevision, ESQUEMA_REVISION, aplicarRevision, compararControles,
  claveDeFormato, etiquetaDeFormato, limpiarNotaFormato,
} from '../../src/lib/revisionLectura.js'

// Segunda lectura de un resumen de tarjeta cerrado o un extracto de banco que no
// cerró con su total (ver src/lib/revisionLectura.js). La pide la app sola, antes de mostrar la vista
// previa, con el mismo PDF (o el mismo texto) que leyó la primera vez.
//
// Entra por /api/analyze?revision=1 y no como función propia: el plan Hobby de
// Vercel admite como máximo 12 funciones por despliegue, y con una más el
// despliegue entero falla.
//
// No consume el resumen gratis del mes: es la corrección de una lectura que ya se
// cobró. Para que no sirva de puerta trasera al cupo, un usuario del plan gratis
// solo puede pedirla si acaba de hacer una lectura con IA (ver VENTANA_CUPO_MS).

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

// Margen para que la función responda (con la primera lectura) antes de que
// Vercel la corte a los 300 s.
const PLAZO_REVISION_MS = 240_000
const VENTANA_CUPO_MS = 30 * 60 * 1000

async function puedeRevisar(userId) {
  let plan
  try {
    plan = await getUserPlan(supabaseAdmin, userId)
  } catch (e) {
    console.error('Error leyendo plan del usuario:', e.message)
    return true
  }
  if (plan.isPremium) return true
  if (plan.tuvoPremium) return false
  const { count } = await supabaseAdmin
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - VENTANA_CUPO_MS).toISOString())
  return (count || 0) > 0
}

// Los nombres que leyó la IA (titular de cada movimiento y adicionales), para
// sacarlos de la nota antes de compartirla.
const nombresDelResumen = (resultado) => [
  ...(Array.isArray(resultado.adicionales) ? resultado.adicionales : []),
  ...resultado.transacciones.map(t => t.titular),
].filter(n => typeof n === 'string' && n.trim())

export async function revisarLectura(req, res) {

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  if (!await checkRateLimit(`revisarLectura:${user.id}`, 10)) return res.status(429).json({ error: 'Too many requests' })

  const { pdfText, pdfBase64, resultado, cardName, userRules, incomeExamples, categories, subcategories, children, aliases } = req.body || {}
  if (!['tarjeta', 'banco'].includes(resultado?.tipo_documento) || !Array.isArray(resultado.transacciones) || resultado.transacciones.length > 600) {
    return res.status(400).json({ error: 'Lectura inválida' })
  }
  if (pdfBase64) {
    if (typeof pdfBase64 !== 'string' || pdfBase64.length > 9_500_000) return res.status(400).json({ error: 'PDF inválido' })
  } else if (typeof pdfText !== 'string' || !pdfText || pdfText.length > 200_000) {
    return res.status(400).json({ error: 'Falta el resumen' })
  }

  if (!await puedeRevisar(user.id)) return res.status(402).json({ error: 'Sin revisión en este plan', code: 'SIN_REVISION' })

  const antes = controlDeLectura(resultado)
  if (antes.cuadra !== false) return res.status(200).json({ resultado, revision: { estado: 'no_hacia_falta' } })

  const notasFormato = await leerNotasFormato(supabaseAdmin)
  const prompt = buildAnalysisPrompt({
    cardName, userRules, incomeExamples, categories, subcategories, children, aliases, notasFormato,
    fechaHoy: new Date().toISOString().slice(0, 10),
  }) + bloqueRevision(resultado)
  const content = pdfBase64
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: `${prompt}\n\nEXTRACTO: es el documento PDF adjunto.` },
      ]
    : `${prompt}\n\nEXTRACTO:\n${pdfText}`

  let respuesta
  try {
    respuesta = await anthropic.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // Si los clasificadores de seguridad rechazan el pedido, la API lo reintenta
      // sola con el modelo que corresponda en vez de devolver el rechazo.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: ESQUEMA_REVISION } },
      messages: [{ role: 'user', content }],
    }, { timeout: PLAZO_REVISION_MS, maxRetries: 0 })
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error(`Revisión de lectura: error de la API (${e.status}): ${e.message}`)
    else console.error('Revisión de lectura: no se pudo llamar a la API:', e.message)
    return res.status(502).json({ error: 'No se pudo revisar la lectura' })
  }

  if (respuesta.stop_reason === 'refusal' || respuesta.stop_reason === 'max_tokens') {
    console.error(`Revisión de lectura sin respuesta útil (stop_reason=${respuesta.stop_reason})`)
    return res.status(422).json({ error: 'La revisión no devolvió una corrección' })
  }
  let revision
  try {
    revision = JSON.parse(respuesta.content.find(b => b.type === 'text')?.text || '')
  } catch {
    console.error('Revisión de lectura: la respuesta no es JSON')
    return res.status(422).json({ error: 'La revisión no devolvió una corrección' })
  }

  const aplicada = aplicarRevision(resultado, revision)
  if (!aplicada) return res.status(200).json({ resultado, revision: { estado: 'no_mejoro' } })
  const estado = compararControles(antes, controlDeLectura(aplicada.resultado))
  if (estado === 'no_mejoro') return res.status(200).json({ resultado, revision: { estado } })

  // Solo se aprende de una revisión que dejó todo cerrando con el total: es la
  // prueba de que la nota explica de verdad lo que se había pasado.
  if (estado === 'cuadra') {
    const nota = limpiarNotaFormato(revision.nota_formato, { nombres: nombresDelResumen(resultado) })
    const clave = claveDeFormato(revision.formato, resultado.tipo_documento)
    if (nota && clave) {
      const { entidad, producto } = etiquetaDeFormato(revision.formato)
      const guardada = await guardarNotaFormato(supabaseAdmin, {
        clave, entidad, producto, tipoDocumento: resultado.tipo_documento, nota, userId: user.id,
      })
      if (guardada) await avisarNotaNueva({ entidad, producto, nota, userEmail: user.email })
    }
  }

  res.status(200).json({
    resultado: aplicada.resultado,
    revision: { estado, agregados: aplicada.agregados, quitados: aplicada.quitados },
  })
}
