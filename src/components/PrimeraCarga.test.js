import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PrimeraCarga from './PrimeraCarga'

// La Visa ya tiene un resumen; la caja de ahorro, nada.
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (tabla) => ({
      select: () => ({
        in: async () => ({ data: tabla === 'statements' ? [{ account_id: 'v' }] : [] }),
        eq: async () => ({ count: 0 }),
      }),
    }),
  },
}))

const cuentas = [
  { id: 'e', nombre: 'Efectivo', tipo: 'efectivo' },
  { id: 'ca', nombre: 'Caja de Ahorro Galicia', tipo: 'debito' },
  { id: 'v', nombre: 'Visa Galicia', tipo: 'credito' },
]

test('lista las cuentas con resumen para subir y marca las que ya están', async () => {
  const onSubir = jest.fn()
  const onTerminar = jest.fn()
  render(<PrimeraCarga accounts={cuentas} darkMode={false} refreshKey={0} onSubir={onSubir} onTerminar={onTerminar} />)
  expect(await screen.findByText('falta el extracto')).toBeInTheDocument()
  expect(screen.getByText('cargada')).toBeInTheDocument()
  expect(screen.queryByText(/Efectivo/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Subir un resumen'))
  expect(onSubir).toHaveBeenCalled()
  fireEvent.click(screen.getByText('Ya está, lo sigo después'))
  expect(onTerminar).toHaveBeenCalled()
})

test('con todas cargadas, avisa que está listo', async () => {
  render(<PrimeraCarga accounts={[cuentas[2]]} darkMode={false} refreshKey={0} onSubir={() => {}} onTerminar={() => {}} />)
  expect(await screen.findByText('¡Listo! Ya cargaste un resumen de cada cuenta')).toBeInTheDocument()
  expect(screen.queryByText('Subir un resumen')).not.toBeInTheDocument()
})
