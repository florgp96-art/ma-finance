// Segunda lectura automática de un resumen de tarjeta que no cerró con su total.
//
// Hasta ahora, cuando lo leído no cuadraba con el total del resumen (ver
// controlLectura.js), la app solo avisaba. Con un banco que nunca se había
// probado, la única forma de arreglarlo era que la dueña de la app trajera el PDF
// y se ajustaran a mano las instrucciones del lector. Ahora la app le vuelve a
// pasar el resumen a la IA con la diferencia concreta ("faltan $ 48.000 en
// pesos") y la lista de lo que ya leyó, y le pide solo lo que hay que agregar o
// sacar. Si con eso cierra, además le pide una nota sobre qué tenía de particular
// el FORMATO de ese resumen, que se guarda y se usa en las próximas lecturas de
// cualquier usuario con resúmenes de esa misma entidad.
//
// La nota se comparte entre usuarios, así que NUNCA puede llevar datos de quien
// subió el resumen. Se le pide a la IA que describa solo el formato, y además
// limpiarNotaFormato saca de la nota cualquier número, mail, dirección web y el
// nombre de los titulares, por si la IA no obedeció.
//
// Este archivo lo usan la app (src/) y la función del servidor
// (api/_lib/revisarLectura.js): por eso no importa nada del navegador ni de Supabase.

import { controlDeLectura, lineasDelControl } from './controlLectura.js'

const MAX_AGREGAR = 60
const MAX_QUITAR = 15
const MAX_NOTA = 300

// Lista numerada de lo que devolvió la primera lectura, para que la revisión pueda
// decir "sacá la #7" sin repetir todo el resumen.
export const listaParaRevision = (transacciones) => (transacciones || [])
  .map((t, i) => {
    const lado = t.tipo === 'neutro' ? 'pago' : (t.tipo === 'ingreso' || t.es_credito) ? 'devolución' : 'consumo'
    const cuota = (t.cuotas_total || 1) > 1 ? ` · cuota ${t.cuota_numero}/${t.cuotas_total}` : ''
    return `#${i} ${t.fecha || '¿fecha?'} | ${t.nombre_original || t.nombre_limpio || '¿?'} | ${Math.abs(Number(t.monto) || 0)} ${t.moneda || 'ARS'} | ${lado}${cuota}`
  })
  .join('\n')

// Instrucciones de la revisión. Van DESPUÉS del prompt de análisis de siempre
// (que trae las categorías y el formato de cada movimiento), y cambian qué se
// devuelve: en vez del resumen entero, solo la corrección.
export const bloqueRevision = (resultado) => {
  const control = controlDeLectura(resultado)
  const totales = [
    ['total_pesos', resultado.total_pesos],
    ['total_dolares', resultado.total_dolares],
    ['saldo_anterior_pesos', resultado.saldo_anterior_pesos],
    ['saldo_anterior_dolares', resultado.saldo_anterior_dolares],
  ].map(([k, v]) => `${k}: ${v ?? 'null'}`).join(' · ')
  return `
═══════════════════════════════
ESTO ES UNA REVISIÓN: LA PRIMERA LECTURA NO CIERRA CON EL TOTAL
═══════════════════════════════
Este resumen ya se leyó una vez y lo leído no cierra con el total que informa el propio resumen. En cada moneda tiene que cumplirse:
  total a pagar = saldo anterior − pagos + consumos − devoluciones

Diferencia encontrada:
${lineasDelControl(control).join('\n')}

Lo que se leyó la primera vez (${totales}). Movimientos, numerados:
${listaParaRevision(resultado.transacciones)}

Volvé a leer TODO el documento, página por página, y encontrá de dónde sale la diferencia. Lo más común: un cargo de cierre salteado (intereses, impuestos, sellos, IVA, percepciones, comisiones), consumos en dólares en una tabla aparte, una devolución tomada como consumo o al revés, un movimiento repetido, un monto mal leído, o el saldo anterior mal leído.

Reglas de la revisión:
- Solo agregá movimientos que estén IMPRESOS en el documento, con su descripción tal cual figura. NUNCA inventes un movimiento ni un "ajuste" para que cierre: si no encontrás de dónde sale la diferencia, devolvé las listas vacías. Es preferible que no cierre a inventar plata.
- Para corregir un movimiento mal leído (monto, moneda, si es consumo o devolución), poné su número en "quitar" y agregá la versión corregida en "agregar".
- Cada movimiento de "agregar" lleva los mismos campos que una transacción de la estructura de arriba.
- saldo_anterior_pesos / saldo_anterior_dolares: devolvelos solo si la primera vez se leyeron mal o no se leyeron y SÍ figuran impresos. Si no, null.
- formato.entidad: el banco o la emisora del resumen (ej. "Galicia", "Santander", "Mercado Pago"). formato.producto: la tarjeta (ej. "Visa", "Mastercard", "American Express"). Sin el nivel (Black, Platinum, Gold...) ni números.
- nota_formato: si encontraste la diferencia, de 1 a 3 oraciones que expliquen qué tiene de particular el FORMATO de los resúmenes de esta entidad y producto que hizo que se pasara (en qué parte del documento está esa información, cómo se rotulan las columnas o las secciones), para que la próxima vez se lea bien de entrada otro resumen de la misma entidad. Esta nota la van a leer otras personas que no son el titular, así que está PROHIBIDO incluir cualquier dato de esta persona o de sus movimientos: nada de nombres, números (de tarjeta, de cuenta, montos, fechas, cuotas), comercios ni direcciones. Describí el formato en general. Si no encontraste la diferencia, null.

En esta revisión NO devuelvas la estructura completa de arriba: devolvé solo el objeto de la revisión.`
}

