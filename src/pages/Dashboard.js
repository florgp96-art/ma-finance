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

const SERVICIOS = [
  { nombre: 'Edenor', link: 'https://autogestion.edenor.com.ar', usuario: '' },
  { nombre: 'Metrogas', link: 'https://www.metrogas.com.ar', usuario: '' },
  { nombre: 'Telecentro', link: 'https://www.telecentro.com.ar', usuario: '' },
]

const parseFechaArgentina = (fecha) => {
  if (!fecha) return null
  const parts = fecha.split('/')
  if (parts.length !== 3) return fecha
  const year = parts[2].length === 2 ? '20' + parts[2] : parts[2]
  return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
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

  // Contexto detectado
  const [contextoDetectado, setContextoDetectado] = useState([])
  const [contextoIdx, setContextoIdx] = useState(0)

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

  // Widget ahorro
  const [ahorro, setAhorro] = useState({ monto: '', moneda: 'USD', anos: '', tasa: '' })

  // Categorías
  const [showCategorias, setShowCategorias] = useState(false)
  const [newCatNombre, setNewCatNombre] = useState('')
  const [editingCat, setEditingCat] = useState(null)
  const [editingCatNombre, setEditingCatNombre] = useState('')
  const [newSubcatCatId, setNewSubcatCatId] = useState(null)
  const [newSubcatNombre, setNewSubcatNombre] = useState('')

  // Tipo de cambio
  const [tipoCambio, setTipoCambio] = useState(() => localStorage.getItem('tc_ma') || '')

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkmode_ma') === 'true')
  const [dashboardTab, setDashboardTab] = useState('resumen')
  const [vencimientosList, setVencimientosList] = useState([])
  const [loadingVenc, setLoadingVenc] = useState(false)

  useEffect(() => { fetchAccounts(); fetchCategorias() }, [])

  useEffect(() => {
    if (dashboardTab === 'vencimientos' && selectedAccount === 'all') {
      fetchVencimientos()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardTab, selectedAccount])

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

  const handleAddCategoria = async (e) => {
    e.preventDefault()
    if (!newCatNombre.trim()) return
    await supabase.from('categories').insert({ nombre: newCatNombre.trim(), orden: categoriasDB.length + 1 })
    setNewCatNombre('')
    fetchCategorias()
  }

  const handleSaveEditCat = async (cat) => {
    if (!editingCatNombre.trim()) return
    await supabase.from('categories').update({ nombre: editingCatNombre.trim() }).eq('id', cat.id)
    setEditingCat(null)
    fetchCategorias()
  }

  const handleAddSubcat = async (e) => {
    e.preventDefault()
    if (!newSubcatNombre.trim() || !newSubcatCatId) return
    await supabase.from('subcategories').insert({ nombre: newSubcatNombre.trim(), category_id: newSubcatCatId })
    setNewSubcatNombre('')
    setNewSubcatCatId(null)
    fetchCategorias()
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

  const fetchVencimientos = async () => {
    setLoadingVenc(true)
    const { data: { user } } = await supabase.auth.getUser()
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('statements')
      .select('id, periodo, fecha_vencimiento, total_resumen, accounts(nombre)')
      .eq('user_id', user.id)
      .not('fecha_vencimiento', 'is', null)
      .gte('fecha_vencimiento', today)
      .order('fecha_vencimiento', { ascending: true })
    setVencimientosList(data || [])
    setLoadingVenc(false)
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
    setContextoDetectado([])
    setContextoIdx(0)
  }

  const analyzeImageWithClaude = async (file, userRules) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(',')[1]
          const mediaType = file.type || 'image/jpeg'
          const response = await fetch('/api/analyzeImage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64, mediaType, cardName: 'auto', userRules: userRules || [] })
          })
          if (!response.ok) throw new Error(`Error servidor: ${response.status}`)
          const data = await response.json()
          const textBlock = data?.content?.find(b => b.type === 'text')
          if (!textBlock?.text) throw new Error('Sin respuesta de Claude')
          const clean = textBlock.text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '').trim()
          resolve(JSON.parse(clean))
        } catch (err) { reject(err) }
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const handleUploadPDF = async () => {
    if (!archivo) return
    setStep('processing')
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: rules } = await supabase.from('user_rules').select('*').eq('user_id', user.id)

      const isImage = archivo.type.startsWith('image/')
      let result
      if (isImage) {
        result = await analyzeImageWithClaude(archivo, rules || [])
      } else {
        const pdfText = await extractTextFromPDF(archivo)
        result = await analyzeStatementWithClaude(pdfText, 'auto', rules || [])
      }
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
        fecha_hasta: statementData.fecha_facturacion,
        fecha_vencimiento: parseFechaArgentina(statementData.fecha_vencimiento),
        total_resumen: statementData.total_pesos, estado: 'completo'
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
    if (file && (file.type === 'application/pdf' || file.type.startsWith('image/'))) setArchivo(file)
    else alert('Solo se aceptan archivos PDF o imágenes (PNG, JPG)')
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

  const styles = getStyles(darkMode)
  const txActual = txSinIdentificar[txIdentificarIdx]
  const contextoActual = contextoDetectado[contextoIdx]

  return (
    <>
      <div style={styles.container}>

        <div style={styles.header}>
          <img src={logo} alt="Moms Assist Finance" style={styles.logoImg} />
          <button
            onClick={() => { const next = !darkMode; setDarkMode(next); localStorage.setItem('darkmode_ma', next) }}
            title={darkMode ? 'Modo claro' : 'Modo oscuro'}
            style={{ position: 'absolute', top: '20px', right: '32px', background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', opacity: 0.7 }}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
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
            <button style={styles.sidebarBtnSecondary} onClick={() => setShowCategorias(true)}>
              + CATEGORÍAS
            </button>

            {/* Tipo de cambio */}
            <div style={{ borderTop: '1px solid #EDE8EC', paddingTop: '12px', marginTop: '4px' }}>
              <label style={{ fontSize: '11px', color: '#6e6e73', display: 'block', marginBottom: '4px', letterSpacing: '0.04em' }}>
                U$S 1 = $
              </label>
              <input
                type="number"
                style={{ width: '100%', padding: '7px 10px', borderRadius: '8px', border: '1px solid #E2DDE0', fontSize: '13px', outline: 'none', boxSizing: 'border-box', backgroundColor: '#fafafa', color: '#1d1d1f', fontFamily: '"Montserrat", sans-serif' }}
                placeholder="ej. 1250"
                value={tipoCambio}
                onChange={e => { setTipoCambio(e.target.value); localStorage.setItem('tc_ma', e.target.value) }}
              />
            </div>

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
                {/* Tabs */}
                <div style={{ display: 'flex', marginBottom: '24px', borderBottom: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}` }}>
                  {[
                    { key: 'resumen', label: '📊 Resumen General' },
                    { key: 'vencimientos', label: '📅 Vencimientos' },
                  ].map(tab => (
                    <button key={tab.key}
                      onClick={() => setDashboardTab(tab.key)}
                      style={{
                        padding: '10px 22px', border: 'none', background: 'none', cursor: 'pointer',
                        fontSize: '14px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif',
                        color: dashboardTab === tab.key ? '#5C4F5C' : '#6e6e73',
                        borderBottom: dashboardTab === tab.key ? '2px solid #5C4F5C' : '2px solid transparent',
                        marginBottom: '-2px', outline: 'none', transition: 'color 0.15s'
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {dashboardTab === 'resumen' && (
                  <AccountDetail accounts={accounts} allAccounts refreshKey={refreshKey} searchQuery={searchQuery} onSearchChange={setSearchQuery} tipoCambio={tipoCambio} darkMode={darkMode} />
                )}

                {dashboardTab === 'vencimientos' && (
                  <div>
                    <div style={{ marginBottom: '32px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: '500', color: darkMode ? '#F0EDEC' : '#1d1d1f', margin: '0 0 16px 0' }}>
                        💳 Próximos vencimientos de tarjetas
                      </h3>
                      {loadingVenc ? (
                        <p style={{ color: '#aaa', fontSize: '14px' }}>Cargando...</p>
                      ) : vencimientosList.length === 0 ? (
                        <p style={{ color: '#aaa', fontSize: '14px' }}>No hay vencimientos próximos. Los vencimientos se guardan automáticamente al cargar un PDF.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {vencimientosList.map(s => {
                            const fecha = s.fecha_vencimiento ? new Date(s.fecha_vencimiento + 'T00:00:00') : null
                            const diasRestantes = fecha ? Math.ceil((fecha - new Date()) / (1000 * 60 * 60 * 24)) : null
                            return (
                              <div key={s.id} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '14px 18px', borderRadius: '12px',
                                backgroundColor: darkMode ? '#2A272A' : '#F0EDEC',
                                border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`,
                              }}>
                                <div>
                                  <p style={{ margin: 0, fontWeight: '500', fontSize: '15px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                                    💳 {s.accounts?.nombre || '—'}
                                  </p>
                                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6e6e73' }}>
                                    {s.periodo} · Vence: {s.fecha_vencimiento}
                                  </p>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  {s.total_resumen > 0 && (
                                    <p style={{ margin: 0, fontWeight: '600', fontSize: '16px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>
                                      $ {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0 }).format(s.total_resumen)}
                                    </p>
                                  )}
                                  {diasRestantes !== null && (
                                    <p style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: '500', color: diasRestantes <= 3 ? '#e74c3c' : diasRestantes <= 7 ? '#e07b39' : '#4a9e7a' }}>
                                      {diasRestantes === 0 ? '¡Vence hoy!' : diasRestantes === 1 ? 'Mañana' : `En ${diasRestantes} días`}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: '500', color: darkMode ? '#F0EDEC' : '#1d1d1f', margin: '0 0 16px 0' }}>
                        🔌 Servicios
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {SERVICIOS.map((s, i) => (
                          <div key={i} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '14px 18px', borderRadius: '12px',
                            backgroundColor: darkMode ? '#2A272A' : '#F0EDEC',
                            border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`,
                          }}>
                            <div>
                              <p style={{ margin: 0, fontWeight: '500', fontSize: '15px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{s.nombre}</p>
                              {s.usuario && <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6e6e73' }}>👤 {s.usuario}</p>}
                            </div>
                            {s.link && (
                              <a href={s.link} target="_blank" rel="noopener noreferrer" style={{
                                padding: '8px 16px', borderRadius: '8px', backgroundColor: '#5C4F5C', color: 'white',
                                fontSize: '13px', fontWeight: '500', textDecoration: 'none', fontFamily: '"Montserrat", sans-serif'
                              }}>
                                Pagar →
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : selectedAccount ? (
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>📊 {selectedAccount.nombre}</h2>
                <AccountDetail account={selectedAccount} refreshKey={refreshKey} searchQuery={searchQuery} onSearchChange={setSearchQuery} tipoCambio={tipoCambio} darkMode={darkMode} />
              </div>
            ) : (
              <div style={styles.emptyState}>
                <p style={styles.emptyStateIcon}>💳</p>
                <p style={styles.emptyStateText}>Seleccioná una cuenta para ver sus movimientos</p>
              </div>
            )}
          </div>

          {/* Widget ahorro */}
          <div style={styles.savingsPanel}>
            <h3 style={styles.savingsPanelTitle}>Proyección de ahorro</h3>

            <div style={styles.savingsField}>
              <label style={styles.savingsLabel}>Monto mensual</label>
              <input style={styles.savingsInput} type="number" min="0" placeholder="500"
                value={ahorro.monto} onChange={e => setAhorro({...ahorro, monto: e.target.value})} />
            </div>

            <div style={styles.savingsField}>
              <label style={styles.savingsLabel}>Moneda</label>
              <select style={styles.savingsInput} value={ahorro.moneda} onChange={e => setAhorro({...ahorro, moneda: e.target.value})}>
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
            </div>

            <div style={styles.savingsField}>
              <label style={styles.savingsLabel}>Cantidad de años</label>
              <input style={styles.savingsInput} type="number" min="1" max="50" placeholder="5"
                value={ahorro.anos} onChange={e => setAhorro({...ahorro, anos: e.target.value})} />
            </div>

            <div style={styles.savingsField}>
              <label style={styles.savingsLabel}>Tasa anual % <span style={{fontWeight:400, color:'#aaa'}}>(opcional)</span></label>
              <input style={styles.savingsInput} type="number" min="0" step="0.1" placeholder="Sin tasa = cálculo simple"
                value={ahorro.tasa} onChange={e => setAhorro({...ahorro, tasa: e.target.value})} />
            </div>

            {(() => {
              const monto = parseFloat(ahorro.monto)
              const anos = parseFloat(ahorro.anos)
              if (!monto || !anos || monto <= 0 || anos <= 0) return (
                <p style={styles.savingsHint}>Completá los campos para ver tu proyección</p>
              )
              let total
              const tasa = parseFloat(ahorro.tasa)
              if (tasa && tasa > 0) {
                const r = tasa / 100 / 12
                const n = anos * 12
                total = monto * ((Math.pow(1 + r, n) - 1) / r)
              } else {
                total = monto * 12 * anos
              }
              const anioFin = new Date().getFullYear() + Math.floor(anos)
              const simbolo = ahorro.moneda === 'USD' ? 'U$S' : '$'
              const totalFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(total))
              const tc = parseFloat(tipoCambio)
              const equivalente = tc > 0
                ? ahorro.moneda === 'USD'
                  ? `≈ $ ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(total * tc))} ARS`
                  : `≈ U$S ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(total / tc))}`
                : null
              return (
                <div style={styles.savingsResult}>
                  <p style={styles.savingsResultLabel}>Tu proyección</p>
                  <p style={styles.savingsResultPhrase}>Para {anioFin} tendrías</p>
                  <p style={styles.savingsResultAmount}>{simbolo} {totalFmt}</p>
                  {equivalente && <p style={styles.savingsResultNote}>{equivalente}</p>}
                  {tasa > 0 && <p style={styles.savingsResultNote}>interés compuesto mensual</p>}
                </div>
              )
            })()}
          </div>

        </div>
      </div>

      {/* Modales */}
      {/* Modal categorías */}
      {showCategorias && (
        <div style={styles.overlay}>
          <div style={{ ...styles.modal, maxWidth: '520px' }}>
            <h3 style={styles.modalTitle}>Categorías y subcategorías</h3>
            <div style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '20px' }}>
              {categoriasDB.map(cat => (
                <div key={cat.id} style={{ marginBottom: '16px', borderBottom: '1px solid #EDE8EC', paddingBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    {editingCat === cat.id ? (
                      <>
                        <input
                          style={{ ...styles.input, flex: 1, padding: '6px 10px', fontSize: '13px' }}
                          value={editingCatNombre}
                          onChange={e => setEditingCatNombre(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleSaveEditCat(cat)}
                          autoFocus
                        />
                        <button style={{ ...styles.saveBtn, flex: 'none', padding: '6px 12px', fontSize: '12px' }} onClick={() => handleSaveEditCat(cat)}>✓</button>
                        <button style={{ ...styles.cancelBtn, flex: 'none', padding: '6px 12px', fontSize: '12px' }} onClick={() => setEditingCat(null)}>✕</button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontWeight: '500', fontSize: '14px', flex: 1 }}>{cat.nombre}</span>
                        <button style={styles.actionBtn} onClick={() => { setEditingCat(cat.id); setEditingCatNombre(cat.nombre) }}>✏️</button>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginLeft: '4px' }}>
                    {subcategoriasDB.filter(s => s.category_id === cat.id).map(s => (
                      <span key={s.id} style={{ fontSize: '12px', backgroundColor: '#EDE8EC', borderRadius: '6px', padding: '2px 8px', color: '#5C4F5C' }}>{s.nombre}</span>
                    ))}
                    {newSubcatCatId === cat.id ? (
                      <form onSubmit={handleAddSubcat} style={{ display: 'flex', gap: '4px' }}>
                        <input
                          style={{ ...styles.input, padding: '3px 8px', fontSize: '12px', width: '120px' }}
                          placeholder="Nueva subcategoría"
                          value={newSubcatNombre}
                          onChange={e => setNewSubcatNombre(e.target.value)}
                          autoFocus
                        />
                        <button type="submit" style={{ ...styles.saveBtn, flex: 'none', padding: '3px 10px', fontSize: '12px' }}>+</button>
                        <button type="button" style={{ ...styles.cancelBtn, flex: 'none', padding: '3px 8px', fontSize: '12px' }} onClick={() => setNewSubcatCatId(null)}>✕</button>
                      </form>
                    ) : (
                      <button
                        onClick={() => { setNewSubcatCatId(cat.id); setNewSubcatNombre('') }}
                        style={{ fontSize: '11px', color: '#5C4F5C', background: 'none', border: '1px dashed #5C4F5C', borderRadius: '6px', padding: '2px 8px', cursor: 'pointer' }}
                      >+ sub</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={handleAddCategoria} style={{ display: 'flex', gap: '8px' }}>
              <input
                style={{ ...styles.input, flex: 1 }}
                placeholder="Nueva categoría"
                value={newCatNombre}
                onChange={e => setNewCatNombre(e.target.value)}
              />
              <button type="submit" style={{ ...styles.saveBtn, flex: 'none', padding: '12px 20px' }}>Agregar</button>
            </form>
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button style={styles.cancelBtn} onClick={() => { setShowCategorias(false); setEditingCat(null); setNewSubcatCatId(null) }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

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
                    <><p style={styles.dropzoneIcon}>📄</p><p style={styles.dropzoneText}>Arrastrá el PDF o imagen acá, o clickeá para seleccionar</p><p style={styles.dropzoneHint}>PDF, PNG, JPG · Máx. 10MB</p></>
                  )}
                </div>
                <input id="uploadInput" type="file" accept=".pdf,.png,.jpg,.jpeg" style={{display:'none'}}
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
                  <div style={{...styles.timerFill, width: `${(timer / 120) * 100}%`, backgroundColor: timer < 20 ? '#e07b39' : '#5C4F5C'}} />
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
                    backgroundColor: '#5C4F5C',
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

const getStyles = (dark) => {
  const p = dark ? '#8C7B8C' : '#5C4F5C'
  const bg = dark ? '#1C1A1C' : '#F0EDEC'
  const panel = dark ? '#2A272A' : 'white'
  const txt = dark ? '#F0EDEC' : '#1d1d1f'
  const muted = dark ? '#9A8A9A' : '#6e6e73'
  const border = dark ? '#3A333A' : '#E2DDE0'
  const cardBg = dark ? '#1A181A' : '#F0EDEC'
  const inputBg = dark ? '#1C1A1C' : '#fafafa'
  const shadow = dark ? '0 2px 12px rgba(0,0,0,0.35)' : '0 2px 12px rgba(92,79,92,0.08)'
  return {
    container: { minHeight: '100vh', backgroundColor: bg, fontFamily: '"Montserrat", sans-serif' },
    header: { backgroundColor: bg, padding: '24px 32px', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' },
    logoImg: { height: '220px', objectFit: 'contain' },
    layout: { display: 'flex', alignItems: 'flex-start', padding: '0 32px 48px 32px', gap: '24px' },
    sidebar: {
      width: '240px', flexShrink: 0, backgroundColor: panel, borderRadius: '16px',
      padding: '24px 16px', boxShadow: shadow, display: 'flex', flexDirection: 'column',
      gap: '10px', position: 'sticky', top: '24px',
    },
    sidebarHeader: { marginBottom: '8px', textAlign: 'center' },
    sidebarTitle: { fontSize: '16px', fontWeight: '400', color: txt, margin: 0, textAlign: 'center', letterSpacing: '0.08em' },
    sidebarBtnPrimary: {
      width: '100%', padding: '10px', backgroundColor: p, color: 'white',
      border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '500', textAlign: 'center', outline: 'none'
    },
    sidebarBtnSecondary: {
      width: '100%', padding: '10px', backgroundColor: 'transparent', color: p,
      border: `2px solid ${p}`, borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '500', textAlign: 'center', outline: 'none'
    },
    accountsList: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' },
    emptyText: { fontSize: '13px', color: muted, textAlign: 'center', padding: '16px 0' },
    accountCard: { backgroundColor: cardBg, borderRadius: '12px', padding: '14px', border: `1px solid ${border}`, cursor: 'pointer', transition: 'all 0.2s' },
    accountCardSelected: { border: `2px solid ${p}`, backgroundColor: dark ? '#2A202A' : '#EDE8EC' },
    accountCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
    accountType: { fontSize: '11px', color: muted, margin: 0, fontWeight: '400' },
    accountName: { fontSize: '16px', fontWeight: '500', color: txt, margin: 0 },
    accountActions: { display: 'flex', gap: '2px' },
    actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px', opacity: 0.7, outline: 'none' },
    sidebarFooter: { marginTop: 'auto', paddingTop: '16px', borderTop: `1px solid ${border}` },
    logoutBtn: {
      width: '100%', padding: '9px', backgroundColor: 'transparent', color: p,
      border: `1.5px solid ${p}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500', outline: 'none'
    },
    mainContent: { flex: 1, minWidth: 0 },
    section: { backgroundColor: panel, borderRadius: '16px', padding: '24px', boxShadow: shadow },
    sectionTitle: { fontSize: '18px', fontWeight: '500', color: txt, margin: '0 0 24px 0' },
    emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', color: muted },
    emptyStateIcon: { fontSize: '48px', margin: '0 0 12px 0' },
    emptyStateText: { fontSize: '15px', color: muted, fontWeight: '500' },
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modal: { backgroundColor: panel, borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '520px', boxShadow: '0 8px 32px rgba(0,0,0,0.20)', maxHeight: '90vh', overflowY: 'auto' },
    modalTitle: { fontSize: '20px', fontWeight: '500', color: txt, margin: '0 0 24px 0' },
    field: { marginBottom: '16px' },
    label: { display: 'block', fontSize: '14px', fontWeight: '400', color: dark ? '#C0B0C0' : '#444', marginBottom: '6px' },
    input: { width: '100%', padding: '11px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '14px', outline: 'none', boxSizing: 'border-box', backgroundColor: inputBg, color: txt },
    dropzone: { border: `2px dashed ${border}`, borderRadius: '12px', padding: '40px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', backgroundColor: inputBg, marginBottom: '16px' },
    dropzoneActive: { borderColor: p, backgroundColor: dark ? '#2A202A' : '#EDE8EC' },
    dropzoneDone: { borderColor: '#27AE60', backgroundColor: dark ? '#1A2A1A' : '#f0faf5' },
    dropzoneIcon: { fontSize: '32px', margin: '0 0 8px 0' },
    dropzoneText: { fontSize: '14px', color: dark ? '#C0B0C0' : '#444', margin: '0 0 4px 0', fontWeight: '500' },
    dropzoneHint: { fontSize: '12px', color: muted, margin: 0 },
    modalButtons: { display: 'flex', gap: '12px', marginTop: '24px' },
    cancelBtn: { flex: 1, padding: '12px', backgroundColor: 'transparent', color: p, border: `2px solid ${p}`, borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', outline: 'none' },
    saveBtn: { flex: 1, padding: '12px', backgroundColor: p, color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', outline: 'none' },
    selectAccountBtn: { width: '100%', padding: '14px 16px', backgroundColor: panel, color: txt, border: `2px solid ${border}`, borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: '500', textAlign: 'left' },
    selectAccountBtnNew: { borderStyle: 'dashed', color: p, fontWeight: '500', fontSize: '14px' },
    processingContainer: { textAlign: 'center', padding: '20px 0' },
    processingIcon: { fontSize: '52px', margin: '0 0 16px 0', display: 'block' },
    processingTitle: { fontSize: '20px', fontWeight: '500', color: txt, margin: '0 0 8px 0' },
    processingText: { fontSize: '14px', color: muted, margin: '0 0 24px 0' },
    processingDots: { display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '24px' },
    dot: { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: border },
    dotActive: { backgroundColor: p },
    timerBar: { width: '100%', height: '4px', backgroundColor: dark ? '#3A333A' : '#e8e8f0', borderRadius: '2px', marginBottom: '8px', overflow: 'hidden' },
    timerFill: { height: '100%', borderRadius: '2px', transition: 'width 1s linear, background-color 0.3s' },
    timerText: { fontSize: '12px', color: muted, margin: 0 },
    stepSubtitle: { fontSize: '14px', color: muted, marginBottom: '16px' },
    adicionalesList: { marginBottom: '20px' },
    adicionalItem: { padding: '10px 14px', backgroundColor: dark ? '#2A202A' : '#EDE8EC', borderRadius: '8px', marginBottom: '8px', fontSize: '14px', color: p, fontWeight: '500' },
    stepQuestion: { fontSize: '15px', fontWeight: '500', color: txt, marginBottom: '16px' },
    opcionesGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
    opcionBtn: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px', border: `2px solid ${border}`, borderRadius: '12px', backgroundColor: panel, cursor: 'pointer', gap: '4px' },
    opcionIcon: { fontSize: '28px' },
    opcionTitle: { fontSize: '14px', fontWeight: '500', color: txt },
    opcionDesc: { fontSize: '12px', color: muted },
    previewStats: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' },
    previewStat: { backgroundColor: cardBg, borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '4px' },
    previewStatLabel: { fontSize: '11px', color: muted, textTransform: 'uppercase' },
    previewStatValue: { fontSize: '15px', fontWeight: '500', color: txt },
    transactionsList: { maxHeight: '300px', overflowY: 'auto', marginBottom: '16px' },
    transactionItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${border}` },
    transactionLeft: { flex: 1, paddingRight: '12px' },
    transactionName: { fontSize: '14px', fontWeight: '500', color: txt, margin: '0 0 2px 0' },
    transactionDetail: { fontSize: '12px', color: muted, margin: 0 },
    transactionMonto: { fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap' },
    moreTransactions: { fontSize: '13px', color: p, textAlign: 'center', padding: '8px 0' },
    warningBox: { backgroundColor: dark ? '#2A2010' : '#fff8e1', border: `1px solid ${dark ? '#4A3A10' : '#ffe082'}`, borderRadius: '10px', padding: '12px', fontSize: '13px', color: dark ? '#D0A840' : '#856404', marginBottom: '16px' },
    identificarCard: { backgroundColor: cardBg, borderRadius: '12px', padding: '16px 20px', marginBottom: '20px', border: `1px solid ${border}` },
    identificarDetalle: { fontSize: '13px', fontFamily: 'monospace', color: p, margin: 0, wordBreak: 'break-all' },
    contextoCard: { textAlign: 'center', paddingTop: '8px' },
    contextoIcon: { fontSize: '48px', margin: '0 0 16px 0' },
    savingsPanel: {
      width: '220px', flexShrink: 0, backgroundColor: panel, borderRadius: '16px',
      padding: '20px 16px', boxShadow: shadow, display: 'flex', flexDirection: 'column',
      gap: '0px', position: 'sticky', top: '24px', alignSelf: 'flex-start',
    },
    savingsPanelTitle: { fontSize: '14px', fontWeight: '400', color: txt, margin: '0 0 16px 0', letterSpacing: '0.08em', textTransform: 'uppercase' },
    savingsField: { marginBottom: '12px' },
    savingsLabel: { display: 'block', fontSize: '12px', fontWeight: '400', color: muted, marginBottom: '4px' },
    savingsInput: { width: '100%', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', outline: 'none', boxSizing: 'border-box', color: txt, backgroundColor: inputBg },
    savingsHint: { fontSize: '12px', color: muted, textAlign: 'center', marginTop: '8px', lineHeight: '1.5' },
    savingsResult: { marginTop: '16px', backgroundColor: cardBg, borderRadius: '12px', padding: '16px', textAlign: 'center' },
    savingsResultLabel: { fontSize: '10px', fontWeight: '500', color: p, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px 0' },
    savingsResultPhrase: { fontSize: '13px', color: muted, margin: '0 0 4px 0', fontWeight: '500' },
    savingsResultAmount: { fontSize: '22px', fontWeight: '800', color: txt, margin: '0 0 4px 0', letterSpacing: '-0.02em' },
    savingsResultNote: { fontSize: '11px', color: p, margin: 0, fontStyle: 'italic' },
  }
}