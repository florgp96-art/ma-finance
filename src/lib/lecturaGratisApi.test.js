// Una lectura con IA del plan gratis a la vez (reservarLecturaGratis en
// api/_lib/plan.js), entrando por /api/analyze como lo hace la app, con Claude y
// Supabase simulados. Vive en src/ porque los tests corren solo desde acá.

jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn() }))

const mockEventos = []
let mockPlan = null
let mockReservaLibre = true
jest.mock('@supabase/supabase-js', () => {
  const consulta = (tabla) => {
    const q = {
      select: () => q, order: () => q, limit: () => q, gte: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: mockPlan, error: null }),
      insert: async () => { mockEventos.push(`insert ${tabla}`); return { error: null } },
      delete: () => ({ eq: async (k, v) => { mockEventos.push(`soltar ${v}`); return { error: null } } }),
      then: (resolve) => resolve(tabla === 'ai_usage' ? { count: 0 } : { data: [], error: null }),
    }
    return q
  }
  return {
    createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'x@mail.com' } }, error: null }) },
      from: consulta,
      rpc: async (nombre, args) => { mockEventos.push(`rpc ${args.p_key}`); return { data: mockReservaLibre, error: null } },
    }),
  }
})
jest.mock('../../api/_lib/rateLimit.js', () => ({ checkRateLimit: async () => true }))

const { default: handler } = require('../../api/analyze.js')

const GRATIS = { plan: 'free', is_legacy: false, premium_hasta: null, tuvo_premium: false }
const PREMIUM = { plan: 'premium', is_legacy: false, premium_hasta: null, tuvo_premium: false }
const respuestaIA = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ tipo_documento: 'tarjeta', transacciones: [] }) }] }

const pedir = async () => {
  const res = {
    statusCode: 200, cuerpo: null,
    status(c) { this.statusCode = c; return this },
    json(b) { mockEventos.push(`responde ${this.statusCode}`); this.cuerpo = b; return this },
    end() { return this },
  }
  await handler({ method: 'POST', query: {}, headers: { authorization: 'Bearer t' }, body: { pdfText: 'EXTRACTO' } }, res)
  return res
}

beforeEach(() => {
  mockEventos.length = 0
  mockPlan = GRATIS
  mockReservaLibre = true
})

test('con otra lectura gratis en curso responde 429 y no llama a la IA', async () => {
  mockReservaLibre = false
  global.fetch = jest.fn()
  const res = await pedir()
  expect(res.statusCode).toBe(429)
  expect(res.cuerpo.code).toBe('LECTURA_EN_CURSO')
  expect(global.fetch).not.toHaveBeenCalled()
})

test('si la IA falla, suelta la reserva ANTES de responder (la app reintenta enseguida)', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 529, text: async () => 'overloaded' }))
  const res = await pedir()
  expect(res.statusCode).toBe(502)
  expect(mockEventos).toEqual(['rpc ia-gratis-en-curso:u1', 'soltar ia-gratis-en-curso:u1', 'responde 502'])
})

test('si sale bien, anota el cupo y no suelta la reserva', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => respuestaIA }))
  const res = await pedir()
  expect(res.statusCode).toBe(200)
  expect(mockEventos).toContain('insert ai_usage')
  expect(mockEventos.some(e => e.startsWith('soltar'))).toBe(false)
})

test('si la IA tira una excepción, la reserva se suelta igual', async () => {
  global.fetch = jest.fn(async () => { throw new Error('sin red') })
  await expect(pedir()).rejects.toThrow('sin red')
  expect(mockEventos).toContain('soltar ia-gratis-en-curso:u1')
})

test('premium no reserva nada', async () => {
  mockPlan = PREMIUM
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => respuestaIA }))
  const res = await pedir()
  expect(res.statusCode).toBe(200)
  expect(mockEventos.some(e => e.startsWith('rpc'))).toBe(false)
})
