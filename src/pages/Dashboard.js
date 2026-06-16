import React from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.logo}>Moms Assist Finance</h1>
        <button style={styles.logoutBtn} onClick={handleLogout}>
          Cerrar sesión
        </button>
      </div>

      <div style={styles.content}>
        <h2 style={styles.welcome}>¡Bienvenida! 🎉</h2>
        <p style={styles.subtitle}>Tu dashboard está listo. Pronto vas a poder cargar tus extractos y ver tus gastos acá.</p>

        <div style={styles.cards}>
          <div style={styles.card}>
            <p style={styles.cardLabel}>Total del mes</p>
            <p style={styles.cardValue}>$ —</p>
          </div>
          <div style={styles.card}>
            <p style={styles.cardLabel}>Gastos</p>
            <p style={styles.cardValue}>$ —</p>
          </div>
          <div style={styles.card}>
            <p style={styles.cardLabel}>Ingresos</p>
            <p style={styles.cardValue}>$ —</p>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f8f6f3',
    fontFamily: 'Arial, sans-serif'
  },
  header: {
    backgroundColor: 'white',
    padding: '16px 32px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
  },
  logo: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#9B59B6',
    margin: 0
  },
  logoutBtn: {
    padding: '8px 16px',
    backgroundColor: 'white',
    color: '#9B59B6',
    border: '2px solid #9B59B6',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600'
  },
  content: {
    maxWidth: '900px',
    margin: '40px auto',
    padding: '0 24px'
  },
  welcome: {
    fontSize: '28px',
    color: '#2d2d2d',
    marginBottom: '8px'
  },
  subtitle: {
    color: '#888',
    fontSize: '15px',
    marginBottom: '32px'
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
  },
  cardLabel: {
    fontSize: '13px',
    color: '#888',
    margin: '0 0 8px 0'
  },
  cardValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#2d2d2d',
    margin: 0
  }
}