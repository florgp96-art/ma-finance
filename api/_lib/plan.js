// Legacy (usuarios de antes del paywall) o plan 'premium' con suscripción de
// Mercado Pago activa → sin límites. `premium_hasta` es el límite de una
// gracia (cancelación con período ya pagado, o reintento de cobro fallido) —
// mientras no se cumpla, sigue siendo premium; pasada la fecha, ya no,
// aunque nadie haya vuelto a tocar la fila (no depende de un cron).
export async function getUserPlan(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('plan, is_legacy, premium_hasta')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    // Columna `premium_hasta` inexistente (falta correr la migración) u otro
    // error de lectura: no bloqueamos a nadie por un problema nuestro.
    console.error('Error leyendo plan del usuario:', error.message)
    return { isPremium: true, plan: 'premium', isLegacy: true }
  }
  const isLegacy = !!data?.is_legacy
  const plan = data?.plan || 'free'
  const graciaVencida = !!data?.premium_hasta && new Date(data.premium_hasta) <= new Date()
  return { isPremium: isLegacy || (plan === 'premium' && !graciaVencida), plan, isLegacy }
}

// Cupo de "1 análisis con IA por mes" (PDF o foto de comprobante) del plan
// gratis. Se registra en `ai_usage` desde cada endpoint que llama a Claude
// para leer un extracto (analyze.js, analyzePdf.js, analyzeImage.js) — no
// depende de `import_logs` porque ese log lo escribe el frontend después de
// la respuesta, y puede no llamarse si se corta la conexión.
export async function hasUsedMonthlyAiQuota(supabaseAdmin, userId) {
  const inicioDeMes = new Date()
  inicioDeMes.setUTCDate(1)
  inicioDeMes.setUTCHours(0, 0, 0, 0)
  const { count } = await supabaseAdmin
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', inicioDeMes.toISOString())
  return (count || 0) >= 1
}

export async function recordAiUsage(supabaseAdmin, userId) {
  const { error } = await supabaseAdmin.from('ai_usage').insert({ user_id: userId })
  if (error) console.error('Error registrando uso de IA:', error.message)
}
