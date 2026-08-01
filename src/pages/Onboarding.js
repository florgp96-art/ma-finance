import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { paleta, leerDarkMode, FONT as FONT_THEME } from '../theme'

const FONT = FONT_THEME.family

export default function Onboarding() {
  const [tieneHijos, setTieneHijos] = useState(false)
  const [hijos, setHijos] = useState([''])
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

      // Cuentas predeterminadas: solo si todavía no existen (mismo motivo que
      // arriba) — si no, un reintento duplicaba "Efectivo"/"Ingresos" para siempre.
      const { data: existingAccounts } = await supabase.from('accounts').select('tipo').eq('user_id', user.id)
      const tiposExistentes = new Set((existingAccounts || []).map(a => a.tipo))
      const accountsACrear = []
      if (!tiposExistentes.has('efectivo')) accountsACrear.push({ user_id: user.id, nombre: 'Efectivo', tipo: 'efectivo' })
      if (!tiposExistentes.has('ingreso')) accountsACrear.push({ user_id: user.id, nombre: 'Ingresos', tipo: 'ingreso' })
      if (accountsACrear.length > 0) await supabase.from('accounts').insert(accountsACrear)

      navigate('/dashboard')
    } catch (err) {
      setError('No se pudo guardar. Probá de nuevo — ' + (err.message || 'error desconocido') + '.')
    }
    setLoading(false)
  }

  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 600, color: c.textSecondary, marginBottom: '10px', letterSpacing: '0.02em', fontFamily: FONT }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, fontFamily: FONT, padding: '20px', boxSizing: 'border-box' }}>
      <div style={{ backgroundColor: c.surface, borderRadius: '20px', padding: '40px 36px', width: '100%', maxWidth: '420px', boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.4)' : '0 4px 24px rgba(0,0,0,0.08)' }}>

        <h2 style={{ fontSize: '22px', fontWeight: 700, color: c.text, margin: '0 0 6px', fontFamily: FONT }}>¡Hola! 👋</h2>
        <p style={{ color: c.textTertiary, fontSize: '14px', margin: '0 0 32px', fontFamily: FONT }}>Contanos un poco sobre vos</p>

        <div style={{ marginBottom: '28px' }}>
          <label style={labelStyle}>¿Tenés hijos?</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            {[{ val: true, label: 'Sí' }, { val: false, label: 'No' }].map(o => {
              const activo = tieneHijos === o.val
              return (
                <button key={String(o.val)} onClick={() => setTieneHijos(o.val)}
                  style={{ flex: 1, padding: '13px 8px', borderRadius: '12px', border: `2px solid ${activo ? c.primary : c.border}`, backgroundColor: activo ? c.primarySoft : c.surface, cursor: 'pointer', fontSize: '14px', fontWeight: activo ? 700 : 500, color: activo ? c.primary : c.textSecondary, fontFamily: FONT, transition: 'all 0.15s' }}>
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>

        {tieneHijos && (
          <div style={{ marginBottom: '28px' }}>
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
                  <button onClick={() => setHijos([...hijos, ''])}
                    style={{ padding: '12px 16px', borderRadius: '10px', border: `1.5px solid ${c.primary}`, backgroundColor: c.surface, color: c.primary, cursor: 'pointer', fontSize: '18px', fontWeight: 700, fontFamily: FONT }}>+</button>
                )}
              </div>
            ))}
          </div>
        )}

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
