import { createClient } from '@supabase/supabase-js'

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

// Transacciones repetidas: misma cuenta, fecha, monto y detalle — típico de
// haber cargado el mismo extracto dos veces.
function detectarDuplicados(txs) {
  const grupos = new Map()
  for (const t of txs) {
    if (!t.detalle) continue
    const key = `${t.account_id}|${t.fecha}|${t.monto}|${t.detalle.trim().toUpperCase()}`
    if (!grupos.has(key)) grupos.set(key, [])
    grupos.get(key).push(t)
  }
  const hallazgos = []
  for (const [, grupo] of grupos) {
    if (grupo.length > 1) {
      const t = grupo[0]
      hallazgos.push(`Posible duplicado (${grupo.length}x): "${t.detalle}" por ${t.monto} ${t.moneda} el ${t.fecha}`)
    }
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
    const totalPorMes = new Map()
    const nuevasPorMes = new Map()
    for (const t of rows) {
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
        const cuenta = rows.find(r => r.account_id === accountId)
        hallazgos.push(
          `Cuenta "${cuenta?.accounts?.nombre || accountId}": cuotas subieron de $${totalAnterior.toFixed(0)} (${mesAnterior}) a $${totalActual.toFixed(0)} (${mesActual}) sin compras nuevas ese mes`
        )
      }
    }
  }
  return hallazgos
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseAdmin = createClient(
    process.env.REACT_APP_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: txs, error } = await supabaseAdmin
    .from('transactions')
    .select('id, user_id, account_id, fecha, monto, moneda, tipo, detalle, cuotas_total, cuota_numero, accounts(nombre)')

  if (error) {
    console.error('Error leyendo transacciones para auditoría:', error.message)
    return res.status(500).json({ error: error.message })
  }

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
    ]
    if (hallazgos.length > 0) reportePorUsuario.push({ userId, hallazgos })
  }

  let emails = {}
  if (reportePorUsuario.length > 0) {
    const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    emails = Object.fromEntries((usersData?.users || []).map(u => [u.id, u.email]))
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
