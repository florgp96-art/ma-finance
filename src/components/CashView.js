import React, { useState, useEffect, useMemo, useCallback } from 'react'
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

export default function CashView({ accounts, refreshKey, darkMode, tipoCambio, tipoCambioEUR, tcManual }) {
  const [transactions, setTransactions] = useState([])
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [mesDropdownOpen, setMesDropdownOpen] = useState(false)
  // Un solo Set con las claves de los ítems desplegados del "Desglose de pagos" —
  // mismo patrón para Mastercard/Visa/Alquiler/Débitos/etc., cualquiera sea la
  // cantidad real de cuentas/categorías que tenga cada usuario.
  const [gruposAbiertos, setGruposAbiertos] = useState(() => new Set())
  const toggleGrupo = (key) => setGruposAbiertos(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  useEffect(() => {
    if (accounts && accounts.length > 0) fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, refreshKey])

  const fetchAll = async () => {
    setLoading(true)
    try {
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
    } finally {
      // Si alguna de las dos consultas falla, "Cargando datos..." no debe quedar
      // pegado para siempre — mejor mostrar la pantalla (vacía o parcial) que un
      // spinner infinito sin forma de salir sin recargar la página.
      setLoading(false)
    }
  }

  const accountTipoById = useMemo(() => new Map((accounts || []).map(a => [a.id, a.tipo])), [accounts])
  const accountNombreById = new Map((accounts || []).map(a => [a.id, a.nombre]))
  const tc = parseFloat(tipoCambio) || 0
  const tcE = parseFloat(tipoCambioEUR) || 0
  // Antes un movimiento en EUR se sumaba tal cual (como si fuera ARS 1 a 1) en
  // vez de convertirse — ahora usa el TC vigente de euro, igual que el dólar.
  const aArs = useCallback((t) => t.moneda === 'USD' ? Number(t.monto) * tc : t.moneda === 'EUR' ? Number(t.monto) * tcE : Number(t.monto), [tc, tcE])

  const mesesDisponibles = useMemo(() => [...new Set([
    ...transactions.map(t => normFecha(t.fecha).slice(0, 7)).filter(Boolean),
    new Date().toISOString().slice(0, 7),
  ])].sort().reverse()
  , [transactions])

  // Bloque "desglose del mes" (actual + cuotas comprometidas + historial 6 meses):
  // desgloseDelMes filtra TODAS las transacciones y se llama 7 veces por render (1 para
  // el mes seleccionado + 6 para el historial) — memoizado como un todo para que un
  // re-render ajeno (abrir/cerrar un ítem del desglose, hover) no dispare esos 7 barridos
  // de nuevo. Ningún cálculo interno se modificó.
  const { actual, pagosPorCuenta, cuotas, historial } = useMemo(() => {
    const esAlquilerOExpensas = (t) => t.categories?.nombre === 'Casa' && ['Alquiler', 'Expensas'].includes(t.subcategories?.nombre)
    const esSuscripcion = (t) => t.categories?.nombre === 'Suscripciones'
    // "Débito automático" en sentido estricto (algo que se debita solo, tipo
    // seguro/cuota/servicio) es la categoría "Débitos" que el usuario ya puede
    // asignar a una transacción — no "cualquier gasto de una cuenta débito",
    // que en la práctica son transferencias comunes (Comida, Transporte, etc.).
    const esDebitoAutomatico = (t) => t.categories?.nombre === 'Débitos'

    // Clasifica los movimientos "efectivamente pagados" de un mes en grupos sin
    // superposición entre ellos, siguiendo el mismo modelo de datos que ya usa
    // la vista de A pagar (pago de tarjeta = transacción tipo "neutro" en una
    // cuenta de crédito; débito/efectivo = cuentas de ese tipo; alquiler/
    // expensas se identifica por categoría, sin importar la cuenta; dentro de
    // una cuenta débito, lo categorizado como "Débitos" son los automáticos de
    // verdad, y el resto son transferencias comunes).
    const desgloseDelMes = (mes) => {
      const txs = transactions.filter(t => normFecha(t.fecha).slice(0, 7) === mes)
      const tipoCuenta = (t) => accountTipoById.get(t.account_id)
      const pagos = txs.filter(t => t.tipo === 'neutro' && tipoCuenta(t) === 'credito')
      const alquiler = txs.filter(t => t.tipo === 'gasto' && esAlquilerOExpensas(t))
      const debitosAutomaticos = txs.filter(t => t.tipo === 'gasto' && tipoCuenta(t) === 'debito' && esDebitoAutomatico(t) && !esAlquilerOExpensas(t))
      const transferencias = txs.filter(t => t.tipo === 'gasto' && tipoCuenta(t) === 'debito' && !esAlquilerOExpensas(t) && !esSuscripcion(t) && !esDebitoAutomatico(t))
      const suscripciones = txs.filter(t => t.tipo === 'gasto' && esSuscripcion(t) && tipoCuenta(t) !== 'credito')
      const efectivo = txs.filter(t => t.tipo === 'gasto' && tipoCuenta(t) === 'efectivo' && !esSuscripcion(t))
      const ingresos = txs.filter(t => t.tipo === 'ingreso')
      const sum = (list) => list.reduce((s, t) => s + aArs(t), 0)
      const todos = [...pagos, ...alquiler, ...debitosAutomaticos, ...transferencias, ...suscripciones, ...efectivo]
      const totalPagado = sum(todos)
      const totalPagadoArs = todos.reduce((s, t) => s + (t.moneda === 'ARS' ? Number(t.monto) : 0), 0)
      const totalPagadoUsd = todos.reduce((s, t) => s + (t.moneda === 'USD' ? Number(t.monto) : 0), 0)
      const totalPagadoEur = todos.reduce((s, t) => s + (t.moneda === 'EUR' ? Number(t.monto) : 0), 0)
      const totalIngresos = sum(ingresos)
      return { pagos, alquiler, debitosAutomaticos, transferencias, suscripciones, efectivo, ingresos, totalPagado, totalPagadoArs, totalPagadoUsd, totalPagadoEur, totalIngresos, balance: totalIngresos - totalPagado }
    }

    const actual = desgloseDelMes(selectedMonth)

    const pagosPorCuenta = new Map()
    actual.pagos.forEach(p => {
      const list = pagosPorCuenta.get(p.account_id) || []
      list.push(p)
      pagosPorCuenta.set(p.account_id, list)
    })

    // Cuotas comprometidas a futuro: para cada compra en cuotas, lo que falta
    // facturar de acá en adelante. Agrupar por t.nombre/t.detalle "tal cual" no
    // sirve — esos campos traen pegado el sufijo de cuota del banco (ej.
    // "Compra 3/12"), que cambia en cada fila de la misma compra real, así que
    // cada cuota ya facturada terminaba contándose como una "compra" aparte
    // (confirmado: ver diagnóstico en PR #97). Se agrupa por nombre sin el
    // sufijo + cuotas_total + cuenta + mes de inicio de la compra (mismo
    // criterio que ya usa el widget "Cuotas pendientes" de Dashboard.js), y solo
    // se toma la cuota de mayor número por grupo (la más reciente facturada).
    const stripCuotaSuffix = (n) => (n || '')
      .replace(/\s+\d+\/\d+\s*$/, '')
      .trim()
    const mesInicioCompra = (t) => {
      if (!t.fecha) return ''
      const f = new Date(t.fecha + 'T12:00:00')
      const d = new Date(f.getFullYear(), f.getMonth() - ((t.cuota_numero || 1) - 1), 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    const cuotasComprometidas = () => {
      // Alquiler/expensas puede quedar cargado con cuotas_total/cuota_numero
      // (ej. para trackear los meses de un contrato), pero no es una compra
      // financiada con fecha de fin real — es un gasto fijo recurrente que no
      // corresponde proyectar acá (además de que ni siquiera está garantizado
      // que se vaya a pagar cada mes).
      const conCuotas = transactions.filter(t => (t.cuotas_total || 1) > 1 && !esAlquilerOExpensas(t))
      const groupKeyCuota = (t) => `${stripCuotaSuffix(t.nombre || t.detalle || '').toLowerCase()}|${t.cuotas_total}|${t.account_id}|${mesInicioCompra(t)}`
      const maxCuotaPorGrupo = {}
      conCuotas.forEach(t => {
        const key = groupKeyCuota(t)
        const cn = t.cuota_numero || 0
        if (!maxCuotaPorGrupo[key] || cn > maxCuotaPorGrupo[key]) maxCuotaPorGrupo[key] = cn
      })
      // Una compra dividida (regla de tipo "split") queda como varias filas
      // reales con el mismo número de cuota — hay que sumarlas para recuperar
      // el monto total de esa cuota, no quedarnos con una sola parte.
      const latestByPurchase = {}
      conCuotas.forEach(t => {
        const key = groupKeyCuota(t)
        if ((t.cuota_numero || 0) !== maxCuotaPorGrupo[key]) return
        if (!latestByPurchase[key]) latestByPurchase[key] = { ...t, monto: 0 }
        latestByPurchase[key].monto += Number(t.monto)
      })
      let total = 0, compras = 0
      Object.values(latestByPurchase).forEach(t => {
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

    return { actual, pagosPorCuenta, cuotas, historial }
  }, [transactions, accountTipoById, selectedMonth, aArs])

  // Color de línea del historial con buen contraste en los dos modos — en dark, el
  // gris-violeta "primario" (#8C7B8C) queda muy apagado sobre el panel oscuro, así
  // que se usa una versión más clara del mismo tono.
  const chartLine = darkMode ? '#C4B4DC' : '#5C4F5C'
  const txt = darkMode ? '#F0EDEC' : '#1d1d1f'
  const muted = darkMode ? '#9A8A9A' : '#6e6e73'
  const border = darkMode ? '#3A333A' : '#E2DDE0'
  const panel = darkMode ? '#2A272A' : '#F0EDEC'
  const cardBg = darkMode ? '#1C1A1C' : 'white'
  // Formato compacto para el eje Y del historial (ej. "$2,1M", "$450k") — solo
  // presentación, no toca ningún cálculo.
  const formatMontoCompacto = (v) => {
    const abs = Math.abs(v)
    if (abs >= 1_000_000) return `$${(v / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`
    if (abs >= 1_000) return `$${(v / 1_000).toLocaleString('es-AR', { maximumFractionDigits: 0 })}k`
    return `$${Math.round(v)}`
  }

  const seccion = { backgroundColor: panel, border: `1px solid ${border}`, borderRadius: '14px', padding: '18px 20px', marginBottom: '20px' }
  const label = { fontSize: '11px', fontWeight: '700', color: muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }

  // Cada ítem del desglose: colapsado por defecto mostrando solo ícono + nombre
  // + total; al abrirlo lista cada pago individual (fecha y monto). renderDetalle
  // es opcional para casos con formato de detalle propio (ej. las tarjetas, que
  // muestran a qué resumen corresponde cada pago).
  const grupoRowExpandible = (key, icono, nombre, list, renderDetalle) => {
    if (!list || list.length === 0) return null
    const abierto = gruposAbiertos.has(key)
    const totalArs = list.reduce((s, t) => s + aArs(t), 0)
    return (
      <div key={key} style={{ padding: '10px 0', borderBottom: `1px solid ${border}` }}>
        <div onClick={() => toggleGrupo(key)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: txt }}>{abierto ? '▾' : '▸'} {icono} {nombre}</p>
          <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: txt, whiteSpace: 'nowrap' }}>$ {formatMonto(totalArs)}</p>
        </div>
        {abierto && (
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {list.map(t => renderDetalle ? renderDetalle(t) : (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', color: muted }}>
                <span>{t.nombre || t.detalle} · {formatFecha(t.fecha)}</span>
                <span style={{ whiteSpace: 'nowrap' }}>{monedaSymbol(t.moneda)} {formatMontoFull(t.monto)}</span>
              </div>
            ))}
          </div>
        )}
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
          {actual.totalPagadoEur > 0 && (
            <div>
              <p style={{ margin: '0 0 2px', fontSize: '11px', fontWeight: '700', color: muted }}>EUR</p>
              <p style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: txt }}>€ {formatMontoFull(actual.totalPagadoEur)}</p>
            </div>
          )}
        </div>
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${border}` }}>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: '700', color: muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total unificado</p>
          <p style={{ margin: '4px 0 0', fontSize: '36px', fontWeight: '800', color: txt }}>$ {formatMonto(actual.totalPagado)}</p>
          {(actual.totalPagadoUsd > 0 || actual.totalPagadoEur > 0) && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: muted }}>
              {(tc > 0 || actual.totalPagadoEur === 0) && (tcE > 0 || actual.totalPagadoUsd === 0)
                ? `Monedas extranjeras convertidas al TC vigente (${tcManual?.enabled ? 'manual' : 'automático'})`
                : 'Hay montos en moneda extranjera pero falta un tipo de cambio configurado — no se están sumando al total unificado.'}
            </p>
          )}
        </div>
      </div>

      {/* Desglose de pagos */}
      <div style={seccion}>
        <p style={label}>Desglose de pagos</p>
        {[...pagosPorCuenta.entries()].map(([accountId, pagosCuenta]) => {
          const nombreCuenta = accountNombreById.get(accountId) || 'Tarjeta'
          return grupoRowExpandible(`cuenta-${accountId}`, '💳', nombreCuenta, pagosCuenta, (pago) => {
            const stmt = statementDelPago(pago, statements)
            const periodo = stmt ? (stmt.periodo || mesLabel(stmt.fecha_hasta?.slice(0, 7) || '')) : null
            return (
              <div key={pago.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', color: muted }}>
                <span>{periodo ? `resumen ${periodo} → ` : ''}pagado {formatFecha(pago.fecha)}</span>
                <span style={{ whiteSpace: 'nowrap' }}>{monedaSymbol(pago.moneda)} {formatMontoFull(pago.monto)}</span>
              </div>
            )
          })
        })}
        {grupoRowExpandible('alquiler', '🏠', 'Alquiler / Expensas', actual.alquiler)}
        {grupoRowExpandible('debitos', '🏦', 'Débitos automáticos', actual.debitosAutomaticos)}
        {grupoRowExpandible('transferencias', '🔁', 'Transferencias', actual.transferencias)}
        {grupoRowExpandible('suscripciones', '📱', 'Suscripciones', actual.suscripciones)}
        {grupoRowExpandible('efectivo', '💵', 'Efectivo', actual.efectivo)}
        {pagosPorCuenta.size === 0 && actual.alquiler.length === 0 && actual.debitosAutomaticos.length === 0 && actual.transferencias.length === 0 && actual.suscripciones.length === 0 && actual.efectivo.length === 0 && (
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
        <p style={label}>Total pagado por mes · ARS (monedas extranjeras convertidas al TC vigente) · últimos 6 meses</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={historial} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={border} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: txt }} axisLine={{ stroke: border }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: txt }} axisLine={false} tickLine={false} width={52} tickFormatter={formatMontoCompacto} />
            <Tooltip
              formatter={(value) => [`$ ${formatMonto(value)} (ARS, USD convertidos)`, 'Total pagado']}
              labelFormatter={(l, payload) => payload?.[0] ? mesLabel(payload[0].payload.mes) : l}
              contentStyle={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '8px', fontSize: '12px' }}
              labelStyle={{ color: txt, fontWeight: '600' }}
              itemStyle={{ color: chartLine }}
            />
            <Line type="monotone" dataKey="total" stroke={chartLine} strokeWidth={2.5} dot={{ r: 4, fill: chartLine, strokeWidth: 0 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
