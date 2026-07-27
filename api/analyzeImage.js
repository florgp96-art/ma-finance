import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from './_lib/rateLimit.js'
import { getUserPlan, hasUsedMonthlyAiQuota, recordAiUsage } from './_lib/plan.js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const maxDuration = 120

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  if (!checkRateLimit(`analyzeImage:${user.id}`, 10)) return res.status(429).json({ error: 'Too many requests' })

  const { imageBase64, mediaType, cardName, userRules } = req.body
  if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'Missing imageBase64' })
  // ~6 MB de imagen en base64 — una foto de ticket/screenshot no debería superar esto
  if (imageBase64.length > 8_000_000) return res.status(400).json({ error: 'Image too large' })

  let esPremium = true
  try {
    esPremium = (await getUserPlan(supabaseAdmin, user.id)).isPremium
  } catch (e) {
    console.error('Error leyendo plan del usuario:', e.message)
  }
  if (!esPremium) {
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

  let userRulesBlock = ''
  if (userRules && userRules.length > 0) {
    const rulesText = userRules
      .map(r => `- "${r.texto_original}" → categoría: "${r.categoria}", subcategoría: "${r.subcategoria || ''}"`)
      .join('\n')
    userRulesBlock = `
═══════════════════════════════
REGLAS APRENDIDAS DEL USUARIO (PRIORIDAD MÁXIMA):
═══════════════════════════════
Aplicá estas reglas ANTES que cualquier otra. Si el nombre de una transacción coincide (parcial o exactamente), usá la categoría indicada:
${rulesText}
`
  }

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
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType || 'image/jpeg',
              data: imageBase64,
            }
          },
          {
            type: 'text',
            text: `Analizá esta imagen que puede ser una lista de gastos manual, screenshot de resumen bancario, foto de ticket, o similar${cardName && cardName !== 'auto' ? ` de "${cardName}"` : ''}. Extraé todas las transacciones que veas. Devolvé SOLO JSON válido con esta estructura exacta:

{"tipo_documento":"tarjeta","tarjeta_detectada":"Detectado de la imagen","periodo":"Mayo 2026","fecha_facturacion":null,"fecha_vencimiento":null,"proximo_vencimiento":null,"total_pesos":null,"total_dolares":null,"adicionales":[],"contexto_detectado":[],"transacciones":[{"fecha":"2026-05-21","nombre_original":"Descripción original","nombre_limpio":"Nombre legible","categoria_sugerida":"Comida","subcategoria_sugerida":null,"monto":5000,"moneda":"ARS","tipo":"gasto","es_credito":false,"cuotas_total":1,"cuota_numero":1,"monto_total_cuotas":null,"es_impuesto":false,"titular":null}]}

Si no podés leer claramente algún campo, usá null. Si la imagen no tiene transacciones reconocibles, devolvé transacciones vacío [].

${userRulesBlock}

CATEGORÍAS DISPONIBLES:
- Comida → Supermercado, Delivery
- Transporte → Nafta, Uber/Cabify, Estacionamiento
- Salud → Farmacia, Médicos, Obra social
- Educación → Colegio, Cursos
- Ropa → sin subcategoría
- Entretenimiento → Salidas
- Personal → Regalos, Peluquería, Varios
- Suscripciones → sin subcategoría
- Casa → Alquiler, Expensas, Luz, Gas, Internet
- Trabajo → Freelance, Monotributo
- Ingresos → Sueldo, Freelance, Otros
- Débitos → Impuestos, Intereses
- A Identificar → sin subcategoría`
          }
        ]
      }]
    })
  })

  if (!response.ok) {
    const err = await response.text()
    return res.status(502).json({ error: `Claude API error ${response.status}: ${err.slice(0, 200)}` })
  }

  const data = await response.json()

  try {
    const textBlock = data?.content?.find(b => b.type === 'text')
    if (textBlock?.text) {
      const clean = textBlock.text
        .replace(/^```json\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim()
      const parsed = JSON.parse(clean)
      data.content[0].text = JSON.stringify(parsed)
    }
  } catch (e) {
    console.error('Error procesando imagen:', e.message)
  }

  if (!esPremium) await recordAiUsage(supabaseAdmin, user.id)
  res.status(200).json(data)
}
