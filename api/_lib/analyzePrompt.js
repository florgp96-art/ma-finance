// Construcción del prompt de análisis de extractos, compartido entre
// /api/analyze (texto extraído con pdf.js) y /api/analyzePdf (PDF adjunto
// como documento, para archivos que pdf.js no puede abrir o sin capa de texto).

export function buildAnalysisPrompt({ cardName, userRules, incomeExamples, categories, subcategories, children, aliases }) {
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

  // Construir bloque de alias del usuario (mapeos manuales de comercio → categoría/hijo)
  let aliasesBlock = ''
  const categoriaAliases = (aliases || []).filter(a => a.tipo === 'categoria' || a.tipo === 'hijo')
  if (categoriaAliases.length > 0) {
    const aliasText = categoriaAliases
      .map(a => {
        if (a.tipo === 'hijo') return `- "${a.alias.toUpperCase()}" → hijo: "${a.valor}"${a.descripcion ? ` (${a.descripcion})` : ''}`
        const [cat, subcat] = a.valor.split(' > ').map(v => v.trim())
        return `- "${a.alias.toUpperCase()}" → categoría: "${cat}"${subcat ? `, subcategoría: "${subcat}"` : ''}${a.descripcion ? ` (${a.descripcion})` : ''}`
      })
      .join('\n')
    aliasesBlock = `
═══════════════════════════════
ALIAS DEFINIDOS POR EL USUARIO (aplicar si la descripción contiene el alias, después de las reglas aprendidas):
═══════════════════════════════
${aliasText}
`
  }

  // Construir bloque de alias "neutro" (movimientos que el usuario marcó como ni gasto ni ingreso,
  // ej. el pago de una tarjeta que en el resumen del banco aparece como un DEBIN genérico)
  const neutroAliases = (aliases || []).filter(a => a.tipo === 'neutro')
  let neutroAliasesBlock = ''
  if (neutroAliases.length > 0) {
    const neutroText = neutroAliases
      .map(a => `- "${a.alias.toUpperCase()}"${a.descripcion ? ` (${a.descripcion})` : ''}`)
      .join('\n')
    neutroAliasesBlock = `
═══════════════════════════════
MOVIMIENTOS MARCADOS COMO NEUTRO POR EL USUARIO:
═══════════════════════════════
Si la descripción de una transacción contiene alguno de estos textos, asigná "tipo": "neutro" (no es gasto ni ingreso real), sin importar qué otra regla o categoría sugieran los datos:
${neutroText}
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

  // Categorías/subcategorías reales del usuario (propias + de sistema). Si por algún motivo
  // no llegan desde el cliente, se usa una lista genérica de respaldo para no romper el análisis.
  const buildCategoriesText = (cats, subcats, excluir) => {
    const list = (cats || []).filter(c => !excluir.includes((c.nombre || '').toLowerCase()))
    if (list.length === 0) return null
    return list.map(c => {
      const subs = (subcats || []).filter(s => s.category_id === c.id).map(s => s.nombre)
      return subs.length > 0 ? `- ${c.nombre}: ${subs.join(', ')}` : `- ${c.nombre}`
    }).join('\n')
  }
  const categoriasTarjetaText = buildCategoriesText(categories, subcategories, ['ingresos', 'devoluciones', 'inversiones', 'transferencias propias', 'pago tarjeta'])
    || `- Casa → Alquiler, Luz, Gas, Internet, Teléfono, Expensas, Veterinaria, Mantenimiento, Decoracion, Empleada Domestica, Jardinero, Piletero
- Comida → Supermercado, Delivery
- Transporte → Nafta, Auto, Transporte público, Uber/Cabify, Telepase, Service Auto, Estacionamiento
- Salud → Obra social, Médicos, Farmacia
- Educación → Colegio, Universidad, Cursos
- Ropa → sin subcategoría
- Entretenimiento → Salidas
- Personal → Regalos, Cumpleaños, Fiestas, Tramites, Peluqueria, Varios
- Suscripciones → sin subcategoría
- Trabajo → Freelance, Negocio propio, Insumos, Monotributo, Empleada
- Débitos → Impuestos, Percepciones, Intereses
- A Identificar → sin subcategoría`
  const categoriasBancoText = buildCategoriesText(categories, subcategories, [])
    || `- Inversiones → FIMA, Plazo fijo, Fondos, Acciones, Cripto (tipo: "neutro")
- Transferencias propias → sin subcategoría (tipo: "neutro")
- Pago tarjeta → sin subcategoría (tipo: "neutro")
- Ingresos → Sueldo, Alquiler cobrado, Freelance, Reintegros, Otros (tipo: "ingreso")`

  const childrenText = (children && children.length > 0) ? children.map(c => `- ${c.nombre}`).join('\n') : null

  return `Analizá este extracto financiero argentino${cardName && cardName !== 'auto' ? ` de "${cardName}"` : ''}. Devolvé SOLO JSON válido con esta estructura exacta:

{"tipo_documento":"tarjeta","tarjeta_detectada":"Mastercard Galicia","periodo":"Mayo 2026","fecha_facturacion":"09/06/26","fecha_vencimiento":"18/06/26","proximo_vencimiento":"16/07/26","total_pesos":3929478.22,"total_dolares":1.99,"adicionales":["FEDERICO GALLO PROT"],"contexto_detectado":[],"transacciones":[{"fecha":"2026-05-21","nombre_original":"CARO CUORE 99999999","nombre_limpio":"Caro Cuore","categoria_sugerida":"Ropa","subcategoria_sugerida":null,"hijo":null,"monto":59900.01,"moneda":"ARS","tipo":"gasto","es_credito":false,"cuotas_total":1,"cuota_numero":1,"titular":"GALLO PROT FLORENCIA"}]}

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
${aliasesBlock}
${neutroAliasesBlock}
${incomeExamplesBlock}
${childrenText ? `═══════════════════════════════
CAMPO hijo (por transacción):
═══════════════════════════════
HIJOS REGISTRADOS POR EL USUARIO:
${childrenText}

Si la descripción de la transacción contiene exactamente el nombre de uno de estos hijos, o es un gasto claramente asociado a uno de ellos (colegio, pediatra, cuota, etc. si el nombre aparece en la descripción), asigná ese nombre exacto en el campo "hijo". Si no hay ninguna mención clara a un hijo registrado, dejá "hijo": null. No inventes ni infieras un hijo sin que su nombre aparezca en la descripción.
` : ''}
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
- periodo: en resúmenes de tarjeta es el mes del CIERRE del resumen (el mes de fecha_facturacion), NO el mes de las compras — el resumen que cierra en junio trae compras de mayo y su periodo es "Junio". En extractos bancarios es el mes de los movimientos.
- SÍ incluir "SU PAGO", "Gracias por su pago" y pagos al resumen de tarjeta (en extractos de tarjeta): son pagos hechos hacia la tarjeta, no un gasto ni un ingreso — van con tipo: "neutro" (categoria_sugerida: "A Identificar" si no hay una mejor)
- nombre_limpio: nombre legible. Si es críptico, dejarlo igual al original.
- es_credito: true para devoluciones o reintegros reales en tarjeta (ej. "Devolución Percepción...", "Dev. Imp...", "Reintegro..."). Cuando es_credito es true, el campo "tipo" de esa transacción tiene que ser "ingreso", nunca "gasto"
- Para cuotas: completar cuotas_total y cuota_numero
- titular: nombre del titular
- categoria_sugerida y subcategoria_sugerida: elegí SOLO de las listas de abajo, con el nombre exacto tal como está escrito. Nunca inventes una categoría o subcategoría que no esté en la lista. Si no estás seguro o no encaja en ninguna → "A Identificar"
- IMPORTANTE: incluí TODAS las transacciones del período, sin omitir ninguna, aunque sean muchas.
- CARGOS DE CIERRE (resúmenes de tarjeta): después del detalle de consumo, casi todos los
  resúmenes tienen una sección de cargos entre el SUBTOTAL y el TOTAL A PAGAR — cosas como
  INTERESES COMPENSATORIOS, INTERESES PUNITORIOS, IMPUESTO DE SELLOS, I.V.A., PERCEPCION
  IVA, PERCEP. AFIP, PERC. IIBB, COMISION/MANTENIMIENTO DE CUENTA, etc. Son transacciones
  reales igual que cualquier compra del detalle — NUNCA los omitas ni los ignores porque
  aparezcan en una sección distinta o con otro formato. Cada uno de estos conceptos tiene
  que salir como su propia transacción (tipo "gasto", categoría "Débitos" con la
  subcategoría que corresponda: Impuestos, Percepciones, Intereses).
- MISMO CARGO EN DOS MONEDAS: un cargo de cierre puede tener un monto en la columna PESOS
  Y OTRO en la columna DÓLARES en la MISMA fila (ej. "IMPUESTO DE SELLOS   31.908,79   0,97"
  — son 31.908,79 pesos MÁS 0,97 dólares, dos cargos distintos con el mismo nombre, no una
  conversión del mismo monto). Cuando eso pase, generá DOS transacciones separadas para esa
  fila, una con moneda "ARS" y el monto de la columna pesos, otra con moneda "USD" y el
  monto de la columna dólares — nunca elijas una sola columna y descartes la otra.
- Verificá que la suma de todas las transacciones que devolvés (en cada moneda) sea
  coherente con el TOTAL A PAGAR que informa el resumen — si no cierra, revisá si te faltó
  alguno de estos cargos de cierre antes de responder.
- total_pesos y total_dolares: son el total final que el resumen informa para pagar en
  cada moneda (buscá explícitamente "TOTAL PESOS"/"TOTAL A PAGAR" y "TOTAL DÓLARES" en el
  resumen), NUNCA los recalcules sumando las transacciones que extrajiste. Si el resumen
  informa un SALDO A FAVOR en esa moneda (el cliente pagó de más y el banco le debe a él,
  no al revés) devolvé ese total como número NEGATIVO — no lo omitas ni lo pongas en 0.
  Esto es común en dólares cuando hubo un pago en esa moneda que superó lo consumido.

═══════════════════════════════
CATEGORÍAS PARA TARJETAS DE CRÉDITO (usar nombres exactos):
═══════════════════════════════
${categoriasTarjetaText}

═══════════════════════════════
CATEGORÍAS PARA CUENTAS BANCARIAS (usar nombres exactos):
═══════════════════════════════
${categoriasBancoText}

Orden de prioridad para clasificar cada transacción: 1) reglas aprendidas del usuario, 2) alias definidos por el usuario, 3) las reglas de asignación de abajo (solo como pistas por nombre de comercio), 4) si nada aplica → "A Identificar". Estas reglas de abajo son orientativas: si el comercio no está en ninguna, no inventes una categoría, usá "A Identificar".

