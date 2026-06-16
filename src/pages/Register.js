import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, Link } from 'react-router-dom'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)

    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
    } else {
      // Crear perfil de usuario
      await supabase.from('user_profiles').insert({ id: data.user.id })
      navigate('/onboarding')
    }
    setLoading(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Moms Assist Finance</h1>
        <p style={styles.subtitle}>Creá tu cuenta gratis</p>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleRegister}>
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
              placeholder="Mínimo 6 caracteres"
              required
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Confirmar contraseña</label>
            <input
              style={styles.input}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repetí tu contraseña"
              required
            />
          </div>

          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Creando cuenta...' : 'Crear cuenta'}
          </button>
        </form>

        <p style={styles.link}>
          ¿Ya tenés cuenta? <Link to="/login">Iniciá sesión</Link>
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