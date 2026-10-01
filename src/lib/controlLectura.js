// ¿Lo que leyó la IA de un resumen de tarjeta cierra con el total que informa el
// propio resumen? Un comercio salteado o un cargo de cierre olvidado no tiran
// ningún error: el resumen "se lee bien", pero con plata de menos. Con clientes de
// bancos que nunca se probaron es justo lo que hay que detectar antes de guardar.
//
// En un resumen de tarjeta, por moneda:
//   total a pagar = saldo anterior − pagos + consumos − devoluciones
// Sin saldo anterior (el resumen no lo muestra o la IA no lo leyó) se asume que el
// resumen anterior se pagó entero: el pago lo cancela y queda consumos − devoluciones.
//
// Los extractos de banco no se controlan: de un movimiento neutro (transferencia
// propia, inversión) no se sabe si entró o salió, así que no hay cuenta que cerrar.
const MONEDAS = [
  { moneda: 'ARS', total: 'total_pesos', saldoAnterior: 'saldo_anterior_pesos' },
  { moneda: 'USD', total: 'total_dolares', saldoAnterior: 'saldo_anterior_dolares' },
]

const numero = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Margen por redondeo: 0,05 % del total, con un mínimo de $ 1 / U$S 0,05.
export const toleranciaDe = (moneda, total) => Math.max(moneda === 'ARS' ? 1 : 0.05, Math.abs(total) * 0.0005)

// De qué lado del resumen está cada movimiento según lo que leyó la IA. El sentido
// se anota antes de los alias (ver sentidoDelExtracto): un consumo que un alias pasó
// a neutro sigue siendo un consumo del resumen, no un pago.
const ladoDe = (t) => {
  if (t.sentido === 'sale') return 'consumo'
  if (t.sentido === 'entra') return 'devolucion'
  if (t.tipo === 'gasto') return 'consumo'
  if (t.tipo === 'ingreso') return 'devolucion'
  return 'pago'
}

export const controlDeLectura = (resultado) => {
  if (resultado?.tipo_documento !== 'tarjeta') return { aplica: false, cuadra: null, monedas: [] }
  const transacciones = Array.isArray(resultado.transacciones) ? resultado.transacciones : []
  const monedas = []
  for (const campos of MONEDAS) {
    const total = numero(resultado[campos.total])
    const deLaMoneda = transacciones.filter(t => (t.moneda || 'ARS') === campos.moneda)
    if (total === null || (total === 0 && deLaMoneda.length === 0)) continue
    const suma = (lado) => deLaMoneda.filter(t => ladoDe(t) === lado).reduce((s, t) => s + Math.abs(Number(t.monto) || 0), 0)
    const saldoAnterior = numero(resultado[campos.saldoAnterior])
    const calculado = (saldoAnterior === null ? 0 : saldoAnterior - suma('pago')) + suma('consumo') - suma('devolucion')
    const diferencia = total - calculado
    monedas.push({
      moneda: campos.moneda, total, calculado, diferencia,
      conSaldoAnterior: saldoAnterior !== null,
      cuadra: Math.abs(diferencia) <= toleranciaDe(campos.moneda, total),
    })
  }
  return { aplica: monedas.length > 0, cuadra: monedas.length ? monedas.every(m => m.cuadra) : null, monedas }
}

const SIMBOLO = { ARS: '$', USD: 'U$S' }
const formato = (n, moneda) => `${SIMBOLO[moneda] || moneda} ${new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: moneda === 'ARS' ? 0 : 2, maximumFractionDigits: 2,
}).format(n)}`

// Una línea por moneda que no cuadra, para la pantalla y para el mail de aviso.
export const lineasDelControl = (control) => (control?.monedas || [])
  .filter(m => !m.cuadra)
  .map(m => `${m.moneda === 'ARS' ? 'Pesos' : 'Dólares'}: el resumen dice ${formato(m.total, m.moneda)} y lo leído da ${formato(m.calculado, m.moneda)} (${m.diferencia > 0 ? 'faltan' : 'sobran'} ${formato(Math.abs(m.diferencia), m.moneda)}).`)
