// Legacy (usuarios de antes del paywall) o plan 'premium' con suscripción de
// Mercado Pago activa → sin límites. Todo lo demás es plan gratis.
export async function getUserPlan(supabaseAdmin, userId) {
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('plan, is_legacy')
    .eq('id', userId)
    .maybeSingle()
  const isLegacy = !!data?.is_legacy
  const plan = data?.plan || 'free'
  return { isPremium: isLegacy || plan === 'premium', plan, isLegacy }
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
