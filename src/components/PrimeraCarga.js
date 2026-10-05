import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { paleta, semaforo } from '../theme'
import { cuentasACargar, estadoPrimeraCarga } from '../lib/primeraCarga'

// Primera carga guiada (ver lib/primeraCarga.js): arriba del contenido, hasta que la
// persona la cierra. Solo la ven quienes pasaron por el alta nueva (la preferencia
// primera_carga_pendiente la deja el alta).
export default function PrimeraCarga({ accounts, darkMode, refreshKey, onSubir, onTerminar }) {
  const c = paleta(darkMode)
  const sem = semaforo(darkMode)
  const [idsConDatos, setIdsConDatos] = useState(null)

  const ids = useMemo(() => cuentasACargar(accounts).map(a => a.id), [accounts])
  const idsKey = ids.join(',')

  useEffect(() => {
    let cancelado = false
    const cargar = async () => {
      if (ids.length === 0) { setIdsConDatos(new Set()); return }
      // Un conteo por cuenta: con un solo pedido limitado, una cuenta con muchos
      // movimientos podía tapar a las demás.
      const [{ data: resumenes }, conteos] = await Promise.all([
        supabase.from('statements').select('account_id').in('account_id', ids),
        Promise.all(ids.map(id => supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('account_id', id))),
      ])
      if (cancelado) return
      const conDatos = new Set((resumenes || []).map(r => r.account_id))
      conteos.forEach((r, i) => { if ((r?.count || 0) > 0) conDatos.add(ids[i]) })
      setIdsConDatos(conDatos)
    }
    cargar().catch(() => { if (!cancelado) setIdsConDatos(new Set()) })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, refreshKey])

  const estado = estadoPrimeraCarga(accounts, idsConDatos || new Set())
  const boton = { padding: '9px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }

  return (
    <div style={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: '16px', padding: '16px 18px', marginBottom: '16px', color: c.text }}>
      <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>
        {estado.completa ? '¡Listo! Ya cargaste un resumen de cada cuenta' : 'Primeros pasos: subí un resumen de cada cuenta'}
      </p>
      <p style={{ margin: '0 0 12px', fontSize: '13px', color: c.textSecondary, lineHeight: 1.45 }}>
        {estado.completa
          ? 'Desde ahora, cada mes alcanza con subir el resumen nuevo de cada tarjeta y cuenta.'
          : 'Subí el último resumen de cada tarjeta y el último extracto de cada cuenta (PDF, Excel o captura). La app controla que lo leído cierre con el total y, si algo no cierra, lo revisa sola. Si tenés una cuenta que no está en la lista, subí su resumen y la app la crea.'}
      </p>
      {estado.total > 0 && idsConDatos && (
        <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {estado.cuentas.map(cuenta => (
            <li key={cuenta.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
              <span aria-hidden="true" style={{ color: cuenta.cargada ? sem.positivo : c.textTertiary, fontWeight: 700, width: '16px', textAlign: 'center' }}>{cuenta.cargada ? '✓' : '○'}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cuenta.tipo === 'credito' ? '💳' : '🏦'} {cuenta.nombre}</span>
              <span style={{ color: cuenta.cargada ? sem.positivo : c.textTertiary, fontSize: '12px', whiteSpace: 'nowrap' }}>
                {cuenta.cargada ? 'cargada' : cuenta.tipo === 'credito' ? 'falta el resumen' : 'falta el extracto'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {!estado.completa && (
          <button type="button" onClick={onSubir} style={{ ...boton, border: 'none', background: c.primary, color: darkMode ? '#1C1A1C' : '#FFFFFF' }}>
            Subir un resumen
          </button>
        )}
        <button type="button" onClick={onTerminar} style={{ ...boton, border: `1px solid ${c.border}`, background: 'transparent', color: c.textSecondary }}>
          {estado.completa ? 'Cerrar' : 'Ya está, lo sigo después'}
        </button>
      </div>
    </div>
  )
}
