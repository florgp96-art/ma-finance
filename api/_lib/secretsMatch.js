import crypto from 'node:crypto'

// Comparación de secretos (headers de cron/webhook) en tiempo constante en vez
// de `!==` — una comparación simple de string corta apenas encuentra el primer
// byte distinto, lo que en teoría deja filtrar el secreto por temporización.
export function secretsMatch(provided, expected) {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
