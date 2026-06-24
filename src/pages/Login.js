import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, Link } from 'react-router-dom'
import { COLORS, FONT, RADIUS } from '../theme'

const logo = process.env.PUBLIC_URL + '/logo.png'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async () => {
    if (!email || !password) return
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
          <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#27ae60' }}>
            ✅ Te enviamos un email para restablecer tu contraseña.
          </p>
        ) : (
          <p style={{ textAlign: 'center', marginTop: '14px', fontSize: '13px', color: COLORS.textSecondary }}>
            <button onClick={handleResetPassword} style={{ background: 'none', border: 'none', color: COLORS.primary, cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', textDecoration: 'underline', padding: 0 }}>
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

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
    fontFamily: FONT.family,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: '48px 40px 36px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 8px 40px rgba(92,79,92,0.12)',
  },
  logoWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  logo: {
    height: '90px',
    objectFit: 'contain',
  },
  subtitle: {
    color: COLORS.textSecondary,
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
    color: COLORS.text,
    marginBottom: '6px',
    letterSpacing: '0.02em',
  },
  input: {
    width: '100%',
    padding: '13px 14px',
    borderRadius: RADIUS.md,
    border: `1.5px solid ${COLORS.inputBorder}`,
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box',
    color: COLORS.text,
    backgroundColor: COLORS.inputBg,
    transition: 'border-color 0.2s',
  },
  button: {
    width: '100%',
    padding: '14px',
    backgroundColor: COLORS.primary,
    color: 'white',
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
    backgroundColor: COLORS.errorBg,
    color: COLORS.errorText,
    padding: '12px 16px',
    borderRadius: RADIUS.sm,
    marginBottom: '16px',
    fontSize: '14px',
    border: `1px solid ${COLORS.errorBorder}`,
  },
  link: {
    textAlign: 'center',
    marginTop: '24px',
    fontSize: '14px',
    color: COLORS.textSecondary,
  },
  linkAnchor: {
    color: COLORS.primary,
    fontWeight: '500',
    textDecoration: 'none',
  },
}
