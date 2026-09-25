// REPARTO ENTRE SOCIOS: todo en una bolsa, en partes iguales.
//
// Para una cuenta que es de varios socios (una agencia de tres, por ejemplo): se
// suma todo lo que entró en el mes, se resta lo que se gastó, y a cada socio le
// toca la misma parte. Después se mira cuánto tiene cada uno de verdad —lo que
// cobró en sus cuentas, menos lo que pagó de su bolsillo, más o menos lo que ya
// se pasaron entre ellos— y la diferencia con su parte es lo que da o recibe.
//
// De quién es cada cuenta lo dice su nombre: "Dol Efectivo" es de Dol. Así no
// hay nada que configurar al crear una cuenta, alcanza con nombrarla.
//
// La configuración vive en la preferencia `reparto_socios` de la cuenta (ver
// persistPref en Dashboard). Que exista es lo que hace aparecer la calculadora:
// solo la ven las cuentas que la tienen.

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
const MONTO_MAXIMO = 1e12

// La preferencia se lee de la base: puede venir incompleta o rota. null si no
// alcanza para repartir (hacen falta al menos dos socios).
export const normalizarConfigReparto = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const socios = [...new Set((Array.isArray(raw.socios) ? raw.socios : [])
    .map(s => String(s || '').trim()).filter(Boolean))]
  if (socios.length < 2) return null
  const meses = raw.meses && typeof raw.meses === 'object' && !Array.isArray(raw.meses) ? raw.meses : {}
  const cuotas = Array.isArray(raw.cuotas) ? raw.cuotas.filter(c => c && typeof c === 'object') : []
  const trabajos = Array.isArray(raw.trabajos) ? raw.trabajos.filter(t => t && typeof t === 'object') : []
  return { socios, meses, cuotas, trabajos }
}

export const socioDeLaCuenta = (cuenta, socios) => {
  const nombre = normalizar(cuenta?.nombre)
  if (!nombre) return null
  return (socios || []).find(s => {
    const socio = normalizar(s)
    return socio && (nombre === socio || nombre.startsWith(`${socio} `))
  }) || null
}

