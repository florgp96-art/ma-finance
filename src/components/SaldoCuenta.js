import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { semaforo } from '../theme'
import { saldoDeCuenta, desvioDeAncla, monedaDeLaCuenta } from '../lib/saldos'
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

// Se re-exporta para no romper los imports que ya apuntaban acá.
export { tieneSaldo } from '../lib/saldos'

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
  // La moneda arranca en la que opera la cuenta, no en pesos: cargar U$S 33 con el
  // selector en "$" guarda un ancla en pesos y ese saldo se suma al total en pesos sin
  // que se vea el error (pasó con "Caja de Ahorro USD Galicia — $ 33").
  const monedaDefault = useMemo(() => monedaDeLaCuenta({ account, transactions }), [account, transactions])
  const [moneda, setMoneda] = useState(monedaDefault)
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

  // Las anclas son append-only a propósito (así se ve desde cuándo un saldo se
  // desvió), pero un saldo mal cargado —la moneda equivocada, un dedazo— no se puede
  // arreglar agregando otro: hay que poder sacarlo. Se borra el ancla EN USO de esa
  // moneda; si había una anterior, el saldo vuelve a calcularse desde ella.
  const borrarAncla = async (ancla) => {
    const cuanto = fmt(Number(ancla.saldo), ancla.moneda || 'ARS')
    if (!window.confirm(`¿Borrar el saldo de ${cuanto} del ${formatFecha(ancla.fecha)}?`)) return
    const { error: errDel } = await supabase.from('account_balances').delete().eq('id', ancla.id)
    if (errDel) { setError(`No se pudo borrar: ${errDel.message}`); return }
    setError(null)
    await fetchAnclas()
    onSaved?.()
  }

  // El detalle sale de la card y entra acá: de qué saldo parte cada moneda, qué se
  // contó desde entonces y cuántos movimientos fueron.
  const textoDelTooltip = useMemo(() => {
    const comoFunciona = 'Sale del saldo que cargaste más lo que pasó DESPUÉS: ingresos que entraron, gastos y pagos que salieron. Se mueve solo a medida que cargás movimientos nuevos. Lo que tiene fecha anterior al saldo que pusiste no lo cambia: esa plata ya entró o salió antes de que contaras, así que ya está adentro del número.'
    if (saldos.length === 0) return comoFunciona
    const detalle = saldos.map(s => {
      const desde = `Desde ${fmt(s.ancla.saldo, s.moneda)} del ${formatFecha(s.ancla.fecha)}`
      if (s.cantidadMovimientos === 0) return `${desde}: todavía no cargaste movimientos posteriores.`
      const movs = `${s.cantidadMovimientos} movimiento${s.cantidadMovimientos === 1 ? '' : 's'}`
      const tarjetas = s.pagosDeTarjeta > 0 ? ` (incluye ${fmt(s.pagosDeTarjeta, s.moneda)} de pagos de tarjeta)` : ''
      return `${desde}: entró ${fmt(s.entradas, s.moneda)} y salió ${fmt(s.salidas, s.moneda)} en ${movs}${tarjetas}.`
    }).join(' ')
    return `${detalle} ${comoFunciona}`
  }, [saldos])

  const estimadoActual = useMemo(
    () => saldoDeCuenta({ anclas, transactions: movimientos, accounts, accountId: account.id, moneda, hasta: fecha }),
    [anclas, movimientos, accounts, account.id, moneda, fecha])
  // El ancla que se está por reemplazar en la moneda elegida: lo que se ofrece borrar.
  const anclaAEditar = useMemo(
    () => saldos.find(s => s.moneda === moneda)?.ancla || null,
    [saldos, moneda])
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
        <InfoTooltip darkMode={darkMode} text={textoDelTooltip} />
      </p>

      {saldos.length === 0 && !editando && (
        <p style={{ fontSize: '12px', color: muted, margin: '6px 0 10px', textAlign: 'center' }}>
          Todavía no cargaste el saldo de esta cuenta.
        </p>
      )}

      {/* Solo el monto. De dónde sale —el saldo que cargaste, qué entró y salió
          desde entonces, cuántos movimientos— va en la "i" del título y no como
          renglones acá: la card es para mirar un número, no para leer el detalle de
          los movimientos, que ya están en la tabla de abajo. */}
      {saldos.map((s, i) => (
        <p key={s.moneda} style={{ ...styles.summaryValue, marginBottom: '2px', marginTop: i === 0 ? '2px' : '6px' }}>
          {fmt(s.saldo, s.moneda)}
        </p>
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
        <button onClick={() => { setEditando(true); setFecha(hoyISO()); setMoneda(monedaDefault); setError(null) }}
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
          {/* Borrar vive acá y no en la card: es para arreglar un saldo mal cargado
              (la moneda equivocada, un dedazo), no algo que se mire todos los días. */}
          {anclaAEditar && (
            <button onClick={() => borrarAncla(anclaAEditar)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: '11px', padding: '2px 0 0', textDecoration: 'underline' }}>
              Borrar el saldo de {fmt(Number(anclaAEditar.saldo), anclaAEditar.moneda || 'ARS')} del {formatFecha(anclaAEditar.fecha)}
            </button>
          )}
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
