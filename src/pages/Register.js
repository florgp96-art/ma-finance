import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'
import { APP_NAME, COLORS, FONT, RADIUS } from '../theme'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const navigate = useNavigate()

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Las contraseñas no coinciden'); return }
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin }
    })
    if (error) { setError(error.message) } else { setSent(true) }
    setLoading(false)
  }

  if (sent) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '52px', margin: '0 0 20px', lineHeight: 1 }}>📬</p>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: COLORS.text, margin: '0 0 12px', fontFamily: FONT.family }}>¡Revisá tu email!</h2>
            <p style={{ color: COLORS.textSecondary, fontSize: '14px', lineHeight: 1.7, margin: '0 0 6px', fontFamily: FONT.family }}>
              Te mandamos un link de confirmación a
            </p>
            <p style={{ color: COLORS.text, fontSize: '15px', fontWeight: 600, margin: '0 0 16px', fontFamily: FONT.family }}>{email}</p>
            <p style={{ color: COLORS.textSecondary, fontSize: '14px', lineHeight: 1.7, margin: '0 0 28px', fontFamily: FONT.family }}>
              Hacé click en el link para activar tu cuenta.
            </p>
            <p style={{ color: '#aaa', fontSize: '12px', margin: '0 0 28px', fontFamily: FONT.family }}>¿No llegó? Revisá spam o volvé a intentarlo.</p>
            <button
              onClick={() => navigate('/login')}
              style={{ width: '100%', padding: '14px', backgroundColor: COLORS.primary, color: 'white', border: 'none', borderRadius: RADIUS.md, fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT.family, letterSpacing: '0.02em' }}>
              Ir al inicio de sesión
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>{APP_NAME}</h1>
        <p style={styles.subtitle}>Creá tu cuenta gratis</p>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleRegister}>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input style={styles.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Contraseña</label>
            <input style={styles.input} type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" required />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Confirmar contraseña</label>
            <input style={styles.input} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repetí tu contraseña" required />
          </div>
          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <p style={styles.link}>¿Ya tenés cuenta? <Link to="/login" style={{ color: COLORS.primary, fontWeight: 600, textDecoration: 'none' }}>Iniciá sesión</Link></p>
      </div>
    </div>
  )
}

const styles = {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg, fontFamily: FONT.family, padding: '20px', boxSizing: 'border-box' },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: '40px 36px', width: '100%', maxWidth: '420px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' },
  title: { fontSize: '22px', fontWeight: 700, color: COLORS.text, margin: '0 0 6px', textAlign: 'center', fontFamily: FONT.family },
  subtitle: { color: COLORS.textTertiary, textAlign: 'center', marginBottom: '32px', fontSize: '14px', fontFamily: FONT.family },
  field: { marginBottom: '20px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#444', marginBottom: '6px', letterSpacing: '0.02em', fontFamily: FONT.family },
  input: { width: '100%', padding: '13px 14px', borderRadius: RADIUS.sm, border: `1.5px solid ${COLORS.border}`, fontSize: '14px', outline: 'none', boxSizing: 'border-box', fontFamily: FONT.family, color: COLORS.text },
  button: { width: '100%', padding: '15px', backgroundColor: COLORS.primary, color: 'white', border: 'none', borderRadius: RADIUS.md, fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT.family, letterSpacing: '0.02em', marginTop: '8px' },
  error: { backgroundColor: COLORS.errorBg, color: COLORS.errorText, padding: '12px 14px', borderRadius: RADIUS.sm, marginBottom: '16px', fontSize: '13px', fontFamily: FONT.family },
  link: { textAlign: 'center', marginTop: '20px', fontSize: '14px', color: COLORS.textTertiary, fontFamily: FONT.family }
}
