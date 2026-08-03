// El cliente de Supabase se crea al importar el módulo y revienta sin las env vars
// (que viven en Vercel). Acá solo se prueban helpers puros, así que se mockea.
jest.mock('../lib/supabase', () => ({ supabase: {} }))

const { cicloAbiertoDe } = require('./AccountDetail')

describe('cicloAbiertoDe — cuándo cierra el ciclo abierto', () => {
  test('usa la fecha que informó el banco cuando está', () => {
    const ultimoReal = { proximo_cierre: '2026-08-09', proximo_vencimiento: '2026-08-16' }
    expect(cicloAbiertoDe(ultimoReal, '2026-07-09')).toEqual({
      cierre: '2026-08-09', vencimiento: '2026-08-16', origen: 'pdf',
    })
  })

  test('sin próximo cierre del banco, estima corriendo un mes y lo marca', () => {
    // Marcarlo importa: una fecha estimada avisa, pero nunca da por facturada plata.
    expect(cicloAbiertoDe({ proximo_cierre: null }, '2026-07-09')).toEqual({
      cierre: '2026-08-09', vencimiento: null, origen: 'estimado',
    })
  })

  test('las columnas del próximo ciclo pueden no existir todavía en la base', () => {
    // Si la migración no se corrió, el resumen viene sin esos campos: se estima igual
    // en vez de romperse.
    expect(cicloAbiertoDe({}, '2026-07-09')).toEqual({
      cierre: '2026-08-09', vencimiento: null, origen: 'estimado',
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
    expect(ciclo).toEqual({ cierre: '2026-08-09', vencimiento: null, origen: 'pdf' })
  })
})

describe('cicloAbiertoDe — el dato del PDF se vuelve viejo y lo manual le gana', () => {
  // Caso real: el resumen de julio de la Mastercard decía "próximo cierre 27-Ago", y
  // después se cambió la fecha de cobro desde el home banking a cerrar el 30-Jul. El
  // PDF quedó informando un cierre que nunca iba a pasar.
  const pdfViejo = { proximo_cierre: '2026-08-27', proximo_vencimiento: '2026-09-04' }

  test('el cierre cargado a mano le gana al del resumen', () => {
    const cuenta = { proximo_cierre: '2026-07-30', proximo_vencimiento: '2026-08-07' }
    expect(cicloAbiertoDe(pdfViejo, '2026-07-08', cuenta)).toEqual({
      cierre: '2026-07-30', vencimiento: '2026-08-07', origen: 'manual',
    })
  })

  test('sin nada cargado a mano sigue mandando el resumen', () => {
    expect(cicloAbiertoDe(pdfViejo, '2026-07-08', {})).toEqual({
      cierre: '2026-08-27', vencimiento: '2026-09-04', origen: 'pdf',
    })
  })

  test('un cierre manual que ya quedó atrás se descarta', () => {
    // Al importar el resumen que cierra ese ciclo, el último cierre pasa a ser el 30-Jul
    // y el override manual apunta a una fecha ya vivida: si no se descartara, el ciclo
    // nuevo arrancaría dado por cerrado.
    const cuenta = { proximo_cierre: '2026-07-30', proximo_vencimiento: '2026-08-07' }
    expect(cicloAbiertoDe({}, '2026-07-30', cuenta)).toEqual({
      cierre: '2026-08-30', vencimiento: null, origen: 'estimado',
    })
  })

  test('un próximo cierre del PDF que ya quedó atrás también se descarta', () => {
    expect(cicloAbiertoDe({ proximo_cierre: '2026-07-01' }, '2026-07-30')).toEqual({
      cierre: '2026-08-30', vencimiento: null, origen: 'estimado',
    })
  })
})
