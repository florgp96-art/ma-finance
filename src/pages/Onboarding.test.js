import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Onboarding from './Onboarding'

const mockNavigate = jest.fn()
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true })

// Base falsa: registra lo que se inserta y se guarda, y devuelve ids para lo creado.
const mockDb = { inserts: [], upserts: [], id: 0 }
jest.mock('../lib/supabase', () => {
  const consulta = (tabla) => {
    const q = {}
    let resultado = { data: tabla === 'accounts' ? [] : null, error: null }
    for (const m of ['select', 'eq', 'or', 'update']) q[m] = () => q
    q.maybeSingle = () => Promise.resolve({ data: null, error: null })
    q.single = () => Promise.resolve(resultado)
    q.insert = (filas) => {
      mockDb.inserts.push({ tabla, filas })
      const lista = (Array.isArray(filas) ? filas : [filas]).map(f => ({ ...f, id: `${tabla}-${++mockDb.id}` }))
      resultado = { data: Array.isArray(filas) ? lista : lista[0], error: null }
      return q
    }
    q.upsert = (fila) => { mockDb.upserts.push({ tabla, fila }); return Promise.resolve({ error: null }) }
    q.then = (res, rej) => Promise.resolve(resultado).then(res, rej)
    return q
  }
  return { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: consulta } }
})

beforeEach(() => {
  mockDb.inserts.length = 0
  mockDb.upserts.length = 0
  mockDb.id = 0
  mockNavigate.mockReset()
})

const tocar = (nombre, indice = 0) => fireEvent.click(screen.getAllByRole('button', { name: nombre })[indice])
const insertsDe = (tabla) => mockDb.inserts.filter(i => i.tabla === tabla).flatMap(i => [].concat(i.filas))

test('avisa para qué son las respuestas antes de preguntar', () => {
  render(<Onboarding />)
  expect(screen.getByText(/no se comparten con terceros y no se usan para publicidad/)).toBeInTheDocument()
  expect(screen.queryByText('¿Cobrás o pagás cuota alimentaria?')).not.toBeInTheDocument()
})

test('guarda las respuestas y deja creadas las cuentas, la categoría de mascotas y los hijos', async () => {
  render(<Onboarding />)
  tocar('Sí', 0) // hijos
  fireEvent.change(screen.getByPlaceholderText('Nombre del hijo 1'), { target: { value: 'Amelia' } })
  expect(screen.getByText('¿Cobrás o pagás cuota alimentaria?')).toBeInTheDocument()
  tocar('No', 1) // cuota alimentaria
  tocar('Sí', 2) // mascotas
  tocar('No', 3) // auto
  tocar('Galicia')
  tocar('Mercado Pago')
  tocar('Visa')
  fireEvent.click(screen.getByRole('button', { name: 'Comenzar →' }))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'))

  expect(insertsDe('children')).toEqual([{ user_id: 'u1', nombre: 'Amelia' }])
  const prefs = Object.fromEntries(mockDb.upserts.filter(u => u.tabla === 'user_rules')
    .map(u => [u.fila.texto_original, JSON.parse(u.fila.nombre_asignado)]))
  expect(prefs).toEqual({ __pref__modo: 'mom', __pref__primera_carga_pendiente: true, __pref__cuota_alimentaria_activa: false, __pref__tiene_auto: false, __pref__tiene_mascotas: true })

  expect(insertsDe('categories')).toEqual([expect.objectContaining({ user_id: 'u1', nombre: 'Mascotas', tipo: 'gasto' })])
  expect(insertsDe('subcategories').map(s => s.nombre)).toEqual(['Veterinaria', 'Alimento', 'Peluquería', 'Accesorios'])

  const cuentas = insertsDe('accounts')
  expect(cuentas.map(a => [a.nombre, a.tipo])).toEqual([
    ['Efectivo', 'efectivo'], ['Ingresos', 'ingreso'],
    ['Caja de Ahorro Galicia', 'debito'], ['Mercado Pago', 'debito'],
    ['Visa Galicia', 'credito'],
  ])
  // Con dos cuentas de plata no se sabe de cuál se paga la tarjeta: lo elige después.
  expect(cuentas.find(a => a.nombre === 'Visa Galicia').cuenta_pago_id).toBeUndefined()
})

test('con una sola cuenta de banco, la tarjeta ya queda pagándose desde ahí', async () => {
  render(<Onboarding />)
  tocar('Santander')
  tocar('Mastercard')
  fireEvent.click(screen.getByRole('button', { name: 'Comenzar →' }))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
  const cuentas = insertsDe('accounts')
  const caja = mockDb.inserts.find(i => i.tabla === 'accounts' && [].concat(i.filas).some(f => f.nombre === 'Caja de Ahorro Santander'))
  expect(caja).toBeTruthy()
  expect(cuentas.find(a => a.nombre === 'Mastercard Santander').cuenta_pago_id).toMatch(/^accounts-/)
  // Sin contestar auto ni mascotas no se guarda nada de eso: solo el modo, que siempre
  // tiene uno elegido, y la marca de la primera carga guiada.
  expect(mockDb.upserts.filter(u => u.tabla === 'user_rules').map(u => u.fila.texto_original)).toEqual(['__pref__modo', '__pref__primera_carga_pendiente'])
})

test("elegir Dad's Assist cambia la app en el momento y queda guardado", async () => {
  render(<Onboarding />)
  fireEvent.click(screen.getByRole('button', { name: /Dad's Assist/ }))
  expect(document.documentElement.dataset.modo).toBe('dad')
  expect(document.title).toBe("Dad's Assist Finance")
  fireEvent.click(screen.getByRole('button', { name: 'Comenzar →' }))
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
  const modo = mockDb.upserts.find(u => u.fila.texto_original === '__pref__modo')
  expect(JSON.parse(modo.fila.nombre_asignado)).toBe('dad')
  // Para la próxima: que el login ya salga como Dad's Assist.
  expect(localStorage.getItem('modo_ma')).toBe('dad')
  localStorage.removeItem('modo_ma')
  document.documentElement.dataset.modo = 'mom'
})
