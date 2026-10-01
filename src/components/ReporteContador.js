import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMonto } from '../lib/formato'
import { resumenFacturacion } from '../lib/facturacion'
import { armarReporteContador, compartirODescargar, nombreArchivoReporte } from '../lib/reporteContador'
import { paleta, semaforo } from '../theme'

const pesos = (n) => `$ ${formatMonto(Math.round(n))}`
const FUENTE = '"Montserrat", sans-serif'

// Antes de mandar el reporte se ve qué va a decir: cuánto se facturó, cuánto no
// y cuántos ingresos todavía no tienen la respuesta.
function ReporteContador({ ingresos, aPesos, periodo, darkMode, onCerrar }) {
  const [estado, setEstado] = useState(null) // null | 'armando' | 'descargado' | 'error'
  const c = paleta(darkMode)
  const sem = semaforo(darkMode)
  const { filas, total } = resumenFacturacion(ingresos, aPesos)
  const sinIndicar = filas.find(f => f.valor === null)
  const nombre = nombreArchivoReporte(periodo)

  const compartir = async () => {
    setEstado('armando')
    try {
      const { data } = await supabase.auth.getUser()
      const libro = armarReporteContador({ ingresos, aPesos, periodo, titular: data?.user?.email })
      const resultado = await compartirODescargar(libro, nombre, {
        titulo: `Ingresos ${periodo}`,
        texto: `Reporte de ingresos de ${periodo} (facturados y sin facturar).`,
      })
      setEstado(resultado === 'descargado' ? 'descargado' : null)
      if (resultado === 'compartido') onCerrar()
    } catch {
      setEstado('error')
    }
  }

  const fila = { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '13px', color: c.text, margin: '6px 0' }
  const boton = { padding: '10px 18px', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 500, fontFamily: FUENTE }

  return (
    <div role="dialog" aria-modal="true" aria-label="Reporte para tu contador/a"
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: c.surface, borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '420px', margin: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.20)', boxSizing: 'border-box', fontFamily: FUENTE }}>
        <h3 style={{ fontSize: '17px', fontWeight: 600, color: c.text, margin: '0 0 4px' }}>🧾 Reporte para tu contador/a</h3>
        <p style={{ fontSize: '13px', color: c.textSecondary, margin: '0 0 14px' }}>
          {periodo} · {total.cantidad} {total.cantidad === 1 ? 'ingreso' : 'ingresos'}
        </p>

        {filas.filter(f => f.cantidad > 0 || f.valor !== null).map(f => (
          <div key={f.etiqueta} style={fila}>
            <span>{f.etiqueta} <span style={{ color: c.textTertiary }}>({f.cantidad})</span></span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pesos(f.pesos)}</span>
          </div>
        ))}
        <div style={{ ...fila, borderTop: `1px solid ${c.border}`, paddingTop: '8px', fontWeight: 700 }}>
          <span>Total</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{pesos(total.pesos)}</span>
        </div>

        {sinIndicar.cantidad > 0 && (
          <p style={{ fontSize: '12px', color: sem.alerta, margin: '10px 0 0' }}>
            {sinIndicar.cantidad === 1 ? 'Hay 1 ingreso' : `Hay ${sinIndicar.cantidad} ingresos`} sin indicar si se facturó. Podés marcarlo abriendo el ingreso en la lista, o mandar el reporte igual: figura como "Sin indicar".
          </p>
        )}
        {total.sinCotizacion > 0 && (
          <p style={{ fontSize: '12px', color: c.textTertiary, margin: '8px 0 0' }}>
            {total.sinCotizacion} en moneda extranjera sin cotización: van en el Excel pero no suman al equivalente en pesos.
          </p>
        )}
        {estado === 'descargado' && (
          <p role="status" style={{ fontSize: '12px', color: sem.positivo, margin: '10px 0 0' }}>
            Se descargó {nombre}. Mandáselo a tu contador/a por WhatsApp o mail.
          </p>
        )}
        {estado === 'error' && (
          <p role="alert" style={{ fontSize: '12px', color: sem.negativo, margin: '10px 0 0' }}>No se pudo armar el Excel. Probá de nuevo.</p>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '18px' }}>
          <button type="button" onClick={onCerrar} style={{ ...boton, border: `2px solid ${c.primary}`, color: c.primary, background: 'transparent' }}>
            {estado === 'descargado' ? 'Listo' : 'Cancelar'}
          </button>
          <button type="button" onClick={compartir} disabled={estado === 'armando' || total.cantidad === 0}
            style={{ ...boton, border: 'none', backgroundColor: c.primary, color: 'white', opacity: estado === 'armando' || total.cantidad === 0 ? 0.6 : 1 }}>
            {estado === 'armando' ? 'Armando…' : 'Compartir Excel'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReporteContador
