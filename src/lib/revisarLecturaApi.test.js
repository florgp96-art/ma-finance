// Prueba de punta a punta de api/revisarLectura.js, con la API de Claude y
// Supabase simulados. Vive en src/ porque los tests corren solo desde acá.

const mockCrear = jest.fn()
jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  const Anthropic = jest.fn().mockImplementation(() => ({ beta: { messages: { create: mockCrear } } }))
  Anthropic.APIError = APIError
  return { __esModule: true, default: Anthropic }
})

const mockInsertados = []
let mockNotasGuardadas = []
let mockPlan = { plan: 'premium', is_legacy: false, premium_hasta: null, tuvo_premium: false }
let mockUsoReciente = 0
jest.mock('@supabase/supabase-js', () => {
  const consulta = (tabla) => {
    const q = {
      filtros: {},
      select: () => q,
      order: () => q,
      limit: () => q,
      gte: () => q,
      eq: (k, v) => { q.filtros[k] = v; return q },
      maybeSingle: async () => ({ data: mockPlan, error: null }),
      insert: async (fila) => { mockInsertados.push({ tabla, fila }); return { error: null } },
      then: (resolve) => {
        if (tabla === 'ai_usage') return resolve({ count: mockUsoReciente })
        if (tabla === 'formatos_lectura') {
          const data = q.filtros.nota ? mockNotasGuardadas.filter(n => n.nota === q.filtros.nota) : mockNotasGuardadas
          return resolve({ data, error: null })
        }
        if (tabla === 'rate_limits') return resolve({ data: [], error: null, count: 0 })
        return resolve({ data: [], error: null })
      },
    }
    return q
  }
  return {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'cliente@mail.com' } }, error: null }) },
      from: consulta,
      rpc: async () => ({ data: true, error: null }),
    }),
  }
})
jest.mock('../../api/_lib/rateLimit.js', () => ({ checkRateLimit: async () => true }))

const { default: handler } = require('../../api/revisarLectura.js')

const consumo = (fecha, nombre, monto) =>
  ({ fecha, nombre_original: nombre, nombre_limpio: nombre, categoria_sugerida: 'A Identificar', subcategoria_sugerida: null, hijo: null, monto, moneda: 'ARS', tipo: 'gasto', es_credito: false, cuotas_total: 1, cuota_numero: 1, titular: 'GALLO PROT FLORENCIA' })
const resultado = {
  tipo_documento: 'tarjeta', total_pesos: 150000, total_dolares: 0, saldo_anterior_pesos: null, saldo_anterior_dolares: null,
  adicionales: [], transacciones: [consumo('2026-09-03', 'SUPER', 100000), consumo('2026-09-10', 'NAFTA', 29000)],
}

const pedir = async (body) => {
  const res = { statusCode: 200, cuerpo: null, status(c) { this.statusCode = c; return this }, json(b) { this.cuerpo = b; return this }, end() { return this } }
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res)
  return res
}
const respuestaIA = (revision, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify(revision) }] })

beforeEach(() => {
  mockCrear.mockReset()
  mockInsertados.length = 0
  mockNotasGuardadas = []
  mockPlan = { plan: 'premium', is_legacy: false, premium_hasta: null, tuvo_premium: false }
  mockUsoReciente = 0
  global.fetch = jest.fn(async () => ({ ok: true }))
  process.env.NOTIFY_EMAIL = 'duena@mail.com'
  process.env.RESEND_API_KEY = 're_test'
})

test('encuentra lo que faltaba, cierra, y aprende el formato sin datos del cliente', async () => {
  mockCrear.mockResolvedValue(respuestaIA({
    quitar: [], saldo_anterior_pesos: null, saldo_anterior_dolares: null,
    formato: { entidad: 'Santander', producto: 'Visa Platinum' },
    nota_formato: 'El IVA de $ 21.000 de Gallo Prot figura al pie de la última página, separado del detalle de consumos.',
    agregar: [consumo('2026-09-30', 'IVA', 21000)],
  }))
  const res = await pedir({ pdfText: 'texto del resumen', resultado })
  expect(res.statusCode).toBe(200)
  expect(res.cuerpo.revision).toEqual({ estado: 'cuadra', agregados: 1, quitados: 0 })
  expect(res.cuerpo.resultado.transacciones).toHaveLength(3)

  const pedido = mockCrear.mock.calls[0][0]
  expect(pedido.model).toBe('claude-opus-5-5')
  expect(pedido.fallbacks).toBe('default')
  expect(pedido.output_config.format.type).toBe('json_schema')
  expect(pedido.messages[0].content).toContain('faltan $ 21.000')

  const nota = mockInsertados.find(i => i.tabla === 'formatos_lectura')
  expect(nota.fila).toMatchObject({ clave: 'santander|visa|tarjeta', entidad: 'Santander', producto: 'Visa Platinum' })
  expect(nota.fila.nota).not.toMatch(/\d|gallo|prot/i)
  expect(global.fetch).toHaveBeenCalledWith('https://api.resend.com/emails', expect.anything())
})

test('si la revisión no mejora nada, devuelve la primera lectura y no aprende nada', async () => {
  mockCrear.mockResolvedValue(respuestaIA({
    quitar: [], saldo_anterior_pesos: null, saldo_anterior_dolares: null,
    formato: { entidad: 'Santander', producto: 'Visa' }, nota_formato: 'Algo que no sirvió para nada en este resumen.',
    agregar: [consumo('2026-09-30', 'INVENTADO', 90000)],
  }))
  const res = await pedir({ pdfText: 'texto', resultado })
  expect(res.cuerpo.revision.estado).toBe('no_mejoro')
  expect(res.cuerpo.resultado).toEqual(resultado)
  expect(mockInsertados).toHaveLength(0)
})

test('se acerca sin cerrar: se usa la corrección, pero no se aprende de ella', async () => {
  mockCrear.mockResolvedValue(respuestaIA({
    quitar: [], saldo_anterior_pesos: null, saldo_anterior_dolares: null,
    formato: { entidad: 'Santander', producto: 'Visa' }, nota_formato: 'Los sellos están en una sección de cargos al final.',
    agregar: [consumo('2026-09-30', 'SELLOS', 1000)],
  }))
  const res = await pedir({ pdfText: 'texto', resultado })
  expect(res.cuerpo.revision.estado).toBe('mejoro')
  expect(mockInsertados).toHaveLength(0)
})

test('una lectura que ya cierra no se revisa', async () => {
  const cierra = { ...resultado, total_pesos: 129000 }
  const res = await pedir({ pdfText: 'texto', resultado: cierra })
  expect(res.cuerpo.revision.estado).toBe('no_hacia_falta')
  expect(mockCrear).not.toHaveBeenCalled()
})

test('el plan gratis solo puede revisar justo después de una lectura con IA', async () => {
  mockPlan = { plan: 'free', is_legacy: false, premium_hasta: null, tuvo_premium: false }
  mockUsoReciente = 0
  expect((await pedir({ pdfText: 'texto', resultado })).statusCode).toBe(402)
  mockUsoReciente = 1
  mockCrear.mockResolvedValue(respuestaIA({ quitar: [], saldo_anterior_pesos: null, saldo_anterior_dolares: null, formato: { entidad: 'X', producto: '' }, nota_formato: null, agregar: [consumo('2026-09-30', 'IVA', 21000)] }))
  expect((await pedir({ pdfText: 'texto', resultado })).statusCode).toBe(200)
})

test('un rechazo o una respuesta cortada no rompen nada: la app sigue con la primera lectura', async () => {
  mockCrear.mockResolvedValue({ stop_reason: 'refusal', content: [] })
  expect((await pedir({ pdfText: 'texto', resultado })).statusCode).toBe(422)
  mockCrear.mockRejectedValue(new Error('timeout'))
  expect((await pedir({ pdfText: 'texto', resultado })).statusCode).toBe(502)
})

test('manda el PDF como documento cuando la primera lectura fue con el PDF', async () => {
  mockCrear.mockResolvedValue(respuestaIA({ quitar: [], saldo_anterior_pesos: null, saldo_anterior_dolares: null, formato: { entidad: 'X', producto: '' }, nota_formato: null, agregar: [consumo('2026-09-30', 'IVA', 21000)] }))
  await pedir({ pdfBase64: 'JVBERi0x', resultado })
  const contenido = mockCrear.mock.calls[0][0].messages[0].content
  expect(contenido[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' } })
})
