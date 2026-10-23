import en from './en.json'
import sinTraducir from './sinTraducir.json'

const { textosSinTraducir } = require('../../scripts/textosDeLaApp')

const marcas = (texto) => texto.match(/\{\d+\}/g) || []

describe('traducción al inglés', () => {
  // Si falla: la app tiene textos nuevos en español. Agregá cada uno en en.json
  // con su traducción ("texto en español": "English text"; las partes variables de
  // un template van como {0}, {1}…). Si es código o se escribe igual en inglés
  // (un nombre propio, una marca), va en sinTraducir.json.
  // `node scripts/textosDeLaApp.js` muestra la lista con el archivo de cada uno.
  test('todos los textos de la app tienen traducción', () => {
    const faltan = textosSinTraducir().map(({ texto, archivos }) => `${JSON.stringify(texto)} ← ${archivos.join(', ')}`)
    expect(faltan).toEqual([])
  }, 30000)

  test('cada traducción usa solo las partes variables de su original', () => {
    const malas = Object.entries(en).filter(([es, ingles]) => marcas(ingles).some(m => !marcas(es).includes(m)))
    expect(malas).toEqual([])
  })

  test('sin traducciones vacías ni repetidas en sinTraducir', () => {
    expect(Object.entries(en).filter(([, ingles]) => typeof ingles !== 'string' || !ingles.trim())).toEqual([])
    expect(sinTraducir.filter(texto => texto in en)).toEqual([])
  })
})
