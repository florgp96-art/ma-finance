import * as XLSX from 'xlsx'
import { estadoFacturacion, etiquetaFacturacion, resumenFacturacion } from './facturacion'
import { formatFecha } from './formato'

const MONEDAS = ['ARS', 'USD', 'EUR']
const centavos = (n) => Math.round(n * 100) / 100

// Una fila por ingreso, del más viejo al más nuevo. Los montos van como número
// (no como texto) para que la contadora pueda sumar y filtrar en el Excel.
export const filasDeIngresos = (ingresos, aPesos) => [...(ingresos || [])]
  .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')))
  .map(t => {
    const monto = Math.abs(Number(t.monto) || 0)
    const moneda = t.moneda || 'ARS'
    const pesos = aPesos(t)
    const tc = moneda !== 'ARS' && pesos !== null && pesos !== undefined && monto > 0 ? centavos(pesos / monto) : ''
    return [
      formatFecha(String(t.fecha || '').slice(0, 10)),
      t.nombre || t.detalle || '',
      t.accounts?.nombre || '',
      t.tag || t.subcategories?.nombre || t.categories?.nombre || '',
      moneda,
      centavos(monto),
      tc,
      pesos === null || pesos === undefined ? '' : centavos(pesos),
      etiquetaFacturacion(estadoFacturacion(t)),
    ]
  })

// El Excel para el/la contador/a: una hoja de resumen (cuánto se facturó y cuánto
// no) y otra con cada ingreso.
export const armarReporteContador = ({ ingresos, aPesos, periodo, titular, generado = new Date() }) => {
  const { filas, total } = resumenFacturacion(ingresos, aPesos)
  const monedasUsadas = MONEDAS.filter(m => total.porMoneda[m])
  const filaResumen = (f) => [
    f.etiqueta, f.cantidad,
    ...monedasUsadas.map(m => centavos(f.porMoneda[m] || 0)),
    centavos(f.pesos),
  ]
  const resumen = [
    ['Reporte de ingresos'],
    ['Período', periodo],
    ['Titular', titular || ''],
    ['Generado', formatFecha(generado.toISOString().slice(0, 10))],
    [],
    ['Facturación', 'Cantidad', ...monedasUsadas.map(m => `Monto ${m}`), 'Equivalente en $'],
    ...filas.map(filaResumen),
    filaResumen(total),
  ]
  if (total.sinCotizacion > 0) {
    resumen.push([], [`${total.sinCotizacion} ingreso(s) en moneda extranjera sin cotización: no suman al equivalente en $.`])
  }
  const hojaResumen = XLSX.utils.aoa_to_sheet(resumen)
  hojaResumen['!cols'] = [{ wch: 18 }, { wch: 22 }, ...monedasUsadas.map(() => ({ wch: 16 })), { wch: 18 }]

  const hojaIngresos = XLSX.utils.aoa_to_sheet([
    ['Fecha', 'Descripción', 'Cuenta', 'Categoría', 'Moneda', 'Monto', 'Cotización', 'Equivalente en $', 'Facturación'],
    ...filasDeIngresos(ingresos, aPesos),
  ])
  hojaIngresos['!cols'] = [{ wch: 11 }, { wch: 34 }, { wch: 20 }, { wch: 18 }, { wch: 8 }, { wch: 14 }, { wch: 11 }, { wch: 16 }, { wch: 15 }]

  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hojaResumen, 'Resumen')
  XLSX.utils.book_append_sheet(libro, hojaIngresos, 'Ingresos')
  return libro
}

export const nombreArchivoReporte = (periodo) =>
  `ingresos-${String(periodo || 'periodo').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.xlsx`

// En el celular abre el menú de compartir (WhatsApp, mail…) con el archivo; donde
// no se puede compartir archivos, lo descarga. Devuelve 'compartido',
// 'cancelado' o 'descargado'.
export const compartirODescargar = async (libro, nombre, { titulo, texto } = {}) => {
  const datos = XLSX.write(libro, { bookType: 'xlsx', type: 'array' })
  const tipo = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const blob = new Blob([datos], { type: tipo })
  const archivo = typeof File === 'function' ? new File([blob], nombre, { type: tipo }) : null
  if (archivo && typeof navigator !== 'undefined' && navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: titulo, text: texto })
      return 'compartido'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelado'
      // Cualquier otro error de compartir: se descarga igual.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
  return 'descargado'
}
