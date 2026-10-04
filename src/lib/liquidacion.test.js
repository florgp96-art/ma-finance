import {
  TARIFAS_POR_DEFECTO, claveValida, diasDelMes, numeroValido, subtotalDia, resumenMes, ordenarDias,
  nuevoDia, tarifasHeredadas, mesParaAbrir, historialCerrados, totalDelMes, aCentavos, nombreValido, TARIFAS_EN_CERO,
} from './liquidacion'

const tarifas = { ...TARIFAS_POR_DEFECTO }

// Agosto 2026, tal como está en el seed: todos por hora, a 7.500 / 1.200.
const AGOSTO = [
  [4, 3, 2], [5, 3, 2], [6, 7.5, 2], [7, 4, 2], [11, 3, 2], [13, 3, 0], [14, 3, 2], [18, 5, 2],
  [20, 3, 2], [21, 4.5, 2], [24, 3, 1], [25, 3.5, 2], [26, 3, 1], [27, 2.5, 2], [28, 6, 2], [31, 3, 1],
].map(([dia, horas, viajes], i) => ({ id: `a${i}`, dia, tipo: 'horas', horas, viajes }))

describe('subtotalDia', () => {
  test('por hora: horas × hora + viajes × viático', () => {
    expect(subtotalDia({ tipo: 'horas', horas: 3, viajes: 2 }, tarifas)).toBe(3 * 7500 + 2 * 1200)
  })

  test('jornada: la jornada más las horas y viajes extra', () => {
    expect(subtotalDia({ tipo: 'jornada', horas: 1.5, viajes: 1 }, tarifas)).toBe(25000 + 1.5 * 7500 + 1200)
    expect(subtotalDia({ tipo: 'jornada', horas: 0, viajes: 0 }, tarifas)).toBe(25000)
  })

  test('valores rotos cuentan como cero, nunca NaN', () => {
    expect(subtotalDia({ tipo: 'horas', horas: 'x', viajes: -3 }, tarifas)).toBe(0)
    expect(subtotalDia({ tipo: 'horas', horas: 2, viajes: 0 }, { valor_hora: null })).toBe(0)
  })
})

describe('resumenMes', () => {
  test('agosto suma $ 482.400: 60 hs, 27 viajes, 16 días', () => {
    expect(resumenMes(AGOSTO, tarifas)).toEqual({ total: 482400, jornadas: 0, horas: 60, viajes: 27, diasTrabajados: 16 })
  })

  test('cuenta jornadas, y dos filas del mismo día son un solo día trabajado', () => {
    const dias = [
      { dia: 1, tipo: 'jornada', horas: 0, viajes: 0 },
      { dia: 1, tipo: 'horas', horas: 2, viajes: 1 },
      { dia: 2, tipo: 'horas', horas: 0, viajes: 0 },
    ]
    expect(resumenMes(dias, tarifas)).toEqual({ total: 25000 + 15000 + 1200, jornadas: 1, horas: 2, viajes: 1, diasTrabajados: 1 })
  })
})

test('numeroValido: acepta coma decimal y rechaza NaN, negativos y fuera de rango', () => {
  expect(numeroValido('2,5')).toBe(2.5)
  expect(numeroValido('7.5', { max: 24 })).toBe(7.5)
  expect(numeroValido('')).toBe(null)
  expect(numeroValido('abc')).toBe(null)
  expect(numeroValido('-1')).toBe(null)
  expect(numeroValido('25', { max: 24 })).toBe(null)
  expect(numeroValido('0', { min: 1, max: 31, entero: true })).toBe(null)
  expect(numeroValido('32', { min: 1, max: 31, entero: true })).toBe(null)
  expect(numeroValido('3.5', { entero: true })).toBe(null)
  expect(numeroValido(Infinity)).toBe(null)
})

test('claveValida y diasDelMes', () => {
  expect(claveValida('2026-09')).toBe(true)
  expect(claveValida('2026-13')).toBe(false)
  expect(claveValida('2026-9')).toBe(false)
  expect(diasDelMes('2026-09')).toBe(30)
  expect(diasDelMes('2028-02')).toBe(29)
  expect(diasDelMes('nada')).toBe(0)
})

test('ordenarDias: por día y, a igual día, el que se cargó primero', () => {
  const dias = [
    { id: 'c', dia: 5, created_at: '2026-09-02T00:00:00Z' },
    { id: 'a', dia: 2, created_at: '2026-09-03T00:00:00Z' },
    { id: 'b', dia: 5, created_at: '2026-09-01T00:00:00Z' },
  ]
  expect(ordenarDias(dias).map(d => d.id)).toEqual(['a', 'b', 'c'])
})

