import { crearColaDeGuardado, conReintento } from './colaGuardado'

const ok = () => Promise.resolve({ error: null })
const falla = () => Promise.resolve({ error: { message: 'sin red' } })

// Deja correr las promesas pendientes (las escrituras encadenadas).
const drenar = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

beforeEach(() => { jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers() })

test('ahora(): sale en el momento', async () => {
  const escribir = jest.fn(ok)
  const cola = crearColaDeGuardado({ esperaReintento: 0 })
  const resultado = cola.ahora('dia:1', escribir)
  expect(escribir).toHaveBeenCalledTimes(1)
  await expect(resultado).resolves.toBe(null)
})

test('programar(): throttle con trailing — una escritura a los 500 ms con el último valor, sin correr el plazo', async () => {
  const escritos = []
  const cola = crearColaDeGuardado({ esperaReintento: 0 })
  cola.programar('dia:1', () => { escritos.push(1); return ok() })
  jest.advanceTimersByTime(300)
  cola.programar('dia:1', () => { escritos.push(2); return ok() })
  jest.advanceTimersByTime(199)
  cola.programar('dia:1', () => { escritos.push(3); return ok() })
  expect(escritos).toEqual([])
  jest.advanceTimersByTime(1)
  await drenar()
  expect(escritos).toEqual([3])
})

test('vaciar(): manda ya lo agendado y avisa si quedó todo guardado', async () => {
  const escribir = jest.fn(ok)
  const cola = crearColaDeGuardado({ esperaReintento: 0 })
  cola.programar('mes:1', escribir)
  const promesa = cola.vaciar()
  expect(escribir).toHaveBeenCalledTimes(1)
  await expect(promesa).resolves.toBe(true)
  jest.advanceTimersByTime(1000)
  expect(escribir).toHaveBeenCalledTimes(1)
})

test('las escrituras de una misma fila salen en orden: el update espera al insert', async () => {
  const orden = []
  let terminarInsert
  const cola = crearColaDeGuardado({ esperaReintento: 0 })
  cola.ahora('dia:1', () => new Promise(resolve => { orden.push('insert'); terminarInsert = () => resolve({ error: null }) }))
  cola.programar('dia:1', () => { orden.push('update'); return ok() })
  cola.vaciar()
  await drenar()
  expect(orden).toEqual(['insert'])
  terminarInsert()
  await drenar()
  expect(orden).toEqual(['insert', 'update'])
})

test('reintenta una vez; si vuelve a fallar informa el error', async () => {
  const escribir = jest.fn(falla)
  const estados = []
  const cola = crearColaDeGuardado({ esperaReintento: 0, onEstado: e => estados.push(e) })
  await expect(cola.ahora('dia:1', escribir)).resolves.toEqual({ message: 'sin red' })
  expect(escribir).toHaveBeenCalledTimes(2)
  expect(estados.at(-1)).toMatchObject({ pendientes: 0, error: { message: 'sin red' } })
})

test('un fallo y después éxito: no se informa error', async () => {
  const escribir = jest.fn().mockResolvedValueOnce({ error: { message: 'x' } }).mockResolvedValueOnce({ error: null })
  const cola = crearColaDeGuardado({ esperaReintento: 0 })
  await expect(cola.ahora('dia:1', escribir)).resolves.toBe(null)
  expect(escribir).toHaveBeenCalledTimes(2)
})

test('un tipeo que no se pudo guardar queda para reintentar()', async () => {
  const estados = []
  const cola = crearColaDeGuardado({ esperaReintento: 0, onEstado: e => estados.push(e) })
  cola.programar('dia:1', falla)
  await expect(cola.vaciar()).resolves.toBe(false)
  expect(estados.at(-1)).toMatchObject({ fallidas: 1, pendientes: 0 })

  const reintento = jest.fn(ok)
  cola.programar('dia:1', reintento) // el tipeo siguiente de esa fila reemplaza al fallido
  await cola.vaciar()
  expect(reintento).toHaveBeenCalledTimes(1)
  expect(estados.at(-1)).toMatchObject({ fallidas: 0, error: null, guardoAlgo: true })
})

test('reintentar() vuelve a mandar lo fallido', async () => {
  const escribir = jest.fn().mockResolvedValueOnce({ error: 'a' }).mockResolvedValueOnce({ error: 'b' }).mockResolvedValue({ error: null })
  const estados = []
  const cola = crearColaDeGuardado({ esperaReintento: 0, onEstado: e => estados.push(e) })
  cola.programar('mes:1', escribir)
  await cola.vaciar()
  expect(estados.at(-1).fallidas).toBe(1)
  await cola.reintentar()
  expect(escribir).toHaveBeenCalledTimes(3)
  expect(estados.at(-1)).toMatchObject({ fallidas: 0, error: null })
})

test('descartar(): una fila borrada no manda lo que tenía agendado', async () => {
  const escribir = jest.fn(ok)
  const cola = crearColaDeGuardado({ esperaReintento: 0 })
  cola.programar('dia:1', escribir)
  cola.descartar('dia:1')
  jest.advanceTimersByTime(1000)
  await cola.vaciar()
  expect(escribir).not.toHaveBeenCalled()
})

test('un throw cuenta como error, no rompe la cola', async () => {
  const cola = crearColaDeGuardado({ esperaReintento: 0 })
  const error = await cola.ahora('dia:1', () => { throw new Error('offline') })
  expect(error).toBeInstanceOf(Error)
  await expect(cola.ahora('dia:1', ok)).resolves.toBe(null)
})

test('conReintento: devuelve los datos del intento que anduvo', async () => {
  const fn = jest.fn().mockResolvedValueOnce({ data: null, error: 'x' }).mockResolvedValueOnce({ data: [1], error: null })
  await expect(conReintento(fn, 0)).resolves.toEqual({ data: [1], error: null })
})
