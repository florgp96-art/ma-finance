import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

export const CATEGORY_CONFIG = {
  'Comida':          { icon: '🍔', color: '#FADADD' },
  'Personal':        { icon: '👤', color: '#C8C0CC' },
  'Transporte':      { icon: '🚗', color: '#BDB5C4' },
  'Salud':           { icon: '💊', color: '#FFCBA4' },
  'Entretenimiento': { icon: '🎬', color: '#FFB3BA' },
  'Suscripciones':   { icon: '📱', color: '#C8B8DC' },
  'Ropa':            { icon: '👕', color: '#E8C3D8' },
  'Casa':            { icon: '🏠', color: '#C4B8D8' },
  'Educación':       { icon: '📚', color: '#D4C8E8' },
  'Trabajo':         { icon: '💼', color: '#E8D8C8' },
  'Ingresos':        { icon: '💰', color: '#D0C0E8' },
  'Débitos':         { icon: '🏦', color: '#D0CCCE' },
  'Hijos':           { icon: '👶', color: '#FDEBD0' },
  'A Identificar':   { icon: '❓', color: '#F9E4B7' },
}

const BAR_COLOR = '#B0A4CC'
const INCOME_PALETTE = ['#C8B4E8','#B8A0D8','#D4C8F0','#A890C8','#BCA8D8','#CCC0E8','#D8D0F0','#B4A4D0']

export const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(monto)

export const formatMontoFull = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)

export const formatFecha = (f) => f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : ''
export const formatFechaCorta = (f) => f ? f.slice(8, 10) + '/' + f.slice(5, 7) : ''

const monedaSymbol = (moneda) => moneda === 'USD' ? 'U$S' : '$'

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

