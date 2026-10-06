import React, { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SelectorTrabajo, { porcentajesComoTexto, porcentajesDesdeTexto } from './SelectorTrabajo'
import { porcentajesTrabajo } from '../lib/repartoSocios'

const socios = ['Flor', 'Valen', 'Dol']

function Prueba({ inicial = { socio: '', porcentajes: null }, onCambio = () => {} }) {
  const [valor, setValor] = useState(inicial)
  return (
    <SelectorTrabajo socios={socios} socio={valor.socio} porcentajes={valor.porcentajes}
      onCambiar={v => { setValor(v); onCambio(v) }} estiloInput={{}} colorSuave="gray" colorError="red" />
  )
}

test('al elegir un socio arranca con el reparto de siempre y se puede cambiar', () => {
  const onCambio = jest.fn()
  render(<Prueba onCambio={onCambio} />)
  expect(screen.queryByLabelText('Porcentaje para Flor')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('De quién es el laburo'), { target: { value: 'Flor' } })
  expect(onCambio).toHaveBeenLastCalledWith({ socio: 'Flor', porcentajes: porcentajesComoTexto(porcentajesTrabajo('Flor', socios)) })
  expect(screen.getByText('Suman 100 % ✓')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Porcentaje para Dol'), { target: { value: '0' } })
  expect(screen.getByText(/tienen que sumar 100/)).toBeInTheDocument()
})

test('editando un movimiento ya marcado, muestra sus porcentajes; "De la agencia" lo desmarca', () => {
  const onCambio = jest.fn()
  render(<Prueba inicial={{ socio: 'Valen', porcentajes: porcentajesComoTexto({ Flor: 20, Valen: 60, Dol: 20 }) }} onCambio={onCambio} />)
  expect(screen.getByLabelText('Porcentaje para Valen')).toHaveValue(60)
  fireEvent.change(screen.getByLabelText('De quién es el laburo'), { target: { value: '' } })
  expect(onCambio).toHaveBeenLastCalledWith({ socio: '', porcentajes: null })
  expect(screen.queryByLabelText('Porcentaje para Valen')).not.toBeInTheDocument()
})

test('de texto a número, con coma o vacío', () => {
  expect(porcentajesDesdeTexto({ Flor: '70', Valen: '22,5', Dol: '' })).toEqual({ Flor: 70, Valen: 22.5, Dol: null })
  expect(porcentajesDesdeTexto(null)).toBe(null)
})
