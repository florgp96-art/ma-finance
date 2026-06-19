import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: rules } = await supabase.from('user_rules').select('*')

  if (!rules || rules.length === 0) {
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
    const rule = rules.find(r =>
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
