import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { extractTextFromPDF, analyzeStatementWithClaude } from '../lib/pdfReader'
import AccountDetail, { getLast6Months, mesLabel, formatMontoFull } from '../components/AccountDetail'
import HijoDetail from '../components/HijoDetail'
import * as XLSX from 'xlsx'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
const logo = process.env.PUBLIC_URL + '/logo.png'

const PROCESSING_MSGS = [
  { icon: '📄', title: 'Leyendo el extracto...', desc: 'Procesando las páginas del PDF' },
  { icon: '🔍', title: 'Identificando transacciones...', desc: 'Encontrando cada compra y pago' },
  { icon: '🏷️', title: 'Clasificando gastos...', desc: 'Asignando categorías automáticamente' },
  { icon: '✨', title: 'Casi listo...', desc: 'Preparando el resumen final' },
]

const EXCEL_PROCESSING_MSGS = [
  { icon: '📊', title: 'Leyendo el archivo...', desc: 'Procesando las filas del Excel' },
  { icon: '🤖', title: 'Clasificando con IA...', desc: 'Analizando gastos y montos' },
  { icon: '🏷️', title: 'Asignando categorías...', desc: 'Identificando cada transacción' },
  { icon: '✨', title: 'Casi listo...', desc: 'Preparando la vista previa' },
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


const SERVICIOS_DEFAULT = [{ id: 'luz_default', nombre: 'Luz', link: '' }]

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
  const [hoveredAccount, setHoveredAccount] = useState(null)

  const [archivo, setArchivo] = useState(null)
  const [toast, setToast] = useState(null)
  const [miniChartData, setMiniChartData] = useState([])
  const [servicios, setServicios] = useState(SERVICIOS_DEFAULT)
  const [newServicio, setNewServicio] = useState({ nombre: '', link: '', vencimiento: '' })
  const [showAddServicio, setShowAddServicio] = useState(false)
  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }
  const [showUpload, setShowUpload] = useState(false)
  const [uploadDragOver, setUploadDragOver] = useState(false)
  const [step, setStep] = useState('upload')
  const [statementData, setStatementData] = useState(null)
  const [newAccountForUpload, setNewAccountForUpload] = useState({ nombre: '', tipo: 'credito' })
  const [separarAdicionales, setSepararAdicionales] = useState(null)
  const [targetAccount, setTargetAccount] = useState(null)
  const [pdfTxSelections, setPdfTxSelections] = useState(new Set())
  const [pdfTxDuplicadas, setPdfTxDuplicadas] = useState(new Set())

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

  // Modal ingresos
  const [showIngreso, setShowIngreso] = useState(false)
  const [ingreso, setIngreso] = useState({ fecha: new Date().toISOString().slice(0,10), nombre: '', monto: '', moneda: 'ARS', fuente_id: '' })
  const [showAddFuente, setShowAddFuente] = useState(false)
  const [newFuente, setNewFuente] = useState('')

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
  const [tcTipo, setTcTipo] = useState(() => localStorage.getItem('tc_tipo_ma') || 'blue')
  const [exchangeRates, setExchangeRates] = useState([])
  const [dolarRates, setDolarRates] = useState({})

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkmode_ma') === 'true')
  const [dashboardTab, setDashboardTab] = useState('resumen')
  const tabsScrollRef = useRef(null)
  const [sharedPeriod, setSharedPeriod] = useState([])
  const [vencimientosList, setVencimientosList] = useState([])
  const [loadingVenc, setLoadingVenc] = useState(false)

  // Excel import
  const [showExcel, setShowExcel] = useState(false)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [egresosOpen, setEgresosOpen] = useState(true)
  const [ingresosOpen, setIngresosOpen] = useState(true)
  const [excelFile, setExcelFile] = useState(null)
  const [excelPreview, setExcelPreview] = useState(null)
  const [excelDupReview, setExcelDupReview] = useState(null)
  const [excelDupSelections, setExcelDupSelections] = useState(new Set())
  const [excelDragOver, setExcelDragOver] = useState(false)
  const [loadingExcel, setLoadingExcel] = useState(false)
  const [excelMsgIndex, setExcelMsgIndex] = useState(0)
  const [excelTimer, setExcelTimer] = useState(0)
  const [excelTimerMax, setExcelTimerMax] = useState(60)
  const [excelTotalBatches, setExcelTotalBatches] = useState(0)
  const [excelBackgroundMode, setExcelBackgroundMode] = useState(false)
  const excelMsgIntervalRef = useRef(null)
  const excelTimerIntervalRef = useRef(null)

  // Responsive
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Hijos
  const [showHijos, setShowHijos] = useState(false)
  const [childrenDB, setChildrenDB] = useState([])
  const [newHijoNombre, setNewHijoNombre] = useState('')
  const [contextoAskingHijoNombre, setContextoAskingHijoNombre] = useState(false)
  const [contextoHijoNombre, setContextoHijoNombre] = useState('')

  // Aliases
  const [showAliases, setShowAliases] = useState(false)
  const [userAliases, setUserAliases] = useState([])
  const [newAlias, setNewAlias] = useState({ alias: '', tipo: 'categoria', valor: '', descripcion: '' })
  const [vencPagados, setVencPagados] = useState(new Set())
  const [vencExpanded, setVencExpanded] = useState(false)
  const [accountTransactions, setAccountTransactions] = useState([])
  const [sidebarCatEvol, setSidebarCatEvol] = useState('')
  const dolarCardRef = useRef(null)
  const [dolarCardH, setDolarCardH] = useState(null)

  const toggleVencPagado = (id) => {
    const next = new Set(vencPagados)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setVencPagados(next)
    const mes = new Date().toISOString().slice(0, 7)
    localStorage.setItem(`venc_pagados_${mes}`, JSON.stringify([...next]))
  }

  useEffect(() => {
    const mes = new Date().toISOString().slice(0, 7)
    const stored = localStorage.getItem(`venc_pagados_${mes}`)
    setVencPagados(stored ? new Set(JSON.parse(stored)) : new Set())
  }, [])

  useEffect(() => { setAccountTransactions([]); setSidebarCatEvol('') }, [selectedAccount])

  // Auto-setear tipoCambio: primero rate vivo de API, sino del DB histórico
  useEffect(() => {
    const rateVivo = dolarRates[tcTipo]
    if (rateVivo) { setTipoCambio(String(rateVivo)); localStorage.setItem('tc_ma', String(rateVivo)); return }
    const mesActual = new Date().toISOString().slice(0, 7)
    const rate = exchangeRates.find(r => r.periodo === mesActual && r.tipo === tcTipo)
    if (rate) { setTipoCambio(String(rate.valor)); localStorage.setItem('tc_ma', String(rate.valor)) }
  }, [exchangeRates, dolarRates, tcTipo])

  useEffect(() => {
    fetchAccounts(); fetchCategorias(); fetchChildren(); fetchUserAliases(); fetchExchangeRates(); fetchDolarRates()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        // Verificar onboarding completo — solo redirigir si no hay settings Y no hay cuentas (usuario nuevo de verdad)
        const { data: settings } = await supabase.from('user_settings').select('onboarding_completo').eq('user_id', user.id).maybeSingle()
        if (!settings || !settings.onboarding_completo) {
          const { count } = await supabase.from('accounts').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
          if ((count || 0) === 0) { navigate('/onboarding'); return }
        }

        const saved = localStorage.getItem(`servicios_${user.id}`)
        setServicios(saved ? JSON.parse(saved).map((s, i) => ({ ...s, id: s.id || `${s.nombre}_${i}` })) : SERVICIOS_DEFAULT)

        // Mini chart: últimos 6 meses
        const now = new Date()
        const meses = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        })
        const desde = meses[0] + '-01'
        const { data: txs } = await supabase.from('transactions')
          .select('fecha, monto, moneda').eq('user_id', user.id)
          .gte('fecha', desde).gt('monto', 0)
        const tc = parseFloat(localStorage.getItem('tc_ma')) || 1
        const totales = meses.map(ym => {
          const mes = txs?.filter(t => t.fecha?.startsWith(ym)) || []
          const total = mes.reduce((s, t) => s + (t.moneda === 'USD' ? t.monto * tc : t.monto), 0)
          const label = new Date(ym + '-15').toLocaleString('es-AR', { month: 'short' })
          return { mes: label.charAt(0).toUpperCase() + label.slice(1), total: Math.round(total) }
        })
        setMiniChartData(totales)
      }
    })
  }, [navigate])

  useLayoutEffect(() => {
    const measure = () => { if (dolarCardRef.current) setDolarCardH(dolarCardRef.current.offsetHeight) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [dolarRates, tcTipo, tipoCambio])

  useEffect(() => {
    if (dashboardTab === 'vencimientos' && selectedAccount === 'all') {
      fetchVencimientos()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardTab, selectedAccount])

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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

  const fetchChildren = async () => {
    const { data } = await supabase.from('children').select('nombre').order('nombre')
    setChildrenDB(data || [])
  }

  const fetchUserAliases = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('user_aliases').select('*').eq('user_id', user.id).order('alias')
    setUserAliases(data || [])
  }

  const handleAddAlias = async (e) => {
    e.preventDefault()
    if (!newAlias.alias.trim() || !newAlias.valor.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('user_aliases').insert({
      user_id: user.id,
      alias: newAlias.alias.trim().toUpperCase(),
      tipo: newAlias.tipo,
      valor: newAlias.valor.trim(),
      descripcion: newAlias.descripcion.trim() || null
    })
    setNewAlias({ alias: '', tipo: 'categoria', valor: '', descripcion: '' })
    fetchUserAliases()
  }

  const handleDeleteAlias = async (id) => {
    if (!window.confirm('¿Eliminar este alias?')) return
    await supabase.from('user_aliases').delete().eq('id', id)
    fetchUserAliases()
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

  const handleDeleteCategoria = async (cat) => {
    if (!window.confirm(`¿Eliminar "${cat.nombre}" y sus subcategorías?`)) return
    const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('category_id', cat.id)
    if (count > 0) {
      showToast(`Esta categoría tiene ${count} transacción(es). Primero reclasificalas.`, 'error')
      return
    }
    await supabase.from('subcategories').delete().eq('category_id', cat.id)
    await supabase.from('categories').delete().eq('id', cat.id)
    fetchCategorias()
  }

  const handleDeleteSubcat = async (subcat) => {
    if (!window.confirm(`¿Eliminar "${subcat.nombre}"?`)) return
    const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('subcategory_id', subcat.id)
    if (count > 0) {
      showToast(`Esta subcategoría tiene ${count} transacción(es). Primero reclasificalas.`, 'error')
      return
    }
    await supabase.from('subcategories').delete().eq('id', subcat.id)
    fetchCategorias()
  }

  const handleAddHijo = async (e) => {
    e.preventDefault()
    if (!newHijoNombre.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('children').insert({ user_id: user.id, nombre: newHijoNombre.trim() })
    setNewHijoNombre('')
    fetchChildren()
  }

  const handleDeleteHijo = async (nombre) => {
    if (!window.confirm(`¿Eliminar a "${nombre}"?`)) return
    await supabase.from('children').delete().eq('nombre', nombre)
    fetchChildren()
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

  const handleAddFuente = async (e) => {
    e.preventDefault()
    if (!newFuente.trim()) return
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: nueva } = await supabase.from('accounts').insert({ user_id: user.id, nombre: newFuente.trim(), tipo: 'ingreso' }).select().single()
    setNewFuente('')
    setShowAddFuente(false)
    fetchAccounts()
    if (showIngreso && nueva) setIngreso(prev => ({ ...prev, fuente_id: nueva.id }))
    setLoading(false)
  }

  const handleGuardarIngreso = async (e) => {
    e.preventDefault()
    if (!ingreso.fuente_id) return
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('transactions').insert({
      user_id: user.id,
      account_id: ingreso.fuente_id,
      fecha: ingreso.fecha,
      nombre: ingreso.nombre,
      detalle: ingreso.nombre,
      monto: parseFloat(ingreso.monto),
      moneda: ingreso.moneda,
      tipo: 'ingreso',
      estado: 'identificado',
      es_manual: true,
      cuotas_total: 1,
      cuota_numero: 1,
    })
    setIngreso({ fecha: new Date().toISOString().slice(0,10), nombre: '', monto: '', moneda: 'ARS', fuente_id: ingreso.fuente_id })
    setShowIngreso(false)
    setRefreshKey(k => k + 1)
    fetchAccounts()
    showToast('Ingreso registrado.')
    setLoading(false)
  }

  const fetchAccounts = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('accounts').select('*').eq('user_id', user.id)
    setAccounts(data || [])
    if (data && data.length > 0) {
      setSelectedAccount(prev => prev === null ? 'all' : prev)
    }
  }

  const fetchExchangeRates = async () => {
    const { data } = await supabase.from('exchange_rates').select('periodo, tipo, valor').order('periodo', { ascending: false })
    setExchangeRates(data || [])
  }

  const fetchDolarRates = async () => {
    try {
      const res = await fetch('https://dolarapi.com/v1/dolares')
      if (!res.ok) return
      const arr = await res.json()
      const map = {}
      arr.forEach(d => {
        const avg = (d.compra != null && d.venta != null) ? Math.round((d.compra + d.venta) / 2) : (d.venta || d.compra || 0)
        if (d.casa === 'blue') map.blue = avg
        else if (d.casa === 'bolsa') map.mep = avg
        else if (d.casa === 'oficial') map.oficial = avg
        else if (d.casa === 'tarjeta') map.tarjeta = avg
      })
      setDolarRates(map)
    } catch {}
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

  const parseExcelDate = (val) => {
    if (!val) return null
    if (val instanceof Date) {
      const y = val.getFullYear()
      const m = String(val.getMonth() + 1).padStart(2, '0')
      const d = String(val.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    if (typeof val === 'number') {
      // Excel serial date: days since 1900-01-00 (with leap year bug offset)
      const date = new Date(Math.round((val - 25569) * 86400 * 1000))
      const y = date.getUTCFullYear()
      const m = String(date.getUTCMonth() + 1).padStart(2, '0')
      const d = String(date.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    if (typeof val === 'string') {
      const parts = val.split('/')
      if (parts.length === 3) {
        const [d, m, y] = parts
        return `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10)
    }
    return null
  }

  const parsearExcel = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true })
        const ws = wb.Sheets['GASTOS']
        if (!ws) { reject(new Error('No se encontró la hoja "GASTOS" en el archivo')); return }
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
        const parsed = rows.slice(1)
          .filter(row => row && row.length > 0 && (row[0] || row[1] || row[2]))
          .map(row => {
            const fecha = parseExcelDate(row[0])
            const monto_ars = parseFloat(row[1]) || 0
            const monto_usd = parseFloat(row[2]) || 0
            const descripcion = String(row[3] || '').trim()
            const cat = String(row[4] || '').trim() || null
            const subcat = String(row[5] || '').trim() || null
            const hijoRaw = String(row[6] || '').trim()
            const hijo = hijoRaw ? hijoRaw.charAt(0).toUpperCase() + hijoRaw.slice(1).toLowerCase() : null
            const modo_pago = String(row[7] || '').trim()
            const monto = monto_usd > 0 ? monto_usd : monto_ars
            const moneda = monto_usd > 0 ? 'USD' : 'ARS'
            return { fecha, monto, moneda, monto_ars, monto_usd, descripcion, notas: descripcion, modo_pago, cat, subcat, hijo }
          })
          .filter(r => r.fecha && r.monto > 0)
        resolve(parsed)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })

  const handleAnalizarExcel = async () => {
    if (!excelFile) return
    setLoadingExcel(true)
    setExcelBackgroundMode(false)
    try {
      const rows = await parsearExcel(excelFile)
      if (rows.length === 0) {
        showToast('No se encontraron filas válidas en la hoja GASTOS.', 'error')
        setLoadingExcel(false)
        return
      }

      const rowsNeedingClassification = rows.filter(r => !r.cat || r.cat === 'A Identificar')
      let enriched

      if (rowsNeedingClassification.length === 0) {
        // Excel ya tiene todas las categorías — no llamar a Claude
        enriched = rows.map(r => ({
          ...r,
          nombre: r.descripcion,
          estado: r.cat && r.cat !== 'A Identificar' ? 'identificado' : 'a_identificar'
        }))
      } else {
        const totalBatches = Math.ceil(rowsNeedingClassification.length / 30)
        const timerMax = Math.max(20, Math.min(120, totalBatches * 5))
        setExcelTotalBatches(totalBatches)
        setExcelTimerMax(timerMax)
        setExcelTimer(timerMax)
        setExcelMsgIndex(0)

        excelMsgIntervalRef.current = setInterval(() => {
          setExcelMsgIndex(i => (i + 1) % EXCEL_PROCESSING_MSGS.length)
        }, 3000)

        let elapsed = 0
        excelTimerIntervalRef.current = setInterval(() => {
          elapsed++
          if (elapsed >= 30) setExcelBackgroundMode(true)
          setExcelTimer(t => t > 0 ? t - 1 : 0)
        }, 1000)

        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        const headers = { 'Content-Type': 'application/json' }
        if (token) headers['Authorization'] = `Bearer ${token}`
        const response = await fetch('/api/classifyRows', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            rows: rowsNeedingClassification.map(r => ({ notas: r.notas, descripcion: r.descripcion, monto: r.monto, moneda: r.moneda })),
            categories: categoriasDB.map(c => ({ nombre: c.nombre })),
            children: childrenDB,
            aliases: userAliases
          })
        })
        if (!response.ok) throw new Error(`Error clasificando filas (${response.status})`)
        const { classifications } = await response.json()

        let clIdx = 0
        enriched = rows.map(r => {
          if (!r.cat || r.cat === 'A Identificar') {
            const cl = Array.isArray(classifications) ? classifications[clIdx++] : null
            return {
              ...r,
              cat: cl?.categoria || null,
              subcat: cl?.subcategoria || null,
              hijo: r.hijo || cl?.hijo || null,
              nombre: cl?.nombre || r.descripcion,
              estado: cl?.categoria && cl?.categoria !== 'A Identificar' ? 'identificado' : 'a_identificar'
            }
          }
          return { ...r, nombre: r.descripcion, estado: 'identificado' }
        })
      }
      setExcelPreview(enriched)
    } catch (err) {
      showToast('Error procesando el archivo: ' + err.message, 'error')
    }
    clearInterval(excelMsgIntervalRef.current)
    clearInterval(excelTimerIntervalRef.current)
    setLoadingExcel(false)
    setExcelBackgroundMode(false)
  }

  const handleImportarExcel = async () => {
    if (!excelPreview || excelPreview.length === 0) return
    setLoadingExcel(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const currentAccounts = [...accounts]

      const accountCache = {}
      const resolveAccount = async (modoPago) => {
        const key = (modoPago || 'EFECTIVO').toUpperCase().trim()
        if (accountCache[key]) return accountCache[key]

        // Alias del usuario tiene prioridad
        const aliasAcc = userAliases.find(a => a.tipo === 'cuenta' && a.alias.toUpperCase() === key)
        if (aliasAcc) {
          let acc = currentAccounts.find(a => a.nombre.toLowerCase() === aliasAcc.valor.toLowerCase())
          if (!acc) {
            const { data } = await supabase.from('accounts').insert({ user_id: user.id, nombre: aliasAcc.valor, tipo: 'credito' }).select().single()
            acc = data; currentAccounts.push(acc)
          }
          accountCache[key] = acc; return acc
        }

        // Nombre real del Excel — buscar cuenta existente o crearla
        const nombreCuenta = modoPago?.trim() || 'Efectivo'
        let acc = currentAccounts.find(a => a.nombre.toLowerCase() === nombreCuenta.toLowerCase())
        if (!acc) {
          const tipoCredito = ['VISA', 'MASTER', 'AMEX', 'AMERICAN EXPRESS', 'NARANJA', 'CABAL', 'DINERS']
          const tipo = key === 'EFECTIVO' ? 'efectivo'
            : tipoCredito.some(t => key.includes(t)) ? 'credito'
            : 'debito'
          const { data } = await supabase.from('accounts').insert({ user_id: user.id, nombre: nombreCuenta, tipo }).select().single()
          acc = data; currentAccounts.push(acc)
        }
        accountCache[key] = acc; return acc
      }

      const { data: categorias } = await supabase.from('categories').select('id, nombre')
      const { data: subcategorias } = await supabase.from('subcategories').select('id, nombre, category_id')
      const getCatId = (cat) => categorias?.find(c => c.nombre === cat)?.id || null
      const getSubcatId = (sub, catId) => subcategorias?.find(s => s.nombre === sub && s.category_id === catId)?.id || null

      const uniqueModoPagos = [...new Set(excelPreview.map(r => r.modo_pago || ''))]
      for (const mp of uniqueModoPagos) await resolveAccount(mp)
      const accountsForRows = excelPreview.map(r => accountCache[(r.modo_pago || 'EFECTIVO').toUpperCase().trim()])
      const uniqueAccountIds = [...new Set(accountsForRows.map(a => a.id))]
      const { data: existentes } = await supabase.from('transactions')
        .select('fecha, monto, detalle, account_id').in('account_id', uniqueAccountIds)

      const rowsWithAccounts = excelPreview.map((row, i) => ({ row, acc: accountsForRows[i] }))

      const exactDupes = []
      const potentialDupes = []
      const newRows = []

      for (const item of rowsWithAccounts) {
        const { row, acc } = item
        const exactMatch = existentes?.find(e =>
          e.account_id === acc.id &&
          e.fecha === row.fecha &&
          Math.abs(Number(e.monto) - row.monto) < 0.01 &&
          (e.detalle || '').toLowerCase() === (row.notas || row.descripcion || '').toLowerCase()
        )
        if (exactMatch) { exactDupes.push(item); continue }

        const sameAmountDate = existentes?.find(e =>
          e.account_id === acc.id &&
          e.fecha === row.fecha &&
          Math.abs(Number(e.monto) - row.monto) < 0.01
        )
        if (sameAmountDate) { potentialDupes.push({ ...item, existing: sameAmountDate }); continue }

        newRows.push(item)
      }

      if (potentialDupes.length > 0) {
        setExcelDupReview({ potentialDupes, newRows, exactDupes, categorias, subcategorias })
        setExcelDupSelections(new Set())
        setLoadingExcel(false); return
      }

      if (newRows.length === 0) {
        showToast('Todas las transacciones ya existen (duplicadas).', 'error')
        setLoadingExcel(false); return
      }

      const parseCuota = (texto) => {
        const m = (texto || '').match(/(\d+)\/(\d+)\s*$/)
        if (!m) return { cuota_numero: 1, cuotas_total: 1 }
        const num = parseInt(m[1]), total = parseInt(m[2])
        if (num >= 1 && total >= 1 && num <= total && total <= 48) return { cuota_numero: num, cuotas_total: total }
        return { cuota_numero: 1, cuotas_total: 1 }
      }
      const toInsert = newRows.map(({ row, acc }) => {
        const catId = getCatId(row.cat)
        const cuota = parseCuota(row.descripcion || row.notas)
        return {
          user_id: user.id, account_id: acc.id, fecha: row.fecha,
          nombre: row.nombre || row.notas || row.descripcion || null,
          detalle: row.notas || row.descripcion,
          monto: row.monto, moneda: row.moneda, tipo: 'gasto',
          category_id: catId, subcategory_id: getSubcatId(row.subcat, catId),
          estado: row.estado, es_manual: true, ...cuota,
          tag: row.hijo || null,
        }
      })

      await supabase.from('transactions').insert(toInsert)
      const omitidas = exactDupes.length
      showToast(`${toInsert.length} transacciones importadas.${omitidas > 0 ? ` ${omitidas} duplicadas exactas omitidas.` : ''}`)
      setShowExcel(false); setExcelFile(null); setExcelPreview(null)
      setRefreshKey(k => k + 1); fetchAccounts()
    } catch (err) {
      showToast('Error al importar: ' + err.message, 'error')
    }
    setLoadingExcel(false)
  }

  const handleImportarFinal = async () => {
    if (!excelDupReview) return
    setLoadingExcel(true)
    try {
      const { newRows, potentialDupes, exactDupes, categorias, subcategorias } = excelDupReview
      const { data: { user } } = await supabase.auth.getUser()
      const getCatId = (cat) => categorias?.find(c => c.nombre === cat)?.id || null
      const getSubcatId = (sub, catId) => subcategorias?.find(s => s.nombre === sub && s.category_id === catId)?.id || null

      const selectedDupes = potentialDupes.filter((_, i) => excelDupSelections.has(i))
      const toImport = [...newRows, ...selectedDupes]

      if (toImport.length === 0) {
        showToast('No seleccionaste ninguna transacción para importar.', 'error')
        setLoadingExcel(false); return
      }

      const parseCuotaFinal = (texto) => {
        const m = (texto || '').match(/(\d+)\/(\d+)\s*$/)
        if (!m) return { cuota_numero: 1, cuotas_total: 1 }
        const num = parseInt(m[1]), total = parseInt(m[2])
        if (num >= 1 && total >= 1 && num <= total && total <= 48) return { cuota_numero: num, cuotas_total: total }
        return { cuota_numero: 1, cuotas_total: 1 }
      }
      const toInsert = toImport.map(({ row, acc }) => {
        const catId = getCatId(row.cat)
        const cuota = parseCuotaFinal(row.descripcion || row.notas)
        return {
          user_id: user.id, account_id: acc.id, fecha: row.fecha,
          nombre: row.nombre || row.notas || row.descripcion || null,
          detalle: row.notas || row.descripcion,
          monto: row.monto, moneda: row.moneda, tipo: 'gasto',
          category_id: catId, subcategory_id: getSubcatId(row.subcat, catId),
          estado: row.estado, es_manual: true, ...cuota,
          tag: row.hijo || null,
        }
      })

      await supabase.from('transactions').insert(toInsert)
      const omitidas = exactDupes.length + (potentialDupes.length - selectedDupes.length)
      showToast(`${toInsert.length} transacciones importadas.${omitidas > 0 ? ` ${omitidas} omitidas.` : ''}`)
      setShowExcel(false); setExcelFile(null); setExcelPreview(null); setExcelDupReview(null)
      setRefreshKey(k => k + 1); fetchAccounts()
    } catch (err) {
      showToast('Error al importar: ' + err.message, 'error')
    }
    setLoadingExcel(false)
  }

  const handleReclasificar = async () => {
    showToast('Buscando transacciones sin clasificar...')
    const { data: { session } } = await supabase.auth.getSession()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: pendientes } = await supabase.from('transactions')
      .select('*').eq('user_id', user.id).or('estado.eq.a_identificar,category_id.is.null')
      .gt('monto', 0).limit(500)
    if (!pendientes || pendientes.length === 0) { showToast('No hay transacciones sin clasificar.'); return }
    showToast(`Reclasificando ${pendientes.length} transacciones con IA...`)
    const { data: cats } = await supabase.from('categories').select('*')
    const { data: children } = await supabase.from('children').select('*').eq('user_id', user.id)
    const { data: aliases } = await supabase.from('user_aliases').select('*').eq('user_id', user.id)
    const rows = pendientes.map(t => ({ id: t.id, notas: t.notas || '', descripcion: t.detalle || t.nombre || '', monto: t.monto, moneda: t.moneda || 'ARS' }))
    try {
      const res = await fetch('/api/classifyRows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ rows, categories: cats, children: children || [], aliases: aliases || [] })
      })
      const { classifications } = await res.json()
      const { data: subcats } = await supabase.from('subcategories').select('*')
      let updated = 0
      for (let i = 0; i < pendientes.length; i++) {
        const cl = classifications[i]
        if (!cl) continue
        const catObj = cats?.find(c => c.nombre === cl.categoria)
        const subcatObj = subcats?.find(s => s.nombre === cl.subcategoria && s.category_id === catObj?.id)
        await supabase.from('transactions').update({
          nombre: cl.nombre || pendientes[i].detalle,
          category_id: catObj?.id || null,
          subcategory_id: subcatObj?.id || null,
          estado: catObj ? 'identificado' : 'a_identificar',
        }).eq('id', pendientes[i].id)
        updated++
      }
      showToast(`${updated} transacciones reclasificadas.`)
      setRefreshKey(k => k + 1)
    } catch (e) {
      showToast('Error al reclasificar: ' + e.message, 'error')
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

  const handleMergeDuplicateAccounts = async (nombre) => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const duplicates = accounts.filter(a => a.nombre === nombre)
    if (duplicates.length <= 1) { setLoading(false); return }
    const keeper = duplicates[0]
    const toRemove = duplicates.slice(1)
    for (const acc of toRemove) {
      await supabase.from('transactions').update({ account_id: keeper.id }).eq('account_id', acc.id)
      await supabase.from('statements').delete().eq('account_id', acc.id)
      await supabase.from('accounts').delete().eq('id', acc.id).eq('user_id', user.id)
    }
    fetchAccounts()
    setLoading(false)
    showToast(`${toRemove.length} cuenta(s) duplicada(s) consolidadas en "${nombre}".`)
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

  const analyzeImageWithClaude = async (file, userRules, token) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const base64 = e.target.result.split(',')[1]
          const mediaType = file.type || 'image/jpeg'
          const headers = { 'Content-Type': 'application/json' }
          if (token) headers['Authorization'] = `Bearer ${token}`
          const response = await fetch('/api/analyzeImage', {
            method: 'POST',
            headers,
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
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const { data: rules } = await supabase.from('user_rules').select('*').eq('user_id', user.id)

      const isImage = archivo.type.startsWith('image/')
      let result
      if (isImage) {
        result = await analyzeImageWithClaude(archivo, rules || [], token)
      } else {
        const pdfText = await extractTextFromPDF(archivo)
        result = await analyzeStatementWithClaude(pdfText, 'auto', rules || [], token)
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
        setPdfTxDuplicadas(new Set())
        setPdfTxSelections(new Set(result.transacciones.map((_, i) => i)))
        setStep('preview')
      } else {
        setStep('select_account')
      }
    } catch (err) {
      showToast('Error procesando el PDF: ' + err.message, 'error')
      setStep('upload')
    }
    setLoading(false)
  }

  const enrichirConHistorial = async (transacciones, accountId) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: txHistorial } = await supabase.from('transactions')
        .select('nombre, monto, cuota_numero, cuotas_total, category_id, categories(nombre), subcategories(nombre)')
        .eq('user_id', user.id).eq('account_id', accountId).gt('cuotas_total', 1)
      if (!txHistorial || txHistorial.length === 0) return transacciones
      return transacciones.map(t => {
        const num = t.cuota_numero || 1
        const total = t.cuotas_total || 1
        if (total <= 1 || num <= 1) return t
        const monto = Math.abs(Number(t.monto))
        const prevMatch = txHistorial.find(e =>
          e.cuotas_total === total &&
          e.cuota_numero === num - 1 &&
          Math.abs(Math.abs(Number(e.monto)) - monto) < monto * 0.03
        )
        if (!prevMatch || !prevMatch.nombre) return t
        return {
          ...t,
          nombre_limpio: prevMatch.nombre,
          categoria_sugerida: prevMatch.categories?.nombre || t.categoria_sugerida,
          subcategoria_sugerida: prevMatch.subcategories?.nombre || t.subcategoria_sugerida,
        }
      })
    } catch { return transacciones }
  }

  const calcularDuplicadosPDF = async (transacciones, accountId, fechaFacturacion) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: txExistentes } = await supabase.from('transactions')
        .select('fecha, monto')
        .eq('user_id', user.id)
        .eq('account_id', accountId)

      let billingMes = null
      if (fechaFacturacion) {
        const parts = fechaFacturacion.split('/')
        if (parts.length === 3) {
          const year = parts[2].length === 2 ? '20' + parts[2] : parts[2]
          billingMes = `${year}-${parts[1].padStart(2,'0')}`
        }
      }

      const dupes = new Set()
      const selec = new Set()
      transacciones.forEach((t, i) => {
        const esCuota = t.cuotas_total > 1
        const isDupe = txExistentes?.some(e => {
          const montoMatch = Math.abs(Number(e.monto) - Math.abs(Number(t.monto))) < 0.01
          if (!montoMatch) return false
          if (esCuota && billingMes) return e.fecha?.slice(0, 7) === billingMes
          return e.fecha === t.fecha
        })
        if (isDupe) dupes.add(i)
        else selec.add(i)
      })
      setPdfTxDuplicadas(dupes)
      setPdfTxSelections(selec)
    } catch {
      const allIdx = new Set(transacciones.map((_, i) => i))
      setPdfTxSelections(allIdx)
      setPdfTxDuplicadas(new Set())
    }
  }

  const handleSelectAccount = async (acc) => {
    setTargetAccount(acc)
    if (statementData.adicionales && statementData.adicionales.length > 0) setStep('adicionales')
    else {
      const enriquecidas = await enrichirConHistorial(statementData.transacciones, acc.id)
      setStatementData(prev => ({ ...prev, transacciones: enriquecidas }))
      calcularDuplicadosPDF(enriquecidas, acc.id, statementData.fecha_facturacion)
      setStep('preview')
    }
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
    else {
      const enriquecidas = await enrichirConHistorial(statementData.transacciones, account.id)
      setStatementData(prev => ({ ...prev, transacciones: enriquecidas }))
      calcularDuplicadosPDF(enriquecidas, account.id, statementData.fecha_facturacion)
      setStep('preview')
    }
  }

  const handleConfirmAdicionales = async (separar) => {
    setSepararAdicionales(separar)
    if (targetAccount) {
      const enriquecidas = await enrichirConHistorial(statementData.transacciones, targetAccount.id)
      setStatementData(prev => ({ ...prev, transacciones: enriquecidas }))
      calcularDuplicadosPDF(enriquecidas, targetAccount.id, statementData.fecha_facturacion)
    }
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

  const avanzarContexto = () => {
    if (contextoIdx + 1 < contextoDetectado.length) {
      setContextoIdx(i => i + 1)
    } else {
      cerrarYRefrescar()
    }
  }

  const handleGuardarHijoDesdeContexto = async () => {
    const nombre = contextoHijoNombre.trim()
    if (nombre) {
      await supabase.from('children').insert({ nombre })
      setChildrenDB(prev => [...prev, { nombre }].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    }
    setContextoAskingHijoNombre(false)
    setContextoHijoNombre('')
    avanzarContexto()
  }

  // Confirmar contexto detectado — guarda en user_rules como flag para no preguntar de nuevo
  const handleConfirmarContexto = async (confirmar) => {
    const { data: { user } } = await supabase.auth.getUser()
    const clave = contextoDetectado[contextoIdx]
    if (confirmar) {
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
      if (clave === 'hijo') {
        setContextoAskingHijoNombre(true)
        return
      }
    }
    avanzarContexto()
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
        showToast(`Ya cargaste el extracto de ${statementData.periodo} para esta cuenta.`, 'error')
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
        showToast(`Ya cargaste el extracto de ${statementData.periodo} para esta cuenta.`, 'error')
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
      // Solo importar las transacciones que el usuario seleccionó en el preview
      const transacciones = statementData.transacciones
        .filter((_, i) => pdfTxSelections.has(i))
        .map(t => {
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
    else showToast('Solo se aceptan archivos PDF o imágenes (PNG, JPG)', 'error')
  }

  const tipoLabel = (tipo) => tipo === 'credito' ? 'Crédito' : tipo === 'debito' ? 'Débito' : tipo === 'ingreso' ? 'Ingreso' : 'Efectivo'
  const formatMonto = (monto) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)
  const currentMsg = PROCESSING_MSGS[msgIndex]

  // Subcategorías filtradas para el paso identificar
  const subcatsParaIdentificar = () => {
    const catObj = categoriasDB.find(c => c.nombre === txEditTemp.categoria)
    if (!catObj) return []
    return subcategoriasDB.filter(s => s.category_id === catObj.id)
  }

  const styles = getStyles(darkMode)
  const isMobile = windowWidth < 640
  const txActual = txSinIdentificar[txIdentificarIdx]
  const contextoActual = contextoDetectado[contextoIdx]

  return (
    <>
      <div style={{...styles.container, overflowX: 'hidden', width: '100%', boxSizing: 'border-box'}}>

        {/* ===== HEADER: cards izq | logo centro | logout+darkmode der ===== */}
        {(() => {
          const rateVivo = dolarRates[tcTipo]
          const mesActual = new Date().toISOString().slice(0, 7)
          const rateDB = exchangeRates.find(r => r.periodo === mesActual && r.tipo === tcTipo)
          const rateActivo = rateVivo || (rateDB ? rateDB.valor : null)
          const tiposLabel = { blue: 'Blue', mep: 'MEP', oficial: 'Oficial', tarjeta: 'Tarjeta' }
          const cardBg = darkMode ? '#1C1A1C' : '#F7F5F8'
          const cardBorder = darkMode ? '#3A333A' : '#E2DDE0'
          const vencList = [...servicios].sort((a, b) => {
            const aPagado = vencPagados.has(a.id) ? 1 : 0
            const bPagado = vencPagados.has(b.id) ? 1 : 0
            if (aPagado !== bPagado) return aPagado - bPagado
            return (a.dia || 0) - (b.dia || 0)
          })
          const pendientes = vencList.filter(v => !vencPagados.has(v.id))

          const usdCard = (
            <div ref={dolarCardRef} style={{ width: '140px', borderRadius: '14px', border: `1px solid ${cardBorder}`, backgroundColor: cardBg, padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', alignSelf: 'flex-start' }}>
              <p style={{ fontSize: '11px', color: '#8e8e93', letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center', margin: 0, fontWeight: 700 }}>Dólar</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {['blue','mep','oficial','tarjeta'].map(t => (
                  <button key={t} onClick={() => { setTcTipo(t); localStorage.setItem('tc_tipo_ma', t) }}
                    style={{ flex: '1 1 42%', padding: '4px 2px', fontSize: '10px', fontWeight: 700, borderRadius: '6px', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif', border: `1px solid ${tcTipo === t ? '#5C4F5C' : cardBorder}`, backgroundColor: tcTipo === t ? '#5C4F5C' : 'transparent', color: tcTipo === t ? 'white' : (darkMode ? '#9A8A9A' : '#6e6e73'), textTransform: 'uppercase' }}>
                    {tiposLabel[t]}
                  </button>
                ))}
              </div>
              {rateActivo ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#8e8e93' }}>U$S 1 =</p>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>$ {new Intl.NumberFormat('es-AR').format(rateActivo)}</p>
                  {rateVivo && <p style={{ margin: 0, fontSize: '9px', color: '#2ba36e' }}>● en vivo · prom.</p>}
                </div>
              ) : (
                <input type="number" style={{ width: '100%', padding: '5px 8px', borderRadius: '7px', border: `1px solid ${cardBorder}`, fontSize: '15px', fontWeight: 700, outline: 'none', boxSizing: 'border-box', backgroundColor: 'transparent', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontFamily: '"Montserrat", sans-serif', textAlign: 'center' }}
                  placeholder="1600" value={tipoCambio} onChange={e => { setTipoCambio(e.target.value); localStorage.setItem('tc_ma', e.target.value) }} />
              )}
            </div>
          )

          const vencCard = (
            <div style={{ width: '160px', position: 'relative', borderRadius: '14px', border: `1px solid ${cardBorder}`, backgroundColor: cardBg, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden', boxSizing: 'border-box', maxHeight: vencExpanded ? 'none' : `${dolarCardH || 0}px` }}>
              <p style={{ fontSize: '11px', color: '#8e8e93', letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center', margin: 0, fontWeight: 700 }}>Vencimientos</p>
              {vencList.length === 0 ? (
                <p style={{ fontSize: '11px', color: '#8e8e93', textAlign: 'center', margin: '6px 0', fontStyle: 'italic' }}>Sin servicios</p>
              ) : (
                <>
                  <p style={{ fontSize: '11px', color: pendientes.length > 0 ? '#c07a2b' : '#2ba36e', textAlign: 'center', margin: 0, fontWeight: 700 }}>
                    {pendientes.length > 0 ? `${pendientes.length} pend.` : '✓ Al día'}
                  </p>
                  {vencList.map(v => {
                    const pagado = vencPagados.has(v.id)
                    return (
                      <div key={v.id} onClick={() => toggleVencPagado(v.id)}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', cursor: 'pointer', padding: '4px 6px', borderRadius: '6px', backgroundColor: pagado ? (darkMode ? '#1E2E1E' : '#edfbf0') : 'transparent', opacity: pagado ? 0.55 : 1 }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: '11px', fontWeight: 600, color: darkMode ? '#F0EDEC' : '#1d1d1f', margin: 0, textDecoration: pagado ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.nombre}</p>
                          <p style={{ fontSize: '10px', color: '#8e8e93', margin: 0 }}>día {v.dia}</p>
                        </div>
                        <input type="checkbox" checked={pagado} readOnly style={{ accentColor: '#5C4F5C', flexShrink: 0, cursor: 'pointer', width: '14px', height: '14px' }} />
                      </div>
                    )
                  })}
                </>
              )}
              {/* gradiente + botón VER MÁS dentro del card (no agrega altura extra) */}
              {!vencExpanded && vencList.length > 2 && (
                <div onClick={() => setVencExpanded(true)} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '36px', background: `linear-gradient(transparent, ${cardBg})`, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '5px', cursor: 'pointer', borderRadius: '0 0 14px 14px' }}>
                  <span style={{ fontSize: '10px', color: '#8e8e93', fontWeight: 600, fontFamily: '"Montserrat", sans-serif' }}>▾ ver más</span>
                </div>
              )}
              {vencExpanded && (
                <button onClick={() => setVencExpanded(false)} style={{ background: 'none', border: 'none', fontSize: '10px', color: '#8e8e93', cursor: 'pointer', fontWeight: 600, fontFamily: '"Montserrat", sans-serif', padding: '2px 0', textAlign: 'center' }}>
                  ▴ ver menos
                </button>
              )}
            </div>
          )

          return (
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: isMobile ? '12px 16px' : '20px 32px', position: 'relative', minHeight: isMobile ? '60px' : '160px' }}>
              {/* Izquierda */}
              {isMobile ? (
                <button onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', fontSize: '26px', cursor: 'pointer', opacity: 0.8, padding: 0 }}>☰</button>
              ) : (
                <div style={{ display: 'flex', gap: '10px', zIndex: 1, alignItems: 'flex-start' }}>
                  {usdCard}
                  {vencCard}
                </div>
              )}
              {/* Centro: logo */}
              <img src={logo} alt="Moms Assist Finance" style={{ ...styles.logoImg, height: isMobile ? '60px' : '160px', position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: isMobile ? '12px' : '20px', pointerEvents: 'none' }} />
              {/* Derecha: luna + config (desktop) + cerrar sesión */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', zIndex: 1 }}>
                <button onClick={() => { const next = !darkMode; setDarkMode(next); localStorage.setItem('darkmode_ma', next) }} title={darkMode ? 'Modo claro' : 'Modo oscuro'} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', opacity: 0.7, marginTop: '2px' }}>
                  {darkMode ? '☀️' : '🌙'}
                </button>
                {!isMobile && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => setConfigOpen(o => !o)} style={{ padding: '7px 13px', borderRadius: '8px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: configOpen ? (darkMode ? '#3A333A' : '#EDE8EC') : 'none', cursor: 'pointer', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73', fontFamily: '"Montserrat", sans-serif', letterSpacing: '0.04em', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '5px' }}>
                        ⚙️ Configuración <span style={{ fontSize: '9px', opacity: 0.7 }}>{configOpen ? '▴' : '▾'}</span>
                      </button>
                      <button onClick={handleLogout} style={{ padding: '7px 13px', borderRadius: '8px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'none', cursor: 'pointer', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73', fontFamily: '"Montserrat", sans-serif', letterSpacing: '0.04em', fontWeight: 500 }}>
                        Cerrar sesión
                      </button>
                    </div>
                    {configOpen && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', backgroundColor: darkMode ? '#1C1A1C' : '#F7F5F8', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, borderRadius: '10px', padding: '8px', minWidth: '200px' }}>
                        <button style={styles.sidebarBtnSecondary} onClick={() => setShowAddAccount(true)}>+ CUENTA</button>
                        <button style={styles.sidebarBtnSecondary} onClick={() => setShowCategorias(true)}>+ CATEGORÍAS</button>
                        <button style={styles.sidebarBtnSecondary} onClick={() => { fetchChildren(); setShowHijos(true) }}>👧 HIJOS</button>
                        <button style={styles.sidebarBtnSecondary} onClick={() => { fetchUserAliases(); setShowAliases(true) }}>📋 REGLAS DE CLASIFICACIÓN</button>
                        <button style={styles.sidebarBtnSecondary} onClick={handleReclasificar}>🤖 RE-CLASIFICAR CON IA</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        <div style={{ ...styles.layout, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-start', padding: isMobile ? '0 12px 48px 12px' : '0 32px 48px 32px', gap: isMobile ? '12px' : '24px' }}>

          {/* Sidebar izquierdo */}
          {isMobile && sidebarOpen && (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 150 }} onClick={() => setSidebarOpen(false)} />
          )}
          <div className="sidebar-scroll" style={{ ...styles.sidebar, ...(isMobile ? { position: 'fixed', top: 0, left: 0, bottom: 0, height: '100vh', boxSizing: 'border-box', borderRadius: '0 20px 20px 0', overflow: 'hidden', zIndex: 200, display: sidebarOpen ? 'flex' : 'none', width: '85vw', maxWidth: '360px' } : {}) }}>
            {/* Zona top fija: solo mobile — botón cerrar + dólar blue */}
            {isMobile && (
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                <button onClick={() => setSidebarOpen(false)} style={{ alignSelf: 'flex-end', background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: darkMode ? '#F0EDEC' : '#1d1d1f', marginBottom: '8px', padding: '4px 8px' }}>
                  ✕
                </button>
                {(() => {
                  const blueRate = dolarRates['blue']
                  const mesActual = new Date().toISOString().slice(0, 7)
                  const rateDB = exchangeRates.find(r => r.periodo === mesActual && r.tipo === 'blue')
                  const rateActivo = blueRate || (rateDB ? rateDB.valor : null)
                  const cardBg = darkMode ? '#252025' : '#F0ECF5'
                  const cardBorder = darkMode ? '#3A333A' : '#D8D0DC'
                  return (
                    <div style={{ borderRadius: '12px', border: `1px solid ${cardBorder}`, backgroundColor: cardBg, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <p style={{ fontSize: '11px', color: '#8e8e93', textTransform: 'uppercase', margin: 0, fontWeight: 700, letterSpacing: '0.06em' }}>Dólar Blue</p>
                      {rateActivo
                        ? <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>$ {new Intl.NumberFormat('es-AR').format(rateActivo)}</p>
                        : <input type="number" style={{ width: '90px', padding: '4px 8px', borderRadius: '8px', border: `1px solid ${cardBorder}`, fontSize: '15px', fontWeight: 700, outline: 'none', boxSizing: 'border-box', backgroundColor: 'transparent', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontFamily: '"Montserrat", sans-serif', textAlign: 'right' }} placeholder="1600" value={tipoCambio} onChange={e => { setTipoCambio(e.target.value); localStorage.setItem('tc_ma', e.target.value) }} />
                      }
                    </div>
                  )
                })()}
              </div>
            )}
            {/* Zona media scrollable: lista de cuentas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', ...(isMobile ? { flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: '8px' } : {}) }}>
            {(() => {
              const egresoCuentas = accounts.filter(a => a.tipo !== 'ingreso')
              const ingresoCuentas = accounts.filter(a => a.tipo === 'ingreso')

              const accountIcon = (tipo) => {
                if (tipo === 'efectivo') return '💵'
                if (tipo === 'debito') return '🏦'
                if (tipo === 'ingreso') return '💰'
                return '💳'
              }

              const renderAccount = (acc) => (
                <div key={acc.id}
                  style={{ ...styles.accountCard, ...(selectedAccount?.id === acc.id ? styles.accountCardSelected : {}), position: 'relative', textAlign: 'center' }}
                  onClick={() => { setSelectedAccount(selectedAccount?.id === acc.id ? null : acc); setSidebarOpen(false) }}
                  onMouseEnter={() => setHoveredAccount(acc.id)}
                  onMouseLeave={() => setHoveredAccount(null)}
                >
                  <p style={{ ...styles.accountType, marginBottom: '4px' }}>{accountIcon(acc.tipo)} {tipoLabel(acc.tipo)}</p>
                  <p style={styles.accountName}>{acc.nombre}</p>
                  {hoveredAccount === acc.id && (
                    <button style={{ position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px', opacity: 0.7, outline: 'none' }}
                      onClick={(e) => { e.stopPropagation(); setEditAccount({...acc}) }}>✏️</button>
                  )}
                </div>
              )

              const SectionHeader = ({ label, open, onToggle, onAdd, showArrow = true }) => (
                <div style={{ ...styles.sidebarHeader, display: 'flex', alignItems: 'center' }} onClick={onToggle}>
                  <h2 style={{ ...styles.sidebarTitle, cursor: onToggle ? 'pointer' : 'default', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flex: 1 }}>
                    {label}
                    {showArrow && <span style={{ fontSize: '10px', opacity: 0.5, display: 'inline-block', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>▼</span>}
                  </h2>
                  {onAdd && (
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: darkMode ? '#9A8A9A' : '#5C4F5C', padding: '0 6px', outline: 'none', lineHeight: 1, flexShrink: 0 }}
                      onClick={(e) => { e.stopPropagation(); onAdd() }} title="Nueva fuente de ingreso">+</button>
                  )}
                </div>
              )

              const dupes = [...new Set(accounts.map(a => a.nombre).filter((n, i, arr) => arr.indexOf(n) !== i))]

              return (
                <>
                  {dupes.length > 0 && (
                    <div style={{ background: '#e74c3c22', border: '1px solid #e74c3c66', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px', fontSize: '12px', color: '#e74c3c' }}>
                      ⚠️ Cuentas duplicadas: {dupes.join(', ')}
                      {dupes.map(nombre => (
                        <button key={nombre} style={{ display: 'block', width: '100%', marginTop: '6px', padding: '5px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}
                          onClick={() => handleMergeDuplicateAccounts(nombre)} disabled={loading}>
                          {loading ? 'Consolidando...' : `Consolidar "${nombre}"`}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* RESUMEN siempre visible */}
                  {accounts.length > 0 && (
                    <div style={{ ...styles.accountCard, ...(selectedAccount === 'all' ? styles.accountCardSelected : {}), textAlign: 'center', marginBottom: '12px' }}
                      onClick={() => { setSelectedAccount(selectedAccount === 'all' ? null : 'all'); setSidebarOpen(false) }}>
                      <p style={{ ...styles.accountType, marginBottom: '4px' }}>📊 RESUMEN</p>
                      <p style={styles.accountName}>Resumen General</p>
                    </div>
                  )}

                  {/* EGRESOS + INGRESOS side by side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                    {/* Columna EGRESOS */}
                    <div>
                      <SectionHeader label="EGRESOS" open={egresosOpen} onToggle={() => setEgresosOpen(o => !o)} />
                      {egresosOpen && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                          {egresoCuentas.length === 0
                            ? <p style={{ ...styles.emptyText, fontSize: '11px' }}>Sin cuentas.</p>
                            : egresoCuentas.map(renderAccount)
                          }
                        </div>
                      )}
                    </div>
                    {/* Columna INGRESOS — sin flecha, siempre abierta */}
                    <div>
                      <SectionHeader label="INGRESOS" open={true} onToggle={() => {}} onAdd={() => setShowAddFuente(true)} showArrow={false} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                        {ingresoCuentas.length === 0
                          ? <p style={{ ...styles.emptyText, fontSize: '11px', cursor: 'pointer' }} onClick={() => setShowAddFuente(true)}>+ Agregar</p>
                          : ingresoCuentas.map(renderAccount)
                        }
                      </div>
                    </div>
                  </div>
                </>
              )
            })()}
            </div>{/* fin zona media scrollable */}

            {/* Zona bottom fija: botones de acción — siempre visible */}
            <div style={{ borderTop: `1px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`, paddingTop: '12px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
              {/* Registrar ingreso */}
              <button style={{ ...styles.sidebarBtnPrimary, backgroundColor: darkMode ? '#1A2E1A' : '#EAF4EA', color: darkMode ? '#6BC46B' : '#2e7d32', borderColor: darkMode ? '#2A3E2A' : '#A5D6A7' }}
                onClick={() => {
                  const fuentes = accounts.filter(a => a.tipo === 'ingreso')
                  if (fuentes.length === 0) { setShowAddFuente(true) }
                  else { setIngreso(prev => ({ ...prev, fuente_id: fuentes[0].id })); setShowIngreso(true) }
                }}>
                + REGISTRAR INGRESO
              </button>

              {/* Gasto en efectivo */}
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

              {/* Importar gastos */}
              <div style={{ position: 'relative' }}>
                <button style={styles.sidebarBtnPrimary} onClick={() => setImportMenuOpen(o => !o)}>
                  + IMPORTAR GASTOS {importMenuOpen ? '▴' : '▾'}
                </button>
                {importMenuOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px', paddingLeft: '12px' }}>
                    <button style={{ ...styles.sidebarBtnPrimary, fontSize: '12px', padding: '8px 12px' }} onClick={() => { resetUpload(); setShowUpload(true); setImportMenuOpen(false) }}>
                      📄 PDF
                    </button>
                    <button style={{ ...styles.sidebarBtnPrimary, fontSize: '12px', padding: '8px 12px' }} onClick={() => { setExcelFile(null); setExcelPreview(null); setShowExcel(true); setImportMenuOpen(false) }}>
                      📊 EXCEL
                    </button>
                  </div>
                )}
              </div>

              {/* Configuración colapsable — solo mobile (en desktop está en el header) */}
              {isMobile && (
                <>
                  <button
                    style={{ ...styles.sidebarBtnSecondary, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
                    onClick={() => setConfigOpen(o => !o)}
                  >
                    <span>⚙️ CONFIGURACIÓN</span>
                    <span style={{ fontSize: '10px', opacity: 0.7 }}>{configOpen ? '▴' : '▾'}</span>
                  </button>
                  {configOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '12px' }}>
                      <button style={styles.sidebarBtnSecondary} onClick={() => setShowAddAccount(true)}>+ CUENTA</button>
                      <button style={styles.sidebarBtnSecondary} onClick={() => setShowCategorias(true)}>+ CATEGORÍAS</button>
                      <button style={styles.sidebarBtnSecondary} onClick={() => { fetchChildren(); setShowHijos(true) }}>👧 HIJOS</button>
                      <button style={styles.sidebarBtnSecondary} onClick={() => { fetchUserAliases(); setShowAliases(true) }}>📋 REGLAS DE CLASIFICACIÓN</button>
                      <button style={styles.sidebarBtnSecondary} onClick={handleReclasificar}>🤖 RE-CLASIFICAR CON IA</button>
                    </div>
                  )}
                </>
              )}
              {isMobile && (
                <button style={{ ...styles.logoutBtn, marginTop: '4px' }} onClick={handleLogout}>Cerrar sesión</button>
              )}
            </div>
          </div>

          {/* Contenido derecho */}
          <div style={{...styles.mainContent, overflowX: 'hidden'}}>
            {selectedAccount === 'all' ? (
              <div style={{...styles.section, padding: isMobile ? '16px' : '24px'}}>
                {/* Tabs — General + hijos dinámicos */}
                <div style={{ position: 'relative', marginBottom: '24px' }}>
                  <div
                    ref={tabsScrollRef}
                    className="tabs-scroll"
                    style={{ display: 'flex', overflowX: 'auto', borderBottom: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}` }}
                  >
                    {[
                      { key: 'resumen', label: '📊 Resumen' },
                      { key: 'vencimientos', label: '📅 Vencimientos' },
                      ...childrenDB.map(c => ({ key: c.nombre, label: `👧 ${c.nombre}` }))
                    ].map(tab => (
                      <button key={tab.key}
                        data-tab={tab.key}
                        onClick={() => {
                          setDashboardTab(tab.key)
                          const el = tabsScrollRef.current?.querySelector(`[data-tab="${tab.key}"]`)
                          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
                        }}
                        style={{
                          padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                          fontSize: isMobile ? '13px' : '14px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif',
                          color: dashboardTab === tab.key ? '#5C4F5C' : '#6e6e73',
                          borderBottom: dashboardTab === tab.key ? '2px solid #5C4F5C' : '2px solid transparent',
                          marginBottom: '-2px', outline: 'none', transition: 'color 0.15s',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {/* Gradiente para indicar que hay más tabs a la derecha */}
                  <div style={{ position: 'absolute', right: 0, top: 0, height: 'calc(100% - 2px)', width: '48px', background: `linear-gradient(to right, transparent, ${darkMode ? '#2A272A' : 'white'})`, pointerEvents: 'none' }} />
                </div>

                {dashboardTab === 'resumen' && (
                  <AccountDetail accounts={accounts} allAccounts refreshKey={refreshKey} searchQuery={searchQuery} onSearchChange={setSearchQuery} tipoCambio={tipoCambio} tcMap={Object.fromEntries(exchangeRates.filter(r => r.tipo === tcTipo).map(r => [r.periodo, r.valor]))} darkMode={darkMode} onPeriodChange={setSharedPeriod} onTransactionsLoaded={setAccountTransactions} />
                )}

                {childrenDB.some(c => c.nombre === dashboardTab) && (
                  <HijoDetail hijoNombre={dashboardTab} darkMode={darkMode} tipoCambio={tipoCambio} refreshKey={refreshKey} initialPeriod={sharedPeriod} />
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: '500', color: darkMode ? '#F0EDEC' : '#1d1d1f', margin: 0 }}>
                          🔌 Servicios
                        </h3>
                        <button onClick={() => setShowAddServicio(o => !o)} style={{ padding: '6px 14px', borderRadius: '8px', border: `1.5px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'none', color: darkMode ? '#F0EDEC' : '#5C4F5C', fontSize: '13px', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif' }}>
                          + Agregar
                        </button>
                      </div>
                      {showAddServicio && (
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                          <input
                            placeholder="Nombre (ej. Gas)"
                            value={newServicio.nombre}
                            onChange={e => setNewServicio(s => ({ ...s, nombre: e.target.value }))}
                            style={{ flex: 1, minWidth: '120px', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '13px', fontFamily: '"Montserrat", sans-serif', outline: 'none' }}
                          />
                          <input
                            placeholder="Link de pago (opcional)"
                            value={newServicio.link}
                            onChange={e => setNewServicio(s => ({ ...s, link: e.target.value }))}
                            style={{ flex: 2, minWidth: '160px', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '13px', fontFamily: '"Montserrat", sans-serif', outline: 'none' }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <label style={{ fontSize: '10px', color: '#6e6e73', fontFamily: '"Montserrat", sans-serif', paddingLeft: '2px' }}>Día de vencimiento</label>
                            <input
                              type="number" min="1" max="31"
                              placeholder="ej. 15"
                              value={newServicio.vencimiento}
                              onChange={e => setNewServicio(s => ({ ...s, vencimiento: e.target.value }))}
                              style={{ width: '90px', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: darkMode ? '#1C1A1C' : '#fff', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontSize: '13px', fontFamily: '"Montserrat", sans-serif', outline: 'none' }}
                            />
                          </div>
                          <button onClick={async () => {
                            if (!newServicio.nombre.trim()) return
                            const updated = [...servicios, { id: `svc_${Date.now()}`, nombre: newServicio.nombre.trim(), link: newServicio.link.trim(), dia: newServicio.vencimiento ? parseInt(newServicio.vencimiento) : null }]
                            setServicios(updated)
                            const { data: { user } } = await supabase.auth.getUser()
                            localStorage.setItem(`servicios_${user.id}`, JSON.stringify(updated))
                            setNewServicio({ nombre: '', link: '', vencimiento: '' })
                            setShowAddServicio(false)
                          }} style={{ padding: '8px 16px', borderRadius: '8px', backgroundColor: '#5C4F5C', color: 'white', border: 'none', fontSize: '13px', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif', alignSelf: 'flex-end' }}>
                            Guardar
                          </button>
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {servicios.map((s, i) => (
                          <div key={i} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '14px 18px', borderRadius: '12px',
                            backgroundColor: darkMode ? '#2A272A' : '#F0EDEC',
                            border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`,
                          }}>
                            <div>
                              <p style={{ margin: 0, fontWeight: '500', fontSize: '15px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>{s.nombre}</p>
                              {s.vencimiento && <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#6e6e73' }}>📅 Vence el día {s.vencimiento}</p>}
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              {s.link && (
                                <a href={s.link} target="_blank" rel="noopener noreferrer" style={{
                                  padding: '8px 16px', borderRadius: '8px', backgroundColor: '#5C4F5C', color: 'white',
                                  fontSize: '13px', fontWeight: '500', textDecoration: 'none', fontFamily: '"Montserrat", sans-serif'
                                }}>
                                  Pagar →
                                </a>
                              )}
                              <button onClick={async () => {
                                const updated = servicios.filter((_, j) => j !== i)
                                setServicios(updated)
                                const { data: { user } } = await supabase.auth.getUser()
                                localStorage.setItem(`servicios_${user.id}`, JSON.stringify(updated))
                              }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', opacity: 0.5, padding: '4px' }}>
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : selectedAccount ? (
              <div style={{...styles.section, padding: isMobile ? '16px' : '24px'}}>
                <h2 style={styles.sectionTitle}>📊 {selectedAccount.nombre}</h2>
                <AccountDetail account={selectedAccount} refreshKey={refreshKey} searchQuery={searchQuery} onSearchChange={setSearchQuery} tipoCambio={tipoCambio} tcMap={Object.fromEntries(exchangeRates.filter(r => r.tipo === tcTipo).map(r => [r.periodo, r.valor]))} darkMode={darkMode} onTransactionsLoaded={setAccountTransactions} />
              </div>
            ) : (
              <div style={styles.emptyState}>
                <p style={styles.emptyStateIcon}>💳</p>
                <p style={styles.emptyStateText}>Seleccioná una cuenta para ver sus movimientos</p>
              </div>
            )}
          </div>

          {/* Widgets — solo desktop ancho (>= 1024px) */}
          {windowWidth >= 1024 && (
          <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '16px', position: 'sticky', top: '24px', alignSelf: 'flex-start' }}>
            {miniChartData.length > 0 && (
              <div style={{ backgroundColor: styles.savingsPanel.backgroundColor, borderRadius: '16px', padding: '20px 16px', boxShadow: styles.savingsPanel.boxShadow }}>
                <h3 style={styles.savingsPanelTitle}>Resumen general<br/>últimos 6 meses</h3>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={miniChartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <XAxis dataKey="mes" tick={{ fontSize: 10, fill: darkMode ? '#9A8A9A' : '#888', fontFamily: '"Montserrat", sans-serif' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={v => [`$ ${v.toLocaleString('es-AR')}`, 'Total']}
                      contentStyle={{ borderRadius: '8px', border: 'none', backgroundColor: darkMode ? '#3A333A' : '#fff', fontSize: '11px', fontFamily: '"Montserrat", sans-serif' }}
                      labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f', fontWeight: '600' }}
                      itemStyle={{ color: darkMode ? '#C8B8C8' : '#555' }}
                      cursor={{ fill: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                      {miniChartData.map((_, i) => (
                        <Cell key={i} fill={i === miniChartData.length - 1 ? '#5C4F5C' : (darkMode ? '#4A3F4A' : '#C4B8C4')} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {(() => {
              const tcMapEvol = Object.fromEntries(exchangeRates.filter(r => r.tipo === tcTipo).map(r => [r.periodo, r.valor]))
              const getTCEvol = (mes) => tcMapEvol[mes] ? Number(tcMapEvol[mes]) : (parseFloat(tipoCambio) || 1)
              const categoriasConTx = [...new Set(
                accountTransactions.filter(t => t.tipo === 'gasto' && t.categories?.nombre)
                  .map(t => t.categories.nombre)
              )].sort()
              const hijosConTx = [...new Set(
                accountTransactions.filter(t => t.tipo === 'gasto' && t.hijo)
                  .map(t => t.hijo)
              )].sort()
              const esHijo = sidebarCatEvol.startsWith('hijo:')
              const filtroValor = esHijo ? sidebarCatEvol.slice(5) : sidebarCatEvol
              const evolData = getLast6Months().map(m => {
                const tc = getTCEvol(m)
                const total = accountTransactions
                  .filter(t => {
                    if (!t.fecha?.startsWith(m) || t.tipo !== 'gasto') return false
                    return esHijo ? t.hijo === filtroValor : t.categories?.nombre === sidebarCatEvol
                  })
                  .reduce((s, t) => {
                    const monto = Number(t.monto)
                    return s + (t.moneda === 'USD' && tc > 0 ? monto * tc : t.moneda === 'ARS' ? monto : 0)
                  }, 0)
                return { mes: mesLabel(m), total }
              })
              const borderClr = darkMode ? '#3A333A' : '#E2DDE0'
              const bgClr = darkMode ? '#1C1A1C' : '#F0EDEC'
              const txtClr = darkMode ? '#F0EDEC' : '#5C4F5C'
              return (
                <div style={styles.savingsPanel}>
                  <h3 style={styles.savingsPanelTitle}>📈 Evolución por categoría</h3>
                  <select
                    style={{ padding: '7px 10px', borderRadius: '8px', border: `1px solid ${borderClr}`, fontSize: '12px', outline: 'none', backgroundColor: bgClr, color: txtClr, fontFamily: '"Montserrat", sans-serif', marginBottom: '14px', cursor: 'pointer', width: '100%' }}
                    value={sidebarCatEvol}
                    onChange={e => setSidebarCatEvol(e.target.value)}
                  >
                    <option value="">— Elegir —</option>
                    <optgroup label="Categorías">
                      {categoriasConTx.map(c => <option key={c} value={c}>{c}</option>)}
                    </optgroup>
                    {hijosConTx.length > 0 && (
                      <optgroup label="Hijos">
                        {hijosConTx.map(h => <option key={`hijo:${h}`} value={`hijo:${h}`}>👧 {h}</option>)}
                      </optgroup>
                    )}
                  </select>
                  {sidebarCatEvol ? (
                    <ResponsiveContainer width="100%" height={170}>
                      <BarChart data={evolData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                        <XAxis dataKey="mes" tick={{ fontSize: 9, fill: '#6e6e73', fontFamily: '"Montserrat", sans-serif' }} />
                        <YAxis tick={{ fontSize: 9, fill: '#6e6e73', fontFamily: '"Montserrat", sans-serif' }} tickFormatter={v => `$${new Intl.NumberFormat('es-AR', {maximumFractionDigits: 0}).format(v)}`} width={65} />
                        <Tooltip formatter={(v) => [`$ ${formatMontoFull(v)}`, esHijo ? `👧 ${filtroValor}` : sidebarCatEvol]} contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: bgClr, border: `1px solid ${borderClr}`, fontSize: '11px' }} />
                        <Bar dataKey="total" fill="#5C4F5C" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p style={{ color: '#aaa', fontSize: '12px', margin: 0 }}>Seleccioná una categoría o hijo para ver su evolución.</p>
                  )}
                </div>
              )
            })()}
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
              const tc = parseFloat(tipoCambio)
              const fmt = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(v))
              const totalUSD = ahorro.moneda === 'USD' ? total : (tc > 0 ? total / tc : null)
              const totalARS = ahorro.moneda === 'ARS' ? total : (tc > 0 ? total * tc : null)
              return (
                <div style={styles.savingsResult}>
                  <p style={styles.savingsResultPhrase}>Para {anioFin} tendrías</p>
                  {tasa > 0 && <p style={{ ...styles.savingsResultNote, marginBottom: '10px' }}>interés compuesto mensual</p>}
                  <p style={styles.savingsResultLabel}>Final equiv. en USD</p>
                  <p style={{ ...styles.savingsResultAmount, fontSize: '18px', marginBottom: '12px' }}>
                    {totalUSD != null ? `U$S ${fmt(totalUSD)}` : '—'}
                  </p>
                  <p style={styles.savingsResultLabel}>Final equiv. en pesos</p>
                  <p style={{ ...styles.savingsResultAmount, fontSize: '18px', marginBottom: 0 }}>
                    {totalARS != null ? `$ ${fmt(totalARS)}` : '—'}
                  </p>
                </div>
              )
            })()}
          </div>
          </div>
          )}

        </div>
      </div>

      {/* Modales */}
      {/* Modal hijos */}
      {showHijos && (
        <div style={styles.overlay}>
          <div style={{ ...styles.modal, maxWidth: '400px' }}>
            <h3 style={styles.modalTitle}>👧 Hijos / personas</h3>
            <div style={{ maxHeight: '280px', overflowY: 'auto', marginBottom: '16px' }}>
              {childrenDB.length === 0 ? (
                <p style={{ color: '#aaa', fontSize: '13px', textAlign: 'center', padding: '16px 0' }}>Sin hijos registrados.</p>
              ) : (
                childrenDB.map(c => (
                  <div key={c.nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${darkMode ? '#3A333A' : '#EDE8EC'}` }}>
                    <span style={{ fontSize: '14px', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>👧 {c.nombre}</span>
                    <button style={styles.actionBtn} onClick={() => handleDeleteHijo(c.nombre)}>🗑️</button>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleAddHijo} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <input
                style={{ ...styles.input, flex: 1 }}
                placeholder="Agregar nombre..."
                value={newHijoNombre}
                onChange={e => setNewHijoNombre(e.target.value)}
              />
              <button type="submit" style={{ ...styles.saveBtn, flex: 'none', padding: '12px 20px' }}>+</button>
            </form>
            <div style={{ textAlign: 'right' }}>
              <button style={styles.cancelBtn} onClick={() => setShowHijos(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

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
                        <button style={styles.actionBtn} onClick={() => handleDeleteCategoria(cat)}>🗑️</button>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginLeft: '4px' }}>
                    {subcategoriasDB.filter(s => s.category_id === cat.id).map(s => (
                      <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '12px', backgroundColor: darkMode ? '#3A303A' : '#EDE8EC', borderRadius: '6px', padding: '2px 8px', color: darkMode ? '#C0B0C0' : '#5C4F5C' }}>
                        {s.nombre}
                        <button onClick={() => handleDeleteSubcat(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: '#999', padding: '0 0 0 2px', lineHeight: 1 }}>×</button>
                      </span>
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
              {!confirmDelete && (
                <button
                  type="button"
                  style={{ marginTop: '12px', width: '100%', padding: '10px', background: 'none', border: `1px solid #e74c3c`, borderRadius: '10px', color: '#e74c3c', cursor: 'pointer', fontSize: '13px', fontFamily: '"Montserrat", sans-serif' }}
                  onClick={() => setConfirmDelete(editAccount.id)}
                >
                  🗑️ Eliminar esta cuenta
                </button>
              )}
              {confirmDelete && (
                <div style={{ marginTop: '12px', background: '#e74c3c11', border: '1px solid #e74c3c44', borderRadius: '10px', padding: '12px' }}>
                  <p style={{ fontSize: '13px', color: '#e74c3c', margin: '0 0 10px 0', fontWeight: '500' }}>⚠️ Se borrarán todos los extractos y transacciones. ¿Confirmar?</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...styles.cancelBtn, flex: 1, padding: '8px' }} onClick={() => setConfirmDelete(null)}>No, cancelar</button>
                    <button style={{ flex: 1, padding: '8px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontFamily: '"Montserrat", sans-serif' }}
                      onClick={() => { handleDeleteAccount(confirmDelete); setEditAccount(null) }} disabled={loading}>
                      {loading ? 'Eliminando...' : 'Sí, eliminar'}
                    </button>
                  </div>
                </div>
              )}
            </form>
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
                  {statementData?.tipo_documento === 'banco' ? 'Revisá los movimientos del banco 🏦' : 'Elegí qué importar ✅'}
                </h3>
                <div style={styles.previewStats}>
                  <div style={styles.previewStat}><span style={styles.previewStatLabel}>Período</span><span style={styles.previewStatValue}>{statementData.periodo}</span></div>
                  <div style={styles.previewStat}><span style={styles.previewStatLabel}>Total ARS</span><span style={styles.previewStatValue}>$ {formatMonto(statementData.total_pesos)}</span></div>
                  <div style={styles.previewStat}><span style={styles.previewStatLabel}>Vencimiento</span><span style={styles.previewStatValue}>{statementData.fecha_vencimiento}</span></div>
                  <div style={styles.previewStat}><span style={styles.previewStatLabel}>Seleccionadas</span><span style={styles.previewStatValue}>{pdfTxSelections.size} / {statementData.transacciones.length}</span></div>
                </div>
                {pdfTxDuplicadas.size > 0 && (
                  <div style={{ fontSize: '12px', color: '#8e8e93', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Las tachadas ya podrían estar cargadas. Marcalas si querés importarlas igual.</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => setPdfTxSelections(new Set(statementData.transacciones.map((_, i) => i)))} style={{ background: 'none', border: 'none', color: '#7c5cbf', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>Seleccionar todo</button>
                      <button onClick={() => setPdfTxSelections(new Set())} style={{ background: 'none', border: 'none', color: '#7c5cbf', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>Ninguna</button>
                    </div>
                  </div>
                )}
                <div style={{ ...styles.transactionsList, maxHeight: '320px', overflowY: 'auto' }}>
                  {statementData.transacciones.map((t, i) => {
                    const isDupe = pdfTxDuplicadas.has(i)
                    const isSelected = pdfTxSelections.has(i)
                    return (
                      <div key={i}
                        onClick={() => {
                          const next = new Set(pdfTxSelections)
                          isSelected ? next.delete(i) : next.add(i)
                          setPdfTxSelections(next)
                        }}
                        style={{ ...styles.transactionItem, cursor: 'pointer', opacity: isDupe && !isSelected ? 0.45 : 1,
                          textDecoration: isDupe && !isSelected ? 'line-through' : 'none',
                          backgroundColor: isSelected ? undefined : isDupe ? 'rgba(0,0,0,0.05)' : undefined }}>
                        <input type="checkbox" checked={isSelected} readOnly
                          style={{ marginRight: '10px', accentColor: '#7c5cbf', flexShrink: 0, cursor: 'pointer' }} />
                        <div style={styles.transactionLeft}>
                          <p style={{ ...styles.transactionName, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {t.nombre_limpio || t.nombre_original}
                            {t.nombre_limpio === t.nombre_original && <span style={{ textDecoration: 'none' }}>❓</span>}
                            {isDupe && <span style={{ textDecoration: 'none', fontSize: '10px', color: '#8e8e93', background: 'rgba(0,0,0,0.1)', borderRadius: '4px', padding: '1px 5px' }}>ya cargada</span>}
                          </p>
                          <p style={styles.transactionDetail}>{t.fecha} · {t.categoria_sugerida}{t.cuotas_total > 1 && ` · Cuota ${t.cuota_numero}/${t.cuotas_total}`}{separarAdicionales && t.titular && ` · ${t.titular}`}</p>
                        </div>
                        <p style={{ ...styles.transactionMonto, color: t.es_credito ? '#27AE60' : undefined }}>
                          {t.es_credito ? '+' : '-'} {t.moneda === 'USD' ? 'U$S' : '$'} {formatMonto(t.monto)}
                        </p>
                      </div>
                    )
                  })}
                </div>
                {statementData.transacciones.some((t, i) => pdfTxSelections.has(i) && t.categoria_sugerida === 'A Identificar') && (
                  <div style={styles.warningBox}>
                    ❓ Hay {statementData.transacciones.filter((t, i) => pdfTxSelections.has(i) && t.categoria_sugerida === 'A Identificar').length} transacciones sin identificar entre las seleccionadas. Te vamos a pedir que las clasifiques antes de cerrar.
                  </div>
                )}
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => setStep(statementData?.tipo_documento === 'banco' ? 'upload' : 'select_account')}>← Atrás</button>
                  <button style={styles.saveBtn} onClick={handleConfirmTransactions} disabled={loading || pdfTxSelections.size === 0}>
                    {loading ? 'Guardando...' : `Importar ${pdfTxSelections.size} transacción${pdfTxSelections.size !== 1 ? 'es' : ''}`}
                  </button>
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
                {contextoAskingHijoNombre ? (
                  <>
                    <div style={styles.field}>
                      <label style={styles.label}>¿Cómo se llama? <span style={{fontSize:'11px', color:'#aaa'}}>(opcional)</span></label>
                      <input
                        style={styles.input}
                        placeholder="Ej: Valentina, Mateo..."
                        value={contextoHijoNombre}
                        onChange={e => setContextoHijoNombre(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div style={styles.modalButtons}>
                      <button style={styles.cancelBtn} onClick={() => { setContextoAskingHijoNombre(false); setContextoHijoNombre(''); avanzarContexto() }}>
                        Omitir
                      </button>
                      <button style={styles.saveBtn} onClick={handleGuardarHijoDesdeContexto}>
                        Guardar ✓
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={styles.modalButtons}>
                    <button style={styles.cancelBtn} onClick={() => handleConfirmarContexto(false)}>
                      No, ignorar
                    </button>
                    <button style={styles.saveBtn} onClick={() => handleConfirmarContexto(true)}>
                      Sí, tener en cuenta ✓
                    </button>
                  </div>
                )}
              </>
            )}

          </div>
        </div>
      )}

      {showAliases && (
        <div style={styles.overlay}>
          <div style={{ ...styles.modal, maxWidth: '580px' }}>
            <h3 style={styles.modalTitle}>📋 Reglas de clasificación</h3>
            <p style={{ fontSize: '13px', color: '#6e6e73', margin: '-12px 0 16px 0' }}>
              Enseñale a la IA cómo clasificar tus gastos. Estas reglas se aplican siempre, sin importar cómo cargues los datos.
            </p>
            <div style={{ maxHeight: '280px', overflowY: 'auto', marginBottom: '16px' }}>
              {userAliases.length === 0 ? (
                <p style={{ color: '#aaa', fontSize: '13px', textAlign: 'center', padding: '24px 0' }}>Sin reglas. Agregá la primera abajo.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      {['Palabra clave', 'Tipo', 'Valor', ''].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`, color: '#6e6e73', fontWeight: '400', fontSize: '11px', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {userAliases.map(a => (
                      <tr key={a.id} style={{ borderBottom: `1px solid ${darkMode ? '#3A333A' : '#EDE8EC'}` }}>
                        <td style={{ padding: '8px', fontFamily: 'monospace', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontWeight: '600', fontSize: '12px' }}>{a.alias}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{ backgroundColor: a.tipo === 'hijo' ? (darkMode ? '#1B3A1B' : '#E8F5E9') : a.tipo === 'cuenta' ? (darkMode ? '#1A2D3A' : '#E3F2FD') : (darkMode ? '#2D1F2D' : '#F3E5F5'), color: '#5C4F5C', padding: '2px 8px', borderRadius: '6px', fontSize: '11px' }}>{a.tipo}</span>
                        </td>
                        <td style={{ padding: '8px', color: '#6e6e73', fontSize: '13px' }}>{a.valor}{a.descripcion ? ` · ${a.descripcion}` : ''}</td>
                        <td style={{ padding: '8px' }}>
                          <button style={styles.actionBtn} onClick={() => handleDeleteAlias(a.id)}>🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <form onSubmit={handleAddAlias} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr auto', gap: '8px', alignItems: 'end', marginBottom: '20px' }}>
              <div>
                <label style={styles.label}>Palabra clave</label>
                <input style={styles.input} placeholder="ej. OSDE, DISCO, UBER" value={newAlias.alias} onChange={e => setNewAlias({...newAlias, alias: e.target.value})} />
              </div>
              <div>
                <label style={styles.label}>Tipo</label>
                <select style={styles.input} value={newAlias.tipo} onChange={e => setNewAlias({...newAlias, tipo: e.target.value})}>
                  <option value="categoria">Cat.</option>
                  <option value="hijo">Hijo/a</option>
                  <option value="cuenta">Cuenta</option>
                </select>
              </div>
              <div>
                <label style={styles.label}>{newAlias.tipo === 'hijo' ? 'Nombre del hijo/a' : newAlias.tipo === 'cuenta' ? 'Nombre de la cuenta' : 'Categoría asignada'}</label>
                <input style={styles.input} placeholder={newAlias.tipo === 'hijo' ? 'ej. Amelia' : newAlias.tipo === 'cuenta' ? 'ej. Tarjeta Visa' : 'ej. Salud'} value={newAlias.valor} onChange={e => setNewAlias({...newAlias, valor: e.target.value})} />
              </div>
              <button type="submit" style={{ ...styles.saveBtn, padding: '11px 18px', marginTop: '20px' }}>+</button>
            </form>
            <div style={{ textAlign: 'right' }}>
              <button style={styles.cancelBtn} onClick={() => setShowAliases(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {showExcel && excelDupReview && (
        <div style={styles.overlay}>
          <div style={{ ...styles.modal, maxWidth: '640px', maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={styles.modalTitle}>⚠️ Posibles duplicados</h3>
            <p style={{ fontSize: '13px', color: darkMode ? '#9A8A9A' : '#6e6e73', margin: '-12px 0 16px 0' }}>
              {excelDupReview.potentialDupes.length} transacción{excelDupReview.potentialDupes.length !== 1 ? 'es' : ''} con mismo monto y fecha que algo ya cargado.
              Marcá las que querés importar igual.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', paddingBottom: '12px', borderBottom: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
              {(() => {
                const allSelected = excelDupReview.potentialDupes.every((_, i) => excelDupSelections.has(i))
                return (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: darkMode ? '#F0EDEC' : '#1d1d1f', fontWeight: '500' }}>
                    <input type="checkbox" checked={allSelected} onChange={() => {
                      if (allSelected) setExcelDupSelections(new Set())
                      else setExcelDupSelections(new Set(excelDupReview.potentialDupes.map((_, i) => i)))
                    }} style={{ accentColor: '#5C4F5C', width: '16px', height: '16px' }} />
                    {allSelected ? 'Deseleccionar todas' : 'Seleccionar todas'}
                  </label>
                )
              })()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
              {excelDupReview.potentialDupes.map((item, i) => {
                const checked = excelDupSelections.has(i)
                return (
                  <div key={i} style={{ border: `1px solid ${checked ? '#5C4F5C' : (darkMode ? '#3A333A' : '#E2DDE0')}`, borderRadius: '10px', padding: '12px 14px', backgroundColor: checked ? (darkMode ? '#2A202A' : '#F5F0F5') : (darkMode ? '#1C1A1C' : '#fafafa'), cursor: 'pointer' }}
                    onClick={() => {
                      const next = new Set(excelDupSelections)
                      if (next.has(i)) next.delete(i); else next.add(i)
                      setExcelDupSelections(next)
                    }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <input type="checkbox" checked={checked} onChange={() => {}} style={{ marginTop: '2px', accentColor: '#5C4F5C', width: '16px', height: '16px', flexShrink: 0 }} />
                      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div>
                          <p style={{ fontSize: '10px', color: '#6e6e73', margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ya existe</p>
                          <p style={{ fontSize: '12px', color: darkMode ? '#F0EDEC' : '#1d1d1f', margin: '0 0 2px 0', fontWeight: '500' }}>{item.existing.detalle || item.existing.nombre || '—'}</p>
                          <p style={{ fontSize: '11px', color: '#6e6e73', margin: 0 }}>{item.existing.fecha} · $ {Number(item.existing.monto).toLocaleString('es-AR')}</p>
                        </div>
                        <div>
                          <p style={{ fontSize: '10px', color: '#6e6e73', margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>En el Excel</p>
                          <p style={{ fontSize: '12px', color: darkMode ? '#F0EDEC' : '#1d1d1f', margin: '0 0 2px 0', fontWeight: '500' }}>{item.row.notas || item.row.descripcion || '—'}</p>
                          <p style={{ fontSize: '11px', color: '#6e6e73', margin: 0 }}>{item.row.fecha} · {item.row.moneda === 'USD' ? 'U$S' : '$'} {Number(item.row.monto).toLocaleString('es-AR')}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {excelDupReview.newRows.length > 0 && (
              <p style={{ fontSize: '12px', color: darkMode ? '#9A8A9A' : '#6e6e73', marginBottom: '16px' }}>
                ✅ {excelDupReview.newRows.length} transacción{excelDupReview.newRows.length !== 1 ? 'es' : ''} nueva{excelDupReview.newRows.length !== 1 ? 's' : ''} se importarán automáticamente.
              </p>
            )}
            <div style={styles.modalButtons}>
              <button style={styles.cancelBtn} onClick={() => setExcelDupReview(null)}>← Atrás</button>
              <button style={styles.saveBtn} onClick={handleImportarFinal} disabled={loadingExcel}>
                {loadingExcel ? 'Importando...' : `Confirmar importación`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExcel && !excelDupReview && (
        <div style={styles.overlay}>
          <div style={{ ...styles.modal, maxWidth: '600px' }}>
            {excelPreview === null ? (
              <>
                <h3 style={styles.modalTitle}>Importar Excel 📊</h3>
                {loadingExcel ? (() => {
                  const excelCurrentMsg = EXCEL_PROCESSING_MSGS[excelMsgIndex]
                  const elapsed = excelTimerMax - excelTimer
                  const secsPerBatch = excelTotalBatches > 0 ? excelTimerMax / excelTotalBatches : 5
                  const currentBatch = excelTotalBatches > 0
                    ? Math.min(excelTotalBatches, Math.floor(elapsed / secsPerBatch) + 1)
                    : 1
                  const barPct = excelTimerMax > 0 ? (excelTimer / excelTimerMax) * 100 : 0
                  return (
                    <div style={styles.processingContainer}>
                      <p style={styles.processingIcon}>{excelCurrentMsg.icon}</p>
                      <h3 style={styles.processingTitle}>{excelCurrentMsg.title}</h3>
                      <p style={styles.processingText}>
                        {excelTotalBatches > 0
                          ? `Clasificando batch ${currentBatch} de ${excelTotalBatches}...`
                          : excelCurrentMsg.desc}
                      </p>
                      <div style={styles.processingDots}>
                        {EXCEL_PROCESSING_MSGS.map((_, i) => (
                          <div key={i} style={{ ...styles.dot, ...(i === excelMsgIndex ? styles.dotActive : {}) }} />
                        ))}
                      </div>
                      <div style={styles.timerBar}>
                        <div style={{ ...styles.timerFill, width: `${barPct}%`, backgroundColor: excelTimer < 10 ? '#e07b39' : '#5C4F5C' }} />
                      </div>
                      <p style={styles.timerText}>{excelTimer}s restantes</p>
                      {excelBackgroundMode && (
                        <p style={{ fontSize: '12px', color: '#8e8e93', marginTop: '8px', textAlign: 'center' }}>
                          🔄 Esto está tardando más de lo esperado. El procesamiento continúa en segundo plano...
                        </p>
                      )}
                    </div>
                  )
                })() : (
                  <>
                    <p style={{ fontSize: '13px', color: '#6e6e73', margin: '-12px 0 16px 0' }}>
                      El archivo debe tener una hoja llamada <strong>GASTOS</strong>.
                    </p>
                    <div
                      style={{ ...styles.dropzone, ...(excelDragOver ? styles.dropzoneActive : {}), ...(excelFile ? styles.dropzoneDone : {}) }}
                      onDragOver={e => { e.preventDefault(); setExcelDragOver(true) }}
                      onDragLeave={() => setExcelDragOver(false)}
                      onDrop={e => { e.preventDefault(); setExcelDragOver(false); const f = e.dataTransfer.files[0]; if (f?.name.endsWith('.xlsx')) setExcelFile(f); else showToast('Solo se aceptan archivos .xlsx', 'error') }}
                      onClick={() => document.getElementById('excelInput').click()}
                    >
                      {excelFile ? (
                        <><p style={styles.dropzoneIcon}>✅</p><p style={styles.dropzoneText}>{excelFile.name}</p><p style={styles.dropzoneHint}>Clickeá para cambiar</p></>
                      ) : (
                        <><p style={styles.dropzoneIcon}>📊</p><p style={styles.dropzoneText}>Arrastrá el archivo .xlsx o clickeá para seleccionar</p><p style={styles.dropzoneHint}>Solo archivos Excel (.xlsx)</p></>
                      )}
                    </div>
                    <input id="excelInput" type="file" accept=".xlsx" style={{ display: 'none' }}
                      onChange={e => { if (e.target.files[0]) setExcelFile(e.target.files[0]) }} />
                    <div style={styles.modalButtons}>
                      <button style={styles.cancelBtn} onClick={() => setShowExcel(false)}>Cancelar</button>
                      <button style={styles.saveBtn} onClick={handleAnalizarExcel} disabled={!excelFile}>
                        Analizar
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <h3 style={styles.modalTitle}>Revisá las transacciones ✅</h3>
                <p style={{ fontSize: '13px', color: '#6e6e73', margin: '-12px 0 16px 0' }}>
                  {excelPreview.length} filas encontradas · mostrando primeras 10
                </p>
                <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr>
                        {['Fecha', 'Descripción', 'Cuenta', 'Monto', 'Categoría', 'Hijo'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '7px 10px', borderBottom: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`, color: '#6e6e73', fontWeight: '400', textTransform: 'uppercase', fontSize: '11px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {excelPreview.slice(0, 10).map((row, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${darkMode ? '#3A333A' : '#f0f2f8'}` }}>
                          <td style={{ padding: '7px 10px', color: darkMode ? '#F0EDEC' : '#1d1d1f', whiteSpace: 'nowrap' }}>{row.fecha}</td>
                          <td style={{ padding: '7px 10px', color: darkMode ? '#F0EDEC' : '#1d1d1f', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.nombre || row.notas || '—'}</td>
                          <td style={{ padding: '7px 10px', color: '#6e6e73', whiteSpace: 'nowrap', fontSize: '11px' }}>{row.modo_pago || 'Efectivo'}</td>
                          <td style={{ padding: '7px 10px', fontWeight: '600', whiteSpace: 'nowrap', color: darkMode ? '#F0EDEC' : '#2d2d2d' }}>
                            {row.moneda === 'USD' ? 'U$S' : '$'} {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(row.monto)}
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            {row.cat && row.cat !== 'A Identificar' ? (
                              <span style={{ backgroundColor: darkMode ? '#3A333A' : '#EDE8EC', color: '#5C4F5C', padding: '2px 8px', borderRadius: '10px', fontWeight: '500' }}>{row.cat}</span>
                            ) : (
                              <span style={{ backgroundColor: '#fff8e1', color: '#856404', padding: '2px 8px', borderRadius: '10px', fontWeight: '500' }}>❓ Sin identificar</span>
                            )}
                          </td>
                          <td style={{ padding: '7px 10px', color: '#6e6e73', whiteSpace: 'nowrap' }}>{row.hijo || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {excelPreview.filter(r => !r.cat || r.cat === 'A Identificar').length > 0 && (
                  <div style={{ backgroundColor: '#fff8e1', border: '1px solid #ffe082', borderRadius: '10px', padding: '10px 14px', fontSize: '13px', color: '#856404', marginBottom: '16px' }}>
                    ❓ {excelPreview.filter(r => !r.cat || r.cat === 'A Identificar').length} fila(s) sin categoría — se guardarán como "A identificar".
                  </div>
                )}
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => setExcelPreview(null)}>← Atrás</button>
                  <button style={styles.saveBtn} onClick={handleImportarExcel} disabled={loadingExcel}>
                    {loadingExcel ? 'Importando...' : `Confirmar e importar (${excelPreview.length})`}
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

      {/* Modal: nueva fuente de ingreso */}
      {showAddFuente && (
        <div style={styles.overlay}>
          <div style={{ ...styles.modal, maxWidth: '380px', width: '90%' }}>
            <h3 style={styles.modalTitle}>Nueva fuente de ingreso 💰</h3>
            <form onSubmit={handleAddFuente}>
              <div style={styles.field}>
                <label style={styles.label}>Nombre <span style={{ color: '#c0392b' }}>*</span></label>
                <input style={styles.input} type="text" value={newFuente}
                  onChange={e => setNewFuente(e.target.value)}
                  placeholder="Ej: Sueldo, Freelance, Cuota alimentaria..."
                  required autoFocus />
              </div>
              <div style={styles.modalButtons}>
                <button type="button" style={styles.cancelBtn} onClick={() => setShowAddFuente(false)}>Cancelar</button>
                <button type="submit" style={styles.saveBtn} disabled={loading}>
                  {loading ? 'Creando...' : 'Crear fuente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: registrar ingreso */}
      {showIngreso && (
        <div style={styles.overlay}>
          <div style={{ ...styles.modal, maxWidth: '440px', width: '90%' }}>
            <h3 style={styles.modalTitle}>+ Registrar ingreso 💰</h3>
            <form onSubmit={handleGuardarIngreso}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={styles.field}>
                  <label style={styles.label}>Fecha <span style={{ color: '#c0392b' }}>*</span></label>
                  <input style={styles.input} type="date" value={ingreso.fecha}
                    onChange={e => setIngreso({ ...ingreso, fecha: e.target.value })} required />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Moneda <span style={{ color: '#c0392b' }}>*</span></label>
                  <select style={styles.input} value={ingreso.moneda}
                    onChange={e => setIngreso({ ...ingreso, moneda: e.target.value })}>
                    <option value="ARS">$ ARS</option>
                    <option value="USD">U$S USD</option>
                    <option value="EUR">€ EUR</option>
                  </select>
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Descripción <span style={{ color: '#c0392b' }}>*</span></label>
                <input style={styles.input} type="text" value={ingreso.nombre}
                  onChange={e => setIngreso({ ...ingreso, nombre: e.target.value })}
                  placeholder="Ej: Sueldo mayo, pago cliente X..." required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Monto <span style={{ color: '#c0392b' }}>*</span></label>
                <input style={styles.input} type="number" step="0.01" min="0" value={ingreso.monto}
                  onChange={e => setIngreso({ ...ingreso, monto: e.target.value })}
                  placeholder="0.00" required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Fuente de ingreso <span style={{ color: '#c0392b' }}>*</span></label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select style={{ ...styles.input, flex: 1 }} value={ingreso.fuente_id}
                    onChange={e => setIngreso({ ...ingreso, fuente_id: e.target.value })} required>
                    <option value="">— Elegir —</option>
                    {accounts.filter(a => a.tipo === 'ingreso').map(a => (
                      <option key={a.id} value={a.id}>{a.nombre}</option>
                    ))}
                  </select>
                  <button type="button"
                    style={{ padding: '9px 12px', borderRadius: '10px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'none', color: darkMode ? '#9A8A9A' : '#5C4F5C', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap', fontFamily: '"Montserrat", sans-serif' }}
                    onClick={() => setShowAddFuente(true)}>
                    + Nueva
                  </button>
                </div>
              </div>
              <div style={styles.modalButtons}>
                <button type="button" style={styles.cancelBtn} onClick={() => setShowIngreso(false)}>Cancelar</button>
                <button type="submit" style={styles.saveBtn} disabled={loading}>
                  {loading ? 'Guardando...' : 'Guardar ingreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '12px 24px', borderRadius: '12px',
          backgroundColor: toast.type === 'error' ? '#c0392b' : toast.type === 'warning' ? '#c07a2b' : '#2e8b6a',
          color: 'white', fontSize: '14px', fontWeight: '500',
          fontFamily: '"Montserrat", sans-serif',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          maxWidth: '90vw', textAlign: 'center',
          animation: 'fadeInUp 0.2s ease'
        }}>
          {toast.type === 'error' ? '⚠️ ' : toast.type === 'warning' ? '⚠️ ' : '✅ '}{toast.msg}
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
      gap: '10px', alignSelf: 'flex-start',
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
      backgroundColor: panel, borderRadius: '16px',
      padding: '20px 16px', boxShadow: shadow, display: 'flex', flexDirection: 'column',
      gap: '0px',
    },
    savingsPanelTitle: { fontSize: '14px', fontWeight: '400', color: txt, margin: '0 0 16px 0', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center' },
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