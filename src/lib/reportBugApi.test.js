// api/reportBug.js con el adjunto del botón "Algo no se leyó bien" de la importación.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'cliente@mail.com' } }, error: null }) },
  }),
}))
jest.mock('../../api/_lib/rateLimit.js', () => ({ checkRateLimit: async () => true }))

const { default: handler } = require('../../api/reportBug.js')

const pedir = async (body) => {
  const res = { statusCode: 200, cuerpo: null, status(c) { this.statusCode = c; return this }, json(b) { this.cuerpo = b; return this }, end() { return this } }
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res)
  return res
}

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true }))
  process.env.NOTIFY_EMAIL = 'duena@mail.com'
  process.env.RESEND_API_KEY = 're_test'
})

test('el resumen viaja adjunto en el mail a quien administra la app', async () => {
  const res = await pedir({ mensaje: 'Lectura con problemas', pagina: 'importar', adjunto: { nombre: 'resumen.pdf', base64: 'JVBERi0x' } })
  expect(res.statusCode).toBe(200)
  const mail = JSON.parse(global.fetch.mock.calls[0][1].body)
  expect(mail.attachments).toEqual([{ filename: 'resumen.pdf', content: 'JVBERi0x' }])
  expect(mail.subject).toMatch(/no se leyó bien/)
})

test('sin adjunto sigue siendo el reporte de error de siempre', async () => {
  await pedir({ mensaje: 'Se rompió algo', pagina: 'resumen' })
  const mail = JSON.parse(global.fetch.mock.calls[0][1].body)
  expect(mail.attachments).toBeUndefined()
  expect(mail.subject).toMatch(/Reporte de error/)
})

test('un adjunto demasiado grande o sin nombre se rechaza', async () => {
  expect((await pedir({ mensaje: 'x', adjunto: { nombre: 'a.pdf', base64: 'A'.repeat(4_300_000) } })).statusCode).toBe(400)
  expect((await pedir({ mensaje: 'x', adjunto: { nombre: '', base64: 'JVBERi0x' } })).statusCode).toBe(400)
  expect(global.fetch).not.toHaveBeenCalled()
})
