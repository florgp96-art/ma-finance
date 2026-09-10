import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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

// El saldo tiene sentido en cualquier cuenta donde haya plata guardada, así que se
// define por exclusión y no por lista: una cuenta nueva, o tipeada de una forma que
// hoy no existe, igual tiene saldo. Las dos que quedan afuera:
//
//   - Tarjeta de crédito: no tiene saldo, tiene deuda, y ese número ya viene del
//     resumen del banco — la única fuente que puede tenerlo (ver
//     calcularStatementsPendientes). Un saldo a mano al lado sería una segunda
//     fuente para el mismo número.
//   - "Ingresos": no es una cuenta donde viva plata, es una vista que junta todos
//     los ingresos sin importar en qué cuenta están.
export const tieneSaldo = (account) => Boolean(account?.tipo) && account.tipo !== 'credito' && account.tipo !== 'ingreso'

// Card de saldo de una cuenta: cuánta plata hay, calculada desde el último saldo
// que cargó el usuario más lo que pasó después. Ver src/lib/saldos.js para el
// porqué del modelo de anclas.
export default function SaldoCuenta({ account, accounts, transactions, darkMode, styles, onSaved }) {
  const sem = semaforo(darkMode)
  const muted = darkMode ? '#9A8A9A' : '#75757a'
  const [anclas, setAnclas] = useState([])
  const [pagosDeTarjeta, setPagosDeTarjeta] = useState([])
  // null = la columna/tabla todavía no existen (migración sin correr). Se avisa en
  // vez de romper la pantalla, igual que con las fechas del próximo ciclo.
  const [sinMigrar, setSinMigrar] = useState(false)
  const [editando, setEditando] = useState(false)
  const [moneda, setMoneda] = useState('ARS')
  const [valor, setValor] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // accounts entra por props y cambia de identidad en cada render del padre: si
  // fetchAnclas dependiera de él, refetchearía en loop. Se lee por ref.
  const accountsRef = useRef(accounts)
  useEffect(() => { accountsRef.current = accounts }, [accounts])

  const fetchAnclas = useCallback(async () => {
    if (!account?.id) return
    const { data, error: errAnclas } = await supabase.from('account_balances')
      .select('*').eq('account_id', account.id)
    if (errAnclas) { setSinMigrar(true); return }
    setSinMigrar(false)
    setAnclas(data || [])
    // Los pagos de tarjeta viven en la cuenta de CRÉDITO, no en esta: hay que ir a
    // buscarlos a las tarjetas que se pagan desde acá. Es la plata más grande que
    // sale de la cuenta en el mes, así que sin esto el saldo queda muy de más.
    const tarjetasQuePago = (accountsRef.current || [])
      .filter(a => a.tipo === 'credito' && a.cuenta_pago_id === account.id)
    if (tarjetasQuePago.length === 0) { setPagosDeTarjeta([]); return }
    const { data: pagos } = await supabase.from('transactions')
      .select('id, fecha, monto, moneda, tipo, nombre, detalle, account_id')
      .in('account_id', tarjetasQuePago.map(a => a.id)).eq('tipo', 'neutro')
    setPagosDeTarjeta(pagos || [])
  }, [account?.id])

  useEffect(() => { fetchAnclas() }, [fetchAnclas])

  // Los pagos de tarjeta vienen de otra consulta que las transacciones de la cuenta:
  // deduplicar por id antes de sumar nada.
  const movimientos = useMemo(() => {
    const vistos = new Set((transactions || []).map(t => t.id))
    return [...(transactions || []), ...pagosDeTarjeta.filter(t => !vistos.has(t.id))]
  }, [transactions, pagosDeTarjeta])

  // Una tarjeta sin cuenta de pago configurada no le resta a nadie: avisarlo es la
  // diferencia entre "me falta plata en la caja de ahorro" y "no le dije a la app
  // de dónde sale el pago de la tarjeta".
  const tarjetasSinCuentaDePago = useMemo(
    () => (accounts || []).filter(a => a.tipo === 'credito' && !a.cuenta_pago_id),
    [accounts])

  const monedasConDatos = useMemo(() => {
    const conAncla = new Set(anclas.map(a => a.moneda || 'ARS'))
    if (conAncla.size > 0) return [...conAncla].sort()
    return ['ARS']
  }, [anclas])

  const saldos = useMemo(() => monedasConDatos
    .map(m => saldoDeCuenta({ anclas, transactions: movimientos, accounts, accountId: account.id, moneda: m }))
    .filter(Boolean), [monedasConDatos, anclas, movimientos, accounts, account.id])

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
    const estimado = saldoDeCuenta({ anclas, transactions: movimientos, accounts, accountId: account.id, moneda, hasta: fecha })
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
    () => saldoDeCuenta({ anclas, transactions: movimientos, accounts, accountId: account.id, moneda, hasta: fecha }),
    [anclas, movimientos, accounts, account.id, moneda, fecha])
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
          {s.pagosDeTarjeta > 0 && (
            <p style={{ ...styles.summarySubval, textAlign: 'center', marginTop: '2px' }}>
              incluye {fmt(s.pagosDeTarjeta, s.moneda)} de tarjetas
            </p>
          )}
        </div>
      ))}

      {tarjetasSinCuentaDePago.length > 0 && (
        <p style={{ fontSize: '11px', color: muted, margin: '8px 0 0', textAlign: 'center' }}>
          {tarjetasSinCuentaDePago.length === 1
            ? `No configuraste de qué cuenta se paga ${tarjetasSinCuentaDePago[0].nombre}.`
            : `Hay ${tarjetasSinCuentaDePago.length} tarjetas sin cuenta de pago configurada.`}
          {' '}Sus pagos no están restados de ningún saldo.
        </p>
      )}

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