// Esquema de la respuesta de la revisión (salida estructurada de la API).
const transaccionSchema = {
  type: 'object',
  properties: {
    fecha: { type: 'string', description: 'YYYY-MM-DD' },
    nombre_original: { type: 'string' },
    nombre_limpio: { type: 'string' },
    categoria_sugerida: { type: 'string' },
    subcategoria_sugerida: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    hijo: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    monto: { type: 'number' },
    moneda: { type: 'string', enum: ['ARS', 'USD', 'EUR'] },
    tipo: { type: 'string', enum: ['gasto', 'ingreso', 'neutro'] },
    es_credito: { type: 'boolean' },
    cuotas_total: { type: 'integer' },
    cuota_numero: { type: 'integer' },
    titular: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['fecha', 'nombre_original', 'nombre_limpio', 'categoria_sugerida', 'subcategoria_sugerida', 'hijo', 'monto', 'moneda', 'tipo', 'es_credito', 'cuotas_total', 'cuota_numero', 'titular'],
  additionalProperties: false,
}

export const ESQUEMA_REVISION = {
  type: 'object',
  properties: {
    quitar: { type: 'array', items: { type: 'integer' } },
    saldo_anterior_pesos: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    saldo_anterior_dolares: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    formato: {
      type: 'object',
      properties: {
        entidad: { type: 'string' },
        producto: { type: 'string' },
      },
      required: ['entidad', 'producto'],
      additionalProperties: false,
    },
    nota_formato: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    agregar: { type: 'array', items: transaccionSchema },
  },
  required: ['quitar', 'saldo_anterior_pesos', 'saldo_anterior_dolares', 'formato', 'nota_formato', 'agregar'],
  additionalProperties: false,
}

const esFechaISO = (f) => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f)

// Aplica la corrección a la primera lectura. Devuelve null si la corrección es
// sospechosa (saca demasiado, agrega demasiado, o no es una corrección): en ese
// caso se queda la primera lectura tal cual.
export const aplicarRevision = (resultado, revision) => {
  const previas = Array.isArray(resultado?.transacciones) ? resultado.transacciones : []
  if (!revision || typeof revision !== 'object') return null
  const quitar = new Set((Array.isArray(revision.quitar) ? revision.quitar : [])
    .filter(i => Number.isInteger(i) && i >= 0 && i < previas.length))
  const agregar = (Array.isArray(revision.agregar) ? revision.agregar : [])
    .filter(t => t && esFechaISO(t.fecha) && Number(t.monto) && (t.nombre_original || t.nombre_limpio))
  if (quitar.size === 0 && agregar.length === 0 && revision.saldo_anterior_pesos == null && revision.saldo_anterior_dolares == null) return null
  if (quitar.size > MAX_QUITAR || quitar.size > Math.max(2, previas.length * 0.3) || agregar.length > MAX_AGREGAR) return null

  const corregido = {
    ...resultado,
    transacciones: [
      ...previas.filter((_, i) => !quitar.has(i)),
      ...agregar.map(t => ({ ...t, monto: Math.abs(Number(t.monto)), revisado: true })),
    ],
  }
  if (typeof revision.saldo_anterior_pesos === 'number') corregido.saldo_anterior_pesos = revision.saldo_anterior_pesos
  if (typeof revision.saldo_anterior_dolares === 'number') corregido.saldo_anterior_dolares = revision.saldo_anterior_dolares
  return { resultado: corregido, agregados: agregar.length, quitados: quitar.size }
}

