import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, Link } from 'react-router-dom'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    
    if (error) {
      setError(error.message)
    } else {
      navigate('/dashboard')
    }
    setLoading(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Moms Assist Finance</h1>
        <p style={styles.subtitle}>Iniciá sesión en tu cuenta</p>
        
        {error && <div style={styles.error}>{error}</div>}
        
        <form onSubmit={handleLogin}>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              style={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              required
            />
          </div>
          
          <div style={styles.field}>
            <label style={styles.label}>Contraseña</label>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          
          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
        
        <p style={styles.link}>
          ¿No tenés cuenta? <Link to="/register">Registrate</Link>
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
    backgroundColor: '#f8f6f3',
    fontFamily: 'Arial, sans-serif'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#2d2d2d',
    margin: '0 0 8px 0',
    textAlign: 'center'
  },
  subtitle: {
    color: '#888',
    textAlign: 'center',
    marginBottom: '32px',
    fontSize: '14px'
  },
  field: { marginBottom: '20px' },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    color: '#444',
    marginBottom: '6px'
  },
  input: {
    width: '100%',
    padding: '12px',
    borderRadius: '10px',
    border: '1px solid #e0e0e0',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box'
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
    cursor: 'pointer',
    marginTop: '8px'
  },
  error: {
    backgroundColor: '#fee',
    color: '#c00',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '14px'
  },
  link: {
    textAlign: 'center',
    marginTop: '20px',
    fontSize: '14px',
    color: '#888'
  }
}