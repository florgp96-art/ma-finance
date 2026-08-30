import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { esAlquilerOExpensas, addMeses, esCuota, cuotaEnCiclo } from '../lib/cuotas'
import { semaforo } from '../theme'

// "Hoy"/"mes actual" en hora LOCAL, no UTC — con Argentina en UTC-3,
// toISOString() adelanta el día/mes ~3hs antes de tiempo entre las 21:00 y
// las 23:59 del último día de cada mes.
const hoyLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const mesActualLocal = () => hoyLocal().slice(0, 7)

// Colores espaciados ~26° en el círculo de matices (14 categorías, 360°/14) en vez de
// variantes del mismo violeta/lavanda — así "Personal" y "Transporte", por ejemplo, se
// distinguen a simple vista en vez de verse como el mismo tono. "A Identificar" queda
// aparte, en un gris cálido neutro, para que se lea como "todavía sin clasificar" y no
// como una categoría más de la rueda.
export const CATEGORY_CONFIG = {
  'Comida':          { icon: '🍴', color: 'hsl(0, 55%, 79%)' },
  'Personal':        { icon: '👤', color: 'hsl(26, 55%, 83%)' },
  'Transporte':      { icon: '🚗', color: 'hsl(51, 55%, 79%)' },
  'Salud':           { icon: '💊', color: 'hsl(77, 50%, 83%)' },
  'Entretenimiento': { icon: '🎬', color: 'hsl(103, 45%, 79%)' },
  'Suscripciones':   { icon: '📱', color: 'hsl(129, 45%, 83%)' },
  'Ropa':            { icon: '👕', color: 'hsl(154, 45%, 79%)' },
  'Casa':            { icon: '🏠', color: 'hsl(180, 45%, 83%)' },
  'Educación':       { icon: '📚', color: 'hsl(206, 50%, 79%)' },
  'Trabajo':         { icon: '💼', color: 'hsl(231, 50%, 83%)' },
  'Ingresos':        { icon: '💰', color: 'hsl(257, 50%, 79%)' },
  'Débitos':         { icon: '🏦', color: 'hsl(283, 45%, 83%)' },
  'Hijos':           { icon: '👩‍👧‍👧', color: 'hsl(309, 50%, 79%)' },
  'A Identificar':   { icon: '❓', color: 'hsl(40, 20%, 80%)' },
}

const BAR_COLOR = '#5C4F5C'
// Identidad por categoría de ingreso — mismo criterio que CATEGORY_CONFIG (icono +
// color propio espaciado en el círculo de matices, corrido 13° respecto de
// CATEGORY_CONFIG para no repetir tonos entre gasto e ingreso). Los nombres tienen
// que matchear exactamente el nombre de la subcategoría real bajo "Ingresos" (ver
// subcategoriasDeIngreso); cualquier categoría que no esté acá cae al color
// determinístico de colorDeterministico (más abajo), así que una categoría nueva en
// la base nunca rompe nada ni cambia de color entre sesiones.
export const INCOME_CATEGORY_CONFIG = {
  'Mama':                          { icon: '👩', color: 'hsl(13, 55%, 81%)' },
  'Cuota Alimentaria':             { icon: '👶', color: 'hsl(90, 45%, 85%)' },
  'Freelance':                     { icon: '💻', color: 'hsl(116, 45%, 81%)' },
  'Moms Food':                     { icon: '🍲', color: 'hsl(142, 45%, 85%)' },
  'Reintegros':                    { icon: '🔄', color: 'hsl(167, 45%, 81%)' },
  'Sueldo':                        { icon: '💼', color: 'hsl(193, 50%, 85%)' },
  'Alquileres':                    { icon: '🏠', color: 'hsl(219, 50%, 81%)' },
  'Inversiones':                   { icon: '📈', color: 'hsl(245, 50%, 85%)' },
  'Negocio propio':                { icon: '🏪', color: 'hsl(270, 45%, 81%)' },
  'Prestamo':                      { icon: '🤝', color: 'hsl(296, 45%, 85%)' },
  'Devoluciones':                  { icon: '↩️', color: 'hsl(322, 50%, 81%)' },
  'Otros':                         { icon: '📦', color: 'hsl(30, 15%, 80%)' },
}

// Hash simple y estable (mismo string → mismo número siempre, en cualquier sesión o
// pantalla) para asignarle un matiz del círculo completo (360°) a cualquier nombre que
// no tenga color propio en CATEGORY_CONFIG/INCOME_CATEGORY_CONFIG — subcategorías
// (que nunca tuvieron color propio), hijos/personas, o una categoría nueva todavía sin
// mapear a mano. Saturación/luminosidad fijas para que quede en la misma familia visual
// (pastel, texto oscuro legible encima) que el resto de la paleta.
const hashNombre = (s) => {
  const str = String(s || '')
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}
export const colorDeterministico = (nombre) => `hsl(${hashNombre(nombre) % 360}, 50%, 81%)`

// Única fuente de color/ícono por categoría o subcategoría en toda la app (Donut,
// Barras, lineal de evolución, leyendas, chips) — antes cada pantalla resolvía esto
// por su cuenta (paletas rotando por índice, mapas de "extraConfig" separados por
// vista), así que el mismo concepto podía verse con colores distintos en Ingresos vs.
// una cuenta vs. Hijos. isIncome: true busca primero en INCOME_CATEGORY_CONFIG (así se
// pintan los tags/subcategorías de "Ingresos"); false/default busca en CATEGORY_CONFIG
// (categorías/subcategorías de gasto). Cualquier nombre sin mapeo manual (incluidas
// subcategorías y personas/hijos, que nunca tuvieron mapeo) cae en
// colorDeterministico, así que queda estable entre sesiones y pantallas igual.
export const resolveCategoryColor = (nombre, { isIncome = false } = {}) =>
  (isIncome ? INCOME_CATEGORY_CONFIG[nombre]?.color : CATEGORY_CONFIG[nombre]?.color) || colorDeterministico(nombre)
export const resolveCategoryIcon = (nombre, { isIncome = false, customIcons, defaultIcon } = {}) =>
  customIcons?.[nombre]
  || (isIncome ? (INCOME_CATEGORY_CONFIG[nombre]?.icon || CATEGORY_CONFIG[nombre]?.icon) : CATEGORY_CONFIG[nombre]?.icon)
  || defaultIcon
  || (isIncome ? '💰' : '❓')

// Desglosa el reparto de una transacción (guardado en t.reparto, ver D1/D2/D3)
// en la parte de cada participante + la parte implícita de "vos" (monto total
// menos la suma de las partes de los demás — nunca se guarda una fila aparte
// por participante). Devuelve null si la transacción no está repartida.
// El porcentaje se toma de t.reparto si está (reglas nuevas), o se deriva del
// monto para reparto viejo que no lo guardó (compatibilidad con D1).
export const desglosarReparto = (t) => {
  const participantes = t?.reparto?.participantes
  if (!participantes || participantes.length === 0) return null
  const monto = Number(t.monto) || 0
  const otros = participantes.map(p => {
    const pMonto = Number(p.monto) || 0
    return {
      nombre: p.nombre,
      monto: pMonto,
      porcentaje: p.porcentaje != null ? Number(p.porcentaje) : (monto > 0 ? Math.round((pMonto / monto) * 1000) / 10 : 0),
    }
  })
  const montoOtros = otros.reduce((s, p) => s + p.monto, 0)
  const yo = {
    nombre: 'Vos',
    monto: Math.round((monto - montoOtros) * 100) / 100,
    porcentaje: Math.round((100 - otros.reduce((s, p) => s + p.porcentaje, 0)) * 10) / 10,
  }
  return { yo, otros, monto }
}

export const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// Estilo compartido para rótulos/etiquetas (tabs de navegación, títulos de widget,
// encabezados de sección): mayúsculas parejas (todas las letras a la misma
// altura) con letter-spacing leve para que respiren. Antes usaba font-variant:
// small-caps, pero eso deja la PRIMERA letra más grande que el resto ("Rᴇsúᴍᴇɴ" en
// vez de "RESUMEN") — no es el efecto buscado. Nunca en montos, nombres propios
// (categorías, hijos, comercios, cuentas), datos ingresados por el usuario, ni
// texto de párrafo.
export const rotuloLabel = { textTransform: 'uppercase', letterSpacing: '0.05em' }

// Nombre visible de cada columna filtrable, para los chips de "filtros activos".
const ETIQUETA_COLUMNA = {
  nombre: 'Nombre', categoria: 'Categoría', cuenta: 'Cuenta',
  subcategoria: 'Subcategoría', cuotas: 'Cuotas', moneda: 'Moneda',
}

export const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(monto)

export const formatMontoFull = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)

export const formatFecha = (f) => f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : ''

// Fecha corta para las tablas de movimientos. Se omite el año SOLO si es del año
// en curso: mezclado con movimientos viejos, "28/06" no dice de qué año es (y en
// una lista con cosas de 2023 y de hoy eso es directamente confuso). En ese caso
// se agrega el año en dos dígitos, que entra en el ancho de columna existente.
export const formatFechaCorta = (f) => {
  if (!f) return ''
  const corta = f.slice(8, 10) + '/' + f.slice(5, 7)
  const esDeEsteAnio = f.slice(0, 4) === String(new Date().getFullYear())
  return esDeEsteAnio ? corta : corta + '/' + f.slice(2, 4)
}

// Única fuente de verdad para "categoría de un ingreso": la subcategoría real de la
// categoría "Ingresos" en la base (categories/subcategories) — la usan por igual el
// modal "Cargar movimiento", la edición inline de la tabla y cualquier otra pantalla
// que ofrezca esta lista, para que nunca vuelvan a divergir. Nada de tags de texto
// libre ni listas hardcodeadas: si se agrega una subcategoría nueva en la base,
// aparece sola en todos lados.
export const subcategoriasDeIngreso = (categorias, subcategorias) => {
  const catIngresos = (categorias || []).find(c => c.nombre === 'Ingresos' && (c.tipo || 'gasto') === 'ingreso')
  if (!catIngresos) return []
  return (subcategorias || []).filter(s => s.category_id === catIngresos.id)
}

// TC para un movimiento histórico en USD: prioriza el promedio del MES de ese
// movimiento (tcMap, ya filtrado por el tipo de dólar elegido — blue/oficial/
// tarjeta/etc. — así que un cambio de tipo se refleja también en datos viejos,
// nunca se queda pegado a un tipo congelado). Si no hay promedio cargado para
// ese mes, cae al TC que tenía configurado el movimiento al cargarse (fx_rate)
// — mejor aproximación que el TC de HOY para algo viejo — y solo como último
// recurso (o si es el mes actual) usa el TC vigente.
export const tcDeMovimiento = (t, tcMap, tipoCambioActual) => {
  const mesActual = mesActualLocal()
  const mesTx = t.fecha?.slice(0, 7)
  if (!mesTx || mesTx === mesActual) return parseFloat(tipoCambioActual) || 0
  if (tcMap && tcMap[mesTx]) return Number(tcMap[mesTx])
  if (t.fx_rate) return Number(t.fx_rate)
  return parseFloat(tipoCambioActual) || 0
}

// Mismo criterio que tcDeMovimiento, para EUR: el euro no tiene fx_rate propio
// congelado por movimiento (solo el dólar se guarda al cargar), así que cae
// directo del promedio del mes al TC vigente, sin ese paso intermedio.
export const tcEURDeMovimiento = (t, tcMapEUR, tipoCambioEURActual) => {
  const mesActual = mesActualLocal()
  const mesTx = t.fecha?.slice(0, 7)
  if (!mesTx || mesTx === mesActual) return parseFloat(tipoCambioEURActual) || 0
  if (tcMapEUR && tcMapEUR[mesTx]) return Number(tcMapEUR[mesTx])
  return parseFloat(tipoCambioEURActual) || 0
}

// Texto de tooltip con el TC usado para el equivalente en ARS de un movimiento en USD.
export const tcTooltipDe = (tx, tcMap, tipoCambioActual) => {
  if (tx.moneda !== 'USD') return undefined
  const tc = tcDeMovimiento(tx, tcMap, tipoCambioActual)
  if (tc <= 0) return undefined
  return `U$S ${formatMonto(Math.abs(Number(tx.monto)))} · TC $ ${formatMontoFull(tc)} = $ ${formatMonto(Math.abs(Number(tx.monto)) * tc)}`
}

// Un nombre de reparto puede venir escrito a mano (reglas, modal manual) y no
// coincidir en mayúsculas/minúsculas con el nombre real del hijo en la base —
// se normaliza contra la lista de hijos para que sea siempre la misma entrada
// en cualquier agregación, en vez de duplicarse por un "amelia" vs "Amelia".
const normalizarNombrePersona = (nombre, children) => {
  if (!nombre) return nombre
  const match = (children || []).find(c => (c.nombre || '').toLowerCase() === nombre.toLowerCase())
  return match ? match.nombre : nombre
}

// Descompone UN gasto en sus porciones — una por cada persona con reparto o
// asignación directa (child_id/tag), y el resto (la parte de "vos", o el
// gasto entero si no hay reparto ni asignación) a su categoría/subcategoría —
// cada monto ya convertido a ARS con el TC propio del movimiento
// (tcDeMovimiento/tcEURDeMovimiento, nunca el TC de hoy para algo viejo).
// Es la ÚNICA función que debe alimentar cualquier vista de composición de
// gastos (donut, barras, "Categorías Top", evolución, agrupado por persona):
// así es imposible que dos vistas den números distintos para el mismo dato.
// La asignación directa (child_id/tag) tiene prioridad sobre el reparto si
// una transacción tuviera las dos cosas a la vez — mismo criterio que ya usa
// HijoDetail al traer los movimientos de un hijo.
export const derivarPorcionesGasto = (t, { tcMap, tipoCambio, tcMapEUR, tipoCambioEUR, children } = {}) => {
  if (!t || t.tipo !== 'gasto') return []
  const montoTotal = Number(t.monto) || 0
  if (montoTotal <= 0) return []
  const aArs = (monto) => {
    if (!t.moneda || t.moneda === 'ARS') return monto
    if (t.moneda === 'USD') { const tc = tcDeMovimiento(t, tcMap, tipoCambio); return tc > 0 ? monto * tc : 0 }
    if (t.moneda === 'EUR') { const tc = tcEURDeMovimiento(t, tcMapEUR, tipoCambioEUR); return tc > 0 ? monto * tc : 0 }
    return monto
  }
  const categoria = t.categories?.nombre || 'A Identificar'
  const subcategoria = t.subcategories?.nombre || null
  // El fallback a "tag" es del modelo viejo (reparto a mano escribiendo el
  // nombre del hijo antes de que existiera child_id) — pero "tag" también se
  // usa para etiquetas de ingreso tipo "Cuota Alimentaria Faustina" (ver
  // inferirTagIngreso en Dashboard.js), y si esa etiqueta quedó en un gasto
  // (a mano, por una regla, o un dato viejo) se mostraba como si fuera una
  // persona nueva llamada "Cuota Alimentaria Faustina" en vez de ir a su
  // categoría real. Por eso el tag solo cuenta como asignación directa a un
  // hijo si coincide con el nombre real de alguno de los hijos registrados.
  const tagEsHijo = t.tag && (children || []).some(c => (c.nombre || '').toLowerCase() === t.tag.toLowerCase())
  const childDirecto = t.children?.nombre || (tagEsHijo ? t.tag : null)
  if (childDirecto) {
    return [{ tipo: 'persona', nombre: normalizarNombrePersona(childDirecto, children), monto: aArs(montoTotal) }]
  }
  const reparto = desglosarReparto(t)
  if (reparto) {
    const partes = reparto.otros
      .filter(p => p.monto > 0)
      .map(p => ({ tipo: 'persona', nombre: normalizarNombrePersona(p.nombre, children), monto: aArs(p.monto) }))
    if (reparto.yo.monto > 0) partes.push({ tipo: 'yo', categoria, subcategoria, monto: aArs(reparto.yo.monto) })
    return partes
  }
  return [{ tipo: 'yo', categoria, subcategoria, monto: aArs(montoTotal) }]
}

// Agrega una lista de gastos por categoría, con los hijos como entradas
// propias (su reparto/asignación sale de la categoría real, no se duplica) —
// alimenta el donut, las barras y "Categorías Top" por igual.
export const agregarGastosPorCategoria = (txs, tcParams) => {
  const acc = {}
  ;(txs || []).forEach(t => {
    derivarPorcionesGasto(t, tcParams).forEach(parte => {
      const esPersona = parte.tipo === 'persona'
      const nombre = esPersona ? parte.nombre : parte.categoria
      if (!acc[nombre]) acc[nombre] = { name: nombre, value: 0, tipo: esPersona ? 'persona' : 'categoria' }
      acc[nombre].value += parte.monto
    })
  })
  return Object.values(acc).sort((a, b) => b.value - a.value)
}

// Agrega por subcategoría DENTRO de una categoría — no incluye a los hijos
// (su parte ya salió de la categoría en agregarGastosPorCategoria).
export const agregarGastosPorSubcategoria = (txs, categoriaNombre, tcParams) => {
  const acc = {}
  ;(txs || []).forEach(t => {
    derivarPorcionesGasto(t, tcParams).forEach(parte => {
      if (parte.tipo !== 'yo' || parte.categoria !== categoriaNombre) return
      const nombre = parte.subcategoria || 'Sin subcategoría'
      acc[nombre] = (acc[nombre] || 0) + parte.monto
    })
  })
  return Object.entries(acc).sort((a, b) => b[1] - a[1])
}

// Agrega por persona: cada hijo con TODAS sus porciones (reparto o asignación
// directa), sin importar de qué categoría vengan, más una entrada "Personal"
// con el resto (la parte de "vos" y los gastos sin reparto ni asignación).
export const agregarGastosPorPersona = (txs, tcParams) => {
  const acc = {}
  ;(txs || []).forEach(t => {
    derivarPorcionesGasto(t, tcParams).forEach(parte => {
      const nombre = parte.tipo === 'persona' ? parte.nombre : 'Personal'
      if (!acc[nombre]) acc[nombre] = { name: nombre, value: 0 }
      acc[nombre].value += parte.monto
    })
  })
  return Object.values(acc).sort((a, b) => b.value - a.value)
}

// Totales ARS / USD / EUR / unificado en ARS de una lista de movimientos — pensado
// para reflejar EXACTAMENTE las filas visibles después de aplicar los filtros
// activos (búsqueda, rango de fechas, categoría, etc.) en cualquier tabla de
// movimientos. El unificado convierte cada USD/EUR con tcDeMovimiento/
// tcEURDeMovimiento (promedio del mes/tipo elegido, nunca el TC de hoy para algo
// viejo). Ningún movimiento se descarta en silencio: si no hay TC resoluble para
// convertirlo, queda afuera del unificado pero se avisa por consola (dev).
export const totalesDeLista = (txs, tcMap, tipoCambioActual, tcMapEUR, tipoCambioEURActual, { signed = true } = {}) => {
  let ars = 0, usd = 0, eur = 0, unificado = 0
  ;(txs || []).forEach(t => {
    const monto = Number(t.monto) || 0
    const signo = !signed ? 1 : (t.tipo === 'ingreso' ? 1 : -1)
    if (t.moneda === 'USD') {
      const tc = tcDeMovimiento(t, tcMap, tipoCambioActual)
      usd += signo * monto
      if (tc > 0) unificado += signo * monto * tc
      else if (monto !== 0 && process.env.NODE_ENV !== 'production') console.warn('totalesDeLista: sin TC para convertir movimiento USD', t.id, t.fecha)
    } else if (t.moneda === 'EUR') {
      const tcE = tcEURDeMovimiento(t, tcMapEUR, tipoCambioEURActual)
      eur += signo * monto
      if (tcE > 0) unificado += signo * monto * tcE
      else if (monto !== 0 && process.env.NODE_ENV !== 'production') console.warn('totalesDeLista: sin TC para convertir movimiento EUR', t.id, t.fecha)
    } else if (t.moneda === 'ARS') {
      ars += signo * monto
      unificado += signo * monto
    }
  })
  return { ars, usd, eur, unificado }
}

