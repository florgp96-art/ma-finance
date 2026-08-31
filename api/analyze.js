import { createClient } from '@supabase/supabase-js'
import { buildAnalysisPrompt, salvageClaudeJson, leerRespuestaAnalisis, describirRespuesta } from './_lib/analyzePrompt.js'
import { checkRateLimit } from './_lib/rateLimit.js'
import { getUserPlan, hasUsedMonthlyAiQuota, recordAiUsage } from './_lib/plan.js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const maxDuration = 300

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  if (!await checkRateLimit(`analyze:${user.id}`, 10)) return res.status(429).json({ error: 'Too many requests' })

  const { pdfText, cardName, userRules, incomeExamples, categories, subcategories, children, aliases } = req.body
  if (!pdfText || typeof pdfText !== 'string') return res.status(400).json({ error: 'Missing pdfText' })
  if (pdfText.length > 200_000) return res.status(400).json({ error: 'PDF text too large' })

  let esPremium = true
  let tuvoPremium = false
  try {
    const plan = await getUserPlan(supabaseAdmin, user.id)
    esPremium = plan.isPremium
    tuvoPremium = plan.tuvoPremium
  } catch (e) {
    console.error('Error leyendo plan del usuario:', e.message)
  }
  if (!esPremium) {
    if (tuvoPremium) {
      return res.status(402).json({
        error: 'Tu Premium terminó. Podés seguir cargando a mano o por Excel sin límite. Si querés volver a subir resúmenes para que la app los lea, reactivá Premium.',
        code: 'EX_PREMIUM_NO_IA',
      })
    }
    let cupoUsado = false
    try {
      cupoUsado = await hasUsedMonthlyAiQuota(supabaseAdmin, user.id)
    } catch (e) {
      console.error('Error leyendo cupo de IA del usuario:', e.message)
    }
    if (cupoUsado) {
      return res.status(402).json({
        error: 'Este mes ya usaste tu resumen gratis. Podés seguir cargando a mano o por Excel sin límite, o pasar a Premium para subir todos los que quieras.',
        code: 'AI_QUOTA_EXCEEDED',
      })
    }
  }

  const prompt = buildAnalysisPrompt({ cardName, userRules, incomeExamples, categories, subcategories, children, aliases })

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      messages: [{
        role: 'user',
        content: `${prompt}

EXTRACTO:
${pdfText}`
      }]
    })
  })

  if (!response.ok) {
    const err = await response.text()
    return res.status(502).json({ error: `Claude API error ${response.status}: ${err.slice(0, 200)}` })
  }

  const data = salvageClaudeJson(await response.json())

  // Si la IA no devolvió un JSON con movimientos no hay nada que importar: se
  // corta acá con un 422 y el motivo, en vez de mandarle al cliente algo que
  // no puede parsear. Y no se consume el cupo del plan gratis: el intento no
  // sirvió, así que no se cobra.
  if (!leerRespuestaAnalisis(data)) {
    const detalle = describirRespuesta(data)
    console.error('Respuesta inservible de Claude:', JSON.stringify(detalle))
    return res.status(422).json({
      error: 'La IA no devolvió el resumen en el formato esperado',
      code: 'RESPUESTA_NO_UTIL',
      ...detalle,
    })
  }

  if (!esPremium) await recordAiUsage(supabaseAdmin, user.id)
  res.status(200).json(data)
}
