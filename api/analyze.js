import { createClient } from '@supabase/supabase-js'

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

export const maxDuration = 120

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' })

  const authHeader = req.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.slice(7)
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { pdfText, cardName, userRules, incomeExamples } = req.body
  if (!pdfText || typeof pdfText !== 'string') return res.status(400).json({ error: 'Missing pdfText' })
  if (pdfText.length > 200_000) return res.status(400).json({ error: 'PDF text too large' })

  // Construir bloque de reglas del usuario si existen
  let userRulesBlock = ''
  if (userRules && userRules.length > 0) {
    const rulesText = userRules
      .filter(r => !r.texto_original?.startsWith('contexto_') && r.categoria)
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

  // Construir bloque de ejemplos de ingresos conocidos
  let incomeExamplesBlock = ''
  if (incomeExamples && incomeExamples.length > 0) {
    const seen = new Set()
    const uniqueExamples = incomeExamples.filter(t => {
      const key = (t.detalle || t.nombre || '').trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 30)
    if (uniqueExamples.length > 0) {
      const exText = uniqueExamples
        .map(t => `- "${t.detalle || t.nombre}"${t.tag ? ` → tag: "${t.tag}"` : ''}`)
        .join('\n')
      incomeExamplesBlock = `
═══════════════════════════════
INGRESOS YA REGISTRADOS POR EL USUARIO (referencia):
═══════════════════════════════
Si encontrás transacciones similares, clasificalas como tipo "ingreso" con el mismo tag cuando corresponda:
${exText}
`
    }
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
      max_tokens: 12000,
      messages: [{
        role: 'user',
        content: `Analizá este extracto financiero argentino${cardName && cardName !== 'auto' ? ` de "${cardName}"` : ''}. Devolvé SOLO JSON válido con esta estructura exacta:

{"tipo_documento":"tarjeta","tarjeta_detectada":"Mastercard Galicia","periodo":"Mayo 2026","fecha_facturacion":"09/06/26","fecha_vencimiento":"18/06/26","proximo_vencimiento":"16/07/26","total_pesos":3929478.22,"total_dolares":1.99,"adicionales":["FEDERICO GALLO PROT"],"contexto_detectado":[],"transacciones":[{"fecha":"2026-05-21","nombre_original":"CARO CUORE 99999999","nombre_limpio":"Caro Cuore","categoria_sugerida":"Ropa","subcategoria_sugerida":null,"monto":59900.01,"moneda":"ARS","tipo":"gasto","es_credito":false,"cuotas_total":1,"cuota_numero":1,"monto_total_cuotas":null,"es_impuesto":false,"titular":"GALLO PROT FLORENCIA"}]}

═══════════════════════════════
CAMPO contexto_detectado:
═══════════════════════════════
Analizá el conjunto de transacciones y detectá patrones que sugieran contexto personal del usuario.
Devolvé un array con los contextos detectados. Valores posibles:

- "hijo" → si aparecen gastos de colegio, guardería, librería escolar, pediatra, juguetería, cuota colegial
- "mascota" → si aparecen gastos de veterinaria, pet shop, alimento para mascotas
- "auto_propio" → si aparecen gastos de nafta, service, patente, seguro de auto, estacionamiento recurrente
- "empleada_domestica" → si aparecen pagos regulares a empleada doméstica o similar
- "alquiler_pagado" → si aparece pago de alquiler recurrente
- "gimnasio" → si aparece cuota de gimnasio o actividad física regular

Si no detectás ninguno, devolvé array vacío [].
Ejemplos: ["hijo","auto_propio"] o [] o ["mascota"]

${userRulesBlock}
${incomeExamplesBlock}
═══════════════════════════════
CAMPO tipo_documento:
═══════════════════════════════
- "tarjeta" → si es resumen de tarjeta de crédito (tiene fecha de vencimiento, total a pagar, cuotas)
- "banco" → si es extracto de cuenta bancaria o caja de ahorro (tiene transferencias, débitos, saldo)

═══════════════════════════════
CAMPO tipo POR TRANSACCIÓN:
═══════════════════════════════
- "gasto" → dinero que sale como gasto real (compras, servicios, pagos a terceros por consumo)
- "ingreso" → dinero que entra (sueldos, transferencias recibidas de terceros, reintegros)
- "neutro" → movimientos que NO son ni gasto ni ingreso real:
  * Inversiones: suscripciones/rescates FIMA, plazos fijos, fondos comunes
  * Transferencias entre cuentas propias
  * Pagos de tarjeta de crédito desde el banco
  * Adelantos entre cuentas propias

═══════════════════════════════
REGLAS GENERALES:
═══════════════════════════════
- NO incluir "SU PAGO", "Gracias por su pago", pagos al resumen de tarjeta (en extractos de tarjeta)
- nombre_limpio: nombre legible. Si es críptico, dejarlo igual al original.
- es_credito: true solo para devoluciones o reintegros reales en tarjeta
- Para cuotas: completar cuotas_total, cuota_numero y monto_total_cuotas
- titular: nombre del titular

═══════════════════════════════
CATEGORÍAS PARA TARJETAS DE CRÉDITO:
═══════════════════════════════
- Casa → Alquiler, Luz, Gas, Internet, Teléfono, Expensas, Veterinaria, Mantenimiento, Decoracion, Empleada Domestica, Jardinero, Piletero
- Comida → Supermercado, Delivery
- Transporte → Nafta, Auto, Transporte público, Uber/Cabify, Telepase, Service Auto, Estacionamiento
- Salud → Obra social, Médicos, Farmacia
- Educación → Colegio, Universidad, Cursos
- Ropa → sin subcategoría
- Entretenimiento → Salidas
- Personal → Regalos, Cumpleaños, Fiestas, Tramites, Peluqueria, Varios
- Suscripciones → sin subcategoría
- Trabajo → Freelance, Negocio propio, Insumos, Monotributo, Empleada
- Ingresos → Sueldo, Freelance, Alquileres, Inversiones, Otros
- Débitos → Impuestos, Percepciones, Intereses
- A Identificar → sin subcategoría

═══════════════════════════════
CATEGORÍAS ADICIONALES PARA CUENTAS BANCARIAS:
═══════════════════════════════
- Inversiones → FIMA, Plazo fijo, Fondos, Acciones, Cripto (tipo: "neutro")
- Transferencias propias → sin subcategoría (tipo: "neutro")
- Pago tarjeta → sin subcategoría (tipo: "neutro")
- Ingresos → Sueldo, Alquiler cobrado, Freelance, Reintegros, Otros (tipo: "ingreso")

═══════════════════════════════
REGLAS DE ASIGNACIÓN PARA TARJETAS:
═══════════════════════════════
- AXION/YPF/SHELL/COMBUSTIBLE → Transporte / Nafta
- Peajes/AUTOPISTA/CORREDORES VIALES/TELEPEAJE → Transporte / Auto
- UBER/CABIFY/PAYU*AR*UBER → Transporte / Uber/Cabify
- COTO/DISCO/INC SA/JUMBO/supermercados → Comida / Supermercado
- ROSMINOYCIASA/ROSMINO → Comida / Supermercado
- PEDIDOSYA/RAPPI/delivery → Comida / Delivery
- Restaurantes/bares/sushi/cantina/pizzería/STB/STARBUCKS → Entretenimiento / Salidas
- OSDE/obra social/prepaga → Salud / Obra social
- Médicos/clínicas/laboratorios → Salud / Médicos
- Farmacia/droguería → Salud / Farmacia
- COLEGIO/escuela → Educación / Colegio
- Universidad → Educación / Universidad
- Cursos/capacitación → Educación / Cursos
- NETFLIX/SPOTIFY/CANVA/APPLE.COM/Disney/HBO/Amazon Prime → Suscripciones
- EDENOR/METROGAS/luz/gas → Casa / Luz o Gas
- MOVISAPPMOVIL/Movistar App/Personal App/Claro App/planes de celular/telefonía móvil → Casa / Teléfono
- Internet/Fibertel/Telecentro/fibra óptica → Casa / Internet
- Expensas/administración → Casa / Expensas
- Alquiler → Casa / Alquiler
- Percepciones/PERCEPCION → Débitos / Percepciones
- Impuesto/sellos/IVA/ARBA/AFIP → Débitos / Impuestos
- Intereses compensatorios/punitorios → Débitos / Intereses
- MERPAGO/MercadoPago → según el comercio que acompaña; si no se puede determinar → A Identificar
- Todo lo demás críptico → A Identificar

═══════════════════════════════
REGLAS DE ASIGNACIÓN PARA CUENTAS BANCARIAS:
═══════════════════════════════
- SUSCRIPCION FIMA / FIMA PREMIUM / FONDO → Inversiones / FIMA, tipo: "neutro"
- RESCATE FIMA / RESCATE FONDO → Inversiones / FIMA, tipo: "neutro"
- PLAZO FIJO / CONSTITUCION PF → Inversiones / Plazo fijo, tipo: "neutro"
- TRANSF. CTAS PROPIAS / TRANSFERENCIA CUENTA PROPIA → Transferencias propias, tipo: "neutro"
- PAGO TC / PAGO TARJETA / PAGO RESUMEN → Pago tarjeta, tipo: "neutro"
- ADELANTO / PRESTAMO PROPIO → Transferencias propias, tipo: "neutro"
- TRANSFERENCIA DE TERCEROS recibida / ACREDITACION → Ingresos / Otros, tipo: "ingreso" (si parece sueldo → Ingresos / Sueldo)
- HABERES / SUELDO / REMUNERACION → Ingresos / Sueldo, tipo: "ingreso"
- ALQUILER cobrado → Ingresos / Alquiler cobrado, tipo: "ingreso"
- REINTEGRO / DEVOLUCION recibida → Ingresos / Reintegros, tipo: "ingreso"
- TRANSFERENCIA A TERCEROS enviada → A Identificar, tipo: "gasto" (el usuario decidirá)
- DEBITO / DEBIN RECURRENTE → A Identificar, tipo: "gasto"
- Impuestos/ARBA/AFIP debitados → Débitos / Impuestos, tipo: "gasto"

IMPORTANTE: Respondé ÚNICAMENTE con el objeto JSON. Sin texto previo, sin explicaciones, sin bloques de código markdown. Tu respuesta debe empezar con { y terminar con }.

EXTRACTO:
${pdfText}`
      }]
    })
  })

  const data = await response.json()

  try {
    const textBlock = data?.content?.find(b => b.type === 'text')
    if (textBlock?.text) {
      const text = textBlock.text
      const jsonStart = text.indexOf('{')
      const jsonEnd = text.lastIndexOf('}')
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON object found in response')
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
      data.content[0].text = JSON.stringify(parsed)
    }
  } catch (e) {
    console.error('Error minificando en servidor:', e.message)
  }

  res.status(200).json(data)
}