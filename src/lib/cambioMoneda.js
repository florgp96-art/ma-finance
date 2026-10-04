// CAMBIO DE MONEDA: un hecho, dos movimientos.
//
// Vender dólares para tener pesos (o al revés) no es un gasto ni un ingreso: es la
// misma plata que cambia de forma. Se guarda como dos movimientos neutros —uno que
// SALE de la cuenta con la moneda que se entrega y otro que ENTRA en la cuenta con
// la que se recibe—, así el saldo de cada una se mueve y el balance del mes no lo
// cuenta ni como gasto ni como ingreso (ver desgloseDelMes en CashView).
//
// Las dos patas pueden ser la misma cuenta: una billetera como Mercado Pago tiene
// saldo en pesos y en dólares, y el saldo se lleva por cuenta Y moneda.
//
// Con la misma moneda de los dos lados no es un cambio sino una TRANSFERENCIA entre
// cuentas propias (del efectivo a la caja de ahorro, de la caja a Mercado Pago): los
// mismos dos neutros, por el mismo monto, en dos cuentas distintas.
//
// Cada pata lleva su `sentido` (ver signoEnSaldo). Si la base todavía no tiene esa
// columna, el texto hace de respaldo: la pata que entra dice "Acreditación", una de
// las palabras con las que signoEnSaldo reconoce plata que vuelve, y la que sale no
// dice ninguna.

import { parseMonto } from './formato'

export const MONEDAS_CAMBIO = ['ARS', 'USD', 'EUR']
export const SIMBOLO_MONEDA = { ARS: '$', USD: 'U$S', EUR: '€' }
const MONTO_MAXIMO = 1e12

const redondear = (n) => Math.round(n * 100) / 100

const montoValido = (v) => {
  const n = parseMonto(v)
  return Number.isFinite(n) && n > 0 && n < MONTO_MAXIMO ? redondear(n) : null
}

