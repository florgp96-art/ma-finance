import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { BubbleChart, CATEGORY_CONFIG, mesLabel, formatMonto, formatMontoFull } from './AccountDetail'

const getLast6Months = () => {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

export default function HijoDetail({ hijoNombre, darkMode, tipoCambio, refreshKey }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMeses, setSelectedMeses] = useState([])

  useEffect(() => {
    setLoading(true)
    setTransactions([])
    setSelectedMeses([])
    fetchTransactions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hijoNombre, refreshKey])

  const fetchTransactions = async () => {
    const { data } = await supabase
      .from('transactions')
      .select('*, categories(nombre, color), subcategories(nombre), accounts(nombre)')
      .eq('tag', hijoNombre)
      .gt('monto', 0)
      .order('fecha', { ascending: false })
    const txs = data || []
    setTransactions(txs)
    if (txs.length > 0) {
      const meses = [...new Set(txs.map(t => t.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse()
      setSelectedMeses([meses[0]])
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

  const totalARS = filteredTx.filter(t => t.moneda === 'ARS').reduce((s, t) => s + t.monto, 0)
  const totalUSD = filteredTx.filter(t => t.moneda === 'USD').reduce((s, t) => s + t.monto, 0)

  // Bubble chart data
  const catMap = {}
  filteredTx.forEach(t => {
    const cat = t.categories?.nombre || 'A Identificar'
    if (!catMap[cat]) catMap[cat] = { value: 0, originalARS: 0, originalUSD: 0 }
    catMap[cat].value += t.moneda === 'USD' ? t.monto * tc : t.monto
    if (t.moneda === 'ARS') catMap[cat].originalARS += t.monto
    else catMap[cat].originalUSD += t.monto
  })
  const bubbleData = Object.entries(catMap)
    .map(([name, val]) => ({ name, ...val }))
    .sort((a, b) => b.value - a.value)

  // Monthly evolution
  const last6 = getLast6Months()
  const monthlyData = last6.map(ym => {
    const txs = transactions.filter(t => t.fecha?.startsWith(ym))
    const ars = txs.filter(t => t.moneda === 'ARS').reduce((s, t) => s + t.monto, 0)
    const usd = txs.filter(t => t.moneda === 'USD').reduce((s, t) => s + t.monto, 0)
    return { mes: mesLabel(ym), total: Math.round(ars + usd * tc) }
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
        Los gastos con el tag "{hijoNombre}" aparecerán acá.
      </p>
    </div>
  )

  return (
    <div>
      {/* Selector de meses */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {mesesDisponibles.map(m => (
          <button key={m} onClick={() => toggleMes(m)} style={{
            padding: '5px 14px', borderRadius: '20px',
            border: `1.5px solid ${selectedMeses.includes(m) ? '#5C4F5C' : (darkMode ? '#3A333A' : '#EDE8EC')}`,
            backgroundColor: selectedMeses.includes(m) ? '#5C4F5C' : (darkMode ? '#2A272A' : 'white'),
            color: selectedMeses.includes(m) ? 'white' : (darkMode ? '#C0B8C0' : '#3a3a3c'),
            fontSize: '12px', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif',
            outline: 'none', transition: 'all 0.15s'
          }}>
            {mesLabel(m)}
          </button>
        ))}
        {selectedMeses.length > 0 && (
          <button onClick={() => setSelectedMeses([])} style={{
            padding: '5px 10px', borderRadius: '20px',
            border: `1px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`,
            background: 'none', color: '#6e6e73', fontSize: '12px',
            cursor: 'pointer', outline: 'none', fontFamily: '"Montserrat", sans-serif'
          }}>
            × Todos
          </button>
        )}
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
        {totalARS > 0 && totalUSD > 0 && tc > 1 && (
          <div style={s.statCard}>
            <p style={s.statLabel}>Total equiv. ARS</p>
            <p style={s.statValue}>$ {formatMonto(totalARS + totalUSD * tc)}</p>
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  {['Fecha', 'Descripción', 'Categoría', 'Subcategoría', 'Monto'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '8px 10px',
                      borderBottom: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`,
                      color: '#6e6e73', fontWeight: '400', fontSize: '11px',
                      textTransform: 'uppercase', letterSpacing: '0.04em'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTx.map((t, i) => (
                  <tr key={t.id || i} style={{ borderBottom: `1px solid ${darkMode ? '#3A333A' : '#f0f2f8'}` }}>
                    <td style={{ padding: '9px 10px', color: '#6e6e73', whiteSpace: 'nowrap', fontSize: '12px' }}>
                      {t.fecha}
                    </td>
                    <td style={{
                      padding: '9px 10px', color: darkMode ? '#F0EDEC' : '#1d1d1f',
                      maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>
                      {t.nombre || t.detalle || '—'}
                    </td>
                    <td style={{ padding: '9px 10px' }}>
                      {t.categories?.nombre ? (
                        <span style={{
                          backgroundColor: darkMode ? '#3A333A' : '#EDE8EC',
                          color: '#5C4F5C', padding: '2px 8px',
                          borderRadius: '10px', fontWeight: '500', fontSize: '12px'
                        }}>
                          {CATEGORY_CONFIG[t.categories.nombre]?.icon} {t.categories.nombre}
                        </span>
                      ) : <span style={{ color: '#aaa' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 10px', color: '#6e6e73', fontSize: '12px' }}>
                      {t.subcategories?.nombre || '—'}
                    </td>
                    <td style={{ padding: '9px 10px', fontWeight: '600', whiteSpace: 'nowrap', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                      {t.moneda === 'USD'
                        ? <span style={{ color: '#5588aa' }}>U$S {formatMontoFull(t.monto)}</span>
                        : `$ ${formatMonto(t.monto)}`
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
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
