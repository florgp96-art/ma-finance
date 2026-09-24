// El cliente de Supabase se crea al importar el módulo y revienta sin las env vars
// (que viven en Vercel). Acá solo se prueban helpers puros, así que se mockea.
jest.mock('../lib/supabase', () => ({ supabase: {} }))

const { cicloAbiertoDe, repartirPagos, compararStatements, calcularStatementsPendientes, saleDeLaVistaAlCambiarDeCuenta, enTramoDelCiclo } = require('./AccountDetail')

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

describe('saleDeLaVistaAlCambiarDeCuenta — a qué lista deja de pertenecer un movimiento', () => {
  const cajaAhorro = { id: 'caja', tipo: 'debito' }
  const ingresos = { id: 'ingresos', tipo: 'ingreso' }

  test('mirando una cuenta, lo que se manda a otra ya no pertenece', () => {
    expect(saleDeLaVistaAlCambiarDeCuenta(cajaAhorro, 'usd')).toBe(true)
  })

  test('mirando "Ingresos", asignarle la cuenta donde entró la plata no lo saca', () => {
    // El caso que lo motivó: asignándole la cuenta a cada ingreso, el mes se iba
    // vaciando en pantalla hasta quedar casi en cero, y volvía entero al recargar.
    expect(saleDeLaVistaAlCambiarDeCuenta(ingresos, 'caja')).toBe(false)
  })

  test('mirando todas las cuentas no sale de ningún lado', () => {
    expect(saleDeLaVistaAlCambiarDeCuenta(null, 'caja')).toBe(false)
  })

  test('sin cambio de cuenta no se mueve nada', () => {
    expect(saleDeLaVistaAlCambiarDeCuenta(cajaAhorro, null)).toBe(false)
    expect(saleDeLaVistaAlCambiarDeCuenta(cajaAhorro, '')).toBe(false)
  })

  test('elegir de nuevo la misma cuenta tampoco lo saca', () => {
    expect(saleDeLaVistaAlCambiarDeCuenta(cajaAhorro, 'caja')).toBe(false)
  })
})

describe('enTramoDelCiclo — cada gasto cae en un solo tramo del ciclo', () => {
  // Una tarjeta partida en dos: el ciclo que el banco ya cerró el 15/09 (todavía sin
  // PDF) y el que sigue abierto. Hoy es 24/09.
  const CUENTA = 'visa'
  const HOY = '2026-09-24'
  const cerrado = { accountId: CUENTA, desde: '2026-08-15', hasta: '2026-09-15', hoy: HOY }
  const abierto = { accountId: CUENTA, desde: '2026-09-15', hasta: null, hoy: HOY }
  const gasto = (id, fecha, extra = {}) => ({ id, account_id: CUENTA, fecha, tipo: 'gasto', monto: 1000, ...extra })

  test('un gasto posterior al cierre es del tramo abierto y NO del cerrado', () => {
    // El bug: el tramo cerrado se llevaba TODO hasta hoy, así que este gasto se contaba
    // dos veces en "Gastos del mes por categoría" — una por tramo.
    const farmacity = gasto('farmacity', '2026-09-16')
    expect(enTramoDelCiclo(farmacity, cerrado)).toBe(false)
    expect(enTramoDelCiclo(farmacity, abierto)).toBe(true)
  })

  test('un gasto anterior al cierre es del tramo cerrado y NO del abierto', () => {
    const osde = gasto('osde', '2026-09-02')
    expect(enTramoDelCiclo(osde, cerrado)).toBe(true)
    expect(enTramoDelCiclo(osde, abierto)).toBe(false)
  })

  test('ningún gasto del ciclo cae en los dos tramos a la vez', () => {
    const gastos = ['2026-08-14', '2026-08-16', '2026-09-02', '2026-09-15', '2026-09-16', '2026-09-24']
      .map((f, i) => gasto(`g${i}`, f))
    gastos.forEach(g => {
      const veces = [cerrado, abierto].filter(tramo => enTramoDelCiclo(g, tramo)).length
      expect(veces).toBeLessThanOrEqual(1)
    })
  })

  test('lo del día del cierre anterior ya se facturó: no vuelve', () => {
    expect(enTramoDelCiclo(gasto('viejo', '2026-08-15'), cerrado)).toBe(false)
    expect(enTramoDelCiclo(gasto('viejo', '2026-08-14'), cerrado)).toBe(false)
  })

  test('el tramo abierto llega hasta hoy, no más allá', () => {
    expect(enTramoDelCiclo(gasto('hoy', HOY), abierto)).toBe(true)
    expect(enTramoDelCiclo(gasto('futuro', '2026-09-30'), abierto)).toBe(false)
  })

  test('pagos y reintegros no son gastos de ningún tramo', () => {
    expect(enTramoDelCiclo(gasto('pago', '2026-09-20', { tipo: 'neutro' }), abierto)).toBe(false)
    expect(enTramoDelCiclo(gasto('reintegro', '2026-09-20', { tipo: 'ingreso' }), abierto)).toBe(false)
  })

  test('los movimientos de otra tarjeta no entran', () => {
    expect(enTramoDelCiclo({ ...gasto('ajeno', '2026-09-20'), account_id: 'amex' }, abierto)).toBe(false)
  })

  test('lo que ya factura un resumen con tarjeta propia no se cuenta de nuevo', () => {
    const facturado = gasto('facturado', '2026-09-20', { statement_id: 'st-1' })
    const statementIdsFacturados = new Set(['st-1'])
    expect(enTramoDelCiclo(facturado, { ...abierto, statementIdsFacturados })).toBe(false)
    // Ligado a un resumen que ya no se muestra solo (saldado), se cuenta igual acá en
    // vez de desaparecer de la app.
    expect(enTramoDelCiclo(facturado, { ...abierto, statementIdsFacturados: new Set(['otro']) })).toBe(true)
  })

  test('una cuota se ubica por mes, no por día del cierre', () => {
    // La cuota de septiembre la factura el resumen de septiembre, cierre el 15 o el 28.
    const cuotaSept = gasto('cuota', '2026-09-28', { cuotas_total: 6, cuota_numero: 2 })
    expect(enTramoDelCiclo(cuotaSept, cerrado)).toBe(true)
    expect(enTramoDelCiclo(cuotaSept, abierto)).toBe(false)
  })

  test('sin tope no entra nada', () => {
    expect(enTramoDelCiclo(gasto('g', '2026-09-20'), { accountId: CUENTA, desde: '2026-09-15' })).toBe(false)
  })
})

