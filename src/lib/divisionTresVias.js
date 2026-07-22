// División en 3 (Vitto / Amelia / yo) de comida y servicios de la casa,
// pedida por el dueño de la cuenta: se aplica a todo gasto nuevo desde
// FECHA_DIVISION_3_DESDE en la categoría "Comida" o en las subcategorías de
// "Casa" listadas en CASA_SUBCATS_DIVISION_3. La transacción queda en una
// sola fila con el monto total, y el campo "reparto" guarda cuánto de ese
// monto le corresponde a Vitto y a Amelia (dos tercios entre los dos) — el
// tercio restante, implícito, es de la cuenta dueña. Mismo modelo que usan
// las divisiones históricas ya migradas (antes se insertaban como 3 filas
// separadas con tag "Vitto"/"Amelia"; eso quedó descontinuado).
export const FECHA_DIVISION_3_DESDE = '2026-02-01'
export const CASA_SUBCATS_DIVISION_3 = ['Alquiler', 'Expensas', 'Luz', 'Gas', 'Internet', 'Teléfono']

// Esta división es un hack personal de una sola cuenta (los hijos hardcodeados
// son Vitto y Amelia), no una feature general de la app — la app es multiusuario
// y cualquier otra cuenta con una categoría "Comida" pisaría este mismo código.
// Gateado por user_id hasta que exista el reparto configurable por cliente.
export const USER_ID_DIVISION_3 = '66029aec-97f5-40df-8779-54d9e6957fb2'

export const aplicaDivisionTresVias = (t, comidaId, casaId, subServiciosIds) => {
  if (t.tipo !== 'gasto' || !t.fecha || t.fecha < FECHA_DIVISION_3_DESDE) return false
  return (comidaId && t.category_id === comidaId) || (casaId && t.category_id === casaId && subServiciosIds.has(t.subcategory_id))
}

export const dividirTresVias = (txs, categorias, subcategorias, userId) => {
  if (userId !== USER_ID_DIVISION_3) return txs || []
  const comidaId = categorias?.find(c => c.nombre === 'Comida')?.id
  const casaId = categorias?.find(c => c.nombre === 'Casa')?.id
  const subServiciosIds = new Set(
    (subcategorias || [])
      .filter(s => s.category_id === casaId && CASA_SUBCATS_DIVISION_3.includes(s.nombre))
      .map(s => s.id)
  )
  return (txs || []).map(t => {
    if (!aplicaDivisionTresVias(t, comidaId, casaId, subServiciosIds)) return t
    const monto = Number(t.monto) || 0
    if (monto <= 0) return t
    const parteVitto = Math.round((monto / 3) * 100) / 100
    const parteAmelia = Math.round((monto / 3) * 100) / 100
    return {
      ...t,
      reparto: {
        tipo: 'tercios',
        participantes: [
          { nombre: 'Vitto', monto: parteVitto },
          { nombre: 'Amelia', monto: parteAmelia },
        ],
      },
    }
  })
}
