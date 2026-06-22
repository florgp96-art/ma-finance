import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

const PURPLE = '#7c5cbf'
const PURPLE_LIGHT = '#f0eaf8'
const FONT = '"Montserrat", sans-serif'

export default function Onboarding() {
  const [step, setStep] = useState(1)
  const [tipo, setTipo] = useState('individual')
  const [tieneHijos, setTieneHijos] = useState(false)
  const [hijos, setHijos] = useState([''])
  const [alquila, setAlquila] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleFinish = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('user_profiles').upsert({ id: user.id }, { onConflict: 'id', ignoreDuplicates: true })

    await supabase.from('user_settings').insert({
      user_id: user.id,
      tiene_hijos: tieneHijos,
      alquila: alquila,
      onboarding_completo: true
    })

    if (tieneHijos) {
      const hijosData = hijos
        .filter(h => h.trim() !== '')
        .map(nombre => ({ user_id: user.id, nombre }))
      if (hijosData.length > 0) {
        await supabase.from('children').insert(hijosData)
      }
    }

    navigate('/dashboard')
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F5F6', fontFamily: FONT, padding: '20px', boxSizing: 'border-box' }}>
      <div style={{ backgroundColor: 'white', borderRadius: '20px', padding: '36px 32px', width: '100%', maxWidth: '420px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>

        {/* Progress bar */}
        <div style={{ height: '4px', backgroundColor: '#EDE8EC', borderRadius: '2px', marginBottom: '28px' }}>
          <div style={{ height: '100%', backgroundColor: PURPLE, borderRadius: '2px', width: `${(step / 2) * 100}%`, transition: 'width 0.3s ease' }} />
        </div>

        <p style={{ fontSize: '11px', color: '#aaa', marginBottom: '6px', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>Paso {step} de 2</p>

        {step === 1 && (
          <>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1d1d1f', margin: '0 0 6px' }}>¡Bienvenida! 👋</h2>
            <p style={{ color: '#8e8e93', marginBottom: '28px', fontSize: '14px', margin: '0 0 28px' }}>Contanos un poco sobre vos</p>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#444', marginBottom: '10px', letterSpacing: '0.02em' }}>¿Cómo usarás la cuenta?</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {[{ val: 'individual', label: '👤 Solo yo' }, { val: 'pareja', label: '👫 Somos pareja' }].map(o => (
                  <button key={o.val} onClick={() => setTipo(o.val)}
                    style={{ flex: 1, padding: '13px 8px', borderRadius: '12px', border: `2px solid ${tipo === o.val ? PURPLE : '#E2DDE0'}`, backgroundColor: tipo === o.val ? PURPLE_LIGHT : 'white', cursor: 'pointer', fontSize: '13px', fontWeight: tipo === o.val ? 700 : 500, color: tipo === o.val ? PURPLE : '#6e6e73', fontFamily: FONT, transition: 'all 0.15s' }}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#444', marginBottom: '10px', letterSpacing: '0.02em' }}>¿Tenés hijos?</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {[{ val: true, label: 'Sí' }, { val: false, label: 'No' }].map(o => (
                  <button key={String(o.val)} onClick={() => setTieneHijos(o.val)}
                    style={{ flex: 1, padding: '13px 8px', borderRadius: '12px', border: `2px solid ${tieneHijos === o.val ? PURPLE : '#E2DDE0'}`, backgroundColor: tieneHijos === o.val ? PURPLE_LIGHT : 'white', cursor: 'pointer', fontSize: '13px', fontWeight: tieneHijos === o.val ? 700 : 500, color: tieneHijos === o.val ? PURPLE : '#6e6e73', fontFamily: FONT, transition: 'all 0.15s' }}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {tieneHijos && (
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#444', marginBottom: '10px', letterSpacing: '0.02em' }}>Nombres de tus hijos</label>
                {hijos.map((hijo, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <input
                      style={{ flex: 1, padding: '12px 14px', borderRadius: '10px', border: '1px solid #E2DDE0', fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: FONT, color: '#1d1d1f' }}
                      value={hijo}
                      onChange={(e) => { const n = [...hijos]; n[i] = e.target.value; setHijos(n) }}
                      placeholder={`Nombre del hijo ${i + 1}`}
                    />
                    {i === hijos.length - 1 && (
                      <button onClick={() => setHijos([...hijos, ''])}
                        style={{ padding: '12px 16px', borderRadius: '10px', border: `1px solid ${PURPLE}`, backgroundColor: 'white', color: PURPLE, cursor: 'pointer', fontSize: '18px', fontWeight: 700 }}>+</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button onClick={() => setStep(2)}
              style={{ width: '100%', padding: '15px', backgroundColor: PURPLE, color: 'white', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT, letterSpacing: '0.02em' }}>
              Continuar →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1d1d1f', margin: '0 0 6px' }}>Tu vivienda 🏠</h2>
            <p style={{ color: '#8e8e93', fontSize: '14px', margin: '0 0 28px' }}>Para categorizar mejor tus gastos</p>

            <div style={{ marginBottom: '32px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#444', marginBottom: '10px', letterSpacing: '0.02em' }}>¿Alquilás o tenés hipoteca?</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {[{ val: true, label: 'Sí' }, { val: false, label: 'No' }].map(o => (
                  <button key={String(o.val)} onClick={() => setAlquila(o.val)}
                    style={{ flex: 1, padding: '13px 8px', borderRadius: '12px', border: `2px solid ${alquila === o.val ? PURPLE : '#E2DDE0'}`, backgroundColor: alquila === o.val ? PURPLE_LIGHT : 'white', cursor: 'pointer', fontSize: '13px', fontWeight: alquila === o.val ? 700 : 500, color: alquila === o.val ? PURPLE : '#6e6e73', fontFamily: FONT, transition: 'all 0.15s' }}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setStep(1)}
                style={{ flex: 1, padding: '15px', backgroundColor: 'white', color: PURPLE, border: `2px solid ${PURPLE}`, borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                ← Atrás
              </button>
              <button onClick={handleFinish} disabled={loading}
                style={{ flex: 2, padding: '15px', backgroundColor: PURPLE, color: 'white', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT, opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Guardando...' : 'Comenzar →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
