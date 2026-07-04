import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`

export async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true, isEvalSupported: false }).promise

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

  const cutMarkers = ['TOTAL A PAGAR', 'Plan V:', 'CFTEA']
  let finalText = cleaned
  for (const marker of cutMarkers) {
    const idx = cleaned.toUpperCase().indexOf(marker.toUpperCase())
    if (idx !== -1) {
      finalText = cleaned.substring(0, idx + 200)
      break
    }
  }

  // Tope de seguridad: si ningún marcador matcheó (banco/formato no contemplado),
  // no mandar el documento entero (letra chica legal incluida) a la IA — eso
  // dispara respuestas más lentas y arriesga el timeout del servidor.
  const MAX_CHARS = 12000
  if (finalText.length > MAX_CHARS) finalText = finalText.slice(0, MAX_CHARS)

  console.log(`Texto extraído: ${finalText.length} chars`)
  return finalText
}

export async function analyzeStatementWithClaude(pdfText, cardName, userRules, token, incomeExamples) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers,
    body: JSON.stringify({ pdfText, cardName, userRules: userRules || [], incomeExamples: incomeExamples || [] })
  })

  if (!response.ok) {
    console.error('Error HTTP:', response.status, await response.text())
    if ([502, 503, 504, 524].includes(response.status)) {
      throw new Error('El extracto tardó demasiado en procesarse (puede ser muy largo o el servidor está ocupado). Probá de nuevo, o si el PDF es muy largo intentá dividirlo en partes más chicas.')
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