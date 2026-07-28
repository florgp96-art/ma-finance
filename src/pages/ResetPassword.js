import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { COLORS, FONT, RADIUS } from '../theme'

const logo = process.env.PUBLIC_URL + '/logo.png'

// Pantalla que se muestra en vez del Dashboard cuando la sesión viene del link
// de "olvidé mi contraseña" (evento PASSWORD_RECOVERY, ver useAuth.js) — antes
// no existía y el link dejaba al usuario en el Dashboard con la contraseña
// vieja intacta, sin ningún indicio de que tenía que cambiarla.
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setError('')
    if (password.length < 6) { setError('La contraseña tiene que tener al menos 6 caracteres.'); return }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateError) { setError('No se pudo cambiar la contraseña: ' + updateError.message); return }
    onDone()
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoWrap}>
          <img src={logo} alt="MAF" style={styles.logo} />
        </div>

        <p style={styles.subtitle}>Elegí tu nueva contraseña</p>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.field}>
          <label style={styles.label}>Nueva contraseña</label>
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 6 caracteres"
            autoComplete="new-password"
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Confirmar contraseña</label>
          <input
            style={styles.input}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repetí la contraseña"
            autoComplete="new-password"
          />
        </div>

        <button
          style={{ ...styles.button, opacity: loading ? 0.7 : 1 }}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? 'Guardando...' : 'Guardar y continuar'}
        </button>
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
    backgroundColor: COLORS.bg,
    fontFamily: FONT.family,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: '48px 40px 36px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 8px 40px rgba(92,79,92,0.12)',
  },
  logoWrap: { display: 'flex', justifyContent: 'center', marginBottom: '24px' },
  logo: { height: '90px', objectFit: 'contain' },
  subtitle: { color: COLORS.textSecondary, textAlign: 'center', marginBottom: '32px', fontSize: '15px', fontWeight: '400' },
  field: { marginBottom: '20px' },
  label: { display: 'block', fontSize: '13px', fontWeight: '400', color: COLORS.text, marginBottom: '6px', letterSpacing: '0.02em' },
  input: {
    width: '100%', padding: '13px 14px', borderRadius: RADIUS.md, border: `1.5px solid ${COLORS.inputBorder}`,
    fontSize: '15px', outline: 'none', boxSizing: 'border-box', color: COLORS.text, backgroundColor: COLORS.inputBg,
  },
  button: {
    width: '100%', padding: '14px', backgroundColor: COLORS.primary, color: 'white', border: 'none',
    borderRadius: RADIUS.md, fontSize: '15px', fontWeight: '500', cursor: 'pointer', marginTop: '8px', letterSpacing: '0.02em', outline: 'none',
  },
  error: {
    backgroundColor: COLORS.errorBg, color: COLORS.errorText, padding: '12px 16px', borderRadius: RADIUS.sm,
    marginBottom: '16px', fontSize: '14px', border: `1px solid ${COLORS.errorBorder}`,
  },
}
