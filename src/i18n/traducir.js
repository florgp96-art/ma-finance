// Traducción de un texto suelto, del español en que está escrita la app al idioma
// del diccionario. El diccionario va con el texto en español como clave, tal cual
// figura en el código; los tramos variables de un template se escriben {0}, {1}…:
//   "Error al guardar: {0}"  →  "Error saving: {0}"
// Devuelve null si no lo conoce: ahí queda el original, en español.

const LETRA = /[A-Za-zÀ-ÖØ-öø-ÿ]/
const MAX_PROFUNDIDAD = 2

const normalizar = (s) => s.replace(/\s+/g, ' ').trim()
const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Una coincidencia sin distinguir mayúsculas copia la forma del original: "GASTOS"
// sale "EXPENSES" y "cuotas" (en medio de una frase) sale "installments".
const conMayusculasDe = (original, traduccion) => {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) return traduccion.toUpperCase()
  const primera = original.match(LETRA)?.[0]
  const indice = traduccion.search(LETRA)
  if (!primera || indice < 0) return traduccion
  const letra = primera === primera.toLowerCase()
    ? traduccion[indice].toLowerCase()
    : traduccion[indice].toUpperCase()
  return traduccion.slice(0, indice) + letra + traduccion.slice(indice + 1)
}

// Una plantilla sin palabras propias ("{0} de {1}", "{0} y {1}", "en {0}") calza
// también con lo que escribió el usuario: "Pago de tarjeta de crédito" salía
// "Payment of card of credit", y "Paso a Ahorros", "Paso to Savings".
const esDebil = (fijos) => (fijos.join(' ').match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) || []).every(w => w.length <= 3)

const compilarPlantilla = (clave, traduccion) => {
  const tramos = clave.split(/(\{\d+\})/)
  const fijos = tramos.filter((_, i) => i % 2 === 0)
  if (!LETRA.test(fijos.join(''))) return null
  const orden = []
  const fuente = tramos.map((t, i) => {
    if (i % 2 === 0) return escaparRegex(t)
    orden.push(t)
    return '([\\s\\S]*?)'
  }).join('')
  return {
    re: new RegExp(`^${fuente}$`),
    orden,
    traduccion,
    // El tramo fijo más largo filtra rápido las plantillas que no pueden ser.
    ancla: fijos.reduce((a, b) => (b.length > a.length ? b : a), ''),
    peso: fijos.join('').length,
    debil: esDebil(fijos),
  }
}

