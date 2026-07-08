import { createClient } from '@supabase/supabase-js'
import { buildAnalysisPrompt, salvageClaudeJson } from './_lib/analyzePrompt.js'

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

  const { pdfText, cardName, userRules, incomeExamples, categories, subcategories, children, aliases } = req.body
  if (!pdfText || typeof pdfText !== 'string') return res.status(400).json({ error: 'Missing pdfText' })
  if (pdfText.length > 200_000) return res.status(400).json({ error: 'PDF text too large' })

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

  const data = await response.json()
  res.status(200).json(salvageClaudeJson(data))
}
