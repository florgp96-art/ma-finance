import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, Link } from 'react-router-dom'
import { paleta, leerDarkMode, FONT, RADIUS } from '../theme'

const logo = process.env.PUBLIC_URL + '/logo.png'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async () => {
    if (!email || !password) { setError('Completá el email y la contraseña.'); return }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Email o contraseña incorrectos')
    } else {
      navigate('/dashboard')
    }
    setLoading(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLogin()
  }

  const handleResetPassword = async () => {
    if (!email) { setError('Ingresá tu email para restablecer la contraseña.'); return }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/dashboard`
    })
    setLoading(false)
    if (error) {
      setError('Error al enviar el email. Verificá la dirección.')
    } else {
      setResetSent(true)
    }
  }

  // Esta pantalla se quedó sin modo oscuro: con el tema oscuro puesto, cerrar
  // sesión (o volver a entrar) devolvía una pantalla blanca de golpe. El tema
  // sale de localStorage, igual que en el onboarding.
  const dark = leerDarkMode()
  const c = paleta(dark)
  const styles = getStyles(dark)

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoWrap}>
          <img src={logo} alt="MAF" style={styles.logo} />
        </div>

        <p style={styles.subtitle}>Iniciá sesión en tu cuenta</p>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.field}>
          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="tu@email.com"
            autoComplete="email"
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Contraseña</label>
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        <button
          style={{ ...styles.button, opacity: loading ? 0.7 : 1 }}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? 'Ingresando...' : 'Ingresar'}
        </button>

        {resetSent ? (
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <p style={{ fontSize: '13px', color: dark ? '#5FBF87' : '#1f7a44', margin: '0 0 8px' }}>
              ✅ Te enviamos un email para restablecer tu contraseña.
            </p>
            <button onClick={() => setResetSent(false)} style={{ background: 'none', border: 'none', color: c.primary, cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', textDecoration: 'underline', padding: 0 }}>
              Volver
            </button>
          </div>
        ) : (
          <p style={{ textAlign: 'center', marginTop: '14px', fontSize: '13px', color: c.textSecondary }}>
            <button onClick={handleResetPassword} style={{ background: 'none', border: 'none', color: c.primary, cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', textDecoration: 'underline', padding: 0 }}>
              ¿Olvidaste tu contraseña?
            </button>
          </p>
        )}

        <p style={styles.link}>
          ¿No tenés cuenta? <Link to="/register" style={styles.linkAnchor}>Registrate</Link>
        </p>
      </div>
    </div>
  )
}

const getStyles = (dark) => {
  const c = paleta(dark)
  return {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.bg,
    fontFamily: FONT.family,
    // Sin este padding la tarjeta llegaba al borde exacto de la pantalla en el
    // celular y las esquinas redondeadas quedaban cortadas contra el marco.
    padding: '20px',
    boxSizing: 'border-box',
  },
  card: {
    backgroundColor: c.surface,
    borderRadius: RADIUS.xl,
    padding: '40px 28px 32px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: dark ? '0 8px 40px rgba(0,0,0,0.45)' : '0 8px 40px rgba(92,79,92,0.12)',
    boxSizing: 'border-box',
  },
  logoWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  logo: {
    height: '90px',
    maxWidth: '100%',
    objectFit: 'contain',
    // El logo es un monograma casi negro sobre transparencia: sin invertirlo
    // desaparece contra el fondo oscuro.
    filter: dark ? 'invert(1)' : 'none',
  },
  subtitle: {
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: '32px',
    fontSize: '15px',
    fontWeight: '400',
  },
  field: { marginBottom: '20px' },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '400',
    color: c.text,
    marginBottom: '6px',
    letterSpacing: '0.02em',
  },
  input: {
    width: '100%',
    padding: '13px 14px',
    borderRadius: RADIUS.md,
    border: `1.5px solid ${c.border}`,
    // 16px y no 15: por debajo de 16px, Safari en iPhone hace zoom solo al
    // tocar el campo y deja la pantalla corrida.
    fontSize: '16px',
    outline: 'none',
    boxSizing: 'border-box',
    color: c.text,
    backgroundColor: c.surfaceAlt,
    colorScheme: dark ? 'dark' : 'light',
    transition: 'border-color 0.2s',
  },
  button: {
    width: '100%',
    padding: '14px',
    backgroundColor: c.primary,
    color: dark ? '#1C1A1C' : 'white',
    border: 'none',
    borderRadius: RADIUS.md,
    fontSize: '15px',
    fontWeight: '500',
    cursor: 'pointer',
    marginTop: '8px',
    letterSpacing: '0.02em',
    transition: 'opacity 0.2s',
    outline: 'none',
  },
  error: {
    backgroundColor: dark ? '#3A2323' : '#fff0f0',
    color: c.errorText,
    padding: '12px 16px',
    borderRadius: RADIUS.sm,
    marginBottom: '16px',
    fontSize: '14px',
    border: `1px solid ${dark ? '#5A3535' : '#fcc'}`,
  },
  link: {
    textAlign: 'center',
    marginTop: '24px',
    fontSize: '14px',
    color: c.textSecondary,
  },
  linkAnchor: {
    color: c.primary,
    fontWeight: '500',
    textDecoration: 'none',
  },
  }
}
