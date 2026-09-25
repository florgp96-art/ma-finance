import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMonto, formatFecha } from '../lib/formato'
import { repartoDelMes, cuotasDelMes, rangoDelMes, montoValido, moverMes, nombreDelMes, socioDeLaCuenta, porcentajesTrabajo } from '../lib/repartoSocios'

const hoyLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const mesLocal = () => hoyLocal().slice(0, 7)
const NBSP = '\u00A0'
const pesos = (n) => `$${NBSP}${formatMonto(Math.round(Math.abs(n)))}`
const conSigno = (signo, n) => `${signo}${NBSP}${pesos(n)}`
const SIMBOLO = { ARS: '$', USD: 'U$S', EUR: '€' }
// Con centavos, siempre dos: "€ 12,50", no "€ 12,5".
const enMoneda = (monto, moneda = 'ARS') => {
  const decimales = Number.isInteger(Math.round(monto * 100) / 100) ? 0 : 2
  const numero = new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: 2 }).format(monto)
  return `${SIMBOLO[moneda] || moneda}${NBSP}${numero}`
}
const listaDeNombres = (nombres) => nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres.join('')

// Calculadora del reparto entre socios (ver src/lib/repartoSocios.js). Lee los
// movimientos del mes elegido; lo que no está en la base —lo que ya se pasaron
// entre ellos y la cotización con la que cerraron— se guarda por mes en la
// configuración.
//
// La cotización no se elige: es el promedio entre compra y venta del blue para
// el dólar y del euro (cotizacionesVivas, la misma que muestra "Monedas"). Queda
// fija en el mes cuando se registra el primer pago: si siguiera la del día, un
// mes ya pagado cambiaría con el dólar y aparecerían pagos nuevos de diferencia.
//
// La cotización se guarda DENTRO del pago que la fijó, no aparte en el mes: así,
// si ese pago se borra (un "Hecho" tocado sin querer), el mes vuelve solo a la
// cotización del día. Guardada aparte, borrar el pago la dejaba fija igual.
function RepartoSocios({ config, onCambiarConfig, accounts, userId, cotizacionesVivas, refreshKey, styles, darkMode, sem, onCerrar }) {
  const [mes, setMes] = useState(mesLocal)
  const [movimientos, setMovimientos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [nueva, setNueva] = useState({ de: config.socios[0], a: config.socios[1], monto: '' })
  const [nuevaCuota, setNuevaCuota] = useState({ movimientoId: '', porMes: '' })
  const [nuevoTrabajo, setNuevoTrabajo] = useState({ movimientoId: '', propio: '50' })

  const delMes = config.meses?.[mes] || {}

  useEffect(() => {
    const rango = rangoDelMes(mes)
    if (!rango || !userId) { setMovimientos([]); setCargando(false); return undefined }
    let vigente = true
    setCargando(true)
    setError(null)
    supabase.from('transactions').select('id, account_id, tipo, moneda, monto, nombre')
      .eq('user_id', userId).gte('fecha', rango.desde).lt('fecha', rango.hasta)
      .then(({ data, error: err }) => {
        if (!vigente) return
        if (err) setError('No se pudieron leer los movimientos del mes. Probá de nuevo.')
        setMovimientos(data || [])
        setCargando(false)
      })
    return () => { vigente = false }
  }, [mes, userId, refreshKey])

  const cuotas = Array.isArray(config.cuotas) ? config.cuotas : []
  const r = repartoDelMes({ config, mes, movimientos, cuentas: accounts, cotizacionesVivas })
  const { fija, cotizaciones, transferencias } = r

  const trabajos = Array.isArray(config.trabajos) ? config.trabajos : []

  // Movimientos de este mes de algún socio. Un gasto se puede pasar a cuotas, y un
  // ingreso o gasto a "trabajo por fuera", pero no las dos cosas a la vez.
  const enCuotas = new Set(cuotas.map(c => c.movimientoId))
  const enTrabajos = new Set(trabajos.map(t => t.movimientoId))
  const cuentaPorId = new Map((accounts || []).map(a => [a.id, a]))
  const deSocios = movimientos
    .filter(t => (t.tipo === 'gasto' || t.tipo === 'ingreso') && !enCuotas.has(t.id) && !enTrabajos.has(t.id))
    .map(t => ({ ...t, socio: socioDeLaCuenta(cuentaPorId.get(t.account_id), config.socios) }))
    .filter(t => t.socio)
  const gastosParaCuotas = deSocios.filter(t => t.tipo === 'gasto')
  const gastoElegido = gastosParaCuotas.find(t => t.id === nuevaCuota.movimientoId)
  const guardarCuotas = (lista) => onCambiarConfig({ ...config, cuotas: lista })
  const agregarCuota = (e) => {
    e.preventDefault()
    const porMes = montoValido(nuevaCuota.porMes)
    if (!gastoElegido || !porMes) return
    guardarCuotas([...cuotas, {
      movimientoId: gastoElegido.id,
      concepto: gastoElegido.nombre || 'Gasto',
      pagoDe: gastoElegido.socio,
      monto: Math.abs(Number(gastoElegido.monto) || 0),
      moneda: gastoElegido.moneda || 'ARS',
      desde: mes,
      porMes,
    }])
    setNuevaCuota({ movimientoId: '', porMes: '' })
  }
  // Trabajos por fuera: quien lo hizo (el dueño de la cuenta) se queda con
  // `propio` % y el resto va parejo a los demás.
  const trabajoElegido = deSocios.find(t => t.id === nuevoTrabajo.movimientoId)
  const propioValido = Number(nuevoTrabajo.propio) >= 0 && Number(nuevoTrabajo.propio) <= 100 && nuevoTrabajo.propio !== ''
  const guardarTrabajos = (lista) => onCambiarConfig({ ...config, trabajos: lista })
  const agregarTrabajo = (e) => {
    e.preventDefault()
    if (!trabajoElegido || !propioValido) return
    guardarTrabajos([...trabajos, {
      movimientoId: trabajoElegido.id,
      concepto: trabajoElegido.nombre || (trabajoElegido.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'),
      socio: trabajoElegido.socio,
      porcentajes: porcentajesTrabajo(trabajoElegido.socio, config.socios, Number(nuevoTrabajo.propio)),
    }])
    setNuevoTrabajo(n => ({ ...n, movimientoId: '' }))
  }
  const movimientoPorId = new Map(movimientos.map(t => [t.id, t]))
  const trabajosDelMes = trabajos
    .map((t, i) => ({ ...t, indice: i, movimiento: movimientoPorId.get(t.movimientoId) }))
    .filter(t => t.movimiento)
  const textoPorcentajes = (porcentajes) => config.socios
    .filter(s => Number(porcentajes?.[s]) > 0)
    .map(s => `${s} ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(porcentajes[s]))} %`)
    .join(' · ')
  const hayTrabajos = Math.abs(r.netoTrabajos) >= 1

  const estadoDeCuota = (c) => {
    const delMes = cuotasDelMes({ cuotas: [c], socios: config.socios, mes })
    if (delMes.length) {
      const [primera] = delMes
      return `Cuota ${primera.numero} de ${primera.total}: ${listaDeNombres(delMes.map(x => x.de))} le devuelven ${enMoneda(primera.monto, primera.moneda)} cada uno.`
    }
    return mes < c.desde ? `Arranca en ${nombreDelMes(c.desde)}.` : 'Ya está devuelto ✓'
  }

  const guardarMes = (cambios) => {
    onCambiarConfig({ ...config, meses: { ...config.meses, [mes]: { ...delMes, ...cambios } } })
  }
  // Cada pago guarda la cotización con la que se hizo (la fija si ya había una):
  // el primero que quede es el que fija el mes.
  const agregarTransferencia = (tr) => guardarMes({
    transferencias: [...transferencias, {
      ...tr, cotizacion: fija || { usd: cotizaciones.USD, eur: cotizaciones.EUR, fecha: hoyLocal() },
    }],
  })
  const quitarTransferencia = (i) => guardarMes({ transferencias: transferencias.filter((_, k) => k !== i) })

  const errorNueva = nueva.de === nueva.a ? 'Elegí dos socios distintos.' : null
  const agregarNueva = (e) => {
    e.preventDefault()
    const monto = montoValido(nueva.monto)
    if (errorNueva || !monto) return
    agregarTransferencia({ de: nueva.de, a: nueva.a, monto: Math.round(monto * 100) / 100 })
    setNueva(n => ({ ...n, monto: '' }))
  }

  const muted = darkMode ? '#9A8A9A' : '#75757a'
  const txt = darkMode ? '#F0EDEC' : '#1d1d1f'
  const borde = darkMode ? '#3A333A' : '#E2DDE0'
  const caja = { border: `1px solid ${borde}`, borderRadius: '10px', padding: '12px', marginBottom: '14px' }
  const rotulo = { fontSize: '11px', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' }
  const fila = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', fontSize: '13px', color: txt, margin: '3px 0' }
  const botonChico = { background: 'none', border: `1px solid ${borde}`, borderRadius: '6px', color: txt, cursor: 'pointer', fontSize: '12px', padding: '4px 8px', whiteSpace: 'nowrap' }
  const flecha = { ...botonChico, fontSize: '20px', lineHeight: 1, padding: '6px 14px' }

  return (
    <div>
      <p style={{ fontSize: '12px', color: muted, margin: '0 0 14px 0' }}>
        Todo lo que entró en el mes menos lo que se gastó, en partes iguales. Cada cuenta es del socio con el que empieza su nombre.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '12px' }}>
        <button type="button" style={flecha} aria-label="Mes anterior" onClick={() => setMes(m => moverMes(m, -1))}>‹</button>
        <span style={{ fontSize: '16px', fontWeight: 600, color: txt }}>{nombreDelMes(mes)}</span>
        <button type="button" style={flecha} aria-label="Mes siguiente" onClick={() => setMes(m => moverMes(m, 1))}>›</button>
      </div>

      <div style={{ ...caja, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '4px 10px' }}>
        <div>
          <p style={{ ...rotulo, margin: '0 0 2px' }}>Dólar blue</p>
          <p style={{ fontSize: '16px', fontWeight: 600, color: txt, margin: 0 }}>{cotizaciones.USD ? pesos(cotizaciones.USD) : 'Sin cotización'}</p>
        </div>
        <div>
          <p style={{ ...rotulo, margin: '0 0 2px' }}>Euro</p>
          <p style={{ fontSize: '16px', fontWeight: 600, color: txt, margin: 0 }}>{cotizaciones.EUR ? pesos(cotizaciones.EUR) : 'Sin cotización'}</p>
        </div>
        <p style={{ gridColumn: '1 / -1', fontSize: '11px', color: muted, margin: '6px 0 0' }}>
          {fija
            ? `Promedio entre compra y venta del ${formatFecha(fija.fecha)}: quedó fijo con el primer pago del mes. Si se borra ese pago, vuelve a la de hoy.`
            : 'Promedio entre compra y venta de hoy. Queda fijo cuando se registre el primer pago del mes.'}
        </p>
      </div>

      {error && <p style={{ fontSize: '13px', color: sem.negativo, margin: '0 0 12px 0' }}>{error}</p>}
      {r.sinCotizacion.length > 0 && (
        <p style={{ fontSize: '12px', color: sem.negativo, margin: '0 0 12px 0' }}>
          Falta la cotización de {r.sinCotizacion.join(' y ')}: esos movimientos no entran en la cuenta.
        </p>
      )}
      {r.sinSocio.length > 0 && (
        <p style={{ fontSize: '12px', color: sem.negativo, margin: '0 0 12px 0' }}>
          {r.sinSocio.join(', ')}: el nombre no empieza con el de ningún socio ({config.socios.join(', ')}), así que sus movimientos no entran en la cuenta.
        </p>
      )}

      {cargando ? (
        <p style={{ fontSize: '13px', color: muted }}>Cargando movimientos…</p>
      ) : (
        <>
          <div style={caja}>
            <p style={rotulo}>El mes</p>
            <div style={fila}><span>Ingresos</span><span>{pesos(r.ingresos)}</span></div>
            <div style={fila}><span>Gastos</span><span>{conSigno('−', r.gastos)}</span></div>
            <div style={fila}><span>Neto</span><span>{r.neto < 0 ? conSigno('−', r.neto) : pesos(r.neto)}</span></div>
            {hayTrabajos && (
              <div style={{ ...fila, color: muted }}><span>De trabajos por fuera (va aparte)</span><span>{r.netoTrabajos < 0 ? conSigno('−', r.netoTrabajos) : pesos(r.netoTrabajos)}</span></div>
            )}
            <div style={{ ...fila, marginTop: '8px', fontSize: '15px', fontWeight: 700 }}>
              <span>{hayTrabajos ? 'Parte común, a cada uno' : 'A cada uno'}</span><span>{r.parte < 0 ? conSigno('−', r.parte) : pesos(r.parte)}</span>
            </div>
          </div>

          <div style={caja}>
            <p style={rotulo}>Cada socio</p>
            {r.porSocio.map((s, i) => (
              <div key={s.socio} style={{ padding: '6px 0', borderBottom: i < r.porSocio.length - 1 ? `1px solid ${borde}` : 'none' }}>
                <div style={{ ...fila, fontWeight: 600 }}>
                  <span>{s.socio}</span>
                  <span style={{ color: s.diferencia >= 1 ? sem.negativo : s.diferencia <= -1 ? sem.positivo : muted }}>
                    {s.diferencia >= 1 ? `da ${pesos(s.diferencia)}` : s.diferencia <= -1 ? `recibe ${pesos(s.diferencia)}` : 'a mano'}
                  </span>
                </div>
                <div style={{ ...fila, color: muted, fontSize: '12px' }}>
                  <span>Cobró {pesos(s.cobro)} · Pagó {pesos(s.pago)}{s.transferencias ? ` · Entre ustedes ${conSigno(s.transferencias > 0 ? '+' : '−', s.transferencias)}` : ''}{Math.abs(s.cuotas) >= 1 ? ` · Cuotas ${conSigno(s.cuotas > 0 ? '+' : '−', s.cuotas)}` : ''}{Math.abs(s.trabajos) >= 1 ? ` · Trabajos por fuera ${conSigno(s.trabajos > 0 ? '+' : '−', s.trabajos)}` : ''}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={caja}>
            <p style={rotulo}>Para cerrar el mes</p>
            {r.pagos.length === 0 ? (
              <p style={{ fontSize: '13px', color: sem.positivo, margin: 0 }}>Están todos a mano ✓</p>
            ) : r.pagos.map(p => (
              <div key={`${p.de}-${p.a}`} style={fila}>
                <span><strong>{p.de}</strong> le da a <strong>{p.a}</strong> {pesos(p.monto)}</span>
                <button type="button" style={botonChico} onClick={() => agregarTransferencia(p)}>Hecho</button>
              </div>
            ))}
          </div>

          <div style={caja}>
            <p style={rotulo}>Lo que ya se pasaron este mes</p>
            {transferencias.length === 0 && <p style={{ fontSize: '12px', color: muted, margin: '0 0 8px' }}>Nada todavía.</p>}
            {transferencias.map((t, i) => (
              <div key={i} style={fila}>
                <span>{t.de} → {t.a} {pesos(t.monto)}</span>
                <button type="button" style={{ ...botonChico, border: 'none', color: muted }} aria-label="Quitar" onClick={() => quitarTransferencia(i)}>×</button>
              </div>
            ))}
            <form onSubmit={agregarNueva} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '10px' }}>
              <select style={styles.input} value={nueva.de} onChange={e => setNueva(n => ({ ...n, de: e.target.value }))} aria-label="Quién da">
                {config.socios.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select style={styles.input} value={nueva.a} onChange={e => setNueva(n => ({ ...n, a: e.target.value }))} aria-label="A quién">
                {config.socios.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input style={styles.input} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="$"
                value={nueva.monto} onChange={e => setNueva(n => ({ ...n, monto: e.target.value }))} aria-label="Monto en pesos" />
              <button type="submit" style={{ ...botonChico, fontSize: '14px', padding: '11px' }} disabled={!!errorNueva || !montoValido(nueva.monto)}>Agregar</button>
            </form>
            {errorNueva && <p style={{ fontSize: '12px', color: sem.negativo, margin: '6px 0 0' }}>{errorNueva}</p>}
          </div>

          <div style={caja}>
            <p style={rotulo}>Gastos que se devuelven en cuotas</p>
            <p style={{ fontSize: '12px', color: muted, margin: '0 0 8px' }}>
              Un gasto grande que pagó uno solo no entra entero en su mes: los demás le devuelven su parte de a poco.
            </p>
            {cuotas.map((c, i) => (
              <div key={c.movimientoId || i} style={{ ...fila, alignItems: 'flex-start' }}>
                <span>
                  <strong>{c.concepto}</strong> · pagó {c.pagoDe} {enMoneda(c.monto, c.moneda)} · {enMoneda(c.porMes, c.moneda)} por mes
                  <br /><span style={{ fontSize: '12px', color: muted }}>{estadoDeCuota(c)}</span>
                </span>
                <button type="button" style={{ ...botonChico, border: 'none', color: muted }} aria-label={`Quitar ${c.concepto}`}
                  onClick={() => guardarCuotas(cuotas.filter((_, k) => k !== i))}>×</button>
              </div>
            ))}
            {gastosParaCuotas.length > 0 && (
              <form onSubmit={agregarCuota} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '10px' }}>
                <select style={{ ...styles.input, gridColumn: '1 / -1' }} value={nuevaCuota.movimientoId} aria-label="Gasto"
                  onChange={e => setNuevaCuota(n => ({ ...n, movimientoId: e.target.value }))}>
                  <option value="">— Elegí un gasto de este mes —</option>
                  {gastosParaCuotas.map((t, i) => (
                    <option key={t.id ?? i} value={t.id ?? ''} disabled={!t.id}>{t.nombre || 'Gasto'} · {t.socio} · {enMoneda(Math.abs(Number(t.monto) || 0), t.moneda || 'ARS')}</option>
                  ))}
                </select>
                <input style={styles.input} type="number" inputMode="decimal" min="0.01" step="0.01" value={nuevaCuota.porMes}
                  placeholder={`Por mes${gastoElegido ? ` (${SIMBOLO[gastoElegido.moneda || 'ARS'] || ''})` : ''}`}
                  aria-label="Cuánto se devuelve por mes, entre todos"
                  onChange={e => setNuevaCuota(n => ({ ...n, porMes: e.target.value }))} />
                <button type="submit" style={{ ...botonChico, fontSize: '14px', padding: '11px' }}
                  disabled={!gastoElegido || !montoValido(nuevaCuota.porMes)}>Agregar</button>
              </form>
            )}
          </div>

          <div style={caja}>
            <p style={rotulo}>Trabajos por fuera</p>
            <p style={{ fontSize: '12px', color: muted, margin: '0 0 8px' }}>
              Un trabajo que hizo uno solo: se queda con una parte y el resto va parejo a los demás. Se marca el ingreso y también sus gastos.
            </p>
            {trabajosDelMes.map(t => (
              <div key={t.movimientoId} style={{ ...fila, alignItems: 'flex-start' }}>
                <span>
                  <strong>{t.concepto}</strong> · {t.movimiento.tipo === 'ingreso' ? 'cobró' : 'pagó'} {t.socio} {enMoneda(Math.abs(Number(t.movimiento.monto) || 0), t.movimiento.moneda || 'ARS')}
                  <br /><span style={{ fontSize: '12px', color: muted }}>{textoPorcentajes(t.porcentajes)}</span>
                </span>
                <button type="button" style={{ ...botonChico, border: 'none', color: muted }} aria-label={`Quitar ${t.concepto}`}
                  onClick={() => guardarTrabajos(trabajos.filter((_, k) => k !== t.indice))}>×</button>
              </div>
            ))}
            {deSocios.length > 0 && (
              <form onSubmit={agregarTrabajo} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '10px' }}>
                <select style={{ ...styles.input, gridColumn: '1 / -1' }} value={nuevoTrabajo.movimientoId} aria-label="Movimiento del trabajo"
                  onChange={e => setNuevoTrabajo(n => ({ ...n, movimientoId: e.target.value }))}>
                  <option value="">— Elegí un movimiento del mes —</option>
                  {deSocios.map((t, i) => (
                    <option key={t.id ?? i} value={t.id ?? ''} disabled={!t.id}>
                      {t.tipo === 'ingreso' ? '＋' : '−'} {t.nombre || (t.tipo === 'ingreso' ? 'Ingreso' : 'Gasto')} · {t.socio} · {enMoneda(Math.abs(Number(t.monto) || 0), t.moneda || 'ARS')}
                    </option>
                  ))}
                </select>
                <input style={styles.input} type="number" inputMode="decimal" min="0" max="100" step="1" value={nuevoTrabajo.propio}
                  aria-label="Porcentaje para quien hizo el trabajo" placeholder="% propio"
                  onChange={e => setNuevoTrabajo(n => ({ ...n, propio: e.target.value }))} />
                <button type="submit" style={{ ...botonChico, fontSize: '14px', padding: '11px' }}
                  disabled={!trabajoElegido || !propioValido}>Agregar</button>
                <p style={{ gridColumn: '1 / -1', fontSize: '11px', color: muted, margin: 0 }}>
                  {trabajoElegido && propioValido
                    ? textoPorcentajes(porcentajesTrabajo(trabajoElegido.socio, config.socios, Number(nuevoTrabajo.propio)))
                    : '% para quien lo hizo; el resto va parejo a los demás.'}
                </p>
              </form>
            )}
          </div>
        </>
      )}

      <div style={styles.modalButtons}>
        <button type="button" style={styles.cancelBtn} onClick={onCerrar}>Cerrar</button>
      </div>
    </div>
  )
}

export default RepartoSocios
