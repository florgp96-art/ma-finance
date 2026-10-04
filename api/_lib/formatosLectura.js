// Notas sobre el formato de los resúmenes de cada entidad, aprendidas en las
// revisiones automáticas (ver src/lib/revisionLectura.js y api/_lib/revisarLectura.js).
//
// Son compartidas: una nota que se escribió leyendo el resumen de un usuario se usa
// en las lecturas de todos los demás con resúmenes de esa entidad. Por eso solo las
// lee y las escribe el servidor (la tabla tiene RLS sin políticas: ningún cliente
// la puede tocar), cada nota pasa por limpiarNotaFormato antes de guardarse, y se le
// avisa por mail a la dueña de la app cada vez que se guarda una nueva.

const MAX_NOTAS = 40
const NOTAS_POR_CLAVE = 2

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Las más nuevas primero, hasta dos por entidad/producto. Si la tabla no existe o
// falla la lectura, se lee sin notas: nunca puede frenar una importación.
export async function leerNotasFormato(supabaseAdmin) {
  try {
    const { data, error } = await supabaseAdmin
      .from('formatos_lectura')
      .select('clave, entidad, producto, tipo_documento, nota')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const porClave = new Map()
    for (const n of data || []) {
      const lista = porClave.get(n.clave) || []
      if (lista.length < NOTAS_POR_CLAVE) lista.push(n)
      porClave.set(n.clave, lista)
    }
    return [...porClave.values()].flat().slice(0, MAX_NOTAS)
  } catch (e) {
    console.error('No se pudieron leer las notas de formato:', e.message)
    return []
  }
}

// Devuelve true si guardó una nota nueva (false si ya estaba esa misma o falló).
export async function guardarNotaFormato(supabaseAdmin, { clave, entidad, producto, tipoDocumento, nota, userId }) {
  try {
    const { data: iguales } = await supabaseAdmin
      .from('formatos_lectura')
      .select('id')
      .eq('clave', clave)
      .eq('nota', nota)
      .limit(1)
    if (iguales?.length) return false
    const { error } = await supabaseAdmin.from('formatos_lectura').insert({
      clave, entidad, producto, tipo_documento: tipoDocumento, nota, creado_por: userId,
    })
    if (error) throw error
    return true
  } catch (e) {
    console.error('No se pudo guardar la nota de formato:', e.message)
    return false
  }
}

export async function avisarNotaNueva({ entidad, producto, nota, userEmail }) {
  const notifyEmail = process.env.NOTIFY_EMAIL
  const resendKey = process.env.RESEND_API_KEY
  if (!notifyEmail || !resendKey) return
  const html = `<div style="font-family: sans-serif; font-size: 14px;">
    <p style="margin:4px 0">Una lectura que no cerraba con el total se corrigió sola, y el lector aprendió esto del formato. Se va a usar en las próximas lecturas de cualquier usuario con resúmenes de esta entidad.</p>
    <p style="margin:4px 0"><strong>Entidad:</strong> ${esc(entidad)}${producto ? ` · ${esc(producto)}` : ''}</p>
    <p style="margin:4px 0"><strong>Nota:</strong> ${esc(nota)}</p>
    <p style="margin:4px 0"><strong>Usuario:</strong> ${esc(userEmail)}</p>
    <p style="margin:4px 0; color:#75757a">Si la nota está mal, se borra de la tabla formatos_lectura en Supabase.</p>
  </div>`
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: "Mom's Assist <onboarding@resend.dev>",
        to: notifyEmail,
        subject: `🧠 El lector aprendió el formato de ${entidad}${producto ? ` ${producto}` : ''}`,
        html,
      }),
    })
  } catch (e) {
    console.error('No se pudo avisar la nota nueva:', e.message)
  }
}
