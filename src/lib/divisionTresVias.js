// División en 3 (Vitto / Amelia / yo) de comida y servicios de la casa,
// pedida por el dueño de la cuenta: se aplica a todo gasto nuevo desde
// FECHA_DIVISION_3_DESDE en la categoría "Comida" o en las subcategorías de
// "Casa" listadas en CASA_SUBCATS_DIVISION_3. El monto se reparte en 3 partes
// iguales — el tercio que queda en la transacción original (sin tag) es "yo",
// los otros dos se insertan como transacciones nuevas con tag "Vitto"/"Amelia".
export const FECHA_DIVISION_3_DESDE = '2026-02-01'
export const CASA_SUBCATS_DIVISION_3 = ['Alquiler', 'Expensas', 'Luz', 'Gas', 'Internet', 'Teléfono']

export const aplicaDivisionTresVias = (t, comidaId, casaId, subServiciosIds) => {
  if (t.tipo !== 'gasto' || !t.fecha || t.fecha < FECHA_DIVISION_3_DESDE) return false
  return (comidaId && t.category_id === comidaId) || (casaId && t.category_id === casaId && subServiciosIds.has(t.subcategory_id))
}

export const dividirTresVias = (txs, categorias, subcategorias) => {
  const comidaId = categorias?.find(c => c.nombre === 'Comida')?.id
  const casaId = categorias?.find(c => c.nombre === 'Casa')?.id
  const subServiciosIds = new Set(
    (subcategorias || [])
      .filter(s => s.category_id === casaId && CASA_SUBCATS_DIVISION_3.includes(s.nombre))
      .map(s => s.id)
  )
  return (txs || []).flatMap(t => {
    if (!aplicaDivisionTresVias(t, comidaId, casaId, subServiciosIds)) return [t]
    const monto = Number(t.monto) || 0
    if (monto <= 0) return [t]
    const parteVitto = Math.round((monto / 3) * 100) / 100
    const parteAmelia = Math.round((monto / 3) * 100) / 100
    const parteYo = Math.round((monto - parteVitto - parteAmelia) * 100) / 100
    return [
      { ...t, monto: parteYo },
      { ...t, monto: parteVitto, tag: 'Vitto' },
      { ...t, monto: parteAmelia, tag: 'Amelia' },
    ]
  })
}
