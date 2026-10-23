// Los textos en español que muestra la app, sacados del código de src/ (sin tests).
// Lo usa src/i18n/en.test.js para avisar qué textos nuevos no tienen traducción al
// inglés todavía. Corrido a mano, lista los que faltan:
//
//   node scripts/textosDeLaApp.js
//
// Devuelve cada texto tal cual se arma en la pantalla: los literales sueltos, el
// texto de JSX y los templates con sus partes variables escritas {0}, {1}…
// ("Error al guardar: {0}"). Lo que es claramente código (columnas de Supabase,
// estilos, claves de localStorage, identificadores) se deja afuera.

const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const ATRIBUTOS_DE_CODIGO = new Set(['style', 'className', 'key', 'type', 'name', 'id', 'href', 'src', 'rel',
  'target', 'inputMode', 'autoComplete', 'role', 'method', 'accept', 'htmlFor', 'd', 'fill', 'stroke', 'dataKey',
  'viewBox', 'xmlns', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'lang', 'pattern', 'enterKeyHint',
  'capture', 'loading', 'decoding', 'layout', 'orientation', 'stackId', 'textAnchor', 'dominantBaseline',
  'transform', 'points', 'cursor', 'width', 'height', 'color', 'background', 'align', 'justify', 'direction',
  'mode', 'variant', 'size', 'icon', 'tipo', 'moneda', 'value', 'defaultValue', 'step', 'min', 'max', 'translate'])

const PROPIEDADES_DE_CODIGO = new Set(['color', 'background', 'backgroundColor', 'border', 'fontFamily',
  'fontWeight', 'display', 'position', 'cursor', 'textAlign', 'alignItems', 'justifyContent', 'flexDirection',
  'flexWrap', 'whiteSpace', 'overflow', 'textTransform', 'boxShadow', 'transition', 'transform',
  'gridTemplateColumns', 'padding', 'margin', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'borderRadius', 'fontSize', 'lineHeight', 'gap', 'outline', 'borderBottom', 'borderTop', 'borderLeft',
  'borderRight', 'textDecoration', 'overflowX', 'overflowY', 'wordBreak', 'overflowWrap', 'boxSizing',
  'verticalAlign', 'letterSpacing', 'opacity', 'zIndex', 'animation', 'backgroundImage', 'objectFit',
  'pointerEvents', 'userSelect', 'WebkitTapHighlightColor', 'id', 'key', 'tipo', 'type', 'moneda', 'icon',
  'emoji', 'categoria_key', 'campo', 'col', 'columna', 'tabla', 'table', 'model', 'role', 'media_type',
  'contentType', 'mimeType', 'cacheControl', 'accept', 'inset', 'top', 'left', 'right', 'bottom', 'flex',
  'flexShrink', 'flexGrow', 'alignSelf', 'gridColumn', 'resize', 'fill', 'stroke', 'backgroundClip',
  'WebkitBackgroundClip', 'backdropFilter', 'filter', 'colorScheme', 'appearance', 'clave'])

// Llamadas cuyos argumentos son código: consultas, almacenamiento, DOM, regex.
const LLAMADAS_DE_CODIGO = /^(console\.|localStorage\.|sessionStorage\.|require$|import$|.*\.(from|select|eq|neq|in|is|order|gte|lte|gt|lt|ilike|like|match|not|or|rpc|contains|getItem|setItem|removeItem|addEventListener|removeEventListener|createElement|getElementById|setAttribute|getAttribute|split|replace|startsWith|endsWith|includes|indexOf|join|padStart|toLocaleString|toLocaleDateString|test|storage|channel|on|invoke|upload|download|getPublicUrl|createSignedUrl|dispatchEvent|matchMedia)$|.*\.querySelector|fetch$|Intl\..*|RegExp$)/

const conLetras = (s) => /[A-Za-zÁÉÍÓÚáéíóúñÑüÜ]/.test(s)

