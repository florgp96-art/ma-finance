import { createClient } from '@supabase/supabase-js'
import { secretsMatch } from './_lib/secretsMatch.js'

// Auditoría interna, invisible para los usuarios: no escribe nada, solo lee
// transacciones de TODAS las cuentas y le manda a NOTIFY_EMAIL un resumen de
// cosas que "no pueden ser" — para detectar bugs de importación/clasificación
// antes de que el cliente los note. Corre por Vercel Cron (ver vercel.json),
// protegido con el mismo CRON_SECRET que cron-reclasificar.

function mesDe(fecha) {
  return (fecha || '').slice(0, 7) // "YYYY-MM"
}

function mesSiguiente(mes) {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(y, m, 1) // m ya es "mes siguiente" en base 0
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Transacciones repetidas: misma cuenta, fecha y monto — no exigimos que el
// detalle coincida porque el caso típico es cargar algo a mano y después
// importar el resumen que trae el mismo movimiento con otra descripción (o
// viceversa). Si además el detalle coincide, es más probable que sea el
// mismo extracto cargado dos veces; si uno es manual y el otro importado, es
// más probable que sea el caso de carga manual + resumen.
function detectarDuplicados(txs) {
  const grupos = new Map()
  for (const t of txs) {
    if (t.monto == null || !t.fecha) continue
    const key = `${t.account_id}|${t.fecha}|${t.monto}|${t.moneda || ''}`
    if (!grupos.has(key)) grupos.set(key, [])
    grupos.get(key).push(t)
  }
  const hallazgos = []
  for (const [, grupo] of grupos) {
    if (grupo.length <= 1) continue
    const t = grupo[0]
    const mismoDetalle = grupo.every(g => (g.detalle || '').trim().toUpperCase() === (t.detalle || '').trim().toUpperCase())
    const mezclaManualEImportado = grupo.some(g => g.es_manual) && grupo.some(g => !g.es_manual)
    const motivo = mismoDetalle
      ? 'mismo detalle'
      : mezclaManualEImportado
        ? 'una carga manual y otra importada, detalle distinto'
        : 'detalle distinto'
    hallazgos.push(`Posible duplicado (${grupo.length}x, ${motivo}): ${t.monto} ${t.moneda} el ${t.fecha}${grupo.map(g => ` · "${g.detalle || '(sin detalle)'}"`).join('')}`)
  }
  return hallazgos
}

// El total de cuotas de un mes no puede subir respecto al mes anterior salvo
// que ese mes hayan arrancado compras nuevas (cuota_numero === 1) que
// justifiquen el aumento — las cuotas viejas solo pueden ir bajando a medida
// que se terminan de pagar.
function detectarCuotasInconsistentes(txs) {
  const cuotas = txs.filter(t => (t.cuotas_total || 1) > 1 && t.tipo === 'gasto' && t.fecha)
  const porCuenta = new Map()
  for (const t of cuotas) {
    if (!porCuenta.has(t.account_id)) porCuenta.set(t.account_id, [])
    porCuenta.get(t.account_id).push(t)
  }

  const hallazgos = []
  for (const [accountId, rows] of porCuenta) {
    // Por moneda: sumar ARS+USD en un mismo total generaba falsos positivos (un
    // cargo nuevo en una moneda distinta a la que venía la cuota) y podía
    // enmascarar una inconsistencia real de una moneda con el cambio de la otra.
    const monedas = [...new Set(rows.map(t => t.moneda || 'ARS'))]
    for (const moneda of monedas) {
      const rowsMoneda = rows.filter(t => (t.moneda || 'ARS') === moneda)
      const totalPorMes = new Map()
      const nuevasPorMes = new Map()
      for (const t of rowsMoneda) {
        const mes = mesDe(t.fecha)
        totalPorMes.set(mes, (totalPorMes.get(mes) || 0) + Math.abs(Number(t.monto) || 0))
        if ((t.cuota_numero || 1) === 1) nuevasPorMes.set(mes, (nuevasPorMes.get(mes) || 0) + 1)
      }
      const meses = [...totalPorMes.keys()].sort()
      for (let i = 1; i < meses.length; i++) {
        const mesAnterior = meses[i - 1]
        const mesActual = meses[i]
        if (mesSiguiente(mesAnterior) !== mesActual) continue // hay hueco de meses sin datos, no comparable
        const totalAnterior = totalPorMes.get(mesAnterior)
        const totalActual = totalPorMes.get(mesActual)
        const hayNuevasEsteMonto = nuevasPorMes.get(mesActual) || 0
        if (totalActual > totalAnterior + 1 && hayNuevasEsteMonto === 0) {
          const cuenta = rowsMoneda.find(r => r.account_id === accountId)
          hallazgos.push(
            `Cuenta "${cuenta?.accounts?.nombre || accountId}": cuotas en ${moneda} subieron de ${totalAnterior.toFixed(0)} (${mesAnterior}) a ${totalActual.toFixed(0)} (${mesActual}) sin compras nuevas ese mes`
          )
        }
      }
    }
  }
  return hallazgos
}

// Chequeos de coherencia interna de una fila. A diferencia de los dos de arriba
// (que buscan datos imposibles), estos buscan estados que la app no debería poder
// generar: si aparecen, hay un bug de importación, de generación de cuotas o de
// edición. Nacieron de una auditoría a mano donde salieron siete problemas y esta
// auditoría automática no habría detectado ninguno, porque todos eran
// contradicciones internas y no montos repetidos.
function detectarFilasIncoherentes(txs, hoyISO) {
  const hallazgos = []
  const resumen = (t) => `"${t.detalle || t.nombre || '(sin nombre)'}" del ${t.fecha}`

  for (const t of txs) {
    const total = t.cuotas_total || 1
    const nro = t.cuota_numero || 1

    // "Cuota 5 de 3" no existe. Sale de una edición a mano sin validar o de una
    // lectura mal parseada del resumen.
    if (total > 1 && nro > total) {
      hallazgos.push(`Cuota imposible (${nro} de ${total}): ${resumen(t)}`)
    }
    // Un plan de una sola cuota con número distinto de 1 es lo mismo al revés.
    if (total === 1 && nro !== 1) {
      hallazgos.push(`Sin cuotas pero con número de cuota ${nro}: ${resumen(t)}`)
    }
    // Un movimiento en moneda extranjera sin TC congelado se convierte a cero en
    // silencio en cualquier vista que no tenga el TC del mes: desaparece del total
    // sin avisar, que es peor que mostrarlo mal.
    if ((t.moneda === 'USD' || t.moneda === 'EUR') && !t.fx_rate) {
      hallazgos.push(`En ${t.moneda} sin tipo de cambio guardado (puede sumar 0): ${resumen(t)}`)
    }
    // Las partes de un reparto tienen que caber en el monto de la fila. Si suman
    // más, alguna vista va a mostrar más plata de la que se gastó.
    const partes = t.reparto?.participantes
    if (Array.isArray(partes) && partes.length > 0) {
      const suma = partes.reduce((acc, p) => acc + Math.abs(Number(p.monto) || 0), 0)
      const monto = Math.abs(Number(t.monto) || 0)
      if (suma > monto + 1) {
        hallazgos.push(`Reparto que suma más que el gasto (${suma.toFixed(0)} de ${monto.toFixed(0)}): ${resumen(t)}`)
      }
    }
    // Fecha muy adelante: las cuotas futuras que genera la app son legítimas, pero
    // un gasto suelto con fecha del año que viene es un error de lectura del
    // resumen (año mal parseado) y ensucia todos los totales futuros.
    if (t.fecha && t.fecha > hoyISO && total === 1) {
      hallazgos.push(`Gasto suelto con fecha futura: ${resumen(t)}`)
    }
  }
  return hallazgos
}

// Dos filas para el MISMO número de cuota de la misma compra: es el duplicado que
// el chequeo de arriba no ve, porque las dos copias suelen tener fechas distintas
// (una con la fecha del resumen que la facturó y otra derivada de la compra).
function detectarCuotaRepetida(txs) {
  const porCompra = new Map()
  for (const t of txs) {
    if (t.tipo !== 'gasto' || (t.cuotas_total || 1) <= 1 || !t.fecha) continue
    // Misma cuenta + mismo plan + mismo monto al peso: la clave que usa la app para
    // reconstruir una compra (ver src/lib/cuotas.js).
    const key = `${t.account_id}|${t.cuotas_total}|${Math.round(Math.abs(Number(t.monto) || 0))}|${t.moneda || 'ARS'}`
    if (!porCompra.has(key)) porCompra.set(key, [])
    porCompra.get(key).push(t)
  }
  const hallazgos = []
  for (const [, filas] of porCompra) {
    const porNumero = new Map()
    for (const t of filas) {
      const nro = t.cuota_numero || 1
      if (!porNumero.has(nro)) porNumero.set(nro, [])
      porNumero.get(nro).push(t)
    }
    for (const [nro, repetidas] of porNumero) {
      if (repetidas.length <= 1) continue
      const t = repetidas[0]
      hallazgos.push(
        `Cuota ${nro}/${t.cuotas_total} cargada ${repetidas.length} veces (${Math.abs(Number(t.monto) || 0).toFixed(0)} ${t.moneda || 'ARS'}): ${repetidas.map(r => r.fecha).join(' y ')}`
      )
    }
  }
  return hallazgos
}

export default async function handler(req, res) {
  if (!secretsMatch(req.headers['authorization'], `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseAdmin = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: txs, error } = await supabaseAdmin
    .from('transactions')
    .select('id, user_id, account_id, fecha, nombre, monto, moneda, tipo, detalle, cuotas_total, cuota_numero, es_manual, fx_rate, reparto, accounts(nombre)')

  if (error) {
    console.error('Error leyendo transacciones para auditoría:', error.message)
    return res.status(500).json({ error: error.message })
  }

  const ahora = new Date()
  const hoyISO = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`

  const porUsuario = new Map()
  for (const t of txs || []) {
    if (!porUsuario.has(t.user_id)) porUsuario.set(t.user_id, [])
    porUsuario.get(t.user_id).push(t)
  }

  const reportePorUsuario = []
  for (const [userId, userTxs] of porUsuario) {
    const hallazgos = [
      ...detectarDuplicados(userTxs),
      ...detectarCuotasInconsistentes(userTxs),
      ...detectarCuotaRepetida(userTxs),
      ...detectarFilasIncoherentes(userTxs, hoyISO),
    ]
    if (hallazgos.length > 0) reportePorUsuario.push({ userId, hallazgos })
  }

  let emails = {}
  if (reportePorUsuario.length > 0) {
    // Paginado: listUsers trae como máximo 1000 por página — sin este loop, los
    // usuarios más allá del #1000 quedaban con su UUID crudo en vez del mail.
    const allUsers = []
    for (let page = 1; ; page++) {
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
      const users = usersData?.users || []
      allUsers.push(...users)
      if (users.length < 1000) break
    }
    emails = Object.fromEntries(allUsers.map(u => [u.id, u.email]))
  }

  const notifyEmail = process.env.NOTIFY_EMAIL
  const resendKey = process.env.RESEND_API_KEY
  if (notifyEmail && resendKey) {
    const html = reportePorUsuario.length === 0
      ? `<p style="font-family: sans-serif; font-size: 14px;">Sin hallazgos en esta auditoría. Se revisaron ${porUsuario.size} usuarios.</p>`
      : `<div style="font-family: sans-serif; font-size: 14px;">
          ${reportePorUsuario.map(({ userId, hallazgos }) => `
            <p style="margin:16px 0 4px 0"><strong>${emails[userId] || userId}</strong></p>
            <ul style="margin:4px 0">${hallazgos.map(h => `<li>${h}</li>`).join('')}</ul>
          `).join('')}
        </div>`

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: "Mom's Assist <onboarding@resend.dev>",
          to: notifyEmail,
          subject: reportePorUsuario.length === 0
            ? '✅ Auditoría automática — sin hallazgos'
            : `🔍 Auditoría automática — ${reportePorUsuario.length} usuario(s) con hallazgos`,
          html,
        })
      })
    } catch (e) {
      console.error('Error enviando email de auditoría:', e.message)
    }
  }

  return res.status(200).json({ usuariosRevisados: porUsuario.size, usuariosConHallazgos: reportePorUsuario.length })
}
