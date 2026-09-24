import React, { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { tieneSaldo, monedaDeLaCuenta } from '../lib/saldos'
import { armarCambioDeMoneda, tipoDeCambioImplicito, formatoCambio, MONEDAS_CAMBIO, SIMBOLO_MONEDA } from '../lib/cambioMoneda'
import { hayColumnaSentido } from '../lib/columnaSentido'

const hoyLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "Cambio" del modal Cargar movimiento: la plata que sale de una cuenta y la que
// entra en otra, en un solo paso (ver armarCambioDeMoneda). Solo se ofrecen cuentas
// con saldo: una tarjeta no tiene plata que cambiar, y "Ingresos" es una vista.
function CambioMoneda({ accounts, styles, darkMode, sem, tipoCambio, onCancelar, onGuardado }) {
  const cuentas = useMemo(() => (accounts || []).filter(tieneSaldo), [accounts])
  // Sin movimientos a mano, la moneda de la cuenta sale del nombre ("Caja USD").
  const monedaDe = (id) => monedaDeLaCuenta({ account: cuentas.find(c => c.id === id), transactions: [] })

  // Arranca en el caso de siempre: dólares que se venden para tener pesos.
  const [origen, setOrigen] = useState(() => {
    const cuenta = cuentas.find(c => monedaDe(c.id) === 'USD') || cuentas[0]
    return { accountId: cuenta?.id || '', moneda: 'USD', monto: '' }
  })
  const [destino, setDestino] = useState(() => {
    const cuenta = cuentas.find(c => monedaDe(c.id) === 'ARS' && c.id !== origen.accountId) || cuentas[0]
    return { accountId: cuenta?.id || '', moneda: 'ARS', monto: '' }
  })
  const [fecha, setFecha] = useState(hoyLocal)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const tc = tipoDeCambioImplicito({ origen, destino })
  const muted = darkMode ? '#9A8A9A' : '#75757a'
  const obligatorio = <span style={{ color: sem.negativo }}>*</span>

  const guardar = async (e) => {
    e.preventDefault()
    if (guardando) return
    setGuardando(true)
    setError(null)
    try {
      const [{ data: { user } }, conSentido] = await Promise.all([supabase.auth.getUser(), hayColumnaSentido()])
      const armado = armarCambioDeMoneda({
        userId: user?.id, fecha, origen, destino, conSentido,
        tipoCambioUSD: parseFloat(tipoCambio) || null,
      })
      if (armado.error) { setError(armado.error); return }
      // Las dos patas en un solo insert: o quedan las dos o ninguna. Una sola dejaría
      // la plata saliendo de una cuenta sin entrar en ninguna.
      const { error: errIns } = await supabase.from('transactions').insert(armado.movimientos)
      if (errIns) { setError(`No se pudo guardar el cambio: ${errIns.message}`); return }
      onGuardado?.()
    } catch (err) {
      setError(`No se pudo guardar el cambio: ${err?.message || 'error desconocido'}`)
    } finally {
      setGuardando(false)
    }
  }

  if (cuentas.length === 0) {
    return (
      <div>
        <p style={{ fontSize: '13px', color: muted, margin: '0 0 16px 0' }}>
          Para registrar un cambio hace falta al menos una cuenta que no sea tarjeta (caja de ahorro, efectivo, billetera).
        </p>
        <div style={styles.modalButtons}>
          <button type="button" style={styles.cancelBtn} onClick={onCancelar}>Cerrar</button>
        </div>
      </div>
    )
  }

  // Un lado del cambio: cuenta, moneda y monto. Elegir la cuenta propone su moneda,
  // que se puede corregir (una billetera tiene saldo en más de una).
  const lado = (titulo, ayuda, valor, setValor) => (
    <div style={styles.field}>
      <label style={styles.label}>
        {titulo} {obligatorio}
        <span style={{ fontSize: '11px', color: muted, fontWeight: '400' }}> — {ayuda}</span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: '8px', marginBottom: '8px' }}>
        <select style={styles.input} value={valor.accountId} required
          onChange={e => setValor(v => ({ ...v, accountId: e.target.value, moneda: monedaDe(e.target.value) }))}>
          {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select style={styles.input} value={valor.moneda}
          onChange={e => setValor(v => ({ ...v, moneda: e.target.value }))}>
          {MONEDAS_CAMBIO.map(m => <option key={m} value={m}>{SIMBOLO_MONEDA[m]} {m}</option>)}
        </select>
      </div>
      <input style={styles.input} type="number" inputMode="decimal" step="0.01" min="0.01" required
        value={valor.monto} placeholder="0.00"
        onChange={e => setValor(v => ({ ...v, monto: e.target.value }))} />
    </div>
  )

  return (
    <form onSubmit={guardar}>
      <p style={{ fontSize: '12px', color: muted, margin: '0 0 16px 0' }}>
        La plata que sale de una cuenta y la que entra en otra. No cuenta como gasto ni como ingreso: es la misma plata en otra moneda.
      </p>
      <div style={styles.field}>
        <label style={styles.label}>Fecha {obligatorio}</label>
        <input style={{ ...styles.input, WebkitAppearance: 'none', appearance: 'none' }} type="date" value={fecha} required
          onChange={e => setFecha(e.target.value)} />
      </div>
      {lado('Sale de', 'lo que entregaste', origen, setOrigen)}
      {lado('Entra a', 'lo que recibiste', destino, setDestino)}
      {tc && (
        <p style={{ fontSize: '13px', color: muted, margin: '-4px 0 8px 0' }}>
          Tipo de cambio: {SIMBOLO_MONEDA[tc.moneda]} 1 = <strong>{formatoCambio(tc.valor, tc.en)}</strong>
        </p>
      )}
      {error && <p style={{ fontSize: '13px', color: sem.negativo, margin: '8px 0 0 0' }}>{error}</p>}
      <div style={styles.modalButtons}>
        <button type="button" style={styles.cancelBtn} onClick={onCancelar}>Cancelar</button>
        <button type="submit" style={styles.saveBtn} disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar cambio'}
        </button>
      </div>
    </form>
  )
}

export default CambioMoneda