// true: es código. 'minuscula': una sola palabra en minúscula sin acentos, que
// como literal suele ser un identificador pero como texto de JSX es texto.
const pareceCodigo = (s) => {
  const t = s.trim()
  if (!t) return true
  if (/^(https?:|mailto:|data:|\/|\.\/|#|var\(|rgba?\(|calc\(|linear-gradient)/.test(t)) return true
  if (/^\d+(\.\d+)?(px|rem|em|%|vh|vw|dvh|ms|s|fr|deg)?( \d+(\.\d+)?(px|rem|em|%|vh|vw)?)*$/.test(t)) return true
  if (/\b\d+px\b|solid |flex|inherit|transparent|ease-in|ease-out|uppercase|nowrap|pointer|absolute|relative|ellipsis|break-word|center$/.test(t) &&
    !/[áéíóúñ¿¡]/i.test(t) && t.split(' ').length < 6) return true
  if (/^[a-z][a-zA-Z0-9]*$/.test(t) && !/[áéíóúñ]/.test(t)) return 'minuscula'
  if (/^[a-z0-9_.:\-/]+$/.test(t) && /[_.:/-]/.test(t)) return true
  if (/^[A-Z0-9_]+$/.test(t) && t.length <= 5) return true
  if (/^[A-Z_][A-Z0-9_]+$/.test(t)) return true
  if (/^[\d\s.,:$%€+\-*/=()<>!?·•—–|×✓✕✗✔︎→←↑↓…]+$/.test(t)) return true
  return false
}

// Un template con partes variables es texto si sus tramos fijos tienen alguna
// palabra y no son CSS, filtros de Supabase ni rutas.
const plantillaDeCodigo = (txt) => {
  const fijo = txt.replace(/\{\d+\}/g, ' ')
  if (!/[A-Za-zÁÉÍÓÚáéíóúñÑ]{2,}/.test(fijo)) return true
  // Sin espacios y solo con caracteres de identificador: claves, rutas, nombres de
  // archivo ("tc_manual_{0}", "gastos-{0}.csv", "{0}/dashboard").
  if (/^[\w:./\-]*$/.test(txt.replace(/\{\d+\}/g, ''))) return true
  return /px\b|var\(|rgba?\(|calc\(|\.eq\.|\.in\.|\.is\.|^\/|https?:|solid|translate|#[0-9a-f]{3}/i.test(txt)
}

const nombreDeLlamada = (n) => {
  if (!n) return ''
  if (n.type === 'Identifier') return n.name
  if (n.type === 'MemberExpression') return `${nombreDeLlamada(n.object)}.${n.property.name || n.property.value || ''}`
  if (n.type === 'CallExpression') return nombreDeLlamada(n.callee)
  return ''
}

// Una cadena de "+" o un template literal, con cada parte variable como {0}, {1}…
const comoPlantilla = (nodo) => {
  const partes = []
  const juntar = (n) => {
    if (n.type === 'BinaryExpression' && n.operator === '+') { juntar(n.left); juntar(n.right); return }
    if (n.type === 'StringLiteral') { partes.push({ texto: n.value }); return }
    if (n.type === 'TemplateLiteral') {
      n.quasis.forEach((q, i) => {
        partes.push({ texto: q.value.cooked })
        if (i < n.expressions.length) partes.push({ variable: true })
      })
      return
    }
    partes.push({ variable: true })
  }
  juntar(nodo)
  let variables = 0
  const texto = partes.map(p => (p.variable ? `{${variables++}}` : p.texto)).join('')
  return { texto, variables, conTexto: partes.some(p => p.texto && conLetras(p.texto)) }
}

const enLugarDeCodigo = (camino) => {
  for (let actual = camino; actual && actual.parentPath; actual = actual.parentPath) {
    const padre = actual.parentPath.node
    if (padre.type === 'ImportDeclaration' || padre.type === 'ExportAllDeclaration') return true
    if (padre.type === 'ExportNamedDeclaration' && actual.key === 'source') return true
    if (padre.type === 'ObjectProperty' && actual.key === 'key') return true
    if (padre.type === 'MemberExpression' && actual.key === 'property') return true
    if (padre.type === 'JSXAttribute') {
      const nombre = padre.name.name
      return ATRIBUTOS_DE_CODIGO.has(nombre) || /^on[A-Z]/.test(nombre) || /^data-/.test(nombre) || /^aria-(?!label)/.test(nombre)
    }
    if (padre.type === 'ObjectProperty' && actual.key === 'value') {
      return PROPIEDADES_DE_CODIGO.has(padre.key.name || padre.key.value)
    }
    if (padre.type === 'CallExpression' && actual.key === 'arguments') {
      return LLAMADAS_DE_CODIGO.test(nombreDeLlamada(padre.callee))
    }
    if (padre.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(padre.operator)) return true
    if (padre.type === 'SwitchCase' && actual.key === 'test') return true
    if (padre.type === 'NewExpression' && nombreDeLlamada(padre.callee) === 'RegExp') return true
    if (padre.type === 'TaggedTemplateExpression') return true
  }
  return false
}

const archivosDe = (carpeta) => fs.readdirSync(carpeta).flatMap((nombre) => {
  const ruta = path.join(carpeta, nombre)
  if (fs.statSync(ruta).isDirectory()) return nombre === 'i18n' ? [] : archivosDe(ruta)
  return /\.jsx?$/.test(nombre) && !/\.test\.js$/.test(nombre) && nombre !== 'setupTests.js' ? [ruta] : []
})

// { texto: [archivos donde aparece] }
const textosDeLaApp = (raiz = path.join(__dirname, '..')) => {
  const textos = new Map()
  const agregar = (s, archivo) => {
    const clave = s.replace(/\s+/g, ' ').trim()
    if (!clave || !conLetras(clave)) return
    if (!textos.has(clave)) textos.set(clave, new Set())
    textos.get(clave).add(archivo)
  }
  const agregarPlantilla = (camino, archivo) => {
    if (enLugarDeCodigo(camino)) return
    const { texto, variables, conTexto } = comoPlantilla(camino.node)
    if (!conTexto) return
    if (variables ? plantillaDeCodigo(texto) : pareceCodigo(texto) === true) return
    agregar(texto, archivo)
  }

  for (const archivo of archivosDe(path.join(raiz, 'src'))) {
    const relativo = path.relative(raiz, archivo)
    const ast = parser.parse(fs.readFileSync(archivo, 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
    traverse(ast, {
      JSXText(camino) {
        const v = camino.node.value
        if (conLetras(v) && pareceCodigo(v) !== true) agregar(v, relativo)
      },
      StringLiteral(camino) {
        if (camino.parentPath.isBinaryExpression({ operator: '+' }) || enLugarDeCodigo(camino)) return
        if (pareceCodigo(camino.node.value) === false) agregar(camino.node.value, relativo)
      },
      TemplateLiteral(camino) {
        if (!camino.parentPath.isBinaryExpression({ operator: '+' })) agregarPlantilla(camino, relativo)
      },
      BinaryExpression(camino) {
        if (camino.node.operator === '+' && !camino.parentPath.isBinaryExpression({ operator: '+' })) agregarPlantilla(camino, relativo)
      },
    })
  }
  return Object.fromEntries([...textos].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v]]))
}

// Los textos de la app que no están ni traducidos en en.json ni anotados como
// iguales en inglés (o como código) en sinTraducir.json.
const textosSinTraducir = (raiz = path.join(__dirname, '..')) => {
  const leer = (archivo) => JSON.parse(fs.readFileSync(path.join(raiz, 'src', 'i18n', archivo), 'utf8'))
  const en = leer('en.json')
  const iguales = new Set(leer('sinTraducir.json'))
  return Object.entries(textosDeLaApp(raiz))
    .filter(([texto]) => !(texto in en) && !iguales.has(texto))
    .map(([texto, archivos]) => ({ texto, archivos }))
}

module.exports = { textosDeLaApp, textosSinTraducir }

if (require.main === module) {
  const faltan = textosSinTraducir()
  if (!faltan.length) {
    console.log('Todos los textos tienen traducción al inglés.')
  } else {
    console.log(`Faltan ${faltan.length} traducciones (agregalas en src/i18n/en.json):\n`)
    for (const { texto, archivos } of faltan) console.log(`  ${JSON.stringify(texto)}  ← ${archivos.join(', ')}`)
    process.exitCode = 1
  }
}
