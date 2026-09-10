// SALDO DE UNA CUENTA (caja de ahorro, caja de ahorro en dólares, efectivo).
//
// La app no puede saber cuánta plata hay en una cuenta: solo ve los movimientos
// que se le cargaron, y siempre falta algo (un gasto en efectivo que nadie
// anota, un mes que todavía no se importó). Por eso el saldo no se deduce, se
// ANCLA: el usuario dice "el 10/09 tenía $X" y a partir de ahí la app suma y
// resta lo que pasó después. El ancla es el único dato duro; todo lo demás es
// derivado.
//
// De ahí salen las dos reglas que ordenan este archivo:
//
//   1. Sin ancla no hay saldo. Nunca se muestra un número inventado desde cero.
//   2. El saldo se CALCULA siempre (ancla + movimientos posteriores), nunca se
//      guarda un acumulado que se va incrementando. Un contador que se actualiza
//      solo se desincroniza en silencio y no hay forma de saber cuándo empezó.
//
// El ancla es además el único control de calidad de los datos: al cargar una
// nueva, la diferencia contra lo que la app venía calculando es exactamente lo
// que falta o está cargado de más. Ver desvioDeAncla.

const norm = (f) => (f || '').trim().slice(0, 10)
const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100

// Plata que ENTRA aunque el movimiento sea "neutro". El modelo guarda el monto
// siempre positivo y el tipo no distingue dirección, así que para los neutros hay
// que deducirla del texto: un rescate de fondo o la acreditación de un plazo fijo
// vencido son neutros (no son ingresos reales, es plata propia que vuelve) pero
// entran a la cuenta, no salen. Si acá se le erra, el desvío de la próxima ancla
// lo deja a la vista — que es justamente para lo que sirve.
const NEUTRO_QUE_ENTRA = /\brescate\b|\bacreditaci|\bdep[oó]sito\b/i

// ¿Este movimiento suma o resta del saldo de una cuenta que no es tarjeta?
//   ingreso → entra    gasto → sale
//   neutro  → sale por defecto (pago de tarjeta, transferencia a otra cuenta
//             propia, plazo fijo, suscripción a un fondo), salvo que el texto
//             diga que es plata que vuelve.
export const signoEnSaldo = (t) => {
  if (!t) return 0
  if (t.tipo === 'ingreso') return 1
  if (t.tipo === 'neutro') {
    const texto = `${t.nombre || ''} ${t.detalle || ''}`
    return NEUTRO_QUE_ENTRA.test(texto) ? 1 : -1
  }
  return -1
}

// ¿Este movimiento afecta el saldo de esta cuenta?
//
// Alcanza con account_id, para gastos, ingresos y neutros por igual: todo
// movimiento vive en la cuenta donde pasó. La cuenta "Ingresos" no es una cuenta
// donde vivan los ingresos, es una VISTA que los junta todos sin importar en qué
// cuenta están (ver esCuentaIngresos en AccountDetail) — así que no hace falta
// ningún dato extra que diga "en realidad entró acá".
//
// La excepción es el pago de tarjeta, que sí toca dos cuentas: eso se resuelve en
// pagosDeTarjetaDesde, más abajo.
export const enLaCuenta = (t, accountId) => Boolean(t && accountId && t.account_id === accountId)

// El ancla vigente: la más reciente que no sea posterior a `hasta`. Las anclas son
// append-only (cada vez que el usuario chequea su cuenta queda una fila nueva), así
// que puede haber varias por cuenta y moneda.
export const ultimaAncla = (anclas, accountId, moneda = 'ARS', hasta = null) => {
  const tope = norm(hasta)
  const candidatas = (anclas || [])
    .filter(a => a.account_id === accountId && (a.moneda || 'ARS') === moneda)
    .filter(a => norm(a.fecha) && (!tope || norm(a.fecha) <= tope))
    // Dos anclas del mismo día: gana la que se cargó después (created_at), y si
    // tampoco hay, el id — para que el resultado no dependa del orden en que la
    // base devolvió las filas.
    .sort((x, y) =>
      norm(x.fecha).localeCompare(norm(y.fecha)) ||
      String(x.created_at || '').localeCompare(String(y.created_at || '')) ||
      String(x.id).localeCompare(String(y.id)))
  return candidatas[candidatas.length - 1] || null
}

// Movimientos que caen DESPUÉS del ancla (y hasta `hasta`, si se acota).
// Estrictamente posteriores: si el usuario dice "el 10/09 tengo $X", ese saldo ya
// incluye todo lo que pasó ese día — volver a sumarlo sería contarlo dos veces.
export const movimientosDesdeAncla = (transactions, accountId, moneda, desde, hasta = null) => {
  const tope = norm(hasta)
  return (transactions || []).filter(t =>
    enLaCuenta(t, accountId) &&
    (t.moneda || 'ARS') === moneda &&
    norm(t.fecha) > norm(desde) &&
    (!tope || norm(t.fecha) <= tope))
}