// 'YYYY-MM' → desde el 1 de ese mes (inclusive) hasta el 1 del siguiente
// (exclusive). null si el mes no es válido.
export const rangoDelMes = (mes) => {
  const m = /^(\d{4})-(\d{2})$/.exec(mes || '')
  if (!m) return null
  const anio = Number(m[1])
  const nro = Number(m[2])
  if (nro < 1 || nro > 12) return null
  const siguiente = nro === 12 ? `${anio + 1}-01` : `${anio}-${String(nro + 1).padStart(2, '0')}`
  return { desde: `${mes}-01`, hasta: `${siguiente}-01` }
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// 'YYYY-MM' corrido `delta` meses. Se arma a mano en vez de con <input
// type="month">: en el iPhone ese selector sale en el idioma del teléfono
// ("September 2026") y es más ancho que su lugar en el celular.
export const moverMes = (mes, delta) => {
  const [anio, nro] = String(mes).split('-').map(Number)
  const total = anio * 12 + (nro - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

export const nombreDelMes = (mes) => {
  const [anio, nro] = String(mes).split('-').map(Number)
  return MESES[nro - 1] ? `${MESES[nro - 1]} ${anio}` : mes
}

export const montoValido = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n < MONTO_MAXIMO ? n : null
}

const mesesEntre = (desde, hasta) => {
  const [a1, m1] = String(desde).split('-').map(Number)
  const [a2, m2] = String(hasta).split('-').map(Number)
  return (a2 * 12 + m2) - (a1 * 12 + m1)
}

// GASTOS QUE SE DEVUELVEN EN CUOTAS.
//
// Un gasto grande que pagó un socio solo (CapCut anual: Valen puso 300 €) no
// entra entero en el mes en que se pagó: ese mes pagarían todos de golpe algo
// que sirve para el año entero. A cada socio le toca su parte del gasto (monto
// entre socios); la del que pagó ya está puesta, y los demás le devuelven la
// suya de a `porMes` por mes —entre todos ellos— hasta completarla. Con CapCut:
// 100 € cada uno, Flor y Dol le devuelven 12,50 € por mes cada uno, 8 meses.
//
// Devuelve las cuotas que caen en `mes`, una por socio que devuelve.
export const cuotasDelMes = ({ cuotas, socios, mes }) => {
  const n = (socios || []).length
  const res = []
  for (const c of cuotas || []) {
    const monto = montoValido(c?.monto)
    const porMes = montoValido(c?.porMes)
    if (!monto || !porMes || n < 2 || !socios.includes(c.pagoDe) || !rangoDelMes(c.desde) || !rangoDelMes(mes)) continue
    const numero = mesesEntre(c.desde, mes)
    if (numero < 0) continue
    const parte = monto / n
    const porSocio = porMes / (n - 1)
    const total = Math.ceil(parte / porSocio - 1e-9)
    const esteMes = Math.min(porSocio, parte - Math.min(parte, numero * porSocio))
    if (esteMes < 0.005) continue
    for (const s of socios) {
      if (s === c.pagoDe) continue
      res.push({
        concepto: c.concepto || 'Gasto', de: s, a: c.pagoDe, moneda: c.moneda || 'ARS',
        monto: Math.round(esteMes * 100) / 100, numero: numero + 1, total,
      })
    }
  }
  return res
}

// TRABAJOS POR FUERA: un movimiento que no se reparte en partes iguales. El que
// hizo el trabajo se queda con más (ej. 50 %) y el resto se divide entre los
// demás; vale para el ingreso y para los gastos de ese trabajo. La plata la
// sigue teniendo quien la cobró o la pagó: lo que cambia es a quién le toca.
//
// porcentajes: { socio: número }. No hace falta que sumen 100 (se normalizan);
// null si no hay nada que repartir.
export const fraccionesDeReparto = (porcentajes, socios) => {
  if (!porcentajes || typeof porcentajes !== 'object') return null
  const pares = (socios || []).map(s => [s, Number(porcentajes[s]) || 0]).filter(([, p]) => p > 0)
  const total = pares.reduce((suma, [, p]) => suma + p, 0)
  if (!(total > 0)) return null
  return Object.fromEntries(pares.map(([s, p]) => [s, p / total]))
}

// El que hizo el trabajo se queda con `propio` % y el resto va parejo a los demás.
export const porcentajesTrabajo = (socio, socios, propio = 50) => {
  const otros = (socios || []).filter(s => s !== socio)
  const p = Math.min(100, Math.max(0, Number(propio) || 0))
  return Object.fromEntries((socios || []).map(s => [s, s === socio ? p : (otros.length ? (100 - p) / otros.length : 0)]))
}

// Quién le da cuánto a quién para que todos queden con su parte. El que más
// tiene de más le paga primero al que más le falta: en el caso común (uno tiene
// la plata, los demás pusieron de su bolsillo) salen las menos transferencias.
const saldarDiferencias = (porSocio) => {
  const dan = porSocio.filter(s => s.diferencia >= 1)
    .map(s => ({ socio: s.socio, resto: s.diferencia })).sort((a, b) => b.resto - a.resto)
  const reciben = porSocio.filter(s => s.diferencia <= -1)
    .map(s => ({ socio: s.socio, resto: -s.diferencia })).sort((a, b) => b.resto - a.resto)
  const pagos = []
  let i = 0
  let j = 0
  while (i < dan.length && j < reciben.length) {
    const monto = Math.min(dan[i].resto, reciben[j].resto)
    if (Math.round(monto) >= 1) pagos.push({ de: dan[i].socio, a: reciben[j].socio, monto: Math.round(monto) })
    dan[i].resto -= monto
    reciben[j].resto -= monto
    if (dan[i].resto < 1) i++
    if (reciben[j].resto < 1) j++
  }
  return pagos
}

// movimientos: los del mes (solo cuentan ingresos y gastos; un neutro no es
// plata ganada ni gastada). cotizaciones: pesos por unidad, ej. { USD: 1560 }.
// transferencias: lo que los socios ya se pasaron entre ellos ese mes.
// cuotas + mes: los gastos que se devuelven en cuotas (ver cuotasDelMes). El
// movimiento original no entra en su mes; entra la cuota que toca en `mes`.
// trabajos: los movimientos que se reparten con sus propios porcentajes (ver
// fraccionesDeReparto); no entran en la parte común.
export const calcularReparto = ({ socios, cuentas, movimientos, cotizaciones, transferencias, cuotas, mes, trabajos }) => {
  const lista = [...new Set((socios || []).map(s => String(s || '').trim()).filter(Boolean))]
  const cuentaPorId = new Map((cuentas || []).map(c => [c.id, c]))
  const base = Object.fromEntries(lista.map(s => [s, { socio: s, cobro: 0, pago: 0, transferencias: 0, cuotas: 0, trabajos: 0 }]))
  const fraccionesPorId = new Map((trabajos || [])
    .map(tb => [tb?.movimientoId, fraccionesDeReparto(tb?.porcentajes, lista)])
    .filter(([id, fracciones]) => id && fracciones))
  let ingresosComunes = 0
  let gastosComunes = 0
  const sinSocio = new Set()
  const sinCotizacion = new Set()
  const enCuotas = new Set((cuotas || []).map(c => c?.movimientoId).filter(Boolean))
  const aPesos = (monto, moneda = 'ARS') => {
    const factor = moneda === 'ARS' ? 1 : montoValido(cotizaciones?.[moneda])
    if (!factor) { sinCotizacion.add(moneda); return null }
    return Math.abs(Number(monto) || 0) * factor
  }

  for (const t of movimientos || []) {
    if (t.tipo !== 'ingreso' && t.tipo !== 'gasto') continue
    if (enCuotas.has(t.id)) continue
    const pesos = aPesos(t.monto, t.moneda || 'ARS')
    if (pesos === null) continue
    const cuenta = cuentaPorId.get(t.account_id)
    const socio = socioDeLaCuenta(cuenta, lista)
    if (!socio) { sinSocio.add(cuenta?.nombre || 'Cuenta borrada'); continue }
    if (t.tipo === 'ingreso') base[socio].cobro += pesos
    else base[socio].pago += pesos
    const fracciones = fraccionesPorId.get(t.id)
    if (fracciones) {
      const signo = t.tipo === 'ingreso' ? 1 : -1
      for (const [s, f] of Object.entries(fracciones)) base[s].trabajos += signo * pesos * f
    } else if (t.tipo === 'ingreso') ingresosComunes += pesos
    else gastosComunes += pesos
  }

  for (const tr of transferencias || []) {
    const monto = montoValido(tr?.monto)
    if (!monto || !base[tr.de] || !base[tr.a] || tr.de === tr.a) continue
    base[tr.de].transferencias -= monto
    base[tr.a].transferencias += monto
  }

  const cuotasMes = cuotasDelMes({ cuotas, socios: lista, mes })
    .map(c => ({ ...c, pesos: aPesos(c.monto, c.moneda) }))
    .filter(c => c.pesos !== null)
  for (const c of cuotasMes) {
    base[c.de].cuotas -= c.pesos
    base[c.a].cuotas += c.pesos
  }

  const filas = Object.values(base)
  const ingresos = filas.reduce((s, f) => s + f.cobro, 0)
  const gastos = filas.reduce((s, f) => s + f.pago, 0)
  const neto = ingresos - gastos
  const netoTrabajos = neto - (ingresosComunes - gastosComunes)
  // La parte común es la misma para todos; los trabajos por fuera se reparten aparte.
  const parte = lista.length ? (ingresosComunes - gastosComunes) / lista.length : 0
  // Lo que le toca a cada uno: la parte común, más o menos las cuotas del mes (el
  // que devuelve termina con menos, el que adelantó el gasto con más), más su
  // porción de los trabajos por fuera.
  const porSocio = filas.map(f => {
    const tiene = f.cobro - f.pago + f.transferencias
    const leToca = parte + f.cuotas + f.trabajos
    return { ...f, tiene, leToca, diferencia: tiene - leToca }
  })

  return {
    ingresos,
    gastos,
    neto,
    netoTrabajos,
    parte,
    porSocio,
    pagos: saldarDiferencias(porSocio),
    cuotas: cuotasMes,
    sinSocio: [...sinSocio],
    sinCotizacion: [...sinCotizacion],
  }
}

// La cotización con la que cierra un mes: la del primer pago registrado, que la
// lleva guardada adentro (si se borra ese pago, se borra con él). null si no hay.
export const cotizacionFijaDelMes = (delMes) =>
  (Array.isArray(delMes?.transferencias) ? delMes.transferencias : [])
    .map(t => t?.cotizacion).find(c => c && typeof c === 'object' && c.fecha) || null

// El reparto de un mes armado desde la configuración. Lo usan la calculadora y
// la tarjeta "Socios" del resumen, así las dos dan siempre lo mismo.
// cotizacionesVivas: las del día (promedio entre compra y venta del blue y del
// euro), para los meses que todavía no tienen una fija. Las claves viejas del
// mes (`usd`/`eur` escritas a mano, `cotizacionFija` aparte) no se usan.
export const repartoDelMes = ({ config, mes, movimientos, cuentas, cotizacionesVivas }) => {
  const delMes = config?.meses?.[mes] || {}
  const transferencias = Array.isArray(delMes.transferencias) ? delMes.transferencias : []
  const fija = cotizacionFijaDelMes(delMes)
  const cotizaciones = {
    USD: montoValido(fija?.usd) || montoValido(cotizacionesVivas?.USD),
    EUR: montoValido(fija?.eur) || montoValido(cotizacionesVivas?.EUR),
  }
  const cuotas = Array.isArray(config?.cuotas) ? config.cuotas : []
  const trabajos = Array.isArray(config?.trabajos) ? config.trabajos : []
  return {
    ...calcularReparto({ socios: config?.socios, cuentas, movimientos, cotizaciones, transferencias, cuotas, mes, trabajos }),
    fija,
    cotizaciones,
    transferencias,
  }
}

// Varios meses juntos (el período elegido en el resumen): cada mes con su
// cotización, sus pagos y sus cuotas, y después se suma lo de cada socio.
export const repartoDelPeriodo = ({ config, meses, movimientos, cuentas, cotizacionesVivas }) => {
  const socios = config?.socios || []
  const porSocio = new Map(socios.map(s => [s, { socio: s, tiene: 0, leToca: 0, trabajos: 0, diferencia: 0 }]))
  let parte = 0
  let netoTrabajos = 0
  for (const mes of meses || []) {
    const delMes = (movimientos || []).filter(t => String(t.fecha || '').startsWith(mes))
    const r = repartoDelMes({ config, mes, movimientos: delMes, cuentas, cotizacionesVivas })
    parte += r.parte
    netoTrabajos += r.netoTrabajos
    for (const s of r.porSocio) {
      const acumulado = porSocio.get(s.socio)
      acumulado.tiene += s.tiene
      acumulado.leToca += s.leToca
      acumulado.trabajos += s.trabajos
      acumulado.diferencia += s.diferencia
    }
  }
  return { parte, netoTrabajos, porSocio: [...porSocio.values()] }
}
