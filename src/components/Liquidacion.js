import React, { useCallback, useEffect, useRef, useState } from 'react'
import { formatMonto, formatCantidad, diaDeLaSemana } from '../lib/formato'
import { nombreDelMes, moverMes } from '../lib/repartoSocios'
import {
  CAMPOS_TARIFA, LARGO_MAXIMO_NOMBRE, LIMITES, TARIFAS_EN_CERO, aCentavos, claveValida, diasDelMes, historialCerrados,
  mesDelTrabajo, mesParaAbrir, modalidadDe, montoHeredado, nombreValido, nuevoDia, numeroValido, ordenarDias, resumenMes,
  subtotalDia, tarifasDe, tarifasHeredadas, totalDelMes,
} from '../lib/liquidacion'
import * as datos from '../lib/liquidacionDatos'
import IngresosFuturos from './IngresosFuturos'
import { conReintento } from '../lib/colaGuardado'
import useGuardado from '../hooks/useGuardado'
import { paleta, semaforo } from '../theme'

const pesos = (n) => `$ ${formatMonto(Math.round(Number(n) || 0))}`
const cuantos = (n, singular, plural) => `${formatCantidad(n)} ${n === 1 ? singular : plural}`
const NUMEROS = { fontVariantNumeric: 'tabular-nums' }
const ROTULO_TARIFA = { valor_hora: 'Hora', valor_viatico: 'Viático (por viaje)', valor_jornada: 'Jornada' }
const redondear = (n) => Math.round(n * 100) / 100

const aDia = (fila) => ({ ...fila, dia: Number(fila.dia), horas: Number(fila.horas) || 0, viajes: Number(fila.viajes) || 0 })
const aMes = (fila) => ({
  ...fila,
  ...tarifasDe(fila),
  ...(fila.monto === undefined ? {} : { monto: Number(fila.monto) || 0 }),
  total_cerrado: fila.total_cerrado === null || fila.total_cerrado === undefined ? null : Number(fila.total_cerrado),
})