// PAGOS DE TARJETA: un hecho, dos efectos.
//
// Pagar la tarjeta saca plata de la caja de ahorro Y baja la deuda de la tarjeta.
// La app guarda ese pago como un movimiento "neutro" en la cuenta de CRÉDITO —esa
// es la convención de todo el resto (ver CashView y calcularEstadoStatement)— así
// que la cuenta de la que salió la plata no se enteraba nunca: su saldo quedaba
// siempre de más, y por el monto más grande del mes.
//
// De qué cuenta sale cada tarjeta lo dice accounts.cuenta_pago_id, que se configura
// una vez por tarjeta. Por eso esto arregla también el pasado: no hace falta tocar
// ni un movimiento ya cargado, ni adivinar de dónde salió cada pago viejo.
const DIAS_TOLERANCIA = 3
const PARECE_PAGO_TARJETA = /tarjeta|pago\s*tc\b|visa|master|amex|cabal/i

const diasEntre = (a, b) =>
  Math.abs(new Date(norm(a) + 'T00:00:00') - new Date(norm(b) + 'T00:00:00')) / 86400000

// Pagos de tarjeta que salieron de esta cuenta, sin contar dos veces los que el
// extracto bancario ya trajo.
//
// Cuando además se importa el extracto del banco, el MISMO pago entra dos veces: como
// neutro en la tarjeta y como la línea "PAGO TARJETA" del extracto, que queda en la
// caja de ahorro. Es un solo hecho y tiene que restar una sola vez. Se emparejan por
// monto y fecha cercana (el banco y el resumen no siempre lo fechan igual), y cada
// línea del extracto cancela como máximo un pago — si no, dos cuotas iguales del mismo
// día se anularían con una sola fila.
export const pagosDeTarjetaDesde = ({ transactions, accounts, accountId, moneda, desde, hasta = null }) => {
  const tarjetas = (accounts || []).filter(a => a.tipo === 'credito' && a.cuenta_pago_id === accountId)
  if (tarjetas.length === 0) return []
  const idsTarjeta = new Set(tarjetas.map(a => a.id))
  const enVentana = (t) => norm(t.fecha) > norm(desde) && (!norm(hasta) || norm(t.fecha) <= norm(hasta))
  const mismaMoneda = (t) => (t.moneda || 'ARS') === moneda

  const pagos = (transactions || []).filter(t =>
    idsTarjeta.has(t.account_id) && t.tipo === 'neutro' && mismaMoneda(t) && enVentana(t))
  const yaEnElExtracto = (transactions || []).filter(t =>
    t.account_id === accountId && t.tipo === 'neutro' && mismaMoneda(t) && enVentana(t) &&
    PARECE_PAGO_TARJETA.test(`${t.nombre || ''} ${t.detalle || ''}`))

  const disponibles = [...yaEnElExtracto]
  return pagos.filter(p => {
    const i = disponibles.findIndex(b =>
      Math.abs(Number(b.monto) - Number(p.monto)) < 0.01 && diasEntre(b.fecha, p.fecha) <= DIAS_TOLERANCIA)
    if (i === -1) return true
    disponibles.splice(i, 1)
    return false
  })
}

// Saldo estimado de una cuenta en una moneda. null si no hay ancla: sin un punto
// de partida real la app no tiene nada que decir, y un cero sería mentira.
export const saldoDeCuenta = ({ anclas, transactions, accounts, accountId, moneda = 'ARS', hasta = null }) => {
  const ancla = ultimaAncla(anclas, accountId, moneda, hasta)
  if (!ancla) return null
  const movimientos = movimientosDesdeAncla(transactions, accountId, moneda, ancla.fecha, hasta)
  const pagosTarjeta = pagosDeTarjetaDesde({ transactions, accounts, accountId, moneda, desde: ancla.fecha, hasta })
  const entradas = movimientos.filter(t => signoEnSaldo(t) > 0)
  const salidas = movimientos.filter(t => signoEnSaldo(t) < 0)
  const suma = (lista) => lista.reduce((s, t) => s + Math.abs(Number(t.monto) || 0), 0)
  const totalEntradas = redondear(suma(entradas))
  const totalSalidas = redondear(suma(salidas) + suma(pagosTarjeta))
  return {
    ancla,
    moneda,
    saldo: redondear(Number(ancla.saldo) + totalEntradas - totalSalidas),
    entradas: totalEntradas,
    salidas: totalSalidas,
    pagosDeTarjeta: redondear(suma(pagosTarjeta)),
    cantidadMovimientos: movimientos.length + pagosTarjeta.length,
  }
}

// Lo que el usuario dice que tiene, contra lo que la app venía calculando.
// Es el número más útil de todo esto: si no es cero, hay movimientos sin cargar
// (desvío negativo: gastaste algo que no está) o cargados de más (positivo).
// null cuando no había nada con qué comparar — la primera ancla de una cuenta no
// tiene desvío, tiene un punto de partida.
export const desvioDeAncla = (saldoReal, estimado) => {
  if (!estimado) return null
  return redondear(Number(saldoReal) - estimado.saldo)
}
