const { buscarMismoCiclo, periodoSinRepetir, correrPeriodo, diasEntre, mesesDeCuotas } = require('./cicloResumen')

const resumen = (id, periodo, cierre) => ({ id, periodo, cierre })

// El caso real: Mastercard Galicia cerró el 27/08, el 01/10 y el 29/10. Los dos
// últimos salen "Octubre 2026" por el mes de cierre, y al subir el del 29/10 la app
// ofrecía reemplazar el del 01/10 —un resumen distinto— o no cargarlo.
const agosto = resumen('ago', 'Agosto 2026', '2026-08-27')
const cierra1Oct = resumen('oct1', 'Octubre 2026', '2026-10-01')

describe('buscarMismoCiclo', () => {
  test('dos resúmenes del mismo mes con cierres a 4 semanas no son el mismo', () => {
    const nuevo = { periodo: 'Octubre 2026', cierre: '2026-10-29' }
    expect(buscarMismoCiclo(nuevo, [agosto, cierra1Oct])).toBeNull()
  })

  test('el mismo resumen subido otra vez se reconoce por el cierre', () => {
    const nuevo = { periodo: 'Octubre 2026', cierre: '2026-10-01' }
    expect(buscarMismoCiclo(nuevo, [agosto, cierra1Oct])).toBe(cierra1Oct)
  })

  // Sin fecha de cierre en el PDF se estima desde el vencimiento, y puede correrse
  // unos días: sigue siendo el mismo ciclo aunque la IA lo haya nombrado distinto.
  test('tolera un cierre leído con unos días de diferencia, aunque cambie el nombre', () => {
    const nuevo = { periodo: 'Septiembre 2026', cierre: '2026-09-26' }
    expect(buscarMismoCiclo(nuevo, [agosto, cierra1Oct])).toBe(cierra1Oct)
  })

  test('con dos candidatos cerca, elige el de cierre más próximo', () => {
    const a = resumen('a', 'Octubre 2026', '2026-10-01')
    const b = resumen('b', 'Octubre 2026', '2026-10-12')
    expect(buscarMismoCiclo({ periodo: 'Octubre 2026', cierre: '2026-10-10' }, [a, b])).toBe(b)
  })

  test('sin fecha de cierre en el nuevo, compara por nombre de mes', () => {
    expect(buscarMismoCiclo({ periodo: 'Octubre 2026', cierre: null }, [agosto, cierra1Oct])).toBe(cierra1Oct)
  })

  test('un resumen viejo sin fechas se compara por nombre de mes', () => {
    const sinFechas = resumen('jun', 'Junio 2026', null)
    expect(buscarMismoCiclo({ periodo: 'Junio 2026', cierre: '2026-06-18' }, [sinFechas])).toBe(sinFechas)
  })

  test('primer resumen de la cuenta: no hay nada con qué chocar', () => {
    expect(buscarMismoCiclo({ periodo: 'Octubre 2026', cierre: '2026-10-29' }, [])).toBeNull()
    expect(buscarMismoCiclo({ periodo: 'Octubre 2026', cierre: '2026-10-29' }, null)).toBeNull()
  })
})

