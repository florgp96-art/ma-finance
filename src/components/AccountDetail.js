import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const CATEGORY_CONFIG = {
  'Comida':          { icon: '🍔', color: '#FADADD' }, // rosa palo
  'Personal':        { icon: '👤', color: '#B5CCEE' }, // azul pastel
  'Transporte':      { icon: '🚗', color: '#C3B8E8' }, // lavanda
  'Salud':           { icon: '💊', color: '#FFCBA4' }, // durazno
  'Entretenimiento': { icon: '🎬', color: '#FFB3BA' }, // rosa chicle suave
  'Suscripciones':   { icon: '📱', color: '#B5EAD7' }, // menta
  'Ropa':            { icon: '👕', color: '#E8C3D8' }, // lila rosado
  'Casa':            { icon: '🏠', color: '#AEC6CF' }, // celeste grisáceo
  'Educación':       { icon: '📚', color: '#C5E8C3' }, // verde pastel
  'Trabajo':         { icon: '💼', color: '#D4E8C2' }, // verde lima pastel
  'Ingresos':        { icon: '💰', color: '#B5EAC8' }, // verde menta
  'Débitos':         { icon: '🏦', color: '#D8D8F0' }, // lila muy suave
  'A Identificar':   { icon: '❓', color: '#F9E4B7' }, // amarillo manteca
}

const BAR_COLOR = '#A8B8D8'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(monto)

const formatMontoFull = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)

const monedaSymbol = (moneda) => moneda === 'USD' ? 'U$S' : '$'

const mesLabel = (yearMonth) => {
  const [year, month] = yearMonth.split('-')
  return `${MESES[parseInt(month) - 1]} ${year}`
}

