import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`

export async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  let fullText = ''

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items.map(item => item.str).join(' ')
    fullText += `\n--- Página ${i} ---\n${pageText}`
  }

  return fullText
}

export async function analyzeStatementWithClaude(pdfText, cardName) {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfText, cardName })
  })

  if (!response.ok) {
    console.error('Error HTTP:', response.status, await response.text())
    throw new Error(`Error del servidor: ${response.status}`)
  }

  const data = await response.json()
  console.log('=== Claude raw response ===', JSON.stringify(data, null, 2))

  try {
    // Validar estructura de respuesta
    if (!data?.content || !Array.isArray(data.content) || data.content.length === 0) {
      console.error('Estructura inesperada:', data)
      // Si Claude devolvió un error (ej: stop_reason: "max_tokens")
      if (data?.error) throw new Error(`Claude error: ${data.error.message}`)
      throw new Error('Respuesta vacía de Claude')
    }

    // Buscar el primer bloque de texto
    const textBlock = data.content.find(block => block.type === 'text')
    if (!textBlock?.text) throw new Error('No se encontró bloque de texto en la respuesta')

    const raw = textBlock.text

    // Verificar si fue cortado por max_tokens
    if (data.stop_reason === 'max_tokens') {
      console.warn('⚠️ Respuesta cortada por max_tokens — intentando parsear igual')
    }

    // Limpiar y parsear
    const clean = raw
      .replace(/^```json\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()

    const parsed = JSON.parse(clean)

    // Validación mínima del resultado
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