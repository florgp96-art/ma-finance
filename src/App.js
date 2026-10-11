import React, { Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { paleta, leerDarkMode, FONT } from './theme'
import { lazyConRecarga } from './lib/cargaDiferida'

// Cada pantalla se descarga cuando hace falta: quien entra al login no baja el
// Dashboard (gráficos incluidos), y al revés.
const Login = lazyConRecarga(() => import('./pages/Login'))
const Register = lazyConRecarga(() => import('./pages/Register'))
const Onboarding = lazyConRecarga(() => import('./pages/Onboarding'))
const Dashboard = lazyConRecarga(() => import('./pages/Dashboard'))
const ResetPassword = lazyConRecarga(() => import('./pages/ResetPassword'))

// Es lo primero que se ve al abrir la app (y mientras baja cada pantalla): en blanco
// fijo, con el tema oscuro puesto pegaba un flash blanco antes de pintar el Dashboard.
function Cargando() {
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

function App() {
  const { user, loading, passwordRecovery, clearPasswordRecovery } = useAuth()

  if (loading) return <Cargando />

  // El link de "olvidé mi contraseña" trae una sesión válida (evento
  // PASSWORD_RECOVERY) — antes de dejar entrar al Dashboard con la contraseña
  // vieja intacta, obligamos a elegir una nueva.
  if (user && passwordRecovery) {
    return (
      <Suspense fallback={<Cargando />}>
        <ResetPassword onDone={clearPasswordRecovery} />
      </Suspense>
    )
  }

  return (
    <Router>
      <Suspense fallback={<Cargando />}>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" />} />
          <Route path="/register" element={!user ? <Register /> : <Navigate to="/dashboard" />} />
          <Route path="/onboarding" element={user ? <Onboarding /> : <Navigate to="/login" />} />
          <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/login" />} />
          {/* Cualquier otra dirección (un link viejo, un error de tipeo) llevaba a una
              pantalla en blanco: ahora va al inicio que corresponde. */}
          <Route path="*" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
        </Routes>
      </Suspense>
    </Router>
  )
}

export default App
