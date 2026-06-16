import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const CATEGORY_COLORS = {
  'Alimentación': '#7ED321',
  'Transporte': '#F5A623',
  'Salud': '#D0021B',
  'Entretenimiento': '#FF5722',
  'Suscripciones': '#00BCD4',
  'Ropa': '#E91E63',
  'Casa': '#4A90D9',
  'Educación': '#9B59B6',
  'Trabajo': '#607D8B',
  'Ingresos': '#27AE60',
  'Débitos': '#95A5A6',
  'A Identificar': '#E74C3C',
}

const formatMonto = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(monto)

const formatMontoFull = (monto) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)

export default function AccountDetail({ account }) {
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

  useEffect(() => {
    if (account) fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

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
    setTransactions(txRes.data || [])
    setCategories(catRes.data || [])
    setSubcategories(subcatRes.data || [])
    setStatements(stmtRes.data || [])
    setLoading(false)
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
    setEditingTx(null)
    fetchData()
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
      if (sortKey === 'fecha') {
        valA = a.fecha; valB = b.fecha
      } else if (sortKey === 'nombre') {
        valA = (a.nombre || a.detalle || '').toLowerCase()
        valB = (b.nombre || b.detalle || '').toLowerCase()
      } else if (sortKey === 'categoria') {
        valA = (a.categories?.nombre || '').toLowerCase()
        valB = (b.categories?.nombre || '').toLowerCase()
      } else if (sortKey === 'subcategoria') {
        valA = (a.subcategories?.nombre || '').toLowerCase()
        valB = (b.subcategories?.nombre || '').toLowerCase()
      } else if (sortKey === 'monto') {
        valA = Number(a.monto); valB = Number(b.monto)
      } else if (sortKey === 'cuotas') {
        valA = a.cuotas_total || 1; valB = b.cuotas_total || 1
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }

  const barData = statements.map(s => ({
    mes: s.periodo || s.fecha_hasta?.slice(0, 7),
    total: Number(s.total_resumen) || 0
  }))

  const lastStatement = statements[statements.length - 1]
  const lastMonthTxs = lastStatement
    ? transactions.filter(t => t.statement_id === lastStatement.id && t.tipo === 'gasto')
    : []

  const donutData = Object.entries(
    lastMonthTxs.reduce((acc, t) => {
      const cat = t.categories?.nombre || 'A Identificar'
      acc[cat] = (acc[cat] || 0) + Number(t.monto)
      return acc
    }, {})
  ).map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  const sinIdentificar = transactions.filter(t => t.estado === 'a_identificar' || t.categories?.nombre === 'A Identificar')
  const identificadas = sortTx(transactions.filter(t => t.estado !== 'a_identificar' && t.categories?.nombre !== 'A Identificar'))

  const renderEditCells = (tx) => (
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
              <Bar dataKey="total" fill="#9B59B6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {donutData.length > 0 && (
        <div style={styles.chartSection}>
          <h3 style={styles.chartTitle}>🍩 Gastos del último mes por categoría</h3>
          <div style={styles.donutContainer}>
            <ResponsiveContainer width="50%" height={220}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                  dataKey="value" paddingAngle={2}>
                  {donutData.map((entry, i) => (
                    <Cell key={i} fill={CATEGORY_COLORS[entry.name] || '#ccc'} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `$${formatMontoFull(v)}`} />
              </PieChart>
            </ResponsiveContainer>
            <div style={styles.donutLegend}>
              {donutData.map((entry, i) => (
                <div key={i} style={styles.legendItem}>
                  <div style={{...styles.legendDot, backgroundColor: CATEGORY_COLORS[entry.name] || '#ccc'}} />
                  <span style={styles.legendName}>{entry.name}</span>
                  <span style={styles.legendValue}>${formatMonto(entry.value)}</span>
                </div>
              ))}
            </div>
          </div>
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
                  {editingTx === tx.id ? renderEditCells(tx) : (
                    <>
                      <td style={styles.td}><span style={{color:'#aaa'}}>—</span></td>
                      <td style={styles.td}><span style={{color:'#aaa'}}>—</span></td>
                      <td style={styles.td}><span style={{color:'#aaa'}}>—</span></td>
                    </>
                  )}
                  <td style={{...styles.td, textAlign:'right', fontWeight:'600'}}>
                    ${formatMontoFull(tx.monto)}
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
              {thSortable('Monto', 'monto')}
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {identificadas.map(tx => (
              <tr key={tx.id} style={styles.tr}>
                <td style={styles.td}>{tx.fecha}</td>
                {editingTx === tx.id ? renderEditCells(tx) : (
                  <>
                    <td style={styles.td}>{tx.nombre || tx.detalle}</td>
                    <td style={styles.td}>
                      <span style={{
                        backgroundColor: (CATEGORY_COLORS[tx.categories?.nombre] || '#ccc') + '22',
                        color: CATEGORY_COLORS[tx.categories?.nombre] || '#888',
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
                <td style={{...styles.td, textAlign:'right', fontWeight:'600',
                  color: tx.tipo === 'ingreso' ? '#27AE60' : '#2d2d2d'}}>
                  {tx.tipo === 'ingreso' ? '+' : '-'}${formatMontoFull(tx.monto)}
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
    color: '#888', textTransform: 'uppercase', borderBottom: '2px solid #f0f0f0', fontWeight: '600'
  },
  thSortable: {
    textAlign: 'left', padding: '10px 12px', fontSize: '11px',
    color: '#888', textTransform: 'uppercase', borderBottom: '2px solid #f0f0f0', fontWeight: '600',
    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap'
  },
  sortIcon: { fontSize: '10px', color: '#bbb' },
  td: { padding: '10px 12px', borderBottom: '1px solid #f8f6f3', verticalAlign: 'middle' },
  tr: { transition: 'background 0.1s' },
  trUnknown: { backgroundColor: '#fffbf0' },
  detalle: { fontSize: '12px', color: '#aaa', fontFamily: 'monospace' },
  editInput: {
    width: '100%', padding: '4px 8px', borderRadius: '6px',
    border: '1px solid #9B59B6', fontSize: '13px', outline: 'none'
  },
  editSelect: {
    width: '100%', padding: '4px 8px', borderRadius: '6px',
    border: '1px solid #9B59B6', fontSize: '13px', outline: 'none', backgroundColor: 'white'
  },
  editBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', opacity: 0.6 },
  saveEditBtn: {
    padding: '3px 8px', backgroundColor: '#27AE60', color: 'white',
    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px'
  },
  cancelEditBtn: {
    padding: '3px 8px', backgroundColor: '#e0e0e0', color: '#444',
    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px'
  },
}