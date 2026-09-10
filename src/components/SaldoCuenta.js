import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { semaforo } from '../theme'
import { saldoDeCuenta, desvioDeAncla } from '../lib/saldos'
import { formatMonto, formatMontoFull, formatFecha } from '../lib/formato'
import { InfoTooltip } from './InfoTooltip'

const SIMBOLO = { ARS: '$', USD: 'U$S', EUR: '€' }
const hoyISO = () => new Date().toISOString().slice(0, 10)

// El input es type="number", así que el valor ya llega canónico ("1234.56"): no hay
// que interpretar separadores de miles. Un saldo puede ser negativo (una cuenta en
// descubierto), así que no se acota el signo — solo se exige que sea un número.
const parseSaldo = (valor) => {
  if (valor === '' || valor === null || valor === undefined) return null
  const n = parseFloat(valor)
  return Number.isFinite(n) ? n : null
}
const fmt = (monto, moneda) => `${SIMBOLO[moneda] || '$'} ${moneda === 'ARS' ? formatMonto(monto) : formatMontoFull(monto)}`

// El saldo solo tiene sentido en cuentas donde hay plata guardada. Una tarjeta de
// crédito no tiene saldo, tiene deuda — y ese número ya viene del resumen del banco,
// que es la única fuente que puede tenerlo (ver calcularStatementsPendientes). Poner
// un saldo a mano al lado sería una segunda fuente para el mismo número.
export const tieneSaldo = (account) => account?.tipo === 'debito' || account?.tipo === 'efectivo'

