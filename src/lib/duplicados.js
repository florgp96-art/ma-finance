// ¿Este movimiento del PDF ya está cargado?
//
// Un resumen se puede importar dos veces, y además hay movimientos que ya estaban
// cargados a mano o por Excel mientras se esperaba el PDF. Insertarlos de nuevo
// duplica plata.
//
// La identidad de un GASTO incluye su descripción: dos compras de $5.000 el mismo
// día en comercios distintos son dos gastos distintos, no uno repetido.
//
// La de un PAGO, no. El pago de la tarjeta es justo lo que el usuario carga a mano
// antes de que llegue el resumen (para ver al día cuánto debe), y cuando el PDF
// llega trae el MISMO pago con otro texto: el banco escribe "SU PAGO" y el usuario
// había escrito "Pago Mastercard". Exigiendo que la descripción coincida, ese pago
// entraba dos veces — y un pago contado dos veces borra deuda que existe de verdad.
//
// La fecha tampoco coincide siempre. Caso real: el resumen fechaba un pago el
// 02-Ago y en la app estaba cargado el 03-Ago. Por eso en los pagos se admite una
// tolerancia de días; en los gastos, no (ahí la fecha sí es parte de la identidad,
// y el mismo importe en el mismo comercio dos días seguidos es normal).
export const TOLERANCIA_DIAS_PAGO = 3

const norm = (f) => (f || '').trim().slice(0, 10)
const normDet = (s) => (s || '').toLowerCase().trim()
const diasEntre = (a, b) =>
  Math.abs(new Date(norm(a) + 'T00:00:00') - new Date(norm(b) + 'T00:00:00')) / 86400000

// Los pagos y las transferencias propias son "neutro": no son un gasto ni un
// ingreso, son plata moviéndose.
const esPago = (t) => t.tipo === 'neutro'

const coincide = (cand, e) => {
  if (cand.account_id && e.account_id && e.account_id !== cand.account_id) return false
  if ((e.moneda || 'ARS') !== (cand.moneda || 'ARS')) return false
  if (Math.abs(Number(e.monto) - Number(cand.monto)) >= 0.01) return false
  if (esPago(cand)) return esPago(e) && diasEntre(e.fecha, cand.fecha) <= TOLERANCIA_DIAS_PAGO
  return norm(e.fecha) === norm(cand.fecha) && normDet(e.detalle) === normDet(cand.detalle)
}

// ¿Este pago del PDF es uno que ya está cargado? Lo usa la vista previa de la
// importación para tachar la fila, con la MISMA regla con la que después el
// guardado lo descarta. La vista previa tenía su propio chequeo, que además exigía
// que el nombre se pareciera: "Su Pago" contra "Pago Tarjeta Mastercard" se mostraba
// como nuevo y marcado para importar —aunque al guardar se omitía igual—, y parecía
// que la app no se daba cuenta de que ese pago ya estaba.
export const esElMismoPago = (cand, e) => esPago(cand) && coincide(cand, e)

// ¿Este gasto del PDF es uno que ya está cargado con OTRO nombre? Misma cuenta,
// moneda y monto al centavo, y el MISMO día. Solo lo usa la vista previa: ahí la
// fila sale tachada y, si de verdad eran dos compras, el usuario la vuelve a marcar.
// El guardado no lo usa a propósito: lo que el usuario deja marcado, se importa.
//
// Caso real: la nafta cargada a mano entraba otra vez con el nombre que le pone el
// banco, el mismo día y por el mismo monto, porque la vista previa exigía que los
// nombres se parecieran. Lo mismo "MERPAGO*PERAZOLI" contra "Perazoli Destapa Cañeria".
export const esElMismoGasto = (cand, e) =>
  cand.tipo === 'gasto' && e.tipo === 'gasto' &&
  !(cand.account_id && e.account_id && cand.account_id !== e.account_id) &&
  (e.moneda || 'ARS') === (cand.moneda || 'ARS') &&
  Math.abs(Number(e.monto) - Number(cand.monto)) < 0.01 &&
  norm(e.fecha) === norm(cand.fecha)

// Devuelve los candidatos que NO están cargados todavía, y cuántos se omitieron.
//
// Cada fila ya cargada tapa como máximo UN candidato. Antes esto era un `.some()`,
// que no consume: con dos movimientos iguales en el PDF y uno solo en la base, los
// dos candidatos matcheaban esa única fila y se descartaban ambos — se perdía un
// movimiento real. Ahora la fila se consume al usarla.
export const filtrarYaCargados = (candidatos, existentes) => {
  const disponibles = [...(existentes || [])]
  const nuevos = []
  let omitidos = 0
  for (const cand of (candidatos || [])) {
    const i = disponibles.findIndex(e => coincide(cand, e))
    if (i === -1) { nuevos.push(cand); continue }
    disponibles.splice(i, 1)
    omitidos++
  }
  return { nuevos, omitidos }
}
