// El cliente de Supabase se crea al importar el módulo y revienta sin las env vars
// (que viven en Vercel). Acá solo se prueban helpers puros, así que se mockea.
jest.mock('../lib/supabase', () => ({ supabase: {} }))

const { cicloAbiertoDe } = require('./AccountDetail')

describe('cicloAbiertoDe — cuándo cierra el ciclo abierto', () => {
  test('usa la fecha que informó el banco cuando está', () => {
    const ultimoReal = { proximo_cierre: '2026-08-09', proximo_vencimiento: '2026-08-16' }
    expect(cicloAbiertoDe(ultimoReal, '2026-07-09')).toEqual({
      cierre: '2026-08-09', vencimiento: '2026-08-16', estimado: false,
    })
  })

  test('sin próximo cierre del banco, estima corriendo un mes y lo marca', () => {
    // Marcarlo importa: una fecha estimada avisa, pero nunca da por facturada plata.
    expect(cicloAbiertoDe({ proximo_cierre: null }, '2026-07-09')).toEqual({
      cierre: '2026-08-09', vencimiento: null, estimado: true,
    })
  })

  test('las columnas del próximo ciclo pueden no existir todavía en la base', () => {
    // Si la migración no se corrió, el resumen viene sin esos campos: se estima igual
    // en vez de romperse.
    expect(cicloAbiertoDe({}, '2026-07-09')).toEqual({
      cierre: '2026-08-09', vencimiento: null, estimado: true,
    })
  })

  test('un cierre a fin de mes no se desborda al mes siguiente', () => {
    expect(cicloAbiertoDe(null, '2026-01-31').cierre).toBe('2026-02-28')
  })

  test('sin ningún resumen cargado no hay ciclo que calcular', () => {
    expect(cicloAbiertoDe(null, null)).toBeNull()
  })

  test('el próximo cierre del banco gana aunque haya un último cierre más nuevo', () => {
    // El "Contando desde" manual puede mover el piso del ciclo; el techo lo sigue
    // decidiendo el banco, no una resta de fechas.
    const ciclo = cicloAbiertoDe({ proximo_cierre: '2026-08-09' }, '2026-07-25')
    expect(ciclo).toEqual({ cierre: '2026-08-09', vencimiento: null, estimado: false })
  })
})
