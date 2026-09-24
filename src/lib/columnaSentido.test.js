// Cada test carga el módulo de nuevo: lo que recuerda vive a nivel de módulo.
const mockRespuestas = []
const mockConsultas = { cantidad: 0 }

jest.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: async () => { mockConsultas.cantidad++; return mockRespuestas.shift() },
      }),
    }),
  },
}))

const cargar = () => {
  let modulo
  jest.isolateModules(() => { modulo = require('./columnaSentido') })
  return modulo.hayColumnaSentido
}

beforeEach(() => {
  mockRespuestas.length = 0
  mockConsultas.cantidad = 0
})

test('si la consulta anda, la columna existe y no se vuelve a preguntar', async () => {
  const hayColumnaSentido = cargar()
  mockRespuestas.push({ data: [], error: null })
  expect(await hayColumnaSentido()).toBe(true)
  expect(await hayColumnaSentido()).toBe(true)
  expect(mockConsultas.cantidad).toBe(1)
})

// Un no puede ser un corte de red, o la migración se corre con la app abierta.
test('si falla, no la da por inexistente para siempre', async () => {
  const hayColumnaSentido = cargar()
  mockRespuestas.push({ data: null, error: { message: 'column transactions.sentido does not exist' } })
  mockRespuestas.push({ data: [], error: null })
  expect(await hayColumnaSentido()).toBe(false)
  expect(await hayColumnaSentido()).toBe(true)
  expect(mockConsultas.cantidad).toBe(2)
})