// Bubble chart component usando D3-style force simulation simple
function BubbleChart({ data, moneda }) {
  const containerRef = useRef(null)
  const [bubbles, setBubbles] = useState([])
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, data: null })
  const WIDTH = 600
  const HEIGHT = 340
  const MIN_R = 32
  const MAX_R = 90

  useEffect(() => {
    if (!data || data.length === 0) return
    const total = data.reduce((s, d) => s + d.value, 0)
    const maxVal = Math.max(...data.map(d => d.value))
    const minVal = Math.min(...data.map(d => d.value))

    // Calcular radios
    const withR = data.map(d => {
      const ratio = maxVal === minVal ? 0.7 : 0.3 + 0.7 * (d.value / maxVal)
      const r = Math.max(MIN_R, Math.min(MAX_R, ratio * MAX_R))
      return { ...d, r, pct: Math.round((d.value / total) * 100) }
    })

    // Posición inicial en grilla
    const cols = Math.ceil(Math.sqrt(withR.length))
    const positioned = withR.map((b, i) => ({
      ...b,
      x: (WIDTH / (cols + 1)) * ((i % cols) + 1),
      y: (HEIGHT / (Math.ceil(withR.length / cols) + 1)) * (Math.floor(i / cols) + 1),
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
    }))

    // Mini force simulation
    const simulate = (currentNodes) => currentNodes.map((a, i) => {
      let fx = 0, fy = 0
      currentNodes.forEach((b, j) => {
        if (i === j) return
        const dx = a.x - b.x
        const dy = a.y - b.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const minDist = a.r + b.r + 6
        if (dist < minDist) {
          const force = (minDist - dist) / dist * 0.3
          fx += dx * force
          fy += dy * force
        }
      })
      fx += (WIDTH / 2 - a.x) * 0.012
      fy += (HEIGHT / 2 - a.y) * 0.012
      return {
        ...a,
        x: Math.max(a.r + 4, Math.min(WIDTH - a.r - 4, a.x + fx)),
        y: Math.max(a.r + 4, Math.min(HEIGHT - a.r - 4, a.y + fy)),
      }
    })
    let nodes = positioned
    for (let iter = 0; iter < 200; iter++) {
      nodes = simulate(nodes)
    }
    setBubbles(nodes)
  }, [data])

  if (!data || data.length === 0) return null

  return (
    <div ref={containerRef} style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', width: '100%' }}>
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <svg width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: 'block' }}>
          {bubbles.map((b, i) => {
            const cfg = CATEGORY_CONFIG[b.name] || { icon: '\u2753', color: '#E0E0E0' }
            const isHovered = hoveredIdx === i
            const iconSize = b.r > 50 ? 26 : b.r > 35 ? 20 : 14
            const pctSize = b.r > 50 ? 11 : b.r > 35 ? 9 : 7
            const iconY = b.r > 30 ? b.y - b.r * 0.22 : b.y
            const pctY = b.r > 30 ? b.y + b.r * 0.28 : b.y + b.r * 0.5 + 8
            return (
              <g key={i}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => {
                  setHoveredIdx(i)
                  setTooltip({ visible: true, x: b.x, y: b.y - b.r - 8, data: b })
                }}
                onMouseLeave={() => {
                  setHoveredIdx(null)
                  setTooltip({ visible: false, x: 0, y: 0, data: null })
                }}
              >
                <circle
                  cx={b.x} cy={b.y} r={isHovered ? b.r + 4 : b.r}
                  fill={cfg.color}
                  opacity={hoveredIdx !== null && !isHovered ? 0.45 : 1}
                  style={{ transition: 'all 0.2s' }}
                />
                <text x={b.x} y={iconY}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={iconSize}>
                  {cfg.icon}
                </text>
                <text x={b.x} y={pctY}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={pctSize} fill="#444" fontWeight="700">
                  {b.pct}%
                </text>
                {moneda === 'USD' && b.r > 28 && (
                  <text x={b.x} y={b.y + b.r - 10}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={7} fill="#5588aa" fontWeight="700" opacity={0.8}>
                    U$S
                  </text>
                )}
              </g>
            )
          })}
          {tooltip.visible && tooltip.data && (() => {
            const cfg = CATEGORY_CONFIG[tooltip.data.name] || { icon: '\u2753', color: '#E0E0E0' }
            const tx = Math.max(80, Math.min(WIDTH - 80, tooltip.x))
            const ty = Math.max(30, tooltip.y)
            return (
              <g>
                <rect x={tx - 85} y={ty - 32} width={170} height={50}
                  rx={8} fill="white"
                  style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.12))' }} />
                <text x={tx} y={ty - 12} textAnchor="middle" fontSize={12} fontWeight="700" fill="#2d2d2d">
                  {cfg.icon} {tooltip.data.name}
                </text>
                <text x={tx} y={ty + 8} textAnchor="middle" fontSize={11} fill="#666">
                  {monedaSymbol(moneda)} {formatMontoFull(tooltip.data.value)}
                </text>
              </g>
            )
          })()}
        </svg>
      </div>
      <div style={{ width: '200px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '16px' }}>
        {[...bubbles].sort((a, b) => b.value - a.value).map((b, i) => {
          const cfg = CATEGORY_CONFIG[b.name] || { icon: '\u2753', color: '#E0E0E0' }
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: cfg.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: '#3a3a3c' }}>{cfg.icon} {b.name}</span>
              <span style={{ fontWeight: '700', color: '#1d1d1f', whiteSpace: 'nowrap' }}>
                {monedaSymbol(moneda)} {formatMonto(b.value)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AccountDetail({ account, refreshKey }) {
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingTx, setEditingTx] = useState(null)
  const [editNombre, setEditNombre] = useState('')
  const [editCategoria, setEditCategoria] = useState('')
  const [editSubcategoria, setEditSubcategoria] = useState('')
  const [sortKey, setSortKey] = useState('fecha')
  const [sortDir, setSortDir] = useState('desc')
  const [selectedMeses, setSelectedMeses] = useState([])

  useEffect(() => {
    if (account) fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, refreshKey])

  const fetchData = async () => {
    setLoading(true)
    const [txRes, catRes, subcatRes, stmtRes] = await Promise.all([
      supabase.from('transactions')
        .select('*, categories(nombre, color), subcategories(nombre)')
        .eq('account_id', account.id)
        .order('fecha', { ascending: false }),
      supabase.from('categories').select('*').order('orden'),
      supabase.from('subcategories').select('*').order('nombre'),
      supabase.from('statements')
        .select('*')
        .eq('account_id', account.id)
        .order('fecha_hasta', { ascending: true }),
    ])
    const txs = txRes.data || []
    setTransactions(txs)
    setCategories(catRes.data || [])
    setSubcategories(subcatRes.data || [])
    setStatements(stmtRes.data || [])

    if (txs.length > 0) {
      const meses = [...new Set(txs.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()
      setSelectedMeses([meses[0]])
    }
    setLoading(false)
  }

  const mesesDisponibles = [...new Set(transactions.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()

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

  const handleSaveEdit = async (tx) => {
    const catObj = categories.find(c => c.nombre === editCategoria)
    const subcatObj = subcategories.find(s => s.nombre === editSubcategoria && s.category_id === catObj?.id)
    await supabase.from('transactions').update({
      nombre: editNombre,
      category_id: catObj ? catObj.id : tx.category_id,
      subcategory_id: subcatObj ? subcatObj.id : null,
      estado: 'identificado'
    }).eq('id', tx.id)
    setTransactions(prev => prev.map(t => t.id === tx.id ? {
      ...t,
      nombre: editNombre,
      category_id: catObj?.id || t.category_id,
      subcategory_id: subcatObj?.id || null,
      estado: 'identificado',
      categories: catObj ? { nombre: catObj.nombre, color: catObj.color } : t.categories,
      subcategories: subcatObj ? { nombre: subcatObj.nombre } : null
    } : t))
    setEditingTx(null)
  }

  const startEdit = (tx) => {
    setEditingTx(tx.id)
    setEditNombre(tx.nombre || tx.detalle)
    setEditCategoria(tx.categories?.nombre || 'A Identificar')
    setEditSubcategoria(tx.subcategories?.nombre || '')
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

  const sortTx = (list) => {
    return [...list].sort((a, b) => {
      let valA, valB
      if (sortKey === 'fecha') { valA = a.fecha; valB = b.fecha }
      else if (sortKey === 'nombre') { valA = (a.nombre || a.detalle || '').toLowerCase(); valB = (b.nombre || b.detalle || '').toLowerCase() }
      else if (sortKey === 'categoria') { valA = (a.categories?.nombre || '').toLowerCase(); valB = (b.categories?.nombre || '').toLowerCase() }
      else if (sortKey === 'subcategoria') { valA = (a.subcategories?.nombre || '').toLowerCase(); valB = (b.subcategories?.nombre || '').toLowerCase() }
      else if (sortKey === 'monto') {
        valA = a.tipo === 'ingreso' ? Number(a.monto) : -Number(a.monto)
        valB = b.tipo === 'ingreso' ? Number(b.monto) : -Number(b.monto)
      }
      else if (sortKey === 'cuotas') { valA = a.cuotas_total || 1; valB = b.cuotas_total || 1 }
      else if (sortKey === 'moneda') { valA = a.moneda || ''; valB = b.moneda || '' }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  const barData = statements.map(s => ({
    mes: s.periodo || s.fecha_hasta?.slice(0, 7),
    total: Number(s.total_resumen) || 0
  }))

  // Transacciones de los meses seleccionados
  const mesTxs = selectedMeses.length > 0
    ? transactions.filter(t => selectedMeses.some(m => t.fecha?.startsWith(m)) && t.tipo === 'gasto')
    : []

  const mesARS = mesTxs.filter(t => t.moneda === 'ARS')
  const mesUSD = mesTxs.filter(t => t.moneda === 'USD')

  const buildBubbleData = (txList) => Object.entries(
    txList.reduce((acc, t) => {
      const cat = t.categories?.nombre || 'A Identificar'
      acc[cat] = (acc[cat] || 0) + Number(t.monto)
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  const bubbleARS = buildBubbleData(mesARS)
  const bubbleUSD = buildBubbleData(mesUSD)

  const sinIdentificar = transactions.filter(t => t.estado === 'a_identificar' || t.categories?.nombre === 'A Identificar')
  const identificadas = sortTx(transactions.filter(t => t.estado !== 'a_identificar' && t.categories?.nombre !== 'A Identificar'))

  const renderEditCells = () => (
    <>
      <td style={styles.td}>
        <input style={styles.editInput} value={editNombre}
          onChange={e => setEditNombre(e.target.value)} />
      </td>
      <td style={styles.td}>
        <select style={styles.editSelect} value={editCategoria}
          onChange={e => { setEditCategoria(e.target.value); setEditSubcategoria('') }}>
          {categories.map(c => (
            <option key={c.id} value={c.nombre}>{c.nombre}</option>
          ))}
        </select>
      </td>
      <td style={styles.td}>
        <select style={styles.editSelect} value={editSubcategoria}
          onChange={e => setEditSubcategoria(e.target.value)}>
          <option value="">— Sin subcategoría</option>
          {filteredSubcats().map(s => (
            <option key={s.id} value={s.nombre}>{s.nombre}</option>
          ))}
        </select>
      </td>
    </>
  )

  const renderEditActions = (tx) => (
    <td style={styles.td}>
      <div style={{display:'flex', gap:'4px'}}>
        <button style={styles.saveEditBtn} onClick={() => handleSaveEdit(tx)}>✓</button>
        <button style={styles.cancelEditBtn} onClick={() => setEditingTx(null)}>✕</button>
      </div>
    </td>
  )

  const thSortable = (label, key) => (
    <th style={styles.thSortable} onClick={() => handleSort(key)}>
      {label}<span style={styles.sortIcon}>{sortIcon(key)}</span>
    </th>
  )

  if (loading) return (
    <div style={styles.loading}>Cargando datos de {account.nombre}...</div>
  )

  return (
    <div>
      {barData.length > 0 && (
        <div style={styles.chartSection}>
          <h3 style={styles.chartTitle}>📊 Total por mes</h3>
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

      {mesesDisponibles.length > 0 && (
        <div style={styles.chartSection}>
          <div style={styles.mesChipsHeader}>
            <h3 style={{...styles.chartTitle, margin: 0}}>🫧 Gastos de:</h3>
            <div style={styles.mesChips}>
              {mesesDisponibles.map(m => (
                <button
                  key={m}
                  style={{
                    ...styles.mesChip,
                    ...(selectedMeses.includes(m) ? styles.mesChipActive : {})
                  }}
                  onClick={() => toggleMes(m)}
                >
                  {mesLabel(m)}
                </button>
              ))}
            </div>
          </div>

          {selectedMeses.length === 0 && (
            <p style={{color:'#aaa', fontSize:'14px', marginTop:'16px'}}>Seleccioná al menos un mes.</p>
          )}

          {bubbleARS.length > 0 && (
            <div style={styles.bubbleSection}>
              <h4 style={styles.bubbleSubtitle}>Pesos ARS</h4>
              <BubbleChart data={bubbleARS} moneda="ARS" />
            </div>
          )}
          {bubbleUSD.length > 0 && (
            <div style={styles.bubbleSection}>
              <h4 style={styles.bubbleSubtitle}>Dólares USD</h4>
              <BubbleChart data={bubbleUSD} moneda="USD" />
            </div>
          )}
          {selectedMeses.length > 0 && bubbleARS.length === 0 && bubbleUSD.length === 0 && (
            <p style={{color:'#aaa', fontSize:'14px', marginTop:'16px'}}>Sin gastos en los meses seleccionados.</p>
          )}
        </div>
      )}

      {sinIdentificar.length > 0 && (
        <div style={styles.tableSection}>
          <h3 style={styles.chartTitle}>❓ Sin identificar ({sinIdentificar.length})</h3>
          <p style={styles.tableHint}>Editá el nombre, categoría y subcategoría de estos gastos</p>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Fecha</th>
                <th style={styles.th}>Detalle original</th>
                <th style={styles.th}>Nombre</th>
                <th style={styles.th}>Categoría</th>
                <th style={styles.th}>Subcategoría</th>
                <th style={styles.th}>Monto</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {sinIdentificar.map(tx => (
                <tr key={tx.id} style={styles.trUnknown}>
                  <td style={styles.td}>{tx.fecha}</td>
                  <td style={styles.td}><span style={styles.detalle}>{tx.detalle}</span></td>
                  {editingTx === tx.id ? renderEditCells() : (
                    <>
                      <td style={styles.td}><span style={{color:'#aaa'}}>{tx.nombre || '—'}</span></td>
                      <td style={styles.td}><span style={{color:'#aaa'}}>—</span></td>
                      <td style={styles.td}><span style={{color:'#aaa'}}>—</span></td>
                    </>
                  )}
                  <td style={{...styles.td, textAlign:'right', fontWeight:'600'}}>
                    {monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
                  </td>
                  {editingTx === tx.id ? renderEditActions(tx) : (
                    <td style={styles.td}>
                      <button style={styles.editBtn} onClick={() => startEdit(tx)}>✏️</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={styles.tableSection}>
        <h3 style={styles.chartTitle}>📋 Todas las transacciones ({identificadas.length})</h3>
        <table style={styles.table}>
          <thead>
            <tr>
              {thSortable('Fecha', 'fecha')}
              {thSortable('Nombre', 'nombre')}
              {thSortable('Categoría', 'categoria')}
              {thSortable('Subcategoría', 'subcategoria')}
              {thSortable('Cuotas', 'cuotas')}
              {thSortable('Moneda', 'moneda')}
              {thSortable('Monto', 'monto')}
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {identificadas.map(tx => (
              <tr key={tx.id} style={styles.tr}>
                <td style={styles.td}>{tx.fecha}</td>
                {editingTx === tx.id ? renderEditCells() : (
                  <>
                    <td style={styles.td}>{tx.nombre || tx.detalle}</td>
                    <td style={styles.td}>
                      <span style={{
                        backgroundColor: (CATEGORY_CONFIG[tx.categories?.nombre]?.color || '#E0E0E0'),
                        color: '#3a3a3c',
                        padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600'
                      }}>
                        {CATEGORY_CONFIG[tx.categories?.nombre]?.icon || '❓'} {tx.categories?.nombre || '—'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{fontSize:'12px', color:'#888'}}>
                        {tx.subcategories?.nombre || '—'}
                      </span>
                    </td>
                  </>
                )}
                <td style={styles.td}>
                  {tx.cuotas_total > 1 ? `${tx.cuota_numero}/${tx.cuotas_total}` : '—'}
                </td>
                <td style={styles.td}>
                  <span style={{
                    fontSize: '11px', fontWeight: '600',
                    color: tx.moneda === 'USD' ? '#5588aa' : '#666',
                    backgroundColor: tx.moneda === 'USD' ? '#ddeef8' : '#f0f2f8',
                    padding: '2px 6px', borderRadius: '8px'
                  }}>
                    {tx.moneda || 'ARS'}
                  </span>
                </td>
                <td style={{...styles.td, textAlign:'right', fontWeight:'600', whiteSpace:'nowrap',
                  color: tx.tipo === 'ingreso' ? '#4a9e7a' : '#2d2d2d'}}>
                  {tx.tipo === 'ingreso' ? '+' : '-'}{monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
                </td>
                {editingTx === tx.id ? renderEditActions(tx) : (
                  <td style={styles.td}>
                    <button style={styles.editBtn} onClick={() => startEdit(tx)}>✏️</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const styles = {
  loading: { padding: '24px', color: '#6e6e73', fontSize: '14px' },
  chartSection: { marginBottom: '32px' },
  chartTitle: { fontSize: '16px', fontWeight: '700', color: '#1d1d1f', margin: '0 0 16px 0' },
  mesChipsHeader: { display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' },
  mesChips: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  mesChip: {
    padding: '6px 14px', borderRadius: '20px', border: '1.5px solid #d0d5ee',
    backgroundColor: 'white', color: '#6e6e73', fontSize: '13px', cursor: 'pointer',
    fontWeight: '500', transition: 'all 0.15s'
  },
  mesChipActive: {
    backgroundColor: '#6B7BB8', color: 'white', borderColor: '#6B7BB8', fontWeight: '600'
  },
  bubbleSection: { marginBottom: '32px' },
  bubbleSubtitle: { fontSize: '14px', fontWeight: '600', color: '#3a3a3c', margin: '0 0 16px 0' },
  tableSection: { marginBottom: '32px' },
  tableHint: { fontSize: '13px', color: '#6e6e73', margin: '-8px 0 12px 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: {
    textAlign: 'left', padding: '10px 12px', fontSize: '11px',
    color: '#6e6e73', textTransform: 'uppercase', borderBottom: '2px solid #eef0f8', fontWeight: '600'
  },
  thSortable: {
    textAlign: 'left', padding: '10px 12px', fontSize: '11px',
    color: '#6e6e73', textTransform: 'uppercase', borderBottom: '2px solid #eef0f8', fontWeight: '600',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap'
  },
  sortIcon: { fontSize: '10px', color: '#bbb' },
  td: { padding: '10px 12px', borderBottom: '1px solid #f0f2f8', verticalAlign: 'middle' },
  tr: { transition: 'background 0.1s' },
  trUnknown: { backgroundColor: '#fffbf0' },
  detalle: { fontSize: '12px', color: '#8e8e93', fontFamily: 'monospace' },
  editInput: {
    width: '100%', padding: '4px 8px', borderRadius: '6px',
    border: '1px solid #6B7BB8', fontSize: '13px', outline: 'none'
  },
  editSelect: {
    width: '100%', padding: '4px 8px', borderRadius: '6px',
    border: '1px solid #6B7BB8', fontSize: '13px', outline: 'none', backgroundColor: 'white'
  },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: 0.6 },
  saveEditBtn: {
    padding: '3px 8px', backgroundColor: '#4a9e7a', color: 'white',
    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px'
  },
  cancelEditBtn: {
    padding: '3px 8px', backgroundColor: '#e0e0e0', color: '#3a3a3c',
    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px'
  },
}