// Card de saldo de una cuenta: cuánta plata hay, calculada desde el último saldo
// que cargó el usuario más lo que pasó después. Ver src/lib/saldos.js para el
// porqué del modelo de anclas.
export default function SaldoCuenta({ account, transactions, darkMode, styles, onSaved }) {
  const sem = semaforo(darkMode)
  const muted = darkMode ? '#9A8A9A' : '#75757a'
  const [anclas, setAnclas] = useState([])
  const [ingresosDestinados, setIngresosDestinados] = useState([])
  // null = la columna/tabla todavía no existen (migración sin correr). Se avisa en
  // vez de romper la pantalla, igual que con las fechas del próximo ciclo.
  const [sinMigrar, setSinMigrar] = useState(false)
  const [editando, setEditando] = useState(false)
  const [moneda, setMoneda] = useState('ARS')
  const [valor, setValor] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const fetchAnclas = useCallback(async () => {
    if (!account?.id) return
    const { data, error: errAnclas } = await supabase.from('account_balances')
      .select('*').eq('account_id', account.id)
    if (errAnclas) { setSinMigrar(true); return }
    setSinMigrar(false)
    setAnclas(data || [])
    // Los ingresos importados de un extracto se guardan en la cuenta "Ingresos",
    // no en la cuenta donde entró la plata — por eso hay que ir a buscarlos por
    // cuenta_destino_id, que es lo único que dice a dónde entraron de verdad.
    const { data: ing } = await supabase.from('transactions')
      .select('id, fecha, monto, moneda, tipo, nombre, detalle, account_id, cuenta_destino_id')
      .eq('cuenta_destino_id', account.id).eq('tipo', 'ingreso')
    setIngresosDestinados(ing || [])
  }, [account?.id])

  useEffect(() => { fetchAnclas() }, [fetchAnclas])

  // Los ingresos destinados pueden venir duplicados con los que ya están en
  // transactions (uno cargado a mano tiene la cuenta en account_id y no necesita
  // destino): deduplicar por id antes de sumar nada.
  const movimientos = useMemo(() => {
    const vistos = new Set((transactions || []).map(t => t.id))
    return [...(transactions || []), ...ingresosDestinados.filter(t => !vistos.has(t.id))]
  }, [transactions, ingresosDestinados])

  const monedasConDatos = useMemo(() => {
    const conAncla = new Set(anclas.map(a => a.moneda || 'ARS'))
    if (conAncla.size > 0) return [...conAncla].sort()
    return ['ARS']
  }, [anclas])

  const saldos = useMemo(() => monedasConDatos
    .map(m => saldoDeCuenta({ anclas, transactions: movimientos, accountId: account.id, moneda: m }))
    .filter(Boolean), [monedasConDatos, anclas, movimientos, account.id])

  const guardar = async () => {
    const saldoNum = parseSaldo(valor)
    if (saldoNum === null) { setError('Poné un número.'); return }
    if (!fecha) { setError('Falta la fecha.'); return }
    if (fecha > hoyISO()) { setError('La fecha no puede ser futura.'); return }
    setGuardando(true)
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    // Lo que la app venía calculando queda guardado junto al ancla: sin eso, el
    // desvío solo se puede ver en el momento y después se pierde.
    const estimado = saldoDeCuenta({ anclas, transactions: movimientos, accountId: account.id, moneda, hasta: fecha })
    const { error: errIns } = await supabase.from('account_balances').insert({
      user_id: user.id, account_id: account.id, moneda, fecha, saldo: saldoNum,
      saldo_calculado: estimado ? estimado.saldo : null,
    })
    setGuardando(false)
    if (errIns) { setError(`No se pudo guardar: ${errIns.message}`); return }
    setEditando(false)
    setValor('')
    await fetchAnclas()
    onSaved?.()
  }

  const estimadoActual = useMemo(
    () => saldoDeCuenta({ anclas, transactions: movimientos, accountId: account.id, moneda, hasta: fecha }),
    [anclas, movimientos, account.id, moneda, fecha])
  const saldoTipeado = parseSaldo(valor)
  const desvioPrevisto = saldoTipeado === null ? null : desvioDeAncla(saldoTipeado, estimadoActual)

  if (sinMigrar) {
    return (
      <div style={styles.summaryCard}>
        <p style={styles.summaryLabel}>Saldo</p>
        <p style={{ fontSize: '12px', color: muted, margin: '6px 0 0', textAlign: 'center' }}>
          Falta correr la migración de saldos en la base.
        </p>
      </div>
    )
  }

  return (
    <div style={styles.summaryCard}>
      <p style={{ ...styles.summaryLabel, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span>Saldo</span>
        <InfoTooltip darkMode={darkMode} text="Sale del último saldo que cargaste más lo que pasó después: ingresos que entraron, gastos y pagos que salieron. La app no puede saber sola cuánta plata tenés — siempre falta algo por cargar — así que el número bueno es el que ponés vos. Cuando lo actualices te va a decir cuánto se había desviado: esa diferencia es exactamente lo que falta cargar." />
      </p>

      {saldos.length === 0 && !editando && (
        <p style={{ fontSize: '12px', color: muted, margin: '6px 0 10px', textAlign: 'center' }}>
          Todavía no cargaste el saldo de esta cuenta.
        </p>
      )}

      {saldos.map((s, i) => (
        <div key={s.moneda} style={{ marginTop: i === 0 ? '2px' : '12px' }}>
          <p style={{ ...styles.summaryValue, marginBottom: '2px' }}>{fmt(s.saldo, s.moneda)}</p>
          <p style={{ ...styles.summarySubval, textAlign: 'center' }}>
            desde {fmt(s.ancla.saldo, s.moneda)} del {formatFecha(s.ancla.fecha)}
          </p>
          {s.cantidadMovimientos > 0 && (
            <p style={{ ...styles.summarySubval, textAlign: 'center', marginTop: '2px' }}>
              <span style={{ color: sem.teal }}>+{fmt(s.entradas, s.moneda)}</span>
              {'  '}
              <span style={{ color: sem.negativo }}>−{fmt(s.salidas, s.moneda)}</span>
            </p>
          )}
        </div>
      ))}

      {!editando ? (
        <button onClick={() => { setEditando(true); setFecha(hoyISO()); setError(null) }}
          style={{
            marginTop: '10px', width: '100%', padding: '6px', borderRadius: '8px', cursor: 'pointer',
            border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'transparent',
            color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '12px', fontFamily: '"Montserrat", sans-serif',
          }}>
          {saldos.length === 0 ? 'Cargar saldo' : 'Actualizar saldo'}
        </button>
      ) : (
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <select value={moneda} onChange={e => setMoneda(e.target.value)} style={inputStyle(darkMode, '70px')}>
              <option value="ARS">$</option>
              <option value="USD">U$S</option>
              <option value="EUR">€</option>
            </select>
            <input type="number" step="0.01" autoFocus value={valor} placeholder="saldo de hoy"
              onChange={e => setValor(e.target.value)} style={inputStyle(darkMode)} />
          </div>
          <input type="date" value={fecha} max={hoyISO()} onChange={e => setFecha(e.target.value)} style={inputStyle(darkMode)} />
          {desvioPrevisto !== null && desvioPrevisto !== 0 && (
            <p style={{ fontSize: '11px', margin: 0, color: desvioPrevisto < 0 ? sem.negativo : sem.teal }}>
              {desvioPrevisto < 0
                ? `Hay ${fmt(Math.abs(desvioPrevisto), moneda)} menos de lo calculado — falta cargar gastos.`
                : `Hay ${fmt(desvioPrevisto, moneda)} más de lo calculado — falta un ingreso o hay algo cargado de más.`}
            </p>
          )}
          {error && <p style={{ fontSize: '11px', margin: 0, color: sem.negativo }}>{error}</p>}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={guardar} disabled={guardando} style={{ ...botonStyle(darkMode), color: sem.teal }}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={() => { setEditando(false); setValor(''); setError(null) }} style={{ ...botonStyle(darkMode), color: muted }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const inputStyle = (darkMode, width) => ({
  flex: width ? undefined : 1, width, padding: '5px 8px', borderRadius: '8px', fontSize: '12px',
  border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`,
  backgroundColor: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f',
})

const botonStyle = (darkMode) => ({
  flex: 1, padding: '5px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px',
  border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'transparent',
  fontFamily: '"Montserrat", sans-serif',
})