const fechaValida = (f) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '')) return false
  const d = new Date(`${f}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f
}

export const formatoCambio = (monto, moneda, decimales = 2) =>
  `${SIMBOLO_MONEDA[moneda] || '$'} ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: decimales }).format(monto)}`

// Cuánto vale una moneda en la otra, como se lee en una pizarra ("U$S 1 = $ 1.450"):
// con pesos de un lado, pesos por unidad extranjera; entre dos extranjeras, cuánto
// se recibió por cada unidad entregada. null si todavía no hay con qué calcularlo.
export const tipoDeCambioImplicito = ({ origen, destino }) => {
  const mo = montoValido(origen?.monto)
  const md = montoValido(destino?.monto)
  if (!mo || !md || !origen.moneda || !destino.moneda || origen.moneda === destino.moneda) return null
  if (destino.moneda === 'ARS') return { moneda: origen.moneda, en: 'ARS', valor: md / mo }
  if (origen.moneda === 'ARS') return { moneda: destino.moneda, en: 'ARS', valor: mo / md }
  return { moneda: origen.moneda, en: destino.moneda, valor: md / mo }
}

// Los dos movimientos listos para insertar, o { error } con qué corregir.
//
// origen/destino: { accountId, moneda, monto, nombre }. El nombre de la cuenta solo
// se usa para describir una transferencia ("Transferencia a Caja de Ahorro").
// conSentido: si la base ya tiene la columna (ver hayColumnaSentido); sin ella el
// insert fallaría entero.
// tipoCambioUSD: el de referencia de la app, para la pata en dólares cuando la otra
// no es en pesos (con pesos del otro lado se usa el del cambio, que es el real).
export const armarCambioDeMoneda = ({ userId, fecha, origen, destino, conSentido = true, tipoCambioUSD = null }) => {
  if (!userId) return { error: 'No hay una sesión activa. Volvé a entrar.' }
  if (!fechaValida(fecha)) return { error: 'Elegí una fecha válida.' }
  if (!origen?.accountId || !destino?.accountId) return { error: 'Elegí de qué cuenta sale la plata y a cuál entra.' }
  if (!MONEDAS_CAMBIO.includes(origen.moneda) || !MONEDAS_CAMBIO.includes(destino.moneda)) return { error: 'Elegí la moneda de cada lado.' }
  const esTransferencia = origen.moneda === destino.moneda
  if (esTransferencia && origen.accountId === destino.accountId) return { error: 'Para pasar plata en la misma moneda elegí dos cuentas distintas.' }
  const montoOrigen = montoValido(origen.monto)
  // En la misma moneda lo que sale es lo que entra: un solo monto.
  const montoDestino = esTransferencia ? montoOrigen : montoValido(destino.monto)
  if (esTransferencia && !montoOrigen) return { error: 'Completá el monto con un número mayor a cero.' }
  if (!montoOrigen || !montoDestino) return { error: 'Completá los dos montos con un número mayor a cero.' }

  const tc = tipoDeCambioImplicito({ origen, destino })
  const tcReferencia = Number(tipoCambioUSD)
  const fxRate = (moneda) => {
    if (moneda !== 'USD') return null
    if (tc && tc.moneda === 'USD' && tc.en === 'ARS') return redondear(tc.valor)
    return Number.isFinite(tcReferencia) && tcReferencia > 0 ? tcReferencia : null
  }
  const nombreCambio = `Cambio ${formatoCambio(montoOrigen, origen.moneda)} → ${formatoCambio(montoDestino, destino.moneda)}`
  const pata = (lado, monto, sentido, detalle, nombre) => ({
    user_id: userId,
    account_id: lado.accountId,
    fecha,
    nombre,
    detalle,
    monto,
    moneda: lado.moneda,
    tipo: 'neutro',
    category_id: null,
    subcategory_id: null,
    tag: null,
    child_id: null,
    estado: 'identificado',
    es_manual: true,
    cuotas_total: 1,
    cuota_numero: 1,
    fx_rate: fxRate(lado.moneda),
    ...(conSentido ? { sentido } : {}),
  })
  if (esTransferencia) {
    return {
      movimientos: [
        pata(origen, montoOrigen, 'sale', 'Débito por transferencia entre cuentas', `Transferencia a ${destino.nombre || 'otra cuenta'}`),
        pata(destino, montoDestino, 'entra', 'Acreditación por transferencia entre cuentas', `Transferencia desde ${origen.nombre || 'otra cuenta'}`),
      ],
    }
  }
  return {
    movimientos: [
      pata(origen, montoOrigen, 'sale', 'Débito por cambio de moneda', nombreCambio),
      pata(destino, montoDestino, 'entra', 'Acreditación por cambio de moneda', nombreCambio),
    ],
  }
}

// ¿Esta línea de un extracto es una compra o venta de moneda?
//
// Cada banco lo escribe a su manera ("VENTA DE MONEDA EXTRANJERA", "COMPRA
// DOLARES", "Venta de USD", "DOLAR MEP"), pero siempre es compra/venta pegado a la
// moneda. Se exige que vayan pegados para no confundirlo con una compra con débito
// en un comercio que cobra en dólares ("COMPRA DEBITO NETFLIX USD").
//
// También la compra y venta de títulos: el dólar MEP se hace comprando un bono con
// dólares ("COMP. TITULOS / VAL. AL30") y vendiéndolo en pesos ("VENTA DE TITULOS /
// VALORES - AL30"). Y si el bono se guarda como inversión tampoco es gasto ni
// ingreso: es plata propia que cambia de forma, como un plazo fijo.
const CAMBIO_DE_MONEDA = new RegExp([
  String.raw`\b(compra|venta|cpra|vta)\.?\s+(de\s+)?(moneda\s+extranjera|dolares|dolar|divisas?|usd|u\$s|euros?)\b`,
  String.raw`\b(compra|venta|comp|cpra|vta)\.?\s+(de\s+)?(titulos|valores|bonos?)\b`,
  String.raw`\bdolar\s+mep\b`,
  String.raw`\b(operacion\s+de\s+cambio|(operacion|cambio)\s+de\s+(moneda|divisas?))\b`,
  String.raw`\bconversion\s+a\s+(ars|pesos|usd|dolares|eur|euros)\b`,
].join('|'), 'i')

export const pareceCambioDeMoneda = (texto) =>
  CAMBIO_DE_MONEDA.test(String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, ''))