describe('calcularStatementsPendientes — la deuda en dólares también se paga en pesos', () => {
  // El caso real: Mastercard Platinum, cierre 27-Ago, total $ 2.447.731,71 + U$S 103,65,
  // pagado todo junto con una transferencia en pesos. El banco pesifica los dólares al
  // vendedor del día (acá, $ 1.200).
  const cuenta = { id: 'mc', nombre: 'Mastercard Galicia', tipo: 'credito' }
  const resumen = {
    id: 'mc-ago', account_id: 'mc', periodo: 'Agosto 2026',
    fecha_hasta: '2026-08-27', fecha_vencimiento: '2026-09-04',
    total_resumen: 2447731.71, total_dolares: 103.65,
  }
  const DOLARES_EN_PESOS = 103.65 * 1200
  const pagoEnPesos = (monto, fecha = '2026-09-03') => ({
    id: `pago-${monto}`, account_id: 'mc', fecha, tipo: 'neutro', moneda: 'ARS', monto,
  })
  const correr = (transactions, tipoCambio = 1200) =>
    calcularStatementsPendientes({ accounts: [cuenta], statements: [resumen], transactions, tipoCambio })

  test('pagado entero en pesos, el resumen deja de figurar como pendiente', () => {
    const { statementsRealesConUsd, estadosStatement } = correr([pagoEnPesos(2447731.71 + DOLARES_EN_PESOS)])
    expect(statementsRealesConUsd).toEqual([])
    expect(estadosStatement.get('mc-ago')).toMatchObject({ pendienteArs: 0, pendienteUsd: 0 })
  })

  test('los pesos que pagaron los dólares no bajan además como sobrepago al ciclo siguiente', () => {
    const { estadosStatement } = correr([pagoEnPesos(2447731.71 + DOLARES_EN_PESOS)])
    expect(estadosStatement.get('mc-ago').excedenteArs).toBeCloseTo(0, 2)
  })

  test('el TC del banco no es el de la app: igual se da por pagada', () => {
    // La app puede tener cargado otro dólar (ej. $ 1.500) que el que usó el banco.
    const { estadosStatement } = correr([pagoEnPesos(2447731.71 + DOLARES_EN_PESOS)], 1500)
    expect(estadosStatement.get('mc-ago').pendienteUsd).toBe(0)
  })

  test('un sobrepago chico no borra la deuda en dólares', () => {
    const { estadosStatement } = correr([pagoEnPesos(2447731.71 + 10000)])
    expect(estadosStatement.get('mc-ago').pendienteUsd).toBeCloseTo(103.65, 2)
    expect(estadosStatement.get('mc-ago').excedenteArs).toBeCloseTo(10000, 2)
  })

  test('pagada solo la parte en pesos, los dólares siguen debiéndose', () => {
    const { estadosStatement } = correr([pagoEnPesos(2447731.71)])
    expect(estadosStatement.get('mc-ago').pendienteUsd).toBeCloseTo(103.65, 2)
  })

  test('sin TC cargado no se inventa ninguna conversión', () => {
    const { estadosStatement } = calcularStatementsPendientes({
      accounts: [cuenta], statements: [resumen],
      transactions: [pagoEnPesos(2447731.71 + DOLARES_EN_PESOS)],
    })
    expect(estadosStatement.get('mc-ago').pendienteUsd).toBeCloseTo(103.65, 2)
  })

  test('un pago en dólares sigue cancelando los dólares, como siempre', () => {
    const pagoUsd = { id: 'pago-usd', account_id: 'mc', fecha: '2026-09-03', tipo: 'neutro', moneda: 'USD', monto: 103.65 }
    const { estadosStatement } = correr([pagoEnPesos(2447731.71), pagoUsd])
    expect(estadosStatement.get('mc-ago')).toMatchObject({ pendienteArs: 0, pendienteUsd: 0 })
  })

  test('un pago anterior al cierre ya venía descontado: no cancela nada de nuevo', () => {
    const { estadosStatement } = correr([pagoEnPesos(2447731.71 + DOLARES_EN_PESOS, '2026-08-20')])
    expect(estadosStatement.get('mc-ago').pendienteArs).toBeCloseTo(2447731.71, 2)
    expect(estadosStatement.get('mc-ago').pendienteUsd).toBeCloseTo(103.65, 2)
  })
})
