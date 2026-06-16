export const maxDuration = 120

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { pdfBase64, cardName } = req.body

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
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64
              }
            },
            {
              type: 'text',
              text: `Extraé las transacciones de este extracto bancario argentino de la tarjeta "${cardName}".

CRÍTICO: Respondé con UNA SOLA LÍNEA de JSON. Sin saltos de línea. Sin espacios después de : o ,. Empezá con { y terminá con }. Nada más.

Estructura exacta (en una sola línea):
{"periodo":"Mayo 2026","fecha_facturacion":"09/06/26","fecha_vencimiento":"18/06/26","proximo_vencimiento":"16/07/26","total_pesos":3929478.22,"total_dolares":1.99,"adicionales":["FEDERICO GALLO PROT","MAIA GALLO PROT"],"transacciones":[{"fecha":"2026-05-21","nombre_original":"CARO CUORE 99999999","nombre_limpio":"Caro Cuore","categoria_sugerida":"Ropa","monto":59900.01,"moneda":"ARS","es_credito":false,"cuotas_total":1,"cuota_numero":1,"monto_total_cuotas":null,"es_impuesto":false,"titular":"JULIA BEATRIZ SWAROVSKI"}]}

Reglas:
- nombre_limpio: nombre legible. Si es críptico, igual al original.
- categoria_sugerida: Casa, Alimentación, Transporte, Salud, Educación, Ropa, Entretenimiento, Suscripciones, Trabajo, Ingresos, Débitos, A Identificar
- AXION/YPF/SHELL/peajes → Transporte
- COTO/INC SA/supermercados → Alimentación
- OSDE/médicos → Salud
- NETFLIX/CANVA → Suscripciones
- PEDIDOSYA/restaurantes → Entretenimiento
- Percepciones/impuestos/sellos → Débitos
- Todo lo demás críptico → A Identificar
- es_credito: true solo para pagos recibidos
- Para cuotas: completar cuotas_total, cuota_numero y monto_total_cuotas
- titular: nombre de la persona que hizo el gasto`
            }
          ]
        },
        {
          role: 'assistant',
          content: '{'
        }
      ]
    })
  })

  const data = await response.json()

  // Si Claude empezó con { gracias al prefill, reconstituir el JSON completo
  if (data?.content?.[0]?.text) {
    data.content[0].text = '{' + data.content[0].text
  }

  res.status(200).json(data)
}