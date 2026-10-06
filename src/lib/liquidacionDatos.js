// Lectura y escritura de las liquidaciones en Supabase (tablas liquidaciones,
// liquidacion_meses y liquidacion_dias; ver docs/PENDIENTES.md). Cada función devuelve
// la promesa de Supabase, { data, error }: quien llama decide qué hacer con el error.
import { supabase } from './supabase'

const COLUMNAS_LIQUIDACION = 'id, nombre, tipo, created_at'
const COLUMNAS_MES = 'id, liquidacion_id, clave, valor_hora, valor_viatico, valor_jornada, cerrado, total_cerrado'
const COLUMNAS_DIA = 'id, mes_id, dia, tipo, horas, viajes, created_at'

// El id de las filas nuevas se arma acá para poder mostrarlas (y editarlas) antes
// de que vuelva el insert.
export const nuevoId = () => {
  const cripto = typeof window !== 'undefined' ? window.crypto : undefined
  if (cripto?.randomUUID) return cripto.randomUUID()
  const bytes = new Uint8Array(16)
  if (cripto?.getRandomValues) cripto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const ahoraISO = () => new Date().toISOString()

// En el orden en que se crearon: la primera (la de siempre) queda arriba.
export const leerLiquidaciones = (userId) =>
  supabase.from('liquidaciones').select(COLUMNAS_LIQUIDACION).eq('user_id', userId)
    .order('created_at').order('id')

export const crearLiquidacion = ({ id, user_id, nombre, tipo }) =>
  supabase.from('liquidaciones').insert({ id, user_id, nombre, tipo }).select(COLUMNAS_LIQUIDACION).single()

export const actualizarLiquidacion = (id, cambios) =>
  supabase.from('liquidaciones').update(cambios).eq('id', id)

// Se lleva sus meses y los días de esos meses (on delete cascade).
export const borrarLiquidacion = (id) =>
  supabase.from('liquidaciones').delete().eq('id', id)

export const leerMeses = (liquidacionId) =>
  supabase.from('liquidacion_meses').select(COLUMNAS_MES).eq('liquidacion_id', liquidacionId).order('clave')

export const leerDias = (mesId) =>
  supabase.from('liquidacion_dias').select(COLUMNAS_DIA).eq('mes_id', mesId).order('dia').order('created_at')

export const crearMes = (mes) =>
  supabase.from('liquidacion_meses').insert(mes).select(COLUMNAS_MES).single()

export const leerMesPorClave = (liquidacionId, clave) =>
  supabase.from('liquidacion_meses').select(COLUMNAS_MES).eq('liquidacion_id', liquidacionId).eq('clave', clave).maybeSingle()

export const actualizarMes = (id, cambios) =>
  supabase.from('liquidacion_meses').update({ ...cambios, updated_at: ahoraISO() }).eq('id', id)

export const insertarDia = ({ id, mes_id, dia, tipo, horas, viajes }) =>
  supabase.from('liquidacion_dias').insert({ id, mes_id, dia, tipo, horas, viajes })

export const actualizarDia = (id, cambios) =>
  supabase.from('liquidacion_dias').update(cambios).eq('id', id)

export const borrarDia = (id) =>
  supabase.from('liquidacion_dias').delete().eq('id', id)

// Ingresos a futuro (ver lib/ingresosFuturos.js). Se leen todos los de la persona, no
// solo los de una liquidación: un mismo ingreso de una cuenta no puede tachar dos
// esperados de liquidaciones distintas.
const COLUMNAS_INGRESO_FUTURO = 'id, liquidacion_id, concepto, monto, moneda, fecha, cobrado_a_mano, created_at'

export const leerIngresosFuturos = (userId) =>
  supabase.from('ingresos_futuros').select(COLUMNAS_INGRESO_FUTURO).eq('user_id', userId).order('fecha').order('id')

export const crearIngresoFuturo = ({ id, user_id, liquidacion_id, concepto, monto, moneda, fecha }) =>
  supabase.from('ingresos_futuros').insert({ id, user_id, liquidacion_id, concepto, monto, moneda, fecha })
    .select(COLUMNAS_INGRESO_FUTURO).single()

export const actualizarIngresoFuturo = (id, cambios) =>
  supabase.from('ingresos_futuros').update(cambios).eq('id', id)

export const borrarIngresoFuturo = (id) =>
  supabase.from('ingresos_futuros').delete().eq('id', id)

// Los ingresos cargados en las cuentas desde `desde`, para tachar los que ya entraron.
export const leerIngresosDeCuentas = (userId, desde) =>
  supabase.from('transactions').select('id, tipo, fecha, nombre, detalle, tag, monto, moneda, pendiente, accounts(nombre)')
    .eq('user_id', userId).eq('tipo', 'ingreso').gte('fecha', desde).order('fecha')
