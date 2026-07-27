import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    // Si onAuthStateChange ya llegó (más reciente) antes de que resuelva
    // getSession, no dejar que el resultado viejo de getSession lo pise —
    // sin esto, una sesión desactualizada podía reinstalar por un instante a
    // un usuario que ya cerró sesión en otra pestaña.
    let authStateReceived = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!authStateReceived) setUser(session?.user ?? null)
      setLoading(false)
    }).catch(() => {
      // Si getSession rechaza (ej. hiccup de red al cargar), no dejar la app
      // colgada en "Cargando..." para siempre.
      setLoading(false)
    })

    // Escuchar cambios de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        authStateReceived = true
        setUser(session?.user ?? null)
        setLoading(false)
        // El link de "olvidé mi contraseña" loguea con este evento en vez de
        // un SIGNED_IN normal — antes no se distinguía, y el usuario caía
        // directo al Dashboard con la contraseña vieja intacta.
        if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { user, loading, passwordRecovery, clearPasswordRecovery: () => setPasswordRecovery(false) }
}