═══════════════════════════════
REGLAS DE ASIGNACIÓN PARA TARJETAS:
═══════════════════════════════
- COMISION/mantenimiento de cuenta o tarjeta → Débitos (sin subcategoría específica si no hay una de "Comisiones")
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
- DEVOLUCIÓN/REINTEGRO/DEV. de percepción, impuesto, comisión o interés → misma categoría que le correspondería sin el prefijo (ej. Débitos / Percepciones), pero tipo: "ingreso", es_credito: true (es guita que vuelve, no un gasto)
- Percepciones/PERCEPCION (sin prefijo de devolución) → Débitos / Percepciones
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

IMPORTANTE: Respondé ÚNICAMENTE con el objeto JSON. Sin texto previo, sin explicaciones, sin bloques de código markdown. Tu respuesta debe empezar con { y terminar con }.`
}

// Minifica la respuesta de Claude a JSON válido. Si la respuesta vino truncada
// (ej. se cortó por max_tokens en extractos largos), rescata hasta la última
// transacción completa en vez de fallar todo: "transacciones" es la última
// clave del JSON pedido, así que cerrando el array y el objeto después de una
// transacción completa queda válido.
export function salvageClaudeJson(data) {
  try {
    const textBlock = data?.content?.find(b => b.type === 'text')
    if (textBlock?.text) {
      const text = textBlock.text
      const jsonStart = text.indexOf('{')
      if (jsonStart === -1) throw new Error('No JSON object found in response')
      const raw = text.slice(jsonStart)
      let parsed = null
      try {
        const jsonEnd = raw.lastIndexOf('}')
        parsed = JSON.parse(raw.slice(0, jsonEnd + 1))
      } catch {
        const arrKey = raw.indexOf('"transacciones"')
        let cut = arrKey !== -1 ? raw.lastIndexOf('}') : -1
        while (cut > arrKey && arrKey !== -1) {
          try { parsed = JSON.parse(raw.slice(0, cut + 1) + ']}'); break } catch {}
          cut = raw.lastIndexOf('}', cut - 1)
        }
        if (parsed) console.error(`Respuesta truncada (stop_reason=${data?.stop_reason}): rescatadas ${parsed.transacciones?.length ?? 0} transacciones`)
      }
      if (!parsed) throw new Error('JSON inválido y sin rescate posible')
      textBlock.text = JSON.stringify(parsed)
    }
  } catch (e) {
    console.error('Error minificando en servidor:', e.message)
  }
  return data
}
