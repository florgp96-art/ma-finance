import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const maxDuration = 60

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { rows, categories, children, aliases } = req.body
  if (!rows || rows.length === 0) return res.status(400).json({ error: 'No rows provided' })

  const categoriesText = (categories || []).map(c => `- ${c.nombre}`).join('\n') || '- A Identificar'
  const childrenText = (children || []).length > 0 ? children.map(c => `- ${c.nombre}`).join('\n') : 'Ninguno'
  const aliasesText = (aliases || []).length > 0
    ? aliases.map(a => `- "${a.alias.toUpperCase()}" → tipo: ${a.tipo}, valor: "${a.valor}"${a.descripcion ? `, descripcion: "${a.descripcion}"` : ''}`).join('\n')
    : 'Ninguno'

  const rowsText = rows.map((r, i) =>
    `${i + 1}. NOTAS: "${r.notas || ''}", DESCRIPCION: "${r.descripcion || ''}", MONTO: ${r.monto} ${r.moneda}`
  ).join('\n')

  const prompt = `Clasificá estas filas de gastos personales argentinos del Excel del usuario. Devolvé SOLO un JSON array con exactamente ${rows.length} objetos en el mismo orden.

Cada objeto debe tener estos campos:
{"categoria": string, "subcategoria": string|null, "hijo": string|null, "nombre": string}

CATEGORÍAS DISPONIBLES:
${categoriesText}

HIJOS REGISTRADOS (nombres exactos a usar en el campo "hijo"):
${childrenText}

ALIASES DEL USUARIO (prioridad máxima — si el alias coincide con DESCRIPCION o NOTAS, úsalo):
${aliasesText}

CONTEXTOS PERSONALES ADICIONALES:
- CRISTALINE / LA LOMADA / HIGHLAND → Casa / Agua, nombre: el alias
- MAMA / MAMÁ → Personal / Varios, nombre: "Mamá"
- MOMSFOOD / MOMS FOOD → Trabajo, nombre: "Moms Food"
- OSDE → Salud / Obra social
- AUTO / PATENTE / SERVICE → Transporte / Auto
- YPF / AXION / SHELL / NAFTA → Transporte / Nafta
- Si DESCRIPCION es el nombre exacto de un hijo registrado → asignar ese nombre en campo "hijo"
- Si no podés determinar la categoría → usa "A Identificar"

CAMPO "nombre": usá NOTAS como base. Si está vacío, usá DESCRIPCION. Hacelo legible.
CAMPO "hijo": null si no aplica, nombre exacto del hijo si aplica.

FILAS A CLASIFICAR:
${rowsText}

Devolvé SOLO el JSON array, sin texto ni markdown. Ejemplo: [{"categoria":"Comida","subcategoria":"Supermercado","hijo":null,"nombre":"Supermercado Coto"},...]`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const data = await response.json()

  try {
    const textBlock = data?.content?.find(b => b.type === 'text')
    if (!textBlock?.text) return res.status(500).json({ error: 'No response from Claude' })
    const clean = textBlock.text
      .replace(/^```json\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()
    const parsed = JSON.parse(clean)
    if (!Array.isArray(parsed)) return res.status(500).json({ error: 'Invalid response format' })
    return res.status(200).json({ classifications: parsed })
  } catch (e) {
    console.error('classifyRows parse error:', e.message, data?.content?.[0]?.text?.slice(0, 200))
    return res.status(500).json({ error: 'Error parsing Claude response' })
  }
}
