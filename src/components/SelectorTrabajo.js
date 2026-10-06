import React from 'react'
import { parseMonto } from '../lib/formato'
import { porcentajesTrabajo, porcentajesValidos, sumaPorcentajes } from '../lib/repartoSocios'

// Los porcentajes se editan como texto (un campo puede quedar vacío mientras se
// escribe) y se pasan a número recién para validar y guardar.
export const porcentajesComoTexto = (porcentajes) =>
  porcentajes ? Object.fromEntries(Object.entries(porcentajes).map(([s, v]) => [s, String(v)])) : null

export const porcentajesDesdeTexto = (porcentajes) =>
  porcentajes ? Object.fromEntries(Object.entries(porcentajes).map(([s, v]) => [s, parseMonto(v)])) : null

// "¿De quién es el laburo?" (cuentas con reparto entre socios): de la agencia, o de
// un socio con los porcentajes de cada uno, que arrancan en el reparto de siempre
// y se pueden cambiar. Lo usan Cargar movimiento y la edición de un movimiento.
function SelectorTrabajo({ socios, socio, porcentajes, onCambiar, estiloInput, colorSuave, colorError }) {
  const elegir = (nuevo) => onCambiar({
    socio: nuevo,
    porcentajes: nuevo ? porcentajesComoTexto(porcentajesTrabajo(nuevo, socios)) : null,
  })
  const elegidos = porcentajesDesdeTexto(porcentajes)
  const suma = sumaPorcentajes(elegidos, socios)
  const ok = porcentajesValidos(elegidos, socios)

  return (
    <>
      <select style={estiloInput} value={socio || ''} aria-label="De quién es el laburo" onChange={e => elegir(e.target.value)}>
        <option value="">De la agencia (partes iguales)</option>
        {socios.map(s => <option key={s} value={s}>De {s}</option>)}
      </select>
      {socio && porcentajes && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${socios.length}, minmax(0, 1fr))`, gap: '8px', marginTop: '8px' }}>
            {socios.map(s => (
              <label key={s} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: colorSuave }}>
                {s} %
                <input style={estiloInput} type="number" inputMode="decimal" min="0" max="100" step="1"
                  aria-label={`Porcentaje para ${s}`} value={porcentajes[s] ?? ''}
                  onChange={e => onCambiar({ socio, porcentajes: { ...porcentajes, [s]: e.target.value } })} />
              </label>
            ))}
          </div>
          <p style={{ fontSize: '11px', margin: '6px 0 0', color: ok ? colorSuave : colorError }}>
            {ok ? 'Suman 100 % ✓' : `Suman ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(suma)} %: tienen que sumar 100.`}
          </p>
        </>
      )}
    </>
  )
}

export default SelectorTrabajo
