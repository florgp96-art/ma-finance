import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const maxDuration = 60

const BATCH_SIZE = 30
const MAX_ROWS = 500

const rateLimitMap = new Map()
function checkRateLimit(ip) {
  const now = Date.now()
  const windowMs = 60 * 1000
  const limit = 20
  if (!rateLimitMap.has(ip)) { rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs }); return true }
  const entry = rateLimitMap.get(ip)
  if (now > entry.resetAt) { rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs }); return true }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

async function classifyBatch(batch, categories, subcategories, children, aliases) {
  const EXCLUDED_FOR_EXPENSES = ['ingresos', 'devoluciones']
  const expenseCategories = (categories || []).filter(c => !EXCLUDED_FOR_EXPENSES.includes(c.nombre.toLowerCase()))
  const categoriesText = expenseCategories.map(c => {
    const subs = (subcategories || []).filter(s => s.category_id === c.id).map(s => s.nombre)
    return subs.length > 0 ? `- ${c.nombre}: ${subs.join(', ')}` : `- ${c.nombre}`
  }).join('\n') || '- A Identificar'
  const childrenText = (children || []).length > 0
    ? children.map(c => `- ${c.nombre}`).join('\n')
    : 'Ninguno'
  const aliasesText = (aliases || []).length > 0
    ? aliases.map(a =>
        `- "${a.alias.toUpperCase()}" → tipo: ${a.tipo}, valor: "${a.valor}"${a.descripcion ? `, descripcion: "${a.descripcion}"` : ''}`
      ).join('\n')
    : 'Ninguno'

  const rowsText = batch.map((r, i) =>
    `${i + 1}. NOTAS: "${r.notas || ''}", DESCRIPCION: "${r.descripcion || ''}", MONTO: ${r.monto} ${r.moneda}`
  ).join('\n')

  const prompt = `Clasificá estas ${batch.length} filas de gastos personales argentinos. Devolvé SOLO un JSON array con exactamente ${batch.length} objetos en el mismo orden.

Cada objeto: {"categoria": string, "subcategoria": string|null, "hijo": string|null, "nombre": string}

CATEGORÍAS Y SUBCATEGORÍAS DISPONIBLES (formato: Categoría: sub1, sub2, ...):
${categoriesText}

HIJOS REGISTRADOS (nombres exactos para el campo "hijo"):
${childrenText}

REGLAS DEL USUARIO (prioridad máxima):
${aliasesText}

CÓMO APLICAR LAS REGLAS:
- Si DESCRIPCION **contiene** la palabra clave del alias (parcial, sin importar mayúsculas), aplicar la regla. Ejemplo: alias "CUMPLE AMIG" matchea "AMELIA - CUMPLE AMIGUITO" y "CUMPLE AMIGA".
- Si hay múltiples aliases que coinciden, usar el más específico (el más largo).
- Las reglas de tipo "hijo" asignan el campo "hijo", las de "categoria" asignan "categoria".

REGLAS GENERALES:
- CAMPO "nombre": usá NOTAS como base. Si está vacío, usá DESCRIPCION. Hacelo legible.
- CAMPO "hijo": si DESCRIPCION contiene el nombre de un hijo registrado, asignarlo. Si no aplica, null.
- Si no podés determinar la categoría → usá "A Identificar"
- Estas filas son GASTOS — nunca uses "Ingresos" ni "Devoluciones"
- Si la descripción es solo un nombre de persona y no es clara → "A Identificar"
- CAMPO "subcategoria": solo asignala si estás MUY seguro por el nombre del comercio (ej: "Shell" → Nafta, "Carrefour" → Supermercado). Si es un nombre de persona o hay duda, devolvé null

FILAS:
${rowsText}

Devolvé SOLO el JSON array, sin texto ni markdown.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Claude API error ${response.status}: ${err.slice(0, 200)}`)
  }

  const data = await response.json()
  const textBlock = data?.content?.find(b => b.type === 'text')
  if (!textBlock?.text) throw new Error('No response text from Claude')

  const clean = textBlock.text
    .replace(/^```json\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  const parsed = JSON.parse(clean)
  if (!Array.isArray(parsed)) throw new Error('Claude did not return an array')
  return parsed
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

  const { rows, categories, subcategories, children, aliases } = req.body
  if (!rows || rows.length === 0) return res.status(400).json({ error: 'No rows provided' })
  if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Too many rows (max ${MAX_ROWS})` })

  try {
    const allClassifications = []
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const batchResult = await classifyBatch(batch, categories, subcategories, children, aliases)
      // Safety: if Claude returned fewer items, pad with nulls
      while (batchResult.length < batch.length) {
        batchResult.push({ categoria: 'A Identificar', subcategoria: null, hijo: null, nombre: batch[batchResult.length]?.notas || '' })
      }
      allClassifications.push(...batchResult.slice(0, batch.length))
    }
    return res.status(200).json({ classifications: allClassifications })
  } catch (e) {
    console.error('classifyRows error:', e.message)
    return res.status(500).json({ error: `Error clasificando filas: ${e.message}` })
  }
}
