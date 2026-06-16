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

{"tarjeta_detectada":"Mastercard Galicia","periodo":"Mayo 2026","fecha_facturacion":"09/06/26","fecha_vencimiento":"18/06/26","proximo_vencimiento":"16/07/26","total_pesos":3929478.22,"total_dolares":1.99,"adicionales":["FEDERICO GALLO PROT"],"transacciones":[{"fecha":"2026-05-21","nombre_original":"CARO CUORE 99999999","nombre_limpio":"Caro Cuore","categoria_sugerida":"Ropa","subcategoria_sugerida":null,"monto":59900.01,"moneda":"ARS","es_credito":false,"cuotas_total":1,"cuota_numero":1,"monto_total_cuotas":null,"es_impuesto":false,"titular":"GALLO PROT FLORENCIA"}]}

Reglas de categoría y subcategoría:
- tarjeta_detectada: nombre corto del banco y tipo de tarjeta (ej: "Mastercard Galicia", "Amex", "Visa BBVA")
- NO incluir pagos recibidos (SU PAGO, "Gracias por su pago", pagos al resumen)
- nombre_limpio: nombre legible. Si es críptico, igual al original.
- es_credito: true solo para devoluciones o reintegros reales
- Para cuotas: completar cuotas_total, cuota_numero y monto_total_cuotas
- titular: nombre del titular de la tarjeta

Categorías y subcategorías permitidas:
- Casa → subcategorías: Alquiler, Luz, Gas, Internet, Expensas, Veterinaria, Mantenimiento, Decoracion, Empleada Domestica, Jardinero, Piletero
- Comida → subcategorías: Supermercado, Delivery
- Transporte → subcategorías: Nafta, Auto, Transporte público, Uber/Cabify, Telepase, Service Auto, Estacionamiento
- Salud → subcategorías: Obra social, Médicos, Farmacia
- Educación → subcategorías: Colegio, Universidad, Cursos
- Ropa → sin subcategoría
- Entretenimiento → subcategorías: Salidas
- Personal → subcategorías: Regalos, Cumpleaños, Fiestas, Tramites, Peluqueria, Varios
- Suscripciones → sin subcategoría
- Trabajo → subcategorías: Freelance, Negocio propio, Insumos, Monotributo, Empleada
- Ingresos → subcategorías: Sueldo, Freelance, Alquileres, Inversiones, Otros
- Débitos → subcategorías: Impuestos, Percepciones, Intereses
- A Identificar → sin subcategoría

Reglas de asignación:
- AXION/YPF/SHELL/COMBUSTIBLE → Transporte, subcategoría: Nafta
- Peajes/AUTOPISTA/CORREDORES VIALES/TELEPEAJE → Transporte, subcategoría: Auto
- UBER/CABIFY/PAYU*AR*UBER → Transporte, subcategoría: Uber/Cabify
- COTO/DISCO/INC SA/JUMBO/supermercados presenciales → Alimentación, subcategoría: Supermercado
- PEDIDOSYA/RAPPI/delivery → Alimentación, subcategoría: Delivery
- Restaurantes/bares/sushi/cantina/pizzería/Starbucks → Entretenimiento, subcategoría: Salidas
- OSDE/obra social/prepaga → Salud, subcategoría: Obra social
- Médicos/clínicas/laboratorios → Salud, subcategoría: Médicos
- Farmacia/droguería → Salud, subcategoría: Farmacia
- COLEGIO/escuela → Educación, subcategoría: Colegio
- Universidad → Educación, subcategoría: Universidad
- Cursos/capacitación → Educación, subcategoría: Cursos
- NETFLIX/SPOTIFY/CANVA/APPLE.COM/Disney → Suscripciones
- EDENOR/METROGAS/luz/gas → Casa, subcategoría: Luz o Gas
- Internet/telefonía → Casa, subcategoría: Internet
- Expensas/administración → Casa, subcategoría: Expensas
- Alquiler → Casa, subcategoría: Alquiler
- ROSMINOYCIASA/ROSMINO → Comida, subcategoría: Supermercado
- STB/STARBUCKS → Entretenimiento, subcategoría: Salidas
- Percepciones/PERCEPCION → Débitos, subcategoría: Percepciones
- Impuesto/sellos/IVA → Débitos, subcategoría: Impuestos
- Intereses compensatorios → Débitos, subcategoría: Intereses
- Todo lo demás críptico → A Identificar, subcategoria_sugerida: null

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