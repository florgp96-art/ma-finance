// Liquidación de un sueldo o un trabajo: el de la empleada (plata que se paga) o el de
// un trabajo propio (plata que se cobra). Solo cálculo, sin Supabase ni React (ver
// liquidacionDatos.js y components/Liquidacion.js).
//
// Se liquida de una de tres maneras (modalidad):
// - horas:   por día trabajado, con las tarifas del mes (lo de abajo).
// - mensual: un monto fijo por mes, que cada mes nuevo hereda del anterior.
// - unico:   un trabajo de una sola vez, con su monto y el mes en que se hizo.
//
// En "horas", cada día es de uno de dos tipos:
// - horas:   horas × valor_hora + viajes × valor_viatico
// - jornada: valor_jornada + horas × valor_hora + viajes × valor_viatico; acá
//            horas y viajes son los extras por encima de la jornada.
import { moverMes } from './repartoSocios'
import { parseMonto } from './formato'

export const TARIFAS_POR_DEFECTO = Object.freeze({ valor_hora: 7500, valor_viatico: 1200, valor_jornada: 25000 })
// Una liquidación nueva arranca sin tarifas: las de la empleada no tienen nada que ver
// con lo que cobra otro trabajo, y heredarlas daría un total que parece real.
export const TARIFAS_EN_CERO = Object.freeze({ valor_hora: 0, valor_viatico: 0, valor_jornada: 0 })

// Pago: la pagás vos (la empleada). Cobro: te la pagan (un trabajo tuyo).
export const TIPOS_DE_LIQUIDACION = ['pago', 'cobro']
export const LARGO_MAXIMO_NOMBRE = 60
export const NOMBRE_NUEVA = 'Nueva liquidación'

// El nombre que se guarda, o null si no sirve (vacío o demasiado largo).
export const nombreValido = (nombre) => {
  const limpio = String(nombre ?? '').replace(/\s+/g, ' ').trim()
  return limpio.length >= 1 && limpio.length <= LARGO_MAXIMO_NOMBRE ? limpio : null
}
export const MODALIDADES = ['horas', 'mensual', 'unico']
export const MONEDAS_LIQUIDACION = ['ARS', 'USD', 'EUR']

// En qué moneda se liquida (toda la liquidación, así el acumulado no mezcla monedas);
// sin la columna, en pesos.
export const monedaDe = (liquidacion) =>
  MONEDAS_LIQUIDACION.includes(liquidacion?.moneda) ? liquidacion.moneda : 'ARS'

// La de una liquidación; las de antes de poder elegir (o sin la columna) son por hora.
export const modalidadDe = (liquidacion) =>
  MODALIDADES.includes(liquidacion?.modalidad) ? liquidacion.modalidad : 'horas'

export const CAMPOS_TARIFA = Object.keys(TARIFAS_POR_DEFECTO)
export const TIPOS_DE_DIA = ['horas', 'jornada']

// Topes de validación. Las columnas aguantan más; esto frena un dedo de más.
export const LIMITES = Object.freeze({ horas: 24, viajes: 99, tarifa: 100000000, monto: 1000000000 })

export const claveValida = (clave) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(clave || ''))

export const mesDeHoy = (hoy = new Date()) =>
  `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`

export const diasDelMes = (clave) => {
  if (!claveValida(clave)) return 0
  const [anio, mes] = clave.split('-').map(Number)
  return new Date(anio, mes, 0).getDate()
}

// Número válido dentro de [min, max], o null. Acepta coma decimal ("2,5" → 2.5) y
// puntos de miles ("7.500" → 7500), ver parseMonto.
export const numeroValido = (valor, { min = 0, max = Infinity, entero = false } = {}) => {
  const n = parseMonto(valor)
  if (n === null || n < min || n > max) return null
  if (entero && !Number.isInteger(n)) return null
  return n
}

const cantidad = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export const tarifasDe = (mes) => Object.fromEntries(CAMPOS_TARIFA.map(c => [c, cantidad(mes?.[c])]))

export const subtotalDia = (dia, tarifas) => {
  const t = tarifasDe(tarifas)
  const base = dia?.tipo === 'jornada' ? t.valor_jornada : 0
  return base + cantidad(dia?.horas) * t.valor_hora + cantidad(dia?.viajes) * t.valor_viatico
}

const trabajado = (dia) => dia.tipo === 'jornada' || cantidad(dia.horas) > 0 || cantidad(dia.viajes) > 0

export const resumenMes = (dias, tarifas) => {
  const lista = Array.isArray(dias) ? dias : []
  return {
    total: lista.reduce((suma, d) => suma + subtotalDia(d, tarifas), 0),
    jornadas: lista.filter(d => d.tipo === 'jornada').length,
    horas: lista.reduce((suma, d) => suma + cantidad(d.horas), 0),
    viajes: lista.reduce((suma, d) => suma + cantidad(d.viajes), 0),
    // Dos filas del mismo día cuentan como un día trabajado.
    diasTrabajados: new Set(lista.filter(trabajado).map(d => d.dia)).size,
  }
}

// Por número de día; a igual día, el que se cargó primero.
export const ordenarDias = (dias) => [...(dias || [])].sort((a, b) =>
  a.dia - b.dia || String(a.created_at || '').localeCompare(String(b.created_at || '')))

