import { cuentasACargar, estadoPrimeraCarga } from './primeraCarga'

const cuentas = [
  { id: 'e', nombre: 'Efectivo', tipo: 'efectivo' },
  { id: 'i', nombre: 'Ingresos', tipo: 'ingreso' },
  { id: 'ca', nombre: 'Caja de Ahorro Galicia', tipo: 'debito' },
  { id: 'v', nombre: 'Visa Galicia', tipo: 'credito' },
]

test('efectivo e ingresos no tienen resumen que subir', () => {
  expect(cuentasACargar(cuentas).map(c => c.id)).toEqual(['ca', 'v'])
})

test('marca cuáles ya tienen algo cargado y cuántas faltan', () => {
  const estado = estadoPrimeraCarga(cuentas, new Set(['v']))
  expect(estado.cuentas).toEqual([
    { id: 'ca', nombre: 'Caja de Ahorro Galicia', tipo: 'debito', cargada: false },
    { id: 'v', nombre: 'Visa Galicia', tipo: 'credito', cargada: true },
  ])
  expect(estado).toMatchObject({ cargadas: 1, total: 2, completa: false })
})

test('completa solo cuando todas tienen algo cargado', () => {
  expect(estadoPrimeraCarga(cuentas, ['ca', 'v']).completa).toBe(true)
  expect(estadoPrimeraCarga([], []).completa).toBe(false)
})