describe('nuevoDia', () => {
  test('sin días arranca el 1, por hora', () => {
    expect(nuevoDia([], '2026-09')).toEqual({ dia: 1, tipo: 'horas', horas: 0, viajes: 0 })
  })

  test('el día siguiente al último cargado, con su tipo', () => {
    const dias = [{ dia: 12, tipo: 'jornada' }, { dia: 3, tipo: 'horas' }]
    expect(nuevoDia(dias, '2026-09')).toEqual({ dia: 13, tipo: 'jornada', horas: 0, viajes: 0 })
  })

  test('no se pasa del último día del mes', () => {
    expect(nuevoDia([{ dia: 30, tipo: 'horas' }], '2026-09').dia).toBe(30)
  })
})

test('tarifasHeredadas: las del último mes anterior, o las de siempre', () => {
  const meses = [
    { clave: '2026-07', valor_hora: 7000, valor_viatico: 1000, valor_jornada: 24000 },
    { clave: '2026-08', valor_hora: 8000, valor_viatico: 1300, valor_jornada: 26000 },
    { clave: '2026-10', valor_hora: 9000, valor_viatico: 1400, valor_jornada: 27000 },
  ]
  expect(tarifasHeredadas(meses, '2026-09')).toEqual({ valor_hora: 8000, valor_viatico: 1300, valor_jornada: 26000 })
  expect(tarifasHeredadas(meses, '2026-01')).toEqual(TARIFAS_POR_DEFECTO)
})

describe('mesParaAbrir', () => {
  const cerrados = ['2026-03', '2026-08'].map(clave => ({ clave, cerrado: true }))

  test('todos cerrados: el siguiente al último', () => {
    expect(mesParaAbrir(cerrados, '2026-09')).toBe('2026-09')
  })

  test('el primero abierto después del último cerrado', () => {
    expect(mesParaAbrir([...cerrados, { clave: '2026-11', cerrado: false }, { clave: '2026-09', cerrado: false }])).toBe('2026-09')
  })

  test('un mes viejo reabierto para corregir no es el que se abre', () => {
    const meses = [{ clave: '2026-03', cerrado: false }, { clave: '2026-08', cerrado: true }]
    expect(mesParaAbrir(meses)).toBe('2026-09')
  })

  test('sin meses cerrados, el de hoy', () => {
    expect(mesParaAbrir([], '2026-09')).toBe('2026-09')
    expect(mesParaAbrir([{ clave: '2026-07', cerrado: false }, { clave: '2026-09', cerrado: false }], '2026-09')).toBe('2026-09')
  })
})

test('historialCerrados: del más nuevo al más viejo, con el acumulado', () => {
  const meses = [
    { id: 1, clave: '2026-07', cerrado: true, total_cerrado: 431250 },
    { id: 2, clave: '2026-08', cerrado: true, total_cerrado: 482400 },
    { id: 3, clave: '2026-09', cerrado: false, total_cerrado: null },
  ]
  expect(historialCerrados(meses)).toEqual({
    meses: [{ id: 2, clave: '2026-08', total: 482400 }, { id: 1, clave: '2026-07', total: 431250 }],
    acumulado: 913650,
  })
})

describe('totalDelMes', () => {
  test('cerrado: el total guardado', () => {
    expect(totalDelMes({ cerrado: true, total_cerrado: 142200, ...tarifas }, [])).toBe(142200)
  })

  test('abierto: la suma de los días', () => {
    expect(totalDelMes({ cerrado: false, total_cerrado: 1, ...tarifas }, AGOSTO)).toBe(482400)
  })

  test('reabierto sin días (cargado solo con el total): conserva el total', () => {
    expect(totalDelMes({ cerrado: false, total_cerrado: 142200, ...tarifas }, [])).toBe(142200)
    expect(totalDelMes({ cerrado: false, total_cerrado: null, ...tarifas }, [])).toBe(0)
  })
})

test('aCentavos', () => {
  expect(aCentavos(1234.5678)).toBe(1234.57)
  expect(aCentavos(NaN)).toBe(0)
})

test('tarifasHeredadas: sin meses anteriores usa las que se le pasen (una liquidación nueva, en cero)', () => {
  expect(tarifasHeredadas([], '2026-10', TARIFAS_EN_CERO)).toEqual({ valor_hora: 0, valor_viatico: 0, valor_jornada: 0 })
  expect(tarifasHeredadas([{ clave: '2026-09', valor_hora: 9000, valor_viatico: 0, valor_jornada: 0 }], '2026-10', TARIFAS_EN_CERO))
    .toEqual({ valor_hora: 9000, valor_viatico: 0, valor_jornada: 0 })
})

test('nombreValido: limpia espacios y rechaza vacío o demasiado largo', () => {
  expect(nombreValido('  Sueldo   de Renata ')).toBe('Sueldo de Renata')
  expect(nombreValido('   ')).toBeNull()
  expect(nombreValido(null)).toBeNull()
  expect(nombreValido('x'.repeat(60))).toHaveLength(60)
  expect(nombreValido('x'.repeat(61))).toBeNull()
})
