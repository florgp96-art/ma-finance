import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Fallback en memoria del proceso. Ya no es el límite principal: solo actúa si la
// base no responde o si todavía no se corrió la migración de rate_limits.
const rateLimitMap = new Map()

function checkEnMemoria(key, limit, windowMs) {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

// Rate limit por clave arbitraria (se llama con `${endpoint}:${user.id}`, no con la
// IP): el header x-forwarded-for lo puede mandar el propio cliente, así que alcanzaba
// con cambiarlo en cada request para resetear el contador. Estos endpoints validan el
// JWT antes de llegar acá, así que el user_id es una clave que no se puede falsificar
// sin ser dueño de una cuenta real.
//
// El contador vive en la BASE, no en la memoria del proceso. Vercel levanta una
// instancia nueva en cada pico de tráfico y cada una tenía su propio Map: con un
// límite de 10 por minuto y cinco instancias entraban 50, y en frío —una instancia
// por request— no limitaba nada. Estos endpoints llaman a Claude, o sea que cada
// request que se cuela cuesta plata de verdad.
//
// La cuenta se hace del lado de Postgres (consume_rate_limit) para que sea atómica:
// dos requests simultáneas que leen y escriben por separado se pisan el contador y
// las dos pasan.
//
// Si la base falla se deja pasar, cayendo al contador en memoria, en vez de devolver
// 429. Es una decisión: un problema de infraestructura nuestro no puede dejar sin
// servicio a alguien que está pagando. El techo real del gasto sigue siendo el límite
// del plan (una carga por mes en el gratis), que se chequea aparte y contra la base.
export async function checkRateLimit(key, limit = 10, windowMs = 60 * 1000) {
  try {
    const { data, error } = await supabaseAdmin.rpc('consume_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    })
    if (error) {
      console.warn('rateLimit: sin contador compartido, se usa el de memoria:', error.message)
      return checkEnMemoria(key, limit, windowMs)
    }
    return data !== false
  } catch (err) {
    console.warn('rateLimit: error consultando el contador compartido:', err.message)
    return checkEnMemoria(key, limit, windowMs)
  }
}
