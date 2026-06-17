import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

// Paleta fría y armónica — pega con #6B7BB8
const CATEGORY_COLORS = {
  'Comida':          '#3D8B6E',  // verde pizarra oscuro
  'Personal':        '#E07B39',  // terracota sobrio (no naranja neón)
  'Transporte':      '#5B8DB8',  // azul acero
  'Salud':           '#B85B5B',  // rojo apagado
  'Entretenimiento': '#7B5EA7',  // violeta medio
  'Suscripciones':   '#3A9BAF',  // petróleo/cian oscuro
  'Ropa':            '#A0527A',  // rosa vino
  'Casa':            '#4A7FB5',  // azul clásico
  'Educación':       '#5C7A6B',  // verde musgo
  'Trabajo':         '#5A6E7F',  // gris azulado
  'Ingresos':        '#2E8B6A',  // verde esmeralda
  'Débitos':         '#8A9BAD',  // gris azulado claro
  'A Identificar':   '#A0576A',  // rosa grisáceo
}

// Color para las barras del gráfico mes a mes
const BAR_COLOR = '#6B7BB8'

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
  const [selectedMes, setSelectedMes] = useState(null)

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
      setSelectedMes(meses[0])
    }
    setLoading(false)
  }

  const mesesDisponibles = [...new Set(transactions.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()

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

  const mesTxs = selectedMes
    ? transactions.filter(t => t.fecha?.startsWith(selectedMes) && t.tipo === 'gasto')
    : []

  const mesARS = mesTxs.filter(t => t.moneda === 'ARS')
  const mesUSD = mesTxs.filter(t => t.moneda === 'USD')

  const buildDonutData = (txList) => Object.entries(
    txList.reduce((acc, t) => {
      const cat = t.categories?.nombre || 'A Identificar'
      acc[cat] = (acc[cat] || 0) + Number(t.monto)
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  const donutARS = buildDonutData(mesARS)
  const donutUSD = buildDonutData(mesUSD)

  const sinIdentificar = transactions.filter(t => t.estado === 'a_identificar' || t.categories?.nombre === 'A Identificar')
  const identificadas = sortTx(transactions.filter(t => t.estado !== 'a_identificar' && t.categories?.nombre !== 'A Identificar'))

  const renderDonut = (data, moneda) => (
    <div style={styles.donutBlock}>
      <h4 style={styles.donutSubtitle}>{moneda === 'ARS' ? 'Pesos ARS' : 'Dólares USD'}</h4>
      <div style={styles.donutContainer}>
        <ResponsiveContainer width="50%" height={200}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
              dataKey="value" paddingAngle={2}>
              {data.map((entry, i) => (
                <Cell key={i} fill={CATEGORY_COLORS[entry.name] || '#8A9BAD'} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `${monedaSymbol(moneda)} ${formatMontoFull(v)}`} />
          </PieChart>
        </ResponsiveContainer>
        <div style={styles.donutLegend}>
          {data.map((entry, i) => (
            <div key={i} style={styles.legendItem}>
              <div style={{...styles.legendDot, backgroundColor: CATEGORY_COLORS[entry.name] || '#8A9BAD'}} />
              <span style={styles.legendName}>{entry.name}</span>
              <span style={styles.legendValue}>{monedaSymbol(moneda)} {formatMonto(entry.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

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
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#888' }} />
              <YAxis tick={{ fontSize: 11, fill: '#888' }} tickFormatter={v => `$${formatMonto(v)}`} width={80} />
              <Tooltip formatter={(v) => [`$${formatMontoFull(v)}`, 'Total']} />
              <Bar dataKey="total" fill={BAR_COLOR} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {mesesDisponibles.length > 0 && (
        <div style={styles.chartSection}>
          <div style={styles.donutHeader}>
            <h3 style={{...styles.chartTitle, margin: 0}}>🍩 Gastos de:</h3>
            <select style={styles.mesSelector} value={selectedMes || ''} onChange={e => setSelectedMes(e.target.value)}>
              {mesesDisponibles.map(m => (
                <option key={m} value={m}>{mesLabel(m)}</option>
              ))}
            </select>
          </div>
          {donutARS.length > 0 && renderDonut(donutARS, 'ARS')}
          {donutUSD.length > 0 && renderDonut(donutUSD, 'USD')}
          {donutARS.length === 0 && donutUSD.length === 0 && (
            <p style={{color:'#aaa', fontSize:'14px'}}>Sin gastos en este mes.</p>
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
                        backgroundColor: (CATEGORY_COLORS[tx.categories?.nombre] || '#8A9BAD') + '22',
                        color: CATEGORY_COLORS[tx.categories?.nombre] || '#666',
                        padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600'
                      }}>
                        {tx.categories?.nombre || '—'}
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
                    color: tx.moneda === 'USD' ? '#2980b9' : '#666',
                    backgroundColor: tx.moneda === 'USD' ? '#ebf5fb' : '#f0f2f8',
                    padding: '2px 6px', borderRadius: '8px'
                  }}>
                    {tx.moneda || 'ARS'}
                  </span>
                </td>
                <td style={{...styles.td, textAlign:'right', fontWeight:'600', whiteSpace:'nowrap',
                  color: tx.tipo === 'ingreso' ? '#2E8B6A' : '#2d2d2d'}}>
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
  loading: { padding: '24px', color: '#888', fontSize: '14px' },
  chartSection: { marginBottom: '32px' },
  chartTitle: { fontSize: '16px', fontWeight: '700', color: '#2d2d2d', margin: '0 0 16px 0' },
  donutHeader: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' },
  mesSelector: {
    padding: '6px 12px', borderRadius: '8px', border: '1px solid #d0d5ee',
    fontSize: '14px', color: '#2d2d2d', backgroundColor: 'white', cursor: 'pointer', outline: 'none'
  },
  donutBlock: { marginBottom: '24px' },
  donutSubtitle: { fontSize: '14px', fontWeight: '600', color: '#555', margin: '0 0 12px 0' },
  donutContainer: { display: 'flex', alignItems: 'center', gap: '16px' },
  donutLegend: { flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' },
  legendItem: { display: 'flex', alignItems: 'center', gap: '8px' },
  legendDot: { width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0 },
  legendName: { fontSize: '13px', color: '#444', flex: 1 },
  legendValue: { fontSize: '13px', fontWeight: '600', color: '#2d2d2d' },
  tableSection: { marginBottom: '32px' },
  tableHint: { fontSize: '13px', color: '#888', margin: '-8px 0 12px 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: {
    textAlign: 'left', padding: '10px 12px', fontSize: '11px',
    color: '#888', textTransform: 'uppercase', borderBottom: '2px solid #eef0f8', fontWeight: '600'
  },
  thSortable: {
    textAlign: 'left', padding: '10px 12px', fontSize: '11px',
    color: '#888', textTransform: 'uppercase', borderBottom: '2px solid #eef0f8', fontWeight: '600',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap'
  },
  sortIcon: { fontSize: '10px', color: '#bbb' },
  td: { padding: '10px 12px', borderBottom: '1px solid #f0f2f8', verticalAlign: 'middle' },
  tr: { transition: 'background 0.1s' },
  trUnknown: { backgroundColor: '#fffbf0' },
  detalle: { fontSize: '12px', color: '#aaa', fontFamily: 'monospace' },
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
    padding: '3px 8px', backgroundColor: '#2E8B6A', color: 'white',
    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px'
  },
  cancelEditBtn: {
    padding: '3px 8px', backgroundColor: '#e0e0e0', color: '#444',
    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px'
  },
}