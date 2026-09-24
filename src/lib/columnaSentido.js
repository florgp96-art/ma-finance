import { supabase } from './supabase'

// ¿La base ya tiene transactions.sentido?
//
// La columna se agrega con una migración que el dueño corre aparte (ver
// docs/PENDIENTES.md), y hasta entonces un insert que la mande falla entero. Se
// pregunta antes de escribir en vez de reintentar sin ella después porque, sin la
// columna, tampoco conviene que la importación pase a neutro la compra y venta de
// moneda: sin sentido, la pata que entra se restaría del saldo.
//
// Solo se recuerda el sí: un no puede ser un corte de red, y la migración se puede
// correr con la app abierta.
let hayColumna = false

export const hayColumnaSentido = async () => {
  if (hayColumna) return true
  const { error } = await supabase.from('transactions').select('sentido').limit(1)
  hayColumna = !error
  return hayColumna
}
