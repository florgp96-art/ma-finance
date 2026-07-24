import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

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
  'Cuota Alimentaria Faustino':    { icon: '👦', color: 'hsl(39, 55%, 85%)' },
  'Cuota Alimentaria Matko':       { icon: '👦', color: 'hsl(64, 50%, 81%)' },
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

export const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(monto)

export const formatMontoFull = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)

export const formatFecha = (f) => f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : ''
export const formatFechaCorta = (f) => f ? f.slice(8, 10) + '/' + f.slice(5, 7) : ''

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
  const mesActual = new Date().toISOString().slice(0, 7)
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
  const mesActual = new Date().toISOString().slice(0, 7)
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
  const childDirecto = t.children?.nombre || t.tag || null
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
            {Math.round(usd * 100) !== 0 && <span style={{ color: '#5588aa' }}>U$S {formatMontoFull(usd)}</span>}
            {Math.round(eur * 100) !== 0 && <span style={{ color: '#3a7d44' }}>€ {formatMontoFull(eur)}</span>}
            {hayMultiples && <span style={{ color: darkMode ? '#9A8A9A' : '#8e8e93', fontWeight: '500' }}>≈ $ {formatMonto(unificado)} unificado</span>}
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
          border: `1px solid ${darkMode ? '#6A5A6A' : '#bbb'}`, background: 'none',
          color: darkMode ? '#9A8A9A' : '#8e8e93', fontSize: '10px', lineHeight: '13px',
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
  return d.toISOString().slice(0, 10)
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

