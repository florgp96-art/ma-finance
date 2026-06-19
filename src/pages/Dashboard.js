import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { extractTextFromPDF, analyzeStatementWithClaude } from '../lib/pdfReader'
import AccountDetail from '../components/AccountDetail'
const logo = process.env.PUBLIC_URL + '/logo.png'

const PROCESSING_MSGS = [
  { icon: '📄', title: 'Leyendo el extracto...', desc: 'Procesando las páginas del PDF' },
  { icon: '🔍', title: 'Identificando transacciones...', desc: 'Encontrando cada compra y pago' },
  { icon: '🏷️', title: 'Clasificando gastos...', desc: 'Asignando categorías automáticamente' },
  { icon: '✨', title: 'Casi listo...', desc: 'Preparando el resumen final' },
]

// Etiquetas para contextos detectados
const CONTEXTO_LABELS = {
  hijo: { icon: '👧', titulo: '¿Tenés hijos?', desc: 'Detectamos gastos de colegio, librería o pediatra. ¿Querés etiquetar estos gastos con el nombre de tu hijo/a?' },
  mascota: { icon: '🐾', titulo: '¿Tenés mascota?', desc: 'Detectamos gastos de veterinaria o pet shop. ¿Querés etiquetar estos gastos con el nombre de tu mascota?' },
  auto_propio: { icon: '🚗', titulo: '¿Tenés auto propio?', desc: 'Detectamos gastos de nafta, service o patente. ¿Querés crear una etiqueta para gastos del auto?' },
  empleada_domestica: { icon: '🧹', titulo: 'Empleada doméstica', desc: 'Detectamos pagos regulares a empleada doméstica. ¿Querés crear una etiqueta para estos pagos?' },
  alquiler_pagado: { icon: '🏠', titulo: 'Pago de alquiler', desc: 'Detectamos pago de alquiler recurrente. ¿Querés crear una etiqueta para este gasto?' },
  gimnasio: { icon: '🏋️', titulo: 'Gimnasio o actividad física', desc: 'Detectamos cuota de gimnasio. ¿Querés crear una etiqueta para este gasto?' },
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ nombre: '', tipo: 'credito' })
  const [editAccount, setEditAccount] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const [archivo, setArchivo] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadDragOver, setUploadDragOver] = useState(false)
  const [step, setStep] = useState('upload')
  const [statementData, setStatementData] = useState(null)
  const [newAccountForUpload, setNewAccountForUpload] = useState({ nombre: '', tipo: 'credito' })
  const [separarAdicionales, setSepararAdicionales] = useState(null)
  const [targetAccount, setTargetAccount] = useState(null)

  // Paso identificar: transacciones sin clasificar post-carga
  const [txSinIdentificar, setTxSinIdentificar] = useState([])
  const [txIdentificarIdx, setTxIdentificarIdx] = useState(0)
  const [txEditTemp, setTxEditTemp] = useState({ nombre: '', categoria: '', subcategoria: '' })
  const [categoriasDB, setCategoriasDB] = useState([])
  const [subcategoriasDB, setSubcategoriasDB] = useState([])
  const [savedTxIds, setSavedTxIds] = useState([]) // IDs de las txs guardadas en DB para poder actualizarlas

  // Contexto detectado
  const [contextoDetectado, setContextoDetectado] = useState([])
  const [contextoIdx, setContextoIdx] = useState(0)
  const [showContexto, setShowContexto] = useState(false)

  const [msgIndex, setMsgIndex] = useState(0)
  const msgInterval = useRef(null)
  const [timer, setTimer] = useState(120)
  const timerInterval = useRef(null)

  // Búsqueda
  const [searchQuery, setSearchQuery] = useState('')

  // Modal gasto en efectivo
  const [showEfectivo, setShowEfectivo] = useState(false)
  const [cuentaEfectivoId, setCuentaEfectivoId] = useState(null)
  const [efectivo, setEfectivo] = useState({ fecha: new Date().toISOString().slice(0,10), nombre: '', monto: '', moneda: 'ARS', categoria: '', subcategoria: '', nota: '' })

  useEffect(() => { fetchAccounts(); fetchCategorias() }, [])

  useEffect(() => {
    if (step === 'processing') {
      setMsgIndex(0)
      setTimer(120)
      msgInterval.current = setInterval(() => {
        setMsgIndex(i => (i + 1) % PROCESSING_MSGS.length)
      }, 3000)
      timerInterval.current = setInterval(() => {
        setTimer(t => t > 0 ? t - 1 : 0)
      }, 1000)
    } else {
      clearInterval(msgInterval.current)
      clearInterval(timerInterval.current)
    }
    return () => { clearInterval(msgInterval.current); clearInterval(timerInterval.current) }
  }, [step])

  const fetchCategorias = async () => {
    const { data: cats } = await supabase.from('categories').select('*').order('orden')
    const { data: subcats } = await supabase.from('subcategories').select('*').order('nombre')
    setCategoriasDB(cats || [])
    setSubcategoriasDB(subcats || [])
  }

  const handleGuardarEfectivo = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const catObj = categoriasDB.find(c => c.nombre === efectivo.categoria)
    const subcatObj = subcategoriasDB.find(s => s.nombre === efectivo.subcategoria && s.category_id === catObj?.id)

    await supabase.from('transactions').insert({
      user_id: user.id,
      account_id: cuentaEfectivoId,
      fecha: efectivo.fecha,
      nombre: efectivo.nombre,
      detalle: efectivo.nota || efectivo.nombre,
      monto: parseFloat(efectivo.monto),
      moneda: efectivo.moneda,
      tipo: 'gasto',
      category_id: catObj?.id || null,
      subcategory_id: subcatObj?.id || null,
      estado: catObj ? 'identificado' : 'a_identificar',
      es_manual: true,
      cuotas_total: 1,
      cuota_numero: 1,
    })

    setEfectivo({ fecha: new Date().toISOString().slice(0,10), nombre: '', monto: '', moneda: 'ARS', categoria: '', subcategoria: '', nota: '' })
    setShowEfectivo(false)
    setRefreshKey(k => k + 1)
    setLoading(false)
  }

  const fetchAccounts = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('accounts').select('*').eq('user_id', user.id)
    setAccounts(data || [])
    if (data && data.length > 0) {
      const ef = data.find(a => a.nombre === 'Efectivo')
      if (ef) setSelectedAccount(prev => prev === null ? ef : prev)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const handleAddAccount = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('accounts').insert({ user_id: user.id, nombre: newAccount.nombre, tipo: newAccount.tipo })
    setNewAccount({ nombre: '', tipo: 'credito' })
    setShowAddAccount(false)
    fetchAccounts()
    setLoading(false)
  }

  const handleEditAccount = async (e) => {
    e.preventDefault()
    setLoading(true)
    await supabase.from('accounts').update({ nombre: editAccount.nombre, tipo: editAccount.tipo }).eq('id', editAccount.id)
    setEditAccount(null)
    fetchAccounts()
    setLoading(false)
  }

  const handleDeleteAccount = async (accountId) => {
    setLoading(true)
    await supabase.from('transactions').delete().eq('account_id', accountId)
    await supabase.from('statements').delete().eq('account_id', accountId)
    await supabase.from('accounts').delete().eq('id', accountId)
    setConfirmDelete(null)
    if (selectedAccount?.id === accountId) setSelectedAccount(null)
    fetchAccounts()
    setLoading(false)
  }

  const resetUpload = () => {
    setArchivo(null)
    setStep('upload')
    setStatementData(null)
    setTargetAccount(null)
    setSepararAdicionales(null)
    setNewAccountForUpload({ nombre: '', tipo: 'credito' })
    setMsgIndex(0)
    setTxSinIdentificar([])
    setTxIdentificarIdx(0)
    setSavedTxIds([])
    setContextoDetectado([])
    setContextoIdx(0)
  }

  const handleUploadPDF = async () => {
    if (!archivo) return
    setStep('processing')
    setLoading(true)
    try {
      // Cargar user_rules del usuario para inyectarlas al prompt
      const { data: { user } } = await supabase.auth.getUser()
      const { data: rules } = await supabase.from('user_rules').select('*').eq('user_id', user.id)

      const pdfText = await extractTextFromPDF(archivo)
      const result = await analyzeStatementWithClaude(pdfText, 'auto', rules || [])
      setStatementData(result)
      setNewAccountForUpload({ nombre: result.tarjeta_detectada || '', tipo: 'credito' })

      // Guardar contexto detectado si hay algo nuevo
      if (result.contexto_detectado && result.contexto_detectado.length > 0) {
        // Filtrar contextos que el usuario ya confirmó antes (guardados en user_rules como contexto_*)
        const { data: existingCtx } = await supabase.from('user_rules')
          .select('texto_original').eq('user_id', user.id).like('texto_original', 'contexto_%')
        const yaConfirmados = (existingCtx || []).map(r => r.texto_original.replace('contexto_', ''))
        const nuevos = result.contexto_detectado.filter(c => !yaConfirmados.includes(c))
        setContextoDetectado(nuevos)
      }

      if (result.tipo_documento === 'banco') {
        setStep('preview')
      } else {
        setStep('select_account')
      }
    } catch (err) {
      alert('Error procesando el PDF: ' + err.message)
      setStep('upload')
    }
    setLoading(false)
  }

  const handleSelectAccount = (acc) => {
    setTargetAccount(acc)
    if (statementData.adicionales && statementData.adicionales.length > 0) setStep('adicionales')
    else setStep('preview')
  }

  const handleCreateNewForUpload = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: account } = await supabase.from('accounts').insert({
      user_id: user.id, nombre: newAccountForUpload.nombre, tipo: newAccountForUpload.tipo,
    }).select().single()
    setTargetAccount(account)
    fetchAccounts()
    setLoading(false)
    if (statementData.adicionales && statementData.adicionales.length > 0) setStep('adicionales')
    else setStep('preview')
  }

  const handleConfirmAdicionales = (separar) => {
    setSepararAdicionales(separar)
    setStep('preview')
  }

  // Guardar una clasificación desde el paso identificar
  const handleGuardarClasificacion = async (txId, detalle) => {
    const catObj = categoriasDB.find(c => c.nombre === txEditTemp.categoria)
    const subcatObj = subcategoriasDB.find(s => s.nombre === txEditTemp.subcategoria && s.category_id === catObj?.id)

    await supabase.from('transactions').update({
      nombre: txEditTemp.nombre,
      category_id: catObj?.id || null,
      subcategory_id: subcatObj?.id || null,
      estado: 'identificado'
    }).eq('id', txId)

    // Guardar regla aprendida
    if (detalle && catObj) {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('user_rules').upsert({
        user_id: user.id,
        texto_original: detalle.trim(),
        nombre_asignado: txEditTemp.nombre || detalle.trim(),
        categoria: catObj.nombre,
        subcategoria: subcatObj?.nombre || null,
        category_id: catObj.id,
        subcategory_id: subcatObj?.id || null,
        veces_confirmado: 1,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,texto_original', ignoreDuplicates: false })
    }

    // Avanzar a la siguiente
    if (txIdentificarIdx + 1 < txSinIdentificar.length) {
      const next = txSinIdentificar[txIdentificarIdx + 1]
      setTxIdentificarIdx(i => i + 1)
      setTxEditTemp({ nombre: next.nombre_original, categoria: 'A Identificar', subcategoria: '' })
    } else {
      // Terminamos, ir a contexto o cerrar
      finalizarCarga()
    }
  }

  const handleSaltarClasificacion = () => {
    if (txIdentificarIdx + 1 < txSinIdentificar.length) {
      const next = txSinIdentificar[txIdentificarIdx + 1]
      setTxIdentificarIdx(i => i + 1)
      setTxEditTemp({ nombre: next.nombre_original, categoria: 'A Identificar', subcategoria: '' })
    } else {
      finalizarCarga()
    }
  }

  const finalizarCarga = () => {
    // Si hay contextos nuevos detectados, mostrarlos
    if (contextoDetectado.length > 0) {
      setContextoIdx(0)
      setShowContexto(true)
      setStep('contexto')
    } else {
      cerrarYRefrescar()
    }
  }

  // Confirmar contexto detectado — guarda en user_rules como flag para no preguntar de nuevo
  const handleConfirmarContexto = async (confirmar) => {
    const { data: { user } } = await supabase.auth.getUser()
    const clave = contextoDetectado[contextoIdx]
    if (confirmar) {
      // Guardamos que el usuario confirmó este contexto (para uso futuro)
      await supabase.from('user_rules').upsert({
        user_id: user.id,
        texto_original: `contexto_${clave}`,
        nombre_asignado: clave,
        categoria: 'Personal',
        subcategoria: null,
        category_id: null,
        subcategory_id: null,
        veces_confirmado: 1,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,texto_original', ignoreDuplicates: false })
    }

    if (contextoIdx + 1 < contextoDetectado.length) {
      setContextoIdx(i => i + 1)
    } else {
      cerrarYRefrescar()
    }
  }

  const cerrarYRefrescar = () => {
    resetUpload()
    setShowUpload(false)
    fetchAccounts()
    setRefreshKey(k => k + 1)
  }

  const handleConfirmTransactions = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const esBanco = statementData.tipo_documento === 'banco'
    const nombreBase = esBanco
      ? (statementData.tarjeta_detectada || 'Cuenta Bancaria')
      : null

    const { data: categorias } = await supabase.from('categories').select('id, nombre')
    const getCategoryId = (cat) => {
      if (!categorias || !cat) return null
      return categorias.find(c => c.nombre.toLowerCase() === cat.toLowerCase())?.id || null
    }
    const { data: subcategorias } = await supabase.from('subcategories').select('id, nombre, category_id')
    const getSubcategoryId = (sub, catId) => {
      if (!subcategorias || !sub || !catId) return null
      return subcategorias.find(s => s.nombre.toLowerCase() === sub.toLowerCase() && s.category_id === catId)?.id || null
    }

    let cuentaParaVerificar = targetAccount

    if (esBanco) {
      // Verificar duplicado en egresos (representativa)
      let { data: cuentaEgresos } = await supabase.from('accounts')
        .select('*').eq('user_id', user.id).ilike('nombre', `Egresos - ${nombreBase}`).maybeSingle()
      if (!cuentaEgresos) {
        const { data: nueva } = await supabase.from('accounts').insert({
          user_id: user.id, nombre: `Egresos - ${nombreBase}`, tipo: 'debito'
        }).select().single()
        cuentaEgresos = nueva
      }
      cuentaParaVerificar = cuentaEgresos

      const { data: existing } = await supabase.from('statements')
        .select('id').eq('account_id', cuentaEgresos.id).eq('periodo', statementData.periodo).maybeSingle()
      if (existing) {
        alert(`Ya cargaste el extracto de ${statementData.periodo} para esta cuenta.`)
        setLoading(false)
        return
      }

      let { data: cuentaIngresos } = await supabase.from('accounts')
        .select('*').eq('user_id', user.id).ilike('nombre', `Ingresos - ${nombreBase}`).maybeSingle()
      if (!cuentaIngresos) {
        const { data: nueva } = await supabase.from('accounts').insert({
          user_id: user.id, nombre: `Ingresos - ${nombreBase}`, tipo: 'debito'
        }).select().single()
        cuentaIngresos = nueva
      }

      const { data: stmtEgresos } = await supabase.from('statements').insert({
        user_id: user.id, account_id: cuentaEgresos.id, nombre_archivo: archivo.name,
        periodo: statementData.periodo, fecha_desde: null,
        fecha_hasta: statementData.fecha_facturacion, total_resumen: null, estado: 'completo'
      }).select().single()

      const { data: stmtIngresos } = await supabase.from('statements').insert({
        user_id: user.id, account_id: cuentaIngresos.id, nombre_archivo: archivo.name,
        periodo: statementData.periodo, fecha_desde: null,
        fecha_hasta: statementData.fecha_facturacion, total_resumen: null, estado: 'completo'
      }).select().single()

      const txEgresos = []
      const txIngresos = []

      statementData.transacciones.forEach(t => {
        const categoryId = getCategoryId(t.categoria_sugerida)
        const subcategoryId = getSubcategoryId(t.subcategoria_sugerida, categoryId)
        const tipoTx = t.tipo || (t.es_credito ? 'ingreso' : 'gasto')
        const base = {
          user_id: user.id, fecha: t.fecha,
          nombre: t.nombre_limpio !== t.nombre_original ? t.nombre_limpio : null,
          detalle: t.nombre_original,
          monto: Math.abs(t.monto),
          moneda: t.moneda || 'ARS',
          cuotas_total: null, cuota_numero: null,
          category_id: categoryId, subcategory_id: subcategoryId,
          estado: (!t.nombre_limpio || t.nombre_limpio === t.nombre_original) ? 'a_identificar' : 'identificado',
          es_manual: false
        }
        if (tipoTx === 'ingreso') {
          txIngresos.push({ ...base, account_id: cuentaIngresos.id, statement_id: stmtIngresos.id, tipo: 'ingreso' })
        } else {
          txEgresos.push({ ...base, account_id: cuentaEgresos.id, statement_id: stmtEgresos.id, tipo: tipoTx === 'neutro' ? 'neutro' : 'gasto' })
        }
      })

      const insertedIds = []
      if (txEgresos.length > 0) {
        const { data: ins } = await supabase.from('transactions').insert(txEgresos).select('id, detalle, estado, nombre_original')
        if (ins) insertedIds.push(...ins)
      }
      if (txIngresos.length > 0) {
        const { data: ins } = await supabase.from('transactions').insert(txIngresos).select('id, detalle, estado, nombre_original')
        if (ins) insertedIds.push(...ins)
      }

      // Preparar paso identificar
      const sinId = insertedIds.filter(t => t.estado === 'a_identificar')
      if (sinId.length > 0) {
        setTxSinIdentificar(sinId)
        setSavedTxIds(sinId.map(t => t.id))
        setTxIdentificarIdx(0)
        setTxEditTemp({ nombre: sinId[0].detalle || '', categoria: 'A Identificar', subcategoria: '' })
        setStep('identificar')
      } else {
        finalizarCarga()
      }

    } else {
      // Tarjeta de crédito — flujo normal
      const account = targetAccount
      const { data: existing } = await supabase.from('statements')
        .select('id').eq('account_id', account.id).eq('periodo', statementData.periodo).maybeSingle()
      if (existing) {
        alert(`Ya cargaste el extracto de ${statementData.periodo} para esta cuenta.`)
        setLoading(false)
        return
      }

      const { data: statement } = await supabase.from('statements').insert({
        user_id: user.id, account_id: account.id, nombre_archivo: archivo.name,
        periodo: statementData.periodo, fecha_desde: null,
        fecha_hasta: statementData.fecha_facturacion, total_resumen: statementData.total_pesos, estado: 'completo'
      }).select().single()

      const fechaResumen = statementData.fecha_facturacion || null
      const transacciones = statementData.transacciones.map(t => {
        const categoryId = getCategoryId(t.categoria_sugerida)
        let fechaFinal = t.fecha
        if (t.cuotas_total > 1 && fechaResumen) {
          const parts = fechaResumen.split('/')
          if (parts.length === 3) {
            const year = parts[2].length === 2 ? '20' + parts[2] : parts[2]
            fechaFinal = `${year}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`
          }
        }
        return {
          user_id: user.id, account_id: account.id, statement_id: statement.id,
          fecha: fechaFinal,
          nombre: t.nombre_limpio !== t.nombre_original ? t.nombre_limpio : null,
          detalle: t.nombre_original,
          monto: t.es_credito ? -Math.abs(t.monto) : t.monto,
          moneda: t.moneda, cuotas_total: t.cuotas_total, cuota_numero: t.cuota_numero,
          tipo: 'gasto', category_id: categoryId,
          subcategory_id: getSubcategoryId(t.subcategoria_sugerida, categoryId),
          estado: (!t.nombre_limpio || t.nombre_limpio === t.nombre_original) ? 'a_identificar' : 'identificado',
          es_manual: false
        }
      })

      const { data: inserted } = await supabase.from('transactions').insert(transacciones).select('id, detalle, estado')

      // Preparar paso identificar
      const sinId = (inserted || []).filter(t => t.estado === 'a_identificar')
      if (sinId.length > 0) {
        setTxSinIdentificar(sinId)
        setSavedTxIds(sinId.map(t => t.id))
        setTxIdentificarIdx(0)
        setTxEditTemp({ nombre: sinId[0].detalle || '', categoria: 'A Identificar', subcategoria: '' })
        setStep('identificar')
      } else {
        finalizarCarga()
      }
    }

    fetchAccounts()
    setLoading(false)
  }

  const handleDropUpload = (e) => {
    e.preventDefault()
    setUploadDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type === 'application/pdf') setArchivo(file)
    else alert('Solo se aceptan archivos PDF')
  }

  const tipoLabel = (tipo) => tipo === 'credito' ? 'Crédito' : tipo === 'debito' ? 'Débito' : 'Efectivo'
  const formatMonto = (monto) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)
  const currentMsg = PROCESSING_MSGS[msgIndex]

  // Subcategorías filtradas para el paso identificar
  const subcatsParaIdentificar = () => {
    const catObj = categoriasDB.find(c => c.nombre === txEditTemp.categoria)
    if (!catObj) return []
    return subcategoriasDB.filter(s => s.category_id === catObj.id)
  }

  const txActual = txSinIdentificar[txIdentificarIdx]
  const contextoActual = contextoDetectado[contextoIdx]

  return (
    <>
      <div style={styles.container}>

        <div style={styles.header}>
          <img src={logo} alt="Moms Assist Finance" style={styles.logoImg} />
        </div>

        <div style={styles.layout}>

          {/* Sidebar izquierdo */}
          <div style={styles.sidebar}>
            <div style={styles.sidebarHeader}>
              <h2 style={styles.sidebarTitle}>CUENTAS</h2>
            </div>

            <button style={styles.sidebarBtnPrimary} onClick={() => { resetUpload(); setShowUpload(true) }}>
              + CARGAR PDF
            </button>
            <button style={styles.sidebarBtnPrimary} onClick={async () => {
              const { data: { user } } = await supabase.auth.getUser()
              let { data: ce } = await supabase.from('accounts')
                .select('*').eq('user_id', user.id).eq('nombre', 'Efectivo').maybeSingle()
              if (!ce) {
                const { data: nueva } = await supabase.from('accounts')
                  .insert({ user_id: user.id, nombre: 'Efectivo', tipo: 'efectivo' }).select().single()
                ce = nueva
                fetchAccounts()
              }
              setCuentaEfectivoId(ce.id)
              setShowEfectivo(true)
            }}>
              + GASTO EN EFECTIVO
            </button>
            <button style={styles.sidebarBtnSecondary} onClick={() => setShowAddAccount(true)}>
              + CUENTA
            </button>

            <div style={styles.accountsList}>
              {accounts.length > 0 && (
                <div
                  style={{...styles.accountCard, ...(selectedAccount === 'all' ? styles.accountCardSelected : {})}}
                  onClick={() => setSelectedAccount(selectedAccount === 'all' ? null : 'all')}
                >
                  <p style={{...styles.accountType, marginBottom: '4px'}}>📊 RESUMEN</p>
                  <p style={styles.accountName}>Resumen General</p>
                </div>
              )}
              {accounts.length === 0 ? (
                <p style={styles.emptyText}>Todavía no agregaste ninguna cuenta.</p>
              ) : (
                accounts.map(acc => (
                  <div key={acc.id}
                    style={{...styles.accountCard, ...(selectedAccount?.id === acc.id ? styles.accountCardSelected : {})}}
                    onClick={() => setSelectedAccount(selectedAccount?.id === acc.id ? null : acc)}
                  >
                    <div style={styles.accountCardHeader}>
                      <p style={styles.accountType}>💳 {tipoLabel(acc.tipo)}</p>
                      <div style={styles.accountActions}>
                        <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); setEditAccount({...acc}) }}>✏️</button>
                        <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); setConfirmDelete(acc.id) }}>🗑️</button>
                      </div>
                    </div>
                    <p style={styles.accountName}>{acc.nombre}</p>
                  </div>
                ))
              )}
            </div>

            <div style={styles.sidebarFooter}>
              <button style={styles.logoutBtn} onClick={handleLogout}>Cerrar sesión</button>
            </div>
          </div>

          {/* Contenido derecho */}
          <div style={styles.mainContent}>
            {selectedAccount === 'all' ? (
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>📊 Resumen General</h2>
                <AccountDetail accounts={accounts} allAccounts refreshKey={refreshKey} searchQuery={searchQuery} onSearchChange={setSearchQuery} />
              </div>
            ) : selectedAccount ? (
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>📊 {selectedAccount.nombre}</h2>
                <AccountDetail account={selectedAccount} refreshKey={refreshKey} searchQuery={searchQuery} onSearchChange={setSearchQuery} />
              </div>
            ) : (
              <div style={styles.emptyState}>
                <p style={styles.emptyStateIcon}>💳</p>
                <p style={styles.emptyStateText}>Seleccioná una cuenta para ver sus movimientos</p>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Modales */}
      {showAddAccount && (
        <div style={styles.overlay}>
          <div style={{...styles.modal, maxWidth: '400px'}}>
            <h3 style={styles.modalTitle}>Agregar cuenta</h3>
            <form onSubmit={handleAddAccount}>
              <div style={styles.field}>
                <label style={styles.label}>Nombre</label>
                <input style={styles.input} value={newAccount.nombre}
                  onChange={(e) => setNewAccount({...newAccount, nombre: e.target.value})}
                  placeholder="Ej: Amex, Visa Galicia, Mastercard" required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Tipo</label>
                <select style={styles.input} value={newAccount.tipo} onChange={(e) => setNewAccount({...newAccount, tipo: e.target.value})}>
                  <option value="credito">💳 Tarjeta de crédito</option>
                  <option value="debito">🏦 Débito / Cuenta bancaria</option>
                </select>
              </div>
              <div style={styles.modalButtons}>
                <button type="button" style={styles.cancelBtn} onClick={() => setShowAddAccount(false)}>Cancelar</button>
                <button type="submit" style={styles.saveBtn} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editAccount && (
        <div style={styles.overlay}>
          <div style={{...styles.modal, maxWidth: '400px'}}>
            <h3 style={styles.modalTitle}>Editar tarjeta</h3>
            <form onSubmit={handleEditAccount}>
              <div style={styles.field}>
                <label style={styles.label}>Nombre</label>
                <input style={styles.input} value={editAccount.nombre}
                  onChange={(e) => setEditAccount({...editAccount, nombre: e.target.value})} required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Tipo</label>
                <select style={styles.input} value={editAccount.tipo} onChange={(e) => setEditAccount({...editAccount, tipo: e.target.value})}>
                  <option value="credito">💳 Tarjeta de crédito</option>
                  <option value="debito">🏦 Débito / Cuenta bancaria</option>
                </select>
              </div>
              <div style={styles.modalButtons}>
                <button type="button" style={styles.cancelBtn} onClick={() => setEditAccount(null)}>Cancelar</button>
                <button type="submit" style={styles.saveBtn} disabled={loading}>{loading ? 'Guardando...' : 'Guardar cambios'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={styles.overlay}>
          <div style={{...styles.modal, maxWidth: '380px'}}>
            <h3 style={styles.modalTitle}>¿Eliminar tarjeta?</h3>
            <p style={{fontSize: '14px', color: '#666', marginBottom: '24px'}}>
              Se borrarán todos los extractos y transacciones asociadas. Esta acción no se puede deshacer.
            </p>
            <div style={styles.modalButtons}>
              <button style={styles.cancelBtn} onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button style={{...styles.saveBtn, backgroundColor: '#e74c3c'}}
                onClick={() => handleDeleteAccount(confirmDelete)} disabled={loading}>
                {loading ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpload && (
        <div style={styles.overlay}>
          <div style={styles.modal}>

            {step === 'upload' && (
              <>
                <h3 style={styles.modalTitle}>Cargar extracto 📄</h3>
                <div
                  style={{...styles.dropzone, ...(uploadDragOver ? styles.dropzoneActive : {}), ...(archivo ? styles.dropzoneDone : {})}}
                  onDragOver={(e) => { e.preventDefault(); setUploadDragOver(true) }}
                  onDragLeave={() => setUploadDragOver(false)}
                  onDrop={handleDropUpload}
                  onClick={() => document.getElementById('uploadInput').click()}
                >
                  {archivo ? (
                    <><p style={styles.dropzoneIcon}>✅</p><p style={styles.dropzoneText}>{archivo.name}</p><p style={styles.dropzoneHint}>Clickeá para cambiar</p></>
                  ) : (
                    <><p style={styles.dropzoneIcon}>📄</p><p style={styles.dropzoneText}>Arrastrá el PDF acá o clickeá para seleccionar</p><p style={styles.dropzoneHint}>Solo archivos PDF · Máx. 10MB</p></>
                  )}
                </div>
                <input id="uploadInput" type="file" accept=".pdf" style={{display:'none'}}
                  onChange={(e) => { if (e.target.files[0]) setArchivo(e.target.files[0]) }} />
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => { setShowUpload(false); resetUpload() }}>Cancelar</button>
                  <button style={styles.saveBtn} onClick={handleUploadPDF} disabled={!archivo || loading}>
                    {loading ? 'Procesando...' : 'Analizar'}
                  </button>
                </div>
              </>
            )}

            {step === 'processing' && (
              <div style={styles.processingContainer}>
                <p style={styles.processingIcon}>{currentMsg.icon}</p>
                <h3 style={styles.processingTitle}>{currentMsg.title}</h3>
                <p style={styles.processingText}>{currentMsg.desc}</p>
                <div style={styles.processingDots}>
                  {PROCESSING_MSGS.map((_, i) => (
                    <div key={i} style={{...styles.dot, ...(i === msgIndex ? styles.dotActive : {})}} />
                  ))}
                </div>
                <div style={styles.timerBar}>
                  <div style={{...styles.timerFill, width: `${(timer / 120) * 100}%`, backgroundColor: timer < 20 ? '#e07b39' : '#6B7BB8'}} />
                </div>
                <p style={styles.timerText}>{timer}s restantes</p>
              </div>
            )}

            {step === 'select_account' && statementData && (
              <>
                <h3 style={styles.modalTitle}>¿A qué tarjeta pertenece? 💳</h3>
                <p style={{fontSize: '14px', color: '#666', marginBottom: '8px'}}>
                  Detectamos: <strong>{statementData.tarjeta_detectada}</strong>
                </p>
                <p style={{fontSize: '13px', color: '#aaa', marginBottom: '20px'}}>
                  Seleccioná la tarjeta o creá una nueva:
                </p>
                <div style={{display:'flex', flexDirection:'column', gap:'10px', marginBottom:'8px'}}>
                  {accounts.map(acc => (
                    <button key={acc.id} style={styles.selectAccountBtn}
                      onClick={() => handleSelectAccount(acc)}>
                      💳 {acc.nombre}
                      <span style={{fontSize:'12px', color:'#aaa', fontWeight:'400', marginLeft:'8px'}}>{tipoLabel(acc.tipo)}</span>
                    </button>
                  ))}
                  <button style={{...styles.selectAccountBtn, ...styles.selectAccountBtnNew}}
                    onClick={() => setStep('new_account')}>
                    + Crear nueva tarjeta
                  </button>
                </div>
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => { setShowUpload(false); resetUpload() }}>Cancelar</button>
                </div>
              </>
            )}

            {step === 'new_account' && (
              <>
                <h3 style={styles.modalTitle}>Nueva tarjeta</h3>
                <p style={{fontSize: '14px', color: '#666', marginBottom: '20px'}}>Completá los datos de la nueva tarjeta:</p>
                <form onSubmit={handleCreateNewForUpload}>
                  <div style={styles.field}>
                    <label style={styles.label}>Nombre</label>
                    <input style={styles.input} value={newAccountForUpload.nombre}
                      onChange={(e) => setNewAccountForUpload({...newAccountForUpload, nombre: e.target.value})}
                      placeholder="Ej: Amex, Visa Galicia" required />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>Tipo</label>
                    <select style={styles.input} value={newAccountForUpload.tipo}
                      onChange={(e) => setNewAccountForUpload({...newAccountForUpload, tipo: e.target.value})}>
                      <option value="credito">💳 Tarjeta de crédito</option>
                      <option value="debito">🏦 Débito / Cuenta bancaria</option>
                    </select>
                  </div>
                  <div style={styles.modalButtons}>
                    <button type="button" style={styles.cancelBtn} onClick={() => setStep('select_account')}>← Volver</button>
                    <button type="submit" style={styles.saveBtn} disabled={loading}>{loading ? 'Creando...' : 'Crear y continuar'}</button>
                  </div>
                </form>
              </>
            )}

            {step === 'adicionales' && statementData && (
              <>
                <h3 style={styles.modalTitle}>Detectamos adicionales 👥</h3>
                <p style={styles.stepSubtitle}>En este extracto encontramos gastos de otras personas:</p>
                <div style={styles.adicionalesList}>
                  {statementData.adicionales.map((a, i) => <div key={i} style={styles.adicionalItem}>👤 {a}</div>)}
                </div>
                <p style={styles.stepQuestion}>¿Cómo querés ver estos gastos?</p>
                <div style={styles.opcionesGrid}>
                  <button style={styles.opcionBtn} onClick={() => handleConfirmAdicionales(true)}>
                    <span style={styles.opcionIcon}>📊</span>
                    <span style={styles.opcionTitle}>Separados por persona</span>
                    <span style={styles.opcionDesc}>Ver cuánto gastó cada uno</span>
                  </button>
                  <button style={styles.opcionBtn} onClick={() => handleConfirmAdicionales(false)}>
                    <span style={styles.opcionIcon}>📋</span>
                    <span style={styles.opcionTitle}>Todo junto</span>
                    <span style={styles.opcionDesc}>Como gastos propios</span>
                  </button>
                </div>
              </>
            )}

            {step === 'preview' && statementData && (
              <>
                <h3 style={styles.modalTitle}>
                  {statementData?.tipo_documento === 'banco' ? 'Revisá los movimientos del banco 🏦' : 'Revisá las transacciones ✅'}
                </h3>
                <div style={styles.previewStats}>
                  <div style={styles.previewStat}><span style={styles.previewStatLabel}>Período</span><span style={styles.previewStatValue}>{statementData.periodo}</span></div>
                  <div style={styles.previewStat}><span style={styles.previewStatLabel}>Total ARS</span><span style={styles.previewStatValue}>$ {formatMonto(statementData.total_pesos)}</span></div>
                  <div style={styles.previewStat}><span style={styles.previewStatLabel}>Vencimiento</span><span style={styles.previewStatValue}>{statementData.fecha_vencimiento}</span></div>
                  <div style={styles.previewStat}><span style={styles.previewStatLabel}>Transacciones</span><span style={styles.previewStatValue}>{statementData.transacciones.length}</span></div>
                </div>
                <div style={styles.transactionsList}>
                  {statementData.transacciones.slice(0, 10).map((t, i) => (
                    <div key={i} style={styles.transactionItem}>
                      <div style={styles.transactionLeft}>
                        <p style={styles.transactionName}>{t.nombre_limpio || t.nombre_original}{t.nombre_limpio === t.nombre_original && <span> ❓</span>}</p>
                        <p style={styles.transactionDetail}>{t.fecha} · {t.categoria_sugerida}{t.cuotas_total > 1 && ` · Cuota ${t.cuota_numero}/${t.cuotas_total}`}{separarAdicionales && t.titular && ` · ${t.titular}`}</p>
                      </div>
                      <p style={{...styles.transactionMonto, color: t.es_credito ? '#27AE60' : '#2d2d2d'}}>
                        {t.es_credito ? '+' : '-'} {t.moneda === 'USD' ? 'U$S' : '$'} {formatMonto(t.monto)}
                      </p>
                    </div>
                  ))}
                  {statementData.transacciones.length > 10 && <p style={styles.moreTransactions}>+ {statementData.transacciones.length - 10} transacciones más</p>}
                </div>
                {statementData.transacciones.some(t => t.categoria_sugerida === 'A Identificar') && (
                  <div style={styles.warningBox}>
                    ❓ Hay {statementData.transacciones.filter(t => t.categoria_sugerida === 'A Identificar').length} {statementData.transacciones.filter(t => t.categoria_sugerida === 'A Identificar').length === 1 ? 'transacción' : 'transacciones'} sin identificar. Te vamos a pedir que las clasifiques antes de cerrar.
                  </div>
                )}
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => setStep(statementData?.tipo_documento === 'banco' ? 'upload' : 'select_account')}>← Atrás</button>
                  <button style={styles.saveBtn} onClick={handleConfirmTransactions} disabled={loading}>{loading ? 'Guardando...' : 'Confirmar y guardar'}</button>
                </div>
              </>
            )}

            {/* Paso: clasificar transacciones sin identificar */}
            {step === 'identificar' && txActual && (
              <>
                <h3 style={styles.modalTitle}>¿Qué es este gasto? 🔍</h3>
                <p style={{fontSize: '13px', color: '#8e8e93', margin: '-8px 0 20px 0'}}>
                  {txIdentificarIdx + 1} de {txSinIdentificar.length} sin identificar
                </p>

                {/* Barra de progreso */}
                <div style={styles.timerBar}>
                  <div style={{
                    ...styles.timerFill,
                    width: `${((txIdentificarIdx + 1) / txSinIdentificar.length) * 100}%`,
                    backgroundColor: '#6B7BB8',
                    transition: 'width 0.3s'
                  }} />
                </div>

                <div style={styles.identificarCard}>
                  <p style={styles.identificarDetalle}>{txActual.detalle}</p>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Nombre legible</label>
                  <input
                    style={styles.input}
                    value={txEditTemp.nombre}
                    onChange={e => setTxEditTemp({...txEditTemp, nombre: e.target.value})}
                    placeholder="Ej: Supermercado Coto, Netflix..."
                  />
                </div>

                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
                  <div style={styles.field}>
                    <label style={styles.label}>Categoría</label>
                    <select style={styles.input} value={txEditTemp.categoria}
                      onChange={e => setTxEditTemp({...txEditTemp, categoria: e.target.value, subcategoria: ''})}>
                      {categoriasDB.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>Subcategoría</label>
                    <select style={styles.input} value={txEditTemp.subcategoria}
                      onChange={e => setTxEditTemp({...txEditTemp, subcategoria: e.target.value})}
                      disabled={subcatsParaIdentificar().length === 0}>
                      <option value="">— Sin subcategoría</option>
                      {subcatsParaIdentificar().map(s => <option key={s.id} value={s.nombre}>{s.nombre}</option>)}
                    </select>
                  </div>
                </div>

                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={handleSaltarClasificacion}>
                    Saltar →
                  </button>
                  <button style={styles.saveBtn}
                    onClick={() => handleGuardarClasificacion(txActual.id, txActual.detalle)}
                    disabled={!txEditTemp.nombre}>
                    Guardar y siguiente →
                  </button>
                </div>
              </>
            )}

            {/* Paso: contexto personal detectado */}
            {step === 'contexto' && contextoActual && CONTEXTO_LABELS[contextoActual] && (
              <>
                <div style={styles.contextoCard}>
                  <p style={styles.contextoIcon}>{CONTEXTO_LABELS[contextoActual].icon}</p>
                  <h3 style={styles.modalTitle}>{CONTEXTO_LABELS[contextoActual].titulo}</h3>
                  <p style={{fontSize: '14px', color: '#6e6e73', marginBottom: '28px', lineHeight: '1.5'}}>
                    {CONTEXTO_LABELS[contextoActual].desc}
                  </p>
                  {contextoDetectado.length > 1 && (
                    <p style={{fontSize: '12px', color: '#aaa', marginBottom: '8px'}}>
                      {contextoIdx + 1} de {contextoDetectado.length}
                    </p>
                  )}
                </div>
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => handleConfirmarContexto(false)}>
                    No, ignorar
                  </button>
                  <button style={styles.saveBtn} onClick={() => handleConfirmarContexto(true)}>
                    Sí, tener en cuenta ✓
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

      {showEfectivo && (
        <div style={styles.overlay}>
          <div style={{...styles.modal, maxWidth: '440px'}}>
            <h3 style={styles.modalTitle}>+ Gasto en efectivo 💵</h3>
            <p style={{fontSize:'12px', color:'#8e8e93', margin:'-8px 0 16px 0'}}>Los campos con <span style={{color:'#c0392b'}}>*</span> son obligatorios</p>
            <form onSubmit={handleGuardarEfectivo}>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
                <div style={styles.field}>
                  <label style={styles.label}>Fecha <span style={{color:'#c0392b'}}>*</span></label>
                  <input style={styles.input} type="date" value={efectivo.fecha}
                    onChange={e => setEfectivo({...efectivo, fecha: e.target.value})} required />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Moneda <span style={{color:'#c0392b'}}>*</span></label>
                  <select style={styles.input} value={efectivo.moneda}
                    onChange={e => setEfectivo({...efectivo, moneda: e.target.value})}>
                    <option value="ARS">$ ARS</option>
                    <option value="USD">U$S USD</option>
                    <option value="EUR">€ EUR</option>
                  </select>
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Descripción <span style={{color:'#c0392b'}}>*</span></label>
                <input style={styles.input} type="text" value={efectivo.nombre}
                  onChange={e => setEfectivo({...efectivo, nombre: e.target.value})}
                  placeholder="Ej: Almuerzo, taxi, mercado..." required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Monto <span style={{color:'#c0392b'}}>*</span></label>
                <input style={styles.input} type="number" step="0.01" value={efectivo.monto}
                  onChange={e => setEfectivo({...efectivo, monto: e.target.value})}
                  placeholder="0.00" required />
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
                <div style={styles.field}>
                  <label style={styles.label}>Categoría <span style={{fontSize:'11px', color:'#8e8e93'}}>(opcional)</span></label>
                  <select style={styles.input} value={efectivo.categoria}
                    onChange={e => setEfectivo({...efectivo, categoria: e.target.value, subcategoria: ''})}>
                    <option value="">— Elegir —</option>
                    {categoriasDB.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Subcategoría <span style={{fontSize:'11px', color:'#8e8e93'}}>(opcional)</span></label>
                  <select style={styles.input} value={efectivo.subcategoria}
                    onChange={e => setEfectivo({...efectivo, subcategoria: e.target.value})}
                    disabled={!efectivo.categoria}>
                    <option value="">— Elegir —</option>
                    {subcategoriasDB
                      .filter(s => s.category_id === categoriasDB.find(c => c.nombre === efectivo.categoria)?.id)
                      .map(s => <option key={s.id} value={s.nombre}>{s.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Nota <span style={{fontSize:'11px', color:'#8e8e93'}}>(opcional)</span></label>
                <input style={styles.input} type="text" value={efectivo.nota}
                  onChange={e => setEfectivo({...efectivo, nota: e.target.value})}
                  placeholder="Detalles adicionales..." />
              </div>
              <div style={styles.modalButtons}>
                <button type="button" style={styles.cancelBtn} onClick={() => setShowEfectivo(false)}>Cancelar</button>
                <button type="submit" style={styles.saveBtn} disabled={loading}>
                  {loading ? 'Guardando...' : 'Guardar gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#E4E7F3', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  header: {
    backgroundColor: '#E4E7F3',
    padding: '24px 32px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImg: { height: '220px', objectFit: 'contain' },
  layout: {
    display: 'flex',
    alignItems: 'flex-start',
    maxWidth: '1280px',
    margin: '0 auto',
    padding: '0 24px 48px 24px',
    gap: '24px',
  },
  sidebar: {
    width: '240px',
    flexShrink: 0,
    backgroundColor: 'white',
    borderRadius: '16px',
    padding: '24px 16px',
    boxShadow: '0 2px 12px rgba(107,123,184,0.10)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    position: 'sticky',
    top: '24px',
  },
  sidebarHeader: { marginBottom: '8px', textAlign: 'center' },
  sidebarTitle: { fontSize: '16px', fontWeight: '700', color: '#1d1d1f', margin: 0, textAlign: 'center', letterSpacing: '0.1em' },
  sidebarBtnPrimary: {
    width: '100%', padding: '10px', backgroundColor: '#6B7BB8', color: 'white',
    border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', textAlign: 'center', outline: 'none'
  },
  sidebarBtnSecondary: {
    width: '100%', padding: '10px', backgroundColor: 'white', color: '#6B7BB8',
    border: '2px solid #6B7BB8', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', textAlign: 'center', outline: 'none'
  },
  accountsList: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' },
  emptyText: { fontSize: '13px', color: '#6e6e73', textAlign: 'center', padding: '16px 0' },
  accountCard: {
    backgroundColor: '#E4E7F3', borderRadius: '12px', padding: '14px',
    border: '1px solid #d0d5ee', cursor: 'pointer', transition: 'all 0.2s'
  },
  accountCardSelected: { border: '2px solid #6B7BB8', backgroundColor: '#dde1f3' },
  accountCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  accountType: { fontSize: '11px', color: '#6e6e73', margin: 0, fontWeight: '500' },
  accountName: { fontSize: '16px', fontWeight: '700', color: '#1d1d1f', margin: 0 },
  accountActions: { display: 'flex', gap: '2px' },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px', opacity: 0.7, outline: 'none' },
  sidebarFooter: { marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid #eef0f8' },
  logoutBtn: {
    width: '100%', padding: '9px', backgroundColor: 'transparent', color: '#6B7BB8',
    border: '1.5px solid #6B7BB8', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', outline: 'none'
  },
  mainContent: { flex: 1, minWidth: 0 },
  section: { backgroundColor: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(107,123,184,0.10)' },
  sectionTitle: { fontSize: '18px', fontWeight: '700', color: '#1d1d1f', margin: '0 0 24px 0' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', color: '#6e6e73' },
  emptyStateIcon: { fontSize: '48px', margin: '0 0 12px 0' },
  emptyStateText: { fontSize: '15px', color: '#6e6e73', fontWeight: '500' },
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { backgroundColor: 'white', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '520px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', maxHeight: '90vh', overflowY: 'auto' },
  modalTitle: { fontSize: '20px', fontWeight: '700', color: '#1d1d1f', margin: '0 0 24px 0' },
  field: { marginBottom: '16px' },
  label: { display: 'block', fontSize: '14px', fontWeight: '500', color: '#444', marginBottom: '6px' },
  input: { width: '100%', padding: '11px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '14px', outline: 'none', boxSizing: 'border-box' },
  dropzone: { border: '2px dashed #e0e0e0', borderRadius: '12px', padding: '40px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', backgroundColor: '#fafafa', marginBottom: '16px' },
  dropzoneActive: { borderColor: '#6B7BB8', backgroundColor: '#eef0f8' },
  dropzoneDone: { borderColor: '#27AE60', backgroundColor: '#f0faf5' },
  dropzoneIcon: { fontSize: '32px', margin: '0 0 8px 0' },
  dropzoneText: { fontSize: '14px', color: '#444', margin: '0 0 4px 0', fontWeight: '500' },
  dropzoneHint: { fontSize: '12px', color: '#aaa', margin: 0 },
  modalButtons: { display: 'flex', gap: '12px', marginTop: '24px' },
  cancelBtn: { flex: 1, padding: '12px', backgroundColor: 'white', color: '#6B7BB8', border: '2px solid #6B7BB8', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', outline: 'none' },
  saveBtn: { flex: 1, padding: '12px', backgroundColor: '#6B7BB8', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', outline: 'none' },
  selectAccountBtn: { width: '100%', padding: '14px 16px', backgroundColor: 'white', color: '#2d2d2d', border: '2px solid #d0d5ee', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: '600', textAlign: 'left' },
  selectAccountBtnNew: { borderStyle: 'dashed', color: '#6B7BB8', fontWeight: '500', fontSize: '14px' },
  processingContainer: { textAlign: 'center', padding: '20px 0' },
  processingIcon: { fontSize: '52px', margin: '0 0 16px 0', display: 'block' },
  processingTitle: { fontSize: '20px', fontWeight: 'bold', color: '#2d2d2d', margin: '0 0 8px 0' },
  processingText: { fontSize: '14px', color: '#888', margin: '0 0 24px 0' },
  processingDots: { display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '24px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#d0d5ee' },
  dotActive: { backgroundColor: '#6B7BB8' },
  timerBar: { width: '100%', height: '4px', backgroundColor: '#e8e8f0', borderRadius: '2px', marginBottom: '8px', overflow: 'hidden' },
  timerFill: { height: '100%', borderRadius: '2px', transition: 'width 1s linear, background-color 0.3s' },
  timerText: { fontSize: '12px', color: '#8e8e93', margin: 0 },
  stepSubtitle: { fontSize: '14px', color: '#666', marginBottom: '16px' },
  adicionalesList: { marginBottom: '20px' },
  adicionalItem: { padding: '10px 14px', backgroundColor: '#eef0f8', borderRadius: '8px', marginBottom: '8px', fontSize: '14px', color: '#4a5a9a', fontWeight: '500' },
  stepQuestion: { fontSize: '15px', fontWeight: '600', color: '#2d2d2d', marginBottom: '16px' },
  opcionesGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  opcionBtn: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px', border: '2px solid #e0e0e0', borderRadius: '12px', backgroundColor: 'white', cursor: 'pointer', gap: '4px' },
  opcionIcon: { fontSize: '28px' },
  opcionTitle: { fontSize: '14px', fontWeight: '600', color: '#2d2d2d' },
  opcionDesc: { fontSize: '12px', color: '#888' },
  previewStats: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' },
  previewStat: { backgroundColor: '#E4E7F3', borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px' },
  previewStatLabel: { fontSize: '11px', color: '#888', textTransform: 'uppercase' },
  previewStatValue: { fontSize: '15px', fontWeight: '600', color: '#2d2d2d' },
  transactionsList: { maxHeight: '300px', overflowY: 'auto', marginBottom: '16px' },
  transactionItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' },
  transactionLeft: { flex: 1, paddingRight: '12px' },
  transactionName: { fontSize: '14px', fontWeight: '500', color: '#2d2d2d', margin: '0 0 2px 0' },
  transactionDetail: { fontSize: '12px', color: '#aaa', margin: 0 },
  transactionMonto: { fontSize: '14px', fontWeight: '600', whiteSpace: 'nowrap' },
  moreTransactions: { fontSize: '13px', color: '#6B7BB8', textAlign: 'center', padding: '8px 0' },
  warningBox: { backgroundColor: '#fff8e1', border: '1px solid #ffe082', borderRadius: '10px', padding: '12px', fontSize: '13px', color: '#856404', marginBottom: '16px' },
  // Paso identificar
  identificarCard: {
    backgroundColor: '#f5f6fb', borderRadius: '12px', padding: '16px 20px',
    marginBottom: '20px', border: '1px solid #e0e4f0'
  },
  identificarDetalle: {
    fontSize: '13px', fontFamily: 'monospace', color: '#4a5a9a',
    margin: 0, wordBreak: 'break-all'
  },
  // Paso contexto
  contextoCard: { textAlign: 'center', paddingTop: '8px' },
  contextoIcon: { fontSize: '48px', margin: '0 0 16px 0' },
}