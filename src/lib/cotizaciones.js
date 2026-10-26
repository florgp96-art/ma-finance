// Cotizaciones del dólar y del euro: cómo se arma el euro de cada tipo de dólar y qué
// se guarda de cada mes en exchange_rates.

export const TIPOS_DE_DOLAR = ['blue', 'mep', 'oficial', 'tarjeta']

// El euro solo tiene cotización oficial (dolarapi no publica un euro blue ni MEP). El
// dólar, en cambio, se mira en el tipo que eligió cada persona — blue por defecto —,
// así que el euro quedaba siempre más barato que lo que se paga en la calle: con el
// blue un 6 % arriba del oficial, € 497 que se cambiaron por $ 898.212 ($ 1.807 cada
// uno) figuraban a $ 1.707. Cada tipo de euro sale del oficial por el mismo salto que
// hay entre ese dólar y el oficial (el cruce EUR/USD es el mismo en todos lados).
export const eurosPorTipoDeDolar = ({ eur, oficial, ...dolares } = {}) => {
  if (!(eur > 0)) return {}
  const euros = { eur_oficial: eur }
  if (!(oficial > 0)) return euros
  for (const tipo of TIPOS_DE_DOLAR) {
    if (tipo !== 'oficial' && dolares[tipo] > 0) euros[`eur_${tipo}`] = Math.round(eur * dolares[tipo] / oficial)
  }
  return euros
}

// Nombre con el que se guarda en exchange_rates el euro de un tipo de dólar. El
// oficial es "euro" a secas: así se guardó siempre, antes de que hubiera otros.
export const tipoDeEuro = (tipoDolar) => (tipoDolar && tipoDolar !== 'oficial' ? `euro_${tipoDolar}` : 'euro')

// Filas para guardar (upsert por periodo + tipo) las cotizaciones de hoy como las del
// mes: cada dólar, el euro oficial y el euro de cada tipo de dólar.
export const filasDeCotizacionDelMes = (cotizaciones, periodo) => {
  const filas = []
  for (const tipo of TIPOS_DE_DOLAR) {
    if (cotizaciones[tipo] > 0) filas.push({ periodo, tipo, valor: cotizaciones[tipo] })
  }
  for (const tipo of TIPOS_DE_DOLAR) {
    const valor = cotizaciones[`eur_${tipo}`]
    if (valor > 0) filas.push({ periodo, tipo: tipoDeEuro(tipo), valor })
  }
  return filas
}

// Cotización del euro de cada mes para el tipo de dólar elegido. Los meses guardados
// antes de que existiera el euro por tipo (hasta octubre de 2026) solo tienen el
// oficial: ahí se usa ese, que es mejor que convertir con el euro de hoy.
export const euroPorMes = (filas, tipoDolar) => {
  const delTipo = tipoDeEuro(tipoDolar)
  const porMes = {}
  for (const r of filas || []) if (r.tipo === 'euro') porMes[r.periodo] = r.valor
  for (const r of filas || []) if (r.tipo === delTipo) porMes[r.periodo] = r.valor
  return porMes
}
