import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from './_lib/rateLimit.js'
import { getUserPlan } from './_lib/plan.js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const maxDuration = 60

const BATCH_SIZE = 30
const MAX_ROWS = 500
// El plan gratis importa Excel sin límite, pero la clasificación con IA de las filas
// sin regla tiene un tope diario: cada pedido son hasta 500 filas mandadas a Claude, y
// sin tope una cuenta gratis podía generar costo sin fin. Pasado el tope, la app sigue
// importando y deja esas filas para identificar a mano.
const PEDIDOS_GRATIS_POR_DIA = 15
const UN_DIA_MS = 24 * 60 * 60 * 1000

async function classifyBatch(batch, categories, subcategories, children, aliases) {
  const categoriesText = (categories || []).map(c => {
    const subs = (subcategories || []).filter(s => s.category_id === c.id).map(s => s.nombre)
    const tag = (c.tipo || 'gasto') === 'ingreso' ? ' [INGRESO]' : (c.tipo === 'neutro' ? ' [NEUTRO]' : '')
    return subs.length > 0 ? `- ${c.nombre}${tag}: ${subs.join(', ')}` : `- ${c.nombre}${tag}`
  }).join('\n') || '- A Identificar'
  const childrenText = (children || []).length > 0
    ? children.map(c => `- ${c.nombre}`).join('\n')
    : 'Ninguno'
  const aliasesText = (aliases || []).length > 0
    ? aliases.map(a => {
        if (a.tipo === 'categoria') {
          const [cat, subcat] = a.valor.split(' > ').map(v => v.trim())
          return `- "${a.alias.toUpperCase()}" → categoría: "${cat}"${subcat ? `, subcategoría: "${subcat}"` : ''}${a.descripcion ? ` (${a.descripcion})` : ''}`
        }
        return `- "${a.alias.toUpperCase()}" → tipo: ${a.tipo}, valor: "${a.valor}"${a.descripcion ? `, descripcion: "${a.descripcion}"` : ''}`
      }).join('\n')
    : 'Ninguno'

  const rowsText = batch.map((r, i) =>
    `${i + 1}. TIPO: ${r.tipo || 'gasto'}, NOTAS: "${r.notas || ''}", DESCRIPCION: "${r.descripcion || ''}", MONTO: ${r.monto} ${r.moneda}`
  ).join('\n')

  const prompt = `Sos un clasificador de gastos personales argentinos. Devolvé SOLO un JSON array con exactamente ${batch.length} objetos en el mismo orden que las filas.

Formato de cada objeto: {"categoria": string, "subcategoria": string|null, "hijo": string|null, "nombre": string}

CATEGORÍAS Y SUBCATEGORÍAS DISPONIBLES:
${categoriesText}

REGLAS DEL USUARIO (prioridad absoluta sobre todo lo demás):
${aliasesText}

HIJOS REGISTRADOS:
${childrenText}

INSTRUCCIONES:
1. "nombre": usá NOTAS si tiene contenido útil, sino DESCRIPCION. Título legible, sin códigos.
2. "categoria": elegí solo de la lista. Si la descripción parece un nombre de persona → "A Identificar". Si no estás seguro → "A Identificar". Nunca inventes categorías.
3. "subcategoria": solo si estás 100% seguro por el comercio (Shell→Nafta, Carrefour→Supermercado, Spotify→Streaming). En caso de duda → null.
4. "hijo": si DESCRIPCION contiene exactamente un nombre de hijo registrado → asignarlo. Sino null.
5. Reglas del usuario: si DESCRIPCION contiene la palabra clave (sin importar mayúsculas) → aplicar esa categoría sin excepciones.
6. TIPO indica si la fila es un gasto, ingreso o movimiento neutro. Si TIPO es "ingreso", la categoría tiene que ser una marcada [INGRESO] en la lista (ej. "Ingresos"), con una de sus subcategorías reales si aplica. Si TIPO es "gasto" o "neutro", nunca elijas una categoría marcada [INGRESO].

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
      model: 'claude-sonnet-4-6',
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

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  if (!await checkRateLimit(`classifyRows:${user.id}`, 20)) return res.status(429).json({ error: 'Too many requests' })

  const { rows, categories, subcategories, children, aliases } = req.body
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No rows provided' })
  if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Too many rows (max ${MAX_ROWS})` })

  let esPremium = true
  try {
    esPremium = (await getUserPlan(supabaseAdmin, user.id)).isPremium
  } catch (e) {
    console.error('Error leyendo plan del usuario:', e.message)
  }
  if (!esPremium && !await checkRateLimit(`classifyRows-gratis-dia:${user.id}`, PEDIDOS_GRATIS_POR_DIA, UN_DIA_MS)) {
    return res.status(429).json({
      error: 'Por hoy ya se usó la clasificación automática del plan gratis. El Excel se importa igual y las filas sin regla quedan para identificar; mañana vuelve a andar.',
      code: 'CLASIFICACION_GRATIS_AGOTADA',
    })
  }

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
    // Salvaguarda: si Claude ignora la marca [INGRESO] y le pone una categoría de
    // gasto a una fila de ingreso (o viceversa), la mandamos a "A Identificar" en
    // vez de dejar un ingreso clasificado como gasto (o al revés).
    const categoriaTipo = Object.fromEntries((categories || []).map(c => [c.nombre, c.tipo || 'gasto']))
    const normalized = allClassifications.map((cl, i) => {
      const rowTipo = rows[i]?.tipo || 'gasto'
      const esIngreso = rowTipo === 'ingreso'
      const catEsIngreso = categoriaTipo[cl?.categoria] === 'ingreso'
      if (esIngreso !== catEsIngreso) return { ...cl, categoria: 'A Identificar', subcategoria: null }
      return cl
    })
    return res.status(200).json({ classifications: normalized })
  } catch (e) {
    console.error('classifyRows error:', e.message)
    return res.status(500).json({ error: `Error clasificando filas: ${e.message}` })
  }
}
