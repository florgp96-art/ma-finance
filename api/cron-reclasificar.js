import { createClient } from '@supabase/supabase-js'

const rateLimitMap = new Map()

function checkRateLimit(ip) {
  const now = Date.now()
  const windowMs = 60 * 1000
  const limit = 10
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  const entry = rateLimitMap.get(ip)
  if (now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown'
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests' })

  const supabase = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: rules } = await supabase.from('user_rules').select('*')
  const { data: neutroAliases } = await supabase.from('user_aliases').select('*').eq('tipo', 'neutro')

  if ((!rules || rules.length === 0) && (!neutroAliases || neutroAliases.length === 0)) {
    return res.status(200).json({ message: 'No rules found' })
  }

  const { data: transactions } = await supabase
    .from('transactions')
    .select('id, detalle, user_id')
    .eq('estado', 'a_identificar')

  if (!transactions || transactions.length === 0) {
    return res.status(200).json({ message: 'No transactions to classify' })
  }

  let updated = 0

  for (const tx of transactions) {
    const neutro = (neutroAliases || []).find(a =>
      a.user_id === tx.user_id &&
      tx.detalle &&
      tx.detalle.toUpperCase().includes(a.alias.toUpperCase())
    )
    if (neutro) {
      await supabase.from('transactions').update({ tipo: 'neutro', estado: 'identificado' }).eq('id', tx.id)
      updated++
      continue
    }

    const rule = (rules || []).find(r =>
      r.user_id === tx.user_id &&
      tx.detalle &&
      tx.detalle.toUpperCase().includes(r.texto_original.toUpperCase())
    )

    if (rule) {
      await supabase.from('transactions').update({
        nombre: rule.nombre_asignado,
        category_id: rule.category_id,
        subcategory_id: rule.subcategory_id || null,
        estado: 'identificado'
      }).eq('id', tx.id)
      updated++
    }
  }

  return res.status(200).json({ message: `Reclasificadas ${updated} transacciones` })
}
