import React, { useState, useEffect, useRef } from 'react'

// La "i" que explica un número de la pantalla. Vive en su propio archivo (y no en
// AccountDetail, donde nació) para que cualquier componente pueda usarla sin
// importar desde AccountDetail — eso crea un ciclo apenas AccountDetail importa
// ese componente de vuelta.
export function InfoTooltip({ text, darkMode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const hoverCapaz = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches
  useEffect(() => {
    if (!open) return
    const cerrarSiAfuera = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', cerrarSiAfuera)
    document.addEventListener('touchstart', cerrarSiAfuera)
    return () => {
      document.removeEventListener('mousedown', cerrarSiAfuera)
      document.removeEventListener('touchstart', cerrarSiAfuera)
    }
  }, [open])
  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', marginLeft: '6px', verticalAlign: 'middle' }}
      onMouseEnter={hoverCapaz ? () => setOpen(true) : undefined}
      onMouseLeave={hoverCapaz ? () => setOpen(false) : undefined}
    >
      <button
        type="button"
        aria-label="Más información"
        onClick={(e) => { e.stopPropagation(); if (!hoverCapaz) setOpen(o => !o) }}
        style={{
          width: '15px', height: '15px', borderRadius: '50%', padding: 0, boxSizing: 'border-box',
          border: `1px solid ${darkMode ? '#8A7A8A' : '#75757a'}`, background: 'none',
          color: darkMode ? '#9A8A9A' : '#75757a', fontSize: '10px', lineHeight: '13px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'help', fontFamily: 'Georgia, serif', fontStyle: 'italic',
          textTransform: 'none', letterSpacing: 'normal', fontWeight: '400',
        }}
      >i</button>
      {open && (
        <div style={{
          position: 'absolute', top: '20px', right: 0, zIndex: 60, minWidth: '200px', maxWidth: '260px',
          padding: '8px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '400',
          textTransform: 'none', letterSpacing: 'normal', lineHeight: '1.4', textAlign: 'left',
          backgroundColor: darkMode ? '#2A232A' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f',
          border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}