describe('periodoSinRepetir', () => {
  test('el del 01/10 pasa a septiembre y el del 29/10 queda como octubre', () => {
    const r = periodoSinRepetir({ periodo: 'Octubre 2026', cierre: '2026-10-29' }, [agosto, cierra1Oct])
    expect(r).toEqual({ periodo: 'Octubre 2026', renombrar: { id: 'oct1', periodo: 'Septiembre 2026' } })
  })

  // Al revés: el del 29/10 ya está y se sube el del 01/10 (por ejemplo, para
  // recuperarlo después de haberlo reemplazado por error).
  test('si el que se sube es el de cierre más temprano, el nuevo va al mes anterior', () => {
    const cierra29Oct = resumen('oct29', 'Octubre 2026', '2026-10-29')
    const r = periodoSinRepetir({ periodo: 'Octubre 2026', cierre: '2026-10-01' }, [agosto, cierra29Oct])
    expect(r).toEqual({ periodo: 'Septiembre 2026', renombrar: null })
  })

  test('si el mes anterior está ocupado, el más tardío pasa al siguiente', () => {
    const septiembre = resumen('sep', 'Septiembre 2026', '2026-09-03')
    const r = periodoSinRepetir({ periodo: 'Octubre 2026', cierre: '2026-10-29' }, [septiembre, cierra1Oct])
    expect(r).toEqual({ periodo: 'Noviembre 2026', renombrar: null })
  })

  test('con los dos meses vecinos ocupados, no inventa: deja el nombre', () => {
    const septiembre = resumen('sep', 'Septiembre 2026', '2026-09-03')
    const noviembre = resumen('nov', 'Noviembre 2026', '2026-11-26')
    const r = periodoSinRepetir({ periodo: 'Octubre 2026', cierre: '2026-10-29' }, [septiembre, cierra1Oct, noviembre])
    expect(r).toEqual({ periodo: 'Octubre 2026', renombrar: null })
  })

  test('sin choque de nombre, no cambia nada', () => {
    const r = periodoSinRepetir({ periodo: 'Noviembre 2026', cierre: '2026-11-26' }, [agosto, cierra1Oct])
    expect(r).toEqual({ periodo: 'Noviembre 2026', renombrar: null })
  })

  test('sin fechas para ordenarlos, no cambia nada', () => {
    const r = periodoSinRepetir({ periodo: 'Octubre 2026', cierre: null }, [cierra1Oct])
    expect(r).toEqual({ periodo: 'Octubre 2026', renombrar: null })
  })

  test('cruza el cambio de año', () => {
    const cierra2Ene = resumen('ene', 'Enero 2027', '2027-01-02')
    const r = periodoSinRepetir({ periodo: 'Enero 2027', cierre: '2027-01-29' }, [cierra2Ene])
    expect(r).toEqual({ periodo: 'Enero 2027', renombrar: { id: 'ene', periodo: 'Diciembre 2026' } })
  })
})

describe('correrPeriodo / diasEntre', () => {
  test('corre meses y años', () => {
    expect(correrPeriodo('Octubre 2026', -1)).toBe('Septiembre 2026')
    expect(correrPeriodo('Diciembre 2026', 1)).toBe('Enero 2027')
    expect(correrPeriodo('enero 2027', -1)).toBe('Diciembre 2026')
    expect(correrPeriodo('2026-10', 1)).toBeNull()
  })

  test('cuenta días sin depender de la zona horaria', () => {
    expect(diasEntre('2026-10-01', '2026-10-29')).toBe(28)
    expect(diasEntre('2026-10-29', '2026-10-01')).toBe(28)
    expect(diasEntre('2026-03-28', '2026-03-30')).toBe(2)
  })
})

describe('mesesDeCuotas', () => {
  test('cada resumen factura las cuotas del mes en que cierra', () => {
    expect(mesesDeCuotas(['2026-07-30', '2026-08-27', '2026-09-24'])).toEqual(['2026-07', '2026-08', '2026-09'])
  })

  // El caso real de la Mastercard: 27/08, 01/10 y 29/10. Las cuotas de septiembre son
  // del resumen que cerró el 01/10, y las de octubre del que cerró el 29/10.
  test('con dos cierres en el mismo mes, el primero se queda con el mes anterior', () => {
    expect(mesesDeCuotas(['2026-08-27', '2026-10-01', '2026-10-29'])).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  test('el último resumen conserva siempre su mes', () => {
    const meses = mesesDeCuotas(['2026-10-01', '2026-10-29'])
    expect(meses[meses.length - 1]).toBe('2026-10')
  })

  test('cruza el cambio de año', () => {
    expect(mesesDeCuotas(['2027-01-02', '2027-01-29'])).toEqual(['2026-12', '2027-01'])
  })

  test('sin cierres, nada', () => {
    expect(mesesDeCuotas([])).toEqual([])
    expect(mesesDeCuotas(null)).toEqual([])
  })
})
