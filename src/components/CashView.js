import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatMonto, formatMontoFull, formatFecha, normFecha, mesLabel, cierreDe, getLast6Months, InfoTooltip, rotuloLabel, calcularStatementsPendientes } from './AccountDetail'
import { cuotasFuturasCargadas } from '../lib/cuotas'

const monedaSymbol = (m) => m === 'USD' ? 'U$S' : m === 'EUR' ? '€' : '$'

// "Mes actual" en hora LOCAL, no UTC — con Argentina en UTC-3, toISOString()
// adelanta el mes ~3hs antes de tiempo entre las 21:00 y las 23:59 del
// último día de cada mes.
const mesActualLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// IMPORTANTE: la query que se le pasa tiene que ordenar por una columna que
// desempate por completo (ej. .order('fecha', ...).order('id', ...)) — si
// muchas filas comparten la misma fecha, ordenar solo por fecha no da un
// orden estable entre ellas, y Postgres puede devolver la misma fila en dos
// páginas distintas (duplicada) u omitir otra, ya que cada página es una
// consulta separada con su propio LIMIT/OFFSET.
const fetchAllPages = async (buildQuery) => {
  const PAGE = 1000
  let all = []
  let page = 0
  while (true) {
    const { data, error } = await buildQuery().range(page * PAGE, (page + 1) * PAGE - 1)
    // Antes un error acá (RLS, red caída) se veía idéntico a "no hay pagos
    // este mes" — ahora al menos queda un rastro en consola en vez de
    // desaparecer en silencio.
    if (error) { console.error('CashView: error cargando página de datos:', error.message); break }
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

function CashView({ accounts, refreshKey, darkMode, tipoCambio, tipoCambioEUR, tcManual }) {
  const [transactions, setTransactions] = useState([])
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState(() => mesActualLocal())
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
            .order('fecha', { ascending: false }).order('id', { ascending: true })
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
    mesActualLocal(),
  ])].sort().reverse()
  , [transactions])

  // Bloque "desglose del mes" (actual + cuotas comprometidas + historial 6 meses):
  // desgloseDelMes filtra TODAS las transacciones y se llama 7 veces por render (1 para
  // el mes seleccionado + 6 para el historial) — memoizado como un todo para que un
  // re-render ajeno (abrir/cerrar un ítem del desglose, hover) no dispare esos 7 barridos
  // de nuevo. Ningún cálculo interno se modificó.
  const { actual, pagosPorCuenta, cuotas, historial } = useMemo(() => {
    const ahora = new Date()
    const hoyISO = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`
    const esSuscripcion = (t) => t.categories?.nombre === 'Suscripciones'
    // "Débito automático" en sentido estricto (algo que se debita solo, tipo
    // seguro/cuota/servicio) es la categoría "Débitos" que el usuario ya puede
    // asignar a una transacción — no "cualquier gasto de una cuenta débito",
    // que en la práctica son transferencias comunes (Comida, Transporte, etc.).
    const esDebitoAutomatico = (t) => t.categories?.nombre === 'Débitos'

    // Clasifica los movimientos "efectivamente pagados" de un mes en grupos sin
    // superposición entre ellos, siguiendo el mismo modelo de datos que ya usa
    // la vista de A pagar: los grupos se definen SIEMPRE por el tipo de cuenta
    // de la que salió la plata (pago de tarjeta = "neutro" en una cuenta de
    // crédito; débito/efectivo = cuentas de ese tipo), nunca por la categoría
    // del gasto.
    //
    // Antes había un grupo aparte de alquiler/expensas que se armaba por
    // categoría sin importar la cuenta, y por eso se solapaba con los demás: el
    // alquiler pagado con tarjeta se contaba en su grupo Y adentro del pago del
    // resumen, y el pagado en efectivo se contaba en su grupo Y en "Efectivo".
    // Sacarlo elimina toda esa clase de doble conteo: ahora cada gasto cae en un
    // solo grupo, el del medio de pago con el que realmente se pagó.
    // "Efectivamente pagado" es lo que YA pasó: se corta en la fecha de hoy, no en el
    // mes. Antes filtraba solo por mes, y desde que la app crea las cuotas futuras como
    // movimientos reales eso contaba como pagado algo que todavía no ocurrió — el mes en
    // curso mostraba "Total efectivamente pagado" con la cuota del 5 estando a día 1, y
    // el balance de caja quedaba en rojo por plata que no salió.
    // En los meses ya cerrados la condición no cambia nada, porque todas sus fechas son
    // anteriores a hoy.
    const desgloseDelMes = (mes) => {
      const txs = transactions.filter(t => {
        const f = normFecha(t.fecha)
        return f.slice(0, 7) === mes && f <= hoyISO
      })
      const tipoCuenta = (t) => accountTipoById.get(t.account_id)
      const pagos = txs.filter(t => t.tipo === 'neutro' && tipoCuenta(t) === 'credito')
      const debitosAutomaticos = txs.filter(t => t.tipo === 'gasto' && tipoCuenta(t) === 'debito' && esDebitoAutomatico(t))
      const transferencias = txs.filter(t => t.tipo === 'gasto' && tipoCuenta(t) === 'debito' && !esSuscripcion(t) && !esDebitoAutomatico(t))
      const suscripciones = txs.filter(t => t.tipo === 'gasto' && esSuscripcion(t) && tipoCuenta(t) !== 'credito')
      const efectivo = txs.filter(t => t.tipo === 'gasto' && tipoCuenta(t) === 'efectivo' && !esSuscripcion(t))
      const ingresos = txs.filter(t => t.tipo === 'ingreso')
      const sum = (list) => list.reduce((s, t) => s + aArs(t), 0)
      const todos = [...pagos, ...debitosAutomaticos, ...transferencias, ...suscripciones, ...efectivo]
      const totalPagado = sum(todos)
      const totalPagadoArs = todos.reduce((s, t) => s + (t.moneda === 'ARS' ? Number(t.monto) : 0), 0)
      const totalPagadoUsd = todos.reduce((s, t) => s + (t.moneda === 'USD' ? Number(t.monto) : 0), 0)
      const totalPagadoEur = todos.reduce((s, t) => s + (t.moneda === 'EUR' ? Number(t.monto) : 0), 0)
      const totalIngresos = sum(ingresos)
      const totalIngresosArs = ingresos.reduce((s, t) => s + (t.moneda === 'ARS' ? Number(t.monto) : 0), 0)
      const totalIngresosUsd = ingresos.reduce((s, t) => s + (t.moneda === 'USD' ? Number(t.monto) : 0), 0)
      const totalIngresosEur = ingresos.reduce((s, t) => s + (t.moneda === 'EUR' ? Number(t.monto) : 0), 0)
      const balanceArs = totalIngresosArs - totalPagadoArs
      const balanceUsd = totalIngresosUsd - totalPagadoUsd
      const balanceEur = totalIngresosEur - totalPagadoEur
      return { pagos, debitosAutomaticos, transferencias, suscripciones, efectivo, ingresos, totalPagado, totalPagadoArs, totalPagadoUsd, totalPagadoEur, totalIngresos, totalIngresosArs, totalIngresosUsd, totalIngresosEur, balanceArs, balanceUsd, balanceEur, balance: totalIngresos - totalPagado }
    }

    const actual = desgloseDelMes(selectedMonth)

    const pagosPorCuenta = new Map()
    actual.pagos.forEach(p => {
      const list = pagosPorCuenta.get(p.account_id) || []
      list.push(p)
      pagosPorCuenta.set(p.account_id, list)
    })

    // Cuotas comprometidas a futuro: las cuotas YA CARGADAS como movimiento de los
    // meses que VIENEN (el mes en curso ya es deuda de este ciclo y se ve en "A
    // pagar"). Se lee la base, no se proyecta nada — es la misma función que usa el
    // widget "Cuotas pendientes" del Dashboard, así que los dos números y la tabla de
    // movimientos no pueden discrepar. Las cuotas que faltan del plan se crean como
    // movimientos al importar el resumen.
    // Mismo criterio que el widget del Dashboard: si un resumen cargado la facturó,
    // decide ese resumen (si ya se pagó, la cuota deja de ser pendiente); si no la
    // facturó ninguno, decide el mes. El saldo por resumen sale de
    // calcularStatementsPendientes, la misma función que usa "A pagar".
    const saldoPorResumen = new Map(
      calcularStatementsPendientes({ accounts, statements, transactions })
        .statementsRealesConUsd.map(s => [s.id, { ars: s.total_resumen, usd: s.total_usd }])
    )
    const futuras = cuotasFuturasCargadas(transactions, new Date(), saldoPorResumen)
    const cuotas = {
      total: futuras.reduce((s, tx) => s + aArs(tx), 0),
      compras: futuras.length,
    }

    const historial = getLast6Months().map(m => ({
      mes: m,
      label: mesLabel(m).slice(0, 3),
      total: Math.round(desgloseDelMes(m).totalPagado),
    }))

    return { actual, pagosPorCuenta, cuotas, historial }
  }, [transactions, statements, accounts, accountTipoById, selectedMonth, aArs])

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
  const label = { fontSize: '11px', fontWeight: '700', color: muted, ...rotuloLabel, margin: '0 0 10px' }

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
          <div className="hide-scroll" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50, backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '10px', padding: '6px', maxHeight: '260px', overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', minWidth: '180px' }}>
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
          <p style={{ margin: 0, fontSize: '11px', fontWeight: '700', color: muted, display: 'flex', alignItems: 'center', justifyContent: 'center', ...rotuloLabel }}>
            Total unificado
            {(actual.totalPagadoUsd > 0 || actual.totalPagadoEur > 0) && (
              <InfoTooltip darkMode={darkMode} text={
                (tc > 0 || actual.totalPagadoEur === 0) && (tcE > 0 || actual.totalPagadoUsd === 0)
                  ? `Monedas extranjeras convertidas al TC ${tcManual?.enabled ? 'manual' : 'automático'} vigente`
                  : 'Falta un tipo de cambio configurado — las monedas extranjeras no se están sumando acá.'
              } />
            )}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '36px', fontWeight: '800', color: txt }}>$ {formatMonto(actual.totalPagado)}</p>
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
        {grupoRowExpandible('debitos', '🏦', 'Débitos automáticos', actual.debitosAutomaticos)}
        {grupoRowExpandible('transferencias', '🔁', 'Transferencias', actual.transferencias)}
        {grupoRowExpandible('suscripciones', '📱', 'Suscripciones', actual.suscripciones)}
        {grupoRowExpandible('efectivo', '💵', 'Efectivo', actual.efectivo)}
        {pagosPorCuenta.size === 0 && actual.debitosAutomaticos.length === 0 && actual.transferencias.length === 0 && actual.suscripciones.length === 0 && actual.efectivo.length === 0 && (
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
        {(actual.totalIngresosUsd > 0 || actual.totalPagadoUsd > 0 || actual.totalIngresosEur > 0 || actual.totalPagadoEur > 0) && (
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px dashed ${border}`, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: muted }}>
              <span>Balance ARS</span>
              <span style={{ fontWeight: '600', color: actual.balanceArs >= 0 ? '#3a7d44' : '#c0392b' }}>{actual.balanceArs >= 0 ? '+' : '-'}$ {formatMonto(Math.abs(actual.balanceArs))}</span>
            </div>
            {(actual.totalIngresosUsd > 0 || actual.totalPagadoUsd > 0) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: muted }}>
                <span>Balance USD</span>
                <span style={{ fontWeight: '600', color: actual.balanceUsd >= 0 ? '#3a7d44' : '#c0392b' }}>{actual.balanceUsd >= 0 ? '+' : '-'}U$S {formatMontoFull(Math.abs(actual.balanceUsd))}</span>
              </div>
            )}
            {(actual.totalIngresosEur > 0 || actual.totalPagadoEur > 0) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: muted }}>
                <span>Balance EUR</span>
                <span style={{ fontWeight: '600', color: actual.balanceEur >= 0 ? '#3a7d44' : '#c0392b' }}>{actual.balanceEur >= 0 ? '+' : '-'}€ {formatMontoFull(Math.abs(actual.balanceEur))}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cuotas comprometidas */}
      {cuotas.compras > 0 && (
        <div style={seccion}>
          {/* La explicación de cómo se calcula va en la "i" del título, no como
              un renglón de texto abajo del monto: ahí ocupaba dos líneas en la
              card y competía con el número, que es lo que se viene a mirar. */}
          <p style={{ ...label, display: 'flex', alignItems: 'center' }}>
            Cuotas comprometidas a futuro
            <InfoTooltip
              darkMode={darkMode}
              text={`Suma de ${cuotas.compras} cuota${cuotas.compras === 1 ? '' : 's'} de tus movimientos de los meses que vienen. Las del mes en curso no cuentan acá: ya son deuda de este ciclo y se ven en "A pagar". Una cuota también deja de contar apenas pagás el resumen que la facturó. Es lo mismo que muestra el widget "Cuotas pendientes" y lo mismo que ves en la tabla de movimientos.`}
            />
          </p>
          <p style={{ margin: 0, fontSize: '22px', fontWeight: '700', color: txt }}>$ {formatMonto(cuotas.total)}</p>
        </div>
      )}

      {/* Historial 6 meses */}
      <div style={seccion}>
        <p style={{ ...label, display: 'flex', alignItems: 'center' }}>
          Total pagado por mes
          <InfoTooltip darkMode={darkMode} text="ARS (monedas extranjeras convertidas al TC vigente) · últimos 6 meses" />
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={historial} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={border} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: txt }} axisLine={{ stroke: border }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: txt }} axisLine={false} tickLine={false} width={52} tickFormatter={formatMontoCompacto} />
            <Tooltip
              formatter={(value) => [`$ ${formatMonto(value)}`, 'Total pagado']}
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

// Mismo motivo que en AccountDetail/HijoDetail: evita repintar el desglose +
// gráfico de este componente cuando cambia un estado ajeno en el Dashboard
// que no le pega a ninguno de sus props.
export default React.memo(CashView)
