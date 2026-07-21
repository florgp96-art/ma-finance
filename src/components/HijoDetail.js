import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { BubbleChart, CATEGORY_CONFIG, mesLabel, formatMonto, formatMontoFull, TotalesFooter, tcDeMovimiento } from './AccountDetail'

const getLast6Months = () => {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

export default function HijoDetail({ hijoNombre, hijoId, darkMode, tipoCambio, tcMap, tipoCambioEUR, tcMapEUR, refreshKey, initialPeriod }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMeses, setSelectedMeses] = useState([])
  const [mesDropdownOpen, setMesDropdownOpen] = useState(false)
  const mesDropdownRef = useRef(null)
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [editingTx, setEditingTx] = useState(null)
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

    const [txRes, catRes] = await Promise.all([
      txQuery,
      supabase.from('categories').select('*').or(`user_id.eq.${user.id},es_sistema.eq.true`).order('nombre'),
    ])
    const cats = catRes.data || []
    const catIds = cats.map(c => c.id)
    const subcatRes = catIds.length > 0
      ? await supabase.from('subcategories').select('*').in('category_id', catIds).order('nombre')
      : { data: [] }
    setCategories(cats)
    setSubcategories(subcatRes.data || [])
    const txs = txRes.data || []
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

  const mesesDisponibles = [...new Set(transactions.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()

  const toggleMes = (m) =>
    setSelectedMeses(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])

  const filteredTx = selectedMeses.length > 0
    ? transactions.filter(t => selectedMeses.includes(t.fecha?.slice(0, 7)))
    : transactions

  const tc = parseFloat(tipoCambio) || 1
  const tcEUR = parseFloat(tipoCambioEUR) || 0

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
  const bubbleData = Object.entries(catMap)
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
  const sortedTx = [...filteredTx].sort((a, b) => {
    let valA, valB
    if (sortKey === 'fecha') { valA = a.fecha || ''; valB = b.fecha || '' }
    else if (sortKey === 'descripcion') { valA = (a.nombre || a.detalle || '').toLowerCase(); valB = (b.nombre || b.detalle || '').toLowerCase() }
    else if (sortKey === 'categoria') { valA = (a.categories?.nombre || '').toLowerCase(); valB = (b.categories?.nombre || '').toLowerCase() }
    else { valA = Number(a.monto); valB = Number(b.monto) }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1
    if (valA > valB) return sortDir === 'asc' ? 1 : -1
    return 0
  })

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
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
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

      {/* Bubble chart */}
      {bubbleData.length > 0 && (
        <div style={s.card}>
          <h3 style={s.cardTitle}>Gastos por categoría</h3>
          <BubbleChart data={bubbleData} darkMode={darkMode} />
        </div>
      )}

      {/* Evolución mensual */}
      {monthlyData.some(m => m.total > 0) && (
        <div style={s.card}>
          <h3 style={s.cardTitle}>Evolución mensual — últimos 6 meses</h3>
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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  {[
                    { h: 'Fecha', w: isMobile ? '14%' : '8%', key: 'fecha' },
                    { h: 'Descripción', w: isMobile ? '32%' : '24%', key: 'descripcion' },
                    { h: 'Categoría', w: isMobile ? '20%' : '14%', key: 'categoria' },
                    { h: 'Subcategoría', w: '13%', hideMobile: true },
                    { h: 'Forma de pago', w: '13%', hideMobile: true },
                    { h: 'Monto', w: isMobile ? '20%' : '16%', key: 'monto' },
                    { h: '', w: isMobile ? '14%' : '12%' },
                  ].map(({ h, w, hideMobile, key }) => (
                    <th key={h || 'acciones'} onClick={key ? () => handleSort(key) : undefined} style={{
                      textAlign: 'left', padding: '8px 10px', width: w,
                      display: hideMobile && isMobile ? 'none' : undefined,
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
                  return (
                    <tr key={t.id || i} style={{ borderBottom: `1px solid ${darkMode ? '#3A333A' : '#f0f2f8'}` }}>
                      <td style={{ padding: '9px 10px', color: '#6e6e73', whiteSpace: 'nowrap', fontSize: '12px' }}>{t.fecha}</td>
                      <td style={{ padding: '9px 10px', maxWidth: '200px' }}>
                        {isEditing
                          ? <input value={editNombre} onChange={e => setEditNombre(e.target.value)} style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', boxSizing: 'border-box' }} />
                          : <span style={{ color: darkMode ? '#F0EDEC' : '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{t.nombre || t.detalle || '—'}</span>
                        }
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        {isEditing
                          ? <select value={editCategoria} onChange={e => { setEditCategoria(e.target.value); setEditSubcategoria('') }} style={{ padding: '4px 8px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', appearance: 'none', WebkitAppearance: 'none', colorScheme: darkMode ? 'dark' : 'light' }}>
                              {categories.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                            </select>
                          : t.categories?.nombre
                            ? <span style={{ backgroundColor: darkMode ? '#3A333A' : '#EDE8EC', color: '#5C4F5C', padding: '2px 8px', borderRadius: '10px', fontWeight: '500', fontSize: '12px' }}>{CATEGORY_CONFIG[t.categories.nombre]?.icon} {t.categories.nombre}</span>
                            : <span style={{ color: '#aaa' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '9px 10px', color: '#6e6e73', fontSize: '12px', display: isMobile ? 'none' : undefined }}>
                        {isEditing
                          ? <select value={editSubcategoria} onChange={e => setEditSubcategoria(e.target.value)} style={{ padding: '4px 8px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', appearance: 'none', WebkitAppearance: 'none', colorScheme: darkMode ? 'dark' : 'light' }}>
                              <option value="">—</option>
                              {subcatsParaEditar.map(sc => <option key={sc.id} value={sc.nombre}>{sc.nombre}</option>)}
                            </select>
                          : t.subcategories?.nombre || '—'
                        }
                      </td>
                      <td style={{ padding: '9px 10px', color: '#6e6e73', fontSize: '12px', display: isMobile ? 'none' : undefined }}>
                        {t.accounts?.nombre || '—'}
                      </td>
                      <td style={{ padding: '9px 10px', fontWeight: '600', whiteSpace: 'nowrap', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                        {t.moneda === 'USD'
                          ? <span style={{ color: '#5588aa' }}>U$S {formatMontoFull(t.monto)}</span>
                          : `$ ${formatMonto(t.monto)}`}
                      </td>
                      <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                        {isEditing
                          ? <>
                              <button onClick={() => handleSaveEdit(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '2px 4px' }}>✅</button>
                              <button onClick={() => setEditingTx(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '2px 4px' }}>✕</button>
                            </>
                          : <button onClick={() => startEdit(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: 0.5, padding: '2px 4px' }}>✏️</button>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <TotalesFooter txs={sortedTx} tcMap={tcMap} tipoCambio={tipoCambio} darkMode={darkMode} colSpan={7} signed={false} />
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
    textTransform: 'uppercase',
  },
  statValue: {
    margin: '4px 0 0',
    fontSize: '20px',
    fontWeight: '600',
    color: dark ? '#F0EDEC' : '#1d1d1f',
  },
})
