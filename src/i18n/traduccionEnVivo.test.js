import React, { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { activarTraduccion, desactivarTraduccion, traduccionActiva } from './traduccionEnVivo'

const DICCIONARIO = {
  'Cuentas': 'Accounts',
  'Guardar': 'Save',
  'Guardando...': 'Saving...',
  'Buscar…': 'Search…',
  'Tenés': 'You have',
  'cuotas pendientes': 'pending installments',
  'Mostrar más': 'Show more',
  '¿Eliminar este gasto?': 'Delete this expense?',
  'Luz': 'Electricity',
}

// El MutationObserver avisa en una microtarea: hay que dejarlo correr.
const esperarObservador = () => act(() => new Promise(r => setTimeout(r, 0)))

function Pantalla() {
  const [guardando, setGuardando] = useState(false)
  const [cuotas, setCuotas] = useState(3)
  const [mas, setMas] = useState(false)
  return (
    <div>
      <h2>Cuentas</h2>
      <p data-testid="cuotas">Tenés {cuotas} cuotas pendientes</p>
      <button onClick={() => { setGuardando(true); setCuotas(4) }}>{guardando ? 'Guardando...' : 'Guardar'}</button>
      <input placeholder="Buscar…" defaultValue="Guardar" />
      <textarea defaultValue="Guardar" />
      <span translate="no" data-testid="nombre">Luz</span>
      <button onClick={() => setMas(true)}>Mostrar más</button>
      {mas && <p>Guardar</p>}
    </div>
  )
}

afterEach(() => {
  desactivarTraduccion()
})

describe('traducción en vivo', () => {
  test('traduce lo que ya está en la página y lo que React cambia después', async () => {
    render(<Pantalla />)
    activarTraduccion(DICCIONARIO)
    expect(traduccionActiva()).toBe(true)

    expect(screen.getByRole('heading').textContent).toBe('Accounts')
    expect(screen.getByTestId('cuotas').textContent).toBe('You have 3 pending installments')
    expect(screen.getByPlaceholderText('Search…')).toBeTruthy()

    fireEvent.click(screen.getByText('Save'))
    await esperarObservador()
    expect(screen.getByText('Saving...')).toBeTruthy()
    expect(screen.getByTestId('cuotas').textContent).toBe('You have 4 pending installments')

    fireEvent.click(screen.getByText('Show more'))
    await esperarObservador()
    expect(screen.getAllByText('Save').length).toBe(1)
  })

  test('no toca lo que se escribe ni lo marcado con translate="no"', () => {
    render(<Pantalla />)
    activarTraduccion(DICCIONARIO)
    expect(document.querySelector('input').value).toBe('Guardar')
    expect(document.querySelector('textarea').value).toBe('Guardar')
    expect(screen.getByTestId('nombre').textContent).toBe('Luz')
  })

  test('al volver al español deja todo como lo dibujó React', async () => {
    render(<Pantalla />)
    activarTraduccion(DICCIONARIO)
    fireEvent.click(screen.getByText('Save'))
    await esperarObservador()
    desactivarTraduccion()

    expect(traduccionActiva()).toBe(false)
    expect(screen.getByRole('heading').textContent).toBe('Cuentas')
    expect(screen.getByText('Guardando...')).toBeTruthy()
    expect(screen.getByTestId('cuotas').textContent).toBe('Tenés 4 cuotas pendientes')
    expect(screen.getByPlaceholderText('Buscar…')).toBeTruthy()
  })

  test('traduce los mensajes de confirm y alert', () => {
    const original = window.confirm
    const visto = []
    window.confirm = (m) => { visto.push(m); return true }
    try {
      activarTraduccion(DICCIONARIO)
      expect(window.confirm('¿Eliminar este gasto?')).toBe(true)
      expect(window.confirm('Otro mensaje')).toBe(true)
      desactivarTraduccion()
      window.confirm('¿Eliminar este gasto?')
      expect(visto).toEqual(['Delete this expense?', 'Otro mensaje', '¿Eliminar este gasto?'])
    } finally {
      window.confirm = original
    }
  })
})
