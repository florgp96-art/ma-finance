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
  // Algunos resúmenes lo escriben en palabras y en medio del nombre, no como
  // "N/M" al final: "AYNOTDEAD RECOLETA (cuota 1 de 3) 1/3". Sin sacar esa parte
  // quedaba en el nombre mostrado, y además hacía que la misma compra leída de
  // otro resumen (que sí usa "N/M") no se reconociera como la misma.
  .replace(/\(?\s*cuotas?\s+\d+\s+de\s+\d+\s*\)?/gi, ' ')
  .replace(/\s+\d+\/\d+\s*$/, '')
  .replace(/\s+/g, ' ')
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

// Las compras se agrupan por CUENTA + CANTIDAD DE CUOTAS + MONTO DE LA CUOTA,
// no por nombre.
//
// El nombre no sirve como identificador: el mismo plan de cuotas viene escrito
// distinto en cada resumen. Casos reales vistos en producción:
//   "Perfume Mama CUOTA 3/9"                  vs  "CUOTA 3/9"
//   "AYNOTDEAD RECOLETA (cuota 1 de 3) 1/3"   vs  "AYNOTDEAD RECOLETA 2/3"
// Agrupando por nombre, cada variante era una "compra" aparte que proyectaba sus
// propias cuotas restantes — así el widget listaba como pendientes cuotas que ya
// estaban cargadas (con el monto exacto), y la deuda futura salía inflada.
//
// El monto de la cuota sí es invariante en un plan de cuotas fijas, que es cómo
// se financia en la práctica. Se admite una tolerancia (ver TOLERANCIA_MONTO)
// porque entre cuotas puede variar unos centavos por redondeo.
//
// Contrapartida asumida: dos compras DISTINTAS en la misma tarjeta, con la misma
// cantidad de cuotas y exactamente el mismo monto por cuota, se cuentan como
// una. Es mucho menos frecuente que la inconsistencia de nombres, y el error que
// causa es acotado (una compra de menos), contra el que causaba lo anterior
// (cuotas fantasma por cientos de miles de pesos).
const TOLERANCIA_MONTO = 0.02 // 2%

// PASO 1 — juntar las partes de una misma cuota. Un gasto dividido entre hijos
// (regla de tipo "split") queda como varias filas reales de la MISMA cuota, y si
// el reparto no es mitad y mitad esas partes tienen montos distintos: agrupar
// por monto las separaría en compras diferentes. Las partes comparten cuenta,
// cantidad de cuotas, número de cuota, fecha y nombre, así que se suman por esa
// combinación antes de comparar montos.
function unificarPartesDeCuota(filas) {
  const porCuota = new Map()
  filas.forEach(t => {
    const k = [
      t.account_id,
      t.cuotas_total,
      t.cuota_numero,
      (t.fecha || '').slice(0, 10),
      normalizarNombreCompra(t.nombre || t.detalle || ''),
    ].join('|')
    const acumulado = porCuota.get(k)
    if (acumulado) acumulado.monto = Number(acumulado.monto) + Number(t.monto)
    else porCuota.set(k, { ...t, monto: Number(t.monto) })
  })
  return [...porCuota.values()]
}

// PASO 2 — agrupar las cuotas en compras. Dentro de cada cuenta + cantidad de
// cuotas, se juntan las que tienen el mismo monto (con tolerancia). Se recorre
// ordenado por monto para que una serie con variaciones chicas caiga toda junta.
function agruparPorCompra(filas) {
  const buckets = new Map()
  filas.forEach(t => {
    const k = `${t.account_id}|${t.cuotas_total}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(t)
  })

  const grupos = []
  buckets.forEach(filasBucket => {
    const ordenadas = [...filasBucket].sort((a, b) => Math.abs(Number(a.monto) || 0) - Math.abs(Number(b.monto) || 0))
    let actual = null
    let referencia = 0
    ordenadas.forEach(t => {
      const monto = Math.abs(Number(t.monto) || 0)
      const entraEnElGrupo = actual && referencia > 0 && Math.abs(monto - referencia) <= referencia * TOLERANCIA_MONTO
      if (!entraEnElGrupo) {
        actual = []
        referencia = monto
        grupos.push(actual)
      }
      actual.push(t)
    })
  })
  return grupos
}

// Reconstruye las compras en cuotas con saldo pendiente. De cada compra
// devuelve la cuota conocida más reciente (la de número más alto) y cuántas
// cuotas faltan después de esa.
export function comprasEnCuotasPendientes(transactions) {
  const conCuotas = (transactions || []).filter(t =>
    t.tipo === 'gasto' && (t.cuotas_total || 1) > 1 && (t.cuota_numero || 0) > 0 && t.fecha &&
    !esAlquilerOExpensas(t)
  )
  if (conCuotas.length === 0) return []

  return agruparPorCompra(unificarPartesDeCuota(conCuotas)).map(grupo => {
    const maxCuota = grupo.reduce((m, t) => Math.max(m, t.cuota_numero || 0), 0)
    // De la cuota más alta puede haber más de una fila si quedaron dos cargas de
    // la misma cuota con nombres distintos — se toma una, no se suman (sumarlas
    // duplicaría el monto de esa cuota).
    const tx = grupo.find(t => (t.cuota_numero || 0) === maxCuota)
    return { tx, restantes: (tx.cuotas_total || 1) - maxCuota }
  }).filter(c => c.restantes > 0)
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
