import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from './_lib/rateLimit.js'
import { secretsMatch } from './_lib/secretsMatch.js'

// PostgREST devuelve como máximo 1000 filas por consulta: sin paginar, cada noche se
// miraban solo los primeros 1000 movimientos sin identificar.
async function leerTodo(armarConsulta) {
  const PAGINA = 1000
  const todo = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await armarConsulta().range(desde, desde + PAGINA - 1)
    if (error) return { data: null, error }
    todo.push(...(data || []))
    if (!data || data.length < PAGINA) return { data: todo, error: null }
  }
}

// Una regla de una o dos letras ("MP", "YP") aparece adentro de cualquier detalle y
// clasificaba de más: se piden al menos tres.
const LARGO_MINIMO_REGLA = 3

export const maxDuration = 60

export default async function handler(req, res) {
  if (!secretsMatch(req.headers['authorization'], `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!await checkRateLimit('cron-reclasificar', 10)) return res.status(429).json({ error: 'Too many requests' })

  const supabase = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Los "contexto_*" son marcadores (ej. "contexto_hijo") con un category_id
  // ajeno, no reglas de clasificación reales — el resto de la app (Dashboard.js,
  // analyzePrompt.js) ya los filtra antes de aplicar reglas; acá faltaba.
  // user_rules también guarda preferencias ("__pref__…", "__servicios__") que no son
  // reglas de clasificación.
  const { data: rulesData } = await leerTodo(() => supabase.from('user_rules').select('*').order('id'))
  const rules = (rulesData || []).filter(r => {
    const texto = (r.texto_original || '').trim()
    return texto.length >= LARGO_MINIMO_REGLA && !texto.startsWith('contexto_') && !texto.startsWith('__')
  })
  const { data: aliasesData } = await leerTodo(() => supabase.from('user_aliases').select('*').eq('tipo', 'neutro').order('id'))
  const neutroAliases = (aliasesData || []).filter(a => (a.alias || '').trim().length >= LARGO_MINIMO_REGLA)

  if ((!rules || rules.length === 0) && (!neutroAliases || neutroAliases.length === 0)) {
    return res.status(200).json({ message: 'No rules found' })
  }

  const { data: transactions } = await leerTodo(() => supabase
    .from('transactions')
    .select('id, detalle, user_id')
    .eq('estado', 'a_identificar')
    .order('id'))

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
