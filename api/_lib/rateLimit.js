const rateLimitMap = new Map()

// Rate limit por clave arbitraria (se llama con `${endpoint}:${user.id}`, no
// con la IP): el header x-forwarded-for lo puede mandar el propio cliente, así
// que alcanzaba con cambiarlo en cada request para resetear el contador. Estos
// endpoints ya validan el JWT antes de llegar acá, así que el user_id es una
// clave que no se puede falsificar sin ser dueño de una cuenta real.
//
// Sigue siendo un Map en memoria del proceso (no compartido entre instancias
// de Vercel) — no resuelve el escalado horizontal, pero saca la forma más
// fácil de evadirlo hoy (spoofear un header).
export function checkRateLimit(key, limit = 10, windowMs = 60 * 1000) {
  const now = Date.now()
  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  const entry = rateLimitMap.get(key)
  if (now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}
