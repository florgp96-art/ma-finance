import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from './_lib/rateLimit.js'
import { secretsMatch } from './_lib/secretsMatch.js'

export default async function handler(req, res) {
  if (!secretsMatch(req.headers['authorization'], `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!checkRateLimit('cron-reclasificar', 10)) return res.status(429).json({ error: 'Too many requests' })

  const supabase = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Los "contexto_*" son marcadores (ej. "contexto_hijo") con un category_id
  // ajeno, no reglas de clasificación reales — el resto de la app (Dashboard.js,
  // analyzePrompt.js) ya los filtra antes de aplicar reglas; acá faltaba.
  const { data: rulesData } = await supabase.from('user_rules').select('*')
  const rules = (rulesData || []).filter(r => !r.texto_original?.startsWith('contexto_'))
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
