import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { paleta, leerDarkMode, FONT } from './theme'

// Pages
import Login from './pages/Login'
import Register from './pages/Register'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import ResetPassword from './pages/ResetPassword'

function App() {
  const { user, loading, passwordRecovery, clearPasswordRecovery } = useAuth()

  if (loading) {
    // Es lo primero que se ve al abrir la app: en blanco fijo, con el tema
    // oscuro puesto pegaba un flash blanco antes de pintar el Dashboard.
    const c = paleta(leerDarkMode())
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100dvh',
        fontFamily: FONT.family,
        color: c.textSecondary,
        backgroundColor: c.bg,
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
