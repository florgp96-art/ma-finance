import { traducirErrorAuth } from './erroresAuth'

test('contraseña filtrada (protección HaveIBeenPwned de Supabase)', () => {
  const error = { code: 'weak_password', message: 'Password is known to be weak and easy to guess, please choose a different one.' }
  expect(traducirErrorAuth(error)).toMatch(/filtraciones/)
})

test('largo mínimo: usa el número que manda Supabase', () => {
  expect(traducirErrorAuth({ code: 'weak_password', message: 'Password should be at least 8 characters.' }))
    .toBe('La contraseña tiene que tener al menos 8 caracteres.')
  expect(traducirErrorAuth('Password should be at least 6 characters'))
    .toBe('La contraseña tiene que tener al menos 6 caracteres.')
})

test('otros errores de contraseña y de alta', () => {
  expect(traducirErrorAuth({ code: 'same_password', message: 'New password should be different from the old password.' }))
    .toBe('La contraseña nueva tiene que ser distinta de la actual.')
  expect(traducirErrorAuth({ message: 'User already registered' })).toMatch(/ya está registrado/)
  expect(traducirErrorAuth({ message: 'Email rate limit exceeded' })).toMatch(/Demasiados intentos/)
  expect(traducirErrorAuth({ code: 'weak_password', message: 'Something new' })).toMatch(/fácil de adivinar/)
})

test('lo desconocido se muestra tal cual, y no rompe con valores vacíos', () => {
  expect(traducirErrorAuth({ message: 'Database error saving new user' })).toBe('Database error saving new user')
  expect(traducirErrorAuth(null)).toBe('')
  expect(traducirErrorAuth(undefined)).toBe('')
})
