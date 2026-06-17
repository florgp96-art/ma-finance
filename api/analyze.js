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
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: `Analizá este extracto financiero argentino${cardName && cardName !== 'auto' ? ` de "${cardName}"` : ''}. Devolvé SOLO JSON válido con esta estructura exacta:

{"tipo_documento":"tarjeta","tarjeta_detectada":"Mastercard Galicia","periodo":"Mayo 2026","fecha_facturacion":"09/06/26","fecha_vencimiento":"18/06/26","proximo_vencimiento":"16/07/26","total_pesos":3929478.22,"total_dolares":1.99,"adicionales":["FEDERICO GALLO PROT"],"transacciones":[{"fecha":"2026-05-21","nombre_original":"CARO CUORE 99999999","nombre_limpio":"Caro Cuore","categoria_sugerida":"Ropa","subcategoria_sugerida":null,"monto":59900.01,"moneda":"ARS","tipo":"gasto","es_credito":false,"cuotas_total":1,"cuota_numero":1,"monto_total_cuotas":null,"es_impuesto":false,"titular":"GALLO PROT FLORENCIA"}]}

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
- Casa → Alquiler, Luz, Gas, Internet, Expensas, Veterinaria, Mantenimiento, Decoracion, Empleada Domestica, Jardinero, Piletero
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
- Internet/telefonía/Fibertel/Personal/Claro/Movistar → Casa / Internet
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