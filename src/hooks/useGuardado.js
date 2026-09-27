import { useEffect, useRef, useState } from 'react'
import { crearColaDeGuardado } from '../lib/colaGuardado'

// Una cola de guardado (ver lib/colaGuardado.js) atada a la vida del componente:
// manda lo pendiente al ocultar la página, en pagehide y al desmontar.
export default function useGuardado(opciones) {
  const [estado, setEstado] = useState({ pendientes: 0, fallidas: 0, error: null, guardoAlgo: false })
  const colaRef = useRef(null)
  if (!colaRef.current) colaRef.current = crearColaDeGuardado({ ...opciones, onEstado: setEstado })

  useEffect(() => {
    const cola = colaRef.current
    const alCambiarVisibilidad = () => { if (document.visibilityState === 'hidden') cola.vaciar() }
    const alSalir = () => { cola.vaciar() }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('pagehide', alSalir)
    return () => {
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('pagehide', alSalir)
      cola.vaciar()
    }
  }, [])

  return { cola: colaRef.current, estado }
}
