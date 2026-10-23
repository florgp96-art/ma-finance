import React from 'react'
import { FONT, paleta } from '../theme'
import { useIdioma, cambiarIdioma } from '../i18n/idioma'

const OPCIONES = [
  { id: 'es', rotulo: 'ES', nombre: 'Español' },
  { id: 'en', rotulo: 'EN', nombre: 'English' },
]

// ES | EN. Va en el header del Dashboard, al lado de la luna, y flotando arriba a
// la derecha en las pantallas de afuera (login, registro, onboarding).
// translate="no": es lo único que no tiene que cambiar al cambiar el idioma.
export default function SelectorIdioma({ darkMode, flotante = false }) {
  const idioma = useIdioma()
  const c = paleta(darkMode)

  return (
    <div
      role="group"
      aria-label="Idioma / Language"
      translate="no"
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        border: `1px solid ${c.border}`,
        borderRadius: '8px',
        overflow: 'hidden',
        backgroundColor: flotante ? c.surface : 'transparent',
        ...(flotante ? {
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top) + 12px)',
          right: 'calc(env(safe-area-inset-right) + 12px)',
          zIndex: 1000,
          boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
        } : { marginTop: '4px' }),
      }}
    >
      {OPCIONES.map(op => {
        const activo = idioma === op.id
        return (
          <button
            key={op.id}
            type="button"
            lang={op.id}
            title={op.nombre}
            aria-pressed={activo}
            onClick={() => cambiarIdioma(op.id)}
            style={{
              padding: '5px 9px',
              border: 'none',
              background: activo ? 'var(--m-5c4f5c)' : 'transparent',
              color: activo ? '#fff' : (darkMode ? 'var(--m-9a8a9a)' : '#6e6e73'),
              fontFamily: FONT.family,
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: activo ? 'default' : 'pointer',
              outline: 'none',
            }}
          >
            {op.rotulo}
          </button>
        )
      })}
    </div>
  )
}
