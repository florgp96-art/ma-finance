// La app en otro idioma sin tocar cada pantalla: la interfaz se sigue escribiendo
// en español y, con el inglés elegido, esto traduce lo que React deja en la página
// —textos, placeholders, títulos— a medida que aparece o cambia. Nunca toca los
// datos ni los valores de los campos: solo lo que se ve.
//
// Con React convive bien porque cambia el contenido de cada nodo de texto en el
// lugar, sin reemplazarlo: cuando React vuelve a escribir uno, el observador ve el
// cambio y lo traduce de nuevo. Lo que no está en el diccionario queda en español.

import { crearTraductor } from './traducir'

const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'alt']
// Lo que se escribe (o se pega) no se traduce, ni lo que se marca a propósito con
// translate="no": el selector de idioma, nombres propios.
const NO_TRADUCIR = 'script, style, textarea, [translate="no"], [contenteditable=""], [contenteditable="true"]'
const LETRA = /[A-Za-zÀ-ÖØ-öø-ÿ]/

let traducir = null
let observador = null
// nodo de texto → { es, en }: con qué texto lo dejó React y cuál pusimos encima.
let textos = new WeakMap()
// elemento → { atributo: { es, en } }
let atributos = new WeakMap()
let dialogosOriginales = null

const excluido = (elemento) => !!elemento?.closest?.(NO_TRADUCIR)
// Lo que se escribe en un textarea no se toca, pero su placeholder es de la app.
const esTextarea = (el) => el?.tagName === 'TEXTAREA'
const excluidoAtributo = (el) => (esTextarea(el) ? excluido(el.parentElement) : excluido(el))

// Lo que React escribió en el nodo: si tiene puesto lo nuestro, lo que había debajo.
const originalDe = (nodo) => {
  const previo = textos.get(nodo)
  return previo && nodo.nodeValue === previo.en ? previo.es : nodo.nodeValue
}

const escribir = (nodo, es, en) => {
  textos.set(nodo, { es, en })
  if (nodo.nodeValue !== en) nodo.nodeValue = en
}

const devolver = (nodo, es) => {
  if (!textos.has(nodo)) return
  textos.delete(nodo)
  if (nodo.nodeValue !== es) nodo.nodeValue = es
}

// React deja "Plata que tenés{hoy ? ' hoy' : …}" en dos nodos de texto seguidos.
// Traducidos de a uno salía "Money you have hoy": la frase se traduce entera, va
// en el primer nodo y los demás quedan vacíos. Si después React cambia uno de los
// pedazos, se vuelve a armar la frase con lo que haya en cada uno.
const soloTextos = (el) => {
  const hijos = el?.childNodes
  if (!hijos || hijos.length < 2) return false
  for (const h of hijos) if (h.nodeType !== Node.TEXT_NODE) return false
  return true
}

const traducirGrupo = (el) => {
  const hijos = [...el.childNodes]
  const originales = hijos.map(originalDe)
  if (excluido(el)) { hijos.forEach((h, i) => devolver(h, originales[i])); return }
  const junto = originales.join('')
  const entero = LETRA.test(junto) ? traducir(junto) : null
  if (entero !== null && entero !== junto) {
    hijos.forEach((h, i) => escribir(h, originales[i], i === 0 ? entero : ''))
    return
  }
  hijos.forEach((h, i) => {
    const en = LETRA.test(originales[i]) ? traducir(originales[i]) : null
    if (en === null || en === originales[i]) devolver(h, originales[i])
    else escribir(h, originales[i], en)
  })
}

// Siempre desde lo que escribió React: un nodo que quedó solo después de ser parte
// de una frase traducida entera tiene que traducirse otra vez, solo.
const traducirTexto = (nodo) => {
  if (soloTextos(nodo.parentElement)) { traducirGrupo(nodo.parentElement); return }
  const original = originalDe(nodo)
  const en = original && LETRA.test(original) && !excluido(nodo.parentElement) ? traducir(original) : null
  if (en === null || en === original) devolver(nodo, original)
  else escribir(nodo, original, en)
}

