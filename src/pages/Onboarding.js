import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { paleta, leerDarkMode, FONT as FONT_THEME, MODOS, leerModo, aplicarModoAlDocumento } from '../theme'
import { BANCOS, BILLETERAS, TARJETAS, CATEGORIA_MASCOTAS, SUBCATEGORIAS_MASCOTAS, cuentasDelAlta } from '../lib/perfil'

const FONT = FONT_THEME.family

// Las respuestas que no son de una tabla propia se guardan como preferencias, igual
// que las del Dashboard (ver persistPref): user_rules con "__pref__<clave>".
const guardarPreferencia = (userId, clave, valor) =>
  supabase.from('user_rules').upsert({
    user_id: userId, texto_original: `__pref__${clave}`,
    nombre_asignado: JSON.stringify(valor), category_id: null, subcategory_id: null,
  }, { onConflict: 'user_id,texto_original' })

export default function Onboarding() {
  // Se aplica al tocarlo: la pantalla cambia de colores en el momento.
  const [modo, setModo] = useState(leerModo)
  const elegirModo = (nuevo) => { setModo(nuevo); aplicarModoAlDocumento(nuevo) }
  const [tieneHijos, setTieneHijos] = useState(false)
  const [hijos, setHijos] = useState([''])
  // null = no contestó: la app sigue como siempre en ese punto.
  const [cuotaAlimentaria, setCuotaAlimentaria] = useState(null)
  const [tieneMascotas, setTieneMascotas] = useState(null)
  const [tieneAuto, setTieneAuto] = useState(null)
  const [bancos, setBancos] = useState([])
  const [billeteras, setBilleteras] = useState([])
  const [tarjetas, setTarjetas] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  // Esta pantalla no tenía modo oscuro: era blanca con texto negro siempre, así que
  // un usuario con el tema oscuro puesto veía la PRIMERA pantalla de la app en
  // blanco. El tema se lee de localStorage, el mismo lugar donde lo deja el
  // Dashboard. No hay toggle acá a propósito: son treinta segundos de flujo y el
  // switch vive en la app, no en el alta.
  const dark = leerDarkMode()
  const c = paleta(dark)

  const handleFinish = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      await supabase.from('user_profiles').upsert({ id: user.id }, { onConflict: 'id', ignoreDuplicates: true })

      // upsert manual (select + insert/update) en vez de un insert simple: si el
      // usuario recarga a mitad del flujo, apreta "atrás" o reintenta después de
      // un error acá abajo, esto no duplica la fila de user_settings (que rompe
      // el .maybeSingle() del Dashboard) en vez de crear una nueva cada vez.
      const { data: existingSettings } = await supabase.from('user_settings').select('id').eq('user_id', user.id).maybeSingle()
      const settingsData = { tiene_hijos: tieneHijos, alquila: false, onboarding_completo: true }
      if (existingSettings) {
        await supabase.from('user_settings').update(settingsData).eq('user_id', user.id)
      } else {
        await supabase.from('user_settings').insert({ user_id: user.id, ...settingsData })
      }

      if (tieneHijos) {
        const hijosData = hijos.filter(h => h.trim() !== '').map(nombre => ({ user_id: user.id, nombre }))
        if (hijosData.length > 0) await supabase.from('children').insert(hijosData)
      }

      // Preferencias: solo las que contestó.
      // primera_carga_pendiente: muestra en el Dashboard la lista de cuentas a las que
      // les falta un resumen (ver components/PrimeraCarga.js) hasta que la cierre.
      const preferencias = [['modo', modo], ['primera_carga_pendiente', true]]
      if (tieneHijos && cuotaAlimentaria !== null) preferencias.push(['cuota_alimentaria_activa', cuotaAlimentaria])
      if (tieneAuto !== null) preferencias.push(['tiene_auto', tieneAuto])
      if (tieneMascotas !== null) preferencias.push(['tiene_mascotas', tieneMascotas])
      await Promise.all(preferencias.map(([clave, valor]) => guardarPreferencia(user.id, clave, valor)))

      // Con mascotas: su propia categoría de gastos, si todavía no la tiene.
      if (tieneMascotas) {
        const { data: yaEsta } = await supabase.from('categories').select('id')
          .eq('user_id', user.id).eq('nombre', CATEGORIA_MASCOTAS).maybeSingle()
        if (!yaEsta) {
          const { data: cantidad } = await supabase.from('categories').select('id').or(`user_id.eq.${user.id},es_sistema.eq.true`)
          const { data: categoria } = await supabase.from('categories')
            .insert({ user_id: user.id, nombre: CATEGORIA_MASCOTAS, tipo: 'gasto', icono: '🐾', orden: (cantidad?.length || 0) + 1 })
            .select('id').single()
          if (categoria) {
            await supabase.from('subcategories').insert(
              SUBCATEGORIAS_MASCOTAS.map(nombre => ({ nombre, category_id: categoria.id, user_id: user.id })))
          }
        }
      }

      // Cuentas: las predeterminadas y las de los bancos y tarjetas que eligió, solo
      // si todavía no existen (mismo motivo que arriba) — si no, un reintento
      // duplicaba "Efectivo"/"Ingresos" para siempre.
      const { data: existingAccounts } = await supabase.from('accounts').select('tipo, nombre').eq('user_id', user.id)
      const tiposExistentes = new Set((existingAccounts || []).map(a => a.tipo))
      const accountsACrear = []
      if (!tiposExistentes.has('efectivo')) accountsACrear.push({ user_id: user.id, nombre: 'Efectivo', tipo: 'efectivo' })
      if (!tiposExistentes.has('ingreso')) accountsACrear.push({ user_id: user.id, nombre: 'Ingresos', tipo: 'ingreso' })
      if (accountsACrear.length > 0) await supabase.from('accounts').insert(accountsACrear)

      const deLasElegidas = cuentasDelAlta({ bancos, billeteras, tarjetas, existentes: existingAccounts })
      const cuentasDePlata = deLasElegidas.filter(a => a.tipo === 'debito').map(a => ({ ...a, user_id: user.id }))
      let creadas = []
      if (cuentasDePlata.length > 0) {
        const { data } = await supabase.from('accounts').insert(cuentasDePlata).select('id')
        creadas = data || []
      }
      // Con una sola cuenta de banco, las tarjetas ya quedan pagándose desde ahí (es lo
      // que hace que su pago se reste del saldo). Con más, lo elige después.
      const cuentaDePago = creadas.length === 1 ? creadas[0].id : null
      const tarjetasACrear = deLasElegidas.filter(a => a.tipo === 'credito')
        .map(a => ({ ...a, user_id: user.id, ...(cuentaDePago ? { cuenta_pago_id: cuentaDePago } : {}) }))
      if (tarjetasACrear.length > 0) await supabase.from('accounts').insert(tarjetasACrear)

      navigate('/dashboard')
    } catch (err) {
      setError('No se pudo guardar. Probá de nuevo — ' + (err.message || 'error desconocido') + '.')
    }
    setLoading(false)
  }

  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 600, color: c.textSecondary, marginBottom: '10px', letterSpacing: '0.02em', fontFamily: FONT }
  const bloque = { marginBottom: '24px' }

  const opcion = (activo) => ({
    padding: '11px 8px', borderRadius: '12px', border: `2px solid ${activo ? c.primary : c.border}`,
    backgroundColor: activo ? c.primarySoft : c.surface, cursor: 'pointer', fontSize: '14px',
    fontWeight: activo ? 700 : 500, color: activo ? c.primary : c.textSecondary, fontFamily: FONT, transition: 'all 0.15s',
  })

  const siNo = (pregunta, valor, setValor) => (
    <div style={bloque}>
      <label style={labelStyle}>{pregunta}</label>
      <div style={{ display: 'flex', gap: '10px' }}>
        {[{ val: true, label: 'Sí' }, { val: false, label: 'No' }].map(o => (
          <button key={String(o.val)} type="button" aria-pressed={valor === o.val} onClick={() => setValor(o.val)}
            style={{ ...opcion(valor === o.val), flex: 1 }}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )

  // Varios a la vez: se tocan para marcar y desmarcar.
  const elegirVarios = (pregunta, ayuda, opciones, elegidos, setElegidos) => (
    <div style={bloque}>
      <label style={{ ...labelStyle, marginBottom: ayuda ? '4px' : '10px' }}>{pregunta}</label>
      {ayuda && <p style={{ margin: '0 0 10px', fontSize: '12px', color: c.textTertiary, fontFamily: FONT }}>{ayuda}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {opciones.map(o => {
          const activo = elegidos.includes(o)
          return (
            <button key={o} type="button" aria-pressed={activo}
              onClick={() => setElegidos(es => (es.includes(o) ? es.filter(x => x !== o) : [...es, o]))}
              style={{ ...opcion(activo), padding: '8px 12px', fontSize: '13px', borderRadius: '20px' }}>
              {o}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, fontFamily: FONT, padding: '20px', boxSizing: 'border-box' }}>
      <div style={{ backgroundColor: c.surface, borderRadius: '20px', padding: '40px 36px', width: '100%', maxWidth: '420px', boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.4)' : '0 4px 24px rgba(0,0,0,0.08)' }}>

        <h2 style={{ fontSize: '22px', fontWeight: 700, color: c.text, margin: '0 0 6px', fontFamily: FONT }}>¡Hola! 👋</h2>
        <p style={{ color: c.textTertiary, fontSize: '14px', margin: '0 0 16px', fontFamily: FONT }}>Contanos un poco sobre vos</p>

        {/* Para dar tranquilidad antes de preguntar cosas personales. Dice solo lo que
            es cierto: no promete que "nadie lo ve" (los nombres de los hijos van a la IA
            que lee los resúmenes para asignarles sus gastos). */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px 14px', borderRadius: '12px', backgroundColor: c.primarySoft, margin: '0 0 28px' }}>
          <span aria-hidden="true" style={{ fontSize: '16px', lineHeight: 1.4 }}>🔒</span>
          <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: c.textSecondary, fontFamily: FONT }}>
            Estas respuestas son solo para armar la app a tu medida y que te resulte más útil.
            No se venden, no se comparten con terceros y no se usan para publicidad.
            Podés cambiarlas cuando quieras desde Configuración.
          </p>
        </div>

        <div style={bloque}>
          <label style={labelStyle}>¿Cómo querés ver la app?</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            {Object.entries(MODOS).map(([clave, m]) => (
              <button key={clave} type="button" aria-pressed={modo === clave} onClick={() => elegirModo(clave)}
                style={{ ...opcion(modo === clave), flex: 1 }}>
                {clave === 'dad' ? '💙' : '💜'} {m.nombre}
              </button>
            ))}
          </div>
        </div>

        {siNo('¿Tenés hijos?', tieneHijos, setTieneHijos)}

        {tieneHijos && (
          <>
            <div style={bloque}>
              <label style={labelStyle}>Nombres de tus hijos</label>
              {hijos.map((hijo, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input
                    style={{ flex: 1, padding: '13px 14px', borderRadius: '10px', border: `1.5px solid ${c.border}`, fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: FONT, color: c.text, backgroundColor: c.surface, colorScheme: dark ? 'dark' : 'light' }}
                    value={hijo}
                    onChange={e => { const n = [...hijos]; n[i] = e.target.value; setHijos(n) }}
                    placeholder={`Nombre del hijo ${i + 1}`}
                  />
                  {i === hijos.length - 1 && (
                    <button type="button" onClick={() => setHijos([...hijos, ''])}
                      style={{ padding: '12px 16px', borderRadius: '10px', border: `1.5px solid ${c.primary}`, backgroundColor: c.surface, color: c.primary, cursor: 'pointer', fontSize: '18px', fontWeight: 700, fontFamily: FONT }}>+</button>
                  )}
                </div>
              ))}
            </div>
            {siNo('¿Cobrás o pagás cuota alimentaria?', cuotaAlimentaria, setCuotaAlimentaria)}
          </>
        )}

        {siNo('¿Tenés mascotas?', tieneMascotas, setTieneMascotas)}
        {siNo('¿Tenés auto?', tieneAuto, setTieneAuto)}
        {elegirVarios('¿Con qué bancos operás?', 'Te dejamos creada la caja de ahorro de cada uno.', BANCOS, bancos, setBancos)}
        {elegirVarios('¿Y con qué billeteras virtuales?', null, BILLETERAS, billeteras, setBilleteras)}
        {elegirVarios('¿Qué tarjetas de crédito tenés?', 'Quedan listas para cargar el resumen.', TARJETAS, tarjetas, setTarjetas)}

        {error && (
          <p style={{ color: c.errorText, fontSize: '13px', margin: '0 0 14px', fontFamily: FONT }}>{error}</p>
        )}

        <button onClick={handleFinish} disabled={loading}
          style={{ width: '100%', padding: '15px', backgroundColor: c.primary, color: dark ? '#1C1A1C' : 'white', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT, letterSpacing: '0.02em', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Guardando...' : 'Comenzar →'}
        </button>

      </div>
    </div>
  )
}
