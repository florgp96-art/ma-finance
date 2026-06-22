import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

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
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.progress}>
          <div style={{ ...styles.progressBar, width: `${(step / 2) * 100}%` }} />
        </div>

        <p style={styles.stepLabel}>Paso {step} de 2</p>

        {step === 1 && (
          <>
            <h2 style={styles.title}>¡Bienvenida! 👋</h2>
            <p style={styles.subtitle}>Contanos un poco sobre vos</p>

            <div style={styles.field}>
              <label style={styles.label}>¿Cómo usarás la cuenta?</label>
              <div style={styles.options}>
                <button
                  style={{ ...styles.option, ...(tipo === 'individual' ? styles.optionActive : {}) }}
                  onClick={() => setTipo('individual')}
                >
                  👤 Solo yo
                </button>
                <button
                  style={{ ...styles.option, ...(tipo === 'pareja' ? styles.optionActive : {}) }}
                  onClick={() => setTipo('pareja')}
                >
                  👫 Somos pareja
                </button>
              </div>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>¿Tenés hijos?</label>
              <div style={styles.options}>
                <button
                  style={{ ...styles.option, ...(tieneHijos ? styles.optionActive : {}) }}
                  onClick={() => setTieneHijos(true)}
                >
                  Sí
                </button>
                <button
                  style={{ ...styles.option, ...(!tieneHijos ? styles.optionActive : {}) }}
                  onClick={() => setTieneHijos(false)}
                >
                  No
                </button>
              </div>
            </div>

            {tieneHijos && (
              <div style={styles.field}>
                <label style={styles.label}>Nombres de tus hijos</label>
                {hijos.map((hijo, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <input
                      style={styles.input}
                      value={hijo}
                      onChange={(e) => {
                        const newHijos = [...hijos]
                        newHijos[i] = e.target.value
                        setHijos(newHijos)
                      }}
                      placeholder={`Nombre del hijo ${i + 1}`}
                    />
                    {i === hijos.length - 1 && (
                      <button style={styles.addBtn} onClick={() => setHijos([...hijos, ''])}>+</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button style={styles.button} onClick={() => setStep(2)}>
              Continuar →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={styles.title}>Tu vivienda 🏠</h2>
            <p style={styles.subtitle}>Para categorizar mejor tus gastos</p>

            <div style={styles.field}>
              <label style={styles.label}>¿Alquilás o tenés hipoteca?</label>
              <div style={styles.options}>
                <button
                  style={{ ...styles.option, ...(alquila ? styles.optionActive : {}) }}
                  onClick={() => setAlquila(true)}
                >
                  Sí
                </button>
                <button
                  style={{ ...styles.option, ...(!alquila ? styles.optionActive : {}) }}
                  onClick={() => setAlquila(false)}
                >
                  No
                </button>
              </div>
            </div>

            <div style={styles.buttons}>
              <button style={styles.backButton} onClick={() => setStep(1)}>
                ← Atrás
              </button>
              <button style={styles.button} onClick={handleFinish} disabled={loading}>
                {loading ? 'Guardando...' : 'Comenzar →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f6f3',
    fontFamily: 'Arial, sans-serif'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '40px',
    width: '100%',
    maxWidth: '440px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
  },
  progress: {
    height: '4px',
    backgroundColor: '#eee',
    borderRadius: '2px',
    marginBottom: '24px'
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#9B59B6',
    borderRadius: '2px',
    transition: 'width 0.3s ease'
  },
  stepLabel: {
    fontSize: '12px',
    color: '#aaa',
    marginBottom: '8px'
  },
  title: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: '#2d2d2d',
    margin: '0 0 8px 0'
  },
  subtitle: {
    color: '#888',
    marginBottom: '28px',
    fontSize: '14px'
  },
  field: { marginBottom: '24px' },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    color: '#444',
    marginBottom: '10px'
  },
  options: {
    display: 'flex',
    gap: '10px'
  },
  option: {
    flex: 1,
    padding: '12px',
    borderRadius: '10px',
    border: '2px solid #e0e0e0',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#444',
    transition: 'all 0.2s'
  },
  optionActive: {
    borderColor: '#9B59B6',
    backgroundColor: '#f5eefb',
    color: '#9B59B6',
    fontWeight: '600'
  },
  input: {
    flex: 1,
    padding: '12px',
    borderRadius: '10px',
    border: '1px solid #e0e0e0',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
    width: '100%'
  },
  addBtn: {
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid #9B59B6',
    backgroundColor: 'white',
    color: '#9B59B6',
    cursor: 'pointer',
    fontSize: '18px',
    fontWeight: 'bold'
  },
  button: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#9B59B6',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  backButton: {
    flex: 1,
    padding: '14px',
    backgroundColor: 'white',
    color: '#9B59B6',
    border: '2px solid #9B59B6',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  buttons: {
    display: 'flex',
    gap: '12px'
  }
}