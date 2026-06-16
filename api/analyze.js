export const maxDuration = 120

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
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: `Extraé las transacciones de este extracto bancario argentino${cardName && cardName !== 'auto' ? ` de la tarjeta "${cardName}"` : ''}. Devolvé SOLO JSON válido con esta estructura exacta:

{"tarjeta_detectada":"Mastercard Galicia","periodo":"Mayo 2026","fecha_facturacion":"09/06/26","fecha_vencimiento":"18/06/26","proximo_vencimiento":"16/07/26","total_pesos":3929478.22,"total_dolares":1.99,"adicionales":["FEDERICO GALLO PROT"],"transacciones":[{"fecha":"2026-05-21","nombre_original":"CARO CUORE 99999999","nombre_limpio":"Caro Cuore","categoria_sugerida":"Ropa","monto":59900.01,"moneda":"ARS","es_credito":false,"cuotas_total":1,"cuota_numero":1,"monto_total_cuotas":null,"es_impuesto":false,"titular":"GALLO PROT FLORENCIA"}]}

Reglas:
- tarjeta_detectada: nombre corto del banco y tipo de tarjeta detectado en el extracto (ej: "Mastercard Galicia", "Amex", "Visa BBVA")
- NO incluir pagos recibidos (SU PAGO, "Gracias por su pago", pagos al resumen)
- nombre_limpio: nombre legible. Si es críptico, igual al original.
- categoria_sugerida: Casa, Alimentación, Transporte, Salud, Educación, Ropa, Entretenimiento, Suscripciones, Trabajo, Ingresos, Débitos, A Identificar
- AXION/YPF/SHELL/COMBUSTIBLE/peajes/AUTOPISTA → Transporte
- COTO/DISCO/INC SA/supermercados → Alimentación
- OSDE/COOP.TEL/médicos/farmacia → Salud
- NETFLIX/CANVA/APPLE.COM → Suscripciones
- PEDIDOSYA/UBER/restaurantes/sushi → Entretenimiento
- Percepciones/impuestos/sellos/INTERESES → Débitos
- COLEGIO/educación → Educación
- Todo lo demás críptico → A Identificar
- es_credito: true solo para devoluciones o reintegros reales
- Para cuotas: completar cuotas_total, cuota_numero y monto_total_cuotas
- titular: nombre del titular de la tarjeta

EXTRACTO:
${pdfText}`
      }]
    })
  })

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
    console.error('Error minificando en servidor:', e.message)
  }

  res.status(200).json(data)
}