export const crearTraductor = (diccionario) => {
  const exactos = new Map()
  const sinMayusculas = new Map()
  const plantillas = []
  for (const [es, en] of Object.entries(diccionario || {})) {
    if (typeof en !== 'string' || !en) continue
    const clave = normalizar(es)
    if (/\{\d+\}/.test(clave)) {
      const plantilla = compilarPlantilla(clave, en)
      if (plantilla) plantillas.push(plantilla)
    } else if (clave) {
      exactos.set(clave, en)
      if (!sinMayusculas.has(clave.toLowerCase())) sinMayusculas.set(clave.toLowerCase(), en)
    }
  }
  // Primero las más específicas: "Error al guardar la regla: {0}" antes que
  // "Error al guardar: {0}".
  plantillas.sort((a, b) => b.peso - a.peso)

  // Palabras que solo existen del lado español del diccionario ("tarjeta", "de",
  // "sueldo"). Si después de traducir queda alguna, la frase salió mitad y mitad:
  // "{0} y {1}" sobre un movimiento llamado "Ovo Market sueldo + página y 14 USD"
  // daba "…página and 14 USD". Entre una frase mezclada y una entera en español,
  // la entera: se lee, y es lo que el usuario escribió.
  const palabras = (s) => s.toLowerCase().match(/[a-zà-öø-ÿ]+/g) || []
  const enIngles = new Set(Object.values(diccionario || {}).flatMap(v => (typeof v === 'string' ? palabras(v) : [])))
  const marcasDeEspanol = new Set(Object.keys(diccionario || {})
    .flatMap(k => palabras(k.replace(/\{\d+\}/g, ' ')))
    .filter(w => !enIngles.has(w)))
  const quedaEspanol = (s) => palabras(s).some(w => marcasDeEspanol.has(w))

  const buscarExacto = (nucleo) => {
    if (exactos.has(nucleo)) return exactos.get(nucleo)
    const parecido = sinMayusculas.get(nucleo.toLowerCase())
    return parecido === undefined ? null : conMayusculasDe(nucleo, parecido)
  }

  // En una plantilla débil, cada hueco con letras tiene que ser texto de la app.
  // Lo único que se deja pasar es un nombre suelto cuando es el único hueco: "De
  // Flor" → "By Flor". Y dentro de otro hueco no se usan: ahí todo es más chico y
  // casi seguro es del usuario.
  const esNombre = (s) => /^[A-ZÀ-ÖØ-Þ]\S*$/.test(s.trim()) && !quedaEspanol(s)

  const buscarPlantilla = (nucleo, profundidad) => {
    for (const p of plantillas) {
      if (p.ancla && !nucleo.includes(p.ancla)) continue
      const m = p.re.exec(nucleo)
      if (!m) continue
      const valores = p.orden.map((_, i) => m[i + 1])
      if (p.debil && profundidad > 0 && valores.some(v => LETRA.test(v))) continue
      let salida = p.traduccion
      let sirve = true
      p.orden.forEach((marca, i) => {
        const valor = valores[i]
        // Lo que va en el hueco también puede ser texto de la app ("No se pudo
        // {0}: …" con "guardar la regla" adentro).
        const traducido = profundidad < MAX_PROFUNDIDAD ? traducirConEspacios(valor, profundidad + 1) : null
        const final = traducido ?? valor
        if (p.debil) {
          if (traducido === null && LETRA.test(valor) && !(p.orden.length === 1 && esNombre(valor))) sirve = false
        } else if (quedaEspanol(final)) {
          sirve = false
        }
        salida = salida.split(marca).join(final)
      })
      if (sirve) return salida
    }
    return null
  }

  // Lo que rodea al texto y no es letra (un emoji, un número, "▾", dos puntos)
  // se deja como está y se traduce lo de adentro: "Octubre 2026", "3 cuotas".
  const buscarSinBordes = (nucleo) => {
    const m = /^([^A-Za-zÀ-ÖØ-öø-ÿ]*)([\s\S]*?)([^A-Za-zÀ-ÖØ-öø-ÿ]*)$/.exec(nucleo)
    if (!m || (!m[1] && !m[3]) || !m[2]) return null
    const adentro = buscarExacto(m[2])
    return adentro === null ? null : m[1] + adentro + m[3]
  }

  const traducirNucleo = (nucleo, profundidad) => {
    if (!LETRA.test(nucleo)) return null
    return buscarExacto(nucleo) ?? buscarPlantilla(nucleo, profundidad) ?? buscarSinBordes(nucleo)
  }

  // Conserva los espacios de los bordes: React parte "Tenés {n} cuotas" en tres
  // nodos de texto ("Tenés ", "3", " cuotas") y sin ellos las palabras se pegan.
  function traducirConEspacios(texto, profundidad = 0) {
    if (typeof texto !== 'string' || !texto) return null
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(texto)
    const directo = traducirNucleo(normalizar(m[2]), profundidad)
    if (directo !== null) return m[1] + directo + m[3]
    // Un mensaje de varias líneas (un alert, un aviso con saltos) va línea por
    // línea; uno armado pegando oraciones ("12 importadas. 3 omitidas."), oración
    // por oración; uno armado con puntos medios ("Visa · Octubre 2026 · falta el
    // PDF"), tramo por tramo.
    const porPartes = (partes, separador) => {
      if (partes.length < 2) return null
      let alguna = false
      let mezclada = false
      const traducidas = partes.map((parte) => {
        const t = traducirConEspacios(parte, profundidad)
        if (t !== null) { alguna = true; return t }
        if (quedaEspanol(parte)) mezclada = true
        return parte
      })
      return alguna && !mezclada ? m[1] + traducidas.join(separador) + m[3] : null
    }
    // (Sin lookbehind en la regex: Safari lo entiende recién desde la 16.4.)
    const oraciones = m[2].replace(/([.!?:])\s+(?=\S)/g, '$1\u0000').split('\u0000')
    return porPartes(m[2].split('\n'), '\n') ?? porPartes(oraciones, ' ') ?? porPartes(m[2].split(' · '), ' · ')
  }

  // Una tabla de movimientos repite los mismos textos cientos de veces, y cada
  // re-render los vuelve a pedir.
  const memoria = new Map()
  return (texto) => {
    if (memoria.has(texto)) return memoria.get(texto)
    const traducido = traducirConEspacios(texto, 0)
    if (memoria.size > 5000) memoria.clear()
    memoria.set(texto, traducido)
    return traducido
  }
}
