import React, { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { mesLabel, formatMonto, formatMontoFull, TotalesFooter, tcDeMovimiento, resolveCategoryIcon, resolveCategoryColor, InfoTooltip, useContainerWidth, columnasVisibles, smallCapsLabel } from './AccountDetail'

const getLast6Months = () => {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

export default function HijoDetail({ hijoNombre, hijoId, darkMode, tipoCambio, tcMap, tipoCambioEUR, tcMapEUR, refreshKey, initialPeriod, customIcons }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMeses, setSelectedMeses] = useState([])
  const [mesDropdownOpen, setMesDropdownOpen] = useState(false)
  const mesDropdownRef = useRef(null)
  // Mismo selector Donut/Barras (y misma clave de localStorage) que AccountDetail.js —
  // preferencia consistente en toda la app en vez de un chart fijo distinto por pantalla.
  const [chartType, setChartType] = useState(() => {
    const saved = localStorage.getItem('chart_type_ma')
    return saved === 'donut' || saved === 'bars' ? saved : 'donut'
  })
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [editingTx, setEditingTx] = useState(null)
  const [filaExpandida, setFilaExpandida] = useState(null)
  const [tablaRef, tablaWidth] = useContainerWidth()
  const colVisible = columnasVisibles(tablaWidth)
  const numColsTabla = 4 + (colVisible.subcategoria ? 1 : 0) + (colVisible.cuenta ? 1 : 0)
  const [editNombre, setEditNombre] = useState('')
  const [editCategoria, setEditCategoria] = useState('')
  const [editSubcategoria, setEditSubcategoria] = useState('')
  const [sortKey, setSortKey] = useState('fecha')
  const [sortDir, setSortDir] = useState('desc')
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)
  const isMobile = windowWidth < 768

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    setLoading(true)
    setTransactions([])
    setSelectedMeses([])
    setEditingTx(null)
    fetchTransactions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hijoId, hijoNombre, refreshKey])

  const fetchTransactions = async () => {
    const { data: { user } } = await supabase.auth.getUser()

    // Trae tanto lo asignado por child_id (modelo nuevo) como por tag (modelo viejo/actual),
    // ya que hoy las importaciones y ediciones solo escriben "tag".
    let txQuery = supabase.from('transactions')
      .select('*, categories(nombre, color), subcategories(nombre), accounts(nombre)')
      .eq('user_id', user.id)
      .gt('monto', 0)
      .order('fecha', { ascending: false })

    if (hijoId) {
      txQuery = txQuery.or(`child_id.eq.${hijoId},tag.ilike.${hijoNombre}`)
    } else {
      txQuery = txQuery.ilike('tag', hijoNombre)
    }

    // Gastos repartidos (ej. división en 3 de Comida/Casa): la fila completa le
    // pertenece a la cuenta, pero una parte de "reparto" es de este hijo — se
    // traen aparte y se les pisa el monto por la parte que le corresponde a él.
    const repartoQuery = supabase.from('transactions')
      .select('*, categories(nombre, color), subcategories(nombre), accounts(nombre)')
      .eq('user_id', user.id)
      .not('reparto', 'is', null)
      .gt('monto', 0)

    const [txRes, repartoRes, catRes] = await Promise.all([
      txQuery,
      repartoQuery,
      supabase.from('categories').select('*').or(`user_id.eq.${user.id},es_sistema.eq.true`).order('nombre'),
    ])
    const cats = catRes.data || []
    const catIds = cats.map(c => c.id)
    const subcatRes = catIds.length > 0
      ? await supabase.from('subcategories').select('*').in('category_id', catIds).order('nombre')
      : { data: [] }
    setCategories(cats)
    setSubcategories(subcatRes.data || [])
    const directTxs = txRes.data || []
    const repartidas = (repartoRes.data || [])
      .map(t => {
        const participante = t.reparto?.participantes?.find(p => (p.nombre || '').toLowerCase() === hijoNombre.toLowerCase())
        return participante ? { ...t, monto: Number(participante.monto) } : null
      })
      .filter(Boolean)
    const yaIncluidos = new Set(directTxs.map(t => t.id))
    const txs = [...directTxs, ...repartidas.filter(t => !yaIncluidos.has(t.id))]
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    setTransactions(txs)
    if (txs.length > 0) {
      const meses = [...new Set(txs.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()
      const validShared = (initialPeriod || []).filter(m => meses.includes(m))
      if (validShared.length > 0) {
        setSelectedMeses(validShared)
      } else {
        const now = new Date()
        const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        setSelectedMeses([meses.includes(mesActual) ? mesActual : meses[0]])
      }
    }
    setLoading(false)
  }

  const toggleMes = (m) =>
    setSelectedMeses(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])

  const tc = parseFloat(tipoCambio) || 1
  const tcEUR = parseFloat(tipoCambioEUR) || 0

  // Filtro por mes, totales, datos del bubble chart y evolución mensual — memoizados
  // como un todo porque monthlyData por sí solo filtra transactions 3 veces POR CADA
  // uno de los últimos 6 meses (18 barridos) y antes se recalculaba todo esto en cada
  // render, incluso uno ajeno (editar una fila, cambiar de orden). Ningún cálculo
  // interno se modificó.
  const { mesesDisponibles, filteredTx, totalARS, totalUSD, totalEUR, catData, monthlyData } = useMemo(() => {
    const mesesDisponibles = [...new Set(transactions.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()

    const filteredTx = selectedMeses.length > 0
      ? transactions.filter(t => selectedMeses.includes(t.fecha?.slice(0, 7)))
      : transactions

    const totalARS = filteredTx.filter(t => t.moneda === 'ARS').reduce((s, t) => s + t.monto, 0)
    const totalUSD = filteredTx.filter(t => t.moneda === 'USD').reduce((s, t) => s + t.monto, 0)
    const totalEUR = filteredTx.filter(t => t.moneda === 'EUR').reduce((s, t) => s + t.monto, 0)

    // Bubble chart data agrupado por categoría — USD convertido al TC del mes de
    // cada movimiento (según el tipo de dólar elegido), nunca el TC de hoy para
    // algo viejo.
    const catMap = {}
    filteredTx.forEach(t => {
      const cat = t.categories?.nombre || 'A Identificar'
      if (!catMap[cat]) catMap[cat] = { value: 0, originalARS: 0, originalUSD: 0, originalEUR: 0 }
      catMap[cat].value += t.moneda === 'USD' ? t.monto * (tcDeMovimiento(t, tcMap, tipoCambio) || tc) : t.moneda === 'EUR' ? t.monto * tcEUR : t.monto
      if (t.moneda === 'ARS') catMap[cat].originalARS += t.monto
      else if (t.moneda === 'EUR') catMap[cat].originalEUR += t.monto
      else catMap[cat].originalUSD += t.monto
    })
    const catData = Object.entries(catMap)
      .map(([name, val]) => ({ name, ...val }))
      .sort((a, b) => b.value - a.value)

    const getTCEURForMonth = (ym) => {
      const mesActual = new Date().toISOString().slice(0, 7)
      if (ym === mesActual) return tcEUR
      if (tcMapEUR?.[ym]) return Number(tcMapEUR[ym])
      return tcEUR
    }

    // Evolución mensual (últimos 6 meses) — USD convertido al TC del mes de cada
    // movimiento, nunca el TC de hoy para meses pasados.
    const last6 = getLast6Months()
    const monthlyData = last6.map(ym => {
      const txs = transactions.filter(t => t.fecha?.startsWith(ym))
      const ars = txs.filter(t => t.moneda === 'ARS').reduce((s, t) => s + t.monto, 0)
      const usd = txs.filter(t => t.moneda === 'USD').reduce((s, t) => s + t.monto * (tcDeMovimiento(t, tcMap, tipoCambio) || tc), 0)
      const eur = txs.filter(t => t.moneda === 'EUR').reduce((s, t) => s + t.monto, 0)
      return { mes: mesLabel(ym), total: Math.round(ars + usd + eur * getTCEURForMonth(ym)) }
    })

    return { mesesDisponibles, filteredTx, totalARS, totalUSD, totalEUR, catData, monthlyData }
  }, [transactions, selectedMeses, tcMap, tipoCambio, tc, tcEUR, tcMapEUR])

  const startEdit = (tx) => {
    setEditingTx(tx.id)
    setEditNombre(tx.nombre || tx.detalle || '')
    setEditCategoria(tx.categories?.nombre || 'A Identificar')
    setEditSubcategoria(tx.subcategories?.nombre || '')
  }

  const handleSaveEdit = async (tx) => {
    const catObj = categories.find(c => c.nombre === editCategoria)
    const subcatObj = subcategories.find(s => s.nombre === editSubcategoria && s.category_id === catObj?.id)
    const { error } = await supabase.from('transactions').update({
      nombre: editNombre,
      category_id: catObj?.id || null,
      subcategory_id: subcatObj?.id || null,
      estado: 'identificado',
    }).eq('id', tx.id)
    if (error) { window.alert('No se pudo guardar el cambio: ' + error.message + '\nProbá de nuevo.'); return }
    setTransactions(prev => prev.map(t => t.id === tx.id ? {
      ...t,
      nombre: editNombre,
      categories: catObj ? { nombre: catObj.nombre } : null,
      subcategories: subcatObj ? { nombre: subcatObj.nombre } : null,
      estado: 'identificado',
    } : t))
    setEditingTx(null)
  }

  const subcatsParaEditar = subcategories.filter(s => {
    const cat = categories.find(c => c.nombre === editCategoria)
    return cat && s.category_id === cat.id
  })

  // Mismo patrón reutilizable de ordenamiento clickeable que ya usan las tablas
  // de AccountDetail.js (handleSort/sortIcon/thSortable) — para aplicar después
  // en las demás listas de movimientos de la app (tarea 3).
  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'fecha' ? 'desc' : 'asc') }
  }
  const sortIcon = (key) => sortKey !== key ? ' ↕' : (sortDir === 'asc' ? ' ↑' : ' ↓')
  const sortedTx = useMemo(() => [...filteredTx].sort((a, b) => {
    let valA, valB
    if (sortKey === 'fecha') { valA = a.fecha || ''; valB = b.fecha || '' }
    else if (sortKey === 'descripcion') { valA = (a.nombre || a.detalle || '').toLowerCase(); valB = (b.nombre || b.detalle || '').toLowerCase() }
    else if (sortKey === 'categoria') { valA = (a.categories?.nombre || '').toLowerCase(); valB = (b.categories?.nombre || '').toLowerCase() }
    else { valA = Number(a.monto); valB = Number(b.monto) }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1
    if (valA > valB) return sortDir === 'asc' ? 1 : -1
    return 0
  }), [filteredTx, sortKey, sortDir])

  // Reporte por persona (D3 Parte 4): exporta exactamente lo que se ve en la
  // tabla de abajo — ya incluye tanto los gastos con child_id/tag directo como
  // la porción derivada de gastos repartidos, para el período elegido.
  const handleExportCSV = () => {
    const escapeCSV = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Fecha', 'Nombre', 'Categoría', 'Subcategoría', 'Cuenta', 'Monto', 'Moneda']
    const filas = sortedTx.map(t => [
      t.fecha || '',
      t.nombre || t.detalle || '',
      t.categories?.nombre || '',
      t.subcategories?.nombre || '',
      t.accounts?.nombre || '',
      t.monto,
      t.moneda || 'ARS',
    ])
    const csv = [header, ...filas].map(fila => fila.map(escapeCSV).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const periodo = selectedMeses.length === 1 ? selectedMeses[0] : selectedMeses.length === 0 ? 'todos' : `${selectedMeses.length}-meses`
    a.href = url
    a.download = `gastos-${hijoNombre}-${periodo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const s = getStyles(darkMode)

  if (loading) return (
    <p style={{ color: darkMode ? '#aaa' : '#888', fontSize: '14px', textAlign: 'center', marginTop: '48px' }}>
      Cargando gastos de {hijoNombre}...
    </p>
  )

  if (transactions.length === 0) return (
    <div style={{ textAlign: 'center', padding: '56px 0', color: darkMode ? '#aaa' : '#888' }}>
      <p style={{ fontSize: '40px', marginBottom: '12px' }}>👧</p>
      <p style={{ fontSize: '16px', fontWeight: '500', color: darkMode ? '#F0EDEC' : '#1d1d1f', margin: '0 0 6px' }}>
        Sin gastos registrados para {hijoNombre}
      </p>
      <p style={{ fontSize: '14px', margin: 0 }}>
        Los gastos con child_id de {hijoNombre} aparecerán acá.
      </p>
    </div>
  )

  return (
    <div>
      {/* Selector de meses */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <div ref={mesDropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMesDropdownOpen(o => !o)}
            style={{
              padding: '7px 14px', borderRadius: '20px', cursor: 'pointer', outline: 'none',
              border: `1.5px solid ${selectedMeses.length > 0 ? '#5C4F5C' : (darkMode ? '#3A333A' : '#EDE8EC')}`,
              backgroundColor: selectedMeses.length > 0 ? '#5C4F5C' : (darkMode ? '#2A272A' : 'white'),
              color: selectedMeses.length > 0 ? 'white' : (darkMode ? '#C0B8C0' : '#3a3a3c'),
              fontSize: '13px', fontFamily: '"Montserrat", sans-serif', display: 'flex', alignItems: 'center', gap: '6px'
            }}
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
                style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: darkMode ? '#8C7B8C' : '#5C4F5C', borderBottom: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontFamily: '"Montserrat", sans-serif' }}
              >
                {selectedMeses.length === mesesDisponibles.length ? '✕ Deseleccionar todos' : '✓ Seleccionar todos'}
              </button>
              {mesesDisponibles.map(m => (
                <button
                  key={m}
                  onClick={() => toggleMes(m)}
                  style={{ width: '100%', textAlign: 'left', padding: '7px 14px', background: selectedMeses.includes(m) ? (darkMode ? '#3A2F3A' : '#f3eef3') : 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: selectedMeses.includes(m) ? (darkMode ? '#8C7B8C' : '#5C4F5C') : (darkMode ? '#F0EDEC' : '#1d1d1f'), display: 'flex', alignItems: 'center', gap: '8px', fontFamily: '"Montserrat", sans-serif' }}
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

      {/* Totales */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        {sortedTx.length > 0 && (
          <button onClick={handleExportCSV} style={{ padding: '9px 16px', borderRadius: '10px', border: `1.5px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'none', color: darkMode ? '#F0EDEC' : '#5C4F5C', fontSize: '13px', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif', fontWeight: '500' }}>
            ⬇️ Exportar CSV
          </button>
        )}
        {totalARS > 0 && (
          <div style={s.statCard}>
            <p style={s.statLabel}>Total ARS</p>
            <p style={s.statValue}>$ {formatMonto(totalARS)}</p>
          </div>
        )}
        {totalUSD > 0 && (
          <div style={{ ...s.statCard, backgroundColor: darkMode ? '#1A2D3A' : '#E8F4F8', border: `1px solid ${darkMode ? '#2A3D4A' : '#B3D9E8'}` }}>
            <p style={{ ...s.statLabel, color: '#5588aa' }}>Total USD</p>
            <p style={{ ...s.statValue, color: '#5588aa' }}>U$S {formatMontoFull(totalUSD)}</p>
          </div>
        )}
        {totalEUR > 0 && (
          <div style={{ ...s.statCard, backgroundColor: darkMode ? '#1A2B1A' : '#E8F5E8', border: `1px solid ${darkMode ? '#2A3B2A' : '#B3D9B3'}` }}>
            <p style={{ ...s.statLabel, color: '#3a7d44' }}>Total EUR</p>
            <p style={{ ...s.statValue, color: '#3a7d44' }}>€ {formatMontoFull(totalEUR)}</p>
          </div>
        )}
        {totalARS > 0 && (totalUSD > 0 || totalEUR > 0) && (tc > 1 || tcEUR > 0) && (
          <div style={s.statCard}>
            <p style={s.statLabel}>Total equiv. en pesos</p>
            <p style={s.statValue}>$ {formatMonto(totalARS + totalUSD * tc + totalEUR * tcEUR)}</p>
          </div>
        )}
      </div>

      {/* Gastos por categoría: Donut/Barras, mismo dataset (catData) para las dos */}
      {catData.length > 0 && (() => {
        const periodoLabel = selectedMeses.length === 1 ? mesLabel(selectedMeses[0])
          : selectedMeses.length === mesesDisponibles.length ? 'todos los meses'
          : selectedMeses.length === 0 ? 'todos los meses'
          : `${selectedMeses.length} meses`
        const monedaLabel = (totalUSD > 0 || totalEUR > 0) ? 'ARS (monedas extranjeras convertidas)' : 'ARS'
        return (
        <div style={s.card}>
          <h3 style={{ ...s.cardTitle, display: 'flex', alignItems: 'center' }}>
            Gastos por categoría
            <InfoTooltip darkMode={darkMode} text={`${monedaLabel} · ${periodoLabel}`} />
          </h3>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73', marginRight: '2px' }}>Vista:</span>
            {[{ type: 'donut', label: '◎ Donut' }, { type: 'bars', label: '▤ Barras' }].map(opt => (
              <button key={opt.type}
                onClick={() => { setChartType(opt.type); localStorage.setItem('chart_type_ma', opt.type) }}
                style={{ padding: '4px 11px', borderRadius: '8px', border: `1px solid ${chartType === opt.type ? (darkMode ? '#8C7B8C' : '#5C4F5C') : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: chartType === opt.type ? (darkMode ? '#8C7B8C' : '#5C4F5C') : 'transparent', color: chartType === opt.type ? 'white' : (darkMode ? '#9A8A9A' : '#6e6e73'), cursor: 'pointer', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', transition: 'all 0.15s' }}>
                {opt.label}
              </button>
            ))}
          </div>
          {chartType === 'donut' && (
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: isMobile ? 'center' : 'flex-start' }}>
              <ResponsiveContainer width={isMobile ? '100%' : 260} height={isMobile ? 220 : 240}>
                <PieChart>
                  <Pie data={catData} cx="50%" cy="50%" innerRadius={isMobile ? 58 : 68} outerRadius={isMobile ? 90 : 108} dataKey="value" paddingAngle={2}>
                    {catData.map((entry, idx) => (
                      <Cell key={idx} fill={resolveCategoryColor(entry.name)} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, name) => [`$ ${formatMonto(v)}`, name]} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', paddingTop: isMobile ? '4px' : '20px', width: isMobile ? '100%' : 'auto', maxWidth: isMobile ? '100%' : '320px' }}>
                {catData.map((entry, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: resolveCategoryColor(entry.name), flexShrink: 0 }} />
                    <span title={entry.name} style={{ color: darkMode ? '#e0e0e0' : '#3a3a3c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>{resolveCategoryIcon(entry.name, { customIcons })} {entry.name}</span>
                    <span style={{ fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', whiteSpace: 'nowrap' }}>$ {formatMonto(entry.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {chartType === 'bars' && (() => {
            const rowH = 36
            const chartH = Math.max(180, catData.length * rowH + 24)
            return (
              <ResponsiveContainer width="100%" height={chartH}>
                <BarChart data={catData} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
                  <XAxis type="number" tickFormatter={v => `$${formatMonto(v)}`} tick={{ fontSize: 10, fill: darkMode ? '#9A8A9A' : '#6e6e73', fontFamily: '"Montserrat", sans-serif' }} />
                  <YAxis type="category" dataKey="name" width={isMobile ? 80 : 110} tick={{ fontSize: isMobile ? 10 : 12, fill: darkMode ? '#F0EDEC' : '#3a3a3c', fontFamily: '"Montserrat", sans-serif' }} />
                  <Tooltip formatter={(v) => [`$ ${formatMonto(v)}`, 'Total']} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {catData.map((entry, idx) => (
                      <Cell key={idx} fill={resolveCategoryColor(entry.name)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
          })()}
        </div>
        )
      })()}

      {/* Evolución mensual */}
      {monthlyData.some(m => m.total > 0) && (
        <div style={s.card}>
          <h3 style={{ ...s.cardTitle, display: 'flex', alignItems: 'center' }}>
            Evolución mensual de gastos
            <InfoTooltip darkMode={darkMode} text="ARS (monedas extranjeras convertidas) · últimos 6 meses" />
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: darkMode ? '#9A8A9A' : '#888' }} />
              <YAxis
                tickFormatter={v => `$${formatMonto(v)}`}
                tick={{ fontSize: 10, fill: darkMode ? '#9A8A9A' : '#888' }}
                width={72}
              />
              <Tooltip
                formatter={v => [`$ ${formatMonto(v)}`, 'Total ARS equiv.']}
                contentStyle={{
                  borderRadius: '8px', border: 'none',
                  backgroundColor: darkMode ? '#2A272A' : '#fff',
                  color: darkMode ? '#F0EDEC' : '#1d1d1f',
                  fontSize: '13px', fontFamily: '"Montserrat", sans-serif'
                }}
              />
              <Bar dataKey="total" fill="#A8B8D8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tabla de transacciones */}
      <div style={s.card}>
        <h3 style={s.cardTitle}>Transacciones ({filteredTx.length})</h3>
        {filteredTx.length === 0 ? (
          <p style={{ color: '#aaa', fontSize: '14px', margin: 0 }}>
            No hay gastos en el período seleccionado.
          </p>
        ) : (
          <div ref={tablaRef} style={{ width: '100%' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '58px' }} />
                <col />
                <col style={{ width: '112px' }} />
                {colVisible.subcategoria && <col style={{ width: '104px' }} />}
                {colVisible.cuenta && <col style={{ width: '96px' }} />}
                <col style={{ width: '96px' }} />
                <col style={{ width: '28px' }} />
              </colgroup>
              <thead>
                <tr>
                  {[
                    { h: 'Fecha', key: 'fecha' },
                    { h: 'Descripción', key: 'descripcion' },
                    { h: 'Categoría', key: 'categoria' },
                    ...(colVisible.subcategoria ? [{ h: 'Subcategoría' }] : []),
                    ...(colVisible.cuenta ? [{ h: 'Forma de pago' }] : []),
                    { h: 'Monto', key: 'monto' },
                    { h: '' },
                  ].map(({ h, key }, i) => (
                    <th key={h || `acciones-${i}`} onClick={key ? () => handleSort(key) : undefined} style={{
                      textAlign: 'left', padding: '8px 10px',
                      borderBottom: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`,
                      color: '#6e6e73', fontWeight: '400', fontSize: '11px',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      cursor: key ? 'pointer' : undefined, userSelect: key ? 'none' : undefined,
                      whiteSpace: 'nowrap'
                    }}>{h}{key && <span style={{ fontSize: '10px', color: darkMode ? '#5A4A5A' : '#bbb' }}>{sortIcon(key)}</span>}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTx.map((t, i) => {
                  const isEditing = editingTx === t.id
                  const expandido = filaExpandida === t.id
                  const ellipsisTd = { padding: '9px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                  if (isEditing) {
                    return (
                      <tr key={t.id || i} style={{ borderBottom: `1px solid ${darkMode ? '#3A333A' : '#f0f2f8'}` }}>
                        <td colSpan={numColsTabla} style={{ padding: '10px', backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '360px' }}>
                            <input value={editNombre} onChange={e => setEditNombre(e.target.value)} placeholder="Nombre" style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', boxSizing: 'border-box' }} />
                            <select value={editCategoria} onChange={e => { setEditCategoria(e.target.value); setEditSubcategoria('') }} style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', boxSizing: 'border-box' }}>
                              {categories.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                            </select>
                            <select value={editSubcategoria} onChange={e => setEditSubcategoria(e.target.value)} style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', boxSizing: 'border-box' }}>
                              <option value="">— Sin subcategoría</option>
                              {subcatsParaEditar.map(sc => <option key={sc.id} value={sc.nombre}>{sc.nombre}</option>)}
                            </select>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => handleSaveEdit(t)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: 'none', backgroundColor: '#5C4F5C', color: '#fff', cursor: 'pointer', fontSize: '12px', fontWeight: '600', fontFamily: '"Montserrat", sans-serif' }}>✓ Guardar</button>
                              <button onClick={() => setEditingTx(null)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'none', color: darkMode ? '#9A8A9A' : '#6e6e73', cursor: 'pointer', fontSize: '12px', fontFamily: '"Montserrat", sans-serif' }}>✕ Cancelar</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <React.Fragment key={t.id || i}>
                    <tr
                      style={{ borderBottom: `1px solid ${darkMode ? '#3A333A' : '#f0f2f8'}`, cursor: 'pointer' }}
                      onClick={() => setFilaExpandida(prev => prev === t.id ? null : t.id)}
                    >
                      <td style={{ padding: '9px 10px', color: '#6e6e73', whiteSpace: 'nowrap', fontSize: '12px' }}>{t.fecha}</td>
                      <td style={ellipsisTd}>
                        <span style={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{t.nombre || t.detalle || '—'}</span>
                      </td>
                      <td style={ellipsisTd}>
                        {t.categories?.nombre
                          ? <span style={{ backgroundColor: darkMode ? '#3A333A' : '#EDE8EC', color: '#5C4F5C', padding: '2px 8px', borderRadius: '10px', fontWeight: '500', fontSize: '12px' }}>{resolveCategoryIcon(t.categories.nombre, { customIcons })} {t.categories.nombre}</span>
                          : <span style={{ color: '#aaa' }}>—</span>
                        }
                      </td>
                      {colVisible.subcategoria && (
                        <td style={{ ...ellipsisTd, color: '#6e6e73', fontSize: '12px' }}>{t.subcategories?.nombre || '—'}</td>
                      )}
                      {colVisible.cuenta && (
                        <td style={{ ...ellipsisTd, color: '#6e6e73', fontSize: '12px' }}>{t.accounts?.nombre || '—'}</td>
                      )}
                      <td style={{ padding: '9px 10px', fontWeight: '600', whiteSpace: 'nowrap', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                        {t.moneda === 'USD'
                          ? <span style={{ color: '#5588aa' }}>U$S {formatMontoFull(t.monto)}</span>
                          : t.moneda === 'EUR'
                            ? <span style={{ color: '#3a7d44' }}>€ {formatMontoFull(t.monto)}</span>
                            : `$ ${formatMonto(t.monto)}`}
                      </td>
                      <td style={{ padding: '9px 4px', textAlign: 'center', color: darkMode ? '#6A5A6A' : '#bbb' }}>{expandido ? '▾' : '▸'}</td>
                    </tr>
                    {expandido && (
                      <tr style={{ borderBottom: `1px solid ${darkMode ? '#3A333A' : '#f0f2f8'}` }}>
                        <td colSpan={numColsTabla} style={{ padding: '10px', backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', marginBottom: '10px' }}>
                            <div>
                              <p style={{ margin: '0 0 2px', fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...smallCapsLabel, letterSpacing: '0.04em' }}>Subcategoría</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{t.subcategories?.nombre || '—'}</p>
                            </div>
                            <div>
                              <p style={{ margin: '0 0 2px', fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...smallCapsLabel, letterSpacing: '0.04em' }}>Forma de pago</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{t.accounts?.nombre || '—'}</p>
                            </div>
                            <div>
                              <p style={{ margin: '0 0 2px', fontSize: '10px', color: darkMode ? '#9A8A9A' : '#8e8e93', ...smallCapsLabel, letterSpacing: '0.04em' }}>Moneda</p>
                              <p style={{ margin: 0, fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{t.moneda || 'ARS'}</p>
                            </div>
                          </div>
                          <button onClick={() => startEdit(t)} style={{ padding: '6px 14px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'none', color: darkMode ? '#F0EDEC' : '#1d1d1f', cursor: 'pointer', fontSize: '12px', fontFamily: '"Montserrat", sans-serif' }}>✏️ Editar</button>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  )
                })}
              </tbody>
              <TotalesFooter txs={sortedTx} tcMap={tcMap} tipoCambio={tipoCambio} tcMapEUR={tcMapEUR} tipoCambioEUR={tipoCambioEUR} darkMode={darkMode} colSpan={numColsTabla} signed={false} />
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const getStyles = (dark) => ({
  card: {
    backgroundColor: dark ? '#2A272A' : 'white',
    borderRadius: '16px',
    padding: '20px 24px',
    border: `1px solid ${dark ? '#3A333A' : '#EDE8EC'}`,
    marginBottom: '20px',
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: '500',
    color: dark ? '#F0EDEC' : '#1d1d1f',
    margin: '0 0 16px 0',
    letterSpacing: '0.01em',
  },
  statCard: {
    padding: '14px 20px',
    borderRadius: '12px',
    backgroundColor: dark ? '#2A272A' : '#F0EDEC',
    border: `1px solid ${dark ? '#3A333A' : '#E2DDE0'}`,
    flex: 1,
    minWidth: '140px',
  },
  statLabel: {
    margin: 0,
    fontSize: '11px',
    color: '#6e6e73',
    letterSpacing: '0.06em',
    ...smallCapsLabel,
  },
  statValue: {
    margin: '4px 0 0',
    fontSize: '20px',
    fontWeight: '600',
    color: dark ? '#F0EDEC' : '#1d1d1f',
  },
})
