import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'
import { APP_NAME, paleta, leerDarkMode, FONT, RADIUS } from '../theme'

// Traducción de los mensajes de error más comunes que devuelve Supabase (en
// inglés) — sin esto, un error de signup se mostraba en inglés en medio de
// una UI en español. Si no matchea ninguno, se muestra el mensaje original.
const traducirError = (msg) => {
  const m = (msg || '').toLowerCase()
  if (m.includes('already registered') || m.includes('already exists')) return 'Ese email ya está registrado. Iniciá sesión en vez de crear una cuenta nueva.'
  if (m.includes('password') && m.includes('6 characters')) return 'La contraseña tiene que tener al menos 6 caracteres.'
  if (m.includes('invalid') && m.includes('email')) return 'El email no es válido.'
  if (m.includes('rate limit')) return 'Demasiados intentos. Esperá un momento y probá de nuevo.'
  return msg
}

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [nombreCompleto, setNombreCompleto] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const navigate = useNavigate()
  // Faltaba el modo oscuro, igual que en Login: el alta salía en blanco.
  const dark = leerDarkMode()
  const c = paleta(dark)
  const styles = getStyles(dark)

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    if (!nombreCompleto.trim()) { setError('El nombre completo es obligatorio'); return }
    if (password.length < 6) { setError('La contraseña tiene que tener al menos 6 caracteres.'); return }
    if (password !== confirm) { setError('Las contraseñas no coinciden'); return }
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: nombreCompleto.trim() }
      }
    })
    if (error) { setError(traducirError(error.message)) } else { setSent(true) }
    setLoading(false)
  }

  if (sent) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '52px', margin: '0 0 20px', lineHeight: 1 }}>📬</p>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: c.text, margin: '0 0 12px', fontFamily: FONT.family }}>¡Revisá tu email!</h2>
            <p style={{ color: c.textSecondary, fontSize: '14px', lineHeight: 1.7, margin: '0 0 6px', fontFamily: FONT.family }}>
              Te mandamos un link de confirmación a
            </p>
            <p style={{ color: c.text, fontSize: '15px', fontWeight: 600, margin: '0 0 16px', fontFamily: FONT.family }}>{email}</p>
            <p style={{ color: c.textSecondary, fontSize: '14px', lineHeight: 1.7, margin: '0 0 28px', fontFamily: FONT.family }}>
              Hacé click en el link para activar tu cuenta.
            </p>
            <p style={{ color: c.textTertiary, fontSize: '12px', margin: '0 0 28px', fontFamily: FONT.family }}>¿No llegó? Revisá spam o volvé a intentarlo.</p>
            <button
              onClick={() => navigate('/login')}
              style={{ width: '100%', padding: '14px', backgroundColor: c.primary, color: dark ? '#1C1A1C' : 'white', border: 'none', borderRadius: RADIUS.md, fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT.family, letterSpacing: '0.02em' }}>
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
            <label style={styles.label}>Nombre completo</label>
            <input
              style={styles.input}
              type="text"
              value={nombreCompleto}
              onChange={e => setNombreCompleto(e.target.value)}
              placeholder="Tal como figura en tu banco"
              required
            />
            <p style={styles.hint}>Usá el nombre exacto que aparece en tus extractos bancarios (ej: "María García López")</p>
          </div>
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

        <p style={styles.link}>¿Ya tenés cuenta? <Link to="/login" style={{ color: c.primary, fontWeight: 600, textDecoration: 'none' }}>Iniciá sesión</Link></p>
      </div>
    </div>
  )
}

const getStyles = (dark) => {
  const c = paleta(dark)
  return {
  container: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, fontFamily: FONT.family, padding: '20px', boxSizing: 'border-box' },
  card: { backgroundColor: c.surface, borderRadius: RADIUS.lg, padding: '36px 26px', width: '100%', maxWidth: '420px', boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.45)' : '0 4px 24px rgba(0,0,0,0.08)', boxSizing: 'border-box' },
  title: { fontSize: '22px', fontWeight: 700, color: c.text, margin: '0 0 6px', textAlign: 'center', fontFamily: FONT.family },
  subtitle: { color: c.textTertiary, textAlign: 'center', marginBottom: '32px', fontSize: '14px', fontFamily: FONT.family },
  field: { marginBottom: '20px' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: c.textSecondary, marginBottom: '6px', letterSpacing: '0.02em', fontFamily: FONT.family },
  // 16px: por debajo de eso, Safari en iPhone hace zoom al enfocar el campo y
  // deja el formulario corrido a un costado.
  input: { width: '100%', padding: '13px 14px', borderRadius: RADIUS.sm, border: `1.5px solid ${c.border}`, fontSize: '16px', outline: 'none', boxSizing: 'border-box', fontFamily: FONT.family, color: c.text, backgroundColor: c.surfaceAlt, colorScheme: dark ? 'dark' : 'light' },
  hint: { margin: '6px 0 0', fontSize: '12px', color: c.textTertiary, fontFamily: FONT.family, lineHeight: 1.5 },
  button: { width: '100%', padding: '15px', backgroundColor: c.primary, color: dark ? '#1C1A1C' : 'white', border: 'none', borderRadius: RADIUS.md, fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: FONT.family, letterSpacing: '0.02em', marginTop: '8px' },
  error: { backgroundColor: dark ? '#3A2323' : '#fff0f0', color: c.errorText, padding: '12px 14px', borderRadius: RADIUS.sm, marginBottom: '16px', fontSize: '13px', fontFamily: FONT.family },
  link: { textAlign: 'center', marginTop: '20px', fontSize: '14px', color: c.textTertiary, fontFamily: FONT.family }
  }
}