// Cuántos días faltan (negativo = ya venció) para el vencimiento de un
// resumen. null si no tiene fecha de vencimiento (ej. "Ciclo actual").
export const diasRestantesDe = (s) => {
  if (!s.fecha_vencimiento) return null
  const fecha = new Date(s.fecha_vencimiento + 'T00:00:00')
  return Math.ceil((fecha - new Date()) / (1000 * 60 * 60 * 24))
}

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
      .sort((s1, s2) => cierreDe(s1).localeCompare(cierreDe(s2)))
    statementsPorCuenta.set(a.id, propios)
  })
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
    const pagosArs = (transactions || []).filter(t => t.account_id === s.account_id && !t.statement_id && t.moneda !== 'USD' && (t.tipo === 'neutro' || t.tipo === 'ingreso') && enVentana(t))
    const pagosUsd = (transactions || []).filter(t => t.account_id === s.account_id && !t.statement_id && t.moneda === 'USD' && (t.tipo === 'neutro' || t.tipo === 'ingreso') && enVentana(t))
    const totalPagosArs = pagosArs.reduce((sum, t) => sum + Number(t.monto), 0)
    const totalPagosUsd = pagosUsd.reduce((sum, t) => sum + Number(t.monto), 0)
    const pendienteArsSinClamp = (Number(s.total_resumen) || 0) - totalPagosArs
    const pendienteUsdSinClamp = totalUsdLinkedDe(s) - totalPagosUsd
    return {
      pendienteArs: Math.max(0, pendienteArsSinClamp),
      excedenteArs: Math.max(0, -pendienteArsSinClamp),
      pendienteUsd: Math.max(0, pendienteUsdSinClamp),
      excedenteUsd: Math.max(0, -pendienteUsdSinClamp),
      totalPagosArs, totalPagosUsd,
    }
  }
  const estadosStatement = new Map()
  cuentasCreditoAPagar.forEach(a => {
    const propios = statementsPorCuenta.get(a.id) || []
    propios.forEach((s, i) => {
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
  return { cuentasCreditoAPagar, cuentaCreditoIds, statementsPorCuenta, estadosStatement, statementsRealesConUsd }
}

export const mesLabel = (yearMonth) => {
  const [year, month] = yearMonth.split('-')
  return `${MESES[parseInt(month) - 1]} ${year}`
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

export default function AccountDetail({ account, accounts, allAccounts, refreshKey, searchQuery, onSearchChange, tipoCambio, tipoCambioEUR, tcMap, tcMapEUR, darkMode, onPeriodChange, onTransactionsLoaded, onStatementsLoaded, onAddIngreso, customIcons, onAccountsChanged, soloAPagar, userEmail }) {
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
  const FECHA_PX = 62, CUOTAS_PX = 54, MONTO_PX = 112, EXPAND_PX = 28
  const anchosTextoPral = repartirAnchoTexto(
    tablaWidth - FECHA_PX - MONTO_PX - EXPAND_PX - (colVisible.cuotas ? CUOTAS_PX : 0),
    colVisible, { nombre: 1.5, categoria: 1.4, cuenta: 0.8, subcategoria: 1.3 }
  )
  const anchosTextoNeutros = repartirAnchoTexto(
    tablaWidth - FECHA_PX - MONTO_PX - EXPAND_PX,
    colVisible, { nombre: 1.5, categoria: 1.4, subcategoria: 1.2, cuenta: 0.8 }
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
  const [editCategoria, setEditCategoria] = useState('')
  const [editSubcategoria, setEditSubcategoria] = useState('')
  const [editTag, setEditTag] = useState('')
  const [editCuenta, setEditCuenta] = useState('')
  const [children, setChildren] = useState([])
  const [sortKey, setSortKey] = useState('fecha')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedSplits, setExpandedSplits] = useState(new Set())
  const [selectedMeses, setSelectedMeses] = useState([])
const [equivEnUSD, setEquivEnUSD] = useState(false)
  const [showNeutros, setShowNeutros] = useState(false)
  const [filtroCuenta, setFiltroCuenta] = useState('')
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
  const [catGeneralSeleccionada, setCatGeneralSeleccionada] = useState(null)
  const [hijoGeneralSeleccionado, setHijoGeneralSeleccionado] = useState(null)
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
  const [bubbleGroupBy, setBubbleGroupBy] = useState('categoria')
  const mesDropdownRef = useRef(null)
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => { setFiltroCuenta('') }, [account, allAccounts])
  useEffect(() => { setVistaCuenta('movimientos') }, [account, allAccounts])

  useEffect(() => {
    if (allAccounts && accounts && accounts.length > 0) fetchAllData()
    else if (account) fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, accounts, allAccounts, refreshKey])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('children').select('id, nombre, icono').eq('user_id', user.id).order('nombre').then(({ data }) => setChildren(data || []))
    })
  }, [])

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
  const reconciliarSueltas = async (txs, stmts) => {
    const cierresPorCuenta = new Map()
    stmts.forEach(st => {
      const cierre = cierreDe(st)
      if (!cierre) return
      const list = cierresPorCuenta.get(st.account_id) || []
      list.push({ id: st.id, cierre })
      cierresPorCuenta.set(st.account_id, list)
    })
    cierresPorCuenta.forEach(list => list.sort((a, b) => a.cierre.localeCompare(b.cierre)))
    const ventanaDe = (accountId, cierre) => {
      const list = cierresPorCuenta.get(accountId) || []
      const idx = list.findIndex(c => c.cierre === cierre)
      return idx > 0 ? list[idx - 1].cierre : restarDiasISO(cierre, DIAS_CICLO_APROX)
    }

    // Una cuota se carga con una fecha estimada (mismo día que la compra original, mes
    // corrido según el número de cuota) que no necesariamente coincide con la fecha real
    // de facturación de ningún resumen puntual — por eso, igual que en perteneceCicloActual,
    // para cuotas se compara por mes exacto contra el mes de cierre del resumen, no por
    // fecha exacta ni por la ventana de días de los demás movimientos.
    const perteneceAlCierre = (t, cierre, desde) => {
      const fecha = normFecha(t.fecha)
      if ((t.cuotas_total || 1) > 1) return fecha.slice(0, 7) === cierre.slice(0, 7)
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
      const cierre = st && cierreDe(st)
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
        return q.order('fecha', { ascending: false })
      }),
      supabase.from('categories').select('*').or(`user_id.eq.${user.id},es_sistema.eq.true`).order('orden'),
      supabase.from('statements')
        .select('*')
        .eq('account_id', account.id)
        .order('fecha_hasta', { ascending: true }),
    ])
    const cats = catRes.data || []
    const catIds = cats.map(c => c.id)
    const subcatRes = catIds.length > 0
      ? await supabase.from('subcategories').select('*').in('category_id', catIds).order('nombre')
      : { data: [] }
    await reconciliarSueltas(txs, stmtRes.data || [])
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
          .order('fecha', { ascending: false })
      ),
      supabase.from('categories').select('*').or(`user_id.eq.${user.id},es_sistema.eq.true`).order('orden'),
      supabase.from('statements')
        .select('*')
        .in('account_id', accountIds)
        .order('fecha_hasta', { ascending: true }),
    ])
    const cats = catRes.data || []
    const catIds = cats.map(c => c.id)
    const subcatRes = catIds.length > 0
      ? await supabase.from('subcategories').select('*').in('category_id', catIds).order('nombre')
      : { data: [] }
    await reconciliarSueltas(txs, stmtRes.data || [])
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
    const mesActual = new Date().toISOString().slice(0, 7)
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
    const montoCorregido = tx.monto < 0 ? Math.abs(tx.monto) : undefined
    const cuentaObj = (accounts || []).find(a => a.id === editCuenta)
    const accountChange = editCuenta && editCuenta !== tx.account_id ? { account_id: editCuenta } : {}
    if (account?.tipo === 'ingreso' || tx.tipo === 'ingreso') {
      // El "tag" elegido acá tiene que ser siempre una subcategoría real de
      // "Ingresos" (ver subcategoriasDeIngreso) — se guarda category_id/subcategory_id
      // igual que hace el modal "Cargar movimiento", y se mantiene el tag en
      // paralelo (mismo nombre) porque otras pantallas siguen agrupando por tag.
      const ingresoSubcatObj = editTag
        ? subcategoriasDeIngreso(categories, subcategories).find(s => s.nombre === editTag)
        : null
      const catIngresos = categories.find(c => c.nombre === 'Ingresos' && (c.tipo || 'gasto') === 'ingreso')
      const upd = { nombre: editNombre, tag: editTag || null, estado: 'identificado', ...accountChange }
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
      setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, nombre: editNombre, tag: editTag || null, estado: 'identificado', ...accountChange, category_id: 'category_id' in upd ? upd.category_id : t.category_id, subcategory_id: 'subcategory_id' in upd ? upd.subcategory_id : t.subcategory_id, ...(cuentaObj ? { accounts: { nombre: cuentaObj.nombre } } : {}), ...(montoCorregido !== undefined ? { monto: montoCorregido } : {}) } : t))
      setEditingTx(null)
      return
    }
    const catObj = categories.find(c => c.nombre === editCategoria)
    const subcatObj = subcategories.find(s => s.nombre === editSubcategoria && s.category_id === catObj?.id)
    // Elegir la categoría "Ingresos" tiene que convertir la transacción en un ingreso
    // de verdad (tipo), no solo cambiarle el color de la etiqueta — si no, el monto
    // sigue mostrándose en negativo pese a decir "Ingresos".
    const pasaAIngreso = catObj?.nombre === 'Ingresos'

    // Actualizar la transacción — monto siempre positivo (el tipo determina el signo en pantalla)
    const { error: errUpd } = await supabase.from('transactions').update({
      nombre: editNombre,
      category_id: catObj ? catObj.id : tx.category_id,
      subcategory_id: subcatObj ? subcatObj.id : null,
      estado: 'identificado',
      tag: editTag || null,
      ...(pasaAIngreso ? { tipo: 'ingreso' } : {}),
      ...accountChange,
      ...(montoCorregido !== undefined ? { monto: montoCorregido } : {})
    }).eq('id', tx.id)
    if (errUpd) { window.alert('No se pudo guardar el cambio: ' + errUpd.message + '\nProbá de nuevo.'); return }

    // Guardar regla aprendida en user_rules si hay un detalle original
    const texto_original = (tx.detalle || '').trim()
    if (texto_original && catObj) {
      const { data: { user } } = await supabase.auth.getUser()
      // Upsert: si ya existe una regla para este patrón, la actualiza
      await supabase.from('user_rules').upsert({
        user_id: user.id,
        texto_original: texto_original,
        nombre_asignado: editNombre || texto_original,
        category_id: catObj.id,
        subcategory_id: subcatObj?.id || null,
        veces_confirmado: 1,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,texto_original',
        ignoreDuplicates: false
      })
    }

    setTransactions(prev => prev.map(t => t.id === tx.id ? {
      ...t,
      nombre: editNombre,
      tag: editTag || null,
      category_id: catObj?.id || t.category_id,
      subcategory_id: subcatObj?.id || null,
      estado: 'identificado',
      categories: catObj ? { nombre: catObj.nombre, color: catObj.color } : t.categories,
      subcategories: subcatObj ? { nombre: subcatObj.nombre } : null,
      ...(pasaAIngreso ? { tipo: 'ingreso' } : {}),
      ...accountChange,
      ...(cuentaObj ? { accounts: { nombre: cuentaObj.nombre } } : {}),
      ...(montoCorregido !== undefined ? { monto: montoCorregido } : {})
    } : t))
    setEditingTx(null)
  }

  const startEdit = (tx) => {
    setEditingTx(tx.id)
    setEditNombre(tx.nombre || tx.detalle)
    setEditCategoria(tx.categories?.nombre || 'A Identificar')
    setEditSubcategoria(tx.subcategories?.nombre || '')
    setEditCuenta(tx.account_id || '')
    const matchedChild = children.find(c => c.nombre.toLowerCase() === (tx.tag || '').toLowerCase())
    setEditTag(matchedChild ? matchedChild.nombre : (tx.tag || ''))
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

  const sortIcon = (key) => {
    if (sortKey !== key) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  const sortTx = useCallback((list) => {
    return [...list].sort((a, b) => {
      let valA, valB
      if (sortKey === 'fecha') { valA = a.fecha; valB = b.fecha }
      else if (sortKey === 'nombre') { valA = (a.nombre || a.detalle || '').toLowerCase(); valB = (b.nombre || b.detalle || '').toLowerCase() }
      else if (sortKey === 'categoria') { valA = (a.children?.nombre || a.tag || a.categories?.nombre || '').toLowerCase(); valB = (b.children?.nombre || b.tag || b.categories?.nombre || '').toLowerCase() }
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
  }, [sortKey, sortDir])

  // Vista de cuenta de ingresos: todas las txs son tipo ingreso
  const esVistaIngresos = !allAccounts && account?.tipo === 'ingreso'

  const barData = statements.map(s => ({
    mes: s.periodo || s.fecha_hasta?.slice(0, 7),
    total: Number(s.total_resumen) || 0
  }))

  const mesTxs = useMemo(() => selectedMeses.length > 0
    ? transactions.filter(t => selectedMeses.some(m => t.fecha?.startsWith(m)) && t.tipo !== 'neutro')
    : []
  , [transactions, selectedMeses])

  const getTC = (mes) => {
    const mesActual = new Date().toISOString().slice(0, 7)
    if (mes === mesActual) return parseFloat(tipoCambio) || 1
    if (mes && tcMap && tcMap[mes]) return Number(tcMap[mes])
    return parseFloat(tipoCambio) || 1
  }

  // TC efectivo para el período seleccionado (usa el del primer mes seleccionado)
  const tcEfectivo = getTC(selectedMeses[0] || new Date().toISOString().slice(0, 7))
  const getTCEUR = useCallback((mes) => {
    const mesActual = new Date().toISOString().slice(0, 7)
    if (!mes || mes === mesActual) return parseFloat(tipoCambioEUR) || 0
    if (tcMapEUR?.[mes]) return Number(tcMapEUR[mes])
    return parseFloat(tipoCambioEUR) || 0
  }, [tipoCambioEUR, tcMapEUR])
  const tcEUR = getTCEUR(selectedMeses[0] || new Date().toISOString().slice(0, 7))

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
    return Object.keys(byMonth).sort().map(m => ({ mes: mesLabel(m), total: byMonth[m] }))
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
          const monto = t.moneda === 'USD' ? Number(t.monto) * (tcDeMovimiento(t, tcMap, tipoCambio) || parseFloat(tcEfectivo) || 0) : t.moneda === 'EUR' ? Number(t.monto) * tcEUR : Number(t.monto)
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
  // cómo se dibuja el mismo dato. Incluye a los hijos como entradas propias (aparte de
  // "categoría") cuando se agrupa por categoría; agrupado por persona, es una entrada
  // por persona (incluyendo "Personal" = lo no atribuido a ningún hijo).
  const displayChartData = esVistaIngresos
    ? ingresoBubbleData
    : bubbleGroupBy === 'persona'
      ? personaBubbleData
      : categoriaBubbleData
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
  // ingreso, según la vista y el agrupamiento activos) — una sola función para Donut y
  // Barras, así el color de cada entrada es siempre el mismo sin importar cuál de las
  // dos vistas esté eligiendo el usuario.
  const getChartIcon = (name) => {
    if (esVistaIngresos) return resolveIconIngreso(name)
    if (bubbleGroupBy === 'persona' && name === 'Personal') return customIcons?.['Personal'] || '👤'
    return resolveIcon(name)
  }
  const getChartColor = (name) => esVistaIngresos ? resolveColorIngreso(name) : resolveColor(name)
  const effectiveChartType = chartType

  // "Categorías Top": mismas porciones que el donut/barras (categoriaBubbleData),
  // sin las entradas de hijos — así nunca puede dar un número distinto al del
  // donut para la misma categoría.
  const catTopList = categoriaBubbleData
    .filter(e => e.tipo === 'categoria')
    .slice(0, 3)
    .map(e => [e.name, e.value])

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
      ingresosBarData, displayChartData, childNames,
      resolveIcon, resolveColor, getChartIcon, getChartColor,
      catTopList,
      totalARS, totalUSD, totalEUR, totalIngresosARS, totalIngresosUSD, totalIngresosEUR, hayIngresos,
      mesAnterior, diffPct, diffMonto, diffIngPct, diffIngMonto, effectiveChartType,
    }
  }, [transactions, mesTxs, tcMap, tipoCambio, tcEfectivo, tcEUR, tcMapEUR, tipoCambioEUR, esVistaIngresos, allAccounts, children, customIcons, selectedMeses, mesesDisponibles, bubbleGroupBy, chartType, getTCEUR])

  const {
    ingresosBarData, displayChartData, childNames,
    resolveIcon, resolveColor, getChartIcon, getChartColor,
    catTopList,
    totalARS, totalUSD, totalEUR, totalIngresosARS, totalIngresosUSD, totalIngresosEUR, hayIngresos,
    mesAnterior, diffPct, diffMonto, diffIngPct, diffIngMonto, effectiveChartType,
  } = chartsMemo

  const matchSearch = useCallback((t) => {
    if (!searchQuery) return true
    const q = norm(searchQuery)
    return (
      norm(t.nombre).includes(q) ||
      (!t.nombre && norm(t.detalle).includes(q)) ||
      // Sin categoría asignada cuenta como "A Identificar": el gráfico las
      // agrupa bajo esa etiqueta y el buscador tiene que encontrarlas igual
      norm(t.categories?.nombre || (t.tipo !== 'ingreso' ? 'A Identificar' : '')).includes(q) ||
      norm(t.subcategories?.nombre).includes(q) ||
      norm(t.children?.nombre).includes(q) ||
      norm(t.tag).includes(q) ||
      norm(t.tipo).includes(q) ||
      norm(t.moneda).includes(q) ||
      (t.fecha || '').includes(q) ||
      norm(formatFecha(t.fecha)).includes(q) ||
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
  const identificadas = sortTx(txNoNeutras.filter(t => t.estado !== 'a_identificar' && t.categories?.nombre !== 'A Identificar' && matchSearch(t)))

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

    return { txFiltradas, txNeutras, sinIdentificar, identificadas, filasTabla }
  }, [transactions, selectedMeses, filtroCuenta, matchSearch, sortTx, editingTx, expandedSplits])

  const { txFiltradas, txNeutras, sinIdentificar, identificadas, filasTabla } = tablaMemo

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
    const reparto = !esIngresoTx ? desglosarReparto(tx) : null
    const expandido = filaExpandida === tx.id
    const detailLabel = { fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }
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
            {(tx.children?.nombre || tx.tag) && !esIngresoTx && (
              <span style={{ fontSize: '11px', color: '#8C7B8C', marginLeft: '6px' }}>👧 {tx.children?.nombre || tx.tag}</span>
            )}
            {reparto && (
              <span style={{ fontSize: '11px', color: '#5C8AA8', marginLeft: '6px' }}>🔀</span>
            )}
          </td>
          {colVisible.categoria && (
            <td style={ellipsisCell}>
              {esIngresoTx ? (
                <span title={tx.tag || ''} style={{ backgroundColor: darkMode ? '#3A2F4A' : '#EDE8F4', color: darkMode ? '#C8B4E8' : '#5C4F5C', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500' }}>
                  {tx.tag || '—'}
                </span>
              ) : (
                <span title={tx.categories?.nombre || ''} style={{ backgroundColor: (resolveColor(tx.categories?.nombre) || '#E0E0E0'), color: '#3a3a3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500' }}>
                  {resolveIcon(tx.categories?.nombre || '')} {tx.categories?.nombre || '—'}
                </span>
              )}
            </td>
          )}
          {colVisible.cuenta && (
            <td style={ellipsisCell}><span style={{fontSize:'12px', color:'#888'}}>{tx.accounts?.nombre || '—'}</span></td>
          )}
          {colVisible.subcategoria && (
            <td style={ellipsisCell}><span style={{fontSize:'12px', color:'#888'}}>{esIngresoTx ? '' : (tx.subcategories?.nombre || '—')}</span></td>
          )}
          {colVisible.cuotas && (
            <td style={{ ...styles.td, whiteSpace: 'nowrap', wordBreak: 'normal' }}>{esIngresoTx ? '—' : (tx.cuotas_total > 1 ? `${tx.cuota_numero}/${tx.cuotas_total}` : '—')}</td>
          )}
          <td style={{...styles.td, textAlign:'right', fontWeight:'600', whiteSpace: 'nowrap', wordBreak: 'normal',
            color: darkMode ? '#F0EDEC' : '#2d2d2d'}}
            title={tcTooltipDe(tx, tcMap, tipoCambio)}>
            {tx.tipo === 'ingreso' ? '+' : '-'}{monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
          </td>
          <td style={{ ...styles.td, textAlign: 'center', width: '28px', padding: '10px 4px', color: darkMode ? '#6A5A6A' : '#bbb' }}>{expandido ? '▾' : '▸'}</td>
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
                    <p style={detailValue}>{tx.tag || '—'}</p>
                  </div>
                )}
                {!esIngresoTx && (
                  <div>
                    <p style={detailLabel}>Subcategoría</p>
                    <p style={detailValue}>{tx.subcategories?.nombre || '—'}</p>
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
          <td style={ellipsisCell}><span style={{fontSize:'12px', color:'#888'}}>{repTx.accounts?.nombre || '—'}</span></td>
        )}
        {colVisible.subcategoria && (
          <td style={ellipsisCell}><span style={{fontSize:'12px', color:'#888'}}>{repTx.subcategories?.nombre || '—'}</span></td>
        )}
        {colVisible.cuotas && (
          <td style={{ ...styles.td, whiteSpace: 'nowrap', wordBreak: 'normal' }}>{repTx.cuotas_total > 1 ? `${repTx.cuota_numero}/${repTx.cuotas_total}` : '—'}</td>
        )}
        <td style={{...styles.td, textAlign:'right', fontWeight:'600', whiteSpace: 'nowrap', wordBreak: 'normal',
          color: darkMode ? '#F0EDEC' : '#2d2d2d'}}>
          -{monedaSymbol(repTx.moneda)} {formatMontoFull(grupo.total)}
        </td>
        <td style={{ ...styles.td, textAlign: 'center', width: '28px', padding: '10px 4px', color: darkMode ? '#6A5A6A' : '#bbb' }}>▸</td>
      </tr>
    )
  }

  const handleExportCSV = () => {
    const q = (val) => {
      const s = String(val ?? '')
      return `"${s.replace(/"/g, '""')}"`
    }
    const txParaExportar = txFiltradas.filter(matchSearch)
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

  const handleDeleteTx = async (tx) => {
    if (!window.confirm(account?.tipo === 'ingreso' ? '¿Eliminar este ingreso?' : '¿Eliminar este gasto?')) return
    await supabase.from('transactions').delete().eq('id', tx.id)
    setTransactions(prev => prev.filter(t => t.id !== tx.id))
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
    const esIngresoTx = esVistaIngresos || tx.tipo === 'ingreso'
    const selStyle = { ...styles.editSelect, width: '100%', boxSizing: 'border-box' }
    return (
      <td colSpan={colSpan} style={{ ...styles.td, backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '6px 2px' }}>
          <span style={{ fontSize: '12px', color: '#8e8e93' }}>
            {formatFecha(tx.fecha)} · {tx.tipo === 'ingreso' ? '+' : '-'}{monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
          </span>
          <input style={{ ...styles.editInput, width: '100%', boxSizing: 'border-box' }} value={editNombre}
            onChange={e => setEditNombre(e.target.value)} placeholder="Nombre" />
          <select style={selStyle} value={editCuenta} onChange={e => setEditCuenta(e.target.value)}>
            {(accounts || []).filter(a => tx.tipo === 'ingreso' || a.tipo !== 'ingreso').map(a => (
              <option key={a.id} value={a.id}>💳 {a.nombre}</option>
            ))}
          </select>
          {esIngresoTx ? (() => {
            const { allOpts, valueIsCustom } = getIngresoTagOpts()
            return (
              <select style={selStyle} value={valueIsCustom ? '__custom__' : (editTag || '')}
                onChange={e => { if (e.target.value !== '__custom__') setEditTag(e.target.value) }}>
                <option value="">— Sin categoría —</option>
                {allOpts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                {valueIsCustom && <option value="__custom__">{editTag}</option>}
              </select>
            )
          })() : (
            <>
              <select style={selStyle} value={editCategoria}
                onChange={e => { setEditCategoria(e.target.value); setEditSubcategoria('') }}>
                {categories.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
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

  const isMobile = windowWidth < 768
  const styles = getStyles(darkMode, isMobile)
  const ellipsisCell = { ...styles.td, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', wordBreak: 'normal' }

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
  const hoyISO = new Date().toISOString().slice(0, 10)
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
  const { cuentasCreditoAPagar, statementsPorCuenta, estadosStatement, statementsRealesConUsd } = mostrarTabAPagar
    ? calcularStatementsPendientes({ accounts: allAccounts ? accounts : (account?.tipo === 'credito' ? [account] : []), statements, transactions })
    : { cuentasCreditoAPagar: [], statementsPorCuenta: new Map(), estadosStatement: new Map(), statementsRealesConUsd: [] }
  // Resúmenes reales que van a tener su propia tarjeta (ver statementsRealesConUsd
  // más abajo). Si un movimiento importado por PDF quedó con statement_id pero ese
  // resumen no llega a mostrarse solo (ej. ya está saldado), el movimiento no puede
  // quedar invisible: se cuenta igual dentro de "Ciclo actual" en vez de desaparecer.
  const statementIdsConTarjetaPropia = new Set(statementsRealesConUsd.map(s => s.id))
  // Si es una cuota, la fecha es una estimación (mismo día que la compra original, mes
  // corrido según el número de cuota) que no necesariamente cae del mismo lado del corte
  // real de la tarjeta — por eso para cuotas se compara por mes exacto contra el mes del
  // corte (ni el mes anterior ni el siguiente), en vez de por fecha exacta. El resto de los
  // movimientos sí tiene fecha real, así que se compara exacto. "Ciclo actual" solo
  // cuenta COMPRAS nuevas (nunca pagos/reintegros: esos ya se atribuyeron a saldar el
  // statement anterior en calcularEstadoStatement, y no vuelven a contarse acá).
  const perteneceCicloActual = (t, ultimoCierre, mesCorte) => {
    if (t.tipo === 'neutro' || t.tipo === 'ingreso') return false
    const fecha = normFecha(t.fecha)
    if ((t.cuotas_total || 1) > 1) {
      const mesTx = fecha.slice(0, 7)
      return mesTx === (mesCorte || mesActual)
    }
    return (!ultimoCierre || fecha > ultimoCierre) && fecha <= hoyISO
  }
  // Movimientos ya cargados (ej. por Excel) que todavía no pertenecen a ningún resumen
  // cerrado: se muestran como un "ciclo actual" para ver cuánto se debe antes de que
  // llegue el PDF del banco. Solo cuentan los posteriores al último resumen ya cerrado
  // de esa cuenta — si no, cualquier carga vieja por Excel (que nunca tiene statement_id)
  // se sumaría como si fuera de este mes.
  const statementsSinResumen = cuentasCreditoAPagar.map(a => {
    const propios = statementsPorCuenta.get(a.id) || []
    const ultimoReal = propios.length > 0 ? propios[propios.length - 1] : null
    const ultimoCierreAuto = ultimoReal ? cierreDe(ultimoReal) : null
    const cicloDesdeManual = cicloDesdeOverride[a.id] !== undefined ? cicloDesdeOverride[a.id] : (a.ciclo_actual_desde || null)
    // Se usa el corte más reciente entre el detectado (último resumen cargado) y el
    // manual (por si el auto no aplica, ej. cuenta que carga casi todo por Excel).
    const ultimoCierre = [ultimoCierreAuto, cicloDesdeManual].filter(Boolean).sort().pop() || null
    const mesCorte = ultimoCierre ? ultimoCierre.slice(0, 7) : null
    const compras = transactions.filter(t =>
      (!t.statement_id || !statementIdsConTarjetaPropia.has(t.statement_id)) &&
      t.account_id === a.id && perteneceCicloActual(t, ultimoCierre, mesCorte)
    )
    // Excedente informativo del último resumen real, si quedó pagado de más: no se
    // arrastra ni se resta de nada, solo se muestra como nota en "Ciclo actual".
    const estadoUltimo = ultimoReal ? estadosStatement.get(ultimoReal.id) : null
    const excedenteArs = estadoUltimo?.excedenteArs || 0
    const excedenteUsd = estadoUltimo?.excedenteUsd || 0
    if (compras.length === 0 && !cicloDesdeManual && excedenteArs === 0 && excedenteUsd === 0) return null
    const total = compras.filter(t => t.moneda !== 'USD').reduce((sum, t) => sum + Number(t.monto), 0)
    const totalUsd = compras.filter(t => t.moneda === 'USD').reduce((sum, t) => sum + Number(t.monto), 0)
    return {
      id: `sin-resumen-${a.id}`, account_id: a.id, periodo: null, fecha_vencimiento: null, fecha_hasta: null,
      total_resumen: total, total_usd: totalUsd, _virtual: true,
      cicloDesde: cicloDesdeManual, cicloDesdeEfectivo: ultimoCierre, mesCorte,
      _excedenteArs: excedenteArs, _excedenteUsd: excedenteUsd,
    }
  }).filter(Boolean)
  // statementsRealesConUsd (total pendiente ya neteado de pagos, USD incluido) sale
  // directo de calcularStatementsPendientes, arriba — ver ese comentario para el
  // detalle de cómo se calcula el total en pesos/USD y los pagos posteriores.
  // Jerarquía por urgencia: vencidas primero (de la más vieja a la más
  // reciente), después las que todavía no vencieron por fecha de
  // vencimiento ascendente, y por último las que ni siquiera tienen fecha
  // (el "ciclo actual" en curso, que no es urgente todavía).
  const statementsAPagar = mostrarTabAPagar
    ? [...statementsSinResumen, ...statementsRealesConUsd]
        .sort((a, b) => {
          const diasA = diasRestantesDe(a), diasB = diasRestantesDe(b)
          const grupoDe = (d) => d === null ? 2 : d < 0 ? 0 : 1
          const grupoA = grupoDe(diasA), grupoB = grupoDe(diasB)
          if (grupoA !== grupoB) return grupoA - grupoB
          if (grupoA === 2) return 0
          return a.fecha_vencimiento.localeCompare(b.fecha_vencimiento)
        })
    : []
  // "Te falta pagar" es únicamente lo YA facturado (resúmenes reales, con
  // vencimiento real) — un resumen abierto ("Ciclo actual") todavía no venció, no es
  // deuda exigible este mes: se muestra aparte, en "Próximos vencimientos", y no suma acá.
  const statementsFacturados = statementsAPagar.filter(s => !s._virtual)
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
      ? ((!t.statement_id || !statementIdsConTarjetaPropia.has(t.statement_id)) && t.account_id === s.account_id && perteneceCicloActual(t, s.cicloDesdeEfectivo, s.mesCorte))
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
      .reduce((s2, t) => s2 + Number(t.monto), 0)
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
    const esAlquilerOExpensas = t.categories?.nombre === 'Casa' && ['Alquiler', 'Expensas'].includes(t.subcategories?.nombre)
    return accTipo === 'debito' || esAlquilerOExpensas
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
              destinoHijo[cat][hijo] = (destinoHijo[cat][hijo] || 0) + Number(t.monto)
            } else {
              const destino = esUsd ? mapUsd : map
              destino[cat] = (destino[cat] || 0) + Number(t.monto)
            }
          })
        })
        gastosFijosDelMes.forEach(t => {
          const cat = t.categories?.nombre || 'A Identificar'
          const hijo = getChildName(t)
          if (hijo) {
            if (!hijoMap[cat]) hijoMap[cat] = {}
            hijoMap[cat][hijo] = (hijoMap[cat][hijo] || 0) + Number(t.monto)
          } else {
            map[cat] = (map[cat] || 0) + Number(t.monto)
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
            const destino = t.moneda === 'USD' ? mapUsd : map
            destino[subcat] = (destino[subcat] || 0) + Number(t.monto)
          })
        })
        gastosFijosDelMes.forEach(t => {
          if (getChildName(t)) return
          const cat = t.categories?.nombre || 'A Identificar'
          if (cat !== catGeneralSeleccionada) return
          const subcat = t.subcategories?.nombre || 'Sin subcategoría'
          map[subcat] = (map[subcat] || 0) + Number(t.monto)
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

    return {
      totalAPagarGeneral, totalAPagarGeneralUsd, totalBrutoBarra, montoPagadoBarra, pctPagadoBarra,
      statementsFacturados, statementsSinResumen, totalProximoResumenArs, totalProximoResumenUsd,
      ingresosPorCategoriaMes, categoriasResumenGeneral, categoriasResumenGeneralUsd,
      subcatsCatGeneral, subcatsCatGeneralUsd, categoriasBrutoSubtotalArs,
      hijosTotalesGeneral, hijosTotalesGeneralUsd, catsPorHijoGeneral, catsPorHijoGeneralUsd,
      statementsVencidas, statementsNoVencidas,
      itemsPorStatement, categoriasResumen,
    }
  }, [transactions, statements, accounts, allAccounts, account, soloAPagar, mostrarTabAPagar, cicloDesdeOverride, hoyISO, mesActual, tcMap, tipoCambio, tcEfectivo, tcMapEUR, tipoCambioEUR, apagarSortKey, apagarSortDir, catGeneralSeleccionada, hijoGeneralSeleccionado, getChildName])

  const {
    totalAPagarGeneral, totalAPagarGeneralUsd, totalBrutoBarra, montoPagadoBarra, pctPagadoBarra,
    statementsFacturados, statementsSinResumen, totalProximoResumenArs, totalProximoResumenUsd,
    ingresosPorCategoriaMes, categoriasResumenGeneral, categoriasResumenGeneralUsd,
    subcatsCatGeneral, subcatsCatGeneralUsd, categoriasBrutoSubtotalArs,
    hijosTotalesGeneral, hijosTotalesGeneralUsd, catsPorHijoGeneral, catsPorHijoGeneralUsd,
    statementsVencidas, statementsNoVencidas,
    itemsPorStatement, categoriasResumen,
  } = apagarMemo

  const handleApagarSort = (key) => {
    if (apagarSortKey === key) setApagarSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setApagarSortKey(key); setApagarSortDir(key === 'monto' ? 'desc' : 'asc') }
  }
  const apagarSortIcon = (key) => apagarSortKey !== key ? ' ↕' : (apagarSortDir === 'asc' ? ' ↑' : ' ↓')
  const mostrarMovimientos = !soloAPagar && (vistaCuenta === 'movimientos' || !mostrarTabAPagar)
  const vistaApagarActiva = soloAPagar || vistaCuenta === 'apagar'

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
            <p style={{ margin: 0, fontWeight: '500', fontSize: '15px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tarjetaExpandida ? '▾' : '▸'} {nombreCuenta ? `💳 ${nombreCuenta} · ` : ''}{s._virtual ? 'Resumen abierto' : (s.periodo || mesLabel(s.fecha_hasta?.slice(0, 7) || ''))}</p>
            {s._virtual && (
              <>
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#4a9e7a' }}>Todavía no facturado · se incluye en el próximo resumen</p>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6e6e73', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Contando desde
                  <input type="date" value={s.cicloDesde || (s.cicloDesdeEfectivo ? restarDiasISO(s.cicloDesdeEfectivo, -1) : '')} onClick={e => e.stopPropagation()} onChange={e => guardarCicloDesde(s.account_id, e.target.value)}
                    style={{ fontSize: '12px', padding: '2px 6px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, backgroundColor: darkMode ? '#1C1A1C' : 'white', color: darkMode ? '#F0EDEC' : '#1d1d1f', colorScheme: darkMode ? 'dark' : 'light' }} />
                  {!s.cicloDesde && '(auto)'}
                </p>
              </>
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
            {s.total_usd !== 0 && (
              <p style={{ margin: '4px 0 0', fontWeight: '600', fontSize: '13px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
                U$S {formatMontoFull(s.total_usd)}
              </p>
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
              <p style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: '600', color: '#4a9e7a' }}>
                {s._virtual ? 'Sobrepago del resumen anterior' : 'A favor'}: $ {formatMonto(s._excedenteArs)}{!s._virtual ? ' (según resumen)' : ''}
              </p>
            )}
            {s._excedenteUsd > 0 && (
              <p style={{ margin: '2px 0 0', fontSize: '12px', fontWeight: '600', color: '#4a9e7a' }}>
                {s._virtual ? 'Sobrepago del resumen anterior' : 'A favor'}: U$S {formatMontoFull(s._excedenteUsd)}{!s._virtual ? ' (según resumen)' : ''}
              </p>
            )}
            {diasRestantes !== null && (
              <p
                title={`Vence: ${s.fecha_vencimiento}`}
                style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: '500', color: diasRestantes <= 3 ? '#e74c3c' : diasRestantes <= 7 ? '#e07b39' : '#4a9e7a', cursor: 'default' }}>
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
                      <span style={{ fontSize: '12px', color: '#888' }}>{tx.subcategories?.nombre || '—'}</span>
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
              <p style={{ margin: '10px 0 0', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#8e8e93' }}>
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
                  const label = `${nombreCuenta ? `💳 ${nombreCuenta} · ` : ''}${s.periodo || mesLabel(s.fecha_hasta?.slice(0, 7) || '')}`
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
                        <div style={{ fontSize: '11px', color: '#4a9e7a' }}>
                          Sobrepago del resumen anterior{s._excedenteArs > 0 ? `: $ ${formatMonto(s._excedenteArs)}` : ''}{s._excedenteUsd > 0 ? ` ${s._excedenteArs > 0 ? '+ ' : ': '}U$S ${formatMontoFull(s._excedenteUsd)}` : ''}
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
              <p style={{ margin: '0 0 4px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>🕐 Próximos vencimientos</p>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#8e8e93' }}>Todavía no facturado — se incluye en el próximo resumen de cada tarjeta. No suma a "Te falta pagar".</p>
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
              <p style={{ margin: '0 0 4px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>Ingresos de este mes</p>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#8e8e93' }}>Informativo — no resta de "Te falta pagar".</p>
              <div style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                {ingresosPorCategoriaMes.map(c => (
                  <div key={c.nombre} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', gap: '10px' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.nombre}>
                      {resolveCategoryIcon(c.nombre, { customIcons, isIncome: true })} {c.nombre}
                    </span>
                    <span style={{ fontWeight: '600', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {c.ars > 0 ? `$ ${formatMonto(c.ars)}` : ''}
                      {c.ars > 0 && c.usd > 0 ? ' + ' : ''}
                      {c.usd > 0 ? `U$S ${formatMonto(c.usd)} ($ ${formatMonto(c.unificado - c.ars)})` : ''}
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
          {/* Categorías: composición del gasto del mes, siempre en bruto —
              no cambia con cada pago parcial. */}
          {(categoriasResumenGeneral.length > 0 || categoriasResumenGeneralUsd.length > 0) && (
            <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '14px', backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
              <p style={{ margin: '0 0 10px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>Gastos del mes por categoría</p>
              {categoriasResumenGeneral.map(([cat, total]) => total > 0 && (
                <React.Fragment key={cat}>
                  <div
                    onClick={() => setCatGeneralSeleccionada(c => c === cat ? null : cat)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, cursor: 'pointer' }}>
                    <span style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f', display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      <span style={{ opacity: 0.6, fontSize: '11px' }}>{catGeneralSeleccionada === cat ? '▾' : '▸'}</span>
                      {resolveIcon(cat)} {cat}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', whiteSpace: 'nowrap' }}>$ {formatMonto(total)}</span>
                  </div>
                  {catGeneralSeleccionada === cat && subcatsCatGeneral.length > 0 && (
                    <div style={{ padding: '6px 0 8px 20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {subcatsCatGeneral.map(([subcat, montoSub]) => (
                        <div key={subcat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
                          <span>{subcat}</span>
                          <span>$ {formatMonto(montoSub)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', marginTop: '4px', fontWeight: '700', fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                <span>Subtotal</span>
                <span>$ {formatMonto(categoriasBrutoSubtotalArs)}</span>
              </div>
              {categoriasResumenGeneralUsd.length > 0 && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px dashed ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
                  <p style={{ margin: '0 0 6px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>💵 En USD</p>
                  {categoriasResumenGeneralUsd.map(([cat, total]) => total > 0 && (
                    <React.Fragment key={`usd-${cat}`}>
                      <div
                        onClick={() => setCatGeneralSeleccionada(c => c === cat ? null : cat)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', cursor: 'pointer' }}>
                        <span style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ opacity: 0.6, fontSize: '11px' }}>{catGeneralSeleccionada === cat ? '▾' : '▸'}</span>
                          {resolveIcon(cat)} {cat}
                        </span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>U$S {formatMontoFull(total)}</span>
                      </div>
                      {catGeneralSeleccionada === cat && subcatsCatGeneralUsd.length > 0 && (
                        <div style={{ padding: '4px 0 6px 20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {subcatsCatGeneralUsd.map(([subcat, montoSub]) => (
                            <div key={subcat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
                              <span>{subcat}</span>
                              <span>U$S {formatMontoFull(montoSub)}</span>
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
          {/* Hijos: composición del gasto del mes por hijo, siempre en
              bruto — cada fila despliega su propio detalle por categoría,
              mismo patrón que "Gastos del mes por categoría" de arriba (antes
              llevaba directo a la solapa del hijo, inconsistente con esa). */}
          {(hijosTotalesGeneral.length > 0 || hijosTotalesGeneralUsd.length > 0) && (
            <div style={{ marginBottom: '20px', padding: '16px', borderRadius: '14px', backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
              <p style={{ margin: '0 0 10px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>Gasto del mes por hijo</p>
              {hijosTotalesGeneral.map(([hijo, total]) => (
                <React.Fragment key={hijo}>
                  <div
                    onClick={() => setHijoGeneralSeleccionado(h => h === hijo ? null : hijo)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, cursor: 'pointer' }}>
                    <span style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ opacity: 0.6, fontSize: '11px' }}>{hijoGeneralSeleccionado === hijo ? '▾' : '▸'}</span>
                      {customIcons?.[hijo] || '👧'} {hijo}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>$ {formatMonto(total)}</span>
                  </div>
                  {hijoGeneralSeleccionado === hijo && catsPorHijoGeneral.length > 0 && (
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
              {hijosTotalesGeneralUsd.length > 0 && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px dashed ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
                  <p style={{ margin: '0 0 6px', fontSize: '10px', fontWeight: '700', color: darkMode ? '#9A8A9A' : '#6e6e73', ...rotuloLabel }}>💵 En USD</p>
                  {hijosTotalesGeneralUsd.map(([hijo, total]) => (
                    <React.Fragment key={`usd-${hijo}`}>
                      <div
                        onClick={() => setHijoGeneralSeleccionado(h => h === hijo ? null : hijo)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', cursor: 'pointer' }}>
                        <span style={{ fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ opacity: 0.6, fontSize: '11px' }}>{hijoGeneralSeleccionado === hijo ? '▾' : '▸'}</span>
                          {customIcons?.[hijo] || '👧'} {hijo}
                        </span>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>U$S {formatMontoFull(total)}</span>
                      </div>
                      {hijoGeneralSeleccionado === hijo && catsPorHijoGeneralUsd.length > 0 && (
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
            <p style={{ color: '#aaa', fontSize: '14px' }}>No hay resúmenes con vencimiento próximo{allAccounts ? '' : ' para esta cuenta'}.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {statementsVencidas.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: '700', color: '#c0392b', ...rotuloLabel }}>
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
            style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: stmtCollapsed ? 0 : '10px' }}>
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
                    : `${selectedMeses.length} meses ▾`}
            </button>
            {mesDropdownOpen && (
              <div
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
          <div style={styles.summaryCards}>

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
                <p style={{ fontSize: '10px', color: '#8e8e93', margin: '4px 0 0' }}>USD convertido al TC de cada movimiento</p>
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
                  {(() => { const b = totalIngresosARS - totalARS; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? '#3a7d44' : '#c0392b' }}>{b >= 0 ? '+' : ''}$ {formatMonto(b)}</p> })()}
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
                  {(() => { const b = totalIngresosUSD - totalUSD; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? '#3a7d44' : '#c0392b' }}>{b >= 0 ? '+' : ''}U$S {formatMontoFull(Math.abs(b))}</p> })()}
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
                  {(() => { const b = totalIngresosEUR - totalEUR; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? '#3a7d44' : '#c0392b' }}>{b >= 0 ? '+' : ''}€ {formatMontoFull(Math.abs(b))}</p> })()}
                </>}
              </div>
            )}

            {/* vs mes anterior */}
            {(diffPct !== null || diffIngPct !== null) && mesAnterior && selectedMeses.length === 1 && !esVistaIngresos && (
              <div style={styles.summaryCard}>
                <p style={{ ...styles.summaryLabel, marginBottom: '6px' }}>vs {mesLabel(mesAnterior)}</p>
                {diffPct !== null && <>
                  <p style={{ ...styles.summaryLabel, marginBottom: '2px', opacity: 0.7 }}>Gastos</p>
                  <p style={{...styles.summaryValue, color: diffPct > 0 ? '#c0392b' : '#2e8b6a', fontSize: '20px', marginBottom: '2px'}}>
                    {diffPct > 0 ? '↑' : '↓'} {Math.abs(diffPct)}%
                  </p>
                  <p style={{...styles.summarySubval, marginBottom: diffIngPct !== null ? '8px' : 0}}>{diffMonto > 0 ? '+' : ''}$ {formatMonto(Math.abs(diffMonto))}</p>
                </>}
                {diffIngPct !== null && <>
                  {diffPct !== null && <div style={{ borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, margin: '4px 0 6px' }} />}
                  <p style={{ ...styles.summaryLabel, marginBottom: '2px', opacity: 0.7 }}>Ingresos</p>
                  <p style={{...styles.summaryValue, color: diffIngPct > 0 ? '#2e8b6a' : '#c0392b', fontSize: '20px', marginBottom: '2px'}}>
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
                    {(() => { const b = ingresosEquivUSD - egresosEquivUSD; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? '#3a7d44' : '#c0392b' }}>{b >= 0 ? '+' : ''}U$S {formatMonto(Math.abs(b))}</p> })()}
                  </>}
                </> : <>
                  <p style={styles.summaryLabel}>Egresos</p>
                  <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>$ {formatMonto(egresosEquivARS)}</p>
                  {hayIngresos && ingresosEquivARS > 0 && <>{divider}
                    <p style={styles.summaryLabel}>Ingresos</p>
                    <p style={{ ...styles.summaryValue, fontSize: isMobile ? '14px' : '18px' }}>$ {formatMonto(ingresosEquivARS)}</p>
                    {divider}
                    <p style={styles.summaryLabel}>Balance</p>
                    {(() => { const b = ingresosEquivARS - egresosEquivARS; return <p style={{ ...styles.summaryValue, fontSize: isMobile ? '16px' : '22px', color: b >= 0 ? '#3a7d44' : '#c0392b' }}>{b >= 0 ? '+' : ''}$ {formatMonto(Math.abs(b))}</p> })()}
                  </>}
                </>}
              </div>
            )}

          </div>
        )
      })()}

      {esVistaIngresos && ingresosBarData.length > 0 && (
        <div style={styles.chartSection}>
          <h3 style={{ ...styles.chartTitle, display: 'flex', alignItems: 'center' }}>
            📊 Ingresos por mes
            <InfoTooltip darkMode={darkMode} text="Histórico completo. Moneda: ARS — los ingresos en USD/€ están convertidos a pesos al TC de cada movimiento." />
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
      {!esVistaIngresos && barData.length > 0 && !allAccounts && (
        <div style={styles.chartSection}>
          <h3 style={{ ...styles.chartTitle, display: 'flex', alignItems: 'center' }}>
            📊 Total facturado por resumen
            <InfoTooltip darkMode={darkMode} text="Histórico completo. Moneda: ARS." />
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#6e6e73' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6e6e73' }} tickFormatter={v => `$${formatMonto(v)}`} width={80} />
              <Tooltip formatter={(v) => [`$${formatMontoFull(v)}`, 'Total']} />
              <Bar dataKey="total" fill={BAR_COLOR} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {esVistaIngresos && mesesDisponibles.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>💰</p>
          <p style={{ fontSize: '16px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', marginBottom: '8px' }}>Todavía no hay ingresos registrados</p>
          <p style={{ fontSize: '13px', color: '#8e8e93', marginBottom: '24px' }}>Registrá tu primer ingreso para ver los gráficos y totales</p>
        </div>
      )}

      {mesesDisponibles.length > 0 && (
        <div style={styles.chartSection}>
          {selectedMeses.length === 0 && (
            <p style={{color:'#aaa', fontSize:'14px', marginTop:'16px'}}>Seleccioná al menos un mes.</p>
          )}

          {displayChartData.length > 0 && (() => {
            const periodoLabelChart = selectedMeses.length === 1 ? mesLabel(selectedMeses[0])
              : selectedMeses.length === mesesDisponibles.length ? 'todos los meses'
              : `${selectedMeses.length} meses`
            const monedaLabelChart = esVistaIngresos && (totalIngresosUSD > 0 || totalIngresosEUR > 0) ? 'ARS (monedas extranjeras convertidas)'
              : !esVistaIngresos && (totalUSD > 0 || totalEUR > 0) ? 'ARS (monedas extranjeras convertidas)'
              : 'ARS'
            return (
            <div style={styles.bubbleSection}>
              <h3 style={{ ...styles.chartTitle, fontSize: '14px', margin: '0 0 10px', display: 'flex', alignItems: 'center' }}>
                {esVistaIngresos ? 'Ingresos por categoría' : bubbleGroupBy === 'persona' ? 'Gastos por persona' : 'Gastos por categoría'}
                <InfoTooltip darkMode={darkMode} text={`${monedaLabelChart} · ${periodoLabelChart}`} />
              </h3>
              {/* Selector de tipo de gráfico — solo Donut y Barras, mismo dataset
                  (displayChartData) para las dos: togglear entre ellas nunca cambia
                  qué se ve, solo cómo se dibuja. */}
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

              {!esVistaIngresos && childNames.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
                  <span style={{ fontSize: '11px', color: darkMode ? '#9A8A9A' : '#8e8e93', alignSelf: 'center', marginRight: '2px' }}>Agrupar:</span>
                  {[{ key: 'categoria', label: 'Categoría' }, { key: 'persona', label: 'Persona' }].map(({ key, label }) => (
                    <button key={key} onClick={() => setBubbleGroupBy(key)} style={{ padding: '4px 12px', borderRadius: '20px', border: `1px solid ${bubbleGroupBy === key ? '#5C4F5C' : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: bubbleGroupBy === key ? '#5C4F5C' : 'transparent', color: bubbleGroupBy === key ? '#fff' : (darkMode ? '#9A8A9A' : '#6e6e73'), fontSize: '11px', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif', fontWeight: bubbleGroupBy === key ? '600' : '400', outline: 'none' }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {/* Donut */}
              {effectiveChartType === 'donut' && (
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: isMobile ? 'center' : 'flex-start' }}>
                  <ResponsiveContainer width={isMobile ? '100%' : 260} height={isMobile ? 220 : 240}>
                    <PieChart>
                      <Pie data={displayChartData} cx="50%" cy="50%" innerRadius={isMobile ? 58 : 68} outerRadius={isMobile ? 90 : 108} dataKey="value" paddingAngle={2}>
                        {displayChartData.map((entry, idx) => (
                          <Cell key={idx} fill={getChartColor(entry.name)} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v, name) => [`$ ${formatMonto(v)}`, name]} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', paddingTop: isMobile ? '4px' : '20px', width: isMobile ? '100%' : 'auto', maxWidth: isMobile ? '100%' : '320px' }}>
                    {displayChartData.map((entry, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                        <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: getChartColor(entry.name), flexShrink: 0 }} />
                        <span title={`${getChartIcon(entry.name)} ${entry.name}`} style={{ color: darkMode ? '#e0e0e0' : '#3a3a3c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>{getChartIcon(entry.name)} {entry.name}</span>
                        <span style={{ fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', whiteSpace: 'nowrap' }}>$ {formatMonto(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Barras horizontales */}
              {effectiveChartType === 'bars' && (() => {
                const rowH = 36
                const chartH = Math.max(180, displayChartData.length * rowH + 24)
                return (
                  <ResponsiveContainer width="100%" height={chartH}>
                    <BarChart data={displayChartData} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
                      <XAxis type="number" tickFormatter={v => `$${formatMonto(v)}`} tick={{ fontSize: 10, fill: darkMode ? '#9A8A9A' : '#6e6e73', fontFamily: '"Montserrat", sans-serif' }} />
                      <YAxis type="category" dataKey="name" width={isMobile ? 80 : 110} tick={{ fontSize: isMobile ? 10 : 12, fill: darkMode ? '#F0EDEC' : '#3a3a3c', fontFamily: '"Montserrat", sans-serif' }} />
                      <Tooltip formatter={(v) => [`$ ${formatMonto(v)}`, 'Total']} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {displayChartData.map((entry, idx) => (
                          <Cell key={idx} fill={getChartColor(entry.name)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )
              })()}
            </div>
            )
          })()}
          {selectedMeses.length > 0 && displayChartData.length === 0 && !esVistaIngresos && (
            <p style={{color:'#8e8e93', fontSize:'14px', marginTop:'16px'}}>Sin gastos en los meses seleccionados.</p>
          )}
          {selectedMeses.length > 0 && displayChartData.length === 0 && esVistaIngresos && (
            <p style={{color:'#8e8e93', fontSize:'14px', marginTop:'16px'}}>Sin ingresos en el mes seleccionado.</p>
          )}
        </div>
      )}


      {/* Buscador */}
      <div style={{ marginBottom: '24px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input
          style={{
            flex: '1 1 260px', padding: '10px 14px', borderRadius: '12px',
            border: '1.5px solid #e0e0e0', fontSize: '14px', outline: 'none',
            boxSizing: 'border-box', backgroundColor: '#fafafa', color: '#1d1d1f'
          }}
          placeholder="🔍 Buscar por nombre, categoría, fecha, monto..."
          value={searchQuery || ''}
          onChange={e => onSearchChange && onSearchChange(e.target.value)}
        />
        {(allAccounts || esVistaIngresos) && (
          <select
            style={{
              flex: '0 1 200px', padding: '10px 14px', borderRadius: '12px',
              border: '1.5px solid #e0e0e0', fontSize: '14px', outline: 'none',
              boxSizing: 'border-box', backgroundColor: '#fafafa', color: '#1d1d1f'
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
                          <span style={{fontSize:'12px', color:'#888'}}>{tx.accounts?.nombre || '—'}</span>
                        </td>
                      )}
                      <td style={ellipsisCell} title={tx.nombre || ''}><span style={{color:'#aaa'}}>{tx.nombre || '—'}</span></td>
                      {colVisible.categoria && <td style={ellipsisCell}><span style={{color:'#aaa'}}>—</span></td>}
                      <td style={{...styles.td, textAlign:'right', fontWeight:'600', whiteSpace: 'nowrap', wordBreak: 'normal'}}>
                        {monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'center', width: '28px', padding: '10px 4px', color: darkMode ? '#6A5A6A' : '#bbb' }}>{expandido ? '▾' : '▸'}</td>
                    </tr>
                    {expandido && (
                      <tr style={styles.tr}>
                        <td colSpan={numColsSinId} style={{ ...styles.td, backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', padding: '2px 2px 10px' }}>
                            <div style={{ flexBasis: '100%' }}>
                              <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }}>Nombre</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.nombre || '—'}</p>
                            </div>
                            <div>
                              <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }}>Detalle original</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.detalle || '—'}</p>
                            </div>
                            <div>
                              <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }}>Cuenta</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.accounts?.nombre || '—'}</p>
                            </div>
                            <div>
                              <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }}>Moneda</p>
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
              {thSortable('Nombre', 'nombre')}
              {colVisible.categoria && thSortable('Categoría', 'categoria')}
              {colVisible.cuenta && thSortable('Cuenta', 'cuenta')}
              {colVisible.subcategoria && thSortable('Subcategoría', 'subcategoria')}
              {colVisible.cuotas && thSortable('Cuotas', 'cuotas')}
              {thSortable('Monto', 'monto', false, undefined, 'right')}
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {filasTabla.map(fila => fila.tipo === 'single' ? renderTxRow(fila.tx) : renderFilaGrupo(fila.grupo, fila.expandido))}
          </tbody>
          <TotalesFooter txs={identificadas} tcMap={tcMap} tipoCambio={tipoCambio} tcMapEUR={tcMapEUR} tipoCambioEUR={tipoCambioEUR} darkMode={darkMode} colSpan={numColsTabla} />
        </table>
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
                            <td style={ellipsisCell}><span style={{fontSize:'12px', color:'#888'}}>{tx.categories?.nombre || '—'}</span></td>
                          )}
                          {colVisible.subcategoria && (
                            <td style={ellipsisCell}><span style={{fontSize:'12px', color:'#888'}}>{tx.subcategories?.nombre || '—'}</span></td>
                          )}
                          {colVisible.cuenta && (
                            <td style={ellipsisCell}><span style={{fontSize:'12px', color:'#888'}}>{tx.accounts?.nombre || '—'}</span></td>
                          )}
                          <td style={{...styles.td, textAlign:'right', whiteSpace: 'nowrap', wordBreak: 'normal', color: darkMode ? '#6A5A6A' : '#9e9e9e'}} title={tcTooltipDe(tx, tcMap, tipoCambio)}>
                            {monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center', width: '28px', padding: '10px 4px', color: darkMode ? '#6A5A6A' : '#bbb' }}>{expandido ? '▾' : '▸'}</td>
                        </tr>
                        {expandido && (
                          <tr style={styles.tr}>
                            <td colSpan={numColsNeutros} style={{ ...styles.td, backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', padding: '2px 2px 10px' }}>
                                <div style={{ flexBasis: '100%' }}>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }}>Nombre</p>
                                  <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.nombre || tx.detalle || '—'}</p>
                                </div>
                                <div>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }}>Categoría</p>
                                  <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.categories?.nombre || '—'}</p>
                                </div>
                                <div>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }}>Subcategoría</p>
                                  <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.subcategories?.nombre || '—'}</p>
                                </div>
                                <div>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }}>Cuenta</p>
                                  <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{tx.accounts?.nombre || '—'}</p>
                                </div>
                                <div>
                                  <p style={{ fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...rotuloLabel, margin: '0 0 2px' }}>Moneda</p>
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
            <p style={{ fontSize: '13px', color: '#8e8e93', margin: '0 0 16px' }}>{repartoModalTx.nombre || repartoModalTx.detalle} · {monedaSymbol(repartoModalTx.moneda)} {formatMontoFull(repartoModalTx.monto)}</p>
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
                <span style={{ fontSize: '12px', color: '#aaa', alignSelf: 'center' }}>Cargá hijos/as en Configuración para poder repartir con ellos.</span>
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
                    <span style={{ fontSize: '13px', color: '#6e6e73' }}>%</span>
                  </div>
                ))}
                <p style={{ margin: '2px 0 0', fontSize: '12px', fontWeight: '600', color: sumaModalRepartoValida ? '#3a7d44' : '#c0392b' }}>
                  Suma: {Math.round(sumaPorcentajesModalReparto * 100) / 100}% {sumaModalRepartoValida ? '✓' : '(tiene que dar 100%)'}
                </p>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', marginTop: '20px', flexWrap: 'wrap' }}>
              <div>
                {desglosarReparto(repartoModalTx) && (
                  <button type="button" onClick={quitarReparto} style={{ padding: '10px 14px', borderRadius: '10px', border: '1.5px solid #c0392b', color: '#c0392b', background: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: '"Montserrat", sans-serif' }}>
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
    </div>
  )
}

const getStyles = (dark, mobile) => {
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
    summaryCards: { display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(180px, 1fr))', gap: mobile ? '10px' : '16px', marginBottom: '24px' },
    summaryCard: { backgroundColor: panel, borderRadius: '14px', padding: mobile ? '12px 14px' : '18px 20px', boxShadow: shadow, border: `1px solid ${hdrBorder}`, minWidth: 0 },
    summaryLabel: { fontSize: mobile ? '10px' : '11px', fontWeight: '400', color: muted, margin: '0 0 4px 0', ...rotuloLabel },
    summaryValue: { fontSize: mobile ? '16px' : '24px', fontWeight: '500', color: txt, margin: '0 0 2px 0', wordBreak: 'break-word' },
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
    bubbleSection: { marginBottom: '32px' },
    tableSection: { marginBottom: '32px' },
    tableHint: { fontSize: '13px', color: muted, margin: '-8px 0 12px 0' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: mobile ? '12px' : '13px', tableLayout: 'fixed' },
    th: {
      textAlign: 'left', padding: mobile ? '6px 8px' : '10px 12px', fontSize: '11px',
      color: muted, textTransform: 'uppercase', borderBottom: `2px solid ${hdrBorder}`, fontWeight: '400'
    },
    thSortable: {
      textAlign: 'left', padding: mobile ? '6px 8px' : '10px 12px', fontSize: '11px',
      color: muted, textTransform: 'uppercase', borderBottom: `2px solid ${hdrBorder}`, fontWeight: '400',
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap'
    },
    sortIcon: { fontSize: '10px', color: dark ? '#5A4A5A' : '#bbb' },
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
    accionBtnDanger: { border: '1px solid #c0392b', color: '#c0392b' },
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