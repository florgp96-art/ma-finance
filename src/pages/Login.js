import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, Link } from 'react-router-dom'
const logo = process.env.PUBLIC_URL + '/logo.png'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoWrap}>
          <img src={logo} alt="Mom's Assist Finance" style={styles.logo} />
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
    backgroundColor: '#E4E7F3',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '24px',
    padding: '48px 40px 36px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 8px 40px rgba(107,123,184,0.15)',
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
    color: '#6e6e73',
    textAlign: 'center',
    marginBottom: '32px',
    fontSize: '15px',
    fontWeight: '500',
  },
  field: { marginBottom: '20px' },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: '6px',
    letterSpacing: '0.02em',
  },
  input: {
    width: '100%',
    padding: '13px 14px',
    borderRadius: '12px',
    border: '1.5px solid #e0e0e0',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box',
    color: '#1d1d1f',
    backgroundColor: '#fafafa',
    transition: 'border-color 0.2s',
  },
  button: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#6B7BB8',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    marginTop: '8px',
    letterSpacing: '0.02em',
    transition: 'opacity 0.2s',
    outline: 'none',
  },
  error: {
    backgroundColor: '#fff0f0',
    color: '#c0392b',
    padding: '12px 16px',
    borderRadius: '10px',
    marginBottom: '16px',
    fontSize: '14px',
    border: '1px solid #fcc',
  },
  link: {
    textAlign: 'center',
    marginTop: '24px',
    fontSize: '14px',
    color: '#6e6e73',
  },
  linkAnchor: {
    color: '#6B7BB8',
    fontWeight: '600',
    textDecoration: 'none',
  },
}