import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatMonto, formatMontoFull, formatFecha, normFecha, mesLabel, cierreDe, getLast6Months } from './AccountDetail'

const monedaSymbol = (m) => m === 'USD' ? 'U$S' : m === 'EUR' ? '€' : '$'

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

// A qué statement de la cuenta le corresponde un pago: el vinculado
// directamente (statement_id) o, si es un pago suelto, el resumen cuya
// ventana de cierre (entre el cierre anterior y el propio) contiene la
// fecha del pago — misma lógica que ya usa AccountDetail para reconciliar.
const statementDelPago = (pago, statements) => {
  if (pago.statement_id) {
    const directo = statements.find(s => s.id === pago.statement_id)
    if (directo) return directo
  }
  const candidatos = statements
    .filter(s => s.account_id === pago.account_id)
    .map(s => ({ s, cierre: cierreDe(s) }))
    .filter(x => x.cierre)
    .sort((a, b) => a.cierre.localeCompare(b.cierre))
  const fecha = normFecha(pago.fecha)
  for (let i = 0; i < candidatos.length; i++) {
    const anterior = i > 0 ? candidatos[i - 1].cierre : null
    if (fecha < candidatos[i].cierre && (!anterior || fecha > anterior)) return candidatos[i].s
  }
  return null
}

