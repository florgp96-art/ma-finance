import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { COLORS, FONT } from './theme'

// Pages
import Login from './pages/Login'
import Register from './pages/Register'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import ResetPassword from './pages/ResetPassword'

function App() {
  const { user, loading, passwordRecovery, clearPasswordRecovery } = useAuth()

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontFamily: FONT.family,
        color: COLORS.textSecondary,
        backgroundColor: COLORS.bg,
      }}>
        Cargando...
      </div>
    )
  }

  // El link de "olvidé mi contraseña" trae una sesión válida (evento
  // PASSWORD_RECOVERY) — antes de dejar entrar al Dashboard con la contraseña
  // vieja intacta, obligamos a elegir una nueva.
  if (user && passwordRecovery) {
    return <ResetPassword onDone={clearPasswordRecovery} />
  }

  return (
    <Router>
      <Routes>
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" />} />
        <Route path="/register" element={!user ? <Register /> : <Navigate to="/dashboard" />} />
        <Route path="/onboarding" element={user ? <Onboarding /> : <Navigate to="/login" />} />
        <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" />} />
        <Route path="/" element={<Navigate to={user ? "/dashboard" : "/login"} />} />
      </Routes>
    </Router>
  )
}

export default App
