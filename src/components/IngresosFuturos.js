import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { formatFecha, formatMontoFull, parseMonto } from '../lib/formato'
import { cruzarConIngresos, desdeCuandoBuscar, totalesPorMoneda } from '../lib/ingresosFuturos'
import * as datos from '../lib/liquidacionDatos'

const SIMBOLO = { ARS: '$', USD: 'U$S', EUR: '€' }
const MONEDAS = ['ARS', 'USD', 'EUR']
const LARGO_MAXIMO_CONCEPTO = 80
const NUMEROS = { fontVariantNumeric: 'tabular-nums' }

const hoyLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const enMoneda = (monto, moneda) => `${SIMBOLO[moneda] || '$'} ${formatMontoFull(Number(monto) || 0)}`
const totalesEnTexto = (porMoneda) => MONEDAS.filter(m => porMoneda[m]).map(m => enMoneda(porMoneda[m], m)).join(' · ')
const formularioVacio = () => ({ concepto: '', monto: '', moneda: 'ARS', fecha: hoyLocal() })

// Ingresos a futuro de una liquidación de las que "te pagan" (ver lib/ingresosFuturos.js):
// se anotan acá, no tocan las cuentas, y se tachan solos cuando el ingreso aparece en
// alguna cuenta. Si no lo reconoce, se tachan a mano.
function IngresosFuturos({ userId, liquidacionId, estilos }) {
  const { c, sem, input, caja, rotulo, botonChico } = estilos
  const [todos, setTodos] = useState([])
  const [ingresos, setIngresos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(formularioVacio)
  const [guardando, setGuardando] = useState(false)
  const [verEntrados, setVerEntrados] = useState(false)

  const cargar = useCallback(async () => {
    if (!userId) return
    setCargando(true)
    setError(null)
    const { data, error: errEsperados } = await datos.leerIngresosFuturos(userId)
    if (errEsperados) { setError('No se pudieron leer los ingresos a futuro.'); setCargando(false); return }
    const lista = data || []
    setTodos(lista)
    const desde = desdeCuandoBuscar(lista)
    if (desde) {
      const { data: deCuentas, error: errCuentas } = await datos.leerIngresosDeCuentas(userId, desde)
      // Sin los ingresos de las cuentas igual se ve la lista: solo no se tacha nada solo.
      setIngresos(errCuentas ? [] : (deCuentas || []))
    } else {
      setIngresos([])
    }
    setCargando(false)
  }, [userId])

  useEffect(() => { cargar() }, [cargar])

  const cruce = useMemo(() => cruzarConIngresos(todos, ingresos), [todos, ingresos])
  const propios = useMemo(() => todos.filter(e => e.liquidacion_id === liquidacionId), [todos, liquidacionId])
  const entro = (e) => e.cobrado_a_mano || cruce.has(e.id)
  const pendientes = propios.filter(e => !entro(e)).sort((a, b) => a.fecha.localeCompare(b.fecha))
  const entrados = propios.filter(entro).sort((a, b) => b.fecha.localeCompare(a.fecha))
  const totales = totalesPorMoneda(propios, cruce)

  const agregar = async (e) => {
    e.preventDefault()
    const concepto = form.concepto.replace(/\s+/g, ' ').trim()
    const monto = parseMonto(form.monto)
    if (!concepto || concepto.length > LARGO_MAXIMO_CONCEPTO) { setError('Poné qué es (por ejemplo, el nombre del cliente).'); return }
    if (monto === null || monto <= 0) { setError('Poné un monto válido, por ejemplo 150000 o 150000,50.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fecha)) { setError('Elegí la fecha en que esperás cobrarlo.'); return }
    setGuardando(true)
    setError(null)
    const { error: errAlta } = await datos.crearIngresoFuturo({
      id: datos.nuevoId(), user_id: userId, liquidacion_id: liquidacionId,
      concepto, monto: Math.round(monto * 100) / 100, moneda: form.moneda, fecha: form.fecha,
    })
    setGuardando(false)
    if (errAlta) { setError('No se pudo guardar. Probá de nuevo.'); return }
    setForm(f => ({ ...formularioVacio(), moneda: f.moneda }))
    // Se vuelve a leer todo: una fecha más vieja puede necesitar ingresos que no estaban.
    cargar()
  }

  const marcarAMano = async (esperado, cobrado) => {
    setError(null)
    setTodos(ts => ts.map(t => (t.id === esperado.id ? { ...t, cobrado_a_mano: cobrado } : t)))
    const { error: errCambio } = await datos.actualizarIngresoFuturo(esperado.id, { cobrado_a_mano: cobrado })
    if (errCambio) {
      setTodos(ts => ts.map(t => (t.id === esperado.id ? { ...t, cobrado_a_mano: !cobrado } : t)))
      setError('No se pudo guardar. Probá de nuevo.')
    }
  }

  const borrar = async (esperado) => {
    if (!window.confirm(`¿Borrar "${esperado.concepto}" (${enMoneda(esperado.monto, esperado.moneda)})?`)) return
    setError(null)
    const { error: errBaja } = await datos.borrarIngresoFuturo(esperado.id)
    if (errBaja) { setError('No se pudo borrar. Probá de nuevo.'); return }
    setTodos(ts => ts.filter(t => t.id !== esperado.id))
  }

  const fila = (esperado, tachado) => {
    const ingreso = cruce.get(esperado.id)
    return (
      <div key={esperado.id} data-testid={`futuro-${esperado.id}`}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', borderBottom: `1px solid ${c.border}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '13px', color: tachado ? c.textTertiary : c.text, textDecoration: tachado ? 'line-through' : 'none' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatFecha(esperado.fecha).slice(0, 5)} · {esperado.concepto}</span>
            <span style={{ whiteSpace: 'nowrap', fontWeight: 600, ...NUMEROS }}>{enMoneda(esperado.monto, esperado.moneda)}</span>
          </div>
          {tachado && (
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: c.textTertiary }}>
              {esperado.cobrado_a_mano
                ? 'Tachado a mano'
                : `Entró el ${formatFecha(ingreso.fecha).slice(0, 5)}${ingreso.accounts?.nombre ? ` en ${ingreso.accounts.nombre}` : ''} · ${enMoneda(Math.abs(Number(ingreso.monto)), ingreso.moneda || 'ARS')}`}
            </p>
          )}
        </div>
        {!tachado && (
          <button type="button" style={{ ...botonChico, padding: '4px 8px' }} title="Ya entró (tachar a mano)"
            aria-label={`Ya entró ${esperado.concepto}`} onClick={() => marcarAMano(esperado, true)}>✓</button>
        )}
        {tachado && esperado.cobrado_a_mano && (
          <button type="button" style={{ ...botonChico, padding: '4px 8px' }} title="Destachar"
            aria-label={`Destachar ${esperado.concepto}`} onClick={() => marcarAMano(esperado, false)}>↺</button>
        )}
        <button type="button" style={{ ...botonChico, border: 'none', color: c.textTertiary, fontSize: '18px', padding: '2px 4px' }}
          aria-label={`Borrar ${esperado.concepto}`} onClick={() => borrar(esperado)}>×</button>
      </div>
    )
  }

  const textoFalta = totalesEnTexto(totales.falta)
  const textoEntro = totalesEnTexto(totales.entro)

  return (
    <div style={caja}>
      <p style={rotulo}>Ingresos a futuro</p>
      <p style={{ fontSize: '12px', color: c.textSecondary, margin: '0 0 10px' }}>
        Lo que esperás cobrar. No toca tus cuentas: cuando el ingreso aparece en una cuenta, se tacha solo.
      </p>

      {propios.length > 0 && (
        <div style={{ fontSize: '13px', margin: '0 0 8px', ...NUMEROS }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <span>Falta entrar</span><strong style={{ whiteSpace: 'nowrap' }}>{textoFalta || enMoneda(0, 'ARS')}</strong>
          </div>
          {textoEntro && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', color: c.textSecondary }}>
              <span>Ya entró</span><span style={{ whiteSpace: 'nowrap' }}>{textoEntro}</span>
            </div>
          )}
        </div>
      )}

      {cargando && propios.length === 0 && <p style={{ fontSize: '13px', color: c.textTertiary, margin: '0 0 8px' }}>Cargando…</p>}
      {pendientes.map(e => fila(e, false))}
      {entrados.length > 0 && (
        <>
          <button type="button" onClick={() => setVerEntrados(v => !v)} aria-expanded={verEntrados}
            style={{ background: 'none', border: 'none', padding: '8px 0 0', cursor: 'pointer', color: c.textSecondary, fontSize: '12px', fontFamily: 'inherit' }}>
            {verEntrados ? '▾' : '▸'} Ya entraron ({entrados.length})
          </button>
          {verEntrados && entrados.map(e => fila(e, true))}
        </>
      )}

      <form onSubmit={agregar} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '12px' }}>
        <input aria-label="Qué es" placeholder="Qué es (ej: cliente)" value={form.concepto} maxLength={LARGO_MAXIMO_CONCEPTO}
          onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))} style={{ ...input, padding: '8px', gridColumn: '1 / -1' }} />
        <input aria-label="Monto esperado" placeholder="Monto" type="text" inputMode="decimal" autoComplete="off" value={form.monto}
          onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} style={{ ...input, padding: '8px' }} />
        <select aria-label="Moneda" value={form.moneda} onChange={e => setForm(f => ({ ...f, moneda: e.target.value }))} style={{ ...input, padding: '8px' }}>
          {MONEDAS.map(m => <option key={m} value={m}>{SIMBOLO[m]} {m}</option>)}
        </select>
        <input aria-label="Fecha esperada" type="date" value={form.fecha}
          onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} style={{ ...input, padding: '8px' }} />
        <button type="submit" disabled={guardando} style={{ ...botonChico, padding: '8px', color: c.primary, fontWeight: 600 }}>
          {guardando ? 'Guardando…' : '+ Anotar'}
        </button>
      </form>
      {error && <p role="alert" style={{ fontSize: '12px', color: sem.negativo, margin: '8px 0 0' }}>{error}</p>}
    </div>
  )
}

export default IngresosFuturos
