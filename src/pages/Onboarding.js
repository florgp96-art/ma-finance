import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

const PURPLE = '#7C5CBF'
const PURPLE_LIGHT = '#EDE8F4'
const FONT = '"Montserrat", sans-serif'

export default function Onboarding() {
  const [tieneHijos, setTieneHijos] = useState(false)
  const [hijos, setHijos] = useState([''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F5F6', fontFamily: FONT, padding: '20px', boxSizing: 'border-box' }}>
      <div style={{ backgroundColor: 'white', borderRadius: '20px', padding: '40px 36px', width: '100%', maxWidth: '420px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>

        <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1d1d1f', margin: '0 0 6px', fontFamily: FONT }}>¡Hola! 👋</h2>
        <p style={{ color: '#8e8e93', marginBottom: '32px', fontSize: '14px', margin: '0 0 32px', fontFamily: FONT }}>Contanos un poco sobre vos</p>

        <div style={{ marginBottom: '28px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#444', marginBottom: '10px', letterSpacing: '0.02em', fontFamily: FONT }}>¿Tenés hijos?</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            {[{ val: true, label: 'Sí' }, { val: false, label: 'No' }].map(o => (
              <button key={String(o.val)} onClick={() => setTieneHijos(o.val)}
                style={{ flex: 1, padding: '13px 8px', borderRadius: '12px', border: `2px solid ${tieneHijos === o.val ? PURPLE : '#E2DDE0'}`, backgroundColor: tieneHijos === o.val ? PURPLE_LIGHT : 'white', cursor: 'pointer', fontSize: '14px', fontWeight: tieneHijos === o.val ? 700 : 500, color: tieneHijos === o.val ? PURPLE : '#6e6e73', fontFamily: FONT, transition: 'all 0.15s' }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {tieneHijos && (
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#444', marginBottom: '10px', letterSpacing: '0.02em', fontFamily: FONT }}>Nombres de tus hijos</label>
            {hijos.map((hijo, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  style={{ flex: 1, padding: '13px 14px', borderRadius: '10px', border: '1.5px solid #E2DDE0', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: FONT, color: '#1d1d1f' }}
                  value={hijo}
                  onChange={e => { const n = [...hijos]; n[i] = e.target.value; setHijos(n) }}
                  placeholder={`Nombre del hijo ${i + 1}`}
                />
                {i === hijos.length - 1 && (
                  <button onClick={() => setHijos([...hijos, ''])}
                    style={{ padding: '12px 16px', borderRadius: '10px', border: `1.5px solid ${PURPLE}`, backgroundColor: 'white', color: PURPLE, cursor: 'pointer', fontSize: '18px', fontWeight: 700, fontFamily: FONT }}>+</button>
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <p style={{ color: '#c0392b', fontSize: '13px', margin: '0 0 14px', fontFamily: FONT }}>{error}</p>
        )}

        <button onClick={handleFinish} disabled={loading}
          style={{ width: '100%', padding: '15px', backgroundColor: PURPLE, color: 'white', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT, letterSpacing: '0.02em', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Guardando...' : 'Comenzar →'}
        </button>

      </div>
    </div>
  )
}
