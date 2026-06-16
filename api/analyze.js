export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { pdfText, cardName } = req.body

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Sos un asistente que extrae transacciones de extractos bancarios argentinos.

Analizá este extracto de la tarjeta "${cardName}" y devolvé SOLO un JSON válido con esta estructura exacta, sin texto adicional:

{
  "periodo": "Mayo 2026",
  "fecha_facturacion": "09/06/26",
  "fecha_vencimiento": "18/06/26",
  "proximo_vencimiento": "16/07/26",
  "total_pesos": 3929478.22,
  "total_dolares": 1.99,
  "adicionales": ["FEDERICO GALLO PROT", "MAIA GALLO PROT"],
  "transacciones": [
    {
      "fecha": "2026-05-21",
      "nombre_original": "CARO CUORE 99999999",
      "nombre_limpio": "Caro Cuore",
      "categoria_sugerida": "Ropa",
      "monto": 59900.01,
      "moneda": "ARS",
      "es_credito": false,
      "cuotas_total": 1,
      "cuota_numero": 1,
      "monto_total_cuotas": null,
      "es_impuesto": false,
      "titular": "JULIA BEATRIZ SWAROVSKI"
    }
  ]
}

Reglas importantes:
- "nombre_limpio": nombre legible del comercio. Si es críptico, dejarlo igual al original.
- "categoria_sugerida": Casa, Alimentación, Transporte, Salud, Educación, Ropa, Entretenimiento, Suscripciones, Trabajo, Ingresos, Débitos, A Identificar
- Para AXION, YPF, SHELL, peajes → Transporte
- Para COTO, INC SA, supermercados → Alimentación
- Para OSDE, médicos → Salud
- Para NETFLIX, CANVA → Suscripciones
- Para PEDIDOSYA, restaurantes → Entretenimiento
- Para percepciones, impuestos, sellos → Débitos
- Para todo lo demás críptico → A Identificar
- "es_credito": true solo para pagos recibidos
- Para cuotas: completar cuotas_total, cuota_numero y monto_total_cuotas
- "titular": nombre de la persona titular del gasto

EXTRACTO:
${pdfText}`
      }]
    })
  })

  const data = await response.json()
  res.status(200).json(data)
}