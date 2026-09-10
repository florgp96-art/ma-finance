const { aplicarReglasYAlias, yaIdentificado } = require('./reglas')

// El caso que se repetía en cada resumen: "STB KM 43" es el Starbucks del
// usuario. Lo aclaró una vez, quedó como regla aprendida, y en la carga
// siguiente la app se lo volvía a preguntar porque la regla devolvía solo la
// categoría — el nombre seguía siendo la sigla del banco y el movimiento
// entraba como "a_identificar".
describe('regla aprendida — lo que el usuario ya aclaró no se vuelve a preguntar', () => {
  const reglaStarbucks = {
    texto_original: 'STB KM 43',
    nombre_asignado: 'Starbucks',
    categoria: 'Salidas',
    subcategoria: 'Café',
  }
  const movimiento = { nombre_original: 'STB KM 43', nombre_limpio: 'STB KM 43', monto: 38902, tipo: 'gasto' }

  test('devuelve el nombre que puso el usuario, no la sigla del banco', () => {
    const [t] = aplicarReglasYAlias([movimiento], [reglaStarbucks], [])
    expect(t.nombre_limpio).toBe('Starbucks')
    expect(t.categoria_sugerida).toBe('Salidas')
    expect(t.subcategoria_sugerida).toBe('Café')
  })

  test('queda identificado, así no vuelve al paso de identificar', () => {
    const [t] = aplicarReglasYAlias([movimiento], [reglaStarbucks], [])
    expect(yaIdentificado(t)).toBe(true)
  })

  test('sirve igual si el usuario dejó el nombre tal cual lo trae el banco', () => {
    const reglaSinRenombrar = { ...reglaStarbucks, nombre_asignado: 'STB KM 43' }
    const [t] = aplicarReglasYAlias([movimiento], [reglaSinRenombrar], [])
    expect(t.nombre_limpio).toBe('STB KM 43')
    // El nombre quedó igual al del banco, pero la categoría la eligió el
    // usuario: ya está contestado.
    expect(yaIdentificado(t)).toBe(true)
  })

  test('un comercio sin regla ni alias sí se pregunta', () => {
    const [t] = aplicarReglasYAlias(
      [{ nombre_original: 'MERPAGO*HEHAIJIN', nombre_limpio: 'MERPAGO*HEHAIJIN', monto: 6505, tipo: 'gasto' }],
      [reglaStarbucks],
      [],
    )
    expect(t.regla_usuario).toBeUndefined()
    expect(yaIdentificado(t)).toBe(false)
  })

  test('la regla matchea aunque el banco pegue una referencia al final', () => {
    const [t] = aplicarReglasYAlias(
      [{ nombre_original: 'STB KM 43 00800', nombre_limpio: 'STB KM 43 00800', monto: 38902, tipo: 'gasto' }],
      [reglaStarbucks],
      [],
    )
    expect(t.nombre_limpio).toBe('Starbucks')
    expect(yaIdentificado(t)).toBe(true)
  })
})

// Los alias son la otra mitad: matchean por contenido, así cubren un comercio
// cuya descripción cambia de mes a mes ("STB KM 43", "STB KM 52").
describe('alias de categoría — también cuentan como ya contestado', () => {
  const aliasStb = { tipo: 'categoria', alias: 'STB KM', valor: 'Salidas > Café' }

  test('aplica la categoría y no vuelve a preguntar', () => {
    const [t] = aplicarReglasYAlias(
      [{ nombre_original: 'STB KM 52', nombre_limpio: 'STB KM 52', monto: 12000, tipo: 'gasto' }],
      [],
      [aliasStb],
    )
    expect(t.categoria_sugerida).toBe('Salidas')
    expect(t.subcategoria_sugerida).toBe('Café')
    expect(yaIdentificado(t)).toBe(true)
  })
})

describe('yaIdentificado', () => {
  test('un pago de tarjeta (neutro) nunca se pregunta', () => {
    expect(yaIdentificado({ tipo: 'neutro', nombre_original: 'SU PAGO', nombre_limpio: 'SU PAGO' })).toBe(true)
  })

  test('alcanza con que la IA le haya puesto un nombre legible', () => {
    expect(yaIdentificado({ tipo: 'gasto', nombre_original: 'YPF AUSOL ESTE', nombre_limpio: 'YPF' })).toBe(true)
  })
})