// Pie de tabla reutilizable con el total en vivo de lo que se ve — mobile-first,
// nunca más de 2 líneas (ver tarea 3). signed=false para listas de un solo signo
// (ej. gastos de un hijo), donde no tiene sentido mostrar el total en negativo.
function TotalesFooterImpl({ txs, tcMap, tipoCambio, tcMapEUR, tipoCambioEUR, darkMode, colSpan, signed = true }) {
  const { ars, usd, eur, unificado } = totalesDeLista(txs, tcMap, tipoCambio, tcMapEUR, tipoCambioEUR, { signed })
  if (Math.round(ars) === 0 && Math.round(usd * 100) === 0 && Math.round(eur * 100) === 0) return null
  const monedasConMonto = [ars, usd, eur].filter(v => Math.round(v * 100) !== 0).length
  const hayMultiples = monedasConMonto > 1
  const sem = semaforo(darkMode)
  return (
    <tfoot>
      <tr>
        <td colSpan={colSpan} style={{ padding: 0, borderTop: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}` }}>
          <div style={{
            padding: '10px 10px', fontSize: '12px', fontWeight: '600',
            color: darkMode ? '#F0EDEC' : '#1d1d1f',
            display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline'
          }}>
            <span style={{ fontWeight: '400', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel, fontSize: '10px' }}>Total</span>
            {Math.round(ars) !== 0 && <span>$ {formatMonto(ars)}</span>}
            {Math.round(usd * 100) !== 0 && <span style={{ color: sem.usd }}>U$S {formatMontoFull(usd)}</span>}
            {Math.round(eur * 100) !== 0 && <span style={{ color: sem.positivo }}>€ {formatMontoFull(eur)}</span>}
            {hayMultiples && <span style={{ color: darkMode ? '#9A8A9A' : '#75757a', fontWeight: '500' }}>≈ $ {formatMonto(unificado)} unificado</span>}
          </div>
        </td>
      </tr>
    </tfoot>
  )
}
export const TotalesFooter = React.memo(TotalesFooterImpl)

// Ícono ⓘ discreto junto a un título de gráfico: abre el detalle (moneda, TC,
// qué incluye/excluye) con TAP en mobile y con hover en desktop (no con :hover
// de CSS, que en touch no existe) — se cierra tocando afuera. Reemplaza el
// patrón anterior de title= nativo, que en mobile no se podía abrir.
export function InfoTooltip({ text, darkMode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const hoverCapaz = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches
  useEffect(() => {
    if (!open) return
    const cerrarSiAfuera = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', cerrarSiAfuera)
    document.addEventListener('touchstart', cerrarSiAfuera)
    return () => {
      document.removeEventListener('mousedown', cerrarSiAfuera)
      document.removeEventListener('touchstart', cerrarSiAfuera)
    }
  }, [open])
  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', marginLeft: '6px', verticalAlign: 'middle' }}
      onMouseEnter={hoverCapaz ? () => setOpen(true) : undefined}
      onMouseLeave={hoverCapaz ? () => setOpen(false) : undefined}
    >
      <button
        type="button"
        aria-label="Más información"
        onClick={(e) => { e.stopPropagation(); if (!hoverCapaz) setOpen(o => !o) }}
        style={{
          width: '15px', height: '15px', borderRadius: '50%', padding: 0, boxSizing: 'border-box',
          border: `1px solid ${darkMode ? '#8A7A8A' : '#75757a'}`, background: 'none',
          color: darkMode ? '#9A8A9A' : '#75757a', fontSize: '10px', lineHeight: '13px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'help', fontFamily: 'Georgia, serif', fontStyle: 'italic',
          textTransform: 'none', letterSpacing: 'normal', fontWeight: '400',
        }}
      >i</button>
      {open && (
        <div style={{
          position: 'absolute', top: '20px', right: 0, zIndex: 60, minWidth: '200px', maxWidth: '260px',
          padding: '8px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '400',
          textTransform: 'none', letterSpacing: 'normal', lineHeight: '1.4', textAlign: 'left',
          backgroundColor: darkMode ? '#2A232A' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f',
          border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}

// Ancho real del contenedor de una tabla de movimientos (ResizeObserver, no
// el ancho de la ventana): el mismo componente se renderiza a veces con
// sidebar de cuentas + widgets al lado y a veces solo, así que dos tablas en
// la misma ventana pueden tener espacio disponible bien distinto. Devuelve
// [ref, width] — poner el ref en el contenedor de la tabla.
export const useContainerWidth = (fallback = 900) => {
  // Callback ref (no useRef + effect con deps []) a propósito: el contenedor real
  // recién existe cuando termina "Cargando datos..." — con un useRef normal, el
  // efecto de montaje corre ANTES de eso (ref.current todavía null), se cancela
  // sola, y como las deps nunca cambian nunca se vuelve a intentar: el ancho queda
  // pegado en el fallback para siempre y la tabla termina mostrando de más
  // columnas de las que entran. El callback ref se vuelve a disparar cuando React
  // por fin adjunta el nodo real, así que el observer siempre llega a armarse.
  const [el, setEl] = useState(null)
  const [width, setWidth] = useState(fallback)
  const ref = useCallback((node) => setEl(node), [])
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width
      if (w) setWidth(w)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [el])
  return [ref, width]
}

// Columnas progresivas de una tabla de movimientos, de las que siempre se ven
// (fecha/nombre/monto) a las que se van agregando con más espacio, en este
// orden de prioridad: categoría → cuenta → subcategoría → cuotas. Nunca
// scroll horizontal ni columnas comprimidas hasta partir texto — si no
// entra, se oculta y se ve solo en la fila expandida.
export const columnasVisibles = (width) => ({
  categoria: width >= 460,
  cuenta: width >= 580,
  subcategoria: width >= 700,
  cuotas: width >= 820,
})

// Reparte en px el espacio "de texto" de una tabla de movimientos (nombre +
// categoría/cuenta/subcategoría cuando están visibles) según un peso relativo —
// nombre pesa más que las demás pero, a diferencia de un <col /> sin width (que
// antes se llevaba TODO el sobrante y dejaba un hueco enorme en pantallas
// anchas), queda topeado por su peso. 'disponible' es el ancho de la tabla
// (tablaWidth, medido con useContainerWidth) menos las columnas de ancho fijo
// de ESA tabla (fecha/monto/cuotas/expandir — su contenido no depende del ancho
// de pantalla, así que no van a %). 'pesos' es { claveDeColVisible: peso }; una
// clave sin colVisible[clave] === false se toma como siempre visible.
export const repartirAnchoTexto = (disponible, colVisible, pesos) => {
  const pesoTotal = Object.entries(pesos).reduce((s, [k, p]) => s + (colVisible[k] === false ? 0 : p), 0)
  const pxPorPeso = pesoTotal > 0 ? Math.max(0, disponible) / pesoTotal : 0
  return Object.fromEntries(Object.entries(pesos).map(([k, p]) => [k, colVisible[k] === false ? 0 : Math.round(p * pxPorPeso)]))
}

const monedaSymbol = (moneda) => moneda === 'USD' ? 'U$S' : moneda === 'EUR' ? '€' : '$'
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// El PDF de un resumen no siempre trae la fecha de cierre/facturación (fecha_hasta) —
// cuando falta, se aproxima restándole al vencimiento la brecha típica entre el cierre
// y el vencimiento de una tarjeta (~7 días), en vez de usar el vencimiento tal cual
// (que haría creer que la tarjeta cierra el mismo día que vence).
const DIAS_CIERRE_A_VENCIMIENTO = 7
const restarDiasISO = (fechaISO, dias) => {
  const d = new Date(fechaISO + 'T00:00:00')
  d.setDate(d.getDate() - dias)
  // El string se arma a mano y no con toISOString(), que convierte a UTC: la
  // medianoche local de una zona con offset positivo (ej. España, UTC+2) cae el
  // día anterior en UTC, así que ahí restaba un día de más.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Las fechas que llegan de la DB/PDF a veces traen espacios o caracteres de más (ej. un
// parseo con espacios sobrantes) — eso rompe en silencio cualquier comparación de string
// (`<`, `>`) sin que se note a simple vista, porque al mostrarse en pantalla no se ve la
// diferencia. Siempre se normaliza a los 10 caracteres YYYY-MM-DD antes de comparar.
export const normFecha = (f) => (f || '').trim().slice(0, 10)
// fecha_hasta solo es confiable si es efectivamente ANTERIOR al vencimiento (un cierre
// nunca puede caer en o después de la fecha límite de pago) — si el parseo del PDF la
// dejó igual o posterior a fecha_vencimiento, se descarta y se usa la aproximación.
export const cierreDe = (s) => {
  const hasta = normFecha(s.fecha_hasta)
  const venc = normFecha(s.fecha_vencimiento)
  if (hasta && (!venc || hasta < venc)) return hasta
  return venc ? restarDiasISO(venc, DIAS_CIERRE_A_VENCIMIENTO) : null
}

// Cuándo cierra el ciclo que está abierto AHORA en una tarjeta, y cuándo vence.
//
// Hasta acá la app no tenía ninguna noción de "corte por fecha": el ciclo abierto iba
// del último cierre conocido hasta HOY, sin techo, y lo único que lo cerraba era
// importar el PDF del resumen siguiente. Si ese PDF no llegaba, el ciclo seguía
// tragando compras para siempre y mezclaba en un solo monto lo que el banco ya facturó
// con lo que todavía no.
//
// El dato bueno es el del banco: muchos resúmenes traen, además de su propio cierre,
// las fechas del ciclo siguiente ("Próximo cierre 13-Ago-26 / Próximo vencimiento
// 21-Ago-26"), y se guardan al importar. Hay que usar ese y no calcularlo, porque los
// ciclos no caen siempre el mismo día del mes.
//
// Si el resumen no las trajo — o las columnas todavía no existen en la base, que se
// migra aparte —, se estima corriendo un mes el último cierre. La estimación sirve
// para AVISAR que el ciclo ya tendría que haber cerrado, nunca para dar por facturada
// plata: viaja marcada con `estimado` y quien la usa decide qué hacer con ella.
//
// Precedencia: primero lo que el usuario cargó a mano en la cuenta, después el PDF,
// después la estimación. Lo manual va PRIMERO porque el dato del PDF se vuelve viejo
// solo: la fecha de cierre se cambia desde el home banking cuando uno quiere, y el
// resumen anterior queda informando un próximo cierre que ya no va a pasar (caso real:
// el PDF de julio de la Mastercard decía 27-Ago y la tarjeta terminó cerrando el
// 30-Jul). Un dato que el usuario corrigió mirando su banco vale más que un PDF viejo.
//
// Una fecha de cierre que no sea POSTERIOR al último cierre conocido ya quedó atrás y
// se descarta, sea de donde sea: si no, al importar el resumen que cierra ese ciclo, el
// override manual seguiría apuntando a una fecha ya pasada y el ciclo nuevo arrancaría
// dado por cerrado.
export const cicloAbiertoDe = (ultimoReal, ultimoCierre, manual = null) => {
  const sirve = (f) => f && (!ultimoCierre || f > ultimoCierre)
  const cierreManual = normFecha(manual?.proximo_cierre)
  if (sirve(cierreManual)) {
    return { cierre: cierreManual, vencimiento: normFecha(manual?.proximo_vencimiento) || null, origen: 'manual' }
  }
  const cierrePdf = normFecha(ultimoReal?.proximo_cierre)
  if (sirve(cierrePdf)) {
    return { cierre: cierrePdf, vencimiento: normFecha(ultimoReal?.proximo_vencimiento) || null, origen: 'pdf' }
  }
  if (!ultimoCierre) return null
  return { cierre: addMeses(ultimoCierre, 1), vencimiento: null, origen: 'estimado' }
}

// CASCADA DE PAGOS. Reparte plata ya pagada entre obligaciones consecutivas, en orden:
// cada una se queda solo con lo que necesita para cubrirse y le pasa el resto a la que
// sigue. Lo que sobra al final es plata a favor de verdad.
//
// Es la regla que decide hasta dónde llega un pago: lo que corta la ventana de pagos de
// un resumen no es una fecha, es llegar al total que informó el banco. Un peso pagado
// por encima de ese total ya no es de ese resumen — está pagando el ciclo siguiente.
//
// Sin esto, el último resumen cargado se quedaba con todos los pagos posteriores para
// siempre (su ventana no tenía tope) y además cada ciclo se restaba por su cuenta los
// pagos posteriores a su cierre: el mismo pago contado dos veces. Caso real: un pago
// parcial de $ 1.500.000 hecho en agosto para bajar el ciclo que cerró el 30 de julio
// se restaba de ese ciclo y ADEMÁS figuraba como "Sobrepago del resumen anterior:
// $ 1.500.000", cuando no había sobrado nada.
export const repartirPagos = (disponible, totales) => {
  let restante = Math.max(0, disponible || 0)
  const aplicados = totales.map(total => {
    const aplicado = Math.min(restante, Math.max(0, total || 0))
    restante -= aplicado
    return aplicado
  })
  return { aplicados, restante }
}

// Cuántos días faltan (negativo = ya venció) para el vencimiento de un
// resumen. null si no tiene fecha de vencimiento (ej. "Ciclo actual").
export const diasRestantesDe = (s) => {
  if (!s.fecha_vencimiento) return null
  const fecha = new Date(s.fecha_vencimiento + 'T00:00:00')
  return Math.ceil((fecha - new Date()) / (1000 * 60 * 60 * 24))
}

// Cuánto saldo declara un resumen, sumando las dos monedas. Solo se usa para
// desempatar (ver compararStatements): no es plata comparable entre sí, es "este
// resumen dice algo" contra "este resumen está vacío".
const saldoDeclaradoDe = (s) => Math.abs(Number(s.total_resumen) || 0) + Math.abs(Number(s.total_dolares) || 0)

// Orden canónico de los resúmenes de UNA cuenta: por fecha de cierre, y el último
// de la lista es "el último resumen" — el que la app muestra en "A pagar", el que
// define el ciclo abierto y el que absorbe el saldo impago de los anteriores.
//
// El desempate NO es un detalle: dos resúmenes de la misma cuenta pueden terminar
// con el mismo cierre (el mismo PDF importado dos veces, un mes agregado a mano
// además del PDF, o un total puesto a mano — que deja los repetidos en 0, ver
// guardarTotalFacturadoMes). Ordenando solo por cierre, ese empate quedaba a merced
// del orden en que Postgres devolvió las filas, que NO está garantizado y cambia de
// una consulta a otra: la MISMA tarjeta mostraba $ 917.929 al abrirla (consulta con
// .eq de una sola cuenta) y $ 0 en el dashboard (consulta con .in de todas), porque
// cada vista se quedaba con un resumen distinto como "el último" y el otro
// desaparecía junto con su deuda.
//
// Empatados, gana el que tiene saldo declarado: un resumen vacío o vaciado nunca
// puede tapar una deuda real. Y si los dos declaran lo mismo, decide el id, que es
// estable entre consultas.
export const compararStatements = (s1, s2) =>
  (cierreDe(s1) || '').localeCompare(cierreDe(s2) || '') ||
  (saldoDeclaradoDe(s1) - saldoDeclaradoDe(s2)) ||
  String(s1.id).localeCompare(String(s2.id))

// Resúmenes REALES de tarjeta de crédito que todavía tienen saldo pendiente
// (el mismo criterio que "A pagar": solo el último resumen de cada cuenta, y
// solo mientras le quede algo por pagar en alguna moneda — ver esVisible más
// abajo). Única fuente de "cuánto debo y cuándo vence" para tarjetas: la
// consumen tanto la pestaña "A pagar" como el widget de Vencimientos, así
// nunca pueden desalinearse entre sí.
export const calcularStatementsPendientes = ({ accounts, statements, transactions }) => {
  const cuentasCreditoAPagar = (accounts || []).filter(a => a.tipo === 'credito')
  const cuentaCreditoIds = new Set(cuentasCreditoAPagar.map(a => a.id))
  const statementsPorCuenta = new Map()
  cuentasCreditoAPagar.forEach(a => {
    const propios = (statements || [])
      .filter(st => st.account_id === a.id && st.fecha_vencimiento && cierreDe(st))
      .sort(compararStatements)
    statementsPorCuenta.set(a.id, propios)
  })
  // Cuentas donde el ciclo que se está mostrando tiene más de un resumen cargado con
  // el mismo cierre. La app se queda con uno solo (el que tiene saldo) — avisarlo es
  // la diferencia entre "falta plata en la cuenta" y "cargaste el resumen dos veces".
  // Van los resúmenes enteros y no solo la cuenta: para poder elegir cuál borrar hay
  // que poder ver qué dice cada uno, si no es pedirle al usuario que adivine.
  const cuentasConResumenRepetido = cuentasCreditoAPagar.map(a => {
    const propios = statementsPorCuenta.get(a.id) || []
    const enUso = propios[propios.length - 1]
    if (!enUso) return null
    const cierre = cierreDe(enUso)
    const delCierre = propios.filter(s => cierreDe(s) === cierre)
    if (delCierre.length < 2) return null
    return {
      account_id: a.id, nombre: a.nombre, cierre, cantidad: delCierre.length,
      enUso, ignorados: delCierre.filter(s => s.id !== enUso.id),
    }
  }).filter(Boolean)
  const esUltimoDeCuenta = (s) => {
    const propios = statementsPorCuenta.get(s.account_id) || []
    return propios.length > 0 && propios[propios.length - 1].id === s.id
  }
  const totalUsdLinkedDe = (s) => {
    if (s.total_dolares !== null && s.total_dolares !== undefined) return Number(s.total_dolares)
    const usdItems = (transactions || []).filter(t => t.statement_id === s.id && t.tipo !== 'neutro' && t.moneda === 'USD')
    return usdItems.reduce((sum, t) => sum + (t.tipo === 'ingreso' ? -1 : 1) * Number(t.monto), 0)
  }
  const calcularEstadoStatement = (s, cierreSiguiente) => {
    const cierre = cierreDe(s)
    const enVentana = (t) => {
      const fecha = normFecha(t.fecha)
      return fecha > cierre && (!cierreSiguiente || fecha <= cierreSiguiente)
    }
    // Un pago (tipo "neutro"/"ingreso") siempre resta del saldo pendiente de la
    // ventana en la que cayó su fecha, tenga o no statement_id — total_resumen es
    // el total que informa el banco tal cual, nunca se recalcula descontando nada
    // por su cuenta, así que no hay riesgo de restar dos veces el mismo pago.
    // Antes se exigía "!t.statement_id" (pago suelto, sin vincular a ningún
    // resumen) para contarlo acá — pero el import de la tarjeta linkea TODAS las
    // filas de su propio PDF al resumen nuevo, incluida cualquier línea de pago
    // recibido que venga en ese mismo resumen. Esos pagos quedaban con
    // statement_id seteado (al resumen que los contiene) y por eso se excluían
    // acá, aunque sí se contaban en "Resumen mensual" (CashView, que no filtra
    // por statement_id) — de ahí el desfasaje entre "A pagar" y "Resumen mensual".
    // Solo cuentan los PAGOS (tipo "neutro"). Los reintegros y devoluciones (tipo
    // "ingreso") que caen después del cierre no cancelan deuda de este resumen: el
    // banco los acredita en el SIGUIENTE. Contándolos acá aparecía un sobrepago que
    // no existía — caso real: un resumen de $2.008.983,71 pagado justo por
    // $2.008.983,71 mostraba "Sobrepago del resumen anterior: $36.022,84", que era
    // exactamente una devolución de percepción acreditada once días después del
    // cierre. Un reintegro anterior al cierre ya viene descontado en el total que
    // informa el banco, así que tampoco hay que restarlo por separado.
    const pagosArs = (transactions || []).filter(t => t.account_id === s.account_id && t.moneda !== 'USD' && t.tipo === 'neutro' && enVentana(t))
    const pagosUsd = (transactions || []).filter(t => t.account_id === s.account_id && t.moneda === 'USD' && t.tipo === 'neutro' && enVentana(t))
    const totalPagosArs = pagosArs.reduce((sum, t) => sum + Number(t.monto), 0)
    const totalPagosUsd = pagosUsd.reduce((sum, t) => sum + Number(t.monto), 0)
    const totalArs = Number(s.total_resumen) || 0
    const totalUsd = totalUsdLinkedDe(s)
    const pendienteArsSinClamp = totalArs - totalPagosArs
    const pendienteUsdSinClamp = totalUsd - totalPagosUsd
    // Un total NEGATIVO es un saldo a favor que informó el banco en el resumen, no
    // plata que el usuario pagó de más. Sin este chequeo, un resumen con
    // total_dolares = -20,65 (saldo a favor en dólares, algo común cuando el mes
    // anterior se pagó de más o hubo un reintegro) mostraba "Sobrepago del resumen
    // anterior: U$S 20,65" aunque no se hubiera hecho ningún pago: el excedente
    // salía de la resta 0 − (−20,65). Solo hay plata sobrante cuando había una deuda
    // real y los pagos la superaron.
    //
    // `excedente` es la plata pagada POR ENCIMA del total que informó el banco. No es
    // un sobrepago: es lo que ya está pagando el ciclo siguiente. Quien lo consume
    // (virtualesAPagar) lo baja en cascada por los ciclos que vienen después.
    return {
      pendienteArs: Math.max(0, pendienteArsSinClamp),
      excedenteArs: totalArs > 0 ? Math.max(0, -pendienteArsSinClamp) : 0,
      pendienteUsd: Math.max(0, pendienteUsdSinClamp),
      excedenteUsd: totalUsd > 0 ? Math.max(0, -pendienteUsdSinClamp) : 0,
      totalPagosArs, totalPagosUsd,
    }
  }
  const estadosStatement = new Map()
  cuentasCreditoAPagar.forEach(a => {
    const propios = statementsPorCuenta.get(a.id) || []
    propios.forEach((s, i) => {
      // Lo que corta la ventana de pagos de un resumen NO es una fecha: es llegar al
      // total que informó el banco. Un resumen se paga hasta cubrirlo, y la plata que se
      // pagó por encima de ese total ya no es de él — está pagando lo que sigue (ver
      // excedente, que baja en cascada a los ciclos siguientes en virtualesAPagar).
      // Por eso el último resumen no necesita un tope de fecha: nunca se puede quedar
      // con más plata de la que decía su PDF.
      const cierreSiguiente = i < propios.length - 1 ? cierreDe(propios[i + 1]) : null
      estadosStatement.set(s.id, calcularEstadoStatement(s, cierreSiguiente))
    })
  })
  const esVisible = (s) => {
    if (!esUltimoDeCuenta(s)) return false
    const st = estadosStatement.get(s.id)
    if (!st) return false
    return Math.round(st.pendienteArs) > 0 || Math.round(st.pendienteUsd * 100) > 0
  }
  const statementsRealesConUsd = (statements || [])
    .filter(s => cuentaCreditoIds.has(s.account_id) && esVisible(s))
    .map(s => {
      const st = estadosStatement.get(s.id)
      return {
        ...s,
        total_resumen: st.pendienteArs,
        total_usd: st.pendienteUsd,
        _pagosPosterioresArs: st.totalPagosArs,
        _pagosPosterioresUsd: st.totalPagosUsd,
        _excedenteArs: st.excedenteArs,
        _excedenteUsd: st.excedenteUsd,
      }
    })
  return { cuentasCreditoAPagar, cuentaCreditoIds, statementsPorCuenta, estadosStatement, statementsRealesConUsd, cuentasConResumenRepetido }
}

export const mesLabel = (yearMonth) => {
  const [year, month] = yearMonth.split('-')
  return `${MESES[parseInt(month) - 1]} ${year}`
}

// statements.periodo se guarda como texto en español ("Junio 2026"), no como
// "YYYY-MM" — convertirlo es necesario para poder ordenar cronológicamente
// (un ordenamiento alfabético pone "Junio" antes que "Mayo") y para poder
// pasarlo por mesLabel (que espera "YYYY-MM" y si no lo recibe así devuelve
// "undefined" en el mes).
const MESES_LOWER = MESES.map(m => m.toLowerCase())
export const periodoToYearMonth = (periodo) => {
  const m = String(periodo || '').trim().match(/^([a-záéíóúñ]+)\s+(\d{4})$/i)
  if (!m) return null
  const idx = MESES_LOWER.indexOf(m[1].toLowerCase())
  if (idx === -1) return null
  return `${m[2]}-${String(idx + 1).padStart(2, '0')}`
}

export const getLast6Months = () => {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function AccountDetail({ account, accounts, allAccounts, refreshKey, searchQuery, onSearchChange, tipoCambio, tipoCambioEUR, tcMap, tcMapEUR, darkMode, onPeriodChange, onTransactionsLoaded, onStatementsLoaded, onAddIngreso, customIcons, onAccountsChanged, soloAPagar, userEmail }) {
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingTx, setEditingTx] = useState(null)
  const [filaExpandida, setFilaExpandida] = useState(null)
  const [tablaRef, tablaWidth] = useContainerWidth()
  const colVisible = columnasVisibles(tablaWidth)
  const numColsTabla = 4 + (colVisible.categoria ? 1 : 0) + (colVisible.cuenta ? 1 : 0) + (colVisible.subcategoria ? 1 : 0) + (colVisible.cuotas ? 1 : 0)
  // Anchos fijos (px) de las columnas cuyo contenido no depende del ancho de
  // pantalla ("23/07", "6/6", "$ 45.678", una flechita o un par de íconos) —
  // el resto del ancho medido de la tabla se reparte por peso entre nombre y
  // las columnas de texto opcionales (ver repartirAnchoTexto), en vez de que
  // nombre se lleve todo el sobrante como pasaba con un <col /> sin ancho.
  // Estos anchos estaban calculados para el CONTENIDO ("23/07", "6/6") y no
  // para el encabezado, así que en desktop los títulos se cortaban ("FEC...",
  // "CU...") aunque sobrara espacio a lo ancho. Cuando hay lugar se les da el
  // ancho que necesita el título completo ("FECHA ↕", "CUOTAS ↕"); en pantallas
  // angostas se vuelve al ancho compacto, donde cada píxel le hace falta a las
  // columnas de texto.
  const anchoHolgado = tablaWidth >= 900
  // Cuando hay movimientos de otro año la fecha se muestra con el año
  // ("28/06/23", ver formatFechaCorta) y no entra en el ancho compacto: se le
  // dan unos píxeles más, pero solo en ese caso, para no sacarle lugar a las
  // columnas de texto en la vista normal (todo del año en curso).
  const hayFechasDeOtroAnio = useMemo(() => {
    const anioActual = String(new Date().getFullYear())
    return (transactions || []).some(t => t.fecha && t.fecha.slice(0, 4) !== anioActual)
  }, [transactions])
  // 62px alcanzan para el contenido ("13/08") pero no para el encabezado: en
  // computadora "FECHA" mide 39,5px y la celda se lleva 12px de padding de cada
  // lado, así que el título salía cortado como "FEC…" arriba de una columna
  // medio vacía. En el celular el padding es de 8px y sí entra, y ahí cada píxel
  // se lo lleva la descripción, que hace más falta.
  const FECHA_PX = anchoHolgado ? 82 : (hayFechasDeOtroAnio ? 76 : (tablaWidth >= 500 ? 70 : 62))
  const CUOTAS_PX = anchoHolgado ? 78 : 54
  const MONTO_PX = 112, EXPAND_PX = 28
  // cuenta pesaba 0.8 (la porción más chica de las cuatro) aunque nombres de
  // cuenta como "Mastercard Preferred" son tan largos como una categoría —
  // se cortaban con "..." mientras sobraba aire en las demás columnas.
  const anchosTextoPral = repartirAnchoTexto(
    tablaWidth - FECHA_PX - MONTO_PX - EXPAND_PX - (colVisible.cuotas ? CUOTAS_PX : 0),
    colVisible, { nombre: 1.5, categoria: 1.4, cuenta: 1.3, subcategoria: 1.3 }
  )
  const anchosTextoNeutros = repartirAnchoTexto(
    tablaWidth - FECHA_PX - MONTO_PX - EXPAND_PX,
    colVisible, { nombre: 1.5, categoria: 1.4, subcategoria: 1.2, cuenta: 1.3 }
  )
  // "Sin identificar": la columna "Categoría" acá es puro relleno (siempre
  // muestra "—", todavía no se clasificó) — se oculta con el mismo criterio que
  // colVisible.categoria en vez de reservarle un ancho fijo siempre, para dejarle
  // más lugar a nombre/cuenta/subcategoría en pantallas angostas.
  const SINID_CATEGORIA_PX = 56
  const anchosTextoSinId = repartirAnchoTexto(
    tablaWidth - FECHA_PX - (colVisible.categoria ? SINID_CATEGORIA_PX : 0) - MONTO_PX - EXPAND_PX,
    colVisible, { cuenta: 1.6, subcategoria: 1, nombre: 1.6 }
  )
  const [editNombre, setEditNombre] = useState('')
  const [editMonto, setEditMonto] = useState('')
  // La fecha no se podía editar desde la fila: si la IA la leía mal, o una cuota
  // quedaba en el mes equivocado, no había forma de corregirla sin borrar el
  // movimiento y cargarlo de nuevo a mano.
  const [editFecha, setEditFecha] = useState('')
  // Cuotas editables: un movimiento que se leyó como cuota sin serlo (o al revés)
  // solo se podía arreglar por SQL. Se guardan como texto para que el campo pueda
  // quedar vacío mientras se escribe, sin que un '' se convierta en 0.
  const [editCuotaNum, setEditCuotaNum] = useState('')
  const [editCuotasTotal, setEditCuotasTotal] = useState('')
  const [editCategoria, setEditCategoria] = useState('')
  const [editSubcategoria, setEditSubcategoria] = useState('')
  const [editTag, setEditTag] = useState('')
  const [editCuenta, setEditCuenta] = useState('')
  const [editHijoIngreso, setEditHijoIngreso] = useState('')
  const [editTipo, setEditTipo] = useState('gasto')
  const [editBarMes, setEditBarMes] = useState(null)
  const [editBarValor, setEditBarValor] = useState('')
  const [editBarMoneda, setEditBarMoneda] = useState('ARS')
  const [editBarPeriodo, setEditBarPeriodo] = useState('')
  const [confirmDeleteMes, setConfirmDeleteMes] = useState(null)
  // Mes desplegado en "Total facturado por resumen" (solo tiene sentido cuando ese mes
  // tiene más de una ficha cargada), y qué ficha suelta está esperando confirmación.
  const [mesDesplegado, setMesDesplegado] = useState(null)
  const [confirmDeleteResumen, setConfirmDeleteResumen] = useState(null)
  // Qué cuenta está esperando confirmación para borrar su resumen repetido, y cuál
  // está borrándose ahora (el borrado rehace el fetch, así que tarda lo suyo).
  const [confirmBorrarRepetido, setConfirmBorrarRepetido] = useState(null)
  const [borrandoRepetido, setBorrandoRepetido] = useState(null)
  const [showAddMes, setShowAddMes] = useState(false)
  const [nuevoMes, setNuevoMes] = useState({ periodo: '', valor: '', moneda: 'ARS' })
  const [editUsdStatementId, setEditUsdStatementId] = useState(null)
  const [editUsdValor, setEditUsdValor] = useState('')
  const [children, setChildren] = useState([])
  const [sortKey, setSortKey] = useState('fecha')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedSplits, setExpandedSplits] = useState(new Set())
  const [selectedMeses, setSelectedMeses] = useState([])
const [equivEnUSD, setEquivEnUSD] = useState(false)
  const [showNeutros, setShowNeutros] = useState(false)
  // La tabla de movimientos se corta a los primeros MOVIMIENTOS_VISIBLES, con un
  // botón para ver el resto: con 100+ movimientos había que scrollear la lista
  // entera para llegar a cualquier cosa.
  const [verTodosMovimientos, setVerTodosMovimientos] = useState(false)
  const [filtroCuenta, setFiltroCuenta] = useState('')
  // Filtro por columna, tipo Excel: hasta ahora la tabla solo se podía ordenar,
  // así que para ver únicamente (por ejemplo) las compras en cuotas había que
  // ordenar por esa columna y recorrer la lista a ojo. Cada clave guarda los
  // valores elegidos de esa columna; array vacío o ausente = mostrar todos.
  const [filtrosCol, setFiltrosCol] = useState({})
  // Columna cuyo panel está abierto, y dónde dibujarlo. La posición se calcula
  // del botón porque el <th> tiene overflow hidden (para el "..." del título) y
  // un panel absoluto adentro quedaría recortado.
  const [filtroColAbierto, setFiltroColAbierto] = useState(null)
  const [filtroColPos, setFiltroColPos] = useState({ x: 0, y: 0 })
  const [filtroColBusqueda, setFiltroColBusqueda] = useState('')
  const [vistaCuenta, setVistaCuenta] = useState('movimientos')
  const [apagarSortKey, setApagarSortKey] = useState('monto')
  const [apagarSortDir, setApagarSortDir] = useState('desc')
  const [detalleAbierto, setDetalleAbierto] = useState(() => new Set())
  const toggleDetalleAPagar = (statementId) => setDetalleAbierto(prev => {
    const next = new Set(prev)
    next.has(statementId) ? next.delete(statementId) : next.add(statementId)
    return next
  })
  const [tarjetaAbierta, setTarjetaAbierta] = useState(() => new Set())
  const toggleTarjetaAPagar = (statementId) => setTarjetaAbierta(prev => {
    const next = new Set(prev)
    next.has(statementId) ? next.delete(statementId) : next.add(statementId)
    return next
  })
  const [cicloDesdeOverride, setCicloDesdeOverride] = useState({})
  const [cierreManualOverride, setCierreManualOverride] = useState({})
  const [catGeneralSeleccionada, setCatGeneralSeleccionada] = useState(null)
  const [hijoGeneralSeleccionado, setHijoGeneralSeleccionado] = useState(null)
  // "Gastos del mes por categoría" mezcla filas de categoría y de hijo en una
  // sola lista — togglear una cierra la otra, para que solo haya un desglose
  // abierto a la vez (mismo comportamiento que antes, con cajas separadas).
  const toggleGastoGeneralRow = (tipo, nombre) => {
    if (tipo === 'hijo') {
      setHijoGeneralSeleccionado(h => h === nombre ? null : nombre)
      setCatGeneralSeleccionada(null)
    } else {
      setCatGeneralSeleccionada(c => c === nombre ? null : nombre)
      setHijoGeneralSeleccionado(null)
    }
  }
  const cicloDesdeTimers = useRef({})
  const guardarCicloDesde = (accountId, fecha) => {
    // El input es un <input type="date">: al escribirlo a mano dispara un onChange
    // por cada segmento (día/mes/año) que se completa, no solo al terminar. Sin
    // debounce, cada uno de esos disparos guardaba en la DB y refrescaba todas las
    // cuentas (fetchAllData), lo que desmontaba el panel entero ("Cargando datos...")
    // y le hacía perder el foco al input a mitad de tipeo.
    setCicloDesdeOverride(prev => ({ ...prev, [accountId]: fecha || null }))
    clearTimeout(cicloDesdeTimers.current[accountId])
    cicloDesdeTimers.current[accountId] = setTimeout(async () => {
      await supabase.from('accounts').update({ ciclo_actual_desde: fecha || null }).eq('id', accountId)
      onAccountsChanged?.()
    }, 800)
  }

  // Cierre y vencimiento del ciclo abierto, puestos a mano. Existen porque la fecha que
  // trae el PDF SE PUEDE VOLVER VIEJA: el cierre de una tarjeta se cambia desde el home
  // banking cuando uno quiere, y a partir de ahí el resumen anterior informa un próximo
  // cierre que ya no va a pasar. Caso real: el resumen de julio de la Mastercard decía
  // "próximo cierre 27-Ago" y después se movió la fecha de cobro a cerrar el 30-Jul —
  // 28 días de diferencia, con la tarjeta ya cerrada y la app creyendo que faltaban
  // tres semanas. Lo que se carga acá le gana al PDF (ver cicloAbiertoDe).
  const cierreManualTimers = useRef({})
  const guardarCierreManual = (accountId, campos) => {
    setCierreManualOverride(prev => ({ ...prev, [accountId]: { ...(prev[accountId] || {}), ...campos } }))
    clearTimeout(cierreManualTimers.current[accountId])
    cierreManualTimers.current[accountId] = setTimeout(async () => {
      const { error } = await supabase.from('accounts').update(campos).eq('id', accountId)
      // Las columnas se agregan con una migración aparte: si todavía no están, el
      // cambio vive en memoria hasta recargar en vez de romper la pantalla.
      if (error && /proximo_(cierre|vencimiento)/.test(error.message || '')) {
        console.warn('accounts sin columnas de próximo ciclo — el cierre manual no se guarda')
        return
      }
      onAccountsChanged?.()
    }, 800)
  }

  // Notificar al padre cuando cambia el período seleccionado
  useEffect(() => { onPeriodChange?.(selectedMeses) }, [selectedMeses, onPeriodChange])
  useEffect(() => { onTransactionsLoaded?.(transactions) }, [transactions, onTransactionsLoaded])
  // Igual que onTransactionsLoaded: reporta los statements recién fetcheados hacia
  // arriba, para que Dashboard.js pueda calcular vencimientos de tarjeta sin volver a
  // pedirlos ni recalcular su propia versión de "A pagar".
  useEffect(() => { onStatementsLoaded?.(statements) }, [statements, onStatementsLoaded])
  const [mesDropdownOpen, setMesDropdownOpen] = useState(false)
  const [stmtCollapsed, setStmtCollapsed] = useState(true)
  const [chartType, setChartType] = useState(() => {
    const saved = localStorage.getItem('chart_type_ma')
    // La vista "Burbujas" se eliminó — si alguien la tenía guardada de una sesión
    // vieja, cae a Donut en vez de a un tipo de gráfico que ya no existe.
    return saved === 'donut' || saved === 'bars' ? saved : 'donut'
  })
  const mesDropdownRef = useRef(null)
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => { setFiltroCuenta('') }, [account, allAccounts])
  useEffect(() => { setVistaCuenta('movimientos') }, [account, allAccounts])

  // Qué hay que traer depende de QUÉ cuentas se están mirando, no de los datos de esas
  // cuentas: los movimientos y resúmenes no cambian porque a una tarjeta le corrijan la
  // fecha de cierre. Atado a la identidad del array `accounts`, sí cambiaba: guardar
  // cualquier campo de una cuenta hace que Dashboard vuelva a pedir las cuentas
  // (fetchAccounts) y devuelva un array nuevo, y eso disparaba de nuevo el fetch
  // completo — con setLoading(true) de por medio, o sea la pantalla entera reemplazada
  // por "Cargando datos..." en mitad de la edición. Desde el teléfono, donde el selector
  // de fecha dispara un onChange por cada vuelta de la rueda, se veía como que la página
  // se recargaba sola a cada número que se tocaba, perdiendo el foco del input.
  // El tipo de cuenta sí entra en la clave: decide qué se consulta (ver esCuentaIngresos),
  // y se lee de la lista fresca porque `account` es el objeto que quedó seleccionado y no
  // se renueva al guardar.
  const tipoCuentaActual = !allAccounts && account
    ? ((accounts || []).find(a => a.id === account.id) || account).tipo
    : null
  const fetchKey = allAccounts
    ? `all:${(accounts || []).map(a => a.id).sort().join(',')}`
    : `one:${account?.id || ''}:${tipoCuentaActual || ''}`
  useEffect(() => {
    if (allAccounts && accounts && accounts.length > 0) fetchAllData()
    else if (account) fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, allAccounts, refreshKey])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('children').select('id, nombre, icono').eq('user_id', user.id).order('nombre').then(({ data }) => setChildren(data || []))
    })
  }, [])

  // IMPORTANTE: la query que se le pasa tiene que ordenar por una columna que
  // desempate por completo (ej. .order('fecha', ...).order('id', ...)) — si
  // muchas filas comparten la misma fecha (algo común acá), ordenar solo por
  // fecha no da un orden estable entre ellas, y Postgres puede devolver la
  // misma fila en dos páginas distintas (duplicada, y hasta con dos filas de
  // React con la misma key) u omitir otra, ya que cada página es una
  // consulta separada con su propio LIMIT/OFFSET.
  const fetchAllPages = async (buildQuery) => {
    const PAGE = 1000
    let all = []
    let page = 0
    while (true) {
      const { data } = await buildQuery().range(page * PAGE, (page + 1) * PAGE - 1)
      if (!data || data.length === 0) break
      all = all.concat(data)
      if (data.length < PAGE) break
      page++
    }
    return all
  }

  // Un movimiento suelto (sin statement_id, ej. cargado a mano o por Excel mientras se
  // esperaba el resumen) pertenece automáticamente al resumen real de esa cuenta cuya
  // ventana propia lo cubre: después del cierre del resumen ANTERIOR de esa cuenta y
  // hasta el cierre de este resumen. Si no hay un resumen anterior (es el primero que se
  // carga para la cuenta), no hay de dónde sacar ese límite inferior real — usar "todo lo
  // anterior sin límite" arrastraría meses de historial viejo ya resuelto que no tiene
  // nada que ver, así que se aproxima con la duración típica de un ciclo (~40 días).
  // Los pagos ("neutro") quedan afuera: no son un ítem más del resumen, son plata que
  // achica el saldo pendiente (ver statementsRealesConUsd), y se manejan aparte.
  // También se deshacen acá los vínculos de una versión anterior de este fix que no
  // tenía ese límite inferior y había ligado movimientos viejos que no correspondían —
  // se detectan igual (por fecha, no por cómo se generaron) y se sueltan.
  const DIAS_CICLO_APROX = 40
  // cuentaIds: las cuentas cuyos resúmenes se pidieron en este fetch. Sin ese dato no se
  // puede distinguir "este resumen no existe" de "no lo consulté" (ver desligar).
  const reconciliarSueltas = async (txs, stmts, cuentaIds) => {
    const cuentasEnScope = new Set(cuentaIds || [])
    const statementsPorCuenta = new Map()
    stmts.forEach(st => {
      if (!cierreDe(st)) return
      const list = statementsPorCuenta.get(st.account_id) || []
      list.push(st)
      statementsPorCuenta.set(st.account_id, list)
    })
    // Un cierre = un destino. Si hay dos resúmenes cargados con el mismo cierre (ver
    // compararStatements), los movimientos van al que la app muestra — el último del
    // empate —: ligarlos al otro dejaba al resumen visible sin sus propios ítems, y el
    // vínculo se reescribía en la base cada vez que se abría una pantalla distinta.
    const cierresPorCuenta = new Map()
    statementsPorCuenta.forEach((list, accountId) => {
      const porCierre = new Map()
      ;[...list].sort(compararStatements).forEach(st => porCierre.set(cierreDe(st), { id: st.id, cierre: cierreDe(st) }))
      cierresPorCuenta.set(accountId, [...porCierre.values()])
    })
    const ventanaDe = (accountId, cierre) => {
      const list = cierresPorCuenta.get(accountId) || []
      const idx = list.findIndex(c => c.cierre === cierre)
      return idx > 0 ? list[idx - 1].cierre : restarDiasISO(cierre, DIAS_CICLO_APROX)
    }

    // Una cuota se carga con una fecha derivada (mismo día que la compra original, mes
    // corrido según el número de cuota) que no coincide con la fecha real de
    // facturación de ningún resumen puntual — para cuotas se compara el MES contra el
    // mes de cierre del resumen, nunca el día ni la ventana de días de los demás
    // movimientos. La regla vive en cuotaEnCiclo (lib/cuotas.js), compartida con
    // perteneceCicloActual: acá la ventana es un solo mes, así que el desde es el mes
    // anterior al del cierre.
    const perteneceAlCierre = (t, cierre, desde) => {
      if (esCuota(t)) return cuotaEnCiclo(t, addMeses(cierre, -1), cierre)
      const fecha = normFecha(t.fecha)
      return cierre >= fecha && fecha > desde
    }

    // Un pago o reintegro suelto (tipo "neutro" o "ingreso") en la cuenta de una tarjeta
    // no es un ítem más del resumen: es plata que achica el saldo pendiente (ver
    // calcularEstadoStatement, más abajo en el archivo), igual que ya se trata en "Ciclo actual".
    // Si se lo dejara auto-ligar acá como si fuera una compra más, quedaría "adentro" del
    // resumen sin restar nada de su total mostrado.
    const esPagoOReintegro = (t) => t.tipo === 'neutro' || t.tipo === 'ingreso'
    const grupos = new Map()
    txs.forEach(t => {
      if (t.statement_id || !t.fecha || esPagoOReintegro(t)) return
      const candidatos = cierresPorCuenta.get(t.account_id)
      const destino = candidatos && candidatos.find(c => perteneceAlCierre(t, c.cierre, ventanaDe(t.account_id, c.cierre)))
      if (!destino) return
      if (!grupos.has(destino.id)) grupos.set(destino.id, [])
      grupos.get(destino.id).push(t)
    })

    const desligar = []
    txs.forEach(t => {
      if (!t.statement_id || esPagoOReintegro(t) || !t.fecha) return
      const st = stmts.find(s => s.id === t.statement_id)
      // Un movimiento que apunta a un resumen que YA NO EXISTE (borrado desde "Total
      // facturado por resumen", que se lleva todos los resúmenes de ese mes) quedaba
      // colgado para siempre: no salía en el detalle de ningún resumen, y esta misma
      // función lo salteaba justamente porque no encontraba el resumen del que colgaba.
      // Se suelta, y así vuelve a engancharse al ciclo que le corresponde.
      // Solo dentro del alcance consultado: la vista Ingresos trae movimientos de todas
      // las cuentas pero resúmenes de una sola, y ahí "no está" significa "no se
      // consultó", no "no existe".
      if (!st) { if (cuentasEnScope.has(t.account_id)) desligar.push(t); return }
      const cierre = cierreDe(st)
      if (!cierre) return
      const desde = ventanaDe(t.account_id, cierre)
      if (!perteneceAlCierre(t, cierre, desde)) desligar.push(t)
    })

    if (grupos.size === 0 && desligar.length === 0) return
    await Promise.all([
      ...[...grupos.entries()].map(([stmtId, list]) =>
        supabase.from('transactions').update({ statement_id: stmtId }).in('id', list.map(t => t.id))
      ),
      ...(desligar.length > 0 ? [supabase.from('transactions').update({ statement_id: null }).in('id', desligar.map(t => t.id))] : [])
    ])
    grupos.forEach((list, stmtId) => list.forEach(t => { t.statement_id = stmtId }))
    desligar.forEach(t => { t.statement_id = null })
  }

  const fetchData = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    // La vista Ingresos muestra todo lo marcado como ingreso sin importar en qué
    // cuenta real está; las demás cuentas siguen mostrando solo lo suyo.
    const esCuentaIngresos = account.tipo === 'ingreso'
    const [txs, catRes, stmtRes] = await Promise.all([
      fetchAllPages(() => {
        let q = supabase.from('transactions')
          .select('*, categories(nombre, color), subcategories(nombre), accounts(nombre), children(id, nombre)')
        q = esCuentaIngresos
          ? q.eq('user_id', user.id).eq('tipo', 'ingreso')
          : q.eq('account_id', account.id)
        return q.order('fecha', { ascending: false }).order('id', { ascending: true })
      }),
      supabase.from('categories').select('*').or(`user_id.eq.${user.id},es_sistema.eq.true`).order('orden'),
      // El .order('id') no es decorativo: dos resúmenes con la misma fecha_hasta salían
      // en el orden que quisiera Postgres, y ese orden se filtra hasta "cuál es el
      // último resumen de la tarjeta" (ver compararStatements). Consultado de a una
      // cuenta (.eq) podía dar distinto que consultado de a todas (.in), y la misma
      // tarjeta mostraba dos deudas distintas según desde qué pantalla se la mirara.
      supabase.from('statements')
        .select('*')
        .eq('account_id', account.id)
        .order('fecha_hasta', { ascending: true }).order('id', { ascending: true }),
    ])
    const cats = catRes.data || []
    const catIds = cats.map(c => c.id)
    const subcatRes = catIds.length > 0
      ? await supabase.from('subcategories').select('*').in('category_id', catIds).order('nombre')
      : { data: [] }
    await reconciliarSueltas(txs, stmtRes.data || [], [account.id])
    setTransactions(txs)
    setCategories(cats)
    setSubcategories(subcatRes.data || [])
    setStatements(stmtRes.data || [])
    if (txs.length > 0) {
      const meses = [...new Set(txs.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()
      const now = new Date()
      const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      setSelectedMeses([meses.includes(mesActual) ? mesActual : meses[0]])
    }
    setLoading(false)
  }

  const fetchAllData = async () => {
    setLoading(true)
    const accountIds = accounts.map(a => a.id)
    const { data: { user } } = await supabase.auth.getUser()
    const [txs, catRes, stmtRes] = await Promise.all([
      fetchAllPages(() =>
        supabase.from('transactions')
          .select('*, categories(nombre, color), subcategories(nombre), accounts(nombre), children(id, nombre)')
          .in('account_id', accountIds)
          .order('fecha', { ascending: false }).order('id', { ascending: true })
      ),
      supabase.from('categories').select('*').or(`user_id.eq.${user.id},es_sistema.eq.true`).order('orden'),
      supabase.from('statements')
        .select('*')
        .in('account_id', accountIds)
        .order('fecha_hasta', { ascending: true }).order('id', { ascending: true }),
    ])
    const cats = catRes.data || []
    const catIds = cats.map(c => c.id)
    const subcatRes = catIds.length > 0
      ? await supabase.from('subcategories').select('*').in('category_id', catIds).order('nombre')
      : { data: [] }
    await reconciliarSueltas(txs, stmtRes.data || [], accountIds)
    setTransactions(txs)
    setCategories(cats)
    setSubcategories(subcatRes.data || [])
    setStatements(stmtRes.data || [])
    if (txs.length > 0) {
      const meses = [...new Set(txs.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()
      const now = new Date()
      const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      setSelectedMeses([meses.includes(mesActual) ? mesActual : meses[0]])
    }
    setLoading(false)
  }

  const mesesDisponibles = useMemo(() =>
    [...new Set(transactions.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()
  , [transactions])

  // Al entrar a la pestaña (o cambiar de cuenta), arrancar con el mes actual ya
  // seleccionado — o el más reciente con datos, si el actual no tiene movimientos —
  // en vez de mostrar el selector vacío y obligar a un click extra cada vez. Es un
  // respaldo del default que ya arma fetchData/fetchAllData: si por lo que sea
  // selectedMeses queda vacío una vez que hay datos, lo completa acá. Se dispara una
  // sola vez por cuenta/refresh (el ref se resetea junto con el efecto que dispara el
  // fetch) para no pelearse con "Deseleccionar todos", que también deja selectedMeses
  // en [].
  const autoSelectedMonthRef = useRef(false)
  useEffect(() => { autoSelectedMonthRef.current = false }, [account, allAccounts, refreshKey])
  useEffect(() => {
    if (autoSelectedMonthRef.current) return
    if (selectedMeses.length > 0 || mesesDisponibles.length === 0) return
    autoSelectedMonthRef.current = true
    const mesActual = mesActualLocal()
    setSelectedMeses([mesesDisponibles.includes(mesActual) ? mesActual : mesesDisponibles[0]])
  }, [mesesDisponibles, selectedMeses])

  const toggleMes = (m) => {
    setSelectedMeses(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
    )
  }

  const filteredSubcats = () => {
    const catObj = categories.find(c => c.nombre === editCategoria)
    if (!catObj) return []
    return subcategories.filter(s => s.category_id === catObj.id)
  }

  // Guardar clasificación manual y aprender la regla
  const handleSaveEdit = async (tx) => {
    // Monto editable a mano (ej. corregir un reintegro mal leído del PDF, sin
    // tener que borrar el movimiento y cargar uno nuevo) — siempre positivo, el
    // tipo determina el signo en pantalla. Si el campo quedó vacío o inválido,
    // no se toca el monto original.
    const editMontoNum = parseFloat(String(editMonto).replace(',', '.'))
    const montoCorregido = !isNaN(editMontoNum) && editMontoNum > 0 && Math.abs(editMontoNum - Math.abs(tx.monto)) > 0.001
      ? editMontoNum
      : (tx.monto < 0 ? Math.abs(tx.monto) : undefined)
    // Fecha editable a mano (ej. corregir una cuota que quedó en el mes
    // equivocado, o una fecha que la IA leyó mal). Se valida el formato antes de
    // mandarla a la base; si quedó vacía o inválida, no se toca la original.
    const fechaOk = (() => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(editFecha)) return false
      const d = new Date(`${editFecha}T12:00:00`)
      if (isNaN(d.getTime())) return false
      // new Date('2026-02-30') NO falla: JS lo desborda al 2 de marzo. Se
      // verifica que la fecha vuelva a dar el mismo texto, para descartar días
      // que no existen en ese mes.
      const vuelta = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return vuelta === editFecha
    })()
    const fechaCorregida = fechaOk && editFecha !== normFecha(tx.fecha) ? editFecha : undefined
    const cambioFecha = fechaCorregida !== undefined ? { fecha: fechaCorregida } : {}
    // Cuotas editables. El caso que lo motivó: una compra de una sola vez que el
    // resumen (o la IA) leyó como "3/3", y que quedaba contaminando el widget de
    // cuotas pendientes sin forma de arreglarla desde la app.
    // Poner el total en 1 la saca de cuotas; el número se acota al total para que
    // no queden estados imposibles tipo "cuota 5 de 3".
    const cambioCuotas = (() => {
      const total = Math.trunc(Number(editCuotasTotal))
      if (!Number.isFinite(total) || total < 1 || total > 120) return {}
      const numPedido = Math.trunc(Number(editCuotaNum))
      const num = total === 1
        ? 1
        : (Number.isFinite(numPedido) ? Math.min(Math.max(numPedido, 1), total) : 1)
      if (total === (tx.cuotas_total || 1) && num === (tx.cuota_numero || 1)) return {}
      return { cuotas_total: total, cuota_numero: num }
    })()
    const cuentaObj = (accounts || []).find(a => a.id === editCuenta)
    const accountChange = editCuenta && editCuenta !== tx.account_id ? { account_id: editCuenta } : {}
    // El tipo (gasto/ingreso) ahora se elige explícitamente con el selector del
    // formulario de edición (editTipo), no infiriéndolo de tx.tipo — así una fila
    // de gasto se puede pasar a ingreso (o al revés) sin el atajo viejo de elegir
    // la categoría "Ingresos" desde la lista de gasto (confuso: mezclaba las
    // categorías reales de ingreso ahí adentro). En la cuenta de Ingresos el tipo
    // sigue fijo en ingreso, sin selector.
    const esIngresoTx = esVistaIngresos || editTipo === 'ingreso'
    if (esIngresoTx) {
      // El "tag" elegido acá tiene que ser siempre una subcategoría real de
      // "Ingresos" (ver subcategoriasDeIngreso) — se guarda category_id/subcategory_id
      // igual que hace el modal "Cargar movimiento", y se mantiene el tag en
      // paralelo (mismo nombre) porque otras pantallas siguen agrupando por tag.
      const ingresoSubcatObj = editTag
        ? subcategoriasDeIngreso(categories, subcategories).find(s => s.nombre === editTag)
        : null
      const catIngresos = categories.find(c => c.nombre === 'Ingresos' && (c.tipo || 'gasto') === 'ingreso')
      const childIngresoObj = children.find(c => c.nombre === editHijoIngreso)
      const upd = { nombre: editNombre, tag: editTag || null, child_id: childIngresoObj?.id || null, estado: 'identificado', ...accountChange, ...cambioFecha, ...cambioCuotas, ...(tx.tipo !== 'ingreso' ? { tipo: 'ingreso' } : {}) }
      if (!editTag) {
        // Sin categoría elegida: limpiar el vínculo.
        upd.category_id = null
        upd.subcategory_id = null
      } else if (ingresoSubcatObj) {
        upd.category_id = catIngresos?.id || null
        upd.subcategory_id = ingresoSubcatObj.id
      }
      // Si editTag no matchea ninguna subcategoría real (dato viejo sin migrar
      // todavía), no se toca category_id/subcategory_id — se deja como estaba.
      if (montoCorregido !== undefined) upd.monto = montoCorregido
      const { error } = await supabase.from('transactions').update(upd).eq('id', tx.id)
      if (error) { window.alert('No se pudo guardar el cambio: ' + error.message + '\nProbá de nuevo.'); return }
      // Si se movió a otra cuenta y esta vista es de una cuenta puntual (no
      // "todas las cuentas"), ya no pertenece acá — sacarla de la lista en vez
      // de dejarla actualizada-pero-visible hasta el próximo refresh de página.
      setTransactions(prev => (accountChange.account_id && account && accountChange.account_id !== account.id)
        ? prev.filter(t => t.id !== tx.id)
        : prev.map(t => t.id === tx.id ? { ...t, nombre: editNombre, tag: editTag || null, child_id: childIngresoObj?.id || null, children: childIngresoObj ? { id: childIngresoObj.id, nombre: childIngresoObj.nombre } : null, estado: 'identificado', ...accountChange, tipo: 'ingreso', category_id: 'category_id' in upd ? upd.category_id : t.category_id, subcategory_id: 'subcategory_id' in upd ? upd.subcategory_id : t.subcategory_id, categories: 'category_id' in upd ? (catIngresos ? { nombre: catIngresos.nombre } : null) : t.categories, ...(cuentaObj ? { accounts: { nombre: cuentaObj.nombre } } : {}), ...cambioFecha, ...cambioCuotas, ...(montoCorregido !== undefined ? { monto: montoCorregido } : {}) } : t))
      setEditingTx(null)
      setFilaExpandida(prev => prev === tx.id ? null : prev)
      return
    }
    const catObj = categories.find(c => c.nombre === editCategoria)
    const subcatObj = subcategories.find(s => s.nombre === editSubcategoria && s.category_id === catObj?.id)
    // Si esta fila era un ingreso y se pasó a gasto con el selector de tipo,
    // hay que volver el tipo a "gasto" explícitamente (antes esto pasaba solo
    // al elegir la categoría "Ingresos" desde acá — ya no existe esa opción en
    // esta lista, el tipo se elige aparte con el selector de arriba).
    const vuelveAGasto = tx.tipo === 'ingreso' && editTipo !== 'ingreso'

    // Actualizar la transacción — monto siempre positivo (el tipo determina el signo en pantalla)
    const { error: errUpd } = await supabase.from('transactions').update({
      nombre: editNombre,
      category_id: catObj ? catObj.id : tx.category_id,
      subcategory_id: subcatObj ? subcatObj.id : null,
      estado: 'identificado',
      tag: editTag || null,
      ...(vuelveAGasto ? { tipo: 'gasto' } : {}),
      ...accountChange,
      ...cambioFecha,
      ...cambioCuotas,
      ...(montoCorregido !== undefined ? { monto: montoCorregido } : {})
    }).eq('id', tx.id)
    if (errUpd) { window.alert('No se pudo guardar el cambio: ' + errUpd.message + '\nProbá de nuevo.'); return }

    // Guardar regla aprendida en user_rules si hay un detalle original
    const texto_original = (tx.detalle || '').trim()
    if (texto_original && catObj) {
      const { data: { user } } = await supabase.auth.getUser()
      // Upsert: si ya existe una regla para este patrón, la actualiza — y
      // suma a veces_confirmado en vez de pisarlo siempre a 1.
      const { data: reglaExistente } = await supabase.from('user_rules')
        .select('veces_confirmado').eq('user_id', user.id).eq('texto_original', texto_original).maybeSingle()
      await supabase.from('user_rules').upsert({
        user_id: user.id,
        texto_original: texto_original,
        nombre_asignado: editNombre || texto_original,
        category_id: catObj.id,
        subcategory_id: subcatObj?.id || null,
        veces_confirmado: (reglaExistente?.veces_confirmado || 0) + 1,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,texto_original',
        ignoreDuplicates: false
      })
    }

    // Igual que en la rama de ingresos: si se movió a otra cuenta y esta vista
    // es de una cuenta puntual, sacarla de la lista en vez de dejarla visible
    // (con la cuenta ya cambiada) hasta que se refresque la página.
    setTransactions(prev => (accountChange.account_id && account && accountChange.account_id !== account.id)
      ? prev.filter(t => t.id !== tx.id)
      : prev.map(t => t.id === tx.id ? {
        ...t,
        nombre: editNombre,
        tag: editTag || null,
        category_id: catObj?.id || t.category_id,
        subcategory_id: subcatObj?.id || null,
        estado: 'identificado',
        categories: catObj ? { nombre: catObj.nombre, color: catObj.color } : t.categories,
        subcategories: subcatObj ? { nombre: subcatObj.nombre } : null,
        ...(vuelveAGasto ? { tipo: 'gasto' } : {}),
        ...accountChange,
        ...(cuentaObj ? { accounts: { nombre: cuentaObj.nombre } } : {}),
        ...cambioFecha,
        ...cambioCuotas,
        ...(montoCorregido !== undefined ? { monto: montoCorregido } : {})
      } : t))
    setEditingTx(null)
    setFilaExpandida(prev => prev === tx.id ? null : prev)
  }

  const startEdit = (tx) => {
    setEditingTx(tx.id)
    setEditNombre(tx.nombre || tx.detalle)
    // normFecha para que un valor con hora ("2026-07-15T00:00:00") llegue como
    // "2026-07-15", que es lo único que acepta un <input type="date">.
    setEditFecha(normFecha(tx.fecha) || '')
    setEditCategoria(tx.categories?.nombre || 'A Identificar')
    setEditSubcategoria(tx.subcategories?.nombre || '')
    setEditCuenta(tx.account_id || '')
    if (tx.tipo === 'ingreso') {
      // Los ingresos que vienen del import de tarjeta tienen category_id/
      // subcategory_id reales pero nunca llenaron "tag" (ese import solo lo usa
      // para el hijo) — sin este respaldo, el form mostraba "sin categoría" y
      // guardar CUALQUIER cambio (ej. el monto) borraba la categoría real que
      // sí tenía. Ver también el respaldo igual en la columna Categoría de la tabla.
      setEditTag(tx.tag || tx.subcategories?.nombre || '')
    } else {
      const matchedChild = children.find(c => c.nombre.toLowerCase() === (tx.tag || '').toLowerCase())
      setEditTag(matchedChild ? matchedChild.nombre : (tx.tag || ''))
    }
    // Hijo de un ingreso (ej. cuota alimentaria que se cobra): va en child_id,
    // no en tag (que en un ingreso ya guarda la subcategoría elegida).
    setEditHijoIngreso(children.find(c => c.id === tx.child_id)?.nombre || '')
    setEditTipo(tx.tipo === 'ingreso' ? 'ingreso' : 'gasto')
    setEditMonto(String(Math.abs(Number(tx.monto)) || ''))
    setEditCuotasTotal(String(tx.cuotas_total || 1))
    setEditCuotaNum(String(tx.cuota_numero || 1))
  }

  // Acción manual "Dividir gasto" (D3 Parte 2): reemplaza el viejo botón fijo
  // "Dividir en 3 (Vitto/Amelia/vos)" — cualquier gasto puntual se puede
  // repartir entre "vos" y los hijos que existan, en las proporciones que se
  // quiera. Guarda metadata en la misma fila (nunca duplica transacciones).
  const [repartoModalTx, setRepartoModalTx] = useState(null)
  const [repartoModalSeleccion, setRepartoModalSeleccion] = useState([])

  const opcionesParticipantesReparto = [
    { key: 'yo', tipo: 'yo', childId: null, nombre: 'Vos' },
    ...children.map(c => ({ key: c.id, tipo: 'hijo', childId: c.id, nombre: c.nombre })),
  ]

  const abrirModalReparto = (tx) => {
    const actual = desglosarReparto(tx)
    if (actual) {
      const otrosSeleccion = actual.otros.map(p => {
        const child = children.find(c => c.nombre === p.nombre)
        return { key: child?.id || `hijo-${p.nombre}`, tipo: 'hijo', childId: child?.id || null, nombre: p.nombre, porcentaje: p.porcentaje }
      })
      setRepartoModalSeleccion([{ key: 'yo', tipo: 'yo', childId: null, nombre: 'Vos', porcentaje: actual.yo.porcentaje }, ...otrosSeleccion])
    } else {
      setRepartoModalSeleccion([])
    }
    setRepartoModalTx(tx)
  }

  const toggleParticipanteReparto = (opcion) => {
    setRepartoModalSeleccion(prev => {
      const existe = prev.some(p => p.key === opcion.key)
      const next = existe ? prev.filter(p => p.key !== opcion.key) : [...prev, { ...opcion, porcentaje: 0 }]
      if (next.length === 0) return next
      const parte = Math.floor((100 / next.length) * 100) / 100
      return next.map((p, i) => ({ ...p, porcentaje: i === next.length - 1 ? Math.round((100 - parte * (next.length - 1)) * 100) / 100 : parte }))
    })
  }

  const editarPorcentajeModalReparto = (key, valor) => {
    setRepartoModalSeleccion(prev => prev.map(p => p.key === key ? { ...p, porcentaje: valor } : p))
  }

  const sumaPorcentajesModalReparto = repartoModalSeleccion.reduce((s, p) => s + (parseFloat(p.porcentaje) || 0), 0)
  const sumaModalRepartoValida = repartoModalSeleccion.length > 0 && Math.abs(sumaPorcentajesModalReparto - 100) < 0.01

  const guardarReparto = async () => {
    if (!repartoModalTx) return
    if (!sumaModalRepartoValida) return
    const monto = Number(repartoModalTx.monto) || 0
    const otros = repartoModalSeleccion.filter(p => p.tipo !== 'yo')
    const reparto = otros.length === 0 ? null : {
      tipo: 'manual',
      participantes: otros.map(p => {
        const porcentaje = parseFloat(p.porcentaje) || 0
        return { tipo: p.tipo, ...(p.childId ? { child_id: p.childId } : {}), nombre: p.nombre, porcentaje, monto: Math.round(monto * porcentaje / 100 * 100) / 100 }
      }),
    }
    const { error } = await supabase.from('transactions').update({ reparto }).eq('id', repartoModalTx.id)
    if (error) { window.alert('No se pudo guardar el reparto: ' + error.message + '\nProbá de nuevo.'); setRepartoModalTx(null); return }
    setTransactions(prev => prev.map(t => t.id === repartoModalTx.id ? { ...t, reparto } : t))
    setRepartoModalTx(null)
  }

  const quitarReparto = async () => {
    if (!repartoModalTx) return
    const { error } = await supabase.from('transactions').update({ reparto: null }).eq('id', repartoModalTx.id)
    if (error) { window.alert('No se pudo quitar el reparto: ' + error.message + '\nProbá de nuevo.'); setRepartoModalTx(null); return }
    setTransactions(prev => prev.map(t => t.id === repartoModalTx.id ? { ...t, reparto: null } : t))
    setRepartoModalTx(null)
  }

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Se fuerza la variante de texto plano — sin eso, ↕ (a diferencia de ↑/↓)
  // se renderiza como emoji a color en iOS, con una caja de fondo, y quedaba
  // visualmente distinto a la flecha de la columna ordenada.
  const sortIcon = (key) => {
    if (sortKey !== key) return ' ↕︎'
    return sortDir === 'asc' ? ' ↑︎' : ' ↓︎'
  }

  // Vista de cuenta de ingresos: todas las txs son tipo ingreso
  const esVistaIngresos = !allAccounts && account?.tipo === 'ingreso'

  // Lo que se ORDENA en la columna Categoría tiene que ser lo que se VE en esa
  // columna. Antes ordenaba por `children.nombre || tag || categories.nombre`:
  // una fila asignada a un hijo se ordenaba por el nombre del hijo, que en esa
  // columna no aparece (el hijo se muestra como chip al lado del nombre), así
  // que el orden salía aparentemente arbitrario. Este es el mismo valor que
  // arma la celda en renderTxRow.
  const etiquetaCategoria = useCallback((t) => (
    (esVistaIngresos || t.tipo === 'ingreso')
      ? (t.tag || t.subcategories?.nombre || t.categories?.nombre || '')
      : (t.categories?.nombre || '')
  ), [esVistaIngresos])

  // Valor por el que se filtra cada columna. Tiene que ser EXACTAMENTE lo que se
  // ve en la celda (por eso categoría reusa etiquetaCategoria), o el usuario
  // elegiría un valor de la lista y la fila no aparecería.
  //
  // Cuotas es la excepción a propósito: en la celda dice "2/9", pero filtrar por
  // "2/9" no sirve para nada — lo útil es ver todas las filas de los planes de 9
  // cuotas, o todo lo que no es en cuotas.
  const valorColumna = useCallback((t, key) => {
    if (key === 'nombre') return t.nombre || t.detalle || '—'
    if (key === 'categoria') return etiquetaCategoria(t) || '—'
    if (key === 'cuenta') return t.accounts?.nombre || '—'
    if (key === 'subcategoria') return (t.tipo === 'ingreso' || esVistaIngresos) ? '—' : (t.subcategories?.nombre || '—')
    if (key === 'cuotas') return (t.cuotas_total || 1) > 1 ? `${t.cuotas_total} cuotas` : 'Sin cuotas'
    // La moneda no tiene columna propia: se filtra desde el encabezado de Monto,
    // que es donde se ve. Sin dato se asume pesos, igual que en el resto de la app.
    if (key === 'moneda') return t.moneda || 'ARS'
    return ''
  }, [etiquetaCategoria, esVistaIngresos])

  const columnasFiltrables = useMemo(
    () => ['nombre', 'categoria', 'cuenta', 'subcategoria', 'cuotas', 'moneda'], [])

  // Sin clave = columna sin filtrar (muestra todo). Array vacío = el usuario
  // destildó todo, y ahí no se muestra nada: son dos estados distintos, y
  // representar los dos con [] hacía que al destildar el último valor volviera a
  // aparecer la tabla entera.
  const pasaFiltrosCol = useCallback((t) => columnasFiltrables.every(k => {
    const elegidos = filtrosCol[k]
    return !elegidos || elegidos.includes(valorColumna(t, k))
  }), [columnasFiltrables, filtrosCol, valorColumna])

  const columnasFiltradas = columnasFiltrables.filter(k => Array.isArray(filtrosCol[k]))

  const sortTx = useCallback((list) => {
    return [...list].sort((a, b) => {
      let valA, valB
      if (sortKey === 'fecha') { valA = a.fecha; valB = b.fecha }
      else if (sortKey === 'nombre') { valA = (a.nombre || a.detalle || '').toLowerCase(); valB = (b.nombre || b.detalle || '').toLowerCase() }
      else if (sortKey === 'categoria') { valA = etiquetaCategoria(a).toLowerCase(); valB = etiquetaCategoria(b).toLowerCase() }
      else if (sortKey === 'subcategoria') { valA = (a.subcategories?.nombre || '').toLowerCase(); valB = (b.subcategories?.nombre || '').toLowerCase() }
      else if (sortKey === 'monto') {
        valA = a.tipo === 'ingreso' ? Number(a.monto) : -Number(a.monto)
        valB = b.tipo === 'ingreso' ? Number(b.monto) : -Number(b.monto)
      }
      else if (sortKey === 'cuotas') { valA = a.cuotas_total || 1; valB = b.cuotas_total || 1 }
      else if (sortKey === 'moneda') { valA = a.moneda || ''; valB = b.moneda || '' }
      else if (sortKey === 'cuenta') { valA = (a.accounts?.nombre || '').toLowerCase(); valB = (b.accounts?.nombre || '').toLowerCase() }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [sortKey, sortDir, etiquetaCategoria])


  // Agrupado por mes (no un renglón por statement): si el mismo mes tiene más de
  // un resumen cargado (ej. se volvió a subir el mismo resumen porque
  // faltaban movimientos, o por error) antes aparecía como dos barras
  // separadas para el mismo mes en vez de una sola. Se toma el total MÁS
  // ALTO entre los resúmenes de ese mes (no la suma): si son el mismo
  // resumen cargado dos veces, sumarlos duplicaría el monto — el más alto es
  // la mejor aproximación por default hasta que se corrija a mano (ver
  // guardarTotalFacturadoMes).
  // Se agrupa por el texto tal cual lo guarda statements.periodo ("Junio
  // 2026"), NO convertido a fecha — el texto es lo que hace que dos
  // resúmenes del mismo mes se reconozcan entre sí de forma confiable. Para
  // el orden cronológico (que con texto plano salía mal alfabéticamente) se
  // usa periodoToYearMonth solo como criterio de sort, sin tocar el
  // agrupamiento.
  const barDataPorMes = useMemo(() => {
    const map = new Map()
    statements.forEach(s => {
      const mes = s.periodo || s.fecha_hasta?.slice(0, 7)
      if (!mes) return
      // Un resumen puede traer total_resumen (ARS) y total_dolares (USD) a la
      // vez (ej. una tarjeta con compras en pesos y en dólares ese período —
      // el import de PDF sí guarda ambos campos juntos, ver Dashboard.js) —
      // antes acá se elegía uno solo y el otro se descartaba en silencio. Se
      // guardan los dos; "total"/"moneda" quedan para la barra del gráfico
      // (ARS con preferencia, como antes) y la lista de abajo muestra ambos.
      const montoArs = Number(s.total_resumen) || 0
      const montoUsd = Number(s.total_dolares) || 0
      const prev = map.get(mes) || { mes, total: 0, moneda: 'ARS', totalArs: 0, totalUsd: 0, statementIds: [], resumenes: [] }
      if (montoArs >= prev.totalArs) prev.totalArs = montoArs
      if (montoUsd >= prev.totalUsd) prev.totalUsd = montoUsd
      prev.total = prev.totalArs > 0 ? prev.totalArs : prev.totalUsd
      prev.moneda = prev.totalArs > 0 ? 'ARS' : 'USD'
      prev.statementIds.push(s.id)
      // Las fichas enteras y no solo los ids: cuando el mes tiene más de una, hay que
      // poder ver qué dice cada una (cierre y total) para saber cuál sobra.
      prev.resumenes.push(s)
      map.set(mes, prev)
    })
    return [...map.values()].sort((a, b) => {
      const ka = periodoToYearMonth(a.mes) || a.mes
      const kb = periodoToYearMonth(b.mes) || b.mes
      return ka.localeCompare(kb)
    })
  }, [statements])
  const barData = barDataPorMes

  // Carga manual del total de un mes en "Total facturado por resumen" — si el
  // cálculo automático no da lo esperado (ej. un mes con resúmenes duplicados,
  // o un extracto que no se pudo leer bien), se puede pisar el valor, el
  // nombre del mes y la moneda a mano. Si hay más de un resumen cargado para
  // ese mes, el valor nuevo se guarda en el primero y el resto se deja en 0
  // en las dos monedas, para que la barra muestre justo lo tipeado y no se
  // dupliquen los números. El nombre del mes (periodo) se renombra en TODOS
  // los resúmenes del grupo, para que sigan agrupados juntos.
  const guardarTotalFacturadoMes = async (barMes) => {
    const valor = parseFloat(editBarValor.replace(',', '.'))
    if (isNaN(valor) || valor < 0) return
    const periodo = editBarPeriodo.trim()
    if (!periodo) return
    const [primero, ...resto] = barMes.statementIds
    const campoMonto = editBarMoneda === 'USD' ? 'total_dolares' : 'total_resumen'
    const otroCampo = editBarMoneda === 'USD' ? 'total_resumen' : 'total_dolares'
    const updates = [
      supabase.from('statements').update({ periodo, [campoMonto]: valor, [otroCampo]: 0 }).eq('id', primero),
      ...resto.map(id => supabase.from('statements').update({ periodo, total_resumen: 0, total_dolares: 0 }).eq('id', id)),
    ]
    await Promise.all(updates)
    setStatements(prev => prev.map(s => {
      if (s.id === primero) return { ...s, periodo, [campoMonto]: valor, [otroCampo]: 0 }
      if (resto.includes(s.id)) return { ...s, periodo, total_resumen: 0, total_dolares: 0 }
      return s
    }))
    setEditBarMes(null)
  }

  // Agregar un mes a mano a "Total facturado por resumen", sin depender de
  // haber importado un PDF — crea un resumen "vacío" (sin nombre_archivo,
  // sin transacciones asociadas) que solo existe para guardar el total de
  // ese mes en la moneda elegida.
  const agregarMesFacturado = async () => {
    const valor = parseFloat(String(nuevoMes.valor).replace(',', '.'))
    const periodo = nuevoMes.periodo.trim()
    if (!periodo || isNaN(valor) || valor < 0) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.from('statements').insert({
      user_id: user.id, account_id: account.id, periodo, nombre_archivo: null,
      fecha_desde: null, fecha_hasta: null, fecha_vencimiento: null,
      total_resumen: nuevoMes.moneda === 'USD' ? 0 : valor,
      total_dolares: nuevoMes.moneda === 'USD' ? valor : 0,
      estado: 'completo',
    }).select().single()
    if (error || !data) { window.alert('No se pudo agregar el mes: ' + (error?.message || 'Probá de nuevo.')); return }
    setStatements(prev => [...prev, data])
    setNuevoMes({ periodo: '', valor: '', moneda: 'ARS' })
    setShowAddMes(false)
  }

  // Borra UNA ficha de resumen. Es el caso del mismo resumen cargado dos veces —
  // primero una captura del banco a mitad de ciclo, después el resumen completo —
  // cuando las dos quedaron con fechas de cierre distintas: ahí no son "el mismo ciclo"
  // para la app, el aviso de "A pagar" no las junta, y el único lugar donde se ven es
  // acá, en el mes que comparten.
  // Los movimientos se sueltan antes de borrar, para que la reconciliación los enganche
  // a la ficha que queda en vez de dejarlos colgados (ver reconciliarSueltas).
  const borrarResumenSuelto = async (statementId) => {
    const { error: errorSoltar } = await supabase.from('transactions').update({ statement_id: null }).eq('statement_id', statementId)
    if (errorSoltar) { window.alert('No se pudo borrar el resumen: ' + errorSoltar.message); return }
    const { error } = await supabase.from('statements').delete().eq('id', statementId)
    if (error) { window.alert('No se pudo borrar el resumen: ' + error.message); return }
    setConfirmDeleteResumen(null)
    if (allAccounts && accounts && accounts.length > 0) await fetchAllData()
    else if (account) await fetchData()
  }

  // OJO: se lleva TODOS los resúmenes de ese mes, no uno — la fila lo dice cuando hay
  // más de uno ("N resúmenes cargados"). Para sacar solo uno está borrarResumenSuelto,
  // desplegando la fila, o el botón del aviso de "A pagar" (borrarResumenRepetido).
  const eliminarMesFacturado = async (barMes) => {
    // Soltar los movimientos ANTES de borrar: si no, quedan apuntando a un resumen que
    // ya no existe, fuera del detalle de todo resumen.
    await supabase.from('transactions').update({ statement_id: null }).in('statement_id', barMes.statementIds)
    await supabase.from('statements').delete().in('id', barMes.statementIds)
    setTransactions(prev => prev.map(t => barMes.statementIds.includes(t.statement_id) ? { ...t, statement_id: null } : t))
    setStatements(prev => prev.filter(s => !barMes.statementIds.includes(s.id)))
    setConfirmDeleteMes(null)
  }

  // Borra los resúmenes repetidos de un ciclo — los que la app ya está ignorando,
  // nunca el que se está mostrando (ver cuentasConResumenRepetido).
  //
  // Los movimientos que colgaban del repetido se sueltan ANTES de borrarlo: si se
  // borrara el resumen a secas, quedarían apuntando a una fila que ya no existe, no
  // aparecerían en el detalle de ningún resumen y la reconciliación tampoco los
  // rescataría (no encuentra el resumen, ver reconciliarSueltas). Sueltos, el fetch
  // siguiente los engancha solos al resumen que quedó, que es el mismo ciclo.
  const borrarResumenRepetido = async (repetido) => {
    const ids = repetido.ignorados.map(s => s.id)
    if (ids.length === 0) return
    setBorrandoRepetido(repetido.account_id)
    const { error: errorSoltar } = await supabase.from('transactions').update({ statement_id: null }).in('statement_id', ids)
    if (errorSoltar) {
      setBorrandoRepetido(null)
      window.alert('No se pudo borrar el resumen repetido: ' + errorSoltar.message)
      return
    }
    const { error } = await supabase.from('statements').delete().in('id', ids)
    if (error) {
      setBorrandoRepetido(null)
      window.alert('No se pudo borrar el resumen repetido: ' + error.message)
      return
    }
    setConfirmBorrarRepetido(null)
    // Refetch completo y no un filtro del estado local: recién ahí corre la
    // reconciliación que devuelve los movimientos sueltos al resumen que quedó.
    if (allAccounts && accounts && accounts.length > 0) await fetchAllData()
    else if (account) await fetchData()
    setBorrandoRepetido(null)
  }

  // Corrección manual del total en dólares de un resumen de tarjeta (columna
  // "total_dolares") — para cuando la lectura automática del PDF no lo captó
  // bien, típicamente un saldo A FAVOR en dólares (el resumen lo informa como
  // negativo) que quedó sin leerse y la app termina calculando el dólar solo
  // a partir de las compras nuevas en dólares de ese resumen, ignorando el
  // saldo arrastrado. Acepta negativo a propósito (saldo a favor).
  const guardarTotalDolaresStatement = async (statementId) => {
    const valor = parseFloat(String(editUsdValor).replace(',', '.'))
    if (isNaN(valor)) return
    const { error } = await supabase.from('statements').update({ total_dolares: valor }).eq('id', statementId)
    if (error) { window.alert('No se pudo guardar el cambio: ' + error.message); return }
    setStatements(prev => prev.map(s => s.id === statementId ? { ...s, total_dolares: valor } : s))
    setEditUsdStatementId(null)
  }

  const mesTxs = useMemo(() => selectedMeses.length > 0
    ? transactions.filter(t => selectedMeses.some(m => t.fecha?.startsWith(m)) && t.tipo !== 'neutro')
    : []
  , [transactions, selectedMeses])

  const getTC = (mes) => {
    const mesActual = mesActualLocal()
    if (mes === mesActual) return parseFloat(tipoCambio) || 1
    if (mes && tcMap && tcMap[mes]) return Number(tcMap[mes])
    return parseFloat(tipoCambio) || 1
  }

  // TC efectivo para el período seleccionado (usa el del primer mes seleccionado)
  const tcEfectivo = getTC(selectedMeses[0] || mesActualLocal())
  const getTCEUR = useCallback((mes) => {
    const mesActual = mesActualLocal()
    if (!mes || mes === mesActual) return parseFloat(tipoCambioEUR) || 0
    if (tcMapEUR?.[mes]) return Number(tcMapEUR[mes])
    return parseFloat(tipoCambioEUR) || 0
  }, [tipoCambioEUR, tcMapEUR])
  const tcEUR = getTCEUR(selectedMeses[0] || mesActualLocal())

  const getChildName = useCallback((t) => t.children?.nombre || (t.child_id ? children.find(c => c.id === t.child_id)?.nombre : null) || (t.tag || null), [children])

  // Bloque de agregaciones para gráficos/cards (bubble chart, totales por moneda,
  // comparativa vs mes anterior, etc.) — memoizado como un todo porque son cálculos
  // encadenados sobre mesTxs/transactions que antes se recalculaban completos en
  // CADA render (hover, scroll, abrir/cerrar dropdowns, etc.), no solo cuando
  // cambiaban los datos. Ningún cálculo interno se modificó: se movió tal cual
  // adentro del useMemo y se devuelve lo que se usa más abajo en el render.
  const chartsMemo = useMemo(() => {
  // "Total por mes" de ingresos: incluye USD/EUR convertidos (antes solo sumaba
  // ARS) — USD con el TC del mes de cada movimiento (según el tipo de dólar
  // elegido), nunca el TC de hoy para algo viejo.
  // Se limita a los últimos 12 meses: con todo el historial desde la
  // creación de la cuenta, meses viejos con montos chicos quedaban con
  // barras casi invisibles al lado de los meses recientes (mucho más
  // altos), dando la sensación de que "no había barras".
  const ingresosBarData = (() => {
    const byMonth = {}
    transactions.filter(t => t.tipo === 'ingreso').forEach(t => {
      const m = t.fecha?.slice(0, 7)
      if (!m) return
      const monto = Number(t.monto)
      const equivArs = t.moneda === 'USD'
        ? monto * tcDeMovimiento(t, tcMap, tipoCambio)
        : t.moneda === 'EUR'
          ? monto * getTCEUR(m)
          : monto
      byMonth[m] = (byMonth[m] || 0) + equivArs
    })
    return Object.keys(byMonth).sort().slice(-12).map(m => ({ mes: mesLabel(m), total: byMonth[m] }))
  })()

  // Único punto de entrada para descomponer gastos en categoría vs. persona
  // (reparto/asignación directa) — ver derivarPorcionesGasto/agregarGastosPor*.
  const tcParamsGasto = { tcMap, tipoCambio, tcMapEUR, tipoCambioEUR, children }
  const gastosParaGrafico = mesTxs.filter(t => t.tipo === 'gasto')

  // Único dataset para Donut y Barras agrupadas por categoría: cada gasto se
  // descompone en sus porciones — los hijos son entradas propias con TODO lo
  // suyo (reparto o asignación directa), y cada categoría muestra solo lo que
  // no les corresponde a ellos, sin duplicar nada.
  const categoriaBubbleData = agregarGastosPorCategoria(gastosParaGrafico, tcParamsGasto)
  // Hijos con plata atribuida este período (reparto o asignación directa) —
  // decide si se muestra el toggle "Agrupar: Categoría/Persona".
  const childNames = categoriaBubbleData.filter(e => e.tipo === 'persona').map(e => e.name)

  // Modo "Persona": cada hijo con TODAS sus porciones (reparto o asignación
  // directa), sin importar de qué categoría vengan, más "Personal" con el
  // resto (la parte de "vos" y lo que no tiene reparto ni asignación).
  const personaBubbleData = agregarGastosPorPersona(gastosParaGrafico, tcParamsGasto)

  const totalARS = mesTxs.filter(t => t.moneda === 'ARS' && t.tipo === 'gasto').reduce((s, t) => s + Number(t.monto), 0)
  const totalUSD = mesTxs.filter(t => t.moneda === 'USD' && t.tipo === 'gasto').reduce((s, t) => s + Number(t.monto), 0)
  const totalEUR = mesTxs.filter(t => t.moneda === 'EUR' && t.tipo === 'gasto').reduce((s, t) => s + Number(t.monto), 0)
  const totalIngresosARS = mesTxs.filter(t => t.moneda === 'ARS' && t.tipo === 'ingreso').reduce((s, t) => s + Number(t.monto), 0)
  const totalIngresosUSD = mesTxs.filter(t => t.moneda === 'USD' && t.tipo === 'ingreso').reduce((s, t) => s + Number(t.monto), 0)
  const totalIngresosEUR = mesTxs.filter(t => t.moneda === 'EUR' && t.tipo === 'ingreso').reduce((s, t) => s + Number(t.monto), 0)
  const hayIngresos = allAccounts && (totalIngresosARS > 0 || totalIngresosUSD > 0 || totalIngresosEUR > 0)

  const ingresoBubbleData = esVistaIngresos
    ? Object.values(
        mesTxs.filter(t => t.tipo === 'ingreso').reduce((acc, t) => {
          const cat = t.tag || t.nombre || 'Sin categoría'
          // getTCEUR(t.fecha) en vez de tcEUR fijo — este último solo refleja
          // la tasa del primer mes seleccionado (selectedMeses[0]), así que con
          // varios meses elegidos convertía TODOS los ingresos en EUR con la
          // tasa de uno solo de ellos.
          const monto = t.moneda === 'USD' ? Number(t.monto) * (tcDeMovimiento(t, tcMap, tipoCambio) || parseFloat(tcEfectivo) || 0) : t.moneda === 'EUR' ? Number(t.monto) * getTCEUR(t.fecha?.slice(0, 7)) : Number(t.monto)
          if (!acc[cat]) acc[cat] = { name: cat, value: 0, originalARS: 0, originalUSD: 0, originalEUR: 0 }
          acc[cat].value += monto
          if (t.moneda === 'ARS') acc[cat].originalARS += Number(t.monto)
          else if (t.moneda === 'EUR') acc[cat].originalEUR += Number(t.monto)
          else acc[cat].originalUSD += Number(t.monto)
          return acc
        }, {})
      ).sort((a, b) => b.value - a.value)
    : []
  // Único dataset para Donut y Barras: las dos vistas consumen exactamente esto, así
  // que togglear entre ellas nunca puede mostrar ítems/montos distintos — solo cambia
  // cómo se dibuja el mismo dato. Se usa tal cual solo en la vista de ingresos —
  // en gastos, categoriaBubbleData/personaBubbleData se muestran los dos juntos
  // (ver el render más abajo), ya no hace falta elegir entre uno u otro.
  const displayChartData = esVistaIngresos ? ingresoBubbleData : categoriaBubbleData
  // resolveIcon/resolveColor: para categorías/subcategorías de GASTO (usado en chips de
  // transacciones, tarjetas de statement, etc., no solo en el gráfico). resolveIconIngreso/
  // resolveColorIngreso: mismo criterio para categorías de INGRESO. Ambos pares llaman al
  // resolver compartido (resolveCategoryIcon/resolveCategoryColor, exportado arriba) — es
  // la única fuente de color/ícono por categoría de toda la app.
  const resolveIcon = (name) => {
    const child = children.find(c => c.nombre === name)
    return resolveCategoryIcon(name, { customIcons, defaultIcon: child ? (child.icono || '👧') : undefined })
  }
  const resolveColor = (name) => resolveCategoryColor(name)
  const resolveIconIngreso = (name) => resolveCategoryIcon(name, { customIcons, isIncome: true })
  const resolveColorIngreso = (name) => resolveCategoryColor(name, { isIncome: true })
  // Ícono/color para una entrada del gráfico (categoría, persona/hijo o categoría de
  // ingreso, según la vista) — una sola función para Donut y Barras, así el color de
  // cada entrada es siempre el mismo sin importar en cuál de los gráficos aparezca.
  // "Personal" (el bucket de "vos" en el gráfico por persona) ya resuelve bien acá:
  // resolveIcon mira customIcons primero y cae a CATEGORY_CONFIG['Personal'] = 👤.
  const getChartIcon = (name) => esVistaIngresos ? resolveIconIngreso(name) : resolveIcon(name)
  const getChartColor = (name) => esVistaIngresos ? resolveColorIngreso(name) : resolveColor(name)
  const effectiveChartType = chartType

  // "Categorías Top": mismas porciones que el donut/barras (categoriaBubbleData),
  // sin las entradas de hijos — así nunca puede dar un número distinto al del
  // donut para la misma categoría.
  const catTopList = categoriaBubbleData
    .filter(e => e.tipo === 'categoria')
    .slice(0, 3)
    .map(e => [e.name, e.value])

  // "Pago tarjetas del mes": pagos/reintegros neutros cargados en la cuenta de
  // cada tarjeta de crédito (así es como ya se registran — ver reconciliarSueltas
  // más arriba, que los excluye del resumen porque restan del saldo pendiente en
  // vez de sumar una compra más), agrupados por tarjeta para el período elegido.
  const pagosTarjetasGeneral = (() => {
    if (!allAccounts || selectedMeses.length === 0) return []
    const porCuenta = {}
    transactions.forEach(t => {
      if (t.tipo !== 'neutro') return
      if (!t.fecha || !selectedMeses.some(m => t.fecha.startsWith(m))) return
      const cuenta = (accounts || []).find(a => a.id === t.account_id)
      if (!cuenta || cuenta.tipo !== 'credito') return
      const monto = Number(t.monto) || 0
      let montoArs = monto
      if (t.moneda === 'USD') {
        const tcTx = tcDeMovimiento(t, tcMap, tipoCambio)
        montoArs = tcTx > 0 ? monto * tcTx : monto
      } else if (t.moneda === 'EUR') {
        const tcTx = tcEURDeMovimiento(t, tcMapEUR, tipoCambioEUR)
        montoArs = tcTx > 0 ? monto * tcTx : monto
      }
      porCuenta[cuenta.nombre] = (porCuenta[cuenta.nombre] || 0) + montoArs
    })
    return Object.entries(porCuenta).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  })()

  const puedeComparar = selectedMeses.length === 1
  const mesSeleccionado = puedeComparar ? selectedMeses[0] : null
  const idxMesSeleccionado = mesSeleccionado ? mesesDisponibles.indexOf(mesSeleccionado) : -1
  const mesAnterior = idxMesSeleccionado >= 0 && idxMesSeleccionado < mesesDisponibles.length - 1
    ? mesesDisponibles[idxMesSeleccionado + 1]
    : null
  // Antes estas comparativas ("vs mes anterior") solo miraban moneda === 'ARS' y
  // descartaban en silencio cualquier gasto/ingreso en USD o EUR. Ahora se
  // convierten con el TC propio de cada movimiento, igual que el resto de la app.
  const totalDelMesConvertido = (mes) => (mes ? transactions.filter(t => t.fecha?.startsWith(mes) && t.tipo === 'gasto') : [])
    .reduce((s, t) => {
      const monto = Number(t.monto) || 0
      if (t.moneda === 'USD') { const tcTx = tcDeMovimiento(t, tcMap, tipoCambio); return tcTx > 0 ? s + monto * tcTx : s }
      if (t.moneda === 'EUR') { const tcTx = tcEURDeMovimiento(t, tcMapEUR, tipoCambioEUR); return tcTx > 0 ? s + monto * tcTx : s }
      return s + monto
    }, 0)
  const totalSeleccionado = totalDelMesConvertido(mesSeleccionado)
  const totalAnteriorMonto = totalDelMesConvertido(mesAnterior)
  const diffPct = puedeComparar && totalAnteriorMonto > 0 ? Math.round(((totalSeleccionado - totalAnteriorMonto) / totalAnteriorMonto) * 100) : null
  const diffMonto = totalSeleccionado - totalAnteriorMonto
  // Comparativa de ingresos vs mes anterior
  const totalIngDelMesConvertido = (mes) => (mes ? transactions.filter(t => t.fecha?.startsWith(mes) && t.tipo === 'ingreso') : [])
    .reduce((s, t) => {
      const monto = Number(t.monto) || 0
      if (t.moneda === 'USD') { const tcTx = tcDeMovimiento(t, tcMap, tipoCambio); return tcTx > 0 ? s + monto * tcTx : s }
      if (t.moneda === 'EUR') { const tcTx = tcEURDeMovimiento(t, tcMapEUR, tipoCambioEUR); return tcTx > 0 ? s + monto * tcTx : s }
      return s + monto
    }, 0)
  const totalIngSeleccionado = totalIngDelMesConvertido(mesSeleccionado)
  const totalIngAnterior = totalIngDelMesConvertido(mesAnterior)
  const diffIngPct = puedeComparar && mesAnterior && totalIngAnterior > 0 ? Math.round(((totalIngSeleccionado - totalIngAnterior) / totalIngAnterior) * 100) : null
  const diffIngMonto = totalIngSeleccionado - totalIngAnterior

    return {
      ingresosBarData, displayChartData, categoriaBubbleData, personaBubbleData, childNames,
      resolveIcon, resolveColor, getChartIcon, getChartColor,
      catTopList, pagosTarjetasGeneral,
      totalARS, totalUSD, totalEUR, totalIngresosARS, totalIngresosUSD, totalIngresosEUR, hayIngresos,
      mesAnterior, diffPct, diffMonto, diffIngPct, diffIngMonto, effectiveChartType,
    }
  }, [transactions, mesTxs, tcMap, tipoCambio, tcEfectivo, tcMapEUR, tipoCambioEUR, esVistaIngresos, allAccounts, accounts, children, customIcons, selectedMeses, mesesDisponibles, chartType, getTCEUR])

  const {
    ingresosBarData, displayChartData, categoriaBubbleData, personaBubbleData, childNames,
    resolveIcon, resolveColor, getChartIcon, getChartColor,
    catTopList, pagosTarjetasGeneral,
    totalARS, totalUSD, totalEUR, totalIngresosARS, totalIngresosUSD, totalIngresosEUR, hayIngresos,
    mesAnterior, diffPct, diffMonto, diffIngPct, diffIngMonto, effectiveChartType,
  } = chartsMemo

  const matchSearch = useCallback((t) => {
    if (!searchQuery) return true
    const q = norm(searchQuery)
    return (
      norm(t.nombre).includes(q) ||
      // El detalle original (el texto tal cual vino del banco/tarjeta) se
      // busca siempre, no solo cuando no hay un "nombre" limpio — si no,
      // buscar algo que solo aparece en el texto original (ej. el nombre de
      // un titular adicional, "FEDERICO — LPBS") no encontraba nada en
      // cuanto la fila tenía un nombre limpio asignado.
      norm(t.detalle).includes(q) ||
      // Sin categoría asignada cuenta como "A Identificar": el gráfico las
      // agrupa bajo esa etiqueta y el buscador tiene que encontrarlas igual
      norm(t.categories?.nombre || (t.tipo !== 'ingreso' ? 'A Identificar' : '')).includes(q) ||
      norm(t.subcategories?.nombre).includes(q) ||
      norm(t.children?.nombre).includes(q) ||
      norm(t.tag).includes(q) ||
      norm(t.titular).includes(q) ||
      norm(t.tipo).includes(q) ||
      norm(t.moneda).includes(q) ||
      // Nombre de la cuenta (ej. "Amex Galicia") — antes no se buscaba, así
      // que escribir "amex" no encontraba nada por más que se viera esa
      // cuenta en la columna "Cuenta" de la tabla.
      norm(t.accounts?.nombre).includes(q) ||
      (t.fecha || '').includes(q) ||
      norm(formatFecha(t.fecha)).includes(q) ||
      // Mes en palabras (ej. "julio" o "julio 2026") — la fecha numérica ya
      // se busca arriba, pero buscar el mes escrito no encontraba nada.
      norm(`${MESES[parseInt((t.fecha || '').slice(5, 7), 10) - 1] || ''} ${(t.fecha || '').slice(0, 4)}`).includes(q) ||
      String(t.monto || '').includes(q)
    )
  }, [searchQuery])

  // Pipeline de la tabla de movimientos (filtro por mes/cuenta/búsqueda, split
  // sin-identificar/identificadas, agrupado de gastos divididos en 3) — memoizado
  // como un todo porque filtra/ordena hasta 1000+ transacciones y antes se
  // recalculaba completo en cada render, aunque el cambio fuera ajeno (ej. hover
  // en el gráfico). Ningún cálculo interno se modificó.
  const tablaMemo = useMemo(() => {
  const txFiltradas = (selectedMeses.length > 0
    ? transactions.filter(t => selectedMeses.some(m => t.fecha?.startsWith(m)))
    : transactions
  ).filter(t => !filtroCuenta || t.account_id === filtroCuenta)
  const txNoNeutras = txFiltradas.filter(t => t.tipo !== 'neutro')
  const txNeutras = txFiltradas.filter(t => t.tipo === 'neutro' && matchSearch(t))

  const sinIdentificar = txNoNeutras
    .filter(t => (t.estado === 'a_identificar' || t.categories?.nombre === 'A Identificar') && matchSearch(t))
    .sort((a, b) => (a.nombre || a.detalle || '').toLowerCase().localeCompare((b.nombre || b.detalle || '').toLowerCase(), 'es'))
  // Sin el filtro por columna aplicado: es de acá que sale la lista de valores
  // que ofrece cada panel. Si saliera de la lista ya filtrada, al elegir una
  // categoría desaparecerían todas las demás opciones y no habría forma de
  // agregar una segunda sin limpiar el filtro.
  const identificadasSinFiltroCol = sortTx(txNoNeutras.filter(t => t.estado !== 'a_identificar' && t.categories?.nombre !== 'A Identificar' && matchSearch(t)))
  const identificadas = identificadasSinFiltroCol.filter(pasaFiltrosCol)

  // Los gastos divididos con hijos por alias de tipo "split" se guardan como 2
  // transacciones reales separadas, para que totales, gráficos y "a pagar" por
  // hijo funcionen sin lógica especial en ningún otro lado.
  // Acá solo agrupamos esas filas para la VISTA de la tabla: mismo día/cuenta/nombre/
  // categoría/subcategoría/moneda, con exactamente una fila por "clase" de tag (sin tag =
  // "yo", o un hijo), ordenadas por monto para desambiguar cuando el mismo día hay más de
  // una compra idéntica dividida. No toca los datos guardados.
  const gruposSplitPorTxId = (() => {
    const buckets = new Map()
    identificadas.forEach(t => {
      if (t.tipo !== 'gasto') return
      const key = [t.account_id || '', t.fecha || '', norm(t.nombre || t.detalle || ''), t.category_id || '', t.subcategory_id || '', t.moneda || ''].join('|')
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(t)
    })
    const porId = new Map()
    buckets.forEach(txsBucket => {
      if (txsBucket.length < 2) return
      const porTag = new Map()
      txsBucket.forEach(t => {
        const tagKey = t.tag || '__sin_tag__'
        if (!porTag.has(tagKey)) porTag.set(tagKey, [])
        porTag.get(tagKey).push(t)
      })
      const clases = [...porTag.values()]
      if (clases.length < 2 || clases.length > 3) return
      const k = clases[0].length
      if (k < 1 || !clases.every(c => c.length === k)) return
      clases.forEach(c => c.sort((a, b) => Math.abs(Number(a.monto) || 0) - Math.abs(Number(b.monto) || 0)))
      for (let i = 0; i < k; i++) {
        const txsGrupo = clases.map(c => c[i])
        const key = `grupo-${txsGrupo.map(t => t.id).sort().join('-')}`
        const total = txsGrupo.reduce((s, t) => s + (Number(t.monto) || 0), 0)
        const hijos = txsGrupo.map(t => t.tag).filter(Boolean)
        txsGrupo.forEach(t => porId.set(t.id, { key, txs: txsGrupo, total, hijos }))
      }
    })
    return porId
  })()

  const filasTabla = []
  const gruposYaAgregados = new Set()
  identificadas.forEach(tx => {
    const grupo = gruposSplitPorTxId.get(tx.id)
    if (!grupo) { filasTabla.push({ tipo: 'single', tx }); return }
    if (gruposYaAgregados.has(grupo.key)) return
    gruposYaAgregados.add(grupo.key)
    const enEdicion = grupo.txs.some(t => t.id === editingTx)
    filasTabla.push({ tipo: 'grupo', grupo, expandido: enEdicion || expandedSplits.has(grupo.key) })
  })

    return { txFiltradas, txNeutras, sinIdentificar, identificadas, identificadasSinFiltroCol, filasTabla }
  }, [transactions, selectedMeses, filtroCuenta, matchSearch, sortTx, editingTx, expandedSplits, pasaFiltrosCol])

  const { txFiltradas, txNeutras, sinIdentificar, identificadas, identificadasSinFiltroCol, filasTabla } = tablaMemo

  // Fila de movimiento con columnas progresivas (fecha/nombre/monto siempre
  // visibles; categoría → cuenta → subcategoría → cuotas se agregan con más
  // ancho disponible, ver colVisible) y expandible: al clickear, una fila de
  // detalle debajo muestra todos los campos ocultos más las acciones. Nunca
  // scroll horizontal ni columnas comprimidas hasta partir el texto — lo que
  // no entra se oculta, no se aprieta. La edición (cualquier ancho) usa el
  // mismo formulario apilado que antes era solo para mobile — un ancho de
  // columna angosto nunca alcanza para inputs de todos los campos a la vez.
  const renderTxRow = (tx) => {
    if (editingTx === tx.id) {
      return (
        <tr key={tx.id} style={styles.tr}>
          {renderEditStackMobile(tx, numColsTabla)}
        </tr>
      )
    }
    const esIngresoTx = esVistaIngresos || tx.tipo === 'ingreso'
    // Igual que el respaldo de startEdit: los ingresos importados de tarjeta no
    // llenan "tag" pero sí tienen subcategory_id/category_id reales — sin esto
    // se veían en blanco en la tabla aunque la categoría estuviera bien guardada.
    const ingresoLabel = tx.tag || tx.subcategories?.nombre || tx.categories?.nombre || '—'
    const reparto = !esIngresoTx ? desglosarReparto(tx) : null
    const expandido = filaExpandida === tx.id
    const detailLabel = { fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }
    const detailValue = { margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }
    return (
      <React.Fragment key={tx.id}>
        <tr
          style={{ ...styles.tr, cursor: 'pointer' }}
          onClick={() => setFilaExpandida(prev => prev === tx.id ? null : tx.id)}
        >
          <td style={{ ...styles.td, whiteSpace: 'nowrap', wordBreak: 'normal' }}>{formatFechaCorta(tx.fecha)}</td>
          <td style={ellipsisCell} title={tx.nombre || tx.detalle}>
            {tx.nombre || tx.detalle}
            {/* Hijo/a asignado — en un gasto puede venir por child_id o por tag
                (modelo viejo); en un ingreso el tag ya está ocupado por la
                subcategoría, así que ahí SOLO vale child_id (tx.children, el
                join por FK). Antes esto no se mostraba nunca en un ingreso. */}
            {(esIngresoTx ? tx.children?.nombre : (tx.children?.nombre || tx.tag)) && (
              <span style={{ fontSize: '11px', color: '#8C7B8C', marginLeft: '6px' }}>👧 {esIngresoTx ? tx.children?.nombre : (tx.children?.nombre || tx.tag)}</span>
            )}
            {reparto && (
              <span style={{ fontSize: '11px', color: '#5C8AA8', marginLeft: '6px' }}>🔀</span>
            )}
          </td>
          {colVisible.categoria && (
            <td style={ellipsisCell}>
              {esIngresoTx ? (
                <span title={ingresoLabel} style={{ backgroundColor: darkMode ? '#3A2F4A' : '#EDE8F4', color: darkMode ? '#C8B4E8' : '#5C4F5C', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500' }}>
                  {ingresoLabel}
                </span>
              ) : (
                <span title={tx.categories?.nombre || ''} style={{ backgroundColor: (resolveColor(tx.categories?.nombre) || '#E0E0E0'), color: '#3a3a3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500' }}>
                  {resolveIcon(tx.categories?.nombre || '')} {tx.categories?.nombre || '—'}
                </span>
              )}
            </td>
          )}
          {colVisible.cuenta && (
            <td style={ellipsisCell}><span style={{fontSize:'12px', color: muted}}>{tx.accounts?.nombre || '—'}</span></td>
          )}
          {colVisible.subcategoria && (
            <td style={ellipsisCell}><span style={{fontSize:'12px', color: muted}}>{esIngresoTx ? '' : (tx.subcategories?.nombre || '—')}</span></td>
          )}
          {colVisible.cuotas && (
            <td style={{ ...styles.td, whiteSpace: 'nowrap', wordBreak: 'normal' }}>{esIngresoTx ? '—' : (tx.cuotas_total > 1 ? `${tx.cuota_numero}/${tx.cuotas_total}` : '—')}</td>
          )}
          <td style={{...styles.td, textAlign:'right', fontWeight:'600', whiteSpace: 'nowrap', wordBreak: 'normal',
            color: darkMode ? '#F0EDEC' : '#2d2d2d'}}
            title={tcTooltipDe(tx, tcMap, tipoCambio)}>
            {tx.tipo === 'ingreso' ? '+' : '-'}{monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
          </td>
          <td style={{ ...styles.td, textAlign: 'center', width: '28px', padding: '10px 4px', color: darkMode ? '#8A7A8A' : '#75757a' }}>{expandido ? '▾' : '▸'}</td>
        </tr>
        {expandido && (
          <tr style={styles.tr}>
            <td colSpan={numColsTabla} style={{ ...styles.td, backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', padding: '2px 2px 10px' }}>
                <div style={{ flexBasis: '100%' }}>
                  <p style={detailLabel}>Nombre</p>
                  <p style={detailValue}>{tx.nombre || tx.detalle || '—'}</p>
                </div>
                <div>
                  <p style={detailLabel}>Cuenta</p>
                  <p style={detailValue}>{tx.accounts?.nombre || '—'}</p>
                </div>
                {!esIngresoTx && (
                  <div>
                    <p style={detailLabel}>Categoría</p>
                    <p style={detailValue}>{resolveIcon(tx.categories?.nombre || '')} {tx.categories?.nombre || '—'}</p>
                  </div>
                )}
                {esIngresoTx && (
                  <div>
                    <p style={detailLabel}>Categoría</p>
                    <p style={detailValue}>{ingresoLabel}</p>
                  </div>
                )}
                {!esIngresoTx && (
                  <div>
                    <p style={detailLabel}>Subcategoría</p>
                    <p style={detailValue}>{tx.subcategories?.nombre || '—'}</p>
                  </div>
                )}
                {/* Antes esto solo se veía entrando a "Editar" — en cuentas con
                    hijos cargados, había que abrir el formulario de edición
                    para saber si un gasto ya estaba asignado a alguno. */}
                {!esIngresoTx && getChildName(tx) && (
                  <div>
                    <p style={detailLabel}>Hijo</p>
                    <p style={detailValue}>👧 {getChildName(tx)}</p>
                  </div>
                )}
                {!esIngresoTx && (
                  <div>
                    <p style={detailLabel}>Cuotas</p>
                    <p style={detailValue}>{tx.cuotas_total > 1 ? `${tx.cuota_numero}/${tx.cuotas_total}` : '—'}</p>
                  </div>
                )}
                <div>
                  <p style={detailLabel}>Moneda</p>
                  <p style={detailValue}>{tx.moneda || 'ARS'}</p>
                </div>
                {reparto && (
                  <div style={{ width: '100%' }}>
                    <p style={detailLabel}>Reparto</p>
                    <p style={detailValue}>Dividido: vos {reparto.yo.porcentaje}% · {reparto.otros.map(p => `${p.nombre} ${p.porcentaje}%`).join(' · ')}</p>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button style={styles.accionBtn} onClick={() => startEdit(tx)}>✏️ Editar</button>
                {tx.tipo === 'gasto' && !esVistaIngresos && children.length > 0 && (
                  <button style={styles.accionBtn} onClick={() => abrirModalReparto(tx)}>🔀 Dividir</button>
                )}
                <button style={{...styles.accionBtn, ...styles.accionBtnDanger}} onClick={() => handleDeleteTx(tx)}>🗑️ Borrar</button>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    )
  }

  const toggleGrupoExpandido = (key, abrir) => setExpandedSplits(prev => {
    const next = new Set(prev)
    if (abrir) next.add(key); else next.delete(key)
    return next
  })

  const renderFilaGrupo = (grupo, expandido) => {
    const repTx = grupo.txs[0]
    if (expandido) {
      return (
        <React.Fragment key={grupo.key}>
          <tr style={{ ...styles.tr, opacity: 0.85 }}>
            <td colSpan={numColsTabla} style={{ ...styles.td, paddingTop: '6px', paddingBottom: '6px' }}>
              <button
                onClick={() => toggleGrupoExpandido(grupo.key, false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: darkMode ? '#8C7B8C' : '#5C4F5C', display: 'flex', alignItems: 'center', gap: '6px', padding: 0, fontFamily: '"Montserrat", sans-serif' }}
              >
                ▾ Dividido en {grupo.txs.length}{grupo.hijos.length > 0 ? ` · ${grupo.hijos.join(', ')}` : ''} — ocultar detalle
              </button>
            </td>
          </tr>
          {grupo.txs.map(tx => renderTxRow(tx))}
        </React.Fragment>
      )
    }
    return (
      <tr key={grupo.key} style={{ ...styles.tr, cursor: 'pointer' }} onClick={() => toggleGrupoExpandido(grupo.key, true)}>
        <td style={{ ...styles.td, whiteSpace: 'nowrap', wordBreak: 'normal' }}>{formatFechaCorta(repTx.fecha)}</td>
        <td style={ellipsisCell} title={repTx.nombre || repTx.detalle}>
          {repTx.nombre || repTx.detalle}
          <span style={{ fontSize: '11px', color: darkMode ? '#C8B4E8' : '#5C4F5C', marginLeft: '6px' }}>
            🔀 {grupo.txs.length}{grupo.hijos.length > 0 ? ` · ${grupo.hijos.join(', ')}` : ''}
          </span>
        </td>
        {colVisible.categoria && (
          <td style={ellipsisCell}>
            <span title={repTx.categories?.nombre || ''} style={{ backgroundColor: (resolveColor(repTx.categories?.nombre) || '#E0E0E0'), color: '#3a3a3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500' }}>
              {resolveIcon(repTx.categories?.nombre || '')} {repTx.categories?.nombre || '—'}
            </span>
          </td>
        )}
        {colVisible.cuenta && (
          <td style={ellipsisCell}><span style={{fontSize:'12px', color: muted}}>{repTx.accounts?.nombre || '—'}</span></td>
        )}
        {colVisible.subcategoria && (
          <td style={ellipsisCell}><span style={{fontSize:'12px', color: muted}}>{repTx.subcategories?.nombre || '—'}</span></td>
        )}
        {colVisible.cuotas && (
          <td style={{ ...styles.td, whiteSpace: 'nowrap', wordBreak: 'normal' }}>{repTx.cuotas_total > 1 ? `${repTx.cuota_numero}/${repTx.cuotas_total}` : '—'}</td>
        )}
        <td style={{...styles.td, textAlign:'right', fontWeight:'600', whiteSpace: 'nowrap', wordBreak: 'normal',
          color: darkMode ? '#F0EDEC' : '#2d2d2d'}}>
          -{monedaSymbol(repTx.moneda)} {formatMontoFull(grupo.total)}
        </td>
        <td style={{ ...styles.td, textAlign: 'center', width: '28px', padding: '10px 4px', color: darkMode ? '#8A7A8A' : '#75757a' }}>▸</td>
      </tr>
    )
  }

  const handleExportCSV = () => {
    const q = (val) => {
      const s = String(val ?? '')
      return `"${s.replace(/"/g, '""')}"`
    }
    // Se exporta lo que se está viendo: si hay filtros de columna puestos, el CSV
    // los respeta (sin ellos el archivo traía filas que la tabla no mostraba).
    const txParaExportar = txFiltradas.filter(matchSearch).filter(pasaFiltrosCol)
    const rows = [
      ['Fecha', 'Nombre', 'Categoría', 'Subcategoría', 'Moneda', 'Monto', 'Tipo', 'Cuotas'],
      ...txParaExportar.map(t => [
        t.fecha || '',
        (t.nombre || t.detalle || ''),
        (t.categories?.nombre || ''),
        (t.subcategories?.nombre || ''),
        t.moneda || 'ARS',
        t.monto || 0,
        t.tipo || '',
        t.cuotas_total > 1 ? `cuota ${t.cuota_numero} de ${t.cuotas_total}` : '',
      ])
    ]
    const csv = rows.map(r => r.map(q).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const periodoLabel = selectedMeses.length === 0 ? 'todos'
      : selectedMeses.length === 1 ? selectedMeses[0]
      : `${selectedMeses[0]}_al_${selectedMeses[selectedMeses.length - 1]}`
    a.download = `ma-finance-${periodoLabel}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Reemplaza el window.confirm nativo (bloqueaba la pestaña y podía sentirse
  // como que la app "se traba") por un modal propio, mismo patrón que el de
  // "Dividir gasto" de arriba.
  const [deleteConfirmTx, setDeleteConfirmTx] = useState(null)
  const handleDeleteTx = (tx) => setDeleteConfirmTx(tx)
  const confirmarDeleteTx = async () => {
    if (!deleteConfirmTx) return
    await supabase.from('transactions').delete().eq('id', deleteConfirmTx.id)
    setTransactions(prev => prev.filter(t => t.id !== deleteConfirmTx.id))
    setDeleteConfirmTx(null)
  }

  const handleMarcarNeutro = async (tx) => {
    await supabase.from('transactions').update({ tipo: 'neutro', estado: 'identificado' }).eq('id', tx.id)
    setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, tipo: 'neutro', estado: 'identificado' } : t))
  }

  const getIngresoTagOpts = () => {
    const allOpts = subcategoriasDeIngreso(categories, subcategories).map(s => s.nombre)
    return { allOpts, valueIsCustom: editTag && !allOpts.includes(editTag) }
  }

  // Edición apilada para pantallas angostas: la fila en modo edición no entra
  // en la tabla (quedaban selects ocultos —subcategoría— y el botón de
  // confirmar recortado fuera de la pantalla), así que se reemplaza la fila
  // entera por una sola celda a lo ancho con el formulario completo.
  const renderEditStackMobile = (tx, colSpan = 9) => {
    const esIngresoTx = esVistaIngresos || editTipo === 'ingreso'
    const selStyle = { ...styles.editSelect, width: '100%', boxSizing: 'border-box' }
    return (
      <td colSpan={colSpan} style={{ ...styles.td, backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px 2px' }}>
          <span style={{ fontSize: '12px', color: darkMode ? '#9A8A9A' : '#75757a' }}>
            {formatFecha(tx.fecha)} · {tx.tipo === 'ingreso' ? '+' : '-'}{monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
          </span>
          {/* Tipo (gasto/ingreso): reemplaza el atajo viejo de elegir la categoría
              "Ingresos" desde la lista de gasto para reclasificar un movimiento —
              confuso porque mezclaba las categorías reales de ingreso ahí adentro.
              Fijo en Ingreso, sin selector, dentro de la cuenta de Ingresos. */}
          {!esVistaIngresos && (
            <div style={{ display: 'flex', gap: '6px' }}>
              {[{ v: 'gasto', label: '➖ Gasto' }, { v: 'ingreso', label: '➕ Ingreso' }].map(opt => (
                <button key={opt.v} type="button" onClick={() => setEditTipo(opt.v)}
                  style={{
                    flex: 1, padding: '6px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                    fontFamily: '"Montserrat", sans-serif', fontWeight: editTipo === opt.v ? '600' : '400',
                    border: editTipo === opt.v ? '2px solid #5C4F5C' : `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`,
                    background: editTipo === opt.v ? (darkMode ? '#3A2F4A' : '#EDE8F4') : 'transparent',
                    color: darkMode ? '#F0EDEC' : '#1d1d1f',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <input style={{ ...styles.editInput, width: '100%', boxSizing: 'border-box' }} value={editNombre}
            onChange={e => setEditNombre(e.target.value)} placeholder="Nombre" />
          <input style={{ ...styles.editInput, width: '100%', boxSizing: 'border-box' }} type="number" step="0.01" min="0" value={editMonto}
            onChange={e => setEditMonto(e.target.value)} placeholder="Monto" />
          <input style={{ ...styles.editInput, width: '100%', boxSizing: 'border-box' }} type="date" value={editFecha}
            onChange={e => setEditFecha(e.target.value)} title="Fecha del movimiento" />
          {/* Cuotas. Va acá y no escondido en otra pantalla porque el error típico
              es justo este: una compra de una sola vez leída como "3/3", que
              después aparece en el widget de cuotas pendientes. */}
          {!esIngresoTx && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel, whiteSpace: 'nowrap' }}>Cuota</span>
              <input
                style={{ ...styles.editInput, width: '58px', boxSizing: 'border-box', textAlign: 'center' }}
                type="number" min="1" step="1" value={editCuotaNum}
                onChange={e => setEditCuotaNum(e.target.value)}
                disabled={Math.trunc(Number(editCuotasTotal)) === 1}
                title="Número de cuota"
              />
              <span style={{ fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>de</span>
              <input
                style={{ ...styles.editInput, width: '58px', boxSizing: 'border-box', textAlign: 'center' }}
                type="number" min="1" step="1" value={editCuotasTotal}
                onChange={e => setEditCuotasTotal(e.target.value)}
                title="Cantidad total de cuotas del plan"
              />
              <button
                type="button"
                onClick={() => { setEditCuotasTotal('1'); setEditCuotaNum('1') }}
                style={{
                  marginLeft: 'auto', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer',
                  fontSize: '11px', fontFamily: '"Montserrat", sans-serif',
                  border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'transparent',
                  color: darkMode ? '#C0B0C0' : '#5C4F5C', whiteSpace: 'nowrap',
                }}
                title="Marcar como un solo pago, no en cuotas"
              >
                No fue en cuotas
              </button>
            </div>
          )}
          <select style={selStyle} value={editCuenta} onChange={e => setEditCuenta(e.target.value)}>
            {(accounts || []).filter(a => esIngresoTx || a.tipo !== 'ingreso').map(a => (
              <option key={a.id} value={a.id}>💳 {a.nombre}</option>
            ))}
          </select>
          {esIngresoTx ? (() => {
            const { allOpts, valueIsCustom } = getIngresoTagOpts()
            return (
              <>
                <select style={selStyle} value={valueIsCustom ? '__custom__' : (editTag || '')}
                  onChange={e => { if (e.target.value !== '__custom__') setEditTag(e.target.value) }}>
                  <option value="">— Sin categoría —</option>
                  {allOpts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  {valueIsCustom && <option value="__custom__">{editTag}</option>}
                </select>
                {children.length > 0 && (
                  <select style={selStyle} value={editHijoIngreso} onChange={e => setEditHijoIngreso(e.target.value)}>
                    <option value="">👧 Sin hijo/a (ej. cuota alimentaria)</option>
                    {children.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                  </select>
                )}
              </>
            )
          })() : (
            <>
              <select style={selStyle} value={editCategoria}
                onChange={e => { setEditCategoria(e.target.value); setEditSubcategoria('') }}>
                {/* Categorías de ingreso (ej. "Ingresos") no van acá — para reclasificar
                    un gasto como ingreso está el selector de tipo de arriba. */}
                {categories.filter(c => (c.tipo || 'gasto') !== 'ingreso').map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              </select>
              <select style={selStyle} value={editSubcategoria} onChange={e => setEditSubcategoria(e.target.value)}>
                <option value="">— Sin subcategoría</option>
                {filteredSubcats().map(s => <option key={s.id} value={s.nombre}>{s.nombre}</option>)}
              </select>
              {children.length > 0 && (
                <select style={selStyle} value={editTag} onChange={e => setEditTag(e.target.value)}>
                  <option value="">👧 Sin hijo/a</option>
                  {children.map(c => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
                </select>
              )}
            </>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...styles.saveEditBtn, flex: 1, padding: '10px' }} onClick={() => handleSaveEdit(tx)}>✓ Guardar</button>
            <button style={{ ...styles.cancelEditBtn, flex: 1, padding: '10px' }} onClick={() => setEditingTx(null)}>✕ Cancelar</button>
          </div>
        </div>
      </td>
    )
  }

  const thSortable = (label, key, hidden = false, width = undefined, align = undefined) => (
    <th style={{...styles.thSortable, ...(hidden ? { display: 'none' } : {}), ...(width ? { width } : {}), ...(align ? { textAlign: align } : {})}} onClick={() => handleSort(key)}>
      {label}<span style={styles.sortIcon}>{sortIcon(key)}</span>
    </th>
  )

  // Encabezado de la tabla de movimientos: ordena al clickear el título y filtra
  // por el embudo. El embudo no puede estar dentro del área que ordena, porque
  // abrir el filtro reordenaría la tabla por debajo.
  // `filtroKey` distinto de `key` para la columna Monto: ordena por monto pero
  // filtra por moneda, que es el dato que se ve ahí y no tiene columna propia.
  const thFiltrable = (label, key, align = undefined, filtroKey = key) => {
    const activo = Array.isArray(filtrosCol[filtroKey])
    return (
      <th style={{ ...styles.thSortable, cursor: 'default', ...(align ? { textAlign: align } : {}) }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', maxWidth: '100%' }}>
          <span
            onClick={() => handleSort(key)}
            style={{ cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {label}<span style={styles.sortIcon}>{sortIcon(key)}</span>
          </span>
          {columnasFiltrables.includes(filtroKey) && (
            <button
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setFiltroColPos({ x: r.left, y: r.bottom + 4 })
                setFiltroColBusqueda('')
                setFiltroColAbierto(prev => prev === filtroKey ? null : filtroKey)
              }}
              title={activo ? `Filtrando por ${ETIQUETA_COLUMNA[filtroKey] || label}` : `Filtrar por ${ETIQUETA_COLUMNA[filtroKey] || label}`}
              style={{
                background: activo ? (darkMode ? '#4A3F4A' : '#E8E0E8') : 'none',
                border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '1px 3px',
                fontSize: '9px', lineHeight: 1, flexShrink: 0,
                color: activo ? (darkMode ? '#E8D8E8' : '#5C4F5C') : (darkMode ? '#8A7A8A' : '#75757a'),
              }}
            >
              ▼
            </button>
          )}
        </span>
      </th>
    )
  }

  // Panel de valores de una columna. Es position fixed y no un hijo del <th>
  // porque ese th recorta lo que se desborda (necesita el "..." del título).
  const renderPanelFiltro = () => {
    const key = filtroColAbierto
    if (!key) return null
    const elegidos = filtrosCol[key]
    const valores = [...new Set(identificadasSinFiltroCol.map(t => valorColumna(t, key)))]
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    const q = norm(filtroColBusqueda)
    const visibles = q ? valores.filter(v => norm(v).includes(q)) : valores
    const limpiar = () => setFiltrosCol(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    // Si quedan elegidos TODOS los valores de la columna, el filtro no filtra
    // nada: se borra, así no queda un chip prendido que no hace nada.
    const setSel = (nuevos) => nuevos.length === valores.length
      ? limpiar()
      : setFiltrosCol(prev => ({ ...prev, [key]: nuevos }))
    const fondo = darkMode ? '#241F24' : 'white'
    const borde = darkMode ? '#3A333A' : '#E2DDE0'
    const texto = darkMode ? '#F0EDEC' : '#1d1d1f'
    return (
      <>
        {/* Capa para cerrar al clickear afuera, sin listeners globales */}
        <div onClick={() => setFiltroColAbierto(null)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
        <div style={{
          position: 'fixed', left: Math.min(filtroColPos.x, Math.max(8, window.innerWidth - 268)),
          top: filtroColPos.y, zIndex: 999, width: '260px', maxHeight: '340px',
          display: 'flex', flexDirection: 'column',
          background: fondo, border: `1px solid ${borde}`, borderRadius: '10px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: '8px',
          fontFamily: '"Montserrat", sans-serif',
        }}>
          {valores.length > 8 && (
            <input
              autoFocus
              value={filtroColBusqueda}
              onChange={(e) => setFiltroColBusqueda(e.target.value)}
              placeholder="Buscar…"
              style={{ ...styles.editInput, marginBottom: '6px' }}
            />
          )}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
            {/* Con una búsqueda escrita, "Todos" significa "solo los que
                coinciden" — es la forma rápida de quedarse con un subconjunto
                sin tildar de a uno. Sin búsqueda, saca el filtro. */}
            <button onClick={() => q ? setSel(visibles) : limpiar()} style={styles.filtroColAccion}>Todos</button>
            <button onClick={() => setFiltrosCol(prev => ({ ...prev, [key]: [] }))} style={styles.filtroColAccion}>Ninguno</button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {visibles.length === 0 && (
              <p style={{ margin: '6px 4px', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#75757a' }}>
                Nada que coincida.
              </p>
            )}
            {visibles.map(v => {
              // Sin selección, la columna muestra todo: la casilla arranca
              // marcada, como en un filtro de Excel recién abierto.
              const marcado = !elegidos || elegidos.includes(v)
              return (
                <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 4px', fontSize: '12px', color: texto, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() => {
                      // Al destildar por primera vez hay que materializar la
                      // lista completa menos este valor: hasta ahora la columna
                      // no tenía filtro, no una selección de todos.
                      const base = elegidos || valores
                      setSel(marcado ? base.filter(x => x !== v) : [...base, v])
                    }}
                    style={{ accentColor: '#5C4F5C', flexShrink: 0 }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>{v}</span>
                </label>
              )
            })}
          </div>
        </div>
      </>
    )
  }

  const isMobile = windowWidth < 768
  const styles = getStyles(darkMode, isMobile)
  const ellipsisCell = { ...styles.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', wordBreak: 'normal' }
  // Mismo gris secundario que usa getStyles internamente. Las celdas de cuenta/
  // subcategoría lo traían como '#888' o '#aaa' fijos: en oscuro se hunden
  // contra el panel y en claro '#aaa' sobre blanco da 2,3:1.
  const muted = darkMode ? '#9A8A9A' : '#6e6e73'
  const sem = semaforo(darkMode)

  // Corte de la tabla de movimientos (ver verTodosMovimientos). El corte es solo
  // visual: el contador del título, el pie de totales y el export a CSV siguen
  // usando la lista completa.
  //
  // Antes aplicaba solo en mobile. También hace falta en computadora: con 100+
  // movimientos hay que scrollear la tabla entera para llegar a cualquier cosa que
  // esté abajo.
  const MOVIMIENTOS_VISIBLES = 10
  const hayMasMovimientos = filasTabla.length > MOVIMIENTOS_VISIBLES
  const filasTablaVisibles = (hayMasMovimientos && !verTodosMovimientos)
    ? filasTabla.slice(0, MOVIMIENTOS_VISIBLES)
    : filasTabla

  // Contar transacciones de cada extracto, ordenados por mes descendente — por
  // vínculo real (statement_id, el mismo campo que liga reconciliarSueltas y que ya
  // usa "A pagar" en itemsPorStatement), no por si la fecha de la transacción cae en
  // el mismo mes que el cierre del extracto: esa aproximación por fecha daba 0 tx
  // apenas fecha_hasta venía vacío (ej. en la vista Ingresos, donde además statements
  // y transactions pueden pertenecer a cuentas distintas) y no reflejaba lo que el
  // extracto realmente tiene vinculado.
  const stmtsConTx = useMemo(() => [...statements]
    .sort((a, b) => {
      const pa = a.periodo || a.fecha_hasta?.slice(0, 7) || ''
      const pb = b.periodo || b.fecha_hasta?.slice(0, 7) || ''
      return pb.localeCompare(pa)
    })
    .map(s => {
      const count = transactions.filter(t => t.statement_id === s.id).length
      return { ...s, txCount: count }
    })
  , [statements, transactions])

  // En "Resumen General" (todas las cuentas sin soloAPagar) ya no se muestra acá: vive en
  // su propia pestaña de primer nivel. Sigue disponible dentro de cada cuenta individual.
  const mostrarTabAPagar = soloAPagar || (!allAccounts && account?.tipo === 'credito')
  const hoyISO = hoyLocal()
  const mesActual = hoyISO.slice(0, 7)

  // Cascada bottom-up de "A pagar": statements, estado de cada uno, atribución de
  // pagos, "Te falta pagar", desglose por categoría/hijo. Memoizada como un todo
  // (nivel más arriba, sin tocar ni un cálculo interno) porque antes recorría
  // transactions/statements completos en CADA render de la app, incluyendo
  // interacciones que no tienen nada que ver (hover, scroll, abrir un dropdown de
  // mes en otra pestaña, etc.).
  const apagarMemo = useMemo(() => {
  // Una tarjeta de crédito real arrastra sola el saldo no pagado al resumen siguiente
  // (el banco ya lo suma ahí) — por eso un resumen VIEJO (ya reemplazado por uno más
  // nuevo de la misma cuenta) se sigue ocultando apenas vence, sin excepción: lo que
  // faltaba pagar ya está reflejado en el total del resumen que le sigue, mostrarlo
  // aparte sería duplicar esa deuda. El ÚLTIMO resumen de cada cuenta es distinto: como
  // todavía no hay un resumen más nuevo que lo haya absorbido, sigue mostrándose con lo
  // que falta (descontando cualquier pago parcial ya cargado) hasta quedar en $0, sin
  // importar si ya venció.
  // El total del PDF ya viene neteado por el banco con cualquier pago hecho ANTES de
  // que la tarjeta cerrara (por eso el total del resumen suele ser menor a la suma
  // bruta de sus compras) — solo hay que restar los pagos sueltos hechos DESPUÉS del
  // cierre, que todavía no llegaron a reflejarse en ningún PDF. En dólares, igual que
  // en pesos, se confía directamente en el total que informó el banco (incluye
  // cualquier saldo a favor en esa moneda) en vez de reconstruirlo sumando renglones —
  // un pago en USD hecho antes del cierre ya está neteado ahí y no hay que restarlo de
  // nuevo. Solo si el resumen es viejo y no tiene ese total guardado, se recalcula
  // sumando los ítems vinculados (sin contar pagos, que antes no se restaban).
  // "A pagar" es solo para tarjetas de crédito — los resúmenes de cuentas de
  // banco/ingresos (que nunca tienen vencimiento real) quedaban afuera antes solo por
  // efecto colateral del filtro de fecha; ahora que ese filtro no es lo único que decide
  // si se muestra un resumen, hay que excluirlos por tipo de cuenta explícitamente.
  // El cálculo en sí vive en calcularStatementsPendientes (arriba, exportado): es la
  // MISMA función que usa el widget de Vencimientos en Dashboard.js, así nunca pueden
  // desalinearse entre sí.
  const { cuentasCreditoAPagar, statementsPorCuenta, estadosStatement, statementsRealesConUsd, cuentasConResumenRepetido } = mostrarTabAPagar
    ? calcularStatementsPendientes({ accounts: allAccounts ? accounts : (account?.tipo === 'credito' ? [account] : []), statements, transactions })
    : { cuentasCreditoAPagar: [], statementsPorCuenta: new Map(), estadosStatement: new Map(), statementsRealesConUsd: [], cuentasConResumenRepetido: [] }
  // Resúmenes reales que van a tener su propia tarjeta (ver statementsRealesConUsd
  // más abajo). Si un movimiento importado por PDF quedó con statement_id pero ese
  // resumen no llega a mostrarse solo (ej. ya está saldado), el movimiento no puede
  // quedar invisible: se cuenta igual dentro de "Ciclo actual" en vez de desaparecer.
  const statementIdsConTarjetaPropia = new Set(statementsRealesConUsd.map(s => s.id))
  // "Ciclo actual" es lo gastado DESPUÉS del último cierre y HASTA HOY: solo compras
  // nuevas (nunca pagos/reintegros, que ya se atribuyeron a saldar el statement anterior
  // en calcularEstadoStatement y no vuelven a contarse acá).
  //
  // Las cuotas se ubican por MES y el resto de los movimientos por día.
  //
  // Toda la regla de las cuotas vive en cuotaEnCiclo (lib/cuotas.js), que es la misma
  // que usa reconciliarSueltas para ligar una cuota a su resumen: se compara el mes y
  // nunca el día, en los dos extremos del ciclo. El día de una cuota es el de la compra
  // original arrastrado mes a mes, así que no dice nada sobre en qué resumen cae — la
  // cuota de agosto la factura el resumen de agosto, cierre el 9 o el 20.
  //
  // El tope del ciclo abierto es el mes en CURSO (hoyISO, del que solo se mira el mes):
  // de ahí en adelante ya son cuotas de meses que no llegaron y viven en el widget de
  // "Cuotas pendientes", no acá.
  //
  // No hay doble conteo con un resumen que ya facturó la cuota: esa queda afuera por
  // statement_id (ver itemsPorStatement y reconciliarSueltas), no por la fecha.
  //
  // Para todo lo demás el tope sigue siendo el día: un gasto suelto con fecha futura es
  // un dato anómalo (la auditoría semanal lo reporta como tal), no algo para sumar.
  const perteneceCicloActual = (t, ultimoCierre, hasta = null) => {
    if (t.tipo === 'neutro' || t.tipo === 'ingreso') return false
    const fecha = normFecha(t.fecha)
    if (esCuota(t)) return cuotaEnCiclo(t, ultimoCierre, hasta || hoyISO)
    if (ultimoCierre && fecha <= ultimoCierre) return false
    if (hasta) return fecha <= hasta
    return fecha <= hoyISO
  }
  // Movimientos ya cargados (ej. por Excel) que todavía no pertenecen a ningún resumen
  // cerrado: se muestran como un "ciclo actual" para ver cuánto se debe antes de que
  // llegue el PDF del banco. Solo cuentan los posteriores al último resumen ya cerrado
  // de esa cuenta — si no, cualquier carga vieja por Excel (que nunca tiene statement_id)
  // se sumaría como si fuera de este mes.
  const virtualesAPagar = cuentasCreditoAPagar.flatMap(a => {
    const propios = statementsPorCuenta.get(a.id) || []
    const ultimoReal = propios.length > 0 ? propios[propios.length - 1] : null
    const ultimoCierreAuto = ultimoReal ? cierreDe(ultimoReal) : null
    const cicloDesdeManual = cicloDesdeOverride[a.id] !== undefined ? cicloDesdeOverride[a.id] : (a.ciclo_actual_desde || null)
    // Se usa el corte más reciente entre el detectado (último resumen cargado) y el
    // manual (por si el auto no aplica, ej. cuenta que carga casi todo por Excel).
    const ultimoCierre = [ultimoCierreAuto, cicloDesdeManual].filter(Boolean).sort().pop() || null
    // CASCADA DE PAGOS. Un resumen se paga hasta cubrir el total que informó el banco;
    // lo que se pagó por encima de ese total no es un sobrepago, es plata que ya está
    // pagando el ciclo siguiente. Ese sobrante baja de un ciclo al que le sigue, en
    // orden, y cada uno se queda solo con lo que necesita para cubrirse.
    //
    // Antes cada tramo se restaba por su cuenta TODOS los pagos posteriores a su cierre.
    // Como el último resumen real también se los quedaba (su ventana no tenía tope), el
    // mismo pago se contaba dos veces: caso real, un pago parcial de $ 1.500.000 hecho
    // en agosto para bajar el ciclo que cerró el 30 de julio se restaba del ciclo
    // cerrado y ADEMÁS figuraba como "Sobrepago del resumen anterior: $ 1.500.000".
    //
    // El sobrante baja por los tramos en orden: primero el ciclo ya cerrado, después el
    // que sigue abierto (ver aplicarCascada).
    const estadoUltimo = ultimoReal ? estadosStatement.get(ultimoReal.id) : null
    let sobranteArs = estadoUltimo?.excedenteArs || 0
    let sobranteUsd = estadoUltimo?.excedenteUsd || 0
    // Sin ningún resumen real cargado no hay de dónde sacar un sobrante, pero los pagos
    // sueltos posteriores al corte igual pagan lo que se viene acumulando.
    if (!ultimoReal) {
      const pagos = transactions.filter(t => t.account_id === a.id && t.tipo === 'neutro' &&
        (!ultimoCierre || normFecha(t.fecha) > ultimoCierre))
      sobranteArs = pagos.filter(t => t.moneda !== 'USD').reduce((sum, t) => sum + Number(t.monto), 0)
      sobranteUsd = pagos.filter(t => t.moneda === 'USD').reduce((sum, t) => sum + Number(t.monto), 0)
    }

    // Un tramo del ciclo: (desde, hasta]. Con `hasta` en null llega hasta hoy (o hasta
    // fin de mes para las cuotas, ver perteneceCicloActual).
    const tramo = (desde, hasta, extra) => {
      const compras = transactions.filter(t =>
        (!t.statement_id || !statementIdsConTarjetaPropia.has(t.statement_id)) &&
        t.account_id === a.id && perteneceCicloActual(t, desde, hasta)
      )
      const total = compras.filter(t => t.moneda !== 'USD').reduce((sum, t) => sum + Number(t.monto), 0)
      const totalUsd = compras.filter(t => t.moneda === 'USD').reduce((sum, t) => sum + Number(t.monto), 0)
      return {
        account_id: a.id, periodo: null, fecha_vencimiento: null, fecha_hasta: null,
        total_resumen: total, total_usd: totalUsd,
        _virtual: true, _comprasCount: compras.length,
        _pagosPosterioresArs: 0, _pagosPosterioresUsd: 0,
        cicloDesde: null, cicloDesdeEfectivo: desde,
        _excedenteArs: 0, _excedenteUsd: 0,
        ...extra,
      }
    }
    // Baja la cascada por los tramos en orden (primero el ciclo ya cerrado, después el
    // que sigue abierto) y anota en el último lo que quedó realmente a favor.
    const aplicarCascada = (tramos) => {
      const ars = repartirPagos(sobranteArs, tramos.map(t => t.total_resumen))
      const usd = repartirPagos(sobranteUsd, tramos.map(t => t.total_usd))
      tramos.forEach((t, i) => {
        t._pagosPosterioresArs = ars.aplicados[i]
        t._pagosPosterioresUsd = usd.aplicados[i]
        t.total_resumen -= ars.aplicados[i]
        t.total_usd -= usd.aplicados[i]
      })
      const ultimo = tramos[tramos.length - 1]
      if (ultimo) { ultimo._excedenteArs = ars.restante; ultimo._excedenteUsd = usd.restante }
      return tramos
    }
    const tieneAlgo = (s) => s._comprasCount > 0 || s._excedenteArs > 0 || s._excedenteUsd > 0

    // ¿El ciclo que sigue al último resumen cargado ya cerró en el banco? Si cerró y el
    // PDF todavía no se cargó, esa plata no es "lo que se está acumulando": ya está
    // facturada y tiene vencimiento. Se parte en dos tramos para no mezclarlas.
    //
    // SOLO se parte con la fecha que informó el banco. Estimar "un mes después del
    // último cierre" no alcanza para afirmar que un ciclo cerró, porque los ciclos
    // reales no son mensuales: en la Mastercard Galicia, 11-Jun → 08-Jul → 27-Ago, o
    // sea un ciclo de 27 días y otro de 50. Partiendo por la estimación, esa tarjeta
    // habría dado el ciclo por cerrado el 8 de agosto, 19 días antes de que cerrara de
    // verdad, mostrando un resumen que no existe. Con fecha estimada se avisa y nada más.
    const manual = cierreManualOverride[a.id] !== undefined
      ? { ...a, ...cierreManualOverride[a.id] }
      : a
    const ciclo = cicloAbiertoDe(ultimoReal, ultimoCierre, manual)
    // El cierre y el vencimiento se editan en el tramo cuyo _cierraEl ES el ciclo que
    // decide todo esto (_editableCierre), y en uno solo: partida la tarjeta en dos,
    // repetir el selector daría a entender que cada tramo tiene su propia fecha.
    const datosCierre = {
      _cierraEl: ciclo?.cierre || null, _venceEl: ciclo?.vencimiento || null,
      _cierreOrigen: ciclo ? ciclo.origen : 'estimado', _editableCierre: true,
    }
    if (!(ciclo && ciclo.origen !== 'estimado' && hoyISO > ciclo.cierre)) {
      const [abierto] = aplicarCascada([tramo(ultimoCierre, null, {
        id: `sin-resumen-${a.id}`,
        cicloDesde: cicloDesdeManual, _editableDesde: true,
        ...datosCierre,
      })])
      // El "Contando desde" manual mantiene viva la tarjeta aunque no haya nada cargado:
      // es la señal de que el usuario está trackeando ese ciclo a mano.
      return (tieneAlgo(abierto) || cicloDesdeManual) ? [abierto] : []
    }
    const cerrado = tramo(ultimoCierre, ciclo.cierre, {
      id: `cerrado-sin-pdf-${a.id}`, _cerradoSinPdf: true,
      cicloDesde: cicloDesdeManual, _editableDesde: true,
      ...datosCierre,
      fecha_hasta: ciclo.cierre,
      fecha_vencimiento: ciclo.vencimiento,
    })
    const abierto = tramo(ciclo.cierre, null, {
      id: `sin-resumen-${a.id}`,
      // El cierre del ciclo que sigue a este no lo informó nadie todavía: se estima, y
      // no se edita acá — lo editable es el cierre del ciclo de arriba.
      _cierraEl: addMeses(ciclo.cierre, 1), _venceEl: null,
      _cierreOrigen: 'estimado', _editableCierre: false,
    })
    aplicarCascada([cerrado, abierto])
    const visibles = [cerrado, abierto].filter(tieneAlgo)
    if (visibles.length === 0) return cicloDesdeManual ? [abierto] : []
    // Si el tramo cerrado no quedó a la vista (nada cargado en esa ventana), el selector
    // manual tiene que seguir estando en el tramo que sí se muestra.
    if (!visibles.some(s => s._editableDesde)) {
      visibles[0]._editableDesde = true
      visibles[0].cicloDesde = cicloDesdeManual
    }
    return visibles
  })
  // Lo exigible: los resúmenes reales, más un ciclo que el banco YA CERRÓ en una fecha
  // que informó ÉL MISMO (proximo_cierre), aunque el PDF todavía no esté cargado — esa
  // plata ya está facturada y tiene vencimiento, esconderla de "Te falta pagar" es
  // justamente el bug de mostrar $ 0 cuando se deben millones. Un ciclo con fecha de
  // cierre estimada nunca llega hasta acá (no se parte, ver virtualesAPagar): el número
  // grande no se apoya jamás en una fecha que calculó la app.
  const esExigible = (s) => !s._virtual || (s._cerradoSinPdf && s._cierreOrigen !== 'estimado')
  // "Próximos vencimientos" = lo virtual que todavía NO es exigible.
  const statementsSinResumen = virtualesAPagar.filter(s => !esExigible(s))
  // statementsRealesConUsd (total pendiente ya neteado de pagos, USD incluido) sale
  // directo de calcularStatementsPendientes, arriba — ver ese comentario para el
  // detalle de cómo se calcula el total en pesos/USD y los pagos posteriores.
  // Jerarquía por urgencia: vencidas primero (de la más vieja a la más
  // reciente), después las que todavía no vencieron por fecha de
  // vencimiento ascendente, y por último las que ni siquiera tienen fecha
  // (el "ciclo actual" en curso, que no es urgente todavía).
  const statementsAPagar = mostrarTabAPagar
    ? [...virtualesAPagar, ...statementsRealesConUsd]
        .sort((a, b) => {
          const diasA = diasRestantesDe(a), diasB = diasRestantesDe(b)
          const grupoDe = (d) => d === null ? 2 : d < 0 ? 0 : 1
          const grupoA = grupoDe(diasA), grupoB = grupoDe(diasB)
          if (grupoA !== grupoB) return grupoA - grupoB
          if (grupoA === 2) return 0
          return a.fecha_vencimiento.localeCompare(b.fecha_vencimiento)
        })
    : []
  // "Te falta pagar" es únicamente lo YA FACTURADO: los resúmenes reales, más un ciclo
  // que el banco ya cerró en una fecha que informó él mismo aunque falte cargar el PDF
  // (ver esExigible). Un resumen todavía abierto no venció, no es deuda exigible este
  // mes: se muestra aparte, en "Próximos vencimientos", y no suma acá.
  const statementsFacturados = statementsAPagar.filter(esExigible)
  const statementsVencidas = statementsFacturados.filter(s => diasRestantesDe(s) < 0)
  const statementsNoVencidas = statementsFacturados.filter(s => !(diasRestantesDe(s) < 0))
  // Cálculo BOTTOM-UP (regla A): la suma de lo pendiente de cada obligación YA
  // facturada visible en pantalla, cada una recortada a >= 0 antes de sumar — así un
  // sobrepago informativo en una tarjeta nunca puede "tapar" (netear) lo que sigue
  // debiendo otra. Nunca puede dar más de lo que en verdad falta pagar.
  const totalAPagarGeneral = statementsFacturados.reduce((sum, s) => sum + Math.max(0, Number(s.total_resumen) || 0), 0)
  const totalAPagarGeneralUsd = statementsFacturados.reduce((sum, s) => sum + Math.max(0, Number(s.total_usd) || 0), 0)
  // Lo que se está acumulando en resúmenes todavía abiertos (no facturados): informativo,
  // no suma a "Te falta pagar" — recién se factura (y empieza a "deberse") en el
  // próximo cierre de cada tarjeta.
  const totalProximoResumenArs = statementsSinResumen.reduce((sum, s) => sum + Math.max(0, Number(s.total_resumen) || 0), 0)
  const totalProximoResumenUsd = statementsSinResumen.reduce((sum, s) => sum + Math.max(0, Number(s.total_usd) || 0), 0)
  const itemsPorStatement = (s) => {
    const items = transactions.filter(t => s._virtual
      ? ((!t.statement_id || !statementIdsConTarjetaPropia.has(t.statement_id)) && t.account_id === s.account_id && perteneceCicloActual(t, s.cicloDesdeEfectivo))
      : (t.statement_id === s.id && t.tipo !== 'neutro'))
    return [...items].sort((a, b) => {
      let valA, valB
      if (apagarSortKey === 'nombre') { valA = (a.nombre || a.detalle || '').toLowerCase(); valB = (b.nombre || b.detalle || '').toLowerCase() }
      else if (apagarSortKey === 'categoria') { valA = (a.categories?.nombre || '').toLowerCase(); valB = (b.categories?.nombre || '').toLowerCase() }
      else if (apagarSortKey === 'subcategoria') { valA = (a.subcategories?.nombre || '').toLowerCase(); valB = (b.subcategories?.nombre || '').toLowerCase() }
      else { valA = Number(a.monto); valB = Number(b.monto) }
      if (valA < valB) return apagarSortDir === 'asc' ? -1 : 1
      if (valA > valB) return apagarSortDir === 'asc' ? 1 : -1
      return 0
    })
  }
  // Los reintegros/devoluciones (tipo "ingreso") y los pagos (tipo "neutro") ya restan
  // del total a pagar, pero no pintan como si fueran un gasto de esa categoría — se
  // excluyen del desglose.
  // El monto de cada categoría no incluye lo que ya se muestra en la
  // pastilla del hijo (si no, quedaría duplicado): "resto" = sin hijo.
  const categoriasResumen = (items) => {
    const map = {}, hijoMap = {}
    items.filter(t => t.tipo !== 'ingreso' && t.tipo !== 'neutro').forEach(t => {
      const cat = t.categories?.nombre || 'A Identificar'
      const hijo = getChildName(t)
      if (hijo) {
        if (!hijoMap[cat]) hijoMap[cat] = {}
        hijoMap[cat][hijo] = (hijoMap[cat][hijo] || 0) + Number(t.monto)
      } else {
        map[cat] = (map[cat] || 0) + Number(t.monto)
      }
    })
    const categorias = new Set([...Object.keys(map), ...Object.keys(hijoMap)])
    return [...categorias].map(cat => {
      const hijoEntries = hijoMap[cat] ? Object.entries(hijoMap[cat]).sort((a, b) => b[1] - a[1]) : []
      const totalResto = map[cat] || 0
      const totalCat = totalResto + hijoEntries.reduce((s, [, m]) => s + m, 0)
      return [cat, totalResto, hijoEntries, totalCat]
    }).sort((a, b) => b[3] - a[3])
  }
  // "Bruto" = suma de gastos sin restar pagos/reintegros (lo que muestran las
  // pastillas de categoría). La diferencia contra totalAPagarGeneral (siempre
  // >= 0, ver regla A) es lo que ya se pagó de este mes, para la barra de progreso.
  let totalBrutoAPagarGeneral = 0
  statementsAPagar.forEach(s => {
    totalBrutoAPagarGeneral += itemsPorStatement(s)
      .filter(t => t.tipo !== 'ingreso' && t.tipo !== 'neutro' && t.moneda !== 'USD')
      .reduce((s2, t) => {
        const monto = Number(t.monto) || 0
        if (t.moneda === 'EUR') {
          const tcTx = tcEURDeMovimiento(t, tcMapEUR, tipoCambioEUR)
          if (tcTx <= 0) { if (process.env.NODE_ENV !== 'production') console.warn('totalBrutoAPagarGeneral: sin TC para convertir movimiento EUR', t.id, t.fecha); return s2 }
          return s2 + monto * tcTx
        }
        return s2 + monto
      }, 0)
  })
  const montoPagadoGeneral = Math.max(0, totalBrutoAPagarGeneral - totalAPagarGeneral)
  // La barra de "Pagado" no es solo tarjetas: suma también los gastos fijos
  // de este mes que no pasan por resumen — todo gasto de cuenta débito, más
  // alquiler/expensas (transferencia) sin importar la cuenta. Estos se pagan
  // en el momento de cargarlos, así que aportan por igual al total y a lo
  // pagado (no hay estado "pendiente" para ellos, a diferencia de la tarjeta).
  const primerDiaMesActual = `${mesActual}-01`
  const accountTipoById = new Map((accounts || []).map(a => [a.id, a.tipo]))
  const gastosFijosDelMes = allAccounts ? transactions.filter(t => {
    if (t.tipo !== 'gasto') return false
    if (!t.fecha || t.fecha < primerDiaMesActual || t.fecha > hoyISO) return false
    const accTipo = accountTipoById.get(t.account_id)
    if (accTipo === 'credito') return false
    return accTipo === 'debito' || esAlquilerOExpensas(t)
  }) : []
  // Antes se excluían directamente los movimientos en USD (dejaban de aportar a
  // la barra de "pagado este mes") — un alquiler pagado en dólares desde una
  // cuenta débito desaparecía sin avisar. Ahora se convierten como el resto de
  // la app, con el mismo TC del movimiento (fx_rate) y aviso por consola si no
  // hay TC resoluble, en vez de sumar 0 en silencio.
  const totalGastosFijosMes = gastosFijosDelMes.reduce((sum, t) => {
    const monto = Number(t.monto) || 0
    if (t.moneda === 'USD') {
      const tcTx = tcDeMovimiento(t, tcMap, tipoCambio)
      if (tcTx <= 0) { if (process.env.NODE_ENV !== 'production') console.warn('gastosFijosDelMes: sin TC para convertir movimiento USD', t.id, t.fecha); return sum }
      return sum + monto * tcTx
    }
    if (t.moneda === 'EUR') {
      const tcTx = tcEURDeMovimiento(t, tcMapEUR, tipoCambioEUR)
      if (tcTx <= 0) { if (process.env.NODE_ENV !== 'production') console.warn('gastosFijosDelMes: sin TC para convertir movimiento EUR', t.id, t.fecha); return sum }
      return sum + monto * tcTx
    }
    return sum + monto
  }, 0)
  const totalBrutoBarra = totalBrutoAPagarGeneral + totalGastosFijosMes
  const montoPagadoBarra = montoPagadoGeneral + totalGastosFijosMes
  const pctPagadoBarra = totalBrutoBarra > 0 ? Math.min(100, Math.round((montoPagadoBarra / totalBrutoBarra) * 100)) : 0
  const ingresosEsteMes = transactions.filter(t => t.tipo === 'ingreso' && t.fecha >= primerDiaMesActual && t.fecha <= hoyISO)
  const ingresosPorCategoriaMes = Object.values(ingresosEsteMes.reduce((acc, t) => {
    const nombre = t.tag || t.subcategories?.nombre || t.categories?.nombre || 'Sin categoría'
    if (!acc[nombre]) acc[nombre] = { nombre, ars: 0, usd: 0, unificado: 0 }
    if (t.moneda === 'USD') {
      const tc = tcDeMovimiento(t, tcMap, tipoCambio) || tcEfectivo
      acc[nombre].usd += Number(t.monto)
      acc[nombre].unificado += Number(t.monto) * tc
    } else {
      acc[nombre].ars += Number(t.monto)
      acc[nombre].unificado += Number(t.monto)
    }
    return acc
  }, {})).sort((a, b) => b.unificado - a.unificado)
  // Igual que en categoriasResumen: el total de la categoría es solo el
  // "resto" (sin hijos), para no duplicar lo que ya muestra su pastilla.
  const totalesConResto = (map, hijoMap) => {
    const categorias = new Set([...Object.keys(map), ...Object.keys(hijoMap)])
    return [...categorias].map(cat => {
      const hijoTotal = hijoMap[cat] ? Object.values(hijoMap[cat]).reduce((s, m) => s + m, 0) : 0
      return [cat, map[cat] || 0, (map[cat] || 0) + hijoTotal]
    }).sort((a, b) => b[2] - a[2]).map(([cat, totalResto]) => [cat, totalResto])
  }
  // Composición del gasto del mes: SIEMPRE montos brutos (compras de
  // tarjeta + gastos fijos de débito/alquiler), sin descontar pagos
  // parciales — esas restas viven solo en la cascada de "A pagar", nunca acá.
  // EUR no tiene bucket propio (a diferencia de USD): se convierte a su
  // equivalente en ARS con el TC del movimiento y entra al mapa de pesos —
  // si no, quedaba sumado crudo en el mapa de ARS (ej. € 50 como "$ 50").
  const montoARSEquiv = (t) => {
    const monto = Number(t.monto) || 0
    if (t.moneda !== 'EUR') return monto
    const tcTx = tcEURDeMovimiento(t, tcMapEUR, tipoCambioEUR)
    if (tcTx <= 0) { if (process.env.NODE_ENV !== 'production') console.warn('categoriasResumenGeneral: sin TC para convertir movimiento EUR', t.id, t.fecha); return 0 }
    return monto * tcTx
  }
  const [categoriasResumenGeneral, categoriasResumenGeneralUsd, hijosPorCategoriaGeneral, hijosPorCategoriaGeneralUsd] = soloAPagar
    ? (() => {
        const map = {}, mapUsd = {}, hijoMap = {}, hijoMapUsd = {}
        statementsAPagar.forEach(s => {
          itemsPorStatement(s).filter(t => t.tipo !== 'ingreso' && t.tipo !== 'neutro').forEach(t => {
            const cat = t.categories?.nombre || 'A Identificar'
            const esUsd = t.moneda === 'USD'
            const hijo = getChildName(t)
            if (hijo) {
              const destinoHijo = esUsd ? hijoMapUsd : hijoMap
              if (!destinoHijo[cat]) destinoHijo[cat] = {}
              destinoHijo[cat][hijo] = (destinoHijo[cat][hijo] || 0) + (esUsd ? Number(t.monto) : montoARSEquiv(t))
            } else {
              const destino = esUsd ? mapUsd : map
              destino[cat] = (destino[cat] || 0) + (esUsd ? Number(t.monto) : montoARSEquiv(t))
            }
          })
        })
        gastosFijosDelMes.forEach(t => {
          const cat = t.categories?.nombre || 'A Identificar'
          const hijo = getChildName(t)
          const esUsd = t.moneda === 'USD'
          // Mismo bug que en subcatsCatGeneral: un gasto fijo en USD (ej. alquiler
          // débito automático) se sumaba siempre en el mapa de pesos sin mirar la
          // moneda — se veía como si "$ 1.400" fuera pesos en vez de dólares.
          if (hijo) {
            const destinoHijo = esUsd ? hijoMapUsd : hijoMap
            if (!destinoHijo[cat]) destinoHijo[cat] = {}
            destinoHijo[cat][hijo] = (destinoHijo[cat][hijo] || 0) + (esUsd ? Number(t.monto) : montoARSEquiv(t))
          } else {
            const destino = esUsd ? mapUsd : map
            destino[cat] = (destino[cat] || 0) + (esUsd ? Number(t.monto) : montoARSEquiv(t))
          }
        })
        return [
          totalesConResto(map, hijoMap),
          totalesConResto(mapUsd, hijoMapUsd),
          hijoMap,
          hijoMapUsd,
        ]
      })()
    : [[], [], {}, {}]
  // Una sola pastilla por hijo (suma de todas sus categorías), en vez de una
  // pastilla repetida por cada categoría en la que gastó.
  const sumarHijosPorNombre = (porCategoria) => {
    const totales = {}
    Object.values(porCategoria).forEach(porHijo => {
      Object.entries(porHijo).forEach(([hijo, monto]) => { totales[hijo] = (totales[hijo] || 0) + monto })
    })
    return Object.entries(totales).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1])
  }
  const hijosTotalesGeneral = sumarHijosPorNombre(hijosPorCategoriaGeneral)
  const hijosTotalesGeneralUsd = sumarHijosPorNombre(hijosPorCategoriaGeneralUsd)
  // Desglose por categoría del hijo elegido en la lista: mismo patrón que
  // "categoría → subcategorías" de arriba, en vez de navegar a la solapa del
  // hijo — hijosPorCategoriaGeneral ya viene indexado por categoría, así que
  // solo hace falta invertirlo para el hijo seleccionado.
  const catsPorHijoGeneral = hijoGeneralSeleccionado
    ? Object.entries(hijosPorCategoriaGeneral)
        .map(([cat, porHijo]) => [cat, porHijo[hijoGeneralSeleccionado] || 0])
        .filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1])
    : []
  const catsPorHijoGeneralUsd = hijoGeneralSeleccionado
    ? Object.entries(hijosPorCategoriaGeneralUsd)
        .map(([cat, porHijo]) => [cat, porHijo[hijoGeneralSeleccionado] || 0])
        .filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1])
    : []
  // Subcategorías de la categoría elegida en la lista: igual que
  // categoriasResumenGeneral, se excluye lo ya asignado a un hijo (esa parte
  // se muestra en su propia pastilla en "Gasto del mes por hijo") — si no, el
  // desglose por subcategoría no suma lo mismo que el total de la categoría.
  const [subcatsCatGeneral, subcatsCatGeneralUsd] = (soloAPagar && catGeneralSeleccionada)
    ? (() => {
        const map = {}, mapUsd = {}
        statementsAPagar.forEach(s => {
          itemsPorStatement(s).filter(t => t.tipo !== 'ingreso' && t.tipo !== 'neutro' && !getChildName(t)).forEach(t => {
            const cat = t.categories?.nombre || 'A Identificar'
            if (cat !== catGeneralSeleccionada) return
            const subcat = t.subcategories?.nombre || 'Sin subcategoría'
            const esUsd = t.moneda === 'USD'
            const destino = esUsd ? mapUsd : map
            destino[subcat] = (destino[subcat] || 0) + (esUsd ? Number(t.monto) : montoARSEquiv(t))
          })
        })
        gastosFijosDelMes.forEach(t => {
          if (getChildName(t)) return
          const cat = t.categories?.nombre || 'A Identificar'
          if (cat !== catGeneralSeleccionada) return
          const subcat = t.subcategories?.nombre || 'Sin subcategoría'
          // Alquiler y otros gastos fijos en USD (ej. débito automático en dólares)
          // se estaban sumando siempre acá, en el mapa de pesos, sin mirar la
          // moneda — un alquiler de U$S 1.400 se veía como "$ 1.400".
          const esUsd = t.moneda === 'USD'
          const destino = esUsd ? mapUsd : map
          destino[subcat] = (destino[subcat] || 0) + (esUsd ? Number(t.monto) : montoARSEquiv(t))
        })
        return [
          Object.entries(map).sort((a, b) => b[1] - a[1]),
          Object.entries(mapUsd).sort((a, b) => b[1] - a[1]),
        ]
      })()
    : [[], []]
  // Subtotal de "Gastos del mes por categoría": sale de la MISMA selección de
  // transacciones que arma categoriasResumenGeneral/hijosTotalesGeneral (itemsPorStatement
  // de cada statement + gastosFijosDelMes) — un solo criterio, no hay otro "total del
  // mes" calculado por separado con el que pueda desalinearse.
  const categoriasBrutoSubtotalArs = categoriasResumenGeneral.reduce((s, [, t]) => s + t, 0)
    + hijosTotalesGeneral.reduce((s, [, t]) => s + t, 0)
  const gastosCategoriaEHijoSubtotalArs = categoriasBrutoSubtotalArs
  // "Gastos del mes por categoría" muestra los hijos como una fila más de la
  // misma lista (antes vivían en una caja aparte "Gasto del mes por hijo") —
  // se arma una sola lista mezclando ambas fuentes, ordenada de mayor a menor.
  const mezclarCategoriasEHijos = (cats, hijos) => [
    ...cats.filter(([, t]) => t > 0).map(([nombre, total]) => ({ tipo: 'categoria', nombre, total })),
    ...hijos.map(([nombre, total]) => ({ tipo: 'hijo', nombre, total })),
  ].sort((a, b) => b.total - a.total)
  const gastosCategoriaEHijoGeneral = mezclarCategoriasEHijos(categoriasResumenGeneral, hijosTotalesGeneral)
  const gastosCategoriaEHijoGeneralUsd = mezclarCategoriasEHijos(categoriasResumenGeneralUsd, hijosTotalesGeneralUsd)

    return {
      totalAPagarGeneral, totalAPagarGeneralUsd, totalBrutoBarra, montoPagadoBarra, pctPagadoBarra,
      statementsFacturados, statementsSinResumen, totalProximoResumenArs, totalProximoResumenUsd,
      ingresosPorCategoriaMes,
      subcatsCatGeneral, subcatsCatGeneralUsd,
      catsPorHijoGeneral, catsPorHijoGeneralUsd,
      gastosCategoriaEHijoGeneral, gastosCategoriaEHijoGeneralUsd, gastosCategoriaEHijoSubtotalArs,
      statementsVencidas, statementsNoVencidas,
      itemsPorStatement, categoriasResumen,
      cuentasConResumenRepetido,
    }
  }, [transactions, statements, accounts, allAccounts, account, soloAPagar, mostrarTabAPagar, cicloDesdeOverride, cierreManualOverride, hoyISO, mesActual, tcMap, tipoCambio, tcEfectivo, tcMapEUR, tipoCambioEUR, apagarSortKey, apagarSortDir, catGeneralSeleccionada, hijoGeneralSeleccionado, getChildName])

  const {
    totalAPagarGeneral, totalAPagarGeneralUsd, totalBrutoBarra, montoPagadoBarra, pctPagadoBarra,
    statementsFacturados, statementsSinResumen, totalProximoResumenArs, totalProximoResumenUsd,
    ingresosPorCategoriaMes,
    subcatsCatGeneral, subcatsCatGeneralUsd,
    catsPorHijoGeneral, catsPorHijoGeneralUsd,
    gastosCategoriaEHijoGeneral, gastosCategoriaEHijoGeneralUsd, gastosCategoriaEHijoSubtotalArs,
    statementsVencidas, statementsNoVencidas,
    itemsPorStatement, categoriasResumen,
    cuentasConResumenRepetido,
  } = apagarMemo

  const handleApagarSort = (key) => {
    if (apagarSortKey === key) setApagarSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setApagarSortKey(key); setApagarSortDir(key === 'monto' ? 'desc' : 'asc') }
  }
  const apagarSortIcon = (key) => apagarSortKey !== key ? ' ↕︎' : (apagarSortDir === 'asc' ? ' ↑︎' : ' ↓︎')
  const mostrarMovimientos = !soloAPagar && (vistaCuenta === 'movimientos' || !mostrarTabAPagar)
  const vistaApagarActiva = soloAPagar || vistaCuenta === 'apagar'

  // Los <input type="date"> chiquitos de las tarjetas de "A pagar" (contando desde,
  // cierre y vencimiento del ciclo) comparten estilo: son la misma clase de control.
  const estiloInputFecha = {
    fontSize: '12px', padding: '2px 6px', borderRadius: '6px',
    border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`,
    backgroundColor: darkMode ? '#1C1A1C' : 'white',
    color: darkMode ? '#F0EDEC' : '#1d1d1f',
    colorScheme: darkMode ? 'dark' : 'light',
  }

  // Un <input type="date"> a medio completar reporta value = "" en CADA tecla, hasta que
  // los tres segmentos (día, mes, año) están puestos. Guardando ese "" en el acto se
  // borraba la fecha y el input volvía a pintarse vacío en mitad del tipeo, pisando los
  // segmentos ya escritos: escribir la fecha a mano era imposible. El vaciado real
  // (querer sacar la fecha) se guarda recién cuando el campo pierde el foco.
  const propsInputFecha = (valorActual, guardar) => ({
    type: 'date',
    value: valorActual || '',
    onClick: e => e.stopPropagation(),
    onChange: e => { if (e.target.value) guardar(e.target.value) },
    // Vaciar de verdad (borrar la fecha) sí se guarda, pero solo al salir del campo y
    // solo si quedó realmente vacío: badInput es una fecha a medio escribir, que se
    // abandonó sin terminar, y esa no puede borrar lo que había guardado.
    onBlur: e => { if (!e.target.value && !e.target.validity?.badInput && valorActual) guardar(null) },
    style: estiloInputFecha,
  })

  // Una tarjeta de "A pagar": fecha siempre en formato relativo (la
  // absoluta queda de tooltip), y con un estilo rojo destacado cuando ya
  // venció (para el bloque "Acción inmediata").
  const renderStatementCard = (s, esVencida) => {
    const items = itemsPorStatement(s)
    const diasRestantes = diasRestantesDe(s)
    const nombreCuenta = allAccounts ? (accounts || []).find(a => a.id === s.account_id)?.nombre : null
    const tarjetaExpandida = tarjetaAbierta.has(s.id)
    return (
      <div key={s.id} style={{
        backgroundColor: esVencida ? (darkMode ? '#3A2323' : '#FBEAEA') : (darkMode ? '#2A272A' : '#F0EDEC'),
        border: `1px solid ${esVencida ? (darkMode ? '#5A3232' : '#F0C4C4') : (darkMode ? '#3A333A' : '#E2DDE0')}`,
        borderLeft: esVencida ? '4px solid #c0392b' : (darkMode ? '1px solid #3A333A' : '1px solid #E2DDE0'),
        borderRadius: '14px', padding: '18px 20px',
      }}>
        <div onClick={() => toggleTarjetaAPagar(s.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: tarjetaExpandida && items.length > 0 ? '14px' : 0, flexWrap: 'wrap', gap: '8px', cursor: 'pointer' }}>
          <div>
            {/* La aclaración de qué es un resumen abierto va en la "i" del título y no
                como un renglón de texto debajo: ocupaba una línea entera en cada
                tarjeta, repetida en todas, y competía con el monto que se viene a
                mirar. Mismo criterio que el resto de las explicaciones de la app. */}
            <p style={{ margin: 0, fontWeight: '500', fontSize: '15px', color: darkMode ? '#F0EDEC' : '#1d1d1f', display: 'flex', alignItems: 'center' }}>
              <span>{tarjetaExpandida ? '▾' : '▸'} {nombreCuenta ? `💳 ${nombreCuenta} · ` : ''}{s._cerradoSinPdf ? 'Resumen cerrado · falta cargar el PDF' : s._virtual ? 'Resumen abierto' : (s.periodo || mesLabel(s.fecha_hasta?.slice(0, 7) || ''))}</span>
              {s._virtual && (
                <span onClick={e => e.stopPropagation()} style={{ display: 'inline-flex' }}>
                  <InfoTooltip darkMode={darkMode} text={s._cerradoSinPdf
                    ? 'Esta tarjeta ya cerró y todavía no cargaste el resumen. El monto sale de los movimientos que tenés cargados de ese ciclo, así que puede diferir un poco del total que informe el banco: subí el PDF y queda exacto.'
                    : 'Todavía no facturado: son los gastos que hiciste después del último cierre de esta tarjeta. Se van a incluir en el próximo resumen, así que no suman a lo que te falta pagar hoy.'} />
                </span>
              )}
            </p>
            {/* Cuándo cierra este ciclo. Antes no se decía en ninguna parte: el resumen
                abierto era un monto que crecía sin que se supiera hasta cuándo.
                Se puede corregir a mano porque el dato del PDF se vuelve viejo solo — la
                fecha de cierre se cambia desde el home banking, y el resumen anterior
                queda informando un cierre que ya no va a pasar (ver cicloAbiertoDe). De
                dónde salió la fecha se aclara siempre: una estimación no se puede
                confundir con un dato del banco. */}
            {s._virtual && s._editableCierre && (
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: s._cerradoSinPdf ? sem.negativo : muted, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                {s._cerradoSinPdf ? 'Cerró el' : 'Cierra el'}
                <input {...propsInputFecha(s._cierraEl, v => guardarCierreManual(s.account_id, { proximo_cierre: v }))} />
                y vence el
                <input {...propsInputFecha(s._venceEl, v => guardarCierreManual(s.account_id, { proximo_vencimiento: v }))} />
                {s._cierreOrigen === 'estimado'
                  ? '(estimado — corregilo si no es así)'
                  : s._cierreOrigen === 'pdf' ? '(del resumen)' : '(a mano)'}
              </p>
            )}
            {s._virtual && !s._editableCierre && s._cierraEl && (
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: muted }}>
                Cierra alrededor del {formatFechaCorta(s._cierraEl)} (estimado)
              </p>
            )}
            {/* El "Contando desde" manual acota el ciclo entero de la cuenta, así que va
                en el primer tramo y uno solo: con la tarjeta partida en dos, repetir el
                selector daba a entender que se puede mover cada tramo por separado. */}
            {s._virtual && s._editableDesde && (
              <>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: muted, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Contando desde
                  <input {...propsInputFecha(
                    s.cicloDesde || (s.cicloDesdeEfectivo ? restarDiasISO(s.cicloDesdeEfectivo, -1) : ''),
                    v => guardarCicloDesde(s.account_id, v),
                  )} />
                  {!s.cicloDesde && '(auto)'}
                </p>
              </>
            )}
            {/* El tramo abierto de una tarjeta partida en dos no tiene selector propio
                (el "Contando desde" acota el ciclo entero, ver _editableDesde), pero sí
                tiene que decir desde cuándo cuenta: sin eso las dos tarjetas de la misma
                cuenta se leen como la misma cosa repetida en vez de como dos períodos
                consecutivos. */}
            {s._virtual && !s._editableDesde && s.cicloDesdeEfectivo && (
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: muted }}>
                Contando desde el {formatFechaCorta(restarDiasISO(s.cicloDesdeEfectivo, -1))}
              </p>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontWeight: '600', fontSize: '18px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>$ {formatMonto(s.total_resumen)}</p>
            {/* "Pagado" tiene que verse siempre que se haya pagado algo este período,
                no solo cuando el resultado final quedó en sobrepago — si no, un pago
                parcial (que todavía deja algo pendiente) parece no haberse
                registrado, aunque sí esté restado del total de arriba. Es solo
                informativo: no se arrastra a ningún otro resumen — si el pago de
                más ya quedó reflejado en el próximo PDF del banco, va a coincidir
                solo, sin que la app tenga que hacer nada. */}
            {s._pagosPosterioresArs > 0 && (
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>Pagado $ {formatMonto(s._pagosPosterioresArs)}</p>
            )}
            {editUsdStatementId === s.id ? (
              <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', justifyContent: 'flex-end' }}>
                <input type="number" step="0.01" autoFocus value={editUsdValor} onChange={e => setEditUsdValor(e.target.value)}
                  placeholder="negativo si es a favor"
                  style={{ width: '130px', padding: '3px 6px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, backgroundColor: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px' }} />
                <button onClick={() => guardarTotalDolaresStatement(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sem.teal, fontSize: '13px' }}>✓</button>
                <button onClick={() => setEditUsdStatementId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: darkMode ? '#9A8A9A' : '#75757a', fontSize: '13px' }}>✕</button>
              </span>
            ) : (
              // Boolean() a propósito: si total_usd es 0 y total_dolares es 0,
              // la condición vale 0 (no false) y React imprime ese cero como
              // texto — quedaba un "0" suelto colgando debajo del importe en
              // todo resumen que fuera solo en pesos, que son casi todos.
              Boolean(s.total_usd !== 0 || s.total_dolares) && (
                <p style={{ margin: '4px 0 0', fontWeight: '600', fontSize: '13px', color: darkMode ? '#9A8A9A' : '#6e6e73', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                  U$S {formatMontoFull(s.total_usd)}
                  {/* Si el total en dólares que informa el resumen no se leyó bien del
                      PDF (típicamente un saldo a favor, que viene como negativo), se
                      puede corregir a mano acá — mismo criterio que "Total facturado".
                      Solo en resúmenes reales: uno "virtual" (todavía no facturado,
                      s._virtual) no tiene fila propia en la base para guardar nada, su
                      id ni siquiera es un uuid real. */}
                  {!s._virtual && (
                    <button onClick={e => { e.stopPropagation(); setEditUsdStatementId(s.id); setEditUsdValor(s.total_dolares != null ? String(s.total_dolares) : '') }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, fontSize: '11px', padding: 0 }}>✏️</button>
                  )}
                </p>
              )
            )}
            {s._pagosPosterioresUsd > 0 && (
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>Pagado U$S {formatMontoFull(s._pagosPosterioresUsd)}</p>
            )}
            {/* Excedente informativo en esa moneda: puede ser saldo a favor que ya
                informa el propio resumen del banco, o un pago que superó lo debido en
                esa moneda puntual — nunca se resta de nada ni se arrastra a otro
                período. En un resumen real todavía visible (debe en la otra moneda) se
                muestra como "A favor"; en "Ciclo actual" (resumen anterior ya saldado
                por completo) se aclara que es de ese resumen anterior. */}
            {s._excedenteArs > 0 && (
              <p style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: '600', color: sem.teal }}>
                {s._virtual ? 'Te queda a favor' : 'A favor'}: $ {formatMonto(s._excedenteArs)}{!s._virtual ? ' (según resumen)' : ''}
              </p>
            )}
            {s._excedenteUsd > 0 && (
              <p style={{ margin: '2px 0 0', fontSize: '12px', fontWeight: '600', color: sem.teal }}>
                {s._virtual ? 'Te queda a favor' : 'A favor'}: U$S {formatMontoFull(s._excedenteUsd)}{!s._virtual ? ' (según resumen)' : ''}
              </p>
            )}
            {diasRestantes !== null && (
              <p
                title={`Vence: ${s.fecha_vencimiento}`}
                style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: '500', color: diasRestantes <= 3 ? sem.negativo : diasRestantes <= 7 ? sem.alerta : sem.teal, cursor: 'default' }}>
                {diasRestantes < 0
                  ? `Venció hace ${Math.abs(diasRestantes)} día${Math.abs(diasRestantes) === 1 ? '' : 's'}`
                  : diasRestantes === 0 ? '¡Vence hoy!' : diasRestantes === 1 ? 'Vence mañana' : `Vence en ${diasRestantes} días`}
              </p>
            )}
          </div>
        </div>
        {tarjetaExpandida && items.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
            {categoriasResumen(items).map(([cat, total, hijosCat]) => (
              <React.Fragment key={cat}>
                {total > 0 && (
                  <span style={{ backgroundColor: (resolveColor(cat) || '#E0E0E0'), color: '#3a3a3c', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap' }}>
                    {resolveIcon(cat)} {cat}: $ {formatMonto(total)}
                  </span>
                )}
                {hijosCat.map(([hijo, monto]) => (
                  <span key={`${cat}-${hijo}`} style={{ backgroundColor: (resolveColor(cat) || '#E0E0E0'), color: '#3a3a3c', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap', border: `1.5px dashed ${darkMode ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.25)'}` }}>
                    {customIcons?.[hijo] || '👧'} {hijo} · {cat}: $ {formatMonto(monto)}
                  </span>
                ))}
              </React.Fragment>
            ))}
          </div>
        )}
        {tarjetaExpandida && items.length > 0 && (
          <div
            onClick={() => toggleDetalleAPagar(s.id)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: detalleAbierto.has(s.id) ? '10px' : 0 }}>
            <span style={{ fontSize: '12px', fontWeight: '500', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
              {detalleAbierto.has(s.id) ? '▾' : '▸'} Detalle ({items.length})
            </span>
          </div>
        )}
        {tarjetaExpandida && items.length > 0 && detalleAbierto.has(s.id) && (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{...styles.thSortable, width: isMobile ? '40%' : '35%'}} onClick={() => handleApagarSort('nombre')}>Nombre{apagarSortIcon('nombre')}</th>
                  <th style={{...styles.thSortable, width: isMobile ? '30%' : '25%'}} onClick={() => handleApagarSort('categoria')}>Categoría{apagarSortIcon('categoria')}</th>
                  <th style={{ ...styles.thSortable, width: '20%', display: isMobile ? 'none' : undefined }} onClick={() => handleApagarSort('subcategoria')}>Subcategoría{apagarSortIcon('subcategoria')}</th>
                  <th style={{ ...styles.thSortable, width: isMobile ? '30%' : '20%', textAlign: 'right' }} onClick={() => handleApagarSort('monto')}>Monto{apagarSortIcon('monto')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map(tx => (
                  <tr key={tx.id} style={styles.tr}>
                    <td style={styles.td}>{tx.nombre || tx.detalle}</td>
                    <td style={styles.td}>
                      <span title={tx.categories?.nombre || ''} style={{ backgroundColor: (resolveColor(tx.categories?.nombre) || '#E0E0E0'), color: '#3a3a3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500' }}>
                        {resolveIcon(tx.categories?.nombre || '')} {tx.categories?.nombre || '—'}
                      </span>
                    </td>
                    <td style={{ ...styles.td, display: isMobile ? 'none' : undefined }}>
                      <span style={{ fontSize: '12px', color: muted }}>{tx.subcategories?.nombre || '—'}</span>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: '600' }}>
                      {tx.tipo === 'ingreso' ? '+' : '-'}{monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <TotalesFooter txs={items} tcMap={tcMap} tipoCambio={tipoCambio} tcMapEUR={tcMapEUR} tipoCambioEUR={tipoCambioEUR} darkMode={darkMode} colSpan={4} />
            </table>
          </div>
        )}
      </div>
    )
  }

  // Todos los hooks (useMemo/useCallback) de arriba deben ejecutarse siempre, en el
  // mismo orden, en cada render — por eso este return temprano quedó acá abajo, justo
  // antes del JSX, en vez de más arriba como estaba antes de memoizar.
  if (loading) return (
    <div style={styles.loading}>Cargando datos...</div>
  )

  return (
    <div>
      {renderPanelFiltro()}
      {mostrarTabAPagar && !soloAPagar && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {[{ key: 'movimientos', label: '🫧 Movimientos' }, { key: 'apagar', label: '📌 A pagar' }].map(t => (
            <button key={t.key} onClick={() => setVistaCuenta(t.key)}
              style={{ padding: '7px 16px', borderRadius: '20px', border: `1.5px solid ${vistaCuenta === t.key ? (darkMode ? '#8C7B8C' : '#5C4F5C') : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: vistaCuenta === t.key ? (darkMode ? '#8C7B8C' : '#5C4F5C') : 'transparent', color: vistaCuenta === t.key ? 'white' : (darkMode ? '#9A8A9A' : '#6e6e73'), fontSize: '13px', fontWeight: '500', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif', outline: 'none', transition: 'all 0.15s' }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {mostrarTabAPagar && vistaApagarActiva && (
        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ ...styles.chartTitle, margin: '0 0 16px' }}>📌 A pagar</h3>
          <div style={{ textAlign: 'center', padding: '20px 16px', borderRadius: '14px', backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, marginBottom: '20px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>Te falta pagar</p>
            <p style={{ margin: 0, fontWeight: '700', fontSize: '32px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>$ {formatMonto(Math.max(0, totalAPagarGeneral))}</p>
            {totalAPagarGeneralUsd > 0 && (
              <p style={{ margin: '4px 0 0', fontSize: '13px', fontWeight: '600', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
                + U$S {formatMontoFull(totalAPagarGeneralUsd)}{parseFloat(tipoCambio) > 0 ? ` (≈ $ ${formatMonto(totalAPagarGeneralUsd * parseFloat(tipoCambio))} · TC $ ${formatMontoFull(parseFloat(tipoCambio))})` : ''}
              </p>
            )}
            {allAccounts && totalBrutoBarra > 0 && (
              <p style={{ margin: '10px 0 0', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#75757a' }}>
                $ {formatMonto(Math.round(montoPagadoBarra))} pagado de $ {formatMonto(Math.round(totalBrutoBarra))} este mes · {pctPagadoBarra}%
              </p>
            )}
          </div>
          {allAccounts && totalBrutoBarra > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ height: '8px', borderRadius: '6px', backgroundColor: darkMode ? '#2A272A' : '#EDE8EC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pctPagadoBarra}%`, backgroundColor: '#3a7d44', transition: 'width 0.3s ease', borderRadius: '6px' }} />
              </div>
            </div>
          )}
          {/* Dos resúmenes cargados para el mismo cierre: la app se queda con uno solo
              (el que tiene saldo, ver compararStatements) y el otro no se muestra en
              ninguna parte. Sin este aviso, el resumen que quedó afuera era plata que
              desaparecía de la pantalla sin explicación. */}
          {cuentasConResumenRepetido.length > 0 && (
            <div style={{ marginBottom: '20px', padding: '12px 14px', borderRadius: '12px', backgroundColor: darkMode ? '#3A2323' : '#FBEAEA', border: `1px solid ${darkMode ? '#5A3232' : '#F0C4C4'}`, fontSize: '12px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
              {cuentasConResumenRepetido.map(c => (
                <div key={c.account_id} style={{ margin: '2px 0' }}>
                  <p style={{ margin: 0 }}>
                    ⚠️ {c.nombre ? `${c.nombre}: ` : ''}hay {c.cantidad} resúmenes cargados con el mismo cierre ({formatFechaCorta(c.cierre)}).
                  </p>
                  {/* Qué dice cada uno, para poder decidir: borrar un resumen sin ver su
                      monto es borrar a ciegas. El que se usa va marcado, y los que se
                      van a borrar son siempre los otros. */}
                  <div style={{ margin: '8px 0 0', paddingLeft: '18px' }}>
                    {[{ s: c.enUso, enUso: true }, ...c.ignorados.map(s => ({ s, enUso: false }))].map(({ s, enUso }) => (
                      <p key={s.id} style={{ margin: '2px 0', opacity: enUso ? 1 : 0.75 }}>
                        {enUso ? '✅' : '🚫'} {s.periodo || mesLabel(s.fecha_hasta?.slice(0, 7) || '')} · {[
                          `$ ${formatMonto(Number(s.total_resumen) || 0)}`,
                          s.total_dolares ? `U$S ${formatMontoFull(Number(s.total_dolares))}` : null,
                        ].filter(Boolean).join(' + ')} · vence {formatFechaCorta(normFecha(s.fecha_vencimiento))}
                        {enUso ? ' — el que se está usando' : ' — ignorado'}
                      </p>
                    ))}
                  </div>
                  {confirmBorrarRepetido === c.account_id ? (
                    <div style={{ margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span>¿Borrar {c.ignorados.length === 1 ? 'el resumen ignorado' : `los ${c.ignorados.length} resúmenes ignorados`}?</span>
                      <button onClick={() => borrarResumenRepetido(c)} disabled={borrandoRepetido === c.account_id}
                        style={{ padding: '4px 10px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontFamily: '"Montserrat", sans-serif' }}>
                        {borrandoRepetido === c.account_id ? 'Borrando...' : 'Sí, borrar'}
                      </button>
                      <button onClick={() => setConfirmBorrarRepetido(null)} disabled={borrandoRepetido === c.account_id}
                        style={{ padding: '4px 10px', background: 'none', border: `1px solid ${darkMode ? '#5A3232' : '#F0C4C4'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: 'inherit', fontFamily: '"Montserrat", sans-serif' }}>
                        No
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmBorrarRepetido(c.account_id)}
                      style={{ margin: '10px 0 0', padding: '4px 10px', background: 'none', border: `1px solid ${darkMode ? '#5A3232' : '#F0C4C4'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: 'inherit', fontFamily: '"Montserrat", sans-serif' }}>
                      🗑 Borrar el repetido
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Bottom-up (regla A): lista cada obligación YA FACTURADA en pantalla con su
              propio pendiente — nunca una resta global que podía desalinearse del
              header, y nunca un resumen todavía abierto (ver "Próximos vencimientos"
              más abajo): "Te falta pagar" es exigible este mes, no lo que se está
              acumulando para el próximo cierre. Esto ES literalmente cómo se arma
              totalAPagarGeneral, así que termina siempre, por construcción, en el mismo
              número: no hay otra cuenta que concilie. */}
          {allAccounts && statementsFacturados.length > 0 && (
            <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '14px', backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
              <p style={{ margin: '0 0 10px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>¿Qué compone lo que falta pagar?</p>
              <div style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                {statementsFacturados.map(s => {
                  const nombreCuenta = (accounts || []).find(a => a.id === s.account_id)?.nombre
                  // El ciclo ya cerrado sin PDF cargado se marca como tal: su monto sale
                  // de los movimientos, no del total que informó el banco.
                  const label = `${nombreCuenta ? `💳 ${nombreCuenta} · ` : ''}${s.periodo || mesLabel(s.fecha_hasta?.slice(0, 7) || '')}${s._cerradoSinPdf ? ' · falta el PDF' : ''}`
                  const saldada = Math.round(s.total_resumen) <= 0 && Math.round(s.total_usd * 100) <= 0
                  return (
                    <div key={s.id} style={{ padding: '5px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{label}</span>
                        <span style={{ fontWeight: '600' }}>
                          {saldada ? 'Saldada' : [
                            s.total_resumen > 0 ? `$ ${formatMonto(s.total_resumen)}` : null,
                            s.total_usd > 0 ? `U$S ${formatMontoFull(s.total_usd)}` : null,
                          ].filter(Boolean).join(' + ')}
                        </span>
                      </div>
                      {(s._excedenteArs > 0 || s._excedenteUsd > 0) && (
                        <div style={{ fontSize: '11px', color: sem.teal }}>
                          Te queda a favor{s._excedenteArs > 0 ? `: $ ${formatMonto(s._excedenteArs)}` : ''}{s._excedenteUsd > 0 ? ` ${s._excedenteArs > 0 ? '+ ' : ': '}U$S ${formatMontoFull(s._excedenteUsd)}` : ''}
                        </div>
                      )}
                    </div>
                  )
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: '4px', borderTop: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontWeight: '700', fontSize: '15px' }}>
                  <span>= Te falta pagar</span>
                  <span>$ {formatMonto(totalAPagarGeneral)}{totalAPagarGeneralUsd > 0 ? ` + U$S ${formatMontoFull(totalAPagarGeneralUsd)}` : ''}</span>
                </div>
              </div>
            </div>
          )}
          {/* Próximos vencimientos: lo que se está acumulando en resúmenes todavía
              abiertos (compras/cuotas nuevas desde el último cierre de cada tarjeta) —
              informativo, no suma a "Te falta pagar": recién pasa a ser deuda exigible
              cuando el banco cierra ese resumen. */}
          {allAccounts && statementsSinResumen.length > 0 && (
            <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '14px', backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
              <p style={{ margin: '0 0 10px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', display: 'flex', alignItems: 'center', ...rotuloLabel }}>
                🕐 Próximos vencimientos
                <InfoTooltip darkMode={darkMode} text={'Todavía no facturado — se incluye en el próximo resumen de cada tarjeta. No suma a "Te falta pagar".'} />
              </p>
              <div style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                {statementsSinResumen.map(s => {
                  const nombreCuenta = (accounts || []).find(a => a.id === s.account_id)?.nombre
                  return (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
                      <span>{nombreCuenta ? `💳 ${nombreCuenta}` : 'Resumen abierto'}</span>
                      <span style={{ fontWeight: '600' }}>
                        {[
                          s.total_resumen > 0 ? `$ ${formatMonto(s.total_resumen)}` : null,
                          s.total_usd > 0 ? `U$S ${formatMontoFull(s.total_usd)}` : null,
                        ].filter(Boolean).join(' + ') || '$ 0'}
                      </span>
                    </div>
                  )
                })}
                {(totalProximoResumenArs > 0 || totalProximoResumenUsd > 0) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: '4px', borderTop: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontWeight: '700', fontSize: '15px' }}>
                    <span>Total acumulado</span>
                    <span>$ {formatMonto(totalProximoResumenArs)}{totalProximoResumenUsd > 0 ? ` + U$S ${formatMontoFull(totalProximoResumenUsd)}` : ''}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Ingresos de este mes: informativo, no resta de "Te falta pagar". */}
          {allAccounts && ingresosPorCategoriaMes.length > 0 && (
            <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '14px', backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
              <p style={{ margin: '0 0 10px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', display: 'flex', alignItems: 'center', ...rotuloLabel }}>
                Ingresos de este mes
                <InfoTooltip darkMode={darkMode} text={'Informativo — no resta de "Te falta pagar".'} />
              </p>
              <div style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                {ingresosPorCategoriaMes.map(c => (
                  <div key={c.nombre} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', gap: '10px' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.nombre}>
                      {resolveCategoryIcon(c.nombre, { customIcons, isIncome: true })} {c.nombre}
                    </span>
                    <span style={{ fontWeight: '600', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {c.ars > 0 ? `$ ${formatMonto(c.ars)}` : ''}
                      {c.ars > 0 && c.usd > 0 ? ' + ' : ''}
                      {c.usd > 0 ? `U$S ${formatMonto(c.usd)} (total ≈ $ ${formatMonto(c.unificado)})` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: '4px', borderTop: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontWeight: '700', fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                <span>Total</span>
                <span>
                  {(() => {
                    const t = ingresosPorCategoriaMes.reduce((acc, c) => ({ ars: acc.ars + c.ars, usd: acc.usd + c.usd, unificado: acc.unificado + c.unificado }), { ars: 0, usd: 0, unificado: 0 })
                    return <>$ {formatMonto(t.ars)}{t.usd > 0 ? ` + U$S ${formatMonto(t.usd)}` : ''}{t.usd > 0 ? ` (≈ $ ${formatMonto(t.unificado)})` : ''}</>
                  })()}
                </span>
              </div>
            </div>
          )}
          {/* Categorías + hijos: composición del gasto del mes, siempre en bruto —
              no cambia con cada pago parcial. Los hijos se muestran como una fila
              más de la misma lista (no en una caja aparte): cada uno es, en la
              práctica, otra "categoría" de gasto. Al abrir una fila de categoría
              se ve el desglose por subcategoría; al abrir una fila de hijo, el
              desglose por categoría de ese hijo. */}
          {(gastosCategoriaEHijoGeneral.length > 0 || gastosCategoriaEHijoGeneralUsd.length > 0) && (
            <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '14px', backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
              <p style={{ margin: '0 0 10px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>Gastos del mes por categoría</p>
              {gastosCategoriaEHijoGeneral.map(({ tipo, nombre, total }) => total > 0 && (
                <React.Fragment key={`${tipo}-${nombre}`}>
                  <div
                    onClick={() => toggleGastoGeneralRow(tipo, nombre)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, cursor: 'pointer' }}>
                    <span style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f', display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      <span style={{ opacity: 0.6, fontSize: '11px' }}>{(tipo === 'hijo' ? hijoGeneralSeleccionado : catGeneralSeleccionada) === nombre ? '▾' : '▸'}</span>
                      {tipo === 'hijo' ? (customIcons?.[nombre] || '👧') : resolveIcon(nombre)} {nombre}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', whiteSpace: 'nowrap' }}>$ {formatMonto(total)}</span>
                  </div>
                  {tipo === 'categoria' && catGeneralSeleccionada === nombre && subcatsCatGeneral.length > 0 && (
                    <div style={{ padding: '6px 0 8px 20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {subcatsCatGeneral.map(([subcat, montoSub]) => (
                        <div key={subcat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
                          <span>{subcat}</span>
                          <span>$ {formatMonto(montoSub)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {tipo === 'hijo' && hijoGeneralSeleccionado === nombre && catsPorHijoGeneral.length > 0 && (
                    <div style={{ padding: '6px 0 8px 20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {catsPorHijoGeneral.map(([cat, montoCat]) => (
                        <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
                          <span>{resolveIcon(cat)} {cat}</span>
                          <span>$ {formatMonto(montoCat)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', marginTop: '4px', fontWeight: '700', fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                <span>Subtotal</span>
                <span>$ {formatMonto(gastosCategoriaEHijoSubtotalArs)}</span>
              </div>
              {gastosCategoriaEHijoGeneralUsd.length > 0 && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px dashed ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
                  <p style={{ margin: '0 0 6px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>💵 En USD</p>
                  {gastosCategoriaEHijoGeneralUsd.map(({ tipo, nombre, total }) => total > 0 && (
                    <React.Fragment key={`usd-${tipo}-${nombre}`}>
                      <div
                        onClick={() => toggleGastoGeneralRow(tipo, nombre)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', cursor: 'pointer' }}>
                        <span style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ opacity: 0.6, fontSize: '11px' }}>{(tipo === 'hijo' ? hijoGeneralSeleccionado : catGeneralSeleccionada) === nombre ? '▾' : '▸'}</span>
                          {tipo === 'hijo' ? (customIcons?.[nombre] || '👧') : resolveIcon(nombre)} {nombre}
                        </span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>U$S {formatMontoFull(total)}</span>
                      </div>
                      {tipo === 'categoria' && catGeneralSeleccionada === nombre && subcatsCatGeneralUsd.length > 0 && (
                        <div style={{ padding: '4px 0 6px 20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {subcatsCatGeneralUsd.map(([subcat, montoSub]) => (
                            <div key={subcat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
                              <span>{subcat}</span>
                              <span>U$S {formatMontoFull(montoSub)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {tipo === 'hijo' && hijoGeneralSeleccionado === nombre && catsPorHijoGeneralUsd.length > 0 && (
                        <div style={{ padding: '4px 0 6px 20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {catsPorHijoGeneralUsd.map(([cat, montoCat]) => (
                            <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
                              <span>{resolveIcon(cat)} {cat}</span>
                              <span>U$S {formatMontoFull(montoCat)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
          {statementsFacturados.length === 0 && statementsSinResumen.length === 0 ? (
            <p style={{ color: muted, fontSize: '14px' }}>No hay resúmenes con vencimiento próximo{allAccounts ? '' : ' para esta cuenta'}.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {statementsVencidas.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: '700', color: sem.negativo, ...rotuloLabel }}>
                    ⚠️ Acción inmediata
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {statementsVencidas.map(s => renderStatementCard(s, true))}
                  </div>
                </div>
              )}
              {statementsNoVencidas.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {statementsNoVencidas.map(s => renderStatementCard(s, false))}
                </div>
              )}
              {statementsSinResumen.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>
                    🕐 Próximos vencimientos (todavía no facturado)
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {statementsSinResumen.map(s => renderStatementCard(s, false))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {mostrarMovimientos && (<>
      {/* Historial de extractos */}
      {!allAccounts && stmtsConTx.length > 0 && (
        <div style={styles.stmtHistory}>
          <div
            onClick={() => setStmtCollapsed(c => !c)}
            style={{ display: 'inline-flex', width: 'fit-content', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: stmtCollapsed ? 0 : '10px' }}>
            <h3 style={{ ...styles.stmtHistoryTitle, margin: 0 }}>
              Extractos cargados ({stmtsConTx.length})
            </h3>
            <span style={{ fontSize: '11px', color: styles.stmtHistoryTitle.color, opacity: 0.7 }}>
              {stmtCollapsed ? '▾' : '▴'}
            </span>
          </div>
          {!stmtCollapsed && (
            <div style={{ ...styles.stmtChips, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible' }}>
              {stmtsConTx.map(s => (
                <div key={s.id} style={{ ...styles.stmtChip, flexShrink: isMobile ? 0 : undefined }}>
                  <span style={styles.stmtChipPeriod}>{s.periodo || mesLabel(s.fecha_hasta?.slice(0,7) || '')}</span>
                  <span style={styles.stmtChipDetail}>
                    {s.txCount} tx · {s.created_at ? new Date(s.created_at).toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'2-digit'}) : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selector de mes + agregar ingreso — siempre arriba */}
      {mesesDisponibles.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <h3 style={{...styles.chartTitle, margin: 0}}>{esVistaIngresos ? '💰 Ingresos de:' : '🫧 Movimientos de:'}</h3>
          <div ref={mesDropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setMesDropdownOpen(o => !o)}
              style={{ ...styles.mesChip, ...(selectedMeses.length > 0 ? styles.mesChipActive : {}), display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {selectedMeses.length === 0
                ? 'Seleccioná meses ▾'
                : selectedMeses.length === mesesDisponibles.length
                  ? `Todos (${mesesDisponibles.length}) ▾`
                  : selectedMeses.length === 1
                    ? `${mesLabel(selectedMeses[0])} ▾`
                    : (selectedMeses.length === 0 ? 'Ningún mes ▾' : `${selectedMeses.length} meses ▾`)}
            </button>
            {mesDropdownOpen && (
              <div
                className="hide-scroll"
                style={{ position: 'absolute', top: '110%', left: 0, zIndex: 100, background: darkMode ? '#2A232A' : '#fff', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', minWidth: '200px', maxHeight: '320px', overflowY: 'auto', padding: '6px 0' }}
                onMouseLeave={() => setMesDropdownOpen(false)}
              >
                <button
                  onClick={() => setSelectedMeses(selectedMeses.length === mesesDisponibles.length ? [] : [...mesesDisponibles])}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: darkMode ? '#8C7B8C' : '#5C4F5C', borderBottom: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}` }}
                >
                  {selectedMeses.length === mesesDisponibles.length ? '✕ Deseleccionar todos' : '✓ Seleccionar todos'}
                </button>
                {mesesDisponibles.map(m => (
                  <button
                    key={m}
                    onClick={() => toggleMes(m)}
                    style={{ width: '100%', textAlign: 'left', padding: '7px 14px', background: selectedMeses.includes(m) ? (darkMode ? '#3A2F3A' : '#f3eef3') : 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: selectedMeses.includes(m) ? (darkMode ? '#8C7B8C' : '#5C4F5C') : (darkMode ? '#F0EDEC' : '#1d1d1f'), display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <span style={{ width: '14px', height: '14px', borderRadius: '3px', border: `2px solid ${selectedMeses.includes(m) ? (darkMode ? '#8C7B8C' : '#5C4F5C') : (darkMode ? '#3A333A' : '#E2DDE0')}`, background: selectedMeses.includes(m) ? (darkMode ? '#8C7B8C' : '#5C4F5C') : 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'white', flexShrink: 0 }}>
                      {selectedMeses.includes(m) ? '✓' : ''}
                    </span>
                    {mesLabel(m)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cards de resumen */}
      {selectedMeses.length > 0 && mesTxs.length > 0 && (() => {
        const divider = <div style={{ borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, margin: '8px 0' }} />
        const egresosEquivARS = totalARS + totalUSD * tcEfectivo + totalEUR * tcEUR
        // Unificado con el TC del mes de cada movimiento (tcMap, ya según el tipo de
        // dólar elegido) — no el TC de hoy — para que el equivalente de ingresos
        // históricos en USD no cambie retroactivamente al actualizar el TC.
        const ingresosEquivARS = totalesDeLista(mesTxs.filter(t => t.tipo === 'ingreso'), tcMap, tipoCambio, tcMapEUR, tipoCambioEUR, { signed: false }).unificado
        const egresosEquivUSD = tcEfectivo > 0 ? totalUSD + (totalARS + totalEUR * tcEUR) / tcEfectivo : 0
        const ingresosEquivUSD = tcEfectivo > 0 ? totalIngresosUSD + (totalIngresosARS + totalIngresosEUR * tcEUR) / tcEfectivo : 0
        return (
          <div className="summary-cards-wrap"><div className="summary-cards" style={styles.summaryCards}>

            {/* === Vista cuenta de ingresos individual === */}
            {esVistaIngresos && (totalIngresosARS > 0 || totalIngresosUSD > 0 || totalIngresosEUR > 0) && (
              <div style={styles.summaryCard}>
                {totalIngresosARS > 0 && <>
                  <p style={styles.summaryLabel}>Total Ingresos ARS</p>
                  <p style={styles.summaryValue}>$ {formatMonto(totalIngresosARS)}</p>
                </>}
                {totalIngresosARS > 0 && totalIngresosUSD > 0 && divider}
                {totalIngresosUSD > 0 && <>
                  <p style={{ ...styles.summaryLabel, marginTop: totalIngresosARS > 0 ? 0 : undefined }}>Total Ingresos USD</p>
                  <p style={{ ...styles.summaryValue, fontSize: '18px' }}>U$S {formatMontoFull(totalIngresosUSD)}</p>
                </>}
                {(totalIngresosARS > 0 || totalIngresosUSD > 0) && totalIngresosEUR > 0 && divider}
                {totalIngresosEUR > 0 && <>
                  <p style={styles.summaryLabel}>Total Ingresos EUR</p>
                  <p style={{ ...styles.summaryValue, fontSize: '18px' }}>€ {formatMontoFull(totalIngresosEUR)}</p>
                </>}
              </div>
            )}
            {/* Unificado: solo si hay mezcla de monedas — si todo es ARS, ya lo
                muestra la card de arriba y este número sería redundante. */}
            {esVistaIngresos && totalIngresosARS > 0 && (totalIngresosUSD > 0 || totalIngresosEUR > 0) && (
              <div style={styles.summaryCard}>
                <p style={styles.summaryLabel}>Total Ingresos unificado (ARS)</p>
                <p style={styles.summaryValue}>$ {formatMonto(ingresosEquivARS)}</p>
                <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', margin: '4px 0 0' }}>USD convertido al TC de cada movimiento</p>
              </div>
            )}

            {/* === Vista cuenta individual (no ingresos) === */}
            {!esVistaIngresos && !allAccounts && totalARS > 0 && (
              <div style={styles.summaryCard}>
                <p style={styles.summaryLabel}>Total ARS</p>
                <p style={styles.summaryValue}>$ {formatMonto(totalARS)}</p>
              </div>
            )}
            {!esVistaIngresos && !allAccounts && totalUSD > 0 && (
              <div style={styles.summaryCard}>
                <p style={styles.summaryLabel}>Total USD</p>
                <p style={styles.summaryValue}>U$S {formatMontoFull(totalUSD)}</p>
              </div>
            )}
            {!esVistaIngresos && !allAccounts && totalEUR > 0 && (
              <div style={styles.summaryCard}>
                <p style={styles.summaryLabel}>Total EUR</p>
                <p style={styles.summaryValue}>€ {formatMontoFull(totalEUR)}</p>
              </div>
            )}

            {/* === Resumen general: card ARS combinada === */}
            {!esVistaIngresos && allAccounts && (totalARS > 0 || totalIngresosARS > 0) && (
              <div style={styles.summaryCard}>
                <p style={styles.summaryLabel}>Egresos ARS</p>
                <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>$ {formatMonto(totalARS)}</p>
                {hayIngresos && <>{divider}
                  <p style={styles.summaryLabel}>Ingresos ARS</p>
                  <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>$ {formatMonto(totalIngresosARS)}</p>
                  {divider}
                  <p style={styles.summaryLabel}>Balance ARS</p>
                  {(() => { const b = totalIngresosARS - totalARS; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? sem.positivo : sem.negativo }}>{b >= 0 ? '+' : ''}$ {formatMonto(b)}</p> })()}
                </>}
              </div>
            )}

            {/* === Resumen general: card USD combinada === */}
            {!esVistaIngresos && allAccounts && (totalUSD > 0 || totalIngresosUSD > 0) && (
              <div style={styles.summaryCard}>
                <p style={styles.summaryLabel}>Egresos USD</p>
                <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>U$S {formatMontoFull(totalUSD)}</p>
                {hayIngresos && totalIngresosUSD > 0 && <>{divider}
                  <p style={styles.summaryLabel}>Ingresos USD</p>
                  <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>U$S {formatMontoFull(totalIngresosUSD)}</p>
                  {divider}
                  <p style={styles.summaryLabel}>Balance USD</p>
                  {(() => { const b = totalIngresosUSD - totalUSD; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? sem.positivo : sem.negativo }}>{b >= 0 ? '+' : ''}U$S {formatMontoFull(Math.abs(b))}</p> })()}
                </>}
              </div>
            )}

            {/* === Resumen general: card EUR combinada === */}
            {!esVistaIngresos && allAccounts && (totalEUR > 0 || totalIngresosEUR > 0) && (
              <div style={styles.summaryCard}>
                <p style={styles.summaryLabel}>Egresos EUR</p>
                <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>€ {formatMontoFull(totalEUR)}</p>
                {hayIngresos && totalIngresosEUR > 0 && <>{divider}
                  <p style={styles.summaryLabel}>Ingresos EUR</p>
                  <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>€ {formatMontoFull(totalIngresosEUR)}</p>
                  {divider}
                  <p style={styles.summaryLabel}>Balance EUR</p>
                  {(() => { const b = totalIngresosEUR - totalEUR; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? sem.positivo : sem.negativo }}>{b >= 0 ? '+' : ''}€ {formatMontoFull(Math.abs(b))}</p> })()}
                </>}
              </div>
            )}

            {/* vs mes anterior */}
            {(diffPct !== null || diffIngPct !== null) && mesAnterior && selectedMeses.length === 1 && !esVistaIngresos && (
              <div style={styles.summaryCard}>
                <p style={{ ...styles.summaryLabel, marginBottom: '6px' }}>vs {mesLabel(mesAnterior)}</p>
                {diffPct !== null && <>
                  <p style={{ ...styles.summaryLabel, marginBottom: '2px', opacity: 0.7 }}>Gastos</p>
                  <p style={{...styles.summaryValue, color: diffPct > 0 ? sem.negativo : sem.teal, fontSize: '20px', marginBottom: '2px'}}>
                    {diffPct > 0 ? '↑' : '↓'} {Math.abs(diffPct)}%
                  </p>
                  <p style={{...styles.summarySubval, marginBottom: diffIngPct !== null ? '8px' : 0}}>{diffMonto > 0 ? '+' : ''}$ {formatMonto(Math.abs(diffMonto))}</p>
                </>}
                {diffIngPct !== null && <>
                  {diffPct !== null && <div style={{ borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, margin: '4px 0 6px' }} />}
                  <p style={{ ...styles.summaryLabel, marginBottom: '2px', opacity: 0.7 }}>Ingresos</p>
                  <p style={{...styles.summaryValue, color: diffIngPct > 0 ? sem.teal : sem.negativo, fontSize: '20px', marginBottom: '2px'}}>
                    {diffIngPct > 0 ? '↑' : '↓'} {Math.abs(diffIngPct)}%
                  </p>
                  <p style={styles.summarySubval}>{diffIngMonto > 0 ? '+' : ''}$ {formatMonto(Math.abs(diffIngMonto))}</p>
                </>}
              </div>
            )}

            {/* Categorías top */}
            {catTopList.length > 0 && !esVistaIngresos && (
              <div style={{ ...styles.summaryCard }}>
                <p style={styles.summaryLabel}>Categorías top</p>
                {catTopList.map(([cat, val], i) => (
                  <div key={cat} style={{ marginTop: i === 0 ? '6px' : '10px' }}>
                    <div style={{ fontSize: '13px', color: darkMode ? '#e0e0e0' : '#3a3a3c' }}>{resolveIcon(cat)} {cat}</div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: darkMode ? '#F0EDEC' : '#1d1d1f', marginTop: '2px' }}>$ {formatMonto(val)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Pago tarjetas del mes */}
            {pagosTarjetasGeneral.length > 0 && !esVistaIngresos && (
              <div style={{ ...styles.summaryCard }}>
                <p style={styles.summaryLabel}>Pago tarjetas del mes</p>
                {pagosTarjetasGeneral.map(([cuenta, val], i) => (
                  <div key={cuenta} style={{ marginTop: i === 0 ? '6px' : '10px' }}>
                    <div style={{ fontSize: '13px', color: darkMode ? '#e0e0e0' : '#3a3a3c' }}>💳 {cuenta}</div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: darkMode ? '#F0EDEC' : '#1d1d1f', marginTop: '2px' }}>$ {formatMonto(val)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Equiv con toggle ARS⇌USD */}
            {tcEfectivo > 0 && !esVistaIngresos && (
              <div style={styles.summaryCard}>
                <p style={{ ...styles.summaryLabel, marginBottom: '8px' }}>Equiv. totales</p>
                <div style={{ display: 'flex', borderRadius: '8px', border: `1.5px solid ${darkMode ? '#4A3F4A' : '#C8C0CC'}`, overflow: 'hidden', marginBottom: '10px' }}>
                  {[{ v: false, label: 'ARS' }, { v: true, label: 'USD' }].map(opt => (
                    <button key={opt.label} onClick={() => setEquivEnUSD(opt.v)}
                      style={{ flex: 1, padding: '6px 0', border: 'none', background: equivEnUSD === opt.v ? '#5C4F5C' : 'transparent', color: equivEnUSD === opt.v ? 'white' : (darkMode ? '#9A8A9A' : '#6e6e73'), cursor: 'pointer', fontSize: '12px', fontWeight: '600', fontFamily: '"Montserrat", sans-serif', outline: 'none', transition: 'all 0.15s' }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {equivEnUSD ? <>
                  <p style={styles.summaryLabel}>Egresos</p>
                  <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>U$S {formatMonto(egresosEquivUSD)}</p>
                  {hayIngresos && ingresosEquivUSD > 0 && <>{divider}
                    <p style={styles.summaryLabel}>Ingresos</p>
                    <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>U$S {formatMonto(ingresosEquivUSD)}</p>
                    {divider}
                    <p style={styles.summaryLabel}>Balance</p>
                    {(() => { const b = ingresosEquivUSD - egresosEquivUSD; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? sem.positivo : sem.negativo }}>{b >= 0 ? '+' : ''}U$S {formatMonto(Math.abs(b))}</p> })()}
                  </>}
                </> : <>
                  <p style={styles.summaryLabel}>Egresos</p>
                  <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>$ {formatMonto(egresosEquivARS)}</p>
                  {hayIngresos && ingresosEquivARS > 0 && <>{divider}
                    <p style={styles.summaryLabel}>Ingresos</p>
                    <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>$ {formatMonto(ingresosEquivARS)}</p>
                    {divider}
                    <p style={styles.summaryLabel}>Balance</p>
                    {(() => { const b = ingresosEquivARS - egresosEquivARS; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? sem.positivo : sem.negativo }}>{b >= 0 ? '+' : ''}$ {formatMonto(Math.abs(b))}</p> })()}
                  </>}
                </>}
              </div>
            )}

          </div></div>
        )
      })()}

      {esVistaIngresos && ingresosBarData.length > 0 && (
        <div style={styles.chartSection}>
          <h3 style={{ ...styles.chartTitle, display: 'flex', alignItems: 'center' }}>
            📊 Ingresos por mes — últimos 12 meses
            <InfoTooltip darkMode={darkMode} text="Últimos 12 meses. Moneda: ARS — los ingresos en USD/€ están convertidos a pesos al TC de cada movimiento." />
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={ingresosBarData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6e6e73' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6e6e73' }} tickFormatter={v => `$${formatMonto(v)}`} width={80} />
              <Tooltip formatter={(v) => [`$${formatMontoFull(v)}`, 'Total']} />
              <Bar dataKey="total" fill={BAR_COLOR} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {!esVistaIngresos && !allAccounts && account?.tipo === 'credito' && (
        <div style={styles.chartSection}>
          <h3 style={{ ...styles.chartTitle, display: 'flex', alignItems: 'center' }}>
            📊 Total facturado por resumen
            <InfoTooltip darkMode={darkMode} text="Histórico completo, un mes por barra. Con el lápiz de la lista de abajo se puede corregir el monto, el nombre del mes y la moneda (ARS o USD) de cada uno, o agregar un mes nuevo a mano sin necesidad de cargar un PDF." />
          </h3>
          {barData.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={barData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6e6e73' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6e6e73' }} tickFormatter={v => formatMonto(v)} width={80} />
                <Tooltip formatter={(v, n, props) => [`${props.payload.moneda === 'USD' ? 'U$S' : '$'} ${formatMontoFull(v)}`, 'Total']} />
                <Bar dataKey="total" fill={BAR_COLOR} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {/* Carga/corrección manual por mes — mismo dato que dibuja la barra
              (barData), así nunca puede desalinearse con lo que se ve arriba. */}
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {barData.map(b => (
              <div key={b.mes}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 2px', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73', gap: '8px' }}>
                {editBarMes?.mes === b.mes ? (
                  <>
                    <input type="text" autoFocus value={editBarPeriodo} onChange={e => setEditBarPeriodo(e.target.value)}
                      placeholder="Ej: Junio 2026"
                      style={{ flex: 1, minWidth: 0, padding: '3px 6px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, backgroundColor: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px' }} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <select value={editBarMoneda} onChange={e => setEditBarMoneda(e.target.value)}
                        style={{ padding: '3px 4px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, backgroundColor: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px' }}>
                        <option value="ARS">$</option>
                        <option value="USD">U$S</option>
                      </select>
                      <input type="number" value={editBarValor} onChange={e => setEditBarValor(e.target.value)}
                        style={{ width: '100px', padding: '3px 6px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, backgroundColor: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px' }} />
                      <button onClick={() => guardarTotalFacturadoMes(b)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sem.teal, fontSize: '13px' }}>✓</button>
                      <button onClick={() => setEditBarMes(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: darkMode ? '#9A8A9A' : '#75757a', fontSize: '13px' }}>✕</button>
                    </span>
                  </>
                ) : (
                  <>
                    {/* Con más de una ficha en el mes, el renglón se despliega: es el
                        único lugar donde se ven por separado cuando quedaron con fechas
                        de cierre distintas y el aviso de "A pagar" no las junta. */}
                    <span onClick={() => b.statementIds.length > 1 && setMesDesplegado(m => m === b.mes ? null : b.mes)}
                      style={{ cursor: b.statementIds.length > 1 ? 'pointer' : 'default' }}>
                      {b.statementIds.length > 1 ? `${mesDesplegado === b.mes ? '▾' : '▸'} ` : ''}{b.mes}{b.statementIds.length > 1 ? ` (${b.statementIds.length} resúmenes cargados, se muestra el mayor)` : ''}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <span>
                        {b.totalArs > 0 && `$ ${formatMonto(b.totalArs)}`}
                        {b.totalArs > 0 && b.totalUsd > 0 && ' + '}
                        {b.totalUsd > 0 && `U$S ${formatMonto(b.totalUsd)}`}
                      </span>
                      <button onClick={() => { setEditBarMes(b); setEditBarValor(String(Math.round(b.total))); setEditBarPeriodo(b.mes); setEditBarMoneda(b.moneda) }} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, fontSize: '12px' }}>✏️</button>
                      {confirmDeleteMes === b.mes ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button onClick={() => setConfirmDeleteMes(null)} style={{ padding: '3px 8px', background: 'none', color: darkMode ? '#9A8A9A' : '#6e6e73', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontFamily: '"Montserrat", sans-serif' }}>No</button>
                          <button onClick={() => eliminarMesFacturado(b)} style={{ padding: '3px 8px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontFamily: '"Montserrat", sans-serif' }}>Sí, borrar</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDeleteMes(b.mes)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, fontSize: '12px' }}>🗑️</button>
                      )}
                    </span>
                  </>
                )}
              </div>
              {mesDesplegado === b.mes && b.resumenes.length > 1 && (
                <div style={{ padding: '2px 2px 8px 16px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {b.resumenes.map(r => (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#75757a' }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.nombre_archivo || undefined}>
                        {cierreDe(r) ? `Cierra ${formatFecha(cierreDe(r))}` : 'Sin fecha de cierre'}
                        {r.nombre_archivo ? ` · ${r.nombre_archivo}` : ' · cargado a mano'}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        <span>
                          $ {formatMonto(Number(r.total_resumen) || 0)}
                          {r.total_dolares ? ` + U$S ${formatMontoFull(Number(r.total_dolares))}` : ''}
                        </span>
                        {confirmDeleteResumen === r.id ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button onClick={() => setConfirmDeleteResumen(null)} style={{ padding: '2px 7px', background: 'none', color: darkMode ? '#9A8A9A' : '#6e6e73', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '10px', fontFamily: '"Montserrat", sans-serif' }}>No</button>
                            <button onClick={() => borrarResumenSuelto(r.id)} style={{ padding: '2px 7px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '10px', fontFamily: '"Montserrat", sans-serif' }}>Sí, borrar este</button>
                          </span>
                        ) : (
                          <button onClick={() => setConfirmDeleteResumen(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, fontSize: '11px' }}>🗑️</button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              </div>
            ))}
          </div>
          {showAddMes ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
              <input type="text" autoFocus value={nuevoMes.periodo} onChange={e => setNuevoMes({ ...nuevoMes, periodo: e.target.value })}
                placeholder="Ej: Agosto 2026"
                style={{ flex: 1, minWidth: '120px', padding: '5px 8px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, backgroundColor: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px' }} />
              <select value={nuevoMes.moneda} onChange={e => setNuevoMes({ ...nuevoMes, moneda: e.target.value })}
                style={{ padding: '5px 4px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, backgroundColor: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px' }}>
                <option value="ARS">$</option>
                <option value="USD">U$S</option>
              </select>
              <input type="number" value={nuevoMes.valor} onChange={e => setNuevoMes({ ...nuevoMes, valor: e.target.value })}
                placeholder="Monto" style={{ width: '100px', padding: '5px 8px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, backgroundColor: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px' }} />
              <button onClick={agregarMesFacturado} style={{ background: 'none', border: 'none', cursor: 'pointer', color: sem.teal, fontSize: '13px' }}>✓</button>
              <button onClick={() => { setShowAddMes(false); setNuevoMes({ periodo: '', valor: '', moneda: 'ARS' }) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: darkMode ? '#9A8A9A' : '#75757a', fontSize: '13px' }}>✕</button>
            </div>
          ) : (
            <button onClick={() => setShowAddMes(true)} style={{ marginTop: '8px', background: 'none', border: 'none', cursor: 'pointer', color: BAR_COLOR, fontSize: '12px', padding: '4px 2px', textAlign: 'left' }}>+ Agregar mes</button>
          )}
        </div>
      )}

      {esVistaIngresos && mesesDisponibles.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>💰</p>
          <p style={{ fontSize: '16px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', marginBottom: '8px' }}>Todavía no hay ingresos registrados</p>
          <p style={{ fontSize: '13px', color: darkMode ? '#9A8A9A' : '#75757a', marginBottom: '24px' }}>Registrá tu primer ingreso para ver los gráficos y totales</p>
        </div>
      )}

      {mesesDisponibles.length > 0 && (
        <div style={styles.chartSection}>
          {selectedMeses.length === 0 && (
            <p style={{color: muted, fontSize:'14px', marginTop:'16px'}}>Seleccioná al menos un mes.</p>
          )}

          {(() => {
            // Antes había que elegir "Agrupar: Categoría / Persona" para ver uno u
            // otro gráfico — con hijos de por medio hay lugar de sobra para mostrar
            // los dos juntos, sin obligar a elegir.
            const dosGraficos = !esVistaIngresos && childNames.length > 0
            const graficoCategoria = esVistaIngresos ? displayChartData : categoriaBubbleData
            const hayAlgunGrafico = dosGraficos ? (categoriaBubbleData.length > 0 || personaBubbleData.length > 0) : graficoCategoria.length > 0
            if (!hayAlgunGrafico) return null
            const periodoLabelChart = selectedMeses.length === 1 ? mesLabel(selectedMeses[0])
              : selectedMeses.length === mesesDisponibles.length ? 'todos los meses'
              : (selectedMeses.length === 0 ? 'ningún mes' : `${selectedMeses.length} meses`)
            const monedaLabelChart = esVistaIngresos && (totalIngresosUSD > 0 || totalIngresosEUR > 0) ? 'ARS (monedas extranjeras convertidas)'
              : !esVistaIngresos && (totalUSD > 0 || totalEUR > 0) ? 'ARS (monedas extranjeras convertidas)'
              : 'ARS'
            const renderBubbleCard = (data, titulo, extraStyle) => data.length === 0 ? null : (
              <div key={titulo} style={{ ...styles.bubbleSection, minWidth: 0, ...extraStyle }}>
                <h3 style={{ ...styles.chartTitle, fontSize: '14px', margin: '0 0 10px', display: 'flex', alignItems: 'center' }}>
                  {titulo}
                  <InfoTooltip darkMode={darkMode} text={`${monedaLabelChart} · ${periodoLabelChart}`} />
                </h3>
                {effectiveChartType === 'donut' && (
                  // flexWrap: cuando la tarjeta queda angosta (ej. dos donuts lado a
                  // lado en un ancho intermedio, ni mobile ni desktop completo), la
                  // columna de texto NO se aprieta infinitamente — al llegar a su
                  // ancho mínimo (flexBasis, flexShrink:0) toda la columna pasa a la
                  // fila de abajo en vez de que el texto se corte letra por letra.
                  // alignItems center (antes flex-start en desktop): con pocas
                  // categorías la leyenda es más baja que el donut y quedaba
                  // pegada al borde de arriba, como flotando y sin relación con
                  // su propio gráfico — se notaba al ver los dos donuts lado a
                  // lado, uno con 13 renglones (que llenan el alto) y el otro
                  // con 3. Centrada, la leyenda queda a la altura del donut sea
                  // larga o corta.
                  <div style={{ display: 'flex', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: 'center' }}>
                    <ResponsiveContainer width={isMobile ? '100%' : 260} height={isMobile ? 220 : 240}>
                      <PieChart>
                        <Pie data={data} cx="50%" cy="50%" innerRadius={isMobile ? 58 : 68} outerRadius={isMobile ? 90 : 108} dataKey="value" paddingAngle={2}>
                          {data.map((entry, idx) => (
                            <Cell key={idx} fill={getChartColor(entry.name)} stroke="none" />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v, name) => [`$ ${formatMonto(v)}`, name]} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Sin paddingTop en desktop: existía para compensar la
                        alineación de arriba, y ahora que la leyenda va centrada
                        respecto del donut la corría de más.

                        flexGrow 0 en desktop (antes 1): la columna se estiraba
                        hasta ocupar todo el ancho sobrante de la card, y como el
                        monto va alineado a la derecha, quedaba pegado al borde
                        con un hueco enorme entre el nombre y el número — muy
                        visible con nombres cortos ("Personal", "Vitto"). Ahora la
                        columna mide lo que mide su contenido y queda al lado del
                        donut; el espacio que sobra queda libre a la derecha. El
                        nombre igual no se corta: la columna crece con él. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', paddingTop: isMobile ? '4px' : 0, width: isMobile ? '100%' : 'auto', minWidth: isMobile ? undefined : '200px', maxWidth: isMobile ? undefined : '340px', flexGrow: 0, flexShrink: 0, flexBasis: isMobile ? '100%' : 'auto' }}>
                      {/* Antes el nombre se truncaba con "..." a los 150px fijos aunque
                          sobrara espacio a lo ancho — ahora ocupa el espacio disponible
                          de la fila (flex:1) y si de verdad no entra, pasa a una segunda
                          línea en vez de cortarse. */}
                      {/* El ícono va en su propia celda de ancho fijo, no pegado
                          al nombre en el mismo texto: los emojis no miden todos
                          igual (👤 es más angosto que 🧒), así que con todo en
                          un solo span cada nombre arrancaba en una x distinta y
                          la columna quedaba despareja. */}
                      {data.map((entry, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: getChartColor(entry.name), flexShrink: 0 }} />
                          <span style={{ width: 20, flexShrink: 0, textAlign: 'center', lineHeight: 1 }}>{getChartIcon(entry.name)}</span>
                          <span style={{ color: darkMode ? '#e0e0e0' : '#3a3a3c', flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word' }}>{entry.name}</span>
                          <span style={{ fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', whiteSpace: 'nowrap', flexShrink: 0 }}>$ {formatMonto(entry.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {effectiveChartType === 'bars' && (() => {
                  const rowH = 36
                  const chartH = Math.max(180, data.length * rowH + 24)
                  return (
                    <ResponsiveContainer width="100%" height={chartH}>
                      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
                        <XAxis type="number" tickFormatter={v => `$${formatMonto(v)}`} tick={{ fontSize: 10, fill: darkMode ? '#9A8A9A' : '#6e6e73', fontFamily: '"Montserrat", sans-serif' }} />
                        <YAxis type="category" dataKey="name" width={isMobile ? 90 : 130}
                          tickFormatter={(name) => {
                            const max = isMobile ? 13 : 19
                            return name && name.length > max ? `${name.slice(0, max - 1)}…` : name
                          }}
                          tick={{ fontSize: isMobile ? 10 : 12, fill: darkMode ? '#F0EDEC' : '#3a3a3c', fontFamily: '"Montserrat", sans-serif' }} />
                        <Tooltip formatter={(v) => [`$ ${formatMonto(v)}`, 'Total']} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {data.map((entry, idx) => (
                            <Cell key={idx} fill={getChartColor(entry.name)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )
                })()}
              </div>
            )
            return (
              <>
                {/* Selector de tipo de gráfico — solo Donut y Barras, compartido entre
                    los dos gráficos cuando se muestran los dos a la vez. */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73', marginRight: '2px' }}>Vista:</span>
                  {[{ type: 'donut', label: '◎ Donut' }, { type: 'bars', label: '▤ Barras' }].map(opt => (
                    <button key={opt.type}
                      onClick={() => { setChartType(opt.type); localStorage.setItem('chart_type_ma', opt.type) }}
                      style={{ padding: '4px 11px', borderRadius: '8px', border: `1px solid ${effectiveChartType === opt.type ? (darkMode ? '#8C7B8C' : '#5C4F5C') : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: effectiveChartType === opt.type ? (darkMode ? '#8C7B8C' : '#5C4F5C') : 'transparent', color: effectiveChartType === opt.type ? 'white' : (darkMode ? '#9A8A9A' : '#6e6e73'), cursor: 'pointer', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', transition: 'all 0.15s' }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {/* Grid fijo de 2 columnas en desktop (en vez de flex-wrap, que
                    dependía de que la suma de anchos "entrara" y en la práctica
                    los apilaba igual) — así "Gastos por categoría" y "Gastos por
                    persona" quedan siempre lado a lado en pantallas de compu,
                    y la página no queda tan larga para llegar a los movimientos. */}
                <div style={{ display: dosGraficos && !isMobile ? 'grid' : 'flex', gridTemplateColumns: dosGraficos && !isMobile ? 'repeat(2, 1fr)' : undefined, gap: '20px', flexWrap: 'wrap' }}>
                  {dosGraficos
                    ? [
                        renderBubbleCard(categoriaBubbleData, 'Gastos por categoría'),
                        // Línea sutil entre los dos donuts para que no se lean como un
                        // solo bloque — mismo color de borde que el resto de la app.
                        renderBubbleCard(personaBubbleData, 'Gastos por persona', !isMobile ? {
                          borderLeft: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, paddingLeft: '20px'
                        } : undefined),
                      ]
                    : renderBubbleCard(graficoCategoria, esVistaIngresos ? 'Ingresos por categoría' : 'Gastos por categoría')}
                </div>
              </>
            )
          })()}
          {selectedMeses.length > 0 && displayChartData.length === 0 && !esVistaIngresos && (
            <p style={{color: darkMode ? '#9A8A9A' : '#75757a', fontSize:'14px', marginTop:'16px'}}>Sin gastos en los meses seleccionados.</p>
          )}
          {selectedMeses.length > 0 && displayChartData.length === 0 && esVistaIngresos && (
            <p style={{color: darkMode ? '#9A8A9A' : '#75757a', fontSize:'14px', marginTop:'16px'}}>Sin ingresos en el mes seleccionado.</p>
          )}
        </div>
      )}


      {/* Buscador */}
      <div style={{ marginBottom: '24px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input
          style={{
            flex: '1 1 260px', padding: '10px 14px', borderRadius: '12px',
            border: `1.5px solid ${darkMode ? '#3A333A' : '#e0e0e0'}`, fontSize: '14px', outline: 'none',
            boxSizing: 'border-box', backgroundColor: darkMode ? '#1C1A1C' : '#fafafa', color: darkMode ? '#F0EDEC' : '#1d1d1f'
          }}
          placeholder="🔍 Buscar por nombre, cuenta, categoría, fecha, monto..."
          value={searchQuery || ''}
          onChange={e => onSearchChange && onSearchChange(e.target.value)}
        />
        {(allAccounts || esVistaIngresos) && (
          <select
            style={{
              flex: '0 1 200px', padding: '10px 14px', borderRadius: '12px',
              border: `1.5px solid ${darkMode ? '#3A333A' : '#e0e0e0'}`, fontSize: '14px', outline: 'none',
              boxSizing: 'border-box', backgroundColor: darkMode ? '#1C1A1C' : '#fafafa', color: darkMode ? '#F0EDEC' : '#1d1d1f'
            }}
            value={filtroCuenta}
            onChange={e => setFiltroCuenta(e.target.value)}
          >
            <option value="">Todas las cuentas</option>
            {(accounts || []).map(a => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
        )}
      </div>

      {sinIdentificar.length > 0 && (
        <div style={styles.tableSection}>
          <h3 style={styles.chartTitle}>❓ Sin identificar ({sinIdentificar.length})</h3>
          <p style={styles.tableHint}>{esVistaIngresos ? 'Asignale una categoría a estos ingresos' : 'Editá el nombre, categoría y subcategoría de estos gastos'}</p>
          <div style={{ width: '100%' }}>
          <table style={{...styles.table, tableLayout: 'fixed'}}>
            <colgroup>
              <col style={{ width: `${FECHA_PX}px` }} />
              {colVisible.cuenta && <col style={{ width: `${anchosTextoSinId.cuenta}px` }} />}
              {colVisible.subcategoria && <col style={{ width: `${anchosTextoSinId.subcategoria}px` }} />}
              <col style={{ width: `${anchosTextoSinId.nombre}px` }} />
              {colVisible.categoria && <col style={{ width: `${SINID_CATEGORIA_PX}px` }} />}
              <col style={{ width: `${MONTO_PX}px` }} />
              <col style={{ width: `${EXPAND_PX}px` }} />
            </colgroup>
            <thead>
              <tr>
                <th style={styles.th}>Fecha</th>
                {colVisible.cuenta && <th style={styles.th}>Detalle original</th>}
                {colVisible.subcategoria && <th style={styles.th}>Cuenta</th>}
                <th style={styles.th}>Nombre</th>
                {colVisible.categoria && <th style={styles.th}>Categoría</th>}
                <th style={styles.th}>Monto</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {sinIdentificar.map(tx => {
                const numColsSinId = 4 + (colVisible.categoria ? 1 : 0) + (colVisible.cuenta ? 1 : 0) + (colVisible.subcategoria ? 1 : 0)
                if (editingTx === tx.id) {
                  return (
                    <tr key={tx.id} style={styles.trUnknown}>
                      {renderEditStackMobile(tx, numColsSinId)}
                    </tr>
                  )
                }
                const expandido = filaExpandida === tx.id
                return (
                  <React.Fragment key={tx.id}>
                    <tr
                      style={{ ...styles.trUnknown, cursor: 'pointer' }}
                      onClick={() => setFilaExpandida(prev => prev === tx.id ? null : tx.id)}
                    >
                      <td style={{...styles.td, whiteSpace: 'nowrap', wordBreak: 'normal'}}>{formatFechaCorta(tx.fecha)}</td>
                      {colVisible.cuenta && <td style={ellipsisCell} title={tx.detalle}><span style={styles.detalle}>{tx.detalle}</span></td>}
                      {colVisible.subcategoria && (
                        <td style={ellipsisCell}>
                          <span style={{fontSize:'12px', color: muted}}>{tx.accounts?.nombre || '—'}</span>
                        </td>
                      )}
                      <td style={ellipsisCell} title={tx.nombre || ''}><span style={{color: muted}}>{tx.nombre || '—'}</span></td>
                      {colVisible.categoria && <td style={ellipsisCell}><span style={{color: muted}}>—</span></td>}
                      <td style={{...styles.td, textAlign:'right', fontWeight:'600', whiteSpace: 'nowrap', wordBreak: 'normal'}}>
                        {monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'center', width: '28px', padding: '10px 4px', color: darkMode ? '#8A7A8A' : '#75757a' }}>{expandido ? '▾' : '▸'}</td>
                    </tr>
                    {expandido && (
                      <tr style={styles.tr}>
                        <td colSpan={numColsSinId} style={{ ...styles.td, backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', padding: '2px 2px 10px' }}>
                            <div style={{ flexBasis: '100%' }}>
                              <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }}>Nombre</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.nombre || '—'}</p>
                            </div>
                            <div>
                              <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }}>Detalle original</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.detalle || '—'}</p>
                            </div>
                            <div>
                              <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }}>Cuenta</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.accounts?.nombre || '—'}</p>
                            </div>
                            <div>
                              <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }}>Moneda</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.moneda || 'ARS'}</p>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button style={styles.accionBtn} onClick={() => startEdit(tx)}>✏️ Editar</button>
                            <button style={styles.accionBtn} onClick={() => handleMarcarNeutro(tx)}>🔄 Marcar neutro</button>
                            <button style={{...styles.accionBtn, ...styles.accionBtnDanger}} onClick={() => handleDeleteTx(tx)}>🗑️ Borrar</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div style={styles.tableSection}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ ...styles.chartTitle, margin: 0 }}>{esVistaIngresos ? `💰 Todos los ingresos (${identificadas.length})` : `📋 Todas las transacciones (${identificadas.length})`}</h3>
          {txFiltradas.length > 0 && (
            <button onClick={handleExportCSV} style={styles.exportBtn}>
              ↓ Exportar CSV
            </button>
          )}
        </div>
        {/* Filtros de columna activos. Sin esto, un filtro puesto en una columna
            que después se oculta por ancho de pantalla dejaría la tabla recortada
            sin ninguna pista de por qué. */}
        {columnasFiltradas.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '12px' }}>
            {columnasFiltradas.map(k => (
              <span key={k} style={styles.filtroColChip}>
                {ETIQUETA_COLUMNA[k]}: {filtrosCol[k].length === 0
                  ? 'nada seleccionado'
                  : (filtrosCol[k].length <= 2 ? filtrosCol[k].join(', ') : `${filtrosCol[k].length} valores`)}
                <button
                  onClick={() => setFiltrosCol(prev => { const next = { ...prev }; delete next[k]; return next })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '13px', lineHeight: 1, color: 'inherit' }}
                  title="Quitar este filtro"
                >×</button>
              </span>
            ))}
            <button
              onClick={() => setFiltrosCol({})}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline', color: darkMode ? '#9A8A9A' : '#6e6e73', fontFamily: '"Montserrat", sans-serif' }}
            >
              Limpiar todo
            </button>
          </div>
        )}
        <div ref={tablaRef} style={{ width: '100%' }}>
        <table style={{...styles.table, tableLayout: 'fixed'}}>
          <colgroup>
            <col style={{ width: `${FECHA_PX}px` }} />
            <col style={{ width: `${anchosTextoPral.nombre}px` }} />
            {colVisible.categoria && <col style={{ width: `${anchosTextoPral.categoria}px` }} />}
            {colVisible.cuenta && <col style={{ width: `${anchosTextoPral.cuenta}px` }} />}
            {colVisible.subcategoria && <col style={{ width: `${anchosTextoPral.subcategoria}px` }} />}
            {colVisible.cuotas && <col style={{ width: `${CUOTAS_PX}px` }} />}
            <col style={{ width: `${MONTO_PX}px` }} />
            <col style={{ width: `${EXPAND_PX}px` }} />
          </colgroup>
          <thead>
            <tr>
              {thSortable('Fecha', 'fecha')}
              {thFiltrable('Nombre', 'nombre')}
              {colVisible.categoria && thFiltrable('Categoría', 'categoria')}
              {colVisible.cuenta && thFiltrable('Cuenta', 'cuenta')}
              {colVisible.subcategoria && thFiltrable('Subcategoría', 'subcategoria')}
              {colVisible.cuotas && thFiltrable('Cuotas', 'cuotas')}
              {thFiltrable('Monto', 'monto', 'right', 'moneda')}
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {filasTablaVisibles.map(fila => fila.tipo === 'single' ? renderTxRow(fila.tx) : renderFilaGrupo(fila.grupo, fila.expandido))}
          </tbody>
          {/* Los totales son de todos los movimientos que pasan los filtros, no
              solo de las filas visibles — el corte de mobile no los cambia, si no
              la tabla mentiría sobre cuánto se gastó. Un filtro de columna sí los
              cambia, a propósito: sirve para saber cuánto suma lo filtrado. */}
          <TotalesFooter txs={identificadas} tcMap={tcMap} tipoCambio={tipoCambio} tcMapEUR={tcMapEUR} tipoCambioEUR={tipoCambioEUR} darkMode={darkMode} colSpan={numColsTabla} />
        </table>
        {hayMasMovimientos && (
          <button
            onClick={() => setVerTodosMovimientos(v => !v)}
            style={{ width: '100%', marginTop: '10px', padding: '10px', borderRadius: '10px', border: `1.5px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '500', color: darkMode ? '#C0B0C0' : '#5C4F5C', fontFamily: '"Montserrat", sans-serif' }}
          >
            {/* Se cuentan FILAS restantes, no transacciones: un gasto dividido
                entre hijos ocupa una sola fila, así que decir "N transacciones"
                acá se contradiría con el contador del título. */}
            {verTodosMovimientos
              ? '▴ Ver menos'
              : `▾ Ver ${filasTabla.length - MOVIMIENTOS_VISIBLES} más`}
          </button>
        )}
        </div>
      </div>

      {/* Movimientos neutros — colapsados al final */}
      {txNeutras.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <button
            onClick={() => setShowNeutros(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: darkMode ? '#6A5A6A' : '#9e9e9e', fontFamily: '"Montserrat", sans-serif', padding: '4px 0', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {showNeutros ? '▾' : '▸'} Movimientos neutros ({txNeutras.length}) — pagos, transferencias, inversiones
          </button>
          {showNeutros && (
            <div style={{ marginTop: '10px' }}>
              <table style={{...styles.table, tableLayout: 'fixed'}}>
                <colgroup>
                  <col style={{ width: `${FECHA_PX}px` }} />
                  <col style={{ width: `${anchosTextoNeutros.nombre}px` }} />
                  {colVisible.categoria && <col style={{ width: `${anchosTextoNeutros.categoria}px` }} />}
                  {colVisible.subcategoria && <col style={{ width: `${anchosTextoNeutros.subcategoria}px` }} />}
                  {colVisible.cuenta && <col style={{ width: `${anchosTextoNeutros.cuenta}px` }} />}
                  <col style={{ width: `${MONTO_PX}px` }} />
                  <col style={{ width: `${EXPAND_PX}px` }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={styles.th}>Fecha</th>
                    <th style={styles.th}>Nombre</th>
                    {colVisible.categoria && <th style={styles.th}>Categoría</th>}
                    {colVisible.subcategoria && <th style={styles.th}>Subcategoría</th>}
                    {colVisible.cuenta && <th style={styles.th}>Cuenta</th>}
                    <th style={styles.th}>Monto</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {txNeutras.map(tx => {
                    const numColsNeutros = 4 + (colVisible.categoria ? 1 : 0) + (colVisible.subcategoria ? 1 : 0) + (colVisible.cuenta ? 1 : 0)
                    if (editingTx === tx.id) {
                      return (
                        <tr key={tx.id} style={styles.tr}>
                          {renderEditStackMobile(tx, numColsNeutros)}
                        </tr>
                      )
                    }
                    const expandido = filaExpandida === tx.id
                    return (
                      <React.Fragment key={tx.id}>
                        <tr
                          style={{ ...styles.tr, opacity: 0.6, cursor: 'pointer' }}
                          onClick={() => setFilaExpandida(prev => prev === tx.id ? null : tx.id)}
                        >
                          <td style={{...styles.td, whiteSpace:'nowrap', wordBreak: 'normal'}}>{formatFechaCorta(tx.fecha)}</td>
                          <td style={ellipsisCell} title={tx.nombre || tx.detalle}>{tx.nombre || tx.detalle}</td>
                          {colVisible.categoria && (
                            <td style={ellipsisCell}><span style={{fontSize:'12px', color: muted}}>{tx.categories?.nombre || '—'}</span></td>
                          )}
                          {colVisible.subcategoria && (
                            <td style={ellipsisCell}><span style={{fontSize:'12px', color: muted}}>{tx.subcategories?.nombre || '—'}</span></td>
                          )}
                          {colVisible.cuenta && (
                            <td style={ellipsisCell}><span style={{fontSize:'12px', color: muted}}>{tx.accounts?.nombre || '—'}</span></td>
                          )}
                          <td style={{...styles.td, textAlign:'right', whiteSpace: 'nowrap', wordBreak: 'normal', color: darkMode ? '#6A5A6A' : '#9e9e9e'}} title={tcTooltipDe(tx, tcMap, tipoCambio)}>
                            {monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center', width: '28px', padding: '10px 4px', color: darkMode ? '#8A7A8A' : '#75757a' }}>{expandido ? '▾' : '▸'}</td>
                        </tr>
                        {expandido && (
                          <tr style={styles.tr}>
                            <td colSpan={numColsNeutros} style={{ ...styles.td, backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', padding: '2px 2px 10px' }}>
                                <div style={{ flexBasis: '100%' }}>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }}>Nombre</p>
                                  <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.nombre || tx.detalle || '—'}</p>
                                </div>
                                <div>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }}>Categoría</p>
                                  <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.categories?.nombre || '—'}</p>
                                </div>
                                <div>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }}>Subcategoría</p>
                                  <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.subcategories?.nombre || '—'}</p>
                                </div>
                                <div>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }}>Cuenta</p>
                                  <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.accounts?.nombre || '—'}</p>
                                </div>
                                <div>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#75757a', ...rotuloLabel, margin: '0 0 2px' }}>Moneda</p>
                                  <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.moneda || 'ARS'}</p>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button style={styles.accionBtn} onClick={() => startEdit(tx)}>✏️ Editar</button>
                                <button style={{...styles.accionBtn, ...styles.accionBtnDanger}} onClick={() => handleDeleteTx(tx)}>🗑️ Borrar</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      </>)}

      {repartoModalTx && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: darkMode ? '#2A272A' : 'white', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '440px', margin: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.20)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
            <h3 style={{ fontSize: '17px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', margin: '0 0 4px' }}>🔀 Dividir gasto</h3>
            <p style={{ fontSize: '13px', color: darkMode ? '#9A8A9A' : '#75757a', margin: '0 0 16px' }}>{repartoModalTx.nombre || repartoModalTx.detalle} · {monedaSymbol(repartoModalTx.moneda)} {formatMontoFull(repartoModalTx.monto)}</p>
            <p style={{ fontSize: '11px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel, margin: '0 0 8px' }}>Participantes</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: repartoModalSeleccion.length > 0 ? '12px' : '4px' }}>
              {opcionesParticipantesReparto.map(op => {
                const activo = repartoModalSeleccion.some(sel => sel.key === op.key)
                return (
                  <button key={op.key} type="button" onClick={() => toggleParticipanteReparto(op)}
                    style={{ padding: '6px 14px', borderRadius: '20px', border: `1.5px solid ${activo ? '#5C4F5C' : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: activo ? '#5C4F5C' : 'transparent', color: activo ? 'white' : (darkMode ? '#F0EDEC' : '#1d1d1f'), cursor: 'pointer', fontSize: '13px', fontFamily: '"Montserrat", sans-serif', fontWeight: activo ? '600' : '400' }}>
                    {op.tipo === 'yo' ? '🙋 Vos' : `👧 ${op.nombre}`}
                  </button>
                )
              })}
              {opcionesParticipantesReparto.length === 1 && (
                <span style={{ fontSize: '12px', color: muted, alignSelf: 'center' }}>Cargá hijos/as en Configuración para poder repartir con ellos.</span>
              )}
            </div>
            {repartoModalSeleccion.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                {repartoModalSeleccion.map(sel => (
                  <div key={sel.key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ flex: 1, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{sel.nombre}</span>
                    <input type="number" min="0" max="100" step="1" value={sel.porcentaje}
                      onChange={e => editarPorcentajeModalReparto(sel.key, e.target.value)}
                      style={{ width: '70px', padding: '6px 8px', borderRadius: '8px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '13px', outline: 'none', backgroundColor: darkMode ? '#1C1A1C' : '#fafafa', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontFamily: '"Montserrat", sans-serif', boxSizing: 'border-box' }} />
                    <span style={{ fontSize: '13px', color: muted }}>%</span>
                  </div>
                ))}
                <p style={{ margin: '2px 0 0', fontSize: '12px', fontWeight: '600', color: sumaModalRepartoValida ? sem.positivo : sem.negativo }}>
                  Suma: {Math.round(sumaPorcentajesModalReparto * 100) / 100}% {sumaModalRepartoValida ? '✓' : '(tiene que dar 100%)'}
                </p>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', marginTop: '20px', flexWrap: 'wrap' }}>
              <div>
                {desglosarReparto(repartoModalTx) && (
                  <button type="button" onClick={quitarReparto} style={{ padding: '10px 14px', borderRadius: '10px', border: `1.5px solid ${sem.negativo}`, color: sem.negativo, background: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: '"Montserrat", sans-serif' }}>
                    Quitar reparto
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" onClick={() => setRepartoModalTx(null)} style={{ padding: '10px 18px', borderRadius: '10px', border: '2px solid #5C4F5C', color: '#5C4F5C', background: 'transparent', cursor: 'pointer', fontSize: '14px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif' }}>
                  Cancelar
                </button>
                <button type="button" onClick={guardarReparto} disabled={!sumaModalRepartoValida} style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', backgroundColor: sumaModalRepartoValida ? '#5C4F5C' : '#bbb', color: 'white', cursor: sumaModalRepartoValida ? 'pointer' : 'not-allowed', fontSize: '14px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif' }}>
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmTx && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: darkMode ? '#2A272A' : 'white', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', margin: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.20)', boxSizing: 'border-box' }}>
            <h3 style={{ fontSize: '17px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', margin: '0 0 8px' }}>
              🗑️ {deleteConfirmTx.tipo === 'ingreso' ? '¿Eliminar este ingreso?' : '¿Eliminar este gasto?'}
            </h3>
            <p style={{ fontSize: '13px', color: darkMode ? '#9A8A9A' : '#75757a', margin: '0 0 20px' }}>
              {deleteConfirmTx.nombre || deleteConfirmTx.detalle} · {monedaSymbol(deleteConfirmTx.moneda)} {formatMontoFull(deleteConfirmTx.monto)}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDeleteConfirmTx(null)} style={{ padding: '10px 18px', borderRadius: '10px', border: '2px solid #5C4F5C', color: '#5C4F5C', background: 'transparent', cursor: 'pointer', fontSize: '14px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif' }}>
                Cancelar
              </button>
              <button type="button" onClick={confirmarDeleteTx} style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', backgroundColor: '#c0392b', color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif' }}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Este componente es el más pesado de la app (tabla grande + dos gráficos de
// recharts por cuenta) y no es el único hijo del Dashboard — cualquier cambio
// de estado ajeno ahí (abrir el desplegable de monedas, el hover de una
// cuenta en el sidebar, etc.) volvía a ejecutar y repintar todo esto sin que
// ninguno de sus props hubiera cambiado en realidad. React.memo evita ese
// repintado innecesario; los cálculos pesados de adentro ya estaban en
// useMemo, esto corta la parte que useMemo no cubre (repintar el árbol).
export default React.memo(AccountDetail)

const getStyles = (dark, mobile) => {
  const sem = semaforo(dark)
  const p = dark ? '#8C7B8C' : '#5C4F5C'
  const panel = dark ? '#2A272A' : 'white'
  const txt = dark ? '#F0EDEC' : '#1d1d1f'
  const muted = dark ? '#9A8A9A' : '#6e6e73'
  const border = dark ? '#3A333A' : '#E2DDE0'
  const cardBg = dark ? '#1A181A' : '#F0EDEC'
  const tdBorder = dark ? '#2A272A' : '#f0f2f8'
  const hdrBorder = dark ? '#3A333A' : '#EDE8EC'
  const shadow = dark ? '0 2px 12px rgba(0,0,0,0.35)' : '0 2px 12px rgba(92,79,92,0.08)'
  return {
    loading: { padding: '24px', color: muted, fontSize: '14px' },
    // auto-fit (no auto-fill): las columnas vacías colapsan a 0 en vez de
    // reservar su ancho — en desktop ancho, las cards que sí hay se reparten
    // todo el espacio disponible en vez de dejar un hueco a la derecha.
    // 3 columnas fijas en desktop (antes era auto-fit, que entraban 4 en la
    // primera fila y 2 en la segunda según el ancho disponible) — con 6
    // tarjetas típicas (ARS/USD/vs mes anterior/Categorías top/Pago
    // tarjetas/Equiv. totales) queda prolijo en 3 arriba y 3 abajo, con
    // Categorías top y Pago tarjetas del mes juntas (misma estética de lista).
    summaryCards: { display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: mobile ? '10px' : '18px', marginBottom: '24px' },
    summaryCard: { backgroundColor: panel, borderRadius: '14px', padding: mobile ? '12px 14px' : '22px 24px', boxShadow: shadow, border: `1px solid ${hdrBorder}`, minWidth: 0 },
    summaryLabel: { fontSize: mobile ? '11px' : '12px', fontWeight: '600', color: muted, margin: '0 0 4px 0', textAlign: 'center', ...rotuloLabel },
    summaryValue: { fontSize: mobile ? '16px' : '24px', fontWeight: '500', color: txt, margin: '0 0 2px 0', wordBreak: 'break-word', textAlign: 'center' },
    summarySubval: { fontSize: '12px', color: muted, margin: 0 },
    chartSection: { marginBottom: '32px' },
    chartTitle: { fontSize: '16px', fontWeight: '500', color: txt, margin: '0 0 16px 0' },
    mesChipsHeader: { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' },
    mesChips: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
    mesChip: {
      padding: '6px 14px', borderRadius: '20px', border: `1.5px solid ${border}`,
      backgroundColor: panel, color: muted, fontSize: '13px', cursor: 'pointer',
      fontWeight: '500', transition: 'all 0.15s', outline: 'none', WebkitAppearance: 'none'
    },
    mesChipActive: { backgroundColor: p, color: 'white', borderColor: p, fontWeight: '500' },
    // width: '100%' es necesario para el caso de un solo gráfico (ver "Ingresos
    // por categoría"): ese wrapper es un flex container con un único hijo sin
    // flex-grow, así que sin este ancho explícito el hijo se encoge al tamaño
    // de su contenido — y su contenido (el ResponsiveContainer) pide "100% del
    // padre" para dibujarse, quedando en un ancho casi nulo en desktop.
    bubbleSection: { marginBottom: '32px', width: '100%' },
    tableSection: { marginBottom: '32px' },
    tableHint: { fontSize: '13px', color: muted, margin: '-8px 0 12px 0' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: mobile ? '12px' : '13px', tableLayout: 'fixed' },
    th: {
      textAlign: 'left', padding: mobile ? '6px 8px' : '10px 12px', fontSize: '11px',
      color: muted, textTransform: 'uppercase', borderBottom: `2px solid ${hdrBorder}`, fontWeight: '400',
      overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis'
    },
    thSortable: {
      textAlign: 'left', padding: mobile ? '6px 8px' : '10px 12px', fontSize: '11px',
      color: muted, textTransform: 'uppercase', borderBottom: `2px solid ${hdrBorder}`, fontWeight: '400',
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis'
    },
    sortIcon: { fontSize: '10px', color: dark ? '#8A7A8A' : '#75757a' },
    filtroColAccion: {
      flex: 1, padding: '4px 6px', borderRadius: '6px', border: `1px solid ${hdrBorder}`,
      background: 'none', cursor: 'pointer', fontSize: '11px', color: muted,
      fontFamily: '"Montserrat", sans-serif',
    },
    filtroColChip: {
      display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 8px',
      borderRadius: '999px', border: `1px solid ${p}`, background: dark ? '#2E262E' : '#F4EFF4',
      fontSize: '11px', color: txt, fontFamily: '"Montserrat", sans-serif',
    },
    td: { padding: mobile ? '6px 8px' : '10px 12px', borderBottom: `1px solid ${tdBorder}`, verticalAlign: 'middle', color: txt, overflowWrap: 'break-word', wordBreak: 'break-word' },
    tr: { transition: 'background 0.1s' },
    trUnknown: { backgroundColor: dark ? '#201E10' : '#fffbf0' },
    detalle: { fontSize: '12px', color: muted, fontFamily: 'monospace' },
    editInput: { width: '100%', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${p}`, fontSize: '13px', outline: 'none', backgroundColor: dark ? '#1C1A1C' : 'white', color: txt },
    editSelect: { width: '100%', padding: '4px 28px 4px 8px', borderRadius: '6px', border: `1px solid ${p}`, fontSize: '13px', outline: 'none', backgroundColor: dark ? '#1C1A1C' : 'white', color: txt, appearance: 'none', WebkitAppearance: 'none', colorScheme: dark ? 'dark' : 'light' },
    editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: 0.6 },
    // Botones de acción de la fila expandida (Editar/Dividir/Borrar), mismo
    // lenguaje visual que el selector segmentado ARS/USD/EUR del simulador
    // de Ahorros: grupo de botones con borde redondeado, buen padding,
    // altura táctil cómoda (~44px) en vez de texto suelto con emojis.
    accionBtn: { flex: '1 1 100px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${border}`, backgroundColor: 'transparent', color: muted, cursor: 'pointer', fontSize: '13px', fontFamily: '"Montserrat", sans-serif', fontWeight: '500', outline: 'none', boxSizing: 'border-box' },
    accionBtnDanger: { border: `1px solid ${sem.negativo}`, color: sem.negativo },
    saveEditBtn: { padding: '3px 8px', backgroundColor: '#4a9e7a', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
    cancelEditBtn: { padding: '3px 8px', backgroundColor: dark ? '#3A333A' : '#e0e0e0', color: dark ? '#F0EDEC' : '#3a3a3c', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
    exportBtn: { padding: '7px 14px', backgroundColor: p, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif' },
    stmtHistory: { marginBottom: '24px' },
    stmtHistoryTitle: { fontSize: '13px', fontWeight: '500', color: muted, margin: '0 0 10px 0', ...rotuloLabel },
    stmtChips: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
    stmtChip: { display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: cardBg, borderRadius: '10px', padding: '8px 12px', border: `1px solid ${border}`, minWidth: '110px' },
    stmtChipPeriod: { fontSize: '13px', fontWeight: '500', color: txt },
    stmtChipDetail: { fontSize: '11px', color: muted },
  }
}