// La fila que agrega "Sumar un día": el día siguiente al último cargado, con su tipo.
export const nuevoDia = (dias, clave) => {
  const ultimo = ordenarDias(dias).at(-1)
  const tope = diasDelMes(clave) || 31
  return {
    dia: ultimo ? Math.min(ultimo.dia + 1, tope) : 1,
    tipo: ultimo?.tipo === 'jornada' ? 'jornada' : 'horas',
    horas: 0,
    viajes: 0,
  }
}

// Un mes nuevo arranca con las tarifas del último mes anterior que exista; si no hay
// ninguno, con `porDefecto`.
export const tarifasHeredadas = (meses, clave, porDefecto = TARIFAS_POR_DEFECTO) => {
  const anterior = (meses || []).filter(m => m.clave < clave).sort((a, b) => b.clave.localeCompare(a.clave))[0]
  return anterior ? tarifasDe(anterior) : { ...porDefecto }
}

// El mes que se abre al entrar (y después de cerrar uno): el primero abierto
// después del último cerrado; si no hay, el siguiente al último cerrado. Un mes
// viejo que se reabrió para corregir no cuenta, y tampoco uno futuro que se
// creó solo por mirarlo con el selector.
export const mesParaAbrir = (meses, hoy = mesDeHoy()) => {
  const ordenados = [...(meses || [])].sort((a, b) => a.clave.localeCompare(b.clave))
  const ultimoCerrado = ordenados.filter(m => m.cerrado).at(-1)?.clave
  if (!ultimoCerrado && ordenados.some(m => m.clave === hoy)) return hoy
  const abierto = ordenados.find(m => !m.cerrado && (!ultimoCerrado || m.clave > ultimoCerrado))
  if (abierto) return abierto.clave
  return ultimoCerrado ? moverMes(ultimoCerrado, 1) : hoy
}

// Un mes nuevo de una liquidación mensual arranca con el monto del último mes
// anterior; uno por hora o un trabajo único, en cero.
export const montoHeredado = (meses, clave, modalidad) => {
  if (modalidad !== 'mensual') return 0
  const anterior = (meses || []).filter(m => m.clave < clave).sort((a, b) => b.clave.localeCompare(a.clave))[0]
  return anterior ? cantidad(anterior.monto) : 0
}

// El trabajo único vive en un solo mes: el último que tenga (si se pasó de otra
// modalidad puede tener varios), o el de hoy si todavía no tiene ninguno.
export const mesDelTrabajo = (meses, hoy = mesDeHoy()) =>
  [...(meses || [])].map(m => m.clave).sort().at(-1) || hoy

// Cerrado: el total guardado. Abierto: el monto (mensual o trabajo único) o la suma
// de los días (por hora). Un mes por hora sin días que ya tenía total (los cargados
// solo con el total, de antes de esta pantalla) lo conserva, así reabrirlo y volver
// a cerrarlo no lo deja en cero.
export const totalDelMes = (mes, dias, modalidad = 'horas') => {
  if (mes?.cerrado) return cantidad(mes.total_cerrado)
  if (modalidad !== 'horas') return cantidad(mes?.monto)
  const lista = Array.isArray(dias) ? dias : []
  if (lista.length === 0 && cantidad(mes?.total_cerrado) > 0) return cantidad(mes.total_cerrado)
  return resumenMes(lista, mes).total
}

// Los ingresos a futuro (lib/ingresosFuturos.js) que se esperan en el mes `clave`.
export const ingresosDelMes = (ingresos, clave) =>
  (ingresos || []).filter(e => String(e.fecha || '').slice(0, 7) === clave)

// El total de un mes, por moneda. Es el de la liquidación (monto o días); si no tiene,
// la suma de sus ingresos a futuro del mes, que es como se cargan varios trabajos en
// monedas distintas. Nunca los dos juntos: anotar el cobro de lo que ya dice la
// liquidación lo contaría dos veces.
export const totalesDelMes = (totalPropio, moneda, ingresos) => {
  if (cantidad(totalPropio) > 0 || !(ingresos || []).length) return { [moneda]: cantidad(totalPropio) }
  return sumarPorMoneda(ingresos.map(e => ({ [MONEDAS_LIQUIDACION.includes(e.moneda) ? e.moneda : 'ARS']: cantidad(e.monto) })))
}

export const sumarPorMoneda = (lista) => (lista || []).reduce((suma, porMoneda) => {
  Object.entries(porMoneda || {}).forEach(([m, n]) => { suma[m] = (suma[m] || 0) + cantidad(n) })
  return suma
}, {})

export const historialCerrados = (meses) => {
  const cerrados = (meses || []).filter(m => m.cerrado)
    .sort((a, b) => b.clave.localeCompare(a.clave))
    .map(m => ({ id: m.id, clave: m.clave, total: cantidad(m.total_cerrado) }))
  return { meses: cerrados, acumulado: cerrados.reduce((suma, m) => suma + m.total, 0) }
}

// numeric(14,2) en la base: se guarda redondeado a centavos.
export const aCentavos = (n) => Math.round(cantidad(n) * 100) / 100
