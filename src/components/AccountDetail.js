import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

export const CATEGORY_CONFIG = {
  'Comida':          { icon: '🍴', color: '#FADADD' },
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
  'Hijos':           { icon: '👩‍👧‍👧', color: '#FDEBD0' },
  'A Identificar':   { icon: '❓', color: '#F9E4B7' },
}

const BAR_COLOR = '#5C4F5C'
const INCOME_PALETTE = ['#5C4F5C','#8C7B8C','#C4B8C4','#6A5A6A','#9A8A9A','#7A6A7A','#B4A8B4','#4A3F4A']
const CHILDREN_PALETTE = ['#A8C4E8', '#E8C4A8', '#C4E8A8', '#E8A8C4', '#C4A8E8']

export const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

export const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(monto)

export const formatMontoFull = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)

export const formatFecha = (f) => f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : ''
export const formatFechaCorta = (f) => f ? f.slice(8, 10) + '/' + f.slice(5, 7) : ''

const monedaSymbol = (moneda) => moneda === 'USD' ? 'U$S' : moneda === 'EUR' ? '€' : '$'

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
export function BubbleChart({ data, legendData, childRows, darkMode, tipoCambio, isMobile, extraConfig, subcatMap, defaultIcon = '❓' }) {
  const containerRef = useRef(null)
  const [bubbles, setBubbles] = useState([])
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, data: null })
  const [selectedBubble, setSelectedBubble] = useState(null)
  const WIDTH = 600
  const HEIGHT = 340
  const MIN_R = 32
  const MAX_R = 90

  useEffect(() => {
    if (!selectedBubble) return
    const onKey = (e) => { if (e.key === 'Escape') setSelectedBubble(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedBubble])

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
    setSelectedBubble(null)
  }, [data])

  // Compute radial sub-bubbles when a category is selected
  const subBubbles = (() => {
    if (!selectedBubble || !subcatMap?.[selectedBubble.name]) return []
    const subcats = subcatMap[selectedBubble.name].filter(s => s.value > 0)
    if (subcats.length === 0) return []
    const maxSub = Math.max(...subcats.map(s => s.value))
    const dist = isMobile ? 110 : 165
    return subcats.map((s, i) => {
      const angle = (2 * Math.PI * i / subcats.length) - Math.PI / 2
      const subR = Math.max(26, Math.min(52, 26 + (s.value / maxSub) * 32))
      const cx = selectedBubble.x + Math.cos(angle) * dist
      const cy = selectedBubble.y + Math.sin(angle) * dist
      return {
        ...s,
        r: subR,
        x: Math.max(subR + 6, Math.min(WIDTH - subR - 6, cx)),
        y: Math.max(subR + 6, Math.min(HEIGHT - subR - 6, cy)),
        pct: selectedBubble.value > 0 ? Math.round((s.value / selectedBubble.value) * 100) : 0,
      }
    })
  })()

  const parentCfg = selectedBubble
    ? ((extraConfig?.[selectedBubble.name]) || CATEGORY_CONFIG[selectedBubble.name] || { color: '#C4B8C4' })
    : { color: '#C4B8C4' }

  if (!data || data.length === 0) return null

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: 'flex-start', width: '100%' }}>
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <svg width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ display: 'block' }}>
          {/* Hilitos a subcategorías */}
          {subBubbles.map((sub, i) => (
            <line key={`line-${i}`}
              x1={selectedBubble.x} y1={selectedBubble.y}
              x2={sub.x} y2={sub.y}
              stroke={darkMode ? 'rgba(200,185,200,0.45)' : 'rgba(92,79,92,0.3)'}
              strokeWidth={1.5}
              strokeDasharray="5 3"
            />
          ))}

          {/* Burbujas principales — primero las no seleccionadas, la seleccionada al final (z-order SVG) */}
          {[...bubbles.filter(b => selectedBubble?.name !== b.name), ...bubbles.filter(b => selectedBubble?.name === b.name)].map((b) => {
            const cfg = (extraConfig?.[b.name]) || CATEGORY_CONFIG[b.name] || { icon: defaultIcon, color: '#E0E0E0' }
            const isSelected = selectedBubble?.name === b.name
            const globalIdx = bubbles.findIndex(x => x.name === b.name)
            const isHovered = hoveredIdx === globalIdx && !selectedBubble
            const isDimmed = selectedBubble && !isSelected
            const hasSubcats = subcatMap?.[b.name]?.length > 0
            const effectiveR = isSelected ? b.r + 14 : isHovered ? b.r + 4 : b.r
            const iconSize = effectiveR > 60 ? 30 : effectiveR > 45 ? 24 : effectiveR > 35 ? 18 : 14
            const pctSize = effectiveR > 60 ? 13 : effectiveR > 45 ? 11 : effectiveR > 35 ? 9 : 7
            const iconY = effectiveR > 30 ? b.y - effectiveR * 0.22 : b.y
            const pctY = effectiveR > 30 ? b.y + effectiveR * 0.28 : b.y + effectiveR * 0.5 + 8
            return (
              <g key={b.name}
                style={{ cursor: hasSubcats ? 'pointer' : 'default' }}
                onClick={() => {
                  if (!hasSubcats) return
                  setSelectedBubble(prev => prev?.name === b.name ? null : b)
                  setHoveredIdx(null)
                  setTooltip({ visible: false, x: 0, y: 0, data: null })
                }}
                onMouseEnter={() => {
                  if (selectedBubble) return
                  setHoveredIdx(globalIdx)
                  setTooltip({ visible: true, x: b.x, y: b.y - b.r - 8, data: b })
                }}
                onMouseLeave={() => {
                  setHoveredIdx(null)
                  setTooltip({ visible: false, x: 0, y: 0, data: null })
                }}
              >
                {isSelected && (
                  <circle cx={b.x} cy={b.y} r={effectiveR + 10}
                    fill="none"
                    stroke={darkMode ? 'rgba(220,205,220,0.5)' : 'rgba(92,79,92,0.3)'}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                  />
                )}
                <circle
                  cx={b.x} cy={b.y} r={effectiveR}
                  fill={cfg.color}
                  opacity={isDimmed ? 0 : 1}
                  style={{ transition: 'r 0.25s, opacity 0.3s' }}
                />
                <text x={b.x} y={iconY}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={iconSize}
                  opacity={isDimmed ? 0 : 1}
                  style={{ transition: 'opacity 0.3s' }}>
                  {cfg.icon}
                </text>
                <text x={b.x} y={pctY}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={pctSize} fill={darkMode ? '#ccc' : '#444'} fontWeight="700"
                  opacity={isDimmed ? 0 : 1}
                  style={{ transition: 'opacity 0.3s' }}>
                  {b.pct}%
                </text>
                {hasSubcats && !isSelected && !isDimmed && (
                  <circle cx={b.x} cy={b.y + b.r - 8} r={3}
                    fill={darkMode ? '#9A8A9A' : '#5C4F5C'} opacity={0.5} />
                )}
                {(b.originalUSD || 0) > 0 && b.r > 28 && !isDimmed && (
                  <text x={b.x} y={b.y + effectiveR - 10}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={7} fill="#5588aa" fontWeight="700" opacity={0.8}>
                    U$S
                  </text>
                )}
              </g>
            )
          })}

          {/* Sub-burbujas de subcategorías */}
          {subBubbles.map((sub, i) => {
            const hasRoom = sub.r > 32
            const nameY = hasRoom ? sub.y - 9 : sub.y - 4
            const pctY = hasRoom ? sub.y + 7 : sub.y + 9
            const shortName = sub.name.length > 12 ? sub.name.slice(0, 11) + '…' : sub.name
            return (
              <g key={`sub-${i}`} style={{ pointerEvents: 'none' }}>
                {/* Sombra */}
                <circle cx={sub.x + 2} cy={sub.y + 3} r={sub.r}
                  fill="rgba(0,0,0,0.18)" />
                {/* Círculo principal blanco/oscuro con borde de color */}
                <circle
                  cx={sub.x} cy={sub.y} r={sub.r}
                  fill={darkMode ? '#2C262C' : '#FAFAFA'}
                  stroke={parentCfg.color}
                  strokeWidth={2.5}
                />
                <text x={sub.x} y={nameY}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={sub.r > 38 ? 10 : 9}
                  fill={darkMode ? '#EEE8EE' : '#2d2d2d'}
                  fontWeight="700">
                  {shortName}
                </text>
                <text x={sub.x} y={pctY}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={sub.r > 38 ? 9 : 8}
                  fill={darkMode ? parentCfg.color : '#5C4F5C'}
                  fontWeight="600">
                  {sub.pct}%
                </text>
              </g>
            )
          })}

          {/* Tooltip (oculto en modo drill-down) */}
          {!selectedBubble && tooltip.visible && tooltip.data && (() => {
            const cfg = (extraConfig?.[tooltip.data.name]) || CATEGORY_CONFIG[tooltip.data.name] || { icon: defaultIcon, color: '#E0E0E0' }
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
                    U$S {formatMonto(tooltip.data.originalUSD)} ($ {formatMonto(Math.round(tooltip.data.originalUSD * (parseFloat(tipoCambio) || 0)))})
                  </text>
                )}
                {hasBoth && (
                  <text x={tx} y={ty + 26} textAnchor="middle" fontSize={10} fill="#5588aa">
                    +U$S {formatMonto(tooltip.data.originalUSD)} ($ {formatMonto(Math.round(tooltip.data.originalUSD * (parseFloat(tipoCambio) || 0)))})
                  </text>
                )}
              </g>
            )
          })()}

          {/* Hint para cerrar */}
          {selectedBubble && (
            <text x={WIDTH - 6} y={HEIGHT - 6}
              textAnchor="end" dominantBaseline="auto"
              fontSize={9} fill={darkMode ? '#6A5A6A' : '#bbb'}
              fontFamily='"Montserrat", sans-serif'>
              Tocá la burbuja para cerrar
            </text>
          )}
        </svg>
      </div>
      <div style={{ width: isMobile ? '100%' : '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: isMobile ? '0' : '16px' }}>
        {([...(legendData || bubbles)].sort((a, b) => b.value - a.value)).map((b, i) => {
          const cfg = (extraConfig?.[b.name]) || CATEGORY_CONFIG[b.name] || { icon: '❓', color: '#E0E0E0' }
          const arsAmt = (b.originalARS || 0)
          const usdAmt = (b.originalUSD || 0)
          const hasUSD = usdAmt > 0
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', alignItems: 'flex-start', gap: '6px', fontSize: '12px' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: cfg.color, flexShrink: 0, marginTop: '2px', outline: darkMode ? '1px solid rgba(255,255,255,0.2)' : 'none' }} />
              <span style={{ color: darkMode ? '#e0e0e0' : '#3a3a3c', lineHeight: '1.3' }}>{cfg.icon} {b.name}</span>
              <div style={{ textAlign: 'right' }}>
                {/* Solo-dólares: U$S como monto principal y la equivalencia en
                    pesos abajo — antes aparecía el mismo número dos veces
                    (convertido arriba y "+$" abajo). */}
                {arsAmt === 0 && hasUSD ? (
                  <>
                    <div style={{ fontWeight: '600', color: darkMode ? '#f5f5f7' : '#1d1d1f', whiteSpace: 'nowrap' }}>
                      U$S {formatMonto(usdAmt)}
                    </div>
                    {(parseFloat(tipoCambio) || 0) > 0 && (
                      <div style={{ fontSize: '10px', color: '#5588aa', whiteSpace: 'nowrap' }}>
                        ($ {formatMonto(Math.round(usdAmt * parseFloat(tipoCambio)))})
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: '600', color: darkMode ? '#f5f5f7' : '#1d1d1f', whiteSpace: 'nowrap' }}>
                      $ {formatMonto(arsAmt > 0 ? arsAmt : b.value)}
                    </div>
                    {hasUSD && (
                      <div style={{ fontSize: '10px', color: '#5588aa', whiteSpace: 'nowrap' }}>
                        +U$S {formatMonto(usdAmt)}{(parseFloat(tipoCambio) || 0) > 0 ? ` ($ ${formatMonto(Math.round(usdAmt * parseFloat(tipoCambio)))})` : ''}
                      </div>
                    )}
                  </>
                )}
                {(b.originalEUR || 0) > 0 && (
                  <div style={{ fontSize: '10px', color: '#7a88aa', whiteSpace: 'nowrap' }}>
                    +€ {formatMonto(b.originalEUR)}
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
                      +U$S {formatMonto(c.originalUSD)}{(parseFloat(tipoCambio) || 0) > 0 ? ` ($ ${formatMonto(Math.round(c.originalUSD * parseFloat(tipoCambio)))})` : ''}
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

export default function AccountDetail({ account, accounts, allAccounts, refreshKey, searchQuery, onSearchChange, tipoCambio, tipoCambioEUR, tcMap, tcMapEUR, darkMode, onPeriodChange, onTransactionsLoaded, onAddIngreso, customIcons, ingresoTags, ingresoTagsOcultos }) {
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
  const [editCuenta, setEditCuenta] = useState('')
  const [children, setChildren] = useState([])
  const [sortKey, setSortKey] = useState('fecha')
  const [sortDir, setSortDir] = useState('desc')
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

  // Notificar al padre cuando cambia el período seleccionado
  useEffect(() => { onPeriodChange?.(selectedMeses) }, [selectedMeses, onPeriodChange])
  useEffect(() => { onTransactionsLoaded?.(transactions) }, [transactions, onTransactionsLoaded])
  const [mesDropdownOpen, setMesDropdownOpen] = useState(false)
  const [stmtCollapsed, setStmtCollapsed] = useState(false)
  const [chartType, setChartType] = useState(() => localStorage.getItem('chart_type_ma') || 'bubble')
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
    const montoCorregido = tx.monto < 0 ? Math.abs(tx.monto) : undefined
    const cuentaObj = (accounts || []).find(a => a.id === editCuenta)
    const accountChange = editCuenta && editCuenta !== tx.account_id ? { account_id: editCuenta } : {}
    if (account?.tipo === 'ingreso' || tx.tipo === 'ingreso') {
      const upd = { nombre: editNombre, tag: editTag || null, estado: 'identificado', ...accountChange }
      if (montoCorregido !== undefined) upd.monto = montoCorregido
      const { error } = await supabase.from('transactions').update(upd).eq('id', tx.id)
      if (error) { window.alert('No se pudo guardar el cambio: ' + error.message + '\nProbá de nuevo.'); return }
      setTransactions(prev => prev.map(t => t.id === tx.id ? { ...t, nombre: editNombre, tag: editTag || null, estado: 'identificado', ...accountChange, ...(cuentaObj ? { accounts: { nombre: cuentaObj.nombre } } : {}), ...(montoCorregido !== undefined ? { monto: montoCorregido } : {}) } : t))
      setEditingTx(null)
      return
    }
    const catObj = categories.find(c => c.nombre === editCategoria)
    const subcatObj = subcategories.find(s => s.nombre === editSubcategoria && s.category_id === catObj?.id)

    // Actualizar la transacción — monto siempre positivo (el tipo determina el signo en pantalla)
    const { error: errUpd } = await supabase.from('transactions').update({
      nombre: editNombre,
      category_id: catObj ? catObj.id : tx.category_id,
      subcategory_id: subcatObj ? subcatObj.id : null,
      estado: 'identificado',
      tag: editTag || null,
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
  }

  // Vista de cuenta de ingresos: todas las txs son tipo ingreso
  const esVistaIngresos = !allAccounts && account?.tipo === 'ingreso'

  const barData = statements.map(s => ({
    mes: s.periodo || s.fecha_hasta?.slice(0, 7),
    total: Number(s.total_resumen) || 0
  }))

  const ingresosBarData = (() => {
    const byMonth = {}
    transactions.filter(t => t.tipo === 'ingreso' && t.moneda === 'ARS').forEach(t => {
      const m = t.fecha?.slice(0, 7)
      if (!m) return
      byMonth[m] = (byMonth[m] || 0) + Number(t.monto)
    })
    return Object.keys(byMonth).sort().map(m => ({ mes: mesLabel(m), total: byMonth[m] }))
  })()

  const mesTxs = selectedMeses.length > 0
    ? transactions.filter(t => selectedMeses.some(m => t.fecha?.startsWith(m)) && t.tipo !== 'neutro')
    : []

  const getTC = (mes) => {
    const mesActual = new Date().toISOString().slice(0, 7)
    if (mes === mesActual) return parseFloat(tipoCambio) || 1
    if (mes && tcMap && tcMap[mes]) return Number(tcMap[mes])
    return parseFloat(tipoCambio) || 1
  }

  // TC efectivo para el período seleccionado (usa el del primer mes seleccionado)
  const tcEfectivo = getTC(selectedMeses[0] || new Date().toISOString().slice(0, 7))
  const getTCEUR = (mes) => {
    const mesActual = new Date().toISOString().slice(0, 7)
    if (!mes || mes === mesActual) return parseFloat(tipoCambioEUR) || 0
    if (tcMapEUR?.[mes]) return Number(tcMapEUR[mes])
    return parseFloat(tipoCambioEUR) || 0
  }
  const tcEUR = getTCEUR(selectedMeses[0] || new Date().toISOString().slice(0, 7))

  const buildBubbleData = (txList, tc) => {
    const tcNum = parseFloat(tc) || 0
    return Object.values(
      txList.reduce((acc, t) => {
        const cat = t.categories?.nombre || 'A Identificar'
        const monto = Number(t.monto)
        const moneda = t.moneda || 'ARS'
        if (!acc[cat]) acc[cat] = { name: cat, value: 0, originalARS: 0, originalUSD: 0, originalEUR: 0 }
        if (moneda === 'USD') {
          acc[cat].originalUSD += monto
          if (tcNum > 0) acc[cat].value += monto * tcNum
        } else if (moneda === 'EUR') {
          acc[cat].originalEUR += monto
          if (tcEUR > 0) acc[cat].value += monto * tcEUR
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
  // Usa child_id (modelo nuevo) con fallback a tag (modelo viejo)
  const getChildName = (t) => t.children?.nombre || (t.child_id ? children.find(c => c.id === t.child_id)?.nombre : null) || (t.tag || null)
  const gastosConHijo = mesTxs.filter(t => t.tipo === 'gasto' && getChildName(t))
  const childNames = [...new Set(gastosConHijo.map(t => getChildName(t)))]
  const netBubbleData = childNames.length > 0
    ? buildBubbleData(mesTxs.filter(t => t.tipo === 'gasto' && !getChildName(t)), tcEfectivo)
    : null
  const childTotals = childNames.map(name => {
    const txs = mesTxs.filter(t => getChildName(t) === name && t.tipo === 'gasto')
    return {
      name,
      value: txs.reduce((s, t) => s + (t.moneda === 'USD' ? Number(t.monto) * tcEfectivo : t.moneda === 'EUR' ? Number(t.monto) * tcEUR : Number(t.monto)), 0),
      originalARS: txs.filter(t => t.moneda === 'ARS').reduce((s, t) => s + Number(t.monto), 0),
      originalUSD: txs.filter(t => t.moneda === 'USD').reduce((s, t) => s + Number(t.monto), 0),
      originalEUR: txs.filter(t => t.moneda === 'EUR').reduce((s, t) => s + Number(t.monto), 0),
    }
  }).sort((a, b) => b.value - a.value)

  // Modo "Persona": agrupa todo el gasto por persona (null child = "Personal")
  const personaBubbleData = Object.values(
    mesTxs.filter(t => t.tipo === 'gasto').reduce((acc, t) => {
      const persona = getChildName(t) || 'Personal'
      if (!acc[persona]) acc[persona] = { name: persona, value: 0, originalARS: 0, originalUSD: 0 }
      const monto = t.moneda === 'USD' ? Number(t.monto) * tcEfectivo : t.moneda === 'EUR' ? Number(t.monto) * tcEUR : Number(t.monto)
      acc[persona].value += monto
      if (t.moneda === 'ARS') acc[persona].originalARS += Number(t.monto)
      else acc[persona].originalUSD += Number(t.monto)
      return acc
    }, {})
  ).sort((a, b) => b.value - a.value)

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
          const monto = t.moneda === 'USD' ? Number(t.monto) * (parseFloat(tcEfectivo) || 0) : t.moneda === 'EUR' ? Number(t.monto) * tcEUR : Number(t.monto)
          if (!acc[cat]) acc[cat] = { name: cat, value: 0, originalARS: 0, originalUSD: 0, originalEUR: 0 }
          acc[cat].value += monto
          if (t.moneda === 'ARS') acc[cat].originalARS += Number(t.monto)
          else if (t.moneda === 'EUR') acc[cat].originalEUR += Number(t.monto)
          else acc[cat].originalUSD += Number(t.monto)
          return acc
        }, {})
      ).sort((a, b) => b.value - a.value)
    : []
  const chartData = esVistaIngresos ? ingresoBubbleData : bubbleGroupBy === 'persona' ? personaBubbleData : (netBubbleData || bubbleData)
  // Para donut y barras: incluye hijos como slices/barras separadas, ordenadas por monto
  const fullChartData = esVistaIngresos
    ? ingresoBubbleData
    : childTotals.length > 0
      ? [...(netBubbleData || bubbleData), ...childTotals].sort((a, b) => b.value - a.value)
      : (netBubbleData || bubbleData)
  const childExtraConfig = Object.fromEntries(
    childTotals.map((c, i) => [c.name, { icon: '👧', color: CHILDREN_PALETTE[i % CHILDREN_PALETTE.length] }])
  )
  const resolveIcon = (name) => {
    const child = children.find(c => c.nombre === name)
    return customIcons?.[name] || CATEGORY_CONFIG[name]?.icon || childExtraConfig[name]?.icon || child?.icono || (child ? '👧' : '❓')
  }
  const resolveColor = (name) => CATEGORY_CONFIG[name]?.color || childExtraConfig[name]?.color || '#E0E0E0'
  const getFullChartColor = (entry, idx) => esVistaIngresos ? INCOME_PALETTE[idx % INCOME_PALETTE.length] : resolveColor(entry.name)
  const mergedExtraConfig = {
    ...childExtraConfig,
    ...Object.fromEntries(Object.entries(customIcons || {}).map(([n, icon]) => [n, { ...(childExtraConfig[n] || CATEGORY_CONFIG[n] || { color: '#E0E0E0' }), icon }]))
  }
  const ingresoExtraConfig = Object.fromEntries(
    ingresoBubbleData.map((entry, i) => [
      entry.name,
      { icon: customIcons?.[entry.name] || CATEGORY_CONFIG[entry.name]?.icon || '💰', color: INCOME_PALETTE[i % INCOME_PALETTE.length] }
    ])
  )
  const effectiveChartType = chartType

  // Subcategory breakdown por categoría para drill-down en BubbleChart
  const subcatDataMap = bubbleGroupBy === 'categoria' && !esVistaIngresos
    ? (() => {
        const raw = {}
        mesTxs.filter(t => t.tipo === 'gasto').forEach(t => {
          const cat = t.categories?.nombre || 'A Identificar'
          const sub = t.subcategories?.nombre || 'General'
          const monto = t.moneda === 'USD' ? Number(t.monto) * tcEfectivo : t.moneda === 'EUR' ? Number(t.monto) * tcEUR : Number(t.monto)
          if (!raw[cat]) raw[cat] = {}
          raw[cat][sub] = (raw[cat][sub] || 0) + monto
        })
        return Object.fromEntries(
          Object.entries(raw).map(([cat, subs]) => [
            cat,
            Object.entries(subs).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
          ])
        )
      })()
    : {}

  const catTotals = mesTxs.filter(t => t.tipo === 'gasto').reduce((acc, t) => {
    const cat = t.categories?.nombre || 'A Identificar'
    const monto = t.moneda === 'USD' ? Number(t.monto) * tcEfectivo : t.moneda === 'EUR' ? Number(t.monto) * tcEUR : Number(t.monto)
    acc[cat] = (acc[cat] || 0) + monto
    return acc
  }, {})
  const catTopList = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 3)

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

  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const matchSearch = (t) => {
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
  }

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
    const ingresosCat = categories.find(c => c.nombre === 'Ingresos')
    const ingresosSubcats = ingresosCat ? subcategories.filter(s => s.category_id === ingresosCat.id).map(s => s.nombre) : []
    const existingTags = [...new Set(transactions.filter(t => t.tipo === 'ingreso' && t.tag).map(t => t.tag))]
    const ocultos = ingresoTagsOcultos || []
    const allOpts = [...new Set([...ingresosSubcats, ...existingTags, ...(ingresoTags || [])])].filter(t => !ocultos.includes(t)).sort()
    return { allOpts, valueIsCustom: editTag && !allOpts.includes(editTag) }
  }

  // Edición apilada para pantallas angostas: la fila en modo edición no entra
  // en la tabla (quedaban selects ocultos —subcategoría— y el botón de
  // confirmar recortado fuera de la pantalla), así que se reemplaza la fila
  // entera por una sola celda a lo ancho con el formulario completo.
  const renderEditStackMobile = (tx) => {
    const esIngresoTx = esVistaIngresos || tx.tipo === 'ingreso'
    const selStyle = { ...styles.editSelect, width: '100%', boxSizing: 'border-box' }
    return (
      <td colSpan={9} style={{ ...styles.td, backgroundColor: darkMode ? '#242024' : '#F7F5F8' }}>
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
    const { allOpts, valueIsCustom } = getIngresoTagOpts()
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

  const mostrarTabAPagar = allAccounts || account?.tipo === 'credito'
  const hoyISO = new Date().toISOString().slice(0, 10)
  const cuentasCreditoAPagar = mostrarTabAPagar
    ? (allAccounts ? (accounts || []).filter(a => a.tipo === 'credito') : (account?.tipo === 'credito' ? [account] : []))
    : []
  // Movimientos ya cargados (ej. por Excel) que todavía no pertenecen a ningún resumen
  // cerrado: se muestran como un "ciclo actual" para ver cuánto se debe antes de que
  // llegue el PDF del banco.
  const statementsSinResumen = cuentasCreditoAPagar.map(a => {
    const sueltas = transactions.filter(t => !t.statement_id && t.account_id === a.id && t.tipo !== 'neutro')
    if (sueltas.length === 0) return null
    const total = sueltas.reduce((sum, t) => sum + (t.tipo === 'ingreso' ? -Number(t.monto) : Number(t.monto)), 0)
    return { id: `sin-resumen-${a.id}`, account_id: a.id, periodo: null, fecha_vencimiento: null, fecha_hasta: null, total_resumen: total, _virtual: true }
  }).filter(Boolean)
  const statementsAPagar = mostrarTabAPagar
    ? [...statementsSinResumen, ...statements.filter(s => s.fecha_vencimiento && s.fecha_vencimiento >= hoyISO)]
        .sort((a, b) => {
          if (!a.fecha_vencimiento && !b.fecha_vencimiento) return 0
          if (!a.fecha_vencimiento) return -1
          if (!b.fecha_vencimiento) return 1
          return a.fecha_vencimiento.localeCompare(b.fecha_vencimiento)
        })
    : []
  const totalAPagarGeneral = statementsAPagar.reduce((sum, s) => sum + (Number(s.total_resumen) || 0), 0)
  const itemsPorStatement = (s) => {
    const items = transactions.filter(t => s._virtual
      ? (!t.statement_id && t.account_id === s.account_id && t.tipo !== 'neutro')
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
  const categoriasResumen = (items) => {
    const map = {}
    items.forEach(t => {
      const cat = t.categories?.nombre || 'A Identificar'
      map[cat] = (map[cat] || 0) + Number(t.monto)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }
  const handleApagarSort = (key) => {
    if (apagarSortKey === key) setApagarSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setApagarSortKey(key); setApagarSortDir(key === 'monto' ? 'desc' : 'asc') }
  }
  const apagarSortIcon = (key) => apagarSortKey !== key ? ' ↕' : (apagarSortDir === 'asc' ? ' ↑' : ' ↓')
  const mostrarMovimientos = vistaCuenta === 'movimientos' || !mostrarTabAPagar

  return (
    <div>
      {mostrarTabAPagar && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {[{ key: 'movimientos', label: '🫧 Movimientos' }, { key: 'apagar', label: '📌 A pagar' }].map(t => (
            <button key={t.key} onClick={() => setVistaCuenta(t.key)}
              style={{ padding: '7px 16px', borderRadius: '20px', border: `1.5px solid ${vistaCuenta === t.key ? (darkMode ? '#8C7B8C' : '#5C4F5C') : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: vistaCuenta === t.key ? (darkMode ? '#8C7B8C' : '#5C4F5C') : 'transparent', color: vistaCuenta === t.key ? 'white' : (darkMode ? '#9A8A9A' : '#6e6e73'), fontSize: '13px', fontWeight: '500', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif', outline: 'none', transition: 'all 0.15s' }}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {mostrarTabAPagar && vistaCuenta === 'apagar' && (
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            <h3 style={{ ...styles.chartTitle, margin: 0 }}>📌 A pagar{allAccounts ? ' — todas las tarjetas' : ''}</h3>
            {totalAPagarGeneral > 0 && (
              <p style={{ margin: 0, fontWeight: '600', fontSize: '18px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>Total: $ {formatMonto(totalAPagarGeneral)}</p>
            )}
          </div>
          {statementsAPagar.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: '14px' }}>No hay resúmenes con vencimiento próximo{allAccounts ? '' : ' para esta cuenta'}.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {statementsAPagar.map(s => {
                const items = itemsPorStatement(s)
                const fecha = s.fecha_vencimiento ? new Date(s.fecha_vencimiento + 'T00:00:00') : null
                const diasRestantes = fecha ? Math.ceil((fecha - new Date()) / (1000 * 60 * 60 * 24)) : null
                const nombreCuenta = allAccounts ? (accounts || []).find(a => a.id === s.account_id)?.nombre : null
                return (
                  <div key={s.id} style={{ backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, borderRadius: '14px', padding: '18px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: items.length > 0 ? '14px' : 0, flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: '500', fontSize: '15px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{nombreCuenta ? `💳 ${nombreCuenta} · ` : ''}{s._virtual ? 'Ciclo actual' : (s.periodo || mesLabel(s.fecha_hasta?.slice(0, 7) || ''))}</p>
                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6e6e73' }}>{s._virtual ? 'Todavía sin resumen cargado' : `Vence: ${s.fecha_vencimiento}`}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {s.total_resumen > 0 && <p style={{ margin: 0, fontWeight: '600', fontSize: '18px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>$ {formatMonto(s.total_resumen)}</p>}
                        {diasRestantes !== null && (
                          <p style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: '500', color: diasRestantes <= 3 ? '#e74c3c' : diasRestantes <= 7 ? '#e07b39' : '#4a9e7a' }}>
                            {diasRestantes === 0 ? '¡Vence hoy!' : diasRestantes === 1 ? 'Mañana' : `En ${diasRestantes} días`}
                          </p>
                        )}
                      </div>
                    </div>
                    {items.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                        {categoriasResumen(items).map(([cat, total]) => (
                          <span key={cat} style={{ backgroundColor: (resolveColor(cat) || '#E0E0E0'), color: '#3a3a3c', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap' }}>
                            {resolveIcon(cat)} {cat}: $ {formatMonto(total)}
                          </span>
                        ))}
                      </div>
                    )}
                    {items.length > 0 && (
                      <div
                        onClick={() => toggleDetalleAPagar(s.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginBottom: detalleAbierto.has(s.id) ? '10px' : 0 }}>
                        <span style={{ fontSize: '12px', fontWeight: '500', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>
                          {detalleAbierto.has(s.id) ? '▾' : '▸'} Detalle ({items.length})
                        </span>
                      </div>
                    )}
                    {items.length > 0 && detalleAbierto.has(s.id) && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={styles.table}>
                          <thead>
                            <tr>
                              <th style={styles.thSortable} onClick={() => handleApagarSort('nombre')}>Nombre{apagarSortIcon('nombre')}</th>
                              <th style={styles.thSortable} onClick={() => handleApagarSort('categoria')}>Categoría{apagarSortIcon('categoria')}</th>
                              <th style={styles.thSortable} onClick={() => handleApagarSort('subcategoria')}>Subcategoría{apagarSortIcon('subcategoria')}</th>
                              <th style={{ ...styles.thSortable, textAlign: 'right' }} onClick={() => handleApagarSort('monto')}>Monto{apagarSortIcon('monto')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map(tx => (
                              <tr key={tx.id} style={styles.tr}>
                                <td style={styles.td}>{tx.nombre || tx.detalle}</td>
                                <td style={styles.td}>
                                  <span style={{ backgroundColor: (resolveColor(tx.categories?.nombre) || '#E0E0E0'), color: '#3a3a3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500' }}>
                                    {resolveIcon(tx.categories?.nombre || '')} {tx.categories?.nombre || '—'}
                                  </span>
                                </td>
                                <td style={styles.td}>
                                  <span style={{ fontSize: '12px', color: '#888' }}>{tx.subcategories?.nombre || '—'}</span>
                                </td>
                                <td style={{ ...styles.td, textAlign: 'right', fontWeight: '600' }}>
                                  {tx.tipo === 'ingreso' ? '+' : '-'}{monedaSymbol(tx.moneda)} {formatMontoFull(tx.monto)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
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
        const ingresosEquivARS = totalIngresosARS + totalIngresosUSD * tcEfectivo + totalIngresosEUR * tcEUR
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

      {esVistaIngresos && ingresosBarData.length > 0 && (
        <div style={styles.chartSection}>
          <h3 style={styles.chartTitle}>📊 Total por mes</h3>
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
                {[{ type: 'bubble', label: '◉ Burbujas' }, { type: 'donut', label: '◎ Donut' }, { type: 'bars', label: '▤ Barras' }].map(opt => (
                  <button key={opt.type}
                    onClick={() => { setChartType(opt.type); localStorage.setItem('chart_type_ma', opt.type) }}
                    style={{ padding: '4px 11px', borderRadius: '8px', border: `1px solid ${effectiveChartType === opt.type ? (darkMode ? '#8C7B8C' : '#5C4F5C') : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: effectiveChartType === opt.type ? (darkMode ? '#8C7B8C' : '#5C4F5C') : 'transparent', color: effectiveChartType === opt.type ? 'white' : (darkMode ? '#9A8A9A' : '#6e6e73'), cursor: 'pointer', fontSize: '12px', fontFamily: '"Montserrat", sans-serif', outline: 'none', transition: 'all 0.15s' }}>
                    {opt.label}
                  </button>
                ))}
              </div>

              {effectiveChartType === 'bubble' && (
                <>
                  {!esVistaIngresos && childNames.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                      <span style={{ fontSize: '11px', color: darkMode ? '#9A8A9A' : '#8e8e93', alignSelf: 'center', marginRight: '2px' }}>Agrupar:</span>
                      {[{ key: 'categoria', label: 'Categoría' }, { key: 'persona', label: 'Persona' }].map(({ key, label }) => (
                        <button key={key} onClick={() => setBubbleGroupBy(key)} style={{ padding: '4px 12px', borderRadius: '20px', border: `1px solid ${bubbleGroupBy === key ? '#5C4F5C' : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: bubbleGroupBy === key ? '#5C4F5C' : 'transparent', color: bubbleGroupBy === key ? '#fff' : (darkMode ? '#9A8A9A' : '#6e6e73'), fontSize: '11px', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif', fontWeight: bubbleGroupBy === key ? '600' : '400', outline: 'none' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <BubbleChart data={bubbleGroupBy === 'persona' && !esVistaIngresos ? personaBubbleData : fullChartData} legendData={null} childRows={undefined} extraConfig={esVistaIngresos ? ingresoExtraConfig : bubbleGroupBy === 'persona' ? { Personal: { icon: '👤', color: '#9A8A9A' }, ...mergedExtraConfig } : (Object.keys(mergedExtraConfig).length > 0 ? mergedExtraConfig : undefined)} darkMode={darkMode} tipoCambio={tcEfectivo} isMobile={isMobile} subcatMap={subcatDataMap} defaultIcon={esVistaIngresos ? '💰' : '❓'} />
                </>
              )}

              {/* Donut */}
              {effectiveChartType === 'donut' && (
                <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '24px', alignItems: isMobile ? 'center' : 'flex-start' }}>
                  <ResponsiveContainer width={isMobile ? '100%' : 260} height={isMobile ? 220 : 240}>
                    <PieChart>
                      <Pie data={fullChartData} cx="50%" cy="50%" innerRadius={isMobile ? 58 : 68} outerRadius={isMobile ? 90 : 108} dataKey="value" paddingAngle={2}>
                        {fullChartData.map((entry, idx) => (
                          <Cell key={idx} fill={getFullChartColor(entry, idx)} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v, name) => [`$ ${formatMonto(v)}`, name]} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px', paddingTop: isMobile ? '4px' : '20px' }}>
                    {fullChartData.map((entry, idx) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                        <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: getFullChartColor(entry, idx), flexShrink: 0 }} />
                        <span style={{ color: darkMode ? '#e0e0e0' : '#3a3a3c' }}>{esVistaIngresos ? '' : resolveIcon(entry.name)} {entry.name}</span>
                        <span style={{ fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', textAlign: 'right' }}>$ {formatMonto(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Barras horizontales */}
              {effectiveChartType === 'bars' && (() => {
                const rowH = 36
                const chartH = Math.max(180, fullChartData.length * rowH + 24)
                return (
                  <ResponsiveContainer width="100%" height={chartH}>
                    <BarChart data={fullChartData} layout="vertical" margin={{ top: 4, right: 48, left: 8, bottom: 4 }}>
                      <XAxis type="number" tickFormatter={v => `$${formatMonto(v)}`} tick={{ fontSize: 10, fill: darkMode ? '#9A8A9A' : '#6e6e73', fontFamily: '"Montserrat", sans-serif' }} />
                      <YAxis type="category" dataKey="name" width={isMobile ? 80 : 110} tick={{ fontSize: isMobile ? 10 : 12, fill: darkMode ? '#F0EDEC' : '#3a3a3c', fontFamily: '"Montserrat", sans-serif' }} />
                      <Tooltip formatter={(v) => [`$ ${formatMonto(v)}`, 'Total']} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: darkMode ? '#1C1A1C' : '#F0EDEC', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '12px' }} labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} itemStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f' }} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {fullChartData.map((entry, idx) => (
                          <Cell key={idx} fill={getFullChartColor(entry, idx)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )
              })()}
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
          <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Fecha</th>
                <th style={{...styles.th, display: isMobile ? 'none' : undefined}}>Detalle original</th>
                <th style={{...styles.th, display: isMobile ? 'none' : undefined}}>Cuenta</th>
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
                  {editingTx === tx.id && isMobile ? renderEditStackMobile(tx) : (<>
                  <td style={styles.td}>{formatFecha(tx.fecha)}</td>
                  <td style={{...styles.td, display: isMobile ? 'none' : undefined}}><span style={styles.detalle}>{tx.detalle}</span></td>
                  <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                    {editingTx === tx.id ? (
                      <select style={styles.editSelect} value={editCuenta} onChange={e => setEditCuenta(e.target.value)}>
                        {(accounts || []).filter(a => tx.tipo === 'ingreso' || a.tipo !== 'ingreso').map(a => (
                          <option key={a.id} value={a.id}>{a.nombre}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{fontSize:'12px', color:'#888'}}>{tx.accounts?.nombre || '—'}</span>
                    )}
                  </td>
                  {editingTx === tx.id ? (tx.tipo === 'ingreso' ? renderEditCellsIngreso() : renderEditCells()) : (
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
                      <div style={{display:'flex', gap:'4px', flexWrap:'wrap'}}>
                        <button style={styles.editBtn} onClick={() => startEdit(tx)} title="Editar">✏️</button>
                        <button style={{...styles.editBtn, color:'#6e6e73'}} onClick={() => handleMarcarNeutro(tx)} title="Marcar como neutro (pago, transferencia, etc.)">🔄</button>
                        <button style={{...styles.editBtn, color:'#c0392b'}} onClick={() => handleDeleteTx(tx)} title="Eliminar">🗑️</button>
                      </div>
                    </td>
                  )}
                  </>)}
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
              {thSortable('Cuenta', 'cuenta', isMobile)}
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
                {editingTx === tx.id && isMobile ? renderEditStackMobile(tx) : (<>
                <td style={{...styles.td, whiteSpace: 'nowrap'}}>
                  {isMobile ? formatFechaCorta(tx.fecha) : formatFecha(tx.fecha)}
                </td>
                <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                  {editingTx === tx.id ? (
                    <select style={styles.editSelect} value={editCuenta} onChange={e => setEditCuenta(e.target.value)}>
                      {(accounts || []).filter(a => tx.tipo === 'ingreso' || a.tipo !== 'ingreso').map(a => (
                        <option key={a.id} value={a.id}>{a.nombre}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{fontSize:'12px', color:'#888'}}>{tx.accounts?.nombre || '—'}</span>
                  )}
                </td>
                {editingTx === tx.id ? ((esVistaIngresos || tx.tipo === 'ingreso') ? renderEditCellsIngreso() : renderEditCells()) : (
                  <>
                    <td style={{...styles.td, overflow: isMobile ? 'hidden' : undefined, textOverflow: isMobile ? 'ellipsis' : undefined, whiteSpace: isMobile ? 'nowrap' : undefined}}>
                      <div style={isMobile ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}}>
                        {tx.nombre || tx.detalle}
                      </div>
                      {(tx.children?.nombre || tx.tag) && !isMobile && !esVistaIngresos && tx.tipo !== 'ingreso' && (
                        <span style={{ fontSize: '11px', color: '#8C7B8C', backgroundColor: darkMode ? '#2A272A' : '#F0EDEC', padding: '1px 7px', borderRadius: '8px', display: 'inline-block', marginTop: '3px' }}>
                          👧 {tx.children?.nombre || tx.tag}
                        </span>
                      )}
                    </td>
                    <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                      {(esVistaIngresos || tx.tipo === 'ingreso') ? (
                        <span style={{ backgroundColor: darkMode ? '#3A2F4A' : '#EDE8F4', color: darkMode ? '#C8B4E8' : '#5C4F5C', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap' }}>
                          {tx.tag || '—'}
                        </span>
                      ) : (
                        <span style={{ backgroundColor: (resolveColor(tx.categories?.nombre) || '#E0E0E0'), color: '#3a3a3c', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '500' }}>
                          {resolveIcon(tx.categories?.nombre || '')} {tx.categories?.nombre || '—'}
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
                </>)}
              </tr>
            ))}
          </tbody>
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
            <div style={{ marginTop: '10px', overflowX: 'auto' }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Fecha</th>
                    <th style={styles.th}>Nombre</th>
                    <th style={{...styles.th, display: isMobile ? 'none' : undefined}}>Categoría</th>
                    <th style={{...styles.th, display: isMobile ? 'none' : undefined}}>Subcategoría</th>
                    <th style={{...styles.th, display: isMobile ? 'none' : undefined}}>Cuenta</th>
                    <th style={styles.th}>Monto</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {txNeutras.map(tx => (
                    <tr key={tx.id} style={{...styles.tr, opacity: editingTx === tx.id ? 1 : 0.6}}>
                      {editingTx === tx.id && isMobile ? renderEditStackMobile(tx) : (<>
                      <td style={{...styles.td, whiteSpace:'nowrap'}}>{formatFechaCorta(tx.fecha)}</td>
                      {editingTx === tx.id ? renderEditCells() : (
                        <>
                          <td style={styles.td}>{tx.nombre || tx.detalle}</td>
                          <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                            <span style={{fontSize:'12px', color:'#888'}}>{tx.categories?.nombre || '—'}</span>
                          </td>
                          <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                            <span style={{fontSize:'12px', color:'#888'}}>{tx.subcategories?.nombre || '—'}</span>
                          </td>
                        </>
                      )}
                      <td style={{...styles.td, display: isMobile ? 'none' : undefined}}>
                        {editingTx === tx.id ? (
                          <select style={styles.editSelect} value={editCuenta} onChange={e => setEditCuenta(e.target.value)}>
                            {(accounts || []).filter(a => tx.tipo === 'ingreso' || a.tipo !== 'ingreso').map(a => (
                              <option key={a.id} value={a.id}>{a.nombre}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{fontSize:'12px', color:'#888'}}>{tx.accounts?.nombre || '—'}</span>
                        )}
                      </td>
                      <td style={{...styles.td, textAlign:'right', color: darkMode ? '#6A5A6A' : '#9e9e9e'}}>
                        {tx.moneda === 'USD' ? 'U$S' : '$'} {formatMontoFull(tx.monto)}
                      </td>
                      {editingTx === tx.id ? renderEditActions(tx) : (
                        <td style={styles.td}>
                          <div style={{display:'flex', gap:'4px'}}>
                            <button style={styles.editBtn} onClick={() => startEdit(tx)} title="Editar">✏️</button>
                            <button style={{...styles.editBtn, color: '#c0392b'}} onClick={() => handleDeleteTx(tx)} title="Eliminar">🗑️</button>
                          </div>
                        </td>
                      )}
                      </>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      </>)}
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
    editSelect: { width: '100%', padding: '4px 28px 4px 8px', borderRadius: '6px', border: `1px solid ${p}`, fontSize: '13px', outline: 'none', backgroundColor: dark ? '#1C1A1C' : 'white', color: txt, appearance: 'none', WebkitAppearance: 'none', colorScheme: dark ? 'dark' : 'light' },
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