// Bubble chart component
export function BubbleChart({ data, legendData, childRows, darkMode, tipoCambio, isMobile }) {
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

    const withR = data.map(d => {
      const ratio = maxVal === minVal ? 0.7 : 0.3 + 0.7 * (d.value / maxVal)
      const r = Math.max(MIN_R, Math.min(MAX_R, ratio * MAX_R))
      return { ...d, r, pct: Math.round((d.value / total) * 100) }
    })

    const cols = Math.ceil(Math.sqrt(withR.length))
    const positioned = withR.map((b, i) => ({
      ...b,
      x: (WIDTH / (cols + 1)) * ((i % cols) + 1),
      y: (HEIGHT / (Math.ceil(withR.length / cols) + 1)) * (Math.floor(i / cols) + 1),
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
    }))

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
    <div ref={containerRef} style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: 'flex-start', width: '100%' }}>
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <svg width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: 'block' }}>
          {bubbles.map((b, i) => {
            const cfg = CATEGORY_CONFIG[b.name] || { icon: '❓', color: '#E0E0E0' }
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
                  fontSize={pctSize} fill={darkMode ? '#ccc' : '#444'} fontWeight="700">
                  {b.pct}%
                </text>
                {(b.originalUSD || 0) > 0 && b.r > 28 && (
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
            const cfg = CATEGORY_CONFIG[tooltip.data.name] || { icon: '❓', color: '#E0E0E0' }
            const tx = Math.max(85, Math.min(WIDTH - 85, tooltip.x))
            const ty = Math.max(30, tooltip.y)
            const hasARS = (tooltip.data.originalARS || 0) > 0
            const hasUSD = (tooltip.data.originalUSD || 0) > 0
            const hasBoth = hasARS && hasUSD
            const rH = hasBoth ? 66 : 50
            return (
              <g>
                <rect x={tx - 85} y={ty - 32} width={170} height={rH}
                  rx={8} fill={darkMode ? '#2A272A' : 'white'}
                  style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.18))' }} />
                <text x={tx} y={ty - 12} textAnchor="middle" fontSize={12} fontWeight="700" fill={darkMode ? '#F0EDEC' : '#2d2d2d'}>
                  {cfg.icon} {tooltip.data.name}
                </text>
                {hasARS && (
                  <text x={tx} y={ty + 8} textAnchor="middle" fontSize={11} fill={darkMode ? '#9A8A9A' : '#6e6e73'}>
                    $ {formatMontoFull(tooltip.data.originalARS)}
                  </text>
                )}
                {!hasARS && hasUSD && (
                  <text x={tx} y={ty + 8} textAnchor="middle" fontSize={11} fill={darkMode ? '#9A8A9A' : '#6e6e73'}>
                    $ {formatMontoFull(Math.round(tooltip.data.originalUSD * (parseFloat(tipoCambio) || 0)))}
                  </text>
                )}
                {hasBoth && (
                  <text x={tx} y={ty + 26} textAnchor="middle" fontSize={10} fill="#5588aa">
                    + $ {formatMontoFull(Math.round(tooltip.data.originalUSD * (parseFloat(tipoCambio) || 0)))}
                  </text>
                )}
              </g>
            )
          })()}
        </svg>
      </div>
      <div style={{ width: isMobile ? '100%' : '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: isMobile ? '0' : '16px' }}>
        {([...(legendData || bubbles)].sort((a, b) => b.value - a.value)).map((b, i) => {
          const cfg = CATEGORY_CONFIG[b.name] || { icon: '❓', color: '#E0E0E0' }
          const arsAmt = (b.originalARS || 0)
          const usdAmt = (b.originalUSD || 0)
          const hasUSD = usdAmt > 0
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', alignItems: 'flex-start', gap: '6px', fontSize: '12px' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: cfg.color, flexShrink: 0, marginTop: '2px', outline: darkMode ? '1px solid rgba(255,255,255,0.2)' : 'none' }} />
              <span style={{ color: darkMode ? '#e0e0e0' : '#3a3a3c', lineHeight: '1.3' }}>{cfg.icon} {b.name}</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: '600', color: darkMode ? '#f5f5f7' : '#1d1d1f', whiteSpace: 'nowrap' }}>
                  $ {formatMonto(arsAmt > 0 ? arsAmt : b.value)}
                </div>
                {hasUSD && (
                  <div style={{ fontSize: '10px', color: '#5588aa', whiteSpace: 'nowrap' }}>
                    +$ {formatMonto(Math.round(usdAmt * (parseFloat(tipoCambio) || 0)))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {childRows && childRows.length > 0 && (
          <>
            <div style={{ borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, margin: '4px 0' }} />
            {childRows.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', alignItems: 'flex-start', gap: '6px', fontSize: '12px' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#f5a623', flexShrink: 0, marginTop: '2px' }} />
                <span style={{ color: darkMode ? '#e0e0e0' : '#3a3a3c' }}>👧 {c.name}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: '600', color: darkMode ? '#f5f5f7' : '#1d1d1f', whiteSpace: 'nowrap' }}>
                    $ {formatMonto(c.originalARS || 0)}
                  </div>
                  {(c.originalUSD || 0) > 0 && (
                    <div style={{ fontSize: '10px', color: '#5588aa', whiteSpace: 'nowrap' }}>
                      +U$S {formatMonto(c.originalUSD)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export default function AccountDetail({ account, accounts, allAccounts, refreshKey, searchQuery, onSearchChange, tipoCambio, tcMap, darkMode, onPeriodChange, onTransactionsLoaded, onAddIngreso }) {
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingTx, setEditingTx] = useState(null)
  const [editNombre, setEditNombre] = useState('')
  const [editCategoria, setEditCategoria] = useState('')
  const [editSubcategoria, setEditSubcategoria] = useState('')
  const [editTag, setEditTag] = useState('')
  const [children, setChildren] = useState([])
  const [sortKey, setSortKey] = useState('fecha')
  const [sortDir, setSortDir] = useState('desc')
  const [selectedMeses, setSelectedMeses] = useState([])
  const [selectedCatEvol, setSelectedCatEvol] = useState('')
  const [equivEnUSD, setEquivEnUSD] = useState(false)

  // Notificar al padre cuando cambia el período seleccionado
  useEffect(() => { onPeriodChange?.(selectedMeses) }, [selectedMeses, onPeriodChange])
  useEffect(() => { onTransactionsLoaded?.(transactions) }, [transactions, onTransactionsLoaded])
  const [mesDropdownOpen, setMesDropdownOpen] = useState(false)
  const [stmtCollapsed, setStmtCollapsed] = useState(false)
  const [chartType, setChartType] = useState(() => localStorage.getItem('chart_type_ma') || 'bubble')
  const mesDropdownRef = useRef(null)
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (allAccounts && accounts && accounts.length > 0) fetchAllData()
    else if (account) fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, accounts, allAccounts, refreshKey])

  useEffect(() => {
    supabase.from('children').select('nombre').order('nombre').then(({ data }) => setChildren(data || []))
  }, [])

  const fetchData = async () => {
    setLoading(true)
    const [txRes, catRes, subcatRes, stmtRes] = await Promise.all([
      supabase.from('transactions')
        .select('*, categories(nombre, color), subcategories(nombre)')
        .eq('account_id', account.id)
        .order('fecha', { ascending: false })
        .limit(5000),
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
      const now = new Date()
      const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      setSelectedMeses([meses.includes(mesActual) ? mesActual : meses[0]])
    }
    setLoading(false)
  }

  const fetchAllData = async () => {
    setLoading(true)
    const accountIds = accounts.map(a => a.id)
    const [txRes, catRes, subcatRes, stmtRes] = await Promise.all([
      supabase.from('transactions')
        .select('*, categories(nombre, color), subcategories(nombre), accounts(nombre)')
        .in('account_id', accountIds)
        .order('fecha', { ascending: false })
        .limit(5000),
      supabase.from('categories').select('*').order('orden'),
      supabase.from('subcategories').select('*').order('nombre'),
      supabase.from('statements')
        .select('*')
        .in('account_id', accountIds)
        .order('fecha_hasta', { ascending: true }),
    ])
    const txs = txRes.data || []
    setTransactions(txs)
    setCategories(catRes.data || [])
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

  // Guardar clasificación manual y aprender la regla
  const handleSaveEdit = async (tx) => {
    if (account?.tipo === 'ingreso' || tx.tipo === 'ingreso') {
      await supabase.from('transactions').update({ nombre: editNombre, tag: editTag || null }).eq('id', tx.id)
      setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, nombre: editNombre, tag: editTag || null } : t))
      setEditingTx(null)
      return
    }
    const catObj = categories.find(c => c.nombre === editCategoria)
    const subcatObj = subcategories.find(s => s.nombre === editSubcategoria && s.category_id === catObj?.id)

    // Actualizar la transacción
    await supabase.from('transactions').update({
      nombre: editNombre,
      category_id: catObj ? catObj.id : tx.category_id,
      subcategory_id: subcatObj ? subcatObj.id : null,
      estado: 'identificado',
      tag: editTag || null
    }).eq('id', tx.id)

    // Guardar regla aprendida en user_rules si hay un detalle original
    const texto_original = (tx.detalle || '').trim()
    if (texto_original && catObj) {
      const { data: { user } } = await supabase.auth.getUser()
      // Upsert: si ya existe una regla para este patrón, la actualiza
      await supabase.from('user_rules').upsert({
        user_id: user.id,
        texto_original: texto_original,
        nombre_asignado: editNombre || texto_original,
        categoria: catObj.nombre,
        subcategoria: subcatObj?.nombre || null,
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
      subcategories: subcatObj ? { nombre: subcatObj.nombre } : null
    } : t))
    setEditingTx(null)
  }

  const startEdit = (tx) => {
    setEditingTx(tx.id)
    setEditNombre(tx.nombre || tx.detalle)
    setEditCategoria(tx.categories?.nombre || 'A Identificar')
    setEditSubcategoria(tx.subcategories?.nombre || '')
    const matchedChild = children.find(c => c.nombre.toLowerCase() === (tx.tag || '').toLowerCase())
    setEditTag(matchedChild ? matchedChild.nombre : (tx.tag || ''))
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
      else if (sortKey === 'categoria') { valA = (a.tag || a.categories?.nombre || '').toLowerCase(); valB = (b.tag || b.categories?.nombre || '').toLowerCase() }
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

  const mesTxs = selectedMeses.length > 0
    ? transactions.filter(t => selectedMeses.some(m => t.fecha?.startsWith(m)) && t.tipo !== 'neutro')
    : []

  const getTC = (mes) => {
    if (mes && tcMap && tcMap[mes]) return Number(tcMap[mes])
    return parseFloat(tipoCambio) || 1
  }

  // TC efectivo para el período seleccionado (usa el del primer mes seleccionado)
  const tcEfectivo = getTC(selectedMeses[0] || new Date().toISOString().slice(0, 7))

  const buildBubbleData = (txList, tc) => {
    const tcNum = parseFloat(tc) || 0
    return Object.values(
      txList.reduce((acc, t) => {
        const cat = t.categories?.nombre || 'A Identificar'
        const monto = Number(t.monto)
        const moneda = t.moneda || 'ARS'
        if (!acc[cat]) acc[cat] = { name: cat, value: 0, originalARS: 0, originalUSD: 0 }
        if (moneda === 'USD') {
          acc[cat].originalUSD += monto
          if (tcNum > 0) acc[cat].value += monto * tcNum
        } else {
          acc[cat].value += monto
          acc[cat].originalARS += monto
        }
        return acc
      }, {})
    ).sort((a, b) => b.value - a.value)
  }

  const gastosParaGrafico = mesTxs.filter(t => t.tipo === 'gasto')
  const bubbleData = buildBubbleData(gastosParaGrafico, tcEfectivo)

  // Datos para legend: categorías sin hijos + child rows separadas
  const childTags = [...new Set(mesTxs.filter(t => t.tag && t.tipo === 'gasto').map(t => t.tag))]
  const netBubbleData = childTags.length > 0
    ? buildBubbleData(mesTxs.filter(t => t.tipo === 'gasto' && !t.tag), tcEfectivo)
    : null
  const childTotals = childTags.map(tag => {
    const txs = mesTxs.filter(t => t.tag === tag && t.tipo === 'gasto')
    return {
      name: tag,
      value: txs.reduce((s, t) => s + (t.moneda === 'USD' ? Number(t.monto) * tcEfectivo : Number(t.monto)), 0),
      originalARS: txs.filter(t => t.moneda === 'ARS').reduce((s, t) => s + Number(t.monto), 0),
      originalUSD: txs.filter(t => t.moneda === 'USD').reduce((s, t) => s + Number(t.monto), 0),
    }
  }).sort((a, b) => b.value - a.value)

  const totalARS = mesTxs.filter(t => t.moneda === 'ARS' && t.tipo === 'gasto').reduce((s, t) => s + Number(t.monto), 0)
  const totalUSD = mesTxs.filter(t => t.moneda === 'USD' && t.tipo === 'gasto').reduce((s, t) => s + Number(t.monto), 0)
  const totalIngresosARS = mesTxs.filter(t => t.moneda === 'ARS' && t.tipo === 'ingreso').reduce((s, t) => s + Number(t.monto), 0)
  const totalIngresosUSD = mesTxs.filter(t => t.moneda === 'USD' && t.tipo === 'ingreso').reduce((s, t) => s + Number(t.monto), 0)
  const hayIngresos = allAccounts && (totalIngresosARS > 0 || totalIngresosUSD > 0)
  // Vista de cuenta de ingresos: todas las txs son tipo ingreso
  const esVistaIngresos = !allAccounts && account?.tipo === 'ingreso'

  const ingresoBubbleData = esVistaIngresos
    ? Object.values(
        mesTxs.filter(t => t.tipo === 'ingreso').reduce((acc, t) => {
          const cat = t.tag || t.nombre || 'Sin categoría'
          const monto = t.moneda === 'USD' ? Number(t.monto) * (parseFloat(tcEfectivo) || 0) : Number(t.monto)
          if (!acc[cat]) acc[cat] = { name: cat, value: 0, originalARS: 0, originalUSD: 0 }
          acc[cat].value += monto
          if (t.moneda === 'ARS') acc[cat].originalARS += Number(t.monto)
          else acc[cat].originalUSD += Number(t.monto)
          return acc
        }, {})
      ).sort((a, b) => b.value - a.value)
    : []
  const chartData = esVistaIngresos ? ingresoBubbleData : bubbleData
  const getChartColor = (name, idx) => esVistaIngresos ? INCOME_PALETTE[idx % INCOME_PALETTE.length] : (CATEGORY_CONFIG[name]?.color || '#E0E0E0')
  const getChartIcon = (name) => esVistaIngresos ? '' : (CATEGORY_CONFIG[name]?.icon || '❓')
  const effectiveChartType = (esVistaIngresos && chartType === 'bubble') ? 'donut' : chartType

  const catTotals = mesTxs.filter(t => t.moneda === 'ARS' && t.tipo === 'gasto').reduce((acc, t) => {
    const cat = t.categories?.nombre || 'A Identificar'
    acc[cat] = (acc[cat] || 0) + Number(t.monto)
    return acc
  }, {})
  const catTop = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0]

  const puedeComparar = selectedMeses.length === 1
  const mesSeleccionado = puedeComparar ? selectedMeses[0] : null
  const idxMesSeleccionado = mesSeleccionado ? mesesDisponibles.indexOf(mesSeleccionado) : -1
  const mesAnterior = idxMesSeleccionado >= 0 && idxMesSeleccionado < mesesDisponibles.length - 1
    ? mesesDisponibles[idxMesSeleccionado + 1]
    : null
  const txMesSeleccionado = mesSeleccionado ? transactions.filter(t => t.fecha?.startsWith(mesSeleccionado) && t.tipo === 'gasto' && t.moneda === 'ARS') : []
  const txMesAnterior = mesAnterior ? transactions.filter(t => t.fecha?.startsWith(mesAnterior) && t.tipo === 'gasto' && t.moneda === 'ARS') : []
  const totalSeleccionado = txMesSeleccionado.reduce((s, t) => s + Number(t.monto), 0)
  const totalAnteriorMonto = txMesAnterior.reduce((s, t) => s + Number(t.monto), 0)
  const diffPct = puedeComparar && totalAnteriorMonto > 0 ? Math.round(((totalSeleccionado - totalAnteriorMonto) / totalAnteriorMonto) * 100) : null
  const diffMonto = totalSeleccionado - totalAnteriorMonto
  // Comparativa de ingresos vs mes anterior
  const totalIngSeleccionado = mesSeleccionado ? transactions.filter(t => t.fecha?.startsWith(mesSeleccionado) && t.tipo === 'ingreso' && t.moneda === 'ARS').reduce((s, t) => s + Number(t.monto), 0) : 0
  const totalIngAnterior = mesAnterior ? transactions.filter(t => t.fecha?.startsWith(mesAnterior) && t.tipo === 'ingreso' && t.moneda === 'ARS').reduce((s, t) => s + Number(t.monto), 0) : 0
  const diffIngPct = puedeComparar && mesAnterior && totalIngAnterior > 0 ? Math.round(((totalIngSeleccionado - totalIngAnterior) / totalIngAnterior) * 100) : null
  const diffIngMonto = totalIngSeleccionado - totalIngAnterior

  const txFiltradas = selectedMeses.length > 0
    ? transactions.filter(t => selectedMeses.some(m => t.fecha?.startsWith(m)))
    : transactions
  const txNoNeutras = txFiltradas.filter(t => t.tipo !== 'neutro')
  const txNeutras = txFiltradas.filter(t => t.tipo === 'neutro')

  const matchSearch = (t) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      (t.nombre || '').toLowerCase().includes(q) ||
      (t.detalle || '').toLowerCase().includes(q) ||
      (t.categories?.nombre || '').toLowerCase().includes(q) ||
      (t.subcategories?.nombre || '').toLowerCase().includes(q) ||
      (t.tag || '').toLowerCase().includes(q) ||
      (t.tipo || '').toLowerCase().includes(q)
    )
  }

  const sinIdentificar = txNoNeutras.filter(t => (t.estado === 'a_identificar' || t.categories?.nombre === 'A Identificar') && matchSearch(t))
  const identificadas = sortTx(txNoNeutras.filter(t => t.estado !== 'a_identificar' && t.categories?.nombre !== 'A Identificar' && matchSearch(t)))

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

  const renderEditCells = () => (
    <>
      <td style={styles.td}>
        <input style={styles.editInput} value={editNombre}
          onChange={e => setEditNombre(e.target.value)} />
        {children.length > 0 && (
          <select style={{ ...styles.editSelect, marginTop: '4px', fontSize: '11px' }}
            value={editTag} onChange={e => setEditTag(e.target.value)}>
            <option value="">👧 Sin hijo/a</option>
            {children.map(c => (
              <option key={c.nombre} value={c.nombre}>{c.nombre}</option>
            ))}
          </select>
        )}
      </td>
      <td style={styles.td}>
        <select style={styles.editSelect} value={editCategoria}
          onChange={e => { setEditCategoria(e.target.value); setEditSubcategoria('') }}>
          {categories.map(c => (
            <option key={c.id} value={c.nombre}>{c.nombre}</option>
          ))}
        </select>
      </td>
      <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
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

  const renderEditCellsIngreso = () => {
    const ingresosCat = categories.find(c => c.nombre === 'Ingresos')
    const ingresosSubcats = ingresosCat ? subcategories.filter(s => s.category_id === ingresosCat.id).map(s => s.nombre) : []
    const existingTags = [...new Set(transactions.filter(t => t.tipo === 'ingreso' && t.tag).map(t => t.tag))]
    const allOpts = [...new Set([...ingresosSubcats, ...existingTags])].sort()
    const valueIsCustom = editTag && !allOpts.includes(editTag)
    return (
      <>
        <td style={styles.td}>
          <input style={styles.editInput} value={editNombre} onChange={e => setEditNombre(e.target.value)} placeholder="Descripción" />
        </td>
        <td style={styles.td}>
          <select style={styles.editSelect} value={valueIsCustom ? '__custom__' : (editTag || '')} onChange={e => {
            if (e.target.value === '__custom__') return
            setEditTag(e.target.value)
          }}>
            <option value="">— Sin categoría —</option>
            {allOpts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            {valueIsCustom && <option value="__custom__">{editTag}</option>}
          </select>
        </td>
        <td style={{...styles.td, display: isMobile ? 'none' : undefined}} />
      </>
    )
  }

  const renderEditActions = (tx) => (
    <td style={styles.td}>
      <div style={{display:'flex', gap:'4px'}}>
        <button style={styles.saveEditBtn} onClick={() => handleSaveEdit(tx)}>✓</button>
        <button style={styles.cancelEditBtn} onClick={() => setEditingTx(null)}>✕</button>
      </div>
    </td>
  )

  const thSortable = (label, key, hidden = false, width = undefined) => (
    <th style={{...styles.thSortable, ...(hidden ? { display: 'none' } : {}), ...(width ? { width } : {})}} onClick={() => handleSort(key)}>
      {label}<span style={styles.sortIcon}>{sortIcon(key)}</span>
    </th>
  )

  const isMobile = windowWidth < 768
  const styles = getStyles(darkMode, isMobile)

  if (loading) return (
    <div style={styles.loading}>Cargando datos...</div>
  )

  // Contar transacciones por período de cada extracto, ordenados por mes descendente
  const stmtsConTx = [...statements]
    .sort((a, b) => {
      const pa = a.periodo || a.fecha_hasta?.slice(0, 7) || ''
      const pb = b.periodo || b.fecha_hasta?.slice(0, 7) || ''
      return pb.localeCompare(pa)
    })
    .map(s => {
      const mes = s.fecha_hasta?.slice(0, 7) || ''
      const count = transactions.filter(t => mes && t.fecha?.startsWith(mes)).length
      return { ...s, txCount: count }
    })

  return (
    <div>
      {/* Historial de extractos */}
      {!allAccounts && stmtsConTx.length > 0 && (
        <div style={styles.stmtHistory}>
          <div
            onClick={() => setStmtCollapsed(c => !c)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: stmtCollapsed ? 0 : '10px' }}>
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
          {esVistaIngresos && onAddIngreso && (
            <button onClick={onAddIngreso} style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: '10px', backgroundColor: '#5C4F5C', color: 'white', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', fontFamily: '"Montserrat", sans-serif', outline: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
              + Agregar ingreso
            </button>
          )}
        </div>
      )}

      {/* Cards de resumen */}
      {selectedMeses.length > 0 && mesTxs.length > 0 && (() => {
        const divider = <div style={{ borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, margin: '8px 0' }} />
        const egresosEquivARS = totalARS + totalUSD * tcEfectivo
        const ingresosEquivARS = totalIngresosARS + totalIngresosUSD * tcEfectivo
        const egresosEquivUSD = tcEfectivo > 0 ? totalUSD + totalARS / tcEfectivo : 0
        const ingresosEquivUSD = tcEfectivo > 0 ? totalIngresosUSD + totalIngresosARS / tcEfectivo : 0
        return (
          <div style={styles.summaryCards}>

            {/* === Vista cuenta de ingresos individual === */}
            {esVistaIngresos && (totalIngresosARS > 0 || totalIngresosUSD > 0) && (
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

            {/* vs mes anterior */}
            {(diffPct !== null || diffIngPct !== null) && mesAnterior && selectedMeses.length === 1 && !esVistaIngresos && (
              <div style={styles.summaryCard}>
                <p style={{ ...styles.summaryLabel, marginBottom: '6px' }}>vs {mesLabel(mesAnterior)}</p>
                {diffPct !== null && <>
                  <p style={{ ...styles.summaryLabel, marginBottom: '2px', opacity: 0.7 }}>GASTOS</p>
                  <p style={{...styles.summaryValue, color: diffPct > 0 ? '#c0392b' : '#2e8b6a', fontSize: '20px', marginBottom: '2px'}}>
                    {diffPct > 0 ? '↑' : '↓'} {Math.abs(diffPct)}%
                  </p>
                  <p style={{...styles.summarySubval, marginBottom: diffIngPct !== null ? '8px' : 0}}>{diffMonto > 0 ? '+' : ''}$ {formatMonto(Math.abs(diffMonto))}</p>
                </>}
                {diffIngPct !== null && <>
                  {diffPct !== null && <div style={{ borderTop: `1px solid ${darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, margin: '4px 0 6px' }} />}
                  <p style={{ ...styles.summaryLabel, marginBottom: '2px', opacity: 0.7 }}>INGRESOS</p>
                  <p style={{...styles.summaryValue, color: diffIngPct > 0 ? '#2e8b6a' : '#c0392b', fontSize: '20px', marginBottom: '2px'}}>
                    {diffIngPct > 0 ? '↑' : '↓'} {Math.abs(diffIngPct)}%
                  </p>
                  <p style={styles.summarySubval}>{diffIngMonto > 0 ? '+' : ''}$ {formatMonto(Math.abs(diffIngMonto))}</p>
                </>}
              </div>
            )}

            {/* Categoría top */}
            {catTop && !esVistaIngresos && (
              <div style={{ ...styles.summaryCard, textAlign: 'center' }}>
                <p style={styles.summaryLabel}>Categoría top</p>
                <p style={{...styles.summaryValue, fontSize: '18px'}}>{CATEGORY_CONFIG[catTop[0]]?.icon || '❓'} {catTop[0]}</p>
                <p style={styles.summarySubval}>$ {formatMonto(catTop[1])}</p>
              </div>
            )}

            {/* Equiv con toggle ARS⇌USD */}
            {tcEfectivo > 0 && !esVistaIngresos && (
              <div style={styles.summaryCard}>
                <p style={{ ...styles.summaryLabel, marginBottom: '8px' }}>EQUIV. TOTALES</p>
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
                  {!hayIngresos && <>{divider}
                    <p style={styles.summaryLabel}>Final equiv. en USD</p>
                    <p style={{ ...styles.summaryValue, fontSize: '18px' }}>U$S {formatMonto(egresosEquivUSD)}</p>
                  </>}
                </>}
              </div>
            )}

          </div>
        )
      })()}

      {barData.length > 0 && !allAccounts && (
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

      {esVistaIngresos && mesesDisponibles.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p style={{ fontSize: '32px', marginBottom: '12px' }}>💰</p>
          <p style={{ fontSize: '16px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', marginBottom: '8px' }}>Todavía no hay ingresos registrados</p>
          <p style={{ fontSize: '13px', color: '#8e8e93', marginBottom: '24px' }}>Registrá tu primer ingreso para ver los gráficos y totales</p>
          {onAddIngreso && (
            <button onClick={onAddIngreso} style={{ padding: '12px 24px', borderRadius: '12px', backgroundColor: '#5C4F5C', color: 'white', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: '"Montserrat", sans-serif', outline: 'none' }}>
              + Agregar primer ingreso
            </button>
          )}
        </div>
      )}

      {mesesDisponibles.length > 0 && (
        <div style={styles.chartSection}>
          {selectedMeses.length === 0 && (
            <p style={{color:'#aaa', fontSize:'14px', marginTop:'16px'}}>Seleccioná al menos un mes.</p>
          )}

          {chartData.length > 0 && (
            <div style={styles.bubbleSection}>
              <p style={{ fontSize: '11px', fontWeight: 600, color: darkMode ? '#9A8A9A' : '#8e8e93', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px 0' }}>
                {esVistaIngresos ? 'Gráficos de ingresos' : 'Gráficos de gastos'}
              </p>
              {/* Selector de tipo de gráfico */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73', marginRight: '2px' }}>Vista:</span>
                {(esVistaIngresos
                  ? [{ type: 'donut', label: '◎ Donut' }, { type: 'bars', label: '▤ Barras' }]
                  : [{ type: 'bubble', label: '◉ Burbujas' }, { type: 'donut', label: '◎ Donut' }, { type: 'bars', label: '▤ Barras' }]
                ).map(opt => (
                  <button key={opt.type}
                    onClick={() => { setChartType(opt.type); localStorage.setItem('chart_type_ma', opt.type) }}
                    style={{ padding: '4px 11px', borderRadius: '8px', border: `1px solid ${effectiveChartType === opt.type ? (darkMode ? '#8C7B8C' : '#5C4F5C') : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: effectiveChartType === opt.type ? (darkMode ? '#8C7B8C' : '#5C4F5C') : 'transparent', color: effectiveChartType === opt.type ? 'white' : (darkMode ? '#9A8A9A' : '#6e6e73'), cursor: 'pointer', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', transition: 'all 0.15s' }}>
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Burbujas — solo egresos */}
              {effectiveChartType === 'bubble' && !esVistaIngresos && (
                <BubbleChart data={chartData} legendData={netBubbleData} childRows={childTotals.length > 0 ? childTotals : undefined} darkMode={darkMode} tipoCambio={tcEfectivo} isMobile={isMobile} />
              )}

              {/* Donut */}
              {effectiveChartType === 'donut' && (
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: 'flex-start' }}>
                  <ResponsiveContainer width={isMobile ? '100%' : 260} height={240}>
                    <PieChart>
                      <Pie data={chartData} cx="50%" cy="50%" innerRadius={isMobile ? 58 : 68} outerRadius={isMobile ? 90 : 108} dataKey="value" paddingAngle={2}>
                        {chartData.map((entry, idx) => (
                          <Cell key={idx} fill={getChartColor(entry.name, idx)} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v, name) => [`$ ${formatMonto(v)}`, name]} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px', paddingTop: isMobile ? '4px' : '20px' }}>
                    {chartData.map((entry, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                        <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: getChartColor(entry.name, idx), flexShrink: 0 }} />
                        <span style={{ color: darkMode ? '#e0e0e0' : '#3a3a3c' }}>{getChartIcon(entry.name)} {entry.name}</span>
                        <span style={{ fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', textAlign: 'right' }}>$ {formatMonto(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Barras verticales */}
              {effectiveChartType === 'bars' && (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 48 }}>
                    <XAxis dataKey="name" tick={{ fontSize: isMobile ? 9 : 11, fill: darkMode ? '#F0EDEC' : '#3a3a3c', fontFamily: '"Montserrat", sans-serif' }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tickFormatter={v => `$${formatMonto(v)}`} tick={{ fontSize: 10, fill: '#6e6e73', fontFamily: '"Montserrat", sans-serif' }} width={isMobile ? 60 : 72} />
                    <Tooltip formatter={(v) => [`$ ${formatMonto(v)}`, 'Total']} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, idx) => (
                        <Cell key={idx} fill={getChartColor(entry.name, idx)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
          {selectedMeses.length > 0 && chartData.length === 0 && !esVistaIngresos && (
            <p style={{color:'#8e8e93', fontSize:'14px', marginTop:'16px'}}>Sin gastos en los meses seleccionados.</p>
          )}
          {selectedMeses.length > 0 && chartData.length === 0 && esVistaIngresos && (
            <p style={{color:'#8e8e93', fontSize:'14px', marginTop:'16px'}}>Sin ingresos en el mes seleccionado.</p>
          )}
        </div>
      )}


      {/* Buscador */}
      <div style={{ marginBottom: '24px' }}>
        <input
          style={{
            width: '100%', padding: '10px 14px', borderRadius: '12px',
            border: '1.5px solid #e0e0e0', fontSize: '14px', outline: 'none',
            boxSizing: 'border-box', backgroundColor: '#fafafa', color: '#1d1d1f'
          }}
          placeholder="🔍 Buscar por nombre, categoría..."
          value={searchQuery || ''}
          onChange={e => onSearchChange && onSearchChange(e.target.value)}
        />
      </div>

      {txNeutras.length > 0 && (
        <div style={styles.tableSection}>
          <h3 style={styles.chartTitle}>🔄 Movimientos neutros ({txNeutras.length})</h3>
          <p style={styles.tableHint}>Inversiones, pagos de tarjeta y transferencias propias — no se incluyen en los gráficos</p>
          <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Fecha</th>
                <th style={styles.th}>Nombre</th>
                <th style={styles.th}>Categoría</th>
                <th style={styles.th}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {txNeutras.map(tx => (
                <tr key={tx.id} style={{...styles.tr, opacity: 0.7}}>
                  <td style={styles.td}>{formatFecha(tx.fecha)}</td>
                  <td style={styles.td}>{tx.nombre || tx.detalle}</td>
                  <td style={styles.td}>
                    <span style={{
                      backgroundColor: '#f0f0f8', color: '#6e6e73',
                      padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500'
                    }}>
                      {tx.categories?.nombre || '—'}
                    </span>
                  </td>
                  <td style={{...styles.td, textAlign: 'right', fontWeight: '500', color: '#8e8e93'}}>
                    {tx.moneda === 'USD' ? 'U$S' : '$'} {formatMontoFull(tx.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {!esVistaIngresos && sinIdentificar.length > 0 && (
        <div style={styles.tableSection}>
          <h3 style={styles.chartTitle}>❓ Sin identificar ({sinIdentificar.length})</h3>
          <p style={styles.tableHint}>Editá el nombre, categoría y subcategoría de estos gastos</p>
          <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Fecha</th>
                <th style={{...styles.th, display: isMobile ? 'none' : undefined}}>Detalle original</th>
                <th style={styles.th}>Nombre</th>
                <th style={styles.th}>Categoría</th>
                <th style={{...styles.th, display: isMobile ? 'none' : undefined}}>Subcategoría</th>
                <th style={styles.th}>Monto</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {sinIdentificar.map(tx => (
                <tr key={tx.id} style={styles.trUnknown}>
                  <td style={styles.td}>{formatFecha(tx.fecha)}</td>
                  <td style={{...styles.td, display: isMobile ? 'none' : undefined}}><span style={styles.detalle}>{tx.detalle}</span></td>
                  {editingTx === tx.id ? renderEditCells() : (
                    <>
                      <td style={styles.td}><span style={{color:'#aaa'}}>{tx.nombre || '—'}</span></td>
                      <td style={styles.td}><span style={{color:'#aaa'}}>—</span></td>
                      <td style={{...styles.td, display: isMobile ? 'none' : undefined}}><span style={{color:'#aaa'}}>—</span></td>
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
        <div style={{ overflowX: 'hidden', width: '100%' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              {thSortable('Fecha', 'fecha', false, isMobile ? '19%' : undefined)}
              {thSortable('Nombre', 'nombre', false, isMobile ? '43%' : undefined)}
              {thSortable('Categoría', 'categoria', isMobile)}
              {thSortable('Subcategoría', 'subcategoria', isMobile)}
              {thSortable('Cuotas', 'cuotas', isMobile)}
              {thSortable('Moneda', 'moneda', isMobile)}
              {thSortable('Monto', 'monto', false, isMobile ? '25%' : undefined)}
              <th style={{...styles.th, ...(isMobile ? { width: '13%' } : {})}}></th>
            </tr>
          </thead>
          <tbody>
            {identificadas.map(tx => (
              <tr key={tx.id} style={styles.tr}>
                <td style={{...styles.td, whiteSpace: 'nowrap'}}>
                  {isMobile ? formatFechaCorta(tx.fecha) : formatFecha(tx.fecha)}
                </td>
                {editingTx === tx.id ? ((esVistaIngresos || tx.tipo === 'ingreso') ? renderEditCellsIngreso() : renderEditCells()) : (
                  <>
                    <td style={{...styles.td, overflow: isMobile ? 'hidden' : undefined, textOverflow: isMobile ? 'ellipsis' : undefined, whiteSpace: isMobile ? 'nowrap' : undefined}}>
                      <div style={isMobile ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}}>
                        {tx.nombre || tx.detalle}
                      </div>
                      {tx.tag && !isMobile && !esVistaIngresos && (
                        <span style={{ fontSize: '11px', color: '#8C7B8C', backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', padding: '1px 7px', borderRadius: '8px', display: 'inline-block', marginTop: '3px' }}>
                          👧 {tx.tag}
                        </span>
                      )}
                    </td>
                    <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                      {(esVistaIngresos || tx.tipo === 'ingreso') ? (
                        <span style={{ backgroundColor: darkMode ? '#3A2F4A' : '#EDE8F4', color: darkMode ? '#C8B4E8' : '#5C4F5C', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap' }}>
                          {tx.tag || '—'}
                        </span>
                      ) : (
                        <span style={{ backgroundColor: (CATEGORY_CONFIG[tx.categories?.nombre]?.color || '#E0E0E0'), color: '#3a3a3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500' }}>
                          {CATEGORY_CONFIG[tx.categories?.nombre]?.icon || '❓'} {tx.categories?.nombre || '—'}
                        </span>
                      )}
                    </td>
                    <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                      <span style={{fontSize:'12px', color:'#888'}}>
                        {esVistaIngresos ? '' : (tx.subcategories?.nombre || '—')}
                      </span>
                    </td>
                  </>
                )}
                <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                  {tx.cuotas_total > 1 ? `${tx.cuota_numero}/${tx.cuotas_total}` : '—'}
                </td>
                <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                  <span style={{
                    fontSize: '11px', fontWeight: '500',
                    color: tx.moneda === 'USD' ? '#5588aa' : '#666',
                    backgroundColor: tx.moneda === 'USD' ? '#ddeef8' : '#f0f2f8',
                    padding: '2px 6px', borderRadius: '8px'
                  }}>
                    {tx.moneda || 'ARS'}
                  </span>
                </td>
                <td style={{...styles.td, textAlign:'right', fontWeight:'600',
                  whiteSpace: isMobile ? 'normal' : 'nowrap', wordBreak: isMobile ? 'break-all' : undefined,
                  color: darkMode ? '#F0EDEC' : '#2d2d2d'}}>
                  {tx.tipo === 'ingreso' ? '+' : '-'}{monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
                </td>
                {editingTx === tx.id ? renderEditActions(tx) : (
                  <td style={styles.td}>
                    <div style={{display:'flex', gap:'4px'}}>
                      <button style={styles.editBtn} onClick={() => startEdit(tx)}>✏️</button>
                      <button style={{...styles.editBtn, color: '#c0392b'}} onClick={() => handleDeleteTx(tx)}>🗑️</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Evolución por categoría — solo mobile; en desktop se muestra en el sidebar derecho */}
      {isMobile && transactions.length > 0 && (() => {
        const categoriasConTx = [...new Set(
          transactions.filter(t => t.tipo === 'gasto' && t.categories?.nombre)
            .map(t => t.categories.nombre)
        )].sort()
        const evolData = getLast6Months().map(m => {
          const tc = getTC(m)
          const total = transactions
            .filter(t => t.fecha?.startsWith(m) && t.tipo === 'gasto' && t.categories?.nombre === selectedCatEvol)
            .reduce((s, t) => {
              const monto = Number(t.monto)
              return s + (t.moneda === 'USD' && tc > 0 ? monto * tc : t.moneda === 'ARS' ? monto : 0)
            }, 0)
          return { mes: mesLabel(m), total }
        })
        const borderClr = darkMode ? '#3A333A' : '#E2DDE0'
        const bgClr = darkMode ? '#1C1A1C' : '#F0EDEC'
        const txtClr = darkMode ? '#F0EDEC' : '#5C4F5C'
        return (
          <div style={{ ...styles.chartSection, marginTop: '8px' }}>
            <h3 style={styles.chartTitle}>📈 Evolución por categoría</h3>
            <select
              style={{ padding: '8px 12px', borderRadius: '8px', border: `1px solid ${borderClr}`, fontSize: '13px', outline: 'none', backgroundColor: bgClr, color: txtClr, fontFamily: '"Montserrat", sans-serif', marginBottom: '16px', cursor: 'pointer' }}
              value={selectedCatEvol}
              onChange={e => setSelectedCatEvol(e.target.value)}
            >
              <option value="">— Elegir categoría —</option>
              {categoriasConTx.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {selectedCatEvol ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={evolData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#6e6e73', fontFamily: '"Montserrat", sans-serif' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6e6e73', fontFamily: '"Montserrat", sans-serif' }} tickFormatter={v => `$${formatMonto(v)}`} width={85} />
                  <Tooltip formatter={(v) => [`$ ${formatMontoFull(v)}`, selectedCatEvol]} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: bgClr, border: `1px solid ${borderClr}` }} />
                  <Bar dataKey="total" fill="#5C4F5C" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>Seleccioná una categoría para ver su evolución.</p>
            )}
          </div>
        )
      })()}
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
    summaryCards: { display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(180px, 1fr))', gap: mobile ? '10px' : '16px', marginBottom: '24px' },
    summaryCard: { backgroundColor: panel, borderRadius: '14px', padding: mobile ? '12px 14px' : '18px 20px', boxShadow: shadow, border: `1px solid ${hdrBorder}`, minWidth: 0 },
    summaryLabel: { fontSize: mobile ? '10px' : '11px', fontWeight: '400', color: muted, margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '0.08em' },
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
    table: { width: '100%', borderCollapse: 'collapse', fontSize: mobile ? '12px' : '13px', tableLayout: mobile ? 'fixed' : undefined },
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
    td: { padding: mobile ? '6px 8px' : '10px 12px', borderBottom: `1px solid ${tdBorder}`, verticalAlign: 'middle', color: txt },
    tr: { transition: 'background 0.1s' },
    trUnknown: { backgroundColor: dark ? '#201E10' : '#fffbf0' },
    detalle: { fontSize: '12px', color: muted, fontFamily: 'monospace' },
    editInput: { width: '100%', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${p}`, fontSize: '13px', outline: 'none', backgroundColor: dark ? '#1C1A1C' : 'white', color: txt },
    editSelect: { width: '100%', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${p}`, fontSize: '13px', outline: 'none', backgroundColor: dark ? '#1C1A1C' : 'white', color: txt },
    editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: 0.6 },
    saveEditBtn: { padding: '3px 8px', backgroundColor: '#4a9e7a', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
    cancelEditBtn: { padding: '3px 8px', backgroundColor: dark ? '#3A333A' : '#e0e0e0', color: dark ? '#F0EDEC' : '#3a3a3c', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
    exportBtn: { padding: '7px 14px', backgroundColor: p, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif' },
    stmtHistory: { marginBottom: '24px' },
    stmtHistoryTitle: { fontSize: '13px', fontWeight: '500', color: muted, margin: '0 0 10px 0', letterSpacing: '0.06em', textTransform: 'uppercase' },
    stmtChips: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
    stmtChip: { display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: cardBg, borderRadius: '10px', padding: '8px 12px', border: `1px solid ${border}`, minWidth: '110px' },
    stmtChipPeriod: { fontSize: '13px', fontWeight: '500', color: txt },
    stmtChipDetail: { fontSize: '11px', color: muted },
  }
}