// Supabase Auth devuelve los errores en inglés. Esto traduce los que puede ver
// alguien que crea su cuenta o cambia la contraseña. Si no matchea ninguno, se
// muestra el mensaje original.
export const traducirErrorAuth = (error) => {
  const msg = typeof error === 'string' ? error : error?.message || ''
  const code = typeof error === 'string' ? '' : error?.code || ''
  const m = msg.toLowerCase()

  if (m.includes('already registered') || m.includes('already exists')) {
    return 'Ese email ya está registrado. Iniciá sesión en vez de crear una cuenta nueva.'
  }
  // "Prevent use of leaked passwords" (HaveIBeenPwned) en Authentication → Sign In / Providers → Email.
  if (m.includes('known to be weak') || m.includes('pwned') || m.includes('leaked')) {
    return 'Esa contraseña apareció en filtraciones de datos de otros sitios y es fácil de adivinar. Elegí otra.'
  }
  const largo = m.match(/at least (\d+) characters/)
  if (m.includes('password') && largo) {
    return `La contraseña tiene que tener al menos ${largo[1]} caracteres.`
  }
  if (m.includes('should contain at least one character')) {
    return 'La contraseña tiene que combinar letras minúsculas, mayúsculas, números y símbolos.'
  }
  if (code === 'same_password' || m.includes('different from the old password')) {
    return 'La contraseña nueva tiene que ser distinta de la actual.'
  }
  if (code === 'weak_password') return 'Esa contraseña es muy fácil de adivinar. Elegí otra.'
  if (m.includes('reauthentication')) {
    return 'Por seguridad, cerrá sesión y volvé a entrar antes de cambiar la contraseña.'
  }
  if (m.includes('invalid') && m.includes('email')) return 'El email no es válido.'
  if (m.includes('rate limit')) return 'Demasiados intentos. Esperá un momento y probá de nuevo.'
  return msg
}
