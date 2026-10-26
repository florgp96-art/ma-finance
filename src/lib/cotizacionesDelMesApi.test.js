// Cotizaciones que guarda el cron diario (api/_lib/cotizacionesDelMes.js).
import { guardarCotizacionesDelMes, mesArgentino } from '../../api/_lib/cotizacionesDelMes.js'

const respuesta = (cuerpo, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(cuerpo) })

const dolarapi = ({ dolares = true, euro = true } = {}) => (url) => {
  if (url.endsWith('/dolares')) {
    return dolares
      ? respuesta([
        { casa: 'oficial', compra: 1450, venta: 1500 }, { casa: 'blue', compra: 1570, venta: 1590 },
        { casa: 'bolsa', compra: 1555, venta: 1565 }, { casa: 'tarjeta', compra: 1885, venta: 1950 },
        { casa: 'cripto', compra: 1600, venta: 1620 },
      ])
      : respuesta(null, false)
  }
  return euro ? respuesta({ moneda: 'EUR', compra: 1640, venta: 1774 }) : Promise.reject(new Error('sin red'))
}

const baseFalsa = (error = null) => {
  const guardado = []
  return {
    guardado,
    from: (tabla) => ({
      upsert: (filas, opciones) => { guardado.push({ tabla, filas, opciones }); return Promise.resolve({ error }) },
    }),
  }
}

const AHORA = new Date('2026-10-26T03:00:00Z')

test('guarda cada dólar, el euro oficial y el euro de cada tipo de dólar, del mes en Argentina', async () => {
  const base = baseFalsa()
  const r = await guardarCotizacionesDelMes(base, { fetch: dolarapi(), ahora: AHORA })
  expect(r).toEqual({ guardadas: 8 })
  expect(base.guardado).toHaveLength(1)
  expect(base.guardado[0].tabla).toBe('exchange_rates')
  expect(base.guardado[0].opciones).toEqual({ onConflict: 'periodo,tipo' })
  expect(base.guardado[0].filas).toEqual([
    { periodo: '2026-10', tipo: 'blue', valor: 1580 },
    { periodo: '2026-10', tipo: 'mep', valor: 1560 },
    { periodo: '2026-10', tipo: 'oficial', valor: 1475 },
    { periodo: '2026-10', tipo: 'tarjeta', valor: 1918 },
    { periodo: '2026-10', tipo: 'euro_blue', valor: 1829 },
    { periodo: '2026-10', tipo: 'euro_mep', valor: 1805 },
    { periodo: '2026-10', tipo: 'euro', valor: 1707 },
    { periodo: '2026-10', tipo: 'euro_tarjeta', valor: 2220 },
  ])
})

test('sin el euro guarda los dólares; sin nada, no escribe', async () => {
  const soloDolares = baseFalsa()
  await guardarCotizacionesDelMes(soloDolares, { fetch: dolarapi({ euro: false }), ahora: AHORA })
  expect(soloDolares.guardado[0].filas.map(f => f.tipo)).toEqual(['blue', 'mep', 'oficial', 'tarjeta'])

  const nada = baseFalsa()
  expect(await guardarCotizacionesDelMes(nada, { fetch: dolarapi({ dolares: false, euro: false }), ahora: AHORA })).toEqual({ guardadas: 0 })
  expect(nada.guardado).toHaveLength(0)
})

test('si la base rechaza el guardado lo devuelve como error', async () => {
  const r = await guardarCotizacionesDelMes(baseFalsa({ message: 'rls' }), { fetch: dolarapi(), ahora: AHORA })
  expect(r).toEqual({ guardadas: 0, error: 'rls' })
})

test('el mes es el de Argentina: a las 2 UTC del 1° allá todavía es el mes anterior', () => {
  expect(mesArgentino(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10')
  expect(mesArgentino(new Date('2026-11-01T03:00:00Z'))).toBe('2026-11')
})
