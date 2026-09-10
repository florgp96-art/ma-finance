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
// Los gastos y los neutros viven en la cuenta donde se hicieron, así que alcanza
// con account_id. Los INGRESOS no: al importar un extracto bancario se guardan en
// la cuenta "Ingresos" (para que los gráficos de ingresos los agrupen todos
// juntos), y ahí se perdía en qué cuenta entró la plata. cuenta_destino_id repara
// eso — es la cuenta real que recibió el ingreso. Un ingreso cargado a mano ya
// tiene la cuenta elegida en account_id y no necesita destino.
export const enLaCuenta = (t, accountId) => {
  if (!t || !accountId) return false
  if (t.tipo === 'ingreso') return (t.cuenta_destino_id || t.account_id) === accountId
  return t.account_id === accountId
}

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

// Saldo estimado de una cuenta en una moneda. null si no hay ancla: sin un punto
// de partida real la app no tiene nada que decir, y un cero sería mentira.
export const saldoDeCuenta = ({ anclas, transactions, accountId, moneda = 'ARS', hasta = null }) => {
  const ancla = ultimaAncla(anclas, accountId, moneda, hasta)
  if (!ancla) return null
  const movimientos = movimientosDesdeAncla(transactions, accountId, moneda, ancla.fecha, hasta)
  const entradas = movimientos.filter(t => signoEnSaldo(t) > 0)
  const salidas = movimientos.filter(t => signoEnSaldo(t) < 0)
  const suma = (lista) => lista.reduce((s, t) => s + Math.abs(Number(t.monto) || 0), 0)
  const totalEntradas = redondear(suma(entradas))
  const totalSalidas = redondear(suma(salidas))
  return {
    ancla,
    moneda,
    saldo: redondear(Number(ancla.saldo) + totalEntradas - totalSalidas),
    entradas: totalEntradas,
    salidas: totalSalidas,
    cantidadMovimientos: movimientos.length,
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
