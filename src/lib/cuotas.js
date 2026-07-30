// Único lugar que sabe reconstruir "compras en cuotas" a partir de las filas
// sueltas de cada cuota. Antes esta lógica estaba duplicada en Dashboard.js
// (widget "Cuotas pendientes") y en CashView.js (card "Cuotas comprometidas a
// futuro"), y las dos copias se desincronizaron: el fix de la clave de
// agrupación se aplicó en una sola, así que las dos vistas mostraban totales
// distintos para lo mismo (una infla la deuda futura respecto de la otra).

// El banco pega el sufijo de cuota al nombre de cada fila ("Compra 3/12"), que
// cambia en cada cuota de la MISMA compra real — sin sacarlo, cada cuota ya
// facturada se cuenta como una compra aparte.
export const stripCuotaSuffix = (n) => (n || '')
  .replace(/\s+\d+\/\d+\s*$/, '')
  .trim()

// Además del "N/M" final, se saca un posible prefijo de titular adicional tipo
// "BETTY — " / "FEDERICO — ": la misma compra real a veces se lee con ese
// prefijo y a veces sin él según el resumen, y si no se normaliza queda como
// dos compras distintas.
export const normalizarNombreCompra = (n) => stripCuotaSuffix(n)
  .replace(/^.+?\s+[—-]\s+/, '')
  .toLowerCase()

// Alquiler/expensas puede quedar cargado con cuotas_total/cuota_numero (ej.
// para trackear los meses de un contrato), pero no es una compra financiada con
// fecha de fin real: es un gasto fijo recurrente que no corresponde proyectar
// (y que ni siquiera está garantizado que se pague todos los meses).
export const esAlquilerOExpensas = (t) =>
  t.categories?.nombre === 'Casa' && ['Alquiler', 'Expensas'].includes(t.subcategories?.nombre)

// IMPORTANTE — la clave NO incluye el mes en que arrancó la compra. Se probó
// derivarlo de la fecha de cada fila (fecha menos cuota_numero meses) para
// poder distinguir dos compras distintas con el mismo nombre, pero si las
// cuotas intermedias de una misma compra real no quedaron con fechas espaciadas
// exactamente un mes (algo común: resúmenes que no cierran siempre el mismo
// día, o dos cuotas cargadas con la misma fecha), ese mes salía distinto para
// cada cuota y partía la compra en varios grupos fantasma — cada uno
// proyectando sus propias cuotas restantes y multiplicando la deuda mostrada.
const groupKey = (t) => `${normalizarNombreCompra(t.nombre || t.detalle || '')}|${t.cuotas_total}|${t.account_id}`

// Reconstruye las compras en cuotas con saldo pendiente. De cada compra
// devuelve la cuota conocida más reciente (la de número más alto) y cuántas
// cuotas faltan después de esa.
export function comprasEnCuotasPendientes(transactions) {
  const conCuotas = (transactions || []).filter(t =>
    t.tipo === 'gasto' && (t.cuotas_total || 1) > 1 && (t.cuota_numero || 0) > 0 && t.fecha &&
    !esAlquilerOExpensas(t)
  )
  if (conCuotas.length === 0) return []

  const maxCuotaPorGrupo = {}
  conCuotas.forEach(t => {
    const key = groupKey(t)
    const cn = t.cuota_numero || 0
    if (!maxCuotaPorGrupo[key] || cn > maxCuotaPorGrupo[key]) maxCuotaPorGrupo[key] = cn
  })

  // Una compra dividida (regla de tipo "split") queda como varias filas reales
  // con el mismo número de cuota — hay que sumarlas para recuperar el monto
  // total de esa cuota, no quedarnos con una sola parte.
  const latestByPurchase = {}
  conCuotas.forEach(t => {
    const key = groupKey(t)
    if ((t.cuota_numero || 0) !== maxCuotaPorGrupo[key]) return
    if (!latestByPurchase[key]) latestByPurchase[key] = { ...t, monto: 0 }
    latestByPurchase[key].monto += Number(t.monto)
  })

  return Object.values(latestByPurchase)
    .map(t => ({ tx: t, restantes: (t.cuotas_total || 1) - (t.cuota_numero || 1) }))
    .filter(c => c.restantes > 0)
}

const mesDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// Proyecta una por una las cuotas que faltan, con el mes en que caería cada
// una. Se saltean las que caerían en un mes YA PASADO: si la última cuota
// conocida de una compra es vieja, las siguientes probablemente ya se
// facturaron y solo falta cargar ese resumen — contarlas como deuda futura
// abultaría el total.
//
// Las dos vistas de cuotas (la card "Cuotas comprometidas a futuro" y el widget
// "Cuotas pendientes") tienen que partir de ESTA proyección: cuando la card
// sumaba todas las restantes y el widget salteaba las de meses pasados, los dos
// números no cerraban entre sí y parecía que uno de los dos estaba mal.
export function proyectarCuotasFuturas(transactions, hoy = new Date()) {
  const mesActual = mesDe(hoy)
  const proyectadas = []
  comprasEnCuotasPendientes(transactions).forEach(({ tx, restantes }) => {
    const base = new Date(tx.fecha + 'T12:00:00')
    for (let i = 1; i <= restantes; i++) {
      const mes = mesDe(new Date(base.getFullYear(), base.getMonth() + i, 1))
      if (mes < mesActual) continue
      proyectadas.push({ tx, mes, cuotaNum: (tx.cuota_numero || 1) + i })
    }
  })
  return proyectadas
}
