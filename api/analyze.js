import { createClient } from '@supabase/supabase-js'
import { buildAnalysisPrompt, salvageClaudeJson } from './_lib/analyzePrompt.js'
import { checkRateLimit } from './_lib/rateLimit.js'

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

  if (!checkRateLimit(`analyze:${user.id}`, 10)) return res.status(429).json({ error: 'Too many requests' })

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

  if (!response.ok) {
    const err = await response.text()
    return res.status(502).json({ error: `Claude API error ${response.status}: ${err.slice(0, 200)}` })
  }

  const data = await response.json()
  res.status(200).json(salvageClaudeJson(data))
}