export default function CashView({ accounts, refreshKey, darkMode, tipoCambio, tcManual }) {
  const [transactions, setTransactions] = useState([])
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [mesDropdownOpen, setMesDropdownOpen] = useState(false)
  const [debitosAbierto, setDebitosAbierto] = useState(false)

  useEffect(() => {
    if (accounts && accounts.length > 0) fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, refreshKey])

  const fetchAll = async () => {
    setLoading(true)
    const accountIds = accounts.map(a => a.id)
    const [txs, stmtRes] = await Promise.all([
      fetchAllPages(() =>
        supabase.from('transactions')
          .select('*, categories(nombre), subcategories(nombre)')
          .in('account_id', accountIds)
          .order('fecha', { ascending: false })
      ),
      supabase.from('statements').select('*').in('account_id', accountIds).order('fecha_hasta', { ascending: true }),
    ])
    setTransactions(txs)
    setStatements(stmtRes.data || [])
    setLoading(false)
  }

  const accountTipoById = new Map((accounts || []).map(a => [a.id, a.tipo]))
  const accountNombreById = new Map((accounts || []).map(a => [a.id, a.nombre]))
  const tc = parseFloat(tipoCambio) || 0
  const aArs = (t) => t.moneda === 'USD' ? Number(t.monto) * tc : Number(t.monto)

  const mesesDisponibles = [...new Set([
    ...transactions.map(t => normFecha(t.fecha).slice(0, 7)).filter(Boolean),
    new Date().toISOString().slice(0, 7),
  ])].sort().reverse()

  const esAlquilerOExpensas = (t) => t.categories?.nombre === 'Casa' && ['Alquiler', 'Expensas'].includes(t.subcategories?.nombre)
  const esSuscripcion = (t) => t.categories?.nombre === 'Suscripciones'

  // Clasifica los movimientos "efectivamente pagados" de un mes en 5 grupos
  // sin superposición entre ellos, siguiendo el mismo modelo de datos que ya
  // usa la vista de A pagar (pago de tarjeta = transacción tipo "neutro" en
  // una cuenta de crédito; débito/efectivo = cuentas de ese tipo; alquiler/
  // expensas se identifica por categoría, sin importar la cuenta).
  const desgloseDelMes = (mes) => {
    const txs = transactions.filter(t => normFecha(t.fecha).slice(0, 7) === mes)
    const tipoCuenta = (t) => accountTipoById.get(t.account_id)
    const pagos = txs.filter(t => t.tipo === 'neutro' && tipoCuenta(t) === 'credito')
    const alquiler = txs.filter(t => t.tipo === 'gasto' && esAlquilerOExpensas(t))
    const debitos = txs.filter(t => t.tipo === 'gasto' && tipoCuenta(t) === 'debito' && !esAlquilerOExpensas(t) && !esSuscripcion(t))
    const suscripciones = txs.filter(t => t.tipo === 'gasto' && esSuscripcion(t) && tipoCuenta(t) !== 'credito')
    const efectivo = txs.filter(t => t.tipo === 'gasto' && tipoCuenta(t) === 'efectivo' && !esSuscripcion(t))
    const ingresos = txs.filter(t => t.tipo === 'ingreso')
    const sum = (list) => list.reduce((s, t) => s + aArs(t), 0)
    const todos = [...pagos, ...alquiler, ...debitos, ...suscripciones, ...efectivo]
    const totalPagado = sum(todos)
    const totalPagadoArs = todos.reduce((s, t) => s + (t.moneda !== 'USD' ? Number(t.monto) : 0), 0)
    const totalPagadoUsd = todos.reduce((s, t) => s + (t.moneda === 'USD' ? Number(t.monto) : 0), 0)
    const totalIngresos = sum(ingresos)
    return { pagos, alquiler, debitos, suscripciones, efectivo, ingresos, totalPagado, totalPagadoArs, totalPagadoUsd, totalIngresos, balance: totalIngresos - totalPagado }
  }

  const actual = desgloseDelMes(selectedMonth)

  const pagosPorCuenta = new Map()
  actual.pagos.forEach(p => {
    const list = pagosPorCuenta.get(p.account_id) || []
    list.push(p)
    pagosPorCuenta.set(p.account_id, list)
  })

  // Cuotas comprometidas a futuro: para cada compra en cuotas (agrupando por
  // nombre+monto+cuotas_total+cuenta para no contar cada cuota facturada por
  // separado), lo que falta facturar de acá en adelante.
  const cuotasComprometidas = () => {
    const grupos = new Map()
    transactions.forEach(t => {
      if ((t.cuotas_total || 1) <= 1) return
      const key = `${t.nombre || t.detalle}__${t.cuotas_total}__${t.monto}__${t.account_id}`
      const existing = grupos.get(key)
      if (!existing || (t.cuota_numero || 1) > (existing.cuota_numero || 1)) grupos.set(key, t)
    })
    let total = 0, compras = 0
    grupos.forEach(t => {
      const remaining = (t.cuotas_total || 1) - (t.cuota_numero || 1)
      if (remaining <= 0) return
      total += aArs(t) * remaining
      compras++
    })
    return { total, compras }
  }
  const cuotas = cuotasComprometidas()

  const historial = getLast6Months().map(m => ({
    mes: m,
    label: mesLabel(m).slice(0, 3),
    total: Math.round(desgloseDelMes(m).totalPagado),
  }))

  const p = darkMode ? '#8C7B8C' : '#5C4F5C'
  const txt = darkMode ? '#F0EDEC' : '#1d1d1f'
  const muted = darkMode ? '#9A8A9A' : '#6e6e73'
  const border = darkMode ? '#3A333A' : '#E2DDE0'
  const panel = darkMode ? '#2A272A' : '#F0EDEC'
  const cardBg = darkMode ? '#1C1A1C' : 'white'

  const seccion = { backgroundColor: panel, border: `1px solid ${border}`, borderRadius: '14px', padding: '18px 20px', marginBottom: '20px' }
  const label = { fontSize: '11px', fontWeight: '700', color: muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }

  const grupoRow = (icono, nombre, list, extra) => {
    if (list.length === 0) return null
    const totalArs = list.reduce((s, t) => s + aArs(t), 0)
    return (
      <div key={nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', borderBottom: `1px solid ${border}`, gap: '10px' }}>
        <div>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: txt }}>{icono} {nombre}</p>
          {extra}
        </div>
        <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: txt, whiteSpace: 'nowrap' }}>$ {formatMonto(totalArs)}</p>
      </div>
    )
  }

  if (loading) return <div style={{ padding: '24px', color: muted }}>Cargando datos...</div>

  return (
    <div>
      {/* Selector de mes */}
      <div style={{ position: 'relative', marginBottom: '20px' }}>
        <button onClick={() => setMesDropdownOpen(o => !o)} style={{ padding: '8px 14px', borderRadius: '10px', border: `1.5px solid ${border}`, backgroundColor: cardBg, color: txt, fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif' }}>
          📅 {mesLabel(selectedMonth)} ▾
        </button>
        {mesDropdownOpen && (
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50, backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '10px', padding: '6px', maxHeight: '260px', overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', minWidth: '180px' }}>
            {mesesDisponibles.map(m => (
              <div key={m} onClick={() => { setSelectedMonth(m); setMesDropdownOpen(false) }}
                style={{ padding: '8px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: txt, backgroundColor: m === selectedMonth ? (darkMode ? '#3A333A' : '#EDE8EC') : 'transparent' }}>
                {mesLabel(m)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Número protagonista: ARS y USD separados, unificado destacado abajo */}
      <div style={{ ...seccion, textAlign: 'center', padding: '24px 20px' }}>
        <p style={label}>Total efectivamente pagado en {mesLabel(selectedMonth)}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '32px', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: '11px', fontWeight: '700', color: muted }}>ARS</p>
            <p style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: txt }}>$ {formatMonto(actual.totalPagadoArs)}</p>
          </div>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: '11px', fontWeight: '700', color: muted }}>USD</p>
            <p style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: actual.totalPagadoUsd > 0 ? txt : muted }}>U$S {formatMontoFull(actual.totalPagadoUsd)}</p>
          </div>
        </div>
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${border}` }}>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: '700', color: muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total unificado</p>
          <p style={{ margin: '4px 0 0', fontSize: '36px', fontWeight: '800', color: txt }}>$ {formatMonto(actual.totalPagado)}</p>
          {actual.totalPagadoUsd > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: muted }}>
              {tc > 0
                ? `USD convertidos a $ ${formatMontoFull(tc)} (TC ${tcManual?.enabled ? 'manual' : 'automático'})`
                : 'Hay montos en USD pero no hay un tipo de cambio configurado — no se están sumando al total unificado.'}
            </p>
          )}
        </div>
      </div>

      {/* Desglose por tipo */}
      <div style={seccion}>
        <p style={label}>Desglose por tipo</p>
        {[...pagosPorCuenta.entries()].map(([accountId, pagosCuenta]) => {
          const nombreCuenta = accountNombreById.get(accountId) || 'Tarjeta'
          const totalCuenta = pagosCuenta.reduce((s, t) => s + aArs(t), 0)
          return (
            <div key={accountId} style={{ padding: '10px 0', borderBottom: `1px solid ${border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: txt }}>💳 {nombreCuenta}</p>
                <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: txt, whiteSpace: 'nowrap' }}>$ {formatMonto(totalCuenta)}</p>
              </div>
              {pagosCuenta.map(pago => {
                const stmt = statementDelPago(pago, statements)
                const periodo = stmt ? (stmt.periodo || mesLabel(stmt.fecha_hasta?.slice(0, 7) || '')) : null
                return (
                  <p key={pago.id} style={{ margin: '4px 0 0', fontSize: '12px', color: muted }}>
                    {periodo ? `resumen ${periodo} → ` : ''}pagado {formatFecha(pago.fecha)}: {monedaSymbol(pago.moneda)} {formatMontoFull(pago.monto)}
                  </p>
                )
              })}
            </div>
          )
        })}
        {grupoRow('🏠', 'Alquiler / Expensas', actual.alquiler)}
        {actual.debitos.length > 0 && (
          <div style={{ padding: '10px 0', borderBottom: `1px solid ${border}` }}>
            <div onClick={() => setDebitosAbierto(v => !v)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: txt }}>{debitosAbierto ? '▾' : '▸'} 🏦 Débitos automáticos</p>
              <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: txt, whiteSpace: 'nowrap' }}>$ {formatMonto(actual.debitos.reduce((s, t) => s + aArs(t), 0))}</p>
            </div>
            {debitosAbierto && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {actual.debitos.map(t => (
                  <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', color: muted }}>
                    <span>{t.nombre || t.detalle} · {formatFecha(t.fecha)}</span>
                    <span style={{ whiteSpace: 'nowrap' }}>{monedaSymbol(t.moneda)} {formatMontoFull(t.monto)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {grupoRow('📱', 'Suscripciones', actual.suscripciones)}
        {grupoRow('💵', 'Efectivo', actual.efectivo)}
        {pagosPorCuenta.size === 0 && actual.alquiler.length === 0 && actual.debitos.length === 0 && actual.suscripciones.length === 0 && actual.efectivo.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: muted }}>No hay pagos registrados este mes.</p>
        )}
      </div>

      {/* Balance de caja */}
      <div style={seccion}>
        <p style={label}>Balance de caja</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: txt, padding: '4px 0' }}>
          <span>Ingresos del mes</span><span style={{ fontWeight: '600' }}>$ {formatMonto(actual.totalIngresos)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: txt, padding: '4px 0' }}>
          <span>Total pagado</span><span style={{ fontWeight: '600' }}>$ {formatMonto(actual.totalPagado)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: '700', paddingTop: '10px', marginTop: '6px', borderTop: `1px solid ${border}`, color: actual.balance >= 0 ? '#3a7d44' : '#c0392b' }}>
          <span>Balance</span><span>{actual.balance >= 0 ? '+' : '-'}$ {formatMonto(Math.abs(actual.balance))}</span>
        </div>
      </div>

      {/* Cuotas comprometidas */}
      {cuotas.compras > 0 && (
        <div style={seccion}>
          <p style={label}>Cuotas comprometidas a futuro</p>
          <p style={{ margin: 0, fontSize: '22px', fontWeight: '700', color: txt }}>$ {formatMonto(cuotas.total)}</p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: muted }}>Estimado: {cuotas.compras} compra{cuotas.compras === 1 ? '' : 's'} en cuotas con saldo pendiente de facturar.</p>
        </div>
      )}

      {/* Historial 6 meses */}
      <div style={seccion}>
        <p style={label}>Historial · últimos 6 meses</p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={historial} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={border} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: muted }} axisLine={{ stroke: border }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: muted }} axisLine={false} tickLine={false} width={0} />
            <Tooltip
              formatter={(value) => [`$ ${formatMonto(value)}`, 'Total pagado']}
              labelFormatter={(l, payload) => payload?.[0] ? mesLabel(payload[0].payload.mes) : l}
              contentStyle={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '8px', fontSize: '12px' }}
            />
            <Line type="monotone" dataKey="total" stroke={p} strokeWidth={2} dot={{ r: 3, fill: p }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