// Input numérico que no pierde lo que se está tipeando: guarda el texto aparte y
// solo avisa (onValor) con números válidos. Al salir, si quedó algo inválido,
// vuelve al último valor bueno. Con `alConfirmar` avisa recién al salir (el
// número de día: cambiarlo en cada tecla reordenaría la lista mientras se tipea).
function CampoNumero({ valor, onValor, onSalir, min = 0, max, entero = false, alConfirmar = false, ...resto }) {
  const [texto, setTexto] = useState(String(valor))
  const [enfocado, setEnfocado] = useState(false)
  const limites = { min, max, entero }

  useEffect(() => { if (!enfocado) setTexto(String(valor)) }, [valor, enfocado])

  return (
    <input
      type="text" inputMode={entero ? 'numeric' : 'decimal'} autoComplete="off"
      value={texto}
      aria-invalid={numeroValido(texto, limites) === null || undefined}
      onFocus={() => setEnfocado(true)}
      onChange={e => {
        setTexto(e.target.value)
        const n = numeroValido(e.target.value, limites)
        if (!alConfirmar && n !== null) onValor(n)
      }}
      onBlur={() => {
        setEnfocado(false)
        const n = numeroValido(texto, limites)
        if (n === null) setTexto(String(valor))
        else if (alConfirmar && n !== valor) onValor(n)
        onSalir?.()
      }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      {...resto}
    />
  )
}

function FilaDia({ fila, clave, tarifas, soloLectura, estilos, onCambiarDia, onCambiarTipo, onCambiarCantidad, onBorrar, onSalir }) {
  const { c, input, botonChico, rotuloCampo } = estilos
  const jornada = fila.tipo === 'jornada'
  const rotuloHoras = jornada ? 'Hs extra' : 'Horas'
  const rotuloViajes = jornada ? 'Viajes extra' : 'Viajes'
  return (
    <div data-testid={`dia-${fila.id}`} style={{ padding: '10px 0', borderBottom: `1px solid ${c.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <CampoNumero
          aria-label="Día" valor={fila.dia} entero min={1} max={diasDelMes(clave) || 31} alConfirmar
          disabled={soloLectura} onValor={n => onCambiarDia(fila, n)}
          style={{ ...input, width: '52px', flexShrink: 0, padding: '8px 4px', textAlign: 'center' }}
        />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px', color: c.textSecondary }}>{diaDeLaSemana(clave, fila.dia)}</span>
        <button
          type="button" style={{ ...botonChico, flexShrink: 0, padding: '6px 8px', ...(jornada ? { background: c.primarySoft, border: `1px solid ${c.primary}` } : {}) }}
          disabled={soloLectura}
          title={jornada ? 'Pasar a por hora' : 'Pasar a jornada'}
          onClick={() => onCambiarTipo(fila)}
        >
          {jornada ? 'Jornada' : 'Por hora'}
        </button>
        <span style={{ flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: c.text, ...NUMEROS }}>{pesos(subtotalDia(fila, tarifas))}</span>
        {!soloLectura && (
          <button type="button" style={{ ...botonChico, flexShrink: 0, border: 'none', color: c.textTertiary, fontSize: '18px', padding: '2px 4px' }}
            aria-label={`Borrar el día ${fila.dia}`} onClick={() => onBorrar(fila)}>×</button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px', marginTop: '8px' }}>
        <label style={rotuloCampo}>
          {rotuloHoras}
          <CampoNumero
            aria-label={`${rotuloHoras} del día ${fila.dia}`} valor={fila.horas} step="0.5" max={LIMITES.horas}
            disabled={soloLectura} onValor={n => onCambiarCantidad(fila, 'horas', redondear(n))} onSalir={onSalir}
            style={{ ...input, padding: '8px' }}
          />
        </label>
        <label style={rotuloCampo}>
          {rotuloViajes}
          <CampoNumero
            aria-label={`${rotuloViajes} del día ${fila.dia}`} valor={fila.viajes} entero step="1" max={LIMITES.viajes}
            disabled={soloLectura} onValor={n => onCambiarCantidad(fila, 'viajes', n)} onSalir={onSalir}
            style={{ ...input, padding: '8px' }}
          />
        </label>
      </div>
    </div>
  )
}

const ETIQUETA_TIPO = { pago: 'La pagás vos', cobro: 'Te la pagan' }
const ETIQUETA_MODALIDAD = { horas: 'Por hora', mensual: 'Monto mensual', unico: 'Trabajo único' }

// Nombre, tipo y modalidad de la liquidación, y borrarla. Se abre con el lápiz del
// título, y solo al crear una nueva (que todavía se llama "Nueva liquidación").
function EditarLiquidacion({ liquidacion, cantidadMeses, estilos, onGuardar, onBorrar, onCerrar }) {
  const { c, input, botonChico, rotuloCampo, caja, sem } = estilos
  const [nombre, setNombre] = useState(liquidacion.nombre)
  const [tipo, setTipo] = useState(liquidacion.tipo)
  const [modalidad, setModalidad] = useState(modalidadDe(liquidacion))
  // Sin la columna (la migración de la modalidad todavía no se corrió) no se ofrece:
  // no habría dónde guardarla.
  const conModalidad = 'modalidad' in liquidacion
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const guardar = async (e) => {
    e.preventDefault()
    const limpio = nombreValido(nombre)
    if (!limpio) { setError(`Poné un nombre (hasta ${LARGO_MAXIMO_NOMBRE} letras).`); return }
    setGuardando(true)
    setError(null)
    // Si sale bien el formulario se cierra: solo se toca el estado cuando falla.
    const fallo = await onGuardar({ nombre: limpio, tipo, ...(conModalidad ? { modalidad } : {}) })
    if (fallo) { setGuardando(false); setError(fallo) }
  }

  const borrar = async () => {
    const meses = cantidadMeses === 1 ? '1 mes' : `${cantidadMeses} meses`
    const conMeses = cantidadMeses > 0 ? ` con sus ${meses}` : ''
    if (!window.confirm(`¿Borrar "${liquidacion.nombre}"${conMeses}? No se puede deshacer.`)) return
    const fallo = await onBorrar()
    if (fallo) setError(fallo)
  }

  return (
    <form onSubmit={guardar} style={{ ...caja, marginTop: '12px' }}>
      <label style={rotuloCampo}>
        Nombre
        <input autoFocus value={nombre} maxLength={LARGO_MAXIMO_NOMBRE} onChange={e => setNombre(e.target.value)}
          placeholder="Ej: Sueldo de Renata, Clases de inglés" style={{ ...input, padding: '8px' }} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' }}>
        {Object.entries(ETIQUETA_TIPO).map(([valor, etiqueta]) => (
          <button key={valor} type="button" aria-pressed={tipo === valor} onClick={() => setTipo(valor)}
            style={{ ...botonChico, padding: '8px', ...(tipo === valor ? { background: c.primarySoft, border: `1px solid ${c.primary}`, fontWeight: 600 } : {}) }}>
            {valor === 'pago' ? '🧾' : '💰'} {etiqueta}
          </button>
        ))}
      </div>
      {conModalidad && (
        <div role="group" aria-label="Cómo se liquida" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', marginTop: '8px' }}>
          {Object.entries(ETIQUETA_MODALIDAD).map(([valor, etiqueta]) => (
            <button key={valor} type="button" aria-pressed={modalidad === valor} onClick={() => setModalidad(valor)}
              style={{ ...botonChico, padding: '8px 4px', whiteSpace: 'normal', ...(modalidad === valor ? { background: c.primarySoft, border: `1px solid ${c.primary}`, fontWeight: 600 } : {}) }}>
              {etiqueta}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" style={{ fontSize: '12px', color: sem.negativo, margin: '8px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        <button type="submit" disabled={guardando} style={{ ...botonChico, flex: 1, padding: '8px', color: c.primary, fontWeight: 600 }}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" onClick={onCerrar} style={{ ...botonChico, flex: 1, padding: '8px' }}>Cancelar</button>
      </div>
      <button type="button" onClick={borrar}
        style={{ background: 'none', border: 'none', padding: '10px 0 0', cursor: 'pointer', color: c.textTertiary, fontSize: '12px', textDecoration: 'underline', fontFamily: 'inherit' }}>
        Borrar esta liquidación
      </button>
    </form>
  )
}

// Una liquidación mensual —el sueldo de la empleada, o lo que se cobra por un trabajo
// propio— (ver lib/liquidacion.js para las cuentas). Todo se guarda en Supabase a
// medida que se toca (ver lib/colaGuardado.js): lo estructural en el momento y lo que
// se tipea a los 500 ms como mucho. La pantalla cambia antes de que vuelva la
// respuesta; si Supabase falla dos veces, lo estructural se deshace y lo tipeado
// queda en pantalla con un "Reintentar".
function Liquidacion({ userId, liquidacion, editarAlAbrir = false, darkMode, styles, onCambiada, onBorrada }) {
  const liquidacionId = liquidacion?.id
  const modalidad = modalidadDe(liquidacion)
  const porHora = modalidad === 'horas'
  const unico = modalidad === 'unico'
  const { cola, estado } = useGuardado()
  const [meses, setMesesEstado] = useState([])
  const [dias, setDiasEstado] = useState([])
  const [clave, setClave] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [tarifasAbiertas, setTarifasAbiertas] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [editando, setEditando] = useState(editarAlAbrir)

  // Espejos del estado: las escrituras y los deshacer leen el valor de ahora, no
  // el del render en que se armó el handler.
  const mesesRef = useRef([])
  const diasRef = useRef([])
  const mesIdRef = useRef(null)
  const pedidoRef = useRef(0)
  const destinoRef = useRef(null)

  const setMeses = useCallback((cambio) => {
    mesesRef.current = typeof cambio === 'function' ? cambio(mesesRef.current) : cambio
    setMesesEstado(mesesRef.current)
  }, [])
  const setDias = useCallback((cambio) => {
    diasRef.current = typeof cambio === 'function' ? cambio(diasRef.current) : cambio
    setDiasEstado(diasRef.current)
  }, [])
  const cambiarFila = useCallback((id, cambios) => {
    setDias(ds => ds.map(d => (d.id === id ? { ...d, ...cambios } : d)))
  }, [setDias])

  const mes = meses.find(m => m.clave === clave) || null
  mesIdRef.current = mes?.id ?? null
  const cerrado = !!mes?.cerrado
  const soloLectura = cerrado || cargando || !mes

  const irAMes = useCallback(async (nueva) => {
    if (!claveValida(nueva) || !userId || !liquidacionId) return
    const pedido = ++pedidoRef.current
    destinoRef.current = nueva
    setCargando(true)
    setErrorCarga(null)
    setAviso(null)
    await cola.vaciar()
    let destino = mesesRef.current.find(m => m.clave === nueva)
    if (!destino) {
      const fila = {
        id: datos.nuevoId(), user_id: userId, liquidacion_id: liquidacionId, clave: nueva,
        ...tarifasHeredadas(mesesRef.current, nueva, TARIFAS_EN_CERO),
        // Solo fuera de "por hora": antes de la migración la columna no existe.
        ...(modalidad === 'horas' ? {} : { monto: montoHeredado(mesesRef.current, nueva, modalidad) }),
      }
      let respuesta = await conReintento(() => datos.crearMes(fila))
      // Lo pudo haber creado otra pestaña o el celular: se usa ese.
      if (respuesta.error?.code === '23505') respuesta = await conReintento(() => datos.leerMesPorClave(liquidacionId, nueva))
      if (pedido !== pedidoRef.current) return
      if (respuesta.error || !respuesta.data) {
        setErrorCarga(`No se pudo abrir ${nombreDelMes(nueva)}.`)
        setCargando(false)
        return
      }
      destino = aMes(respuesta.data)
      setMeses(ms => [...ms.filter(m => m.clave !== destino.clave), destino])
    }
    const { data: filas, error } = await conReintento(() => datos.leerDias(destino.id))
    if (pedido !== pedidoRef.current) return
    if (error) {
      setErrorCarga(`No se pudieron leer los días de ${nombreDelMes(nueva)}.`)
      setCargando(false)
      return
    }
    setDias((filas || []).map(aDia))
    setClave(nueva)
    setCargando(false)
  }, [cola, userId, liquidacionId, modalidad, setMeses, setDias])

  const mesQueSeAbre = useCallback(() =>
    (modalidad === 'unico' ? mesDelTrabajo(mesesRef.current) : mesParaAbrir(mesesRef.current)), [modalidad])

  const cargarTodo = useCallback(async () => {
    if (!userId || !liquidacionId) return
    const pedido = ++pedidoRef.current
    setCargando(true)
    setErrorCarga(null)
    const { data, error } = await conReintento(() => datos.leerMeses(liquidacionId))
    if (pedido !== pedidoRef.current) return
    if (error) {
      setErrorCarga('No se pudo leer la liquidación.')
      setCargando(false)
      return
    }
    setMeses((data || []).map(aMes))
    irAMes(mesQueSeAbre())
  }, [userId, liquidacionId, irAMes, mesQueSeAbre, setMeses])

  useEffect(() => { cargarTodo() }, [cargarTodo])

  const sumarDia = () => {
    if (soloLectura) return
    const fila = { id: datos.nuevoId(), mes_id: mes.id, ...nuevoDia(diasRef.current, clave), created_at: new Date().toISOString() }
    setAviso(null)
    setDias(ds => [...ds, fila])
    cola.ahora(`dia:${fila.id}`, () => datos.insertarDia(fila)).then(error => {
      if (!error) return
      cola.descartar(`dia:${fila.id}`)
      setDias(ds => ds.filter(d => d.id !== fila.id))
      setAviso('No se pudo agregar el día. Probá de nuevo.')
    })
  }

  const borrarDia = (fila) => {
    setAviso(null)
    cola.descartar(`dia:${fila.id}`)
    setDias(ds => ds.filter(d => d.id !== fila.id))
    cola.ahora(`dia:${fila.id}`, () => datos.borrarDia(fila.id)).then(error => {
      if (!error) return
      if (mesIdRef.current === fila.mes_id) {
        setDias(ds => (ds.some(d => d.id === fila.id) ? ds : [...ds, fila]))
        // Lo tipeado en esa fila se había descartado con el borrado: se vuelve a mandar.
        cola.programar(`dia:${fila.id}`, () => datos.actualizarDia(fila.id, { horas: fila.horas, viajes: fila.viajes }))
      }
      setAviso(`No se pudo borrar el día ${fila.dia}. Volvió a la lista.`)
    })
  }

  // Cambio estructural de una fila: se ve ya, se guarda ya y, si falla, vuelve atrás.
  const cambiarYGuardar = (fila, cambios, mensajeError) => {
    const antes = Object.fromEntries(Object.keys(cambios).map(k => [k, fila[k]]))
    setAviso(null)
    cambiarFila(fila.id, cambios)
    cola.ahora(`dia:${fila.id}`, () => datos.actualizarDia(fila.id, cambios)).then(error => {
      if (!error) return
      if (mesIdRef.current === fila.mes_id) cambiarFila(fila.id, antes)
      setAviso(mensajeError)
    })
  }

  const cambiarTipo = (fila) => {
    const tipo = fila.tipo === 'jornada' ? 'horas' : 'jornada'
    cambiarYGuardar(fila, { tipo }, 'No se pudo cambiar el tipo del día. Quedó como estaba.')
  }

  const cambiarNumeroDia = (fila, dia) => {
    if (numeroValido(dia, { min: 1, max: diasDelMes(clave) || 31, entero: true }) === null) return
    cambiarYGuardar(fila, { dia }, `No se pudo cambiar el día ${fila.dia}. Quedó como estaba.`)
  }

  const cambiarCantidad = (fila, campo, valor) => {
    const maximo = campo === 'horas' ? LIMITES.horas : LIMITES.viajes
    if (numeroValido(valor, { min: 0, max: maximo, entero: campo === 'viajes' }) === null) return
    cambiarFila(fila.id, { [campo]: valor })
    const actual = diasRef.current.find(d => d.id === fila.id)
    if (!actual) return
    // Se mandan los dos campos: la escritura agendada es una por fila, y si solo
    // llevara el último que se tocó, tipear horas y enseguida viajes perdería las horas.
    const cambios = { horas: actual.horas, viajes: actual.viajes }
    cola.programar(`dia:${fila.id}`, () => datos.actualizarDia(fila.id, cambios))
  }

  const cambiarTarifa = (campo, valor) => {
    if (soloLectura || numeroValido(valor, { min: 0, max: LIMITES.tarifa }) === null) return
    const id = mes.id
    setMeses(ms => ms.map(m => (m.id === id ? { ...m, [campo]: redondear(valor) } : m)))
    const tarifas = tarifasDe(mesesRef.current.find(m => m.id === id))
    cola.programar(`mes:${id}`, () => datos.actualizarMes(id, tarifas))
  }

  const cambiarMonto = (valor) => {
    if (soloLectura || numeroValido(valor, { min: 0, max: LIMITES.monto }) === null) return
    const id = mes.id
    const monto = redondear(valor)
    setMeses(ms => ms.map(m => (m.id === id ? { ...m, monto } : m)))
    cola.programar(`mes:${id}`, () => datos.actualizarMes(id, { monto }))
  }

  // El trabajo único no navega entre meses: el selector cambia el mes de su fila.
  const cambiarMesDelTrabajo = async (nueva) => {
    if (soloLectura || !claveValida(nueva) || nueva === clave) return
    if (mesesRef.current.some(m => m.clave === nueva)) { irAMes(nueva); return }
    const id = mes.id
    const anterior = clave
    setAviso(null)
    setMeses(ms => ms.map(m => (m.id === id ? { ...m, clave: nueva } : m)))
    setClave(nueva)
    const error = await cola.ahora(`mes:${id}`, () => datos.actualizarMes(id, { clave: nueva }))
    if (!error) return
    setMeses(ms => ms.map(m => (m.id === id ? { ...m, clave: anterior } : m)))
    setClave(c => (c === nueva ? anterior : c))
    setAviso('No se pudo cambiar el mes del trabajo. Quedó como estaba.')
  }

  const cambiarEstadoDelMes = async (id, cambios, mensajeError) => {
    const previo = mesesRef.current.find(m => m.id === id)
    setMeses(ms => ms.map(m => (m.id === id ? { ...m, ...cambios } : m)))
    const error = await cola.ahora(`mes:${id}`, () => datos.actualizarMes(id, cambios))
    if (error && previo) {
      setMeses(ms => ms.map(m => (m.id === id ? { ...m, cerrado: previo.cerrado, total_cerrado: previo.total_cerrado } : m)))
      setAviso(mensajeError)
    }
    return !error
  }

  const cerrarMes = async () => {
    if (soloLectura || cerrando) return
    setCerrando(true)
    setAviso(null)
    const todoGuardado = await cola.vaciar()
    if (!todoGuardado) {
      setAviso('Hay cambios sin guardar. Tocá "Reintentar" antes de cerrar el mes.')
      setCerrando(false)
      return
    }
    const actual = mesesRef.current.find(m => m.id === mes.id)
    const total = aCentavos(totalDelMes({ ...actual, cerrado: false }, diasRef.current, modalidad))
    const ok = await cambiarEstadoDelMes(actual.id, { cerrado: true, total_cerrado: total }, 'No se pudo cerrar el mes. Probá de nuevo.')
    setCerrando(false)
    if (ok && !unico) irAMes(mesQueSeAbre())
  }

  // Devuelven el error para mostrar, o null si salió bien.
  const guardarLiquidacion = async (cambios) => {
    const { error } = await conReintento(() => datos.actualizarLiquidacion(liquidacionId, cambios))
    if (error) return 'No se pudo guardar. Probá de nuevo.'
    setEditando(false)
    onCambiada?.({ ...liquidacion, ...cambios })
    return null
  }

  const borrarLiquidacion = async () => {
    await cola.vaciar()
    const { error } = await conReintento(() => datos.borrarLiquidacion(liquidacionId))
    if (error) return 'No se pudo borrar. Probá de nuevo.'
    onBorrada?.(liquidacionId)
    return null
  }

  const reabrirMes = async (item) => {
    setAviso(null)
    const ok = await cambiarEstadoDelMes(item.id, { cerrado: false }, `No se pudo volver a abrir ${nombreDelMes(item.clave)}.`)
    if (ok && item.clave !== clave) irAMes(item.clave)
  }

  const c = paleta(darkMode)
  const sem = semaforo(darkMode)
  const input = { ...(styles?.input || {}), ...NUMEROS }
  const caja = { border: `1px solid ${c.border}`, borderRadius: '12px', padding: '12px', marginBottom: '14px' }
  const rotulo = { fontSize: '11px', fontWeight: 600, color: c.textTertiary, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 8px' }
  const rotuloCampo = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: c.textSecondary }
  const botonChico = { background: 'none', border: `1px solid ${c.border}`, borderRadius: '8px', color: c.text, cursor: 'pointer', fontSize: '12px', padding: '6px 10px', whiteSpace: 'nowrap', fontFamily: 'inherit' }
  const botonPrincipal = { width: '100%', padding: '12px', border: 'none', borderRadius: '10px', background: c.primary, color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
  const flecha = { ...botonChico, fontSize: '20px', lineHeight: 1, padding: '6px 12px' }
  const fila = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', fontSize: '13px', color: c.text, margin: '4px 0' }

  const ordenados = ordenarDias(dias)
  const resumen = resumenMes(dias, mes)
  const total = mes ? totalDelMes(mes, dias, modalidad) : 0
  const historial = historialCerrados(meses)
  const tarifas = tarifasDe(mes)
  // Sin ninguna tarifa (una liquidación nueva) el total no puede dar nada: se muestran
  // abiertas para que se carguen primero.
  const sinTarifas = !!mes && CAMPOS_TARIFA.every(campo => !tarifas[campo])
  const verTarifas = tarifasAbiertas || sinTarifas
  const cobro = liquidacion?.tipo === 'cobro'

  const textoEstado = estado.pendientes > 0 ? 'Guardando…'
    : (estado.fallidas > 0 || estado.error) ? 'No se pudo guardar'
      : estado.guardoAlgo ? 'Guardado' : ''

  return (
    <div style={{ color: c.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ minWidth: 0 }}>
          {/* Como el título de una cuenta: se toca para cambiarle el nombre o borrarla. */}
          <button type="button" aria-label={`Editar ${liquidacion?.nombre || 'la liquidación'}`} title="Tocar para cambiar el nombre o borrarla"
            onClick={() => setEditando(e => !e)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', maxWidth: '100%', margin: '0 0 2px', padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            <span style={{ ...rotulo, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cobro ? '💰' : '🧾'} {liquidacion?.nombre || 'Liquidación'} · {cobro ? 'cobrás' : 'pagás'}
            </span>
            <span aria-hidden="true" style={{ fontSize: '11px' }}>✏️</span>
          </button>
          <h2 style={{ fontSize: '18px', fontWeight: 500, margin: 0, color: c.text }}>{clave ? nombreDelMes(clave) : ' '}</h2>
        </div>
        <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: textoEstado === 'No se pudo guardar' ? sem.negativo : c.textTertiary, whiteSpace: 'nowrap' }}>
          <span>{textoEstado}</span>
          {estado.fallidas > 0 && estado.pendientes === 0 && (
            <button type="button" style={botonChico} onClick={() => cola.reintentar()}>Reintentar</button>
          )}
        </div>
      </div>

      {editando && liquidacion && (
        <EditarLiquidacion liquidacion={liquidacion} cantidadMeses={meses.length}
          estilos={{ c, input, botonChico, rotuloCampo, caja, sem }}
          onGuardar={guardarLiquidacion} onBorrar={borrarLiquidacion} onCerrar={() => setEditando(false)} />
      )}

      <p style={{ fontSize: '32px', fontWeight: 700, margin: '8px 0 2px', color: c.text, ...NUMEROS }}>{pesos(total)}</p>
      <p style={{ fontSize: '13px', color: c.textSecondary, margin: '0 0 14px', ...NUMEROS }}>
        {modalidad === 'mensual' ? 'Monto fijo por mes'
          : unico ? 'Trabajo único'
            : dias.length === 0 && mes?.total_cerrado > 0
              ? 'Sin detalle de días'
              : `${cuantos(resumen.jornadas, 'jornada', 'jornadas')} · ${formatCantidad(resumen.horas)} hs · ${cuantos(resumen.viajes, 'viaje', 'viajes')} · ${cuantos(resumen.diasTrabajados, 'día', 'días')}`}
      </p>

      {unico ? (
        <label style={{ ...rotuloCampo, marginBottom: '14px' }}>
          Mes del trabajo
          <input type="month" aria-label="Mes del trabajo" value={clave || ''} disabled={soloLectura}
            style={{ ...input, minWidth: 0, padding: '8px' }}
            onChange={e => cambiarMesDelTrabajo(e.target.value)} />
        </label>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <button type="button" style={flecha} aria-label="Mes anterior" disabled={!clave} onClick={() => irAMes(moverMes(clave, -1))}>‹</button>
          <input type="month" aria-label="Mes" value={clave || ''} style={{ ...input, flex: 1, minWidth: 0, padding: '8px' }}
            onChange={e => { if (claveValida(e.target.value)) irAMes(e.target.value) }} />
          <button type="button" style={flecha} aria-label="Mes siguiente" disabled={!clave} onClick={() => irAMes(moverMes(clave, 1))}>›</button>
        </div>
      )}

      {errorCarga && (
        <div role="alert" style={{ ...fila, color: sem.negativo, marginBottom: '12px' }}>
          <span>{errorCarga}</span>
          <button type="button" style={botonChico} onClick={() => (destinoRef.current ? irAMes(destinoRef.current) : cargarTodo())}>Reintentar</button>
        </div>
      )}
      {aviso && <p role="alert" style={{ fontSize: '13px', color: sem.negativo, margin: '0 0 12px' }}>{aviso}</p>}

      {cargando && !mes ? (
        <p style={{ fontSize: '13px', color: c.textTertiary }}>Cargando…</p>
      ) : mes && (
        <>
          {cerrado && (
            <div style={{ ...caja, ...fila, background: c.surfaceAlt }}>
              <span>{unico ? `${cobro ? 'Cobrado' : 'Pagado'}: ${pesos(mes.total_cerrado)}.` : `Mes cerrado en ${pesos(mes.total_cerrado)}.`}</span>
              <button type="button" style={botonChico} onClick={() => reabrirMes(mes)}>Volver a abrir</button>
            </div>
          )}

          {/* Cerrado, el monto ya lo dice el aviso de arriba. */}
          {!porHora && !cerrado && (
            <div style={caja}>
              <label style={rotuloCampo}>
                {unico ? 'Monto del trabajo' : 'Monto del mes'}
                <CampoNumero aria-label={unico ? 'Monto del trabajo' : 'Monto del mes'} valor={mes.monto || 0} max={LIMITES.monto} step="1000"
                  disabled={soloLectura} onValor={cambiarMonto} onSalir={() => cola.vaciar()}
                  style={{ ...input, padding: '8px' }} />
              </label>
              {modalidad === 'mensual' && !soloLectura && (
                <p style={{ fontSize: '12px', color: c.textSecondary, margin: '8px 0 0' }}>Cada mes nuevo arranca con este monto.</p>
              )}
            </div>
          )}

          {porHora && (
            <>
              <div style={caja}>
                <button type="button" aria-expanded={verTarifas} onClick={() => setTarifasAbiertas(a => !a)}
                  style={{ ...fila, width: '100%', margin: 0, padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <span style={{ ...rotulo, margin: 0 }}>Tarifas del mes</span>
                  <span style={{ fontSize: '12px', color: c.textSecondary, ...NUMEROS }}>
                    {verTarifas ? '▴' : `${pesos(tarifas.valor_hora)} la hora ▾`}
                  </span>
                </button>
                {sinTarifas && !soloLectura && (
                  <p style={{ fontSize: '12px', color: c.textSecondary, margin: '8px 0 0' }}>Cargá cuánto vale la hora, el viaje o la jornada.</p>
                )}
                {verTarifas && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginTop: '10px' }}>
                    {CAMPOS_TARIFA.map(campo => (
                      <label key={campo} style={rotuloCampo}>
                        {ROTULO_TARIFA[campo]}
                        <CampoNumero aria-label={ROTULO_TARIFA[campo]} valor={tarifas[campo]} max={LIMITES.tarifa} step="100"
                          disabled={soloLectura} onValor={n => cambiarTarifa(campo, n)} onSalir={() => cola.vaciar()}
                          style={{ ...input, padding: '8px' }} />
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div style={caja}>
                <p style={rotulo}>Días</p>
                {ordenados.length === 0 && (
                  <p style={{ fontSize: '13px', color: c.textTertiary, margin: '0 0 8px' }}>
                    {!(mes.total_cerrado > 0) ? 'Todavía no hay días cargados.'
                      : cerrado ? 'Este mes se cargó solo con el total.'
                        : 'Este mes se cargó solo con el total. Si cargás días, el total pasa a ser la suma de los días.'}
                  </p>
                )}
                {ordenados.map(d => (
                  <FilaDia key={d.id} fila={d} clave={clave} tarifas={tarifas} soloLectura={soloLectura}
                    estilos={{ c, input, botonChico, rotuloCampo }}
                    onCambiarDia={cambiarNumeroDia} onCambiarTipo={cambiarTipo} onCambiarCantidad={cambiarCantidad}
                    onBorrar={borrarDia} onSalir={() => cola.vaciar()} />
                ))}
                {!cerrado && (
                  <button type="button" style={{ ...botonChico, width: '100%', marginTop: '10px', padding: '10px' }} disabled={soloLectura} onClick={sumarDia}>
                    + Sumar un día
                  </button>
                )}
              </div>
            </>
          )}

          {!cerrado && (
            <button type="button" style={{ ...botonPrincipal, opacity: cerrando ? 0.6 : 1, marginBottom: '14px' }} disabled={soloLectura || cerrando} onClick={cerrarMes}>
              {cerrando ? 'Cerrando…' : unico ? (cobro ? 'Ya lo cobré' : 'Ya lo pagué') : 'Cerrar el mes'}
            </button>
          )}
        </>
      )}

      {/* Solo en las que te pagan: en la de la empleada no hay nada que cobrar. */}
      {cobro && liquidacionId && (
        <IngresosFuturos userId={userId} liquidacionId={liquidacionId}
          estilos={{ c, sem, input, caja, rotulo, botonChico }} />
      )}

      {!unico && historial.meses.length > 0 && (
        <div style={caja}>
          <p style={rotulo}>Meses cerrados</p>
          {historial.meses.map(m => (
            <div key={m.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', gap: '8px', fontSize: '13px', margin: '4px 0' }}>
              <button type="button" onClick={() => irAMes(m.clave)}
                style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: c.text, fontSize: '13px', fontFamily: 'inherit', fontWeight: m.clave === clave ? 600 : 400 }}>
                {nombreDelMes(m.clave)}
              </button>
              <span style={NUMEROS}>{pesos(m.total)}</span>
              <button type="button" style={botonChico} onClick={() => reabrirMes(m)}>Volver a abrir</button>
            </div>
          ))}
          <div style={{ ...fila, borderTop: `1px solid ${c.border}`, paddingTop: '8px', marginTop: '8px', fontWeight: 700 }}>
            <span>{cobro ? 'Acumulado cobrado' : 'Acumulado pagado'}</span>
            <span style={NUMEROS}>{pesos(historial.acumulado)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default Liquidacion
