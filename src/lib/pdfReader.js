import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`

// Devuelve el texto del PDF, o null si el archivo no se puede leer como texto
// (PDF dañado/no estándar, escaneado, o sin la tabla de movimientos). En ese
// caso el caller debe usar analyzePdfDocumentWithClaude como fallback.
export async function extractTextFromPDF(file) {
  let pdf
  try {
    const arrayBuffer = await file.arrayBuffer()
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true, isEvalSupported: false }).promise
  } catch (e) {
    // Ej. "Invalid PDF structure": algunos bancos generan PDFs que pdf.js
    // rechaza aunque abran bien en cualquier visor.
    console.warn('pdf.js no pudo abrir el PDF, se usará análisis de documento:', e.message)
    return null
  }

  let fullText = ''

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const items = textContent.items.filter(item => item.str && item.str.trim())

    if (items.length === 0) { fullText += '\n'; continue }

    // Group items by row using Y coordinate (PDF y=0 is at bottom, higher y = higher on page)
    const byRow = {}
    for (const item of items) {
      const y = Math.round(item.transform[5] / 3) * 3  // 3px tolerance
      if (!byRow[y]) byRow[y] = []
      byRow[y].push({ x: item.transform[4], str: item.str.trim() })
    }

    // Sort descending by y (= top to bottom), within row sort by x (left to right)
    const sortedRows = Object.keys(byRow)
      .sort((a, b) => Number(b) - Number(a))
      .map(y => byRow[y].sort((a, b) => a.x - b.x).map(c => c.str).join(' '))
      .filter(r => r.trim())

    fullText += `\n--- Página ${i} ---\n${sortedRows.join('\n')}`
  }

  const cleaned = fullText
    .replace(/[^\x20-\x7E\n\r\táéíóúüñÁÉÍÓÚÜÑ°$%.,;:()\-/]/g, ' ')
    .replace(/[ \t]{3,}/g, '  ')
    .trim()

  // Cortar la letra chica legal del final. Ojo: en algunos resúmenes (ej.
  // Galicia) "Total a pagar" también aparece en el encabezado, ANTES de la
  // tabla de movimientos — por eso solo cortamos si el marcador está en la
  // mitad final del documento (usando la última aparición, no la primera).
  const cutMarkers = ['TOTAL A PAGAR', 'Plan V:', 'CFTEA']
  let finalText = cleaned
  for (const marker of cutMarkers) {
    const idx = cleaned.toUpperCase().lastIndexOf(marker.toUpperCase())
    if (idx !== -1 && idx > cleaned.length * 0.5) {
      finalText = cleaned.substring(0, idx + 200)
      break
    }
  }

  // Tope de seguridad: si ningún marcador matcheó (banco/formato no contemplado),
  // no mandar el documento entero (letra chica legal incluida) a la IA — eso
  // dispara respuestas más lentas y arriesga el timeout del servidor.
  const MAX_CHARS = 16000
  if (finalText.length > MAX_CHARS) finalText = finalText.slice(0, MAX_CHARS)

  console.log(`Texto extraído: ${finalText.length} chars`)

  // ¿El texto tiene pinta de contener la tabla de movimientos? Contamos líneas
  // con fecha + importe. Si hay muy pocas (resúmenes donde la tabla no sale
  // como texto, ej. algunos Galicia), mejor mandar el PDF entero a la IA.
  const txLikeLines = finalText.split('\n').filter(l =>
    /\b\d{1,2}[/\-.]\d{1,2}([/\-.]\d{2,4})?\b/.test(l) && /\d(?:[\d.,]*\d)?[.,]\d{2}\b/.test(l)
  ).length
  if (txLikeLines < 5) {
    console.warn(`Solo ${txLikeLines} líneas con pinta de movimiento: se usará análisis de documento`)
    return null
  }

  return finalText
}

const parseAnalyzeResponse = async (response) => {
  if (!response.ok) {
    console.error('Error HTTP:', response.status, await response.text())
    if ([502, 503, 504, 524].includes(response.status)) {
      throw new Error('El extracto tardó demasiado en procesarse (puede ser muy largo o el servidor está ocupado). Probá de nuevo, o si el PDF es muy largo intentá dividirlo en partes más chicas.')
    }
    if (response.status === 413) {
      throw new Error('El PDF es demasiado pesado. Probá descargar el resumen original desde el home banking (suele pesar menos que una versión escaneada).')
    }
    throw new Error(`Error del servidor (${response.status}). Probá de nuevo en unos minutos.`)
  }

  const data = await response.json()
  console.log('=== Claude raw response ===', JSON.stringify(data, null, 2))

  try {
    if (!data?.content || !Array.isArray(data.content) || data.content.length === 0) {
      if (data?.error) throw new Error(`Claude error: ${data.error.message}`)
      throw new Error('Respuesta vacía de Claude')
    }

    const textBlock = data.content.find(block => block.type === 'text')
    if (!textBlock?.text) throw new Error('No se encontró bloque de texto en la respuesta')

    const clean = textBlock.text
      .replace(/^```json\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()

    const parsed = JSON.parse(clean)

    if (!parsed.transacciones || !Array.isArray(parsed.transacciones)) {
      throw new Error('JSON válido pero sin array de transacciones')
    }

    console.log(`✅ ${parsed.transacciones.length} transacciones extraídas`)
    return parsed

  } catch (e) {
    console.error('=== Error procesando respuesta ===')
    console.error('Mensaje:', e.message)
    console.error('stop_reason:', data?.stop_reason)
    console.error('usage:', data?.usage)
    throw new Error(`No se pudo procesar el extracto: ${e.message}`)
  }
}

export async function analyzeStatementWithClaude(pdfText, cardName, userRules, token, incomeExamples, categories, subcategories, children, aliases) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      pdfText, cardName, userRules: userRules || [], incomeExamples: incomeExamples || [],
      categories: categories || [], subcategories: subcategories || [], children: children || [], aliases: aliases || [],
    })
  })
  return parseAnalyzeResponse(response)
}

// Fallback: manda el PDF completo (base64) para que la IA lo lea como
// documento. Cubre PDFs que pdf.js no puede abrir, escaneados, o cuya tabla
// de movimientos no sale en la capa de texto.
export async function analyzePdfDocumentWithClaude(file, cardName, userRules, token, incomeExamples, categories, subcategories, children, aliases) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result.split(',')[1])
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.readAsDataURL(file)
  })

  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const response = await fetch('/api/analyzePdf', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      pdfBase64: base64, cardName, userRules: userRules || [], incomeExamples: incomeExamples || [],
      categories: categories || [], subcategories: subcategories || [], children: children || [], aliases: aliases || [],
    })
  })
  return parseAnalyzeResponse(response)
}