const traducirAtributo = (elemento, nombre) => {
  const actual = elemento.getAttribute(nombre)
  const propios = atributos.get(elemento) || {}
  const previo = propios[nombre]
  if (previo && actual === previo.en) return
  const en = actual && LETRA.test(actual) && !excluidoAtributo(elemento) ? traducir(actual) : null
  if (en === null || en === actual) {
    if (previo) delete propios[nombre]
    return
  }
  propios[nombre] = { es: actual, en }
  atributos.set(elemento, propios)
  elemento.setAttribute(nombre, en)
}

const recorrer = (raiz, alTexto, alElemento) => {
  if (raiz.nodeType === Node.TEXT_NODE) { alTexto(raiz); return }
  if (raiz.nodeType !== Node.ELEMENT_NODE && raiz.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  if (raiz.nodeType === Node.ELEMENT_NODE) {
    if (raiz.matches(NO_TRADUCIR)) { if (esTextarea(raiz)) alElemento(raiz); return }
    alElemento(raiz)
  }
  const textareas = []
  const caminante = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType !== Node.ELEMENT_NODE || !n.matches(NO_TRADUCIR)) return NodeFilter.FILTER_ACCEPT
      if (esTextarea(n)) textareas.push(n)
      return NodeFilter.FILTER_REJECT
    },
  })
  for (let n = caminante.nextNode(); n; n = caminante.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) alTexto(n)
    else alElemento(n)
  }
  textareas.forEach(alElemento)
}

const traducirArbol = (raiz) => recorrer(raiz, traducirTexto, (el) => {
  for (const nombre of ATRIBUTOS) if (el.hasAttribute(nombre)) traducirAtributo(el, nombre)
})

const restaurarArbol = (raiz) => recorrer(raiz, (nodo) => {
  const previo = textos.get(nodo)
  if (previo && nodo.nodeValue === previo.en) nodo.nodeValue = previo.es
}, (el) => {
  const propios = atributos.get(el)
  if (!propios) return
  for (const [nombre, { es, en }] of Object.entries(propios)) {
    if (el.getAttribute(nombre) === en) el.setAttribute(nombre, es)
  }
})

const alCambiar = (registros) => {
  for (const r of registros) {
    if (r.type === 'characterData') traducirTexto(r.target)
    else if (r.type === 'attributes') traducirAtributo(r.target, r.attributeName)
    else {
      r.addedNodes.forEach(traducirArbol)
      // Si React sacó un pedazo de una frase que estaba traducida entera, lo que
      // queda tiene que volver a traducirse solo.
      if (r.removedNodes.length > 0 && r.target.nodeType === Node.ELEMENT_NODE) {
        const texto = [...r.target.childNodes].find(h => h.nodeType === Node.TEXT_NODE)
        if (texto) traducirTexto(texto)
      }
    }
  }
}

// alert / confirm / prompt los escribe el navegador, no la página.
const traducirDialogos = () => {
  if (dialogosOriginales || typeof window === 'undefined') return
  dialogosOriginales = { alert: window.alert, confirm: window.confirm, prompt: window.prompt }
  const mensaje = (m) => (typeof m === 'string' ? traducir(m) ?? m : m)
  window.alert = (m) => dialogosOriginales.alert.call(window, mensaje(m))
  window.confirm = (m) => dialogosOriginales.confirm.call(window, mensaje(m))
  window.prompt = (m, valor) => dialogosOriginales.prompt.call(window, mensaje(m), valor)
}

const restaurarDialogos = () => {
  if (!dialogosOriginales) return
  Object.assign(window, dialogosOriginales)
  dialogosOriginales = null
}

export const traduccionActiva = () => observador !== null

export const activarTraduccion = (diccionario, raiz = document.body) => {
  if (observador) return
  traducir = crearTraductor(diccionario)
  traducirArbol(raiz)
  observador = new MutationObserver(alCambiar)
  observador.observe(raiz, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATRIBUTOS,
  })
  traducirDialogos()
}

export const desactivarTraduccion = (raiz = document.body) => {
  if (!observador) return
  // Lo que quedó pendiente de traducir no hace falta: se vuelve al español.
  observador.takeRecords()
  observador.disconnect()
  observador = null
  restaurarArbol(raiz)
  restaurarDialogos()
  textos = new WeakMap()
  atributos = new WeakMap()
}
