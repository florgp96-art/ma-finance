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

  const cleaned = fullText
    .replace(/[^\x20-\x7E\n\r\táéíóúüñÁÉÍÓÚÜÑ°$%.,;:()\-/]/g, ' ')
    .replace(/\s{3,}/g, '  ')
    .trim()

  console.log(`Texto extraído: ${cleaned.length} chars`)
  return cleaned
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