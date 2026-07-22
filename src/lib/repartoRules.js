// Reglas de reparto (D2/D3): un gasto de cierta categoría/subcategoría (y
// opcionalmente un texto del comercio/descripción) se reparte entre "yo" y
// los hijos elegidos, en las proporciones definidas por el usuario en
// ConfigPanel.js. Generalizado — nada hardcodeado, todo sale de
// reparto_rules + children. La fila queda como UNA sola transacción con el
// monto total y metadata en "reparto" (mismo modelo que D1); nunca se
// duplica en varias filas.

// Prioridad cuando más de una regla matchea la misma transacción: la más
// específica gana (subcategoría + texto > subcategoría > texto > solo categoría).
const puntajeRegla = (r) => (r.subcategory_id ? 2 : 0) + (r.texto_match ? 1 : 0)

export const matchRepartoRule = (t, rules) => {
  if (!t || t.tipo !== 'gasto') return null
  const monto = Number(t.monto) || 0
  if (monto <= 0) return null
  const candidatas = (rules || []).filter(r => {
    if (r.category_id !== t.category_id) return false
    if (r.subcategory_id && r.subcategory_id !== t.subcategory_id) return false
    if (r.texto_match) {
      const texto = `${t.nombre || ''} ${t.detalle || ''}`.toUpperCase()
      if (!texto.includes(r.texto_match.toUpperCase())) return false
    }
    return true
  })
  if (candidatas.length === 0) return null
  return [...candidatas].sort((a, b) => puntajeRegla(b) - puntajeRegla(a))[0]
}

// Devuelve la transacción con "reparto" calculado a partir de la regla, o la
// misma transacción sin cambios si la regla no tiene a nadie más que "yo".
export const aplicarReglaReparto = (t, rule) => {
  const monto = Number(t.monto) || 0
  const otros = (rule.participantes || []).filter(p => p.tipo !== 'yo')
  if (otros.length === 0) return t
  const participantes = otros.map(p => {
    const porcentaje = Number(p.porcentaje) || 0
    return {
      tipo: p.tipo,
      ...(p.child_id ? { child_id: p.child_id } : {}),
      nombre: p.nombre,
      porcentaje,
      monto: Math.round(monto * porcentaje / 100 * 100) / 100,
    }
  })
  return { ...t, reparto: { tipo: 'regla', regla_id: rule.id, participantes } }
}

// Aplica la mejor regla que matchee a cada transacción de la lista (usado en
// cada punto de ingesta: carga manual, Excel, extractos de PDF).
export const aplicarReglasReparto = (txs, rules) => {
  if (!rules || rules.length === 0) return txs || []
  return (txs || []).map(t => {
    const rule = matchRepartoRule(t, rules)
    return rule ? aplicarReglaReparto(t, rule) : t
  })
}