// ¿La revisión dejó la lectura mejor que antes? 'cuadra' si ahora cierra en todas
// las monedas; 'mejoro' si se achicó la diferencia sin agrandarse en ninguna
// moneda; 'no_mejoro' en cualquier otro caso (y ahí se descarta la revisión).
export const compararControles = (antes, despues) => {
  if (despues?.cuadra === true) return 'cuadra'
  const dif = (control, moneda) => Math.abs(control?.monedas?.find(m => m.moneda === moneda)?.diferencia ?? 0)
  const monedas = [...new Set([...(antes?.monedas || []), ...(despues?.monedas || [])].map(m => m.moneda))]
  const empeora = monedas.some(m => dif(despues, m) > dif(antes, m) + 0.01)
  const total = (c) => monedas.reduce((s, m) => s + dif(c, m), 0)
  return !empeora && total(despues) < total(antes) - 0.01 ? 'mejoro' : 'no_mejoro'
}

const sinTildes = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const NIVELES = /\b(black|platinum|platinium|gold|signature|infinite|eminent|internacional|international|classic|clasica|green|the|card|tarjeta|de|credito|en|pesos|dolares)\b/g

const normalizarParte = (s) => sinTildes(s).toLowerCase()
  .replace(/[^a-z\s]/g, ' ')
  .replace(NIVELES, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Clave con la que se guarda y se agrupa la nota: "galicia|mastercard|tarjeta".
// null si la IA no dijo de qué entidad es: una nota sin entidad no le sirve a nadie.
export const claveDeFormato = (formato, tipoDocumento = 'tarjeta') => {
  const entidad = normalizarParte(formato?.entidad)
  if (!entidad) return null
  const producto = normalizarParte(formato?.producto)
  return `${entidad}|${producto}|${tipoDocumento || 'tarjeta'}`
}

// Entidad y producto tal como se muestran en el prompt de los demás ("Galicia ·
// Mastercard"): sin números y cortos, por las mismas razones que la nota.
const limpiarEtiqueta = (s) => (typeof s === 'string' ? s : '').replace(/\d[\d\s.-]*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
export const etiquetaDeFormato = (formato) => ({
  entidad: limpiarEtiqueta(formato?.entidad),
  producto: limpiarEtiqueta(formato?.producto),
})

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Palabras cortas que aparecen en nombres pero también en cualquier oración: no se
// borran de la nota aunque formen parte del nombre de un titular.
const PALABRAS_COMUNES = new Set(['del', 'los', 'las', 'por', 'con', 'san', 'sus', 'una', 'que'])

// La nota se comparte entre usuarios: se le saca todo lo que pueda identificar a
// quien subió el resumen, aunque la IA ya haya recibido la orden de no ponerlo.
// Números de cualquier tipo (montos, fechas, tarjeta, cuenta), mails, direcciones
// web y las palabras del nombre de los titulares y adicionales que leyó la IA.
// Devuelve null si después de limpiarla no queda una nota útil.
export const limpiarNotaFormato = (nota, { nombres = [] } = {}) => {
  if (typeof nota !== 'string') return null
  let limpia = nota
    .replace(/\S+@\S+/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/[$€]|\bU\$S|\bUSD\b|\bARS\b/gi, ' ')
    .replace(/\d[\d.,/:-]*/g, ' ')
  const palabrasDeNombres = nombres
    .filter(n => typeof n === 'string')
    .flatMap(n => n.split(/\s+/))
    .map(p => p.trim())
    .filter(p => p.length >= 3 && !PALABRAS_COMUNES.has(p.toLowerCase()))
  for (const p of palabrasDeNombres) {
    limpia = limpia.replace(new RegExp(`\\b${escaparRegex(p)}\\b`, 'gi'), ' ')
  }
  limpia = limpia.replace(/\s+([.,;:])/g, '$1').replace(/\s+/g, ' ').trim()
  if (limpia.length > MAX_NOTA) limpia = limpia.slice(0, MAX_NOTA).replace(/\s+\S*$/, '') + '…'
  return limpia.length >= 25 ? limpia : null
}
