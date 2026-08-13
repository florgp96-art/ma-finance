// El cliente de Supabase se crea al importar el módulo y revienta sin las env vars
// (que viven en Vercel). Acá solo se prueban helpers puros, así que se mockea.
jest.mock('../lib/supabase', () => ({ supabase: {} }))

const { cicloAbiertoDe, repartirPagos, compararStatements, calcularStatementsPendientes } = require('./AccountDetail')

describe('repartirPagos — un pago llega hasta cubrir el total, y sigue de largo', () => {
  test('el pago que sobra de un resumen paga el ciclo que sigue', () => {
    // Caso real: $ 1.500.000 pagados de más sobre el resumen de julio no son sobrepago,
    // están pagando el ciclo que cerró el 30 de julio.
    expect(repartirPagos(1500000, [900000])).toEqual({ aplicados: [900000], restante: 600000 })
  })

  test('cada tramo se queda solo con lo que necesita, en orden', () => {
    expect(repartirPagos(1500000, [900000, 2000000])).toEqual({
      aplicados: [900000, 600000], restante: 0,
    })
  })

  test('si no alcanza, el primero se lleva todo y el resto queda impago', () => {
    expect(repartirPagos(500000, [900000, 2000000])).toEqual({
      aplicados: [500000, 0], restante: 0,
    })
  })

  test('lo que sobra después de cubrir todo sí es plata a favor', () => {
    expect(repartirPagos(1500000, [100000, 200000])).toEqual({
      aplicados: [100000, 200000], restante: 1200000,
    })
  })

  test('sin pagos no se aplica nada y nada queda a favor', () => {
    expect(repartirPagos(0, [900000])).toEqual({ aplicados: [0], restante: 0 })
    expect(repartirPagos(null, [900000])).toEqual({ aplicados: [0], restante: 0 })
  })

  test('un total negativo no devuelve plata al pozo', () => {
    // Un saldo a favor que informó el banco viene como total negativo: no puede
    // aumentar lo disponible para pagar el ciclo siguiente.
    expect(repartirPagos(1000, [-500, 800])).toEqual({ aplicados: [0, 800], restante: 200 })
  })
})

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

describe('compararStatements — cuál es "el último resumen" de una tarjeta', () => {
  const stmt = (id, extra) => ({ id, fecha_vencimiento: '2026-08-22', fecha_hasta: '2026-08-15', ...extra })

  test('manda la fecha de cierre', () => {
    const julio = stmt('a', { fecha_hasta: '2026-07-15', fecha_vencimiento: '2026-07-22' })
    const agosto = stmt('b')
    expect([agosto, julio].sort(compararStatements).map(s => s.id)).toEqual(['a', 'b'])
  })

  test('empatados en el cierre, el último es el que tiene saldo', () => {
    // Caso real: dos resúmenes cargados para el mismo cierre de Visa Galicia, uno con
    // $ 917.929 y otro vacío. Ordenando solo por cierre, cuál ganaba dependía del orden
    // en que Postgres devolviera las filas: la tarjeta mostraba $ 917.929 al abrirla y
    // $ 0 en el dashboard, en el mismo momento.
    const vacio = stmt('z-vacio', { total_resumen: 0, total_dolares: 0 })
    const conSaldo = stmt('a-con-saldo', { total_resumen: 917929, total_dolares: null })
    expect([vacio, conSaldo].sort(compararStatements).map(s => s.id)).toEqual(['z-vacio', 'a-con-saldo'])
    expect([conSaldo, vacio].sort(compararStatements).map(s => s.id)).toEqual(['z-vacio', 'a-con-saldo'])
  })

  test('empatados también en el saldo, decide el id — nunca el azar', () => {
    const uno = stmt('aaa', { total_resumen: 1000 })
    const otro = stmt('bbb', { total_resumen: 1000 })
    expect([otro, uno].sort(compararStatements).map(s => s.id)).toEqual(['aaa', 'bbb'])
    expect([uno, otro].sort(compararStatements).map(s => s.id)).toEqual(['aaa', 'bbb'])
  })
})

describe('calcularStatementsPendientes — un resumen repetido no puede tapar la deuda', () => {
  const cuenta = { id: 'visa', nombre: 'Visa Galicia', tipo: 'credito' }
  const vacio = { id: 'z-vacio', account_id: 'visa', periodo: 'Agosto 2026', fecha_hasta: '2026-08-15', fecha_vencimiento: '2026-08-22', total_resumen: 0, total_dolares: 128.02 }
  const conSaldo = { id: 'a-con-saldo', account_id: 'visa', periodo: 'Agosto 2026', fecha_hasta: '2026-08-15', fecha_vencimiento: '2026-08-22', total_resumen: 917929, total_dolares: 138.20 }

  test('el resultado no depende del orden en que llegaron las filas', () => {
    const enUnOrden = calcularStatementsPendientes({ accounts: [cuenta], statements: [vacio, conSaldo], transactions: [] })
    const enElOtro = calcularStatementsPendientes({ accounts: [cuenta], statements: [conSaldo, vacio], transactions: [] })
    expect(enUnOrden.statementsRealesConUsd.map(s => s.id)).toEqual(['a-con-saldo'])
    expect(enElOtro.statementsRealesConUsd.map(s => s.id)).toEqual(['a-con-saldo'])
    expect(enUnOrden.statementsRealesConUsd[0].total_resumen).toBe(917929)
  })

  test('avisa que ese ciclo tiene más de un resumen cargado', () => {
    const { cuentasConResumenRepetido } = calcularStatementsPendientes({ accounts: [cuenta], statements: [vacio, conSaldo], transactions: [] })
    expect(cuentasConResumenRepetido).toHaveLength(1)
    expect(cuentasConResumenRepetido[0]).toMatchObject({ account_id: 'visa', nombre: 'Visa Galicia', cierre: '2026-08-15', cantidad: 2 })
  })

  test('lo que se ofrece borrar es siempre el ignorado, nunca el que se está usando', () => {
    const [repetido] = calcularStatementsPendientes({ accounts: [cuenta], statements: [vacio, conSaldo], transactions: [] }).cuentasConResumenRepetido
    expect(repetido.enUso.id).toBe('a-con-saldo')
    expect(repetido.ignorados.map(s => s.id)).toEqual(['z-vacio'])
  })

  test('sin repetidos no avisa nada', () => {
    const { cuentasConResumenRepetido } = calcularStatementsPendientes({ accounts: [cuenta], statements: [conSaldo], transactions: [] })
    expect(cuentasConResumenRepetido).toEqual([])
  })
})
