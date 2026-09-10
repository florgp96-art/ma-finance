// Reglas aprendidas y alias del usuario aplicados por código a lo que devuelve
// la IA (o el parser directo) al importar un resumen.
//
// Existe aparte del prompt a propósito: el prompt le PIDE a la IA que respete
// lo que el usuario ya enseñó, pero nada garantiza que lo haga. Acá se vuelve a
// aplicar sobre el resultado, así una regla que el usuario creó una vez se usa
// sola en cada resumen nuevo aunque la IA la haya ignorado.

// Único lugar que sabe matchear los alias del usuario (categoría, hijo, neutro,
// split) contra una descripción — lo usan tanto la importación por Excel
// (clasificarYPrevisualizarExcel) como la de PDF/foto (aplicarReglasYAlias), para
// que un tipo de alias nuevo se aplique en los dos flujos sin tener que acordarse
// de tocar dos lugares distintos (así quedó "neutro" aplicándose en uno y no en
// el otro).
//
// Los alias matchean por CONTENIDO (includes), no por igualdad: sirven para
// comercios cuya descripción cambia de mes a mes ("STB KM 43", "STB KM 52") y
// donde lo estable es un pedazo del texto ("STB KM").
export const buscarAliases = (descUpper, aliasesList) => ({
  categoria: (aliasesList || []).find(a => a.tipo === 'categoria' && descUpper.includes(a.alias)),
  hijo: (aliasesList || []).find(a => a.tipo === 'hijo' && descUpper.includes(a.alias)),
  neutro: (aliasesList || []).find(a => a.tipo === 'neutro' && descUpper.includes(a.alias)),
  split: (aliasesList || []).find(a => a.tipo === 'split' && descUpper.includes(a.alias)),
})

// Una regla aprendida matchea por igualdad o por prefijo en cualquiera de los
// dos sentidos: la descripción del banco suele traer una referencia variable
// pegada al final del nombre del comercio.
const matchRegla = (descNorm, rules) => (rules || []).find(r => {
  const rNorm = (r.texto_original || '').toLowerCase().trim()
  return rNorm && (descNorm === rNorm || descNorm.startsWith(rNorm) || rNorm.startsWith(descNorm))
})

// Prioridad: reglas aprendidas > alias de categoría/hijo.
export const aplicarReglasYAlias = (transacciones, rules, aliasesList) => {
  return (transacciones || []).flatMap(t => {
    const descNorm = ((t.descripcion || t.nombre_original || '') + ' ' + (t.nombre_limpio || '')).toLowerCase().trim()
    const descUpper = descNorm.toUpperCase()
    let updated = { ...t }
    const ruleMatch = matchRegla(descNorm, rules)
    // La regla aprendida (categoría) tiene prioridad sobre el alias de
    // categoría, pero los alias de hijo/neutro aplican SIEMPRE: la regla
    // aprendida no guarda hijo, y antes lo pisaba (un gasto con regla de
    // categoría nunca recibía su hijo/a por alias).
    const { categoria: catAlias, hijo: hijoAlias, neutro: neutroAlias, split: splitAlias } = buscarAliases(descUpper, aliasesList)
    // Una regla aprendida o un alias de categoría son cosas que el usuario YA
    // contestó, así que el movimiento entra resuelto y no se vuelve a preguntar
    // (ver regla_usuario en los inserts de la importación). La regla además trae
    // el nombre que el usuario eligió: se aplica acá para que el comercio se vea
    // con su nombre real y no con la sigla del banco.
    if (ruleMatch) {
      updated.categoria_sugerida = ruleMatch.categoria
      updated.subcategoria_sugerida = ruleMatch.subcategoria
      if (ruleMatch.nombre_asignado) updated.nombre_limpio = ruleMatch.nombre_asignado
      updated.regla_usuario = true
    } else if (catAlias) {
      const [cat, subcat] = catAlias.valor.split(' > ').map(v => v.trim())
      updated.categoria_sugerida = cat
      updated.subcategoria_sugerida = subcat || null
      updated.regla_usuario = true
    }
    if (hijoAlias) updated.hijo = hijoAlias.valor
    if (neutroAlias) updated.tipo = 'neutro'
    // Regla "dividir con hijo/a" (ej. OSDE → 50% Amelia): el gasto se parte
    // en dos movimientos reales, así gráficos, totales y detalle por hijo
    // cierran solos sin lógica especial en ningún otro lado.
    const montoNum = Number(updated.monto) || 0
    if (splitAlias && updated.tipo !== 'ingreso' && montoNum > 0) {
      const [hijoNombre, pctStr] = String(splitAlias.valor || '').split(':')
      const pct = Math.min(95, Math.max(5, parseFloat(pctStr) || 50))
      const parteHijo = Math.round(montoNum * pct) / 100
      const parteResto = Math.round((montoNum - parteHijo) * 100) / 100
      if (hijoNombre && parteHijo > 0 && parteResto > 0) {
        return [
          { ...updated, monto: parteHijo, hijo: hijoNombre },
          { ...updated, monto: parteResto, hijo: updated.hijo && updated.hijo !== hijoNombre ? updated.hijo : null },
        ]
      }
    }
    return [updated]
  })
}

// ¿Este movimiento ya está resuelto y NO hay que preguntarle nada al usuario?
// Un movimiento se pregunta solo si no se sabe qué es. Tres cosas alcanzan para
// no preguntar: que sea neutro (un pago, una transferencia propia — no es un
// gasto a clasificar), que lo resuelva una regla o alias del usuario, o que la
// IA haya podido darle un nombre legible distinto al del banco.
export const yaIdentificado = (t) => Boolean(
  t.tipo === 'neutro' || t.regla_usuario || (t.nombre_limpio && t.nombre_limpio !== t.nombre_original)
)
