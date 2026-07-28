import { createClient } from '@supabase/supabase-js'
import { buildAnalysisPrompt, salvageClaudeJson } from './_lib/analyzePrompt.js'
import { getUserPlan, hasUsedMonthlyAiQuota, recordAiUsage } from './_lib/plan.js'

// Fallback de importación: recibe el PDF completo en base64 y se lo pasa a
// Claude como documento. Se usa cuando pdf.js no puede abrir el archivo
// ("Invalid PDF structure", PDFs escaneados) o cuando el texto extraído no
// contiene la tabla de movimientos (algunos resúmenes de banco).

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

export const maxDuration = 300

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' })

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { pdfBase64, cardName, userRules, incomeExamples, categories, subcategories, children, aliases } = req.body
  if (!pdfBase64 || typeof pdfBase64 !== 'string') return res.status(400).json({ error: 'Missing pdfBase64' })
  // ~7 MB de PDF en base64; los resúmenes rondan los cientos de KB
  if (pdfBase64.length > 9_500_000) return res.status(400).json({ error: 'PDF too large' })

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
        error: 'Tu suscripción Premium terminó. Podés seguir cargando por Excel sin límite, o reactivar Premium para volver a análisis con IA.',
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
        error: 'Ya usaste tu análisis con IA gratis este mes. Podés seguir cargando por Excel sin límite, o suscribirte a Premium para análisis ilimitados.',
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
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: `${prompt}

EXTRACTO: es el documento PDF adjunto. Leé TODAS sus páginas y extraé todas las transacciones.` }
        ]
      }]
    })
  })

  const data = await response.json()
  if (!esPremium) await recordAiUsage(supabaseAdmin, user.id)
  res.status(200).json(salvageClaudeJson(data))
}
