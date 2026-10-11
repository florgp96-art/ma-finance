import { esErrorDeCarga, importarModulo, MENSAJE_VERSION_NUEVA } from './cargaDiferida'

const errorDeChunk = () => Object.assign(new Error('Loading chunk 238 failed.'), { name: 'ChunkLoadError' })

test('esErrorDeCarga reconoce los errores de archivos que ya no existen', () => {
  expect(esErrorDeCarga(errorDeChunk())).toBe(true)
  expect(esErrorDeCarga(new Error('Failed to fetch dynamically imported module: /static/js/x.js'))).toBe(true)
  expect(esErrorDeCarga(new Error('Cannot read properties of undefined'))).toBe(false)
  expect(esErrorDeCarga(null)).toBe(false)
})

test('un corte de red se salva con el reintento', async () => {
  const importar = jest.fn().mockRejectedValueOnce(errorDeChunk()).mockResolvedValueOnce({ ok: true })
  await expect(importarModulo(importar)).resolves.toEqual({ ok: true })
  expect(importar).toHaveBeenCalledTimes(2)
})

test('si el archivo sigue sin estar, avisa que hay una versión nueva', async () => {
  const importar = jest.fn().mockRejectedValue(errorDeChunk())
  await expect(importarModulo(importar)).rejects.toThrow(MENSAJE_VERSION_NUEVA)
})

test('otros errores pasan tal cual, sin reintentar', async () => {
  const importar = jest.fn().mockRejectedValue(new Error('otra cosa'))
  await expect(importarModulo(importar)).rejects.toThrow('otra cosa')
  expect(importar).toHaveBeenCalledTimes(1)
})
