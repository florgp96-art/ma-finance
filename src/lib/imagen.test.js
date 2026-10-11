import { medidasAjustadas, LADO_MAXIMO, PIXELES_MAXIMOS } from './imagen'

describe('medidasAjustadas: al tamaño con el que la IA lee la imagen', () => {
  test('una foto del celular (4032 × 3024) queda dentro de los dos topes, con la misma proporción', () => {
    const { ancho, alto } = medidasAjustadas(4032, 3024)
    expect(Math.max(ancho, alto)).toBeLessThanOrEqual(LADO_MAXIMO)
    expect(ancho * alto).toBeLessThanOrEqual(PIXELES_MAXIMOS * 1.01)
    expect(ancho / alto).toBeCloseTo(4032 / 3024, 2)
  })

  test('una captura alta (1170 × 2532) se ajusta por el lado largo', () => {
    const { ancho, alto } = medidasAjustadas(1170, 2532)
    expect(alto).toBeLessThanOrEqual(LADO_MAXIMO)
    expect(ancho / alto).toBeCloseTo(1170 / 2532, 2)
  })

  test('una imagen chica no se agranda', () => {
    expect(medidasAjustadas(800, 600)).toEqual({ ancho: 800, alto: 600 })
  })

  test('medidas inválidas', () => {
    expect(medidasAjustadas(0, 100)).toEqual({ ancho: 0, alto: 0 })
    expect(medidasAjustadas(NaN, 100)).toEqual({ ancho: 0, alto: 0 })
  })
})
