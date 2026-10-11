// La memoria del mail de auditoría de los viernes (api/_lib/hallazgosAuditoria.js).
// Vive en src/ porque los tests corren solo desde acá.
import { CLAVE_INICIO, claveDeHallazgo, compararConAvisados, agruparPorUsuario } from '../../api/_lib/hallazgosAuditoria'

const h = (userId, texto) => ({ userId, texto })
const claves = (...lista) => [CLAVE_INICIO, ...lista.map(x => claveDeHallazgo(x.userId, x.texto))]

test('la primera vez no manda la lista: anota todo y avisa que desde ahora es solo lo nuevo', () => {
  const r = compararConAvisados([h('u1', 'a'), h('u1', 'b'), h('u2', 'a')], [])
  expect(r.primeraVez).toBe(true)
  expect(r.nuevos).toEqual([])
  expect(r.siguen).toBe(3)
  expect(r.vigentes).toHaveLength(3)
})

test('lo que ya se avisó no se repite; lo nuevo sí', () => {
  const r = compararConAvisados([h('u1', 'a'), h('u1', 'c')], claves(h('u1', 'a')))
  expect(r.primeraVez).toBe(false)
  expect(r.nuevos.map(x => x.texto)).toEqual(['c'])
  expect(r.siguen).toBe(1)
})

test('lo que se resolvió sale de la memoria, y si vuelve a pasar es nuevo', () => {
  const r = compararConAvisados([h('u1', 'c')], claves(h('u1', 'a'), h('u1', 'c')))
  expect(r.resueltas).toEqual([claveDeHallazgo('u1', 'a')])
  expect(r.nuevos).toEqual([])
  const otraVez = compararConAvisados([h('u1', 'a'), h('u1', 'c')], claves(h('u1', 'c')))
  expect(otraVez.nuevos.map(x => x.texto)).toEqual(['a'])
})

test('sin hallazgos y sin nada nuevo no hay nada que mandar', () => {
  const r = compararConAvisados([], [CLAVE_INICIO])
  expect(r).toMatchObject({ primeraVez: false, nuevos: [], siguen: 0, resueltas: [] })
})

test('el mismo texto en dos usuarios son dos hallazgos; repetido en el mismo, uno', () => {
  expect(claveDeHallazgo('u1', 'a')).not.toBe(claveDeHallazgo('u2', 'a'))
  const r = compararConAvisados([h('u1', 'a'), h('u1', 'a')], [CLAVE_INICIO])
  expect(r.nuevos).toHaveLength(1)
})

test('agruparPorUsuario', () => {
  expect(agruparPorUsuario([h('u1', 'a'), h('u2', 'b'), h('u1', 'c')])).toEqual([
    { userId: 'u1', hallazgos: ['a', 'c'] },
    { userId: 'u2', hallazgos: ['b'] },
  ])
})
