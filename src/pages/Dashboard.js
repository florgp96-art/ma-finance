import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { extractTextFromPDF, analyzeStatementWithClaude, analyzePdfDocumentWithClaude } from '../lib/pdfReader'
import { dividirTresVias } from '../lib/divisionTresVias'
import AccountDetail, { getLast6Months, mesLabel, formatMontoFull, subcategoriasDeIngreso, resolveCategoryColor, resolveCategoryIcon } from '../components/AccountDetail'
import HijoDetail from '../components/HijoDetail'
import ConfigPanel from '../components/ConfigPanel'
import CashView from '../components/CashView'
import * as XLSX from 'xlsx'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
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

const parseCuotaDesc = (texto) => {
  const t = texto || ''
  let m = t.match(/(\d+)\s*\/\s*(\d+)\s*\)?\s*$/)
  if (!m) m = t.match(/cuota\s*(\d+)\s*(?:de|\/)\s*(\d+)/i)
  if (!m) return { cuota_numero: 1, cuotas_total: 1 }
  const num = parseInt(m[1]), total = parseInt(m[2])
  if (num >= 1 && total >= 1 && num <= total && total <= 48) return { cuota_numero: num, cuotas_total: total }
  return { cuota_numero: 1, cuotas_total: 1 }
}

// Excel: cada fila de una compra en cuotas suele traer la fecha de la compra
// original repetida, no la del mes que factura esa cuota puntual — se corrige
// sumando (cuota_numero - 1) meses a esa fecha.
const addMonths = (fechaISO, n) => {
  if (!fechaISO || !n) return fechaISO
  const d = new Date(fechaISO + 'T00:00:00')
  d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}

// Supabase/PostgREST limita a 1000 filas por consulta si no se pagina. Las cuentas con
// mucho historial superan eso fácil, así que una consulta sin paginar puede devolver solo
// una porción de las transacciones existentes — rompiendo silenciosamente cualquier
// comparación (ej. detección de duplicados) que dependa de "todo lo que ya está cargado".
const fetchAllTxPages = async (buildQuery) => {
  const PAGE = 1000
  let all = []
  let page = 0
  while (true) {
    const { data } = await buildQuery().range(page * PAGE, (page + 1) * PAGE - 1)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    page++
  }
  return all
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [userEmail, setUserEmail] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data?.user?.email ?? null))
  }, [])

  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ nombre: '', tipo: 'credito' })
  const [editAccount, setEditAccount] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [hoveredAccount, setHoveredAccount] = useState(null)

  const [archivo, setArchivo] = useState(null)
  const [toast, setToast] = useState(null)
  // eslint-disable-next-line no-unused-vars
  const [_miniChartUnused, _setMiniChart] = useState([])
  const [miniChartMeses, setMiniChartMeses] = useState([])
  const [miniChartTxs, setMiniChartTxs] = useState([])
  const [servicios, setServicios] = useState(SERVICIOS_DEFAULT)
  const [newServicio, setNewServicio] = useState({ nombre: '', link: '', vencimiento: '' })
  const [showAddServicio, setShowAddServicio] = useState(false)
  const [cuotasPendientesExpandido, setCuotasPendientesExpandido] = useState(null)
  const toastTimeoutRef = useRef(null)
  const showToast = (msg, type = 'success') => {
    clearTimeout(toastTimeoutRef.current)
    setToast({ msg, type })
    toastTimeoutRef.current = setTimeout(() => setToast(null), type === 'error' ? 12000 : 3500)
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

  // Modal cargar movimiento (gasto / ingreso / neutro)
  const [showMovimiento, setShowMovimiento] = useState(false)
  const [tipoMovimiento, setTipoMovimiento] = useState('gasto')
  const [cuentaEfectivoId, setCuentaEfectivoId] = useState(null)
  const [efectivo, setEfectivo] = useState({ fecha: new Date().toISOString().slice(0,10), nombre: '', monto: '', moneda: 'ARS', categoria: '', subcategoria: '', nota: '', hijo: '' })

  // Widget ahorro — persiste en localStorage
  const [ahorro, setAhorro] = useState(() => {
    try {
      const saved = localStorage.getItem('ma_ahorro')
      return saved ? JSON.parse(saved) : { monto: '', moneda: 'USD', anos: '', tasa: '' }
    } catch { return { monto: '', moneda: 'USD', anos: '', tasa: '' } }
  })
  const [cuentasAhorro, setCuentasAhorro] = useState(() => {
    try { const s = localStorage.getItem('ma_cuentas_ahorro'); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  const [showAddCuentaAhorro, setShowAddCuentaAhorro] = useState(false)
  const [newCuentaAhorro, setNewCuentaAhorro] = useState({ cuenta: '', monto: '', moneda: 'ARS' })

  // Categorías

  // Tipo de cambio
  const [tipoCambio, setTipoCambio] = useState(() => localStorage.getItem('tc_ma') || '')
  const [tipoCambioEUR, setTipoCambioEUR] = useState(() => localStorage.getItem('tc_eur') || '')
  const [tcTipo, setTcTipo] = useState(() => localStorage.getItem('tc_tipo_ma') || 'blue')
  const [exchangeRates, setExchangeRates] = useState([])
  const [dolarRates, setDolarRates] = useState({})
  // Tipo de cambio manual (setting editable por el usuario, opcional): si está
  // activado, se usa en vez de la cotización automática para los totales
  // combinados ARS+USD (Resúmenes mensuales, A pagar).
  const [tcManual, setTcManual] = useState(() => {
    try { const s = localStorage.getItem('tc_manual_ma'); return s ? JSON.parse(s) : { valor: null, enabled: false } } catch { return { valor: null, enabled: false } }
  })
  const tipoCambioEfectivo = (tcManual?.enabled && tcManual?.valor) ? String(tcManual.valor) : tipoCambio
  // tcMap/tcMapEUR: promedio por mes de cada tipo de dólar/euro, para convertir
  // movimientos históricos en USD/EUR con el TC de su propio mes (ver tcDeMovimiento
  // en AccountDetail.js), en vez del TC de hoy. Antes se reconstruían con
  // Object.fromEntries(exchangeRates.filter(...).map(...)) en varios puntos del
  // render (incluso una vez POR TRANSACCIÓN dentro de un reduce) — memoizados acá una
  // sola vez, misma lógica, para que solo se recalculen cuando cambian las
  // cotizaciones cargadas o el tipo de dólar elegido.
  const tcMap = useMemo(() => Object.fromEntries(exchangeRates.filter(r => r.tipo === tcTipo).map(r => [r.periodo, r.valor])), [exchangeRates, tcTipo])
  const tcMapEUR = useMemo(() => Object.fromEntries(exchangeRates.filter(r => r.tipo === 'euro').map(r => [r.periodo, r.valor])), [exchangeRates])
  const guardarTipoCambioManual = (valor) => {
    setTcManual(valor)
    try { localStorage.setItem('tc_manual_ma', JSON.stringify(valor)) } catch {}
    persistPref('tc_manual', valor)
  }

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkmode_ma') === 'true')
  const [dashboardTab, setDashboardTab] = useState('resumen')
  const tabsScrollRef = useRef(null)
  const [sharedPeriod, setSharedPeriod] = useState([])
  const [selectedHijoNombre, setSelectedHijoNombre] = useState(null)
  const [hijosResumenMes, setHijosResumenMes] = useState({})

  // Excel import
  const [showExcel, setShowExcel] = useState(false)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [cuentasOpen, setCuentasOpen] = useState(true)
  const [excelFile, setExcelFile] = useState(null)
  const [excelPreview, setExcelPreview] = useState(null)
  const updateExcelPreviewRow = (index, changes) =>
    setExcelPreview(prev => prev.map((r, i) => i === index ? { ...r, ...changes } : r))
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
  const [windowHeight, setWindowHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 800)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Hijos
  const [childrenDB, setChildrenDB] = useState([])
  const [tieneHijos, setTieneHijos] = useState(null)
  const [contextoAskingHijoNombre, setContextoAskingHijoNombre] = useState(false)
  const [contextoHijoNombre, setContextoHijoNombre] = useState('')

  useEffect(() => {
    if (childrenDB.length === 0) return
    if (!selectedHijoNombre || !childrenDB.some(c => c.nombre === selectedHijoNombre)) {
      setSelectedHijoNombre(childrenDB[0].nombre)
    }
  }, [childrenDB, selectedHijoNombre])

  useEffect(() => {
    if (dashboardTab !== 'hijos' || childrenDB.length === 0) return
    let cancelled = false
    const fetchResumenHijos = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const now = new Date()
      const mesActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const resultados = {}
      await Promise.all(childrenDB.map(async c => {
        const { data } = await supabase.from('transactions')
          .select('monto, moneda, fecha')
          .eq('user_id', user.id)
          .gt('monto', 0)
          .or(`child_id.eq.${c.id},tag.ilike.${c.nombre}`)
          .gte('fecha', `${mesActual}-01`)
        resultados[c.nombre] = (data || [])
          .filter(t => t.moneda === 'ARS')
          .reduce((s, t) => s + Number(t.monto), 0)
      }))
      if (!cancelled) setHijosResumenMes(resultados)
    }
    fetchResumenHijos()
    return () => { cancelled = true }
  }, [dashboardTab, childrenDB, refreshKey])

  // Íconos de categorías
  const [customIcons, setCustomIcons] = useState({})

  // Aliases
  const [userAliases, setUserAliases] = useState([])
  const [vencPagados, setVencPagados] = useState(new Set())
  const [vencExpanded, setVencExpanded] = useState(false)
  const [accountTransactions, setAccountTransactions] = useState([])
  // Selección múltiple y libre de categorías/subcategorías/hijos (gasto) o tags
  // (ingreso) para el gráfico de evolución — array de claves 'cat:X' | 'sub:X::Y' |
  // 'hijo:X' | 'ingreso:X'. evolucionTipo decide qué "mundo" (gasto o ingreso) se
  // ofrece para elegir; cambiar el switch limpia la selección porque son conjuntos
  // de opciones distintos.
  const [sidebarCatEvol, setSidebarCatEvol] = useState([])
  const [evolucionTipo, setEvolucionTipo] = useState('gasto')
  const dolarCardRef = useRef(null)
  const configPanelRef = useRef(null)
  const [dolarCardH, setDolarCardH] = useState(null)

  // Preferencias sincronizadas entre dispositivos (metas del mes, ahorro,
  // cuentas de ahorro): se guardan en user_rules como __pref__{clave} con un
  // pequeño debounce (los inputs cambian por tecla). prefsLoaded evita pisar
  // la DB con el valor local de este navegador antes de haberla leído.
  const prefsLoaded = useRef(false)
  const prefTimers = useRef({})
  const persistPref = (key, value) => {
    clearTimeout(prefTimers.current[key])
    prefTimers.current[key] = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('user_rules').upsert({
        user_id: user.id, texto_original: `__pref__${key}`,
        nombre_asignado: JSON.stringify(value), category_id: null, subcategory_id: null
      }, { onConflict: 'user_id,texto_original' })
    }, 800)
  }

  // Servicios y marcas de pagado viven en la DB (user_rules) para verse igual
  // en todos los dispositivos; localStorage queda solo como caché local.
  const persistServicios = async (userId, list) => {
    try { localStorage.setItem(`servicios_${userId}`, JSON.stringify(list)) } catch {}
    await supabase.from('user_rules').upsert({
      user_id: userId, texto_original: '__servicios__',
      nombre_asignado: JSON.stringify(list), category_id: null, subcategory_id: null
    }, { onConflict: 'user_id,texto_original' })
  }

  const toggleVencPagado = async (id) => {
    const next = new Set(vencPagados)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setVencPagados(next)
    const mes = new Date().toISOString().slice(0, 7)
    try { localStorage.setItem(`venc_pagados_${mes}`, JSON.stringify([...next])) } catch {}
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('user_rules').upsert({
      user_id: user.id, texto_original: '__venc_pagados__',
      nombre_asignado: JSON.stringify({ mes, ids: [...next] }), category_id: null, subcategory_id: null
    }, { onConflict: 'user_id,texto_original' })
  }

  useEffect(() => {
    const mes = new Date().toISOString().slice(0, 7)
    const stored = localStorage.getItem(`venc_pagados_${mes}`)
    setVencPagados(stored ? new Set(JSON.parse(stored)) : new Set())
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data: row } = await supabase.from('user_rules').select('nombre_asignado')
        .eq('user_id', user.id).eq('texto_original', '__venc_pagados__').maybeSingle()
      if (row?.nombre_asignado) {
        try {
          const parsed = JSON.parse(row.nombre_asignado)
          if (parsed?.mes === mes && Array.isArray(parsed.ids)) setVencPagados(new Set(parsed.ids))
        } catch {}
      }
    })
  }, [])

  useEffect(() => { setAccountTransactions([]); setSidebarCatEvol('') }, [selectedAccount])
  useEffect(() => { try { localStorage.setItem('ma_ahorro', JSON.stringify(ahorro)) } catch {}; if (prefsLoaded.current) persistPref('ahorro', ahorro) }, [ahorro])
  useEffect(() => { try { localStorage.setItem('ma_cuentas_ahorro', JSON.stringify(cuentasAhorro)) } catch {}; if (prefsLoaded.current) persistPref('cuentas_ahorro', cuentasAhorro) }, [cuentasAhorro])
  // Auto-setear tipoCambio: primero rate vivo de API, sino del DB histórico
  useEffect(() => {
    const rateVivo = dolarRates[tcTipo]
    if (rateVivo) { setTipoCambio(String(rateVivo)); localStorage.setItem('tc_ma', String(rateVivo)); return }
    const mesActual = new Date().toISOString().slice(0, 7)
    const rate = exchangeRates.find(r => r.periodo === mesActual && r.tipo === tcTipo)
    if (rate) { setTipoCambio(String(rate.valor)); localStorage.setItem('tc_ma', String(rate.valor)) }
  }, [exchangeRates, dolarRates, tcTipo])

  useEffect(() => {
    if (dolarRates.eur) { setTipoCambioEUR(String(dolarRates.eur)); localStorage.setItem('tc_eur', String(dolarRates.eur)) }
  }, [dolarRates])

  useEffect(() => {
    fetchAccounts(); fetchCategorias(); fetchChildren(); fetchUserAliases(); fetchExchangeRates(); fetchDolarRates(); fetchCustomIcons()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        // Verificar onboarding completo — solo redirigir si no hay settings Y no hay cuentas (usuario nuevo de verdad)
        const { data: settings } = await supabase.from('user_settings').select('onboarding_completo, tiene_hijos').eq('user_id', user.id).maybeSingle()
        if (!settings || !settings.onboarding_completo) {
          const { count } = await supabase.from('accounts').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
          if ((count || 0) === 0) { navigate('/onboarding'); return }
        }
        if (settings?.tiene_hijos === false) setTieneHijos(false)

        // Guardar nombre propio del registro como contexto_ (auto-neutro en imports)
        const fullName = user.user_metadata?.full_name
        if (fullName) {
          const ctxKey = `contexto_${fullName.toLowerCase().trim()}`
          const { data: existing } = await supabase.from('user_rules')
            .select('id').eq('user_id', user.id).eq('texto_original', ctxKey).maybeSingle()
          if (!existing) {
            await supabase.from('user_rules').insert({ user_id: user.id, texto_original: ctxKey, category_id: null, subcategory_id: null })
          }
        }

        // Servicios: primero la DB; si no hay nada ahí, migrar lo guardado en
        // este navegador (modelo viejo con localStorage) para que se vea igual
        // en todos los dispositivos.
        let serviciosList = null
        const { data: svcRow } = await supabase.from('user_rules')
          .select('nombre_asignado').eq('user_id', user.id).eq('texto_original', '__servicios__').maybeSingle()
        if (svcRow?.nombre_asignado) {
          try { serviciosList = JSON.parse(svcRow.nombre_asignado) } catch {}
        }
        if (!serviciosList) {
          const saved = localStorage.getItem(`servicios_${user.id}`)
          if (saved) {
            try { serviciosList = JSON.parse(saved) } catch {}
            if (serviciosList) persistServicios(user.id, serviciosList)
          }
        }
        setServicios(serviciosList
          ? serviciosList.map((s, i) => ({ ...s, id: s.id || `${s.nombre}_${i}`, dia: s.dia ?? (s.vencimiento ? parseInt(s.vencimiento, 10) : null) }))
          : SERVICIOS_DEFAULT)

        // Preferencias sincronizadas (metas del mes, proyección de ahorro,
        // cuentas de ahorro): DB primero; si la DB no tiene nada y este
        // navegador guarda datos viejos en localStorage, se migran solos.
        const { data: prefRows } = await supabase.from('user_rules')
          .select('texto_original, nombre_asignado').eq('user_id', user.id).like('texto_original', '__pref__%')
        const prefs = Object.fromEntries((prefRows || []).map(r => [r.texto_original.replace('__pref__', ''), r.nombre_asignado]))
        const readPref = (key) => { try { return prefs[key] !== undefined ? JSON.parse(prefs[key]) : undefined } catch { return undefined } }
        const ahorroDB = readPref('ahorro')
        if (ahorroDB) setAhorro(ahorroDB)
        else if (ahorro && (ahorro.monto || ahorro.anos)) persistPref('ahorro', ahorro)
        const cuentasAhorroDB = readPref('cuentas_ahorro')
        if (Array.isArray(cuentasAhorroDB)) setCuentasAhorro(cuentasAhorroDB)
        else if (cuentasAhorro.length > 0) persistPref('cuentas_ahorro', cuentasAhorro)
        const tcManualDB = readPref('tc_manual')
        if (tcManualDB) setTcManual(tcManualDB)
        prefsLoaded.current = true

        // Mini chart: últimos 6 meses — guardamos txs crudas para recalcular con TC live
        const now = new Date()
        const meses = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        })
        const desde = meses[0] + '-01'
        const { data: txs } = await supabase.from('transactions')
          .select('fecha, monto, moneda').eq('user_id', user.id).eq('tipo', 'gasto')
          .gte('fecha', desde).gt('monto', 0)
        setMiniChartMeses(meses)
        setMiniChartTxs(txs || [])
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate])

  useLayoutEffect(() => {
    const measure = () => { if (dolarCardRef.current) setDolarCardH(dolarCardRef.current.offsetHeight) }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [dolarRates, tcTipo, tipoCambio])


  useEffect(() => {
    const handleResize = () => { setWindowWidth(window.innerWidth); setWindowHeight(window.innerHeight) }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (step === 'processing') {
      setMsgIndex(0)
      setTimer(180)
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: cats } = await supabase.from('categories').select('*').or(`user_id.eq.${user.id},es_sistema.eq.true`).order('orden')
    const catIds = (cats || []).map(c => c.id)
    const { data: subcats } = catIds.length > 0
      ? await supabase.from('subcategories').select('*').in('category_id', catIds).order('nombre')
      : { data: [] }
    setCategoriasDB(cats || [])
    setSubcategoriasDB(subcats || [])
  }

  const fetchChildren = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('children').select('id, nombre').eq('user_id', user.id).order('nombre')
    setChildrenDB(data || [])
  }

  const fetchUserAliases = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('user_aliases').select('*').eq('user_id', user.id).order('alias')
    setUserAliases(data || [])
  }

  const fetchCustomIcons = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: catIcons }, { data: childIcons }, { data: ruleIcons }] = await Promise.all([
      supabase.from('user_category_icons').select('category_id, icono, categories(nombre)').eq('user_id', user.id),
      supabase.from('children').select('nombre, icono').eq('user_id', user.id).not('icono', 'is', null),
      supabase.from('user_rules').select('texto_original, nombre_asignado').eq('user_id', user.id).like('texto_original', '__icon__%')
    ])
    const icons = {}
    if (catIcons) catIcons.filter(r => r.categories?.nombre).forEach(r => { icons[r.categories.nombre] = r.icono })
    if (childIcons) childIcons.forEach(r => { icons[r.nombre] = r.icono })
    if (ruleIcons) ruleIcons.forEach(r => { const nombre = r.texto_original.replace('__icon__', ''); if (nombre && r.nombre_asignado) icons[nombre] = r.nombre_asignado })
    setCustomIcons(icons)
  }

  const saveCustomIcon = async (categoria, icono) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const catObj = categoriasDB.find(c => c.nombre === categoria)
    if (catObj) {
      if (icono) {
        await supabase.from('user_category_icons').upsert({ user_id: user.id, category_id: catObj.id, icono }, { onConflict: 'user_id,category_id' })
        setCustomIcons(prev => ({ ...prev, [categoria]: icono }))
      } else {
        await supabase.from('user_category_icons').delete().eq('user_id', user.id).eq('category_id', catObj.id)
        setCustomIcons(prev => { const n = {...prev}; delete n[categoria]; return n })
      }
    } else {
      const childObj = childrenDB.find(c => c.nombre === categoria)
      if (childObj) {
        await supabase.from('children').update({ icono: icono || null }).eq('id', childObj.id)
        setChildrenDB(prev => prev.map(c => c.id === childObj.id ? { ...c, icono: icono || null } : c))
        setCustomIcons(prev => icono ? { ...prev, [categoria]: icono } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== categoria)))
      } else {
        // Ingreso tags y otros: guardar en user_rules como __icon__{nombre}
        const iconKey = `__icon__${categoria}`
        if (icono) {
          await supabase.from('user_rules').upsert({ user_id: user.id, texto_original: iconKey, nombre_asignado: icono, category_id: null, subcategory_id: null }, { onConflict: 'user_id,texto_original' })
          setCustomIcons(prev => ({ ...prev, [categoria]: icono }))
        } else {
          await supabase.from('user_rules').delete().eq('user_id', user.id).eq('texto_original', iconKey)
          setCustomIcons(prev => { const n = {...prev}; delete n[categoria]; return n })
        }
      }
    }
  }


  const getOrCreateIngresosAccount = async (user) => {
    // Primero buscar en el estado local
    let acc = accounts.find(a => a.tipo === 'ingreso')
    if (acc) return acc
    // El estado puede estar desactualizado — consultar la DB directamente
    const { data: dbAccs } = await supabase.from('accounts')
      .select('*').eq('user_id', user.id).eq('tipo', 'ingreso').order('created_at', { ascending: true }).limit(1)
    if (dbAccs && dbAccs.length > 0) return dbAccs[0]
    // No existe: crear
    const { data } = await supabase.from('accounts')
      .insert({ user_id: user.id, nombre: 'Ingresos', tipo: 'ingreso' }).select().single()
    if (data) await fetchAccountsAndReturn()
    return data
  }

  const fetchAccountsAndReturn = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('accounts').select('*').eq('user_id', user.id)
    setAccounts(data || [])
    return data || []
  }

  const handleGuardarMovimiento = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const catObj = categoriasDB.find(c => c.nombre === efectivo.categoria && (c.tipo || 'gasto') === tipoMovimiento)
    const subcatObj = subcategoriasDB.find(s => s.nombre === efectivo.subcategoria && s.category_id === catObj?.id)

    let accountId = efectivo.cuenta || cuentaEfectivoId
    if (tipoMovimiento === 'ingreso') {
      // El ingreso se guarda en la cuenta real elegida; si no eligió ninguna,
      // cae en la cuenta "Ingresos" (comportamiento histórico).
      accountId = efectivo.cuenta || accounts.find(a => a.tipo === 'ingreso')?.id
      if (!accountId) {
        const acc = await getOrCreateIngresosAccount(user)
        if (!acc) { setLoading(false); return }
        accountId = acc.id
      }
    }

    const movimientoNuevo = {
      user_id: user.id,
      account_id: accountId,
      fecha: efectivo.fecha,
      nombre: efectivo.nombre,
      detalle: efectivo.nota || efectivo.nombre,
      monto: parseFloat(efectivo.monto),
      moneda: efectivo.moneda,
      tipo: tipoMovimiento,
      category_id: catObj?.id || null,
      subcategory_id: subcatObj?.id || null,
      // Para ingreso conservamos el tag = subcategoría/categoría elegida: varias
      // pantallas (breakdown de ingresos, evolución) siguen agrupando por tag.
      tag: tipoMovimiento === 'ingreso' ? (subcatObj?.nombre || catObj?.nombre || null) : (efectivo.hijo || null),
      estado: catObj ? 'identificado' : 'a_identificar',
      es_manual: true,
      cuotas_total: 1,
      cuota_numero: 1,
      // TC congelado al momento de cargar el movimiento — el equivalente en ARS de
      // este movimiento en USD nunca cambia después, aunque se actualice el TC.
      fx_rate: efectivo.moneda === 'USD' ? (parseFloat(tipoCambioEfectivo) || null) : null,
    }
    await supabase.from('transactions').insert(dividirTresVias([movimientoNuevo], categoriasDB, subcategoriasDB))

    setEfectivo({ fecha: new Date().toISOString().slice(0,10), nombre: '', monto: '', moneda: 'ARS', categoria: '', subcategoria: '', nota: '', hijo: '', cuenta: cuentaEfectivoId })
    setShowMovimiento(false)
    setRefreshKey(k => k + 1)
    if (tipoMovimiento === 'ingreso') {
      fetchAccounts()
      showToast('Ingreso registrado.')
    }
    setLoading(false)
  }

  const fetchAccounts = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('accounts').select('*').eq('user_id', user.id)
    setAccounts(data || [])
    if (data && data.length > 0) {
      setSelectedAccount(prev => prev === null ? 'all' : prev)
    }
  }, [])

  // Handlers pasados como props a AccountDetail — antes eran arrow functions
  // inline en el JSX, recreadas en cada render.
  const handleNavigateToHijo = useCallback((nombre) => {
    setSelectedHijoNombre(nombre)
    setDashboardTab('hijos')
  }, [])
  const handleAddIngreso = useCallback(() => {
    setTipoMovimiento('ingreso')
    setEfectivo(prev => ({ ...prev, cuenta: '' }))
    setShowMovimiento(true)
  }, [])


  const fetchExchangeRates = async () => {
    const { data } = await supabase.from('exchange_rates').select('periodo, tipo, valor').order('periodo', { ascending: false })
    setExchangeRates(data || [])
  }

  const fetchDolarRates = async () => {
    try {
      const map = {}
      try {
        const res = await fetch('https://dolarapi.com/v1/dolares')
        if (res.ok) {
          const arr = await res.json()
          arr.forEach(d => {
            const avg = (d.compra != null && d.venta != null) ? Math.round((d.compra + d.venta) / 2) : (d.venta || d.compra || 0)
            if (d.casa === 'blue') map.blue = avg
            else if (d.casa === 'bolsa') map.mep = avg
            else if (d.casa === 'oficial') map.oficial = avg
            else if (d.casa === 'tarjeta') map.tarjeta = avg
          })
        }
      } catch {}
      try {
        const resEur = await fetch('https://dolarapi.com/v1/cotizaciones/eur')
        if (resEur.ok) {
          const eur = await resEur.json()
          const avg = (eur.compra != null && eur.venta != null) ? Math.round((eur.compra + eur.venta) / 2) : (eur.venta || eur.compra || 0)
          if (avg > 0) {
            map.eur = avg
            const mesActual = new Date().toISOString().slice(0, 7)
            supabase.from('exchange_rates').upsert({ periodo: mesActual, tipo: 'euro', valor: avg }, { onConflict: 'periodo,tipo' }).then(({ error }) => { if (!error) fetchExchangeRates() })
          }
        }
      } catch {}
      setDolarRates(map)
    } catch {}
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

  const downloadExcelTemplate = () => {
    const wb = XLSX.utils.book_new()
    const headers = [['FECHA', 'DESCRIPCION', 'TIPO', 'MONTO_ARS', 'MONTO_USD', 'CATEGORIA', 'SUBCATEGORIA', 'HIJO', 'MODO_PAGO']]
    const examples = [
      ['01/06/2026', 'Supermercado Día', 'gasto', 15000, '', 'Alimentos', 'Verduras', '', 'Efectivo'],
      ['10/06/2026', 'Netflix', 'gasto', '', 8.99, 'Entretenimiento', '', '', 'Tarjeta'],
      ['15/06/2026', 'Sueldo', 'ingreso', 500000, '', '', '', '', ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet([...headers, ...examples])
    ws['!cols'] = [{ width: 14 }, { width: 30 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 20 }, { width: 20 }, { width: 15 }, { width: 18 }]
    XLSX.utils.book_append_sheet(wb, ws, 'GASTOS')
    XLSX.writeFile(wb, 'plantilla_gastos.xlsx')
  }

  const parsearExcel = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true, raw: false })
        const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'gastos') || wb.SheetNames[0]
        const ws = sheetName ? wb.Sheets[sheetName] : null
        if (!ws) { reject(new Error('El archivo no tiene ninguna hoja. Usá la plantilla descargable.')); return }
        const normKey = (k) => k.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_]+/g, '')
        const HEADER_ALIASES = {
          FECHA: 'FECHA', DESCRIPCION: 'DESCRIPCION', TIPO: 'TIPO',
          MONTOARS: 'MONTO_ARS', MONTOUSD: 'MONTO_USD',
          CATEGORIA: 'CATEGORIA', SUBCATEGORIA: 'SUBCATEGORIA',
          HIJO: 'HIJO', MODOPAGO: 'MODO_PAGO',
        }
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null }).map(row => {
          const norm = {}
          Object.keys(row).forEach(k => { norm[HEADER_ALIASES[normKey(k)] || k.trim().toUpperCase()] = row[k] })
          return norm
        })
        const toNum = (v) => {
          let s = String(v ?? '').trim().replace(/[()]/g, '').replace(/[^0-9.,-]/g, '')
          if (!s) return 0
          if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
          else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
          return parseFloat(s) || 0
        }
        const parsed = rows
          .filter(row => row && (row['FECHA'] || row['DESCRIPCION'] || row['MONTO_ARS'] || row['MONTO_USD']))
          .map(row => {
            const fechaOriginal = parseExcelDate(row['FECHA'])
            const monto_ars = toNum(row['MONTO_ARS'])
            const monto_usd = toNum(row['MONTO_USD'])
            const descripcion = String(row['DESCRIPCION'] || '').trim()
            const cat = String(row['CATEGORIA'] || '').trim() || null
            const subcat = String(row['SUBCATEGORIA'] || '').trim() || null
            const hijoRaw = String(row['HIJO'] || '').trim()
            const hijo = hijoRaw ? hijoRaw.charAt(0).toUpperCase() + hijoRaw.slice(1).toLowerCase() : null
            const modo_pago = String(row['MODO_PAGO'] || '').trim()
            const tipoRaw = String(row['TIPO'] || '').trim().toLowerCase()
            const tipo = ['ingreso', 'neutro', 'gasto'].includes(tipoRaw) ? tipoRaw : 'gasto'
            const monto = monto_usd !== 0 ? Math.abs(monto_usd) : Math.abs(monto_ars)
            const moneda = monto_usd !== 0 ? 'USD' : 'ARS'
            const { cuota_numero, cuotas_total } = parseCuotaDesc(descripcion)
            const fecha = cuotas_total > 1 ? addMonths(fechaOriginal, cuota_numero - 1) : fechaOriginal
            return { fecha, monto, moneda, monto_ars: Math.abs(monto_ars), monto_usd: Math.abs(monto_usd), descripcion, notas: descripcion, modo_pago, cat, subcat, hijo, tipo, cuota_numero, cuotas_total }
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

      // Pre-clasificar usando historial de transacciones ya identificadas (aprende del pasado)
      const { data: { user: userForHistory } } = await supabase.auth.getUser()
      if (userForHistory) {
        const { data: historyTxs } = await supabase.from('transactions')
          .select('notas, detalle, categories(nombre), tag')
          .eq('user_id', userForHistory.id)
          .eq('estado', 'identificado')
          .not('category_id', 'is', null)
          .limit(5000)
        const historyMap = {}
        historyTxs?.forEach(t => {
          [t.notas, t.detalle].filter(Boolean).forEach(k => {
            const key = k.toLowerCase().trim()
            if (key && !historyMap[key]) historyMap[key] = { cat: t.categories?.nombre, hijo: t.tag || null }
          })
        })
        rows.forEach(r => {
          if (r.cat && r.cat !== 'A Identificar') return
          const key = (r.notas || r.descripcion || '').toLowerCase().trim()
          const match = historyMap[key]
          if (match?.cat && match.cat !== 'A Identificar') {
            r.cat = match.cat
            if (!r.hijo && match.hijo) r.hijo = match.hijo
          }
        })
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
            categories: categoriasDB,
            subcategories: subcategoriasDB,
            children: childrenDB,
            aliases: userAliases
          })
        })
        if (!response.ok) throw new Error(`Error clasificando filas (${response.status})`)
        const { classifications } = await response.json()

        const applyAliases = (cat, subcat, descripcion) => {
          const desc = (descripcion || '').toUpperCase()
          const match = (userAliases || []).find(a => a.tipo === 'categoria' && desc.includes(a.alias))
          if (match) return { cat: match.valor, subcat: (cat || '').toLowerCase() === (match.valor || '').toLowerCase() ? subcat : null }
          // Personal siempre sin subcategoria — evita inventar "Peluqueria", "Varios", etc.
          if ((cat || '').toLowerCase() === 'personal') return { cat, subcat: null }
          return { cat, subcat }
        }

        let clIdx = 0
        enriched = rows.map(r => {
          if (!r.cat || r.cat === 'A Identificar') {
            const cl = Array.isArray(classifications) ? classifications[clIdx++] : null
            const { cat, subcat } = applyAliases(cl?.categoria || null, cl?.subcategoria || null, r.descripcion || r.notas)
            return {
              ...r,
              cat, subcat,
              hijo: r.hijo || cl?.hijo || null,
              nombre: cl?.nombre || r.descripcion,
              estado: cat && cat !== 'A Identificar' ? 'identificado' : 'a_identificar'
            }
          }
          // Filas con cat del Excel: aplicar aliases igual
          const { cat, subcat } = applyAliases(r.cat, r.subcat, r.descripcion || r.notas)
          return { ...r, cat, subcat, nombre: r.descripcion, estado: 'identificado' }
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
          // Si no hay match exacto, buscar una cuenta ya creada que lo contenga sin ambigüedad
          // (ej. MODO_PAGO "Visa" -> cuenta real "Visa Galicia"), para no duplicar cuentas.
          const candidatas = currentAccounts.filter(a => a.tipo !== 'ingreso' && (
            a.nombre.toLowerCase().includes(nombreCuenta.toLowerCase()) ||
            nombreCuenta.toLowerCase().includes(a.nombre.toLowerCase())
          ))
          if (candidatas.length === 1) acc = candidatas[0]
        }
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

      const { data: categorias } = await supabase.from('categories').select('id, nombre').or(`user_id.eq.${user.id},es_sistema.eq.true`)
      const catIdsForSub = (categorias || []).map(c => c.id)
      const { data: subcategorias } = catIdsForSub.length > 0
        ? await supabase.from('subcategories').select('id, nombre, category_id').in('category_id', catIdsForSub)
        : { data: [] }
      const getCatId = (cat) => cat ? (categorias?.find(c => c.nombre.toLowerCase() === cat.toLowerCase())?.id || null) : null
      const getSubcatId = (sub, catId) => sub && catId ? (subcategorias?.find(s => s.nombre.toLowerCase() === sub.toLowerCase() && s.category_id === catId)?.id || null) : null

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

      const hayIngresos = newRows.some(({ row }) => row.tipo === 'ingreso')
      const ingresosAccExcel = hayIngresos ? await getOrCreateIngresosAccount(user) : null
      const toInsert = newRows.map(({ row, acc }) => {
        const catId = getCatId(row.cat)
        const cuota = { cuota_numero: row.cuota_numero || 1, cuotas_total: row.cuotas_total || 1 }
        const finalAcc = (row.tipo === 'ingreso' && ingresosAccExcel) ? ingresosAccExcel : acc
        return {
          user_id: user.id, account_id: finalAcc.id, fecha: row.fecha,
          nombre: row.nombre || row.notas || row.descripcion || null,
          detalle: row.notas || row.descripcion,
          monto: row.monto, moneda: row.moneda, tipo: row.tipo || 'gasto',
          category_id: catId, subcategory_id: getSubcatId(row.subcat, catId),
          estado: row.tipo === 'neutro' ? 'identificado' : (catId ? 'identificado' : 'a_identificar'), es_manual: true, ...cuota,
          tag: row.hijo || null,
          fx_rate: row.moneda === 'USD' ? (parseFloat(tipoCambioEfectivo) || null) : null,
        }
      })

      const toInsertFinal = dividirTresVias(toInsert, categorias, subcategorias)
      await supabase.from('transactions').insert(toInsertFinal)
      const omitidas = exactDupes.length
      showToast(`${toInsertFinal.length} transacciones importadas.${omitidas > 0 ? ` ${omitidas} duplicadas exactas omitidas.` : ''}`)
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
      const getCatId = (cat) => cat ? (categorias?.find(c => c.nombre.toLowerCase() === cat.toLowerCase())?.id || null) : null
      const getSubcatId = (sub, catId) => sub && catId ? (subcategorias?.find(s => s.nombre.toLowerCase() === sub.toLowerCase() && s.category_id === catId)?.id || null) : null

      const selectedDupes = potentialDupes.filter((_, i) => excelDupSelections.has(i))
      const toImport = [...newRows, ...selectedDupes]

      if (toImport.length === 0) {
        showToast('No seleccionaste ninguna transacción para importar.', 'error')
        setLoadingExcel(false); return
      }

      const hayIngresosFinal = toImport.some(({ row }) => row.tipo === 'ingreso')
      const ingresosAccFinal = hayIngresosFinal ? await getOrCreateIngresosAccount(user) : null
      const toInsert = toImport.map(({ row, acc }) => {
        const catId = getCatId(row.cat)
        const cuota = { cuota_numero: row.cuota_numero || 1, cuotas_total: row.cuotas_total || 1 }
        const finalAcc = (row.tipo === 'ingreso' && ingresosAccFinal) ? ingresosAccFinal : acc
        return {
          user_id: user.id, account_id: finalAcc.id, fecha: row.fecha,
          nombre: row.nombre || row.notas || row.descripcion || null,
          detalle: row.notas || row.descripcion,
          monto: row.monto, moneda: row.moneda, tipo: row.tipo || 'gasto',
          category_id: catId, subcategory_id: getSubcatId(row.subcat, catId),
          estado: row.tipo === 'neutro' ? 'identificado' : (catId ? 'identificado' : 'a_identificar'), es_manual: true, ...cuota,
          tag: row.hijo || null,
          fx_rate: row.moneda === 'USD' ? (parseFloat(tipoCambioEfectivo) || null) : null,
        }
      })

      const toInsertFinal = dividirTresVias(toInsert, categorias, subcategorias)
      await supabase.from('transactions').insert(toInsertFinal)
      const omitidas = exactDupes.length + (potentialDupes.length - selectedDupes.length)
      showToast(`${toInsertFinal.length} transacciones importadas.${omitidas > 0 ? ` ${omitidas} omitidas.` : ''}`)
      setShowExcel(false); setExcelFile(null); setExcelPreview(null); setExcelDupReview(null)
      setRefreshKey(k => k + 1); fetchAccounts()
    } catch (err) {
      showToast('Error al importar: ' + err.message, 'error')
    }
    setLoadingExcel(false)
  }

  const handleReclasificar = async () => {
    showToast('Buscando transacciones...')
    const { data: { session } } = await supabase.auth.getSession()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: pendientes } = await supabase.from('transactions')
      .select('*').eq('user_id', user.id).eq('tipo', 'gasto').eq('estado', 'a_identificar')
      .gt('monto', 0).order('fecha', { ascending: false }).limit(500)
    if (!pendientes || pendientes.length === 0) { showToast('No hay gastos para clasificar.'); return }
    showToast(`Reclasificando ${pendientes.length} gastos con IA...`)
    const { data: cats } = await supabase.from('categories').select('*').or(`user_id.eq.${user.id},es_sistema.eq.true`)
    const { data: children } = await supabase.from('children').select('*').eq('user_id', user.id)
    const { data: aliases } = await supabase.from('user_aliases').select('*').eq('user_id', user.id)
    const { data: rulesRaw } = await supabase.from('user_rules')
      .select('texto_original, categories(nombre), subcategories(nombre)')
      .eq('user_id', user.id)
      .not('texto_original', 'like', 'contexto_%')
      .not('texto_original', 'like', '\\_\\_%')
    const rules = (rulesRaw || [])
      .map(r => ({ texto_original: r.texto_original, categoria: r.categories?.nombre || null, subcategoria: r.subcategories?.nombre || null }))
      .filter(r => r.categoria)
    const rows = pendientes.map(t => ({ id: t.id, notas: t.notas || '', descripcion: t.detalle || t.nombre || '', monto: t.monto, moneda: t.moneda || 'ARS' }))
    try {
      const catIdsForSub = (cats || []).map(c => c.id)
      const { data: subcats } = catIdsForSub.length > 0
        ? await supabase.from('subcategories').select('*').in('category_id', catIdsForSub)
        : { data: [] }
      const res = await fetch('/api/classifyRows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ rows, categories: cats, subcategories: subcats || [], children: children || [], aliases: aliases || [] })
      })
      const resData = await res.json()
      if (!res.ok) {
        showToast(`Error del clasificador: ${resData.error || res.status}`, 'error')
        return
      }
      const { classifications } = resData
      if (!classifications || classifications.length === 0) {
        showToast('El clasificador no devolvió resultados.', 'error')
        return
      }
      // Mapa de consistencia: mismo detalle → misma clasificación
      const clByDesc = {}
      const updates = pendientes.map((tx, i) => {
        const cl = classifications[i]
        if (!cl) return null
        const desc = (tx.detalle || tx.nombre || '').toUpperCase()
        const descNorm = desc.toLowerCase().trim()
        // Reglas aprendidas (identificaste esta transacción a mano antes): prioridad máxima
        const ruleMatch = rules.find(r => {
          const rNorm = (r.texto_original || '').toLowerCase().trim()
          return rNorm && (descNorm === rNorm || descNorm.startsWith(rNorm) || rNorm.startsWith(descNorm))
        })
        if (ruleMatch) {
          cl.categoria = ruleMatch.categoria
          cl.subcategoria = ruleMatch.subcategoria
        } else {
          // Aliases: segunda prioridad
          const aliasMatch = (aliases || []).find(a => a.tipo === 'categoria' && desc.includes(a.alias))
          if (aliasMatch) {
            const [aliasCat, aliasSubcat] = aliasMatch.valor.split(' > ').map(v => v.trim())
            cl.categoria = aliasCat
            cl.subcategoria = aliasSubcat || null
          }
        }
        // Personal nunca tiene subcategoria
        if ((cl.categoria || '').toLowerCase() === 'personal') cl.subcategoria = null
        // Consistencia: misma descripción → misma clasificación
        if (clByDesc[desc]) {
          cl.categoria = clByDesc[desc].categoria
          cl.subcategoria = clByDesc[desc].subcategoria
        } else {
          clByDesc[desc] = { categoria: cl.categoria, subcategoria: cl.subcategoria }
        }
        const catObj = cats?.find(c => c.nombre.toLowerCase() === (cl.categoria || '').toLowerCase())
        const subcatObj = subcats?.find(s => s.nombre.toLowerCase() === (cl.subcategoria || '').toLowerCase() && s.category_id === catObj?.id)
        return supabase.from('transactions').update({
          nombre: cl.nombre || tx.detalle,
          category_id: catObj?.id || null,
          subcategory_id: subcatObj?.id || null,
          estado: catObj ? 'identificado' : 'a_identificar',
        }).eq('id', tx.id)
      }).filter(Boolean)
      await Promise.all(updates)
      const updated = updates.length
      showToast(`${updated} transacciones reclasificadas.`)
      setRefreshKey(k => k + 1)
      fetchAccounts()
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
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('accounts').update({ nombre: editAccount.nombre, tipo: editAccount.tipo }).eq('id', editAccount.id).eq('user_id', user.id)
    setEditAccount(null)
    fetchAccounts()
    setLoading(false)
  }

  const handleDeleteAccount = async (accountId) => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('transactions').delete().eq('account_id', accountId).eq('user_id', user.id)
    await supabase.from('statements').delete().eq('account_id', accountId).eq('user_id', user.id)
    await supabase.from('accounts').delete().eq('id', accountId).eq('user_id', user.id)
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
      await supabase.from('transactions').update({ account_id: keeper.id }).eq('account_id', acc.id).eq('user_id', user.id)
      await supabase.from('statements').delete().eq('account_id', acc.id).eq('user_id', user.id)
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
          if (!response.ok) {
            if ([502, 503, 504, 524].includes(response.status)) {
              throw new Error('La imagen tardó demasiado en procesarse (el servidor está ocupado). Probá de nuevo en unos minutos.')
            }
            throw new Error(`Error del servidor (${response.status}). Probá de nuevo en unos minutos.`)
          }
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

  const tryDirectParsePDF = (text) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const mpLines = lines.filter(l => /Mercado Pago\s*$/i.test(l))
    if (mpLines.length < 5) return null

    const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const rows = []
    for (const line of lines) {
      // Pattern: dd/mm/yyyy DESCRIPTION [-]$ amount Mercado Pago
      const m = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+(-?\s*\$?\s*[\d,]+(?:\.\d{1,2})?)\s+Mercado Pago\s*$/i)
      if (!m) continue

      const [, fechaStr, rawDesc, montoStr] = m
      const [d, mo, y] = fechaStr.split('/')
      const fecha = `${y}-${mo}-${d}`
      const isIngreso = !montoStr.includes('-')
      const monto = parseFloat(montoStr.replace(/[^0-9.]/g, ''))
      if (isNaN(monto) || monto === 0) continue

      const esDevolucion = /\[(refunded|cancelled)\]/i.test(rawDesc)
      const descripcion = rawDesc.replace(/\[.*?\]/g, '').trim()
      const tipo = esDevolucion ? 'neutro' : isIngreso ? 'ingreso' : 'gasto'

      rows.push({ fecha, descripcion, monto, es_credito: isIngreso, detalle: descripcion,
        tipo, nombre_limpio: descripcion, nombre_original: descripcion, moneda: 'ARS' })
    }

    if (rows.length < 5) return null

    const fechas = rows.map(r => r.fecha).sort()
    const [yDesde, mDesde] = fechas[0].split('-')
    const [yHasta, mHasta] = fechas[fechas.length - 1].split('-')
    const periodo = (mDesde === mHasta && yDesde === yHasta)
      ? `${MESES[parseInt(mDesde)]} ${yHasta}`
      : yDesde === yHasta
        ? `${MESES[parseInt(mDesde)]}-${MESES[parseInt(mHasta)]} ${yHasta}`
        : `${MESES[parseInt(mDesde)]} ${yDesde}-${MESES[parseInt(mHasta)]} ${yHasta}`

    console.log(`✅ Parser directo MercadoPago: ${rows.length} transacciones (${periodo})`)
    return { tarjeta_detectada: 'Mercado Pago', tipo_documento: 'banco', transacciones: rows, contexto_detectado: [], periodo }
  }

  // Normaliza fechas y montos que vienen de la IA antes de tocar la base: una
  // sola fila inválida (fecha ilegible, monto no numérico) haría fallar el
  // insert del lote completo y con eso la importación entera.
  const sanitizarTxImport = (transacciones) => {
    const normFecha = (f) => {
      if (!f) return null
      const s = String(f).trim()
      let d, mo, y
      let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
      if (m) { y = +m[1]; mo = +m[2]; d = +m[3] }
      else {
        m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
        if (!m) return null
        d = +m[1]; mo = +m[2]; y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
      }
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
      const dt = new Date(Date.UTC(y, mo - 1, d))
      if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    const normMonto = (mo) => {
      if (typeof mo === 'number' && isFinite(mo)) return mo
      if (typeof mo === 'string') {
        let s = mo.replace(/[^\d.,-]/g, '')
        s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
        const n = parseFloat(s)
        if (isFinite(n)) return n
      }
      return null
    }
    const validas = []
    let omitidas = 0
    for (const t of (transacciones || [])) {
      const fecha = normFecha(t.fecha)
      const monto = normMonto(t.monto)
      if (!fecha || monto === null || monto === 0) { omitidas++; continue }
      validas.push({ ...t, fecha, monto, moneda: ['ARS', 'USD', 'EUR'].includes(t.moneda) ? t.moneda : 'ARS' })
    }
    return { validas, omitidas }
  }

  // Re-aplica reglas aprendidas (user_rules) y alias del usuario a las transacciones que
  // devolvió la IA (o el parser directo), sin depender de que la IA haya obedecido el prompt.
  // Prioridad: reglas aprendidas > alias de categoría/hijo.
  const aplicarReglasYAlias = (transacciones, rules, aliasesList) => {
    return (transacciones || []).flatMap(t => {
      const descNorm = ((t.descripcion || t.nombre_original || '') + ' ' + (t.nombre_limpio || '')).toLowerCase().trim()
      const descUpper = descNorm.toUpperCase()
      let updated = { ...t }
      const ruleMatch = (rules || []).find(r => {
        const rNorm = (r.texto_original || '').toLowerCase().trim()
        return rNorm && (descNorm === rNorm || descNorm.startsWith(rNorm) || rNorm.startsWith(descNorm))
      })
      // La regla aprendida (categoría) tiene prioridad sobre el alias de
      // categoría, pero los alias de hijo/neutro aplican SIEMPRE: la regla
      // aprendida no guarda hijo, y antes lo pisaba (un gasto con regla de
      // categoría nunca recibía su hijo/a por alias).
      if (ruleMatch) {
        updated.categoria_sugerida = ruleMatch.categoria
        updated.subcategoria_sugerida = ruleMatch.subcategoria
      } else {
        const catAlias = (aliasesList || []).find(a => a.tipo === 'categoria' && descUpper.includes(a.alias))
        if (catAlias) {
          const [cat, subcat] = catAlias.valor.split(' > ').map(v => v.trim())
          updated.categoria_sugerida = cat
          updated.subcategoria_sugerida = subcat || null
        }
      }
      const hijoAlias = (aliasesList || []).find(a => a.tipo === 'hijo' && descUpper.includes(a.alias))
      const neutroAlias = (aliasesList || []).find(a => a.tipo === 'neutro' && descUpper.includes(a.alias))
      if (hijoAlias) updated.hijo = hijoAlias.valor
      if (neutroAlias) updated.tipo = 'neutro'
      // Regla "dividir con hijo/a" (ej. OSDE → 50% Amelia): el gasto se parte
      // en dos movimientos reales, así gráficos, totales y detalle por hijo
      // cierran solos sin lógica especial en ningún otro lado.
      const splitAlias = (aliasesList || []).find(a => a.tipo === 'split' && descUpper.includes(a.alias))
      const montoNum = Number(updated.monto) || 0
      if (splitAlias && updated.tipo !== 'ingreso' && montoNum > 0) {
        const [hijoNombre, pctStr] = String(splitAlias.valor || '').split(':')
        const pct = Math.min(95, Math.max(5, parseFloat(pctStr) || 50))
        const parteHijo = Math.round(montoNum * pct) / 100
        const parteResto = Math.round((montoNum - parteHijo) * 100) / 100
        if (hijoNombre && parteHijo > 0 && parteResto > 0) {
          return [
            { ...updated, monto: parteHijo, hijo: hijoNombre },
            { ...updated, monto: parteResto, hijo: updated.hijo && updated.hijo !== hijoNombre ? updated.hijo : null },
          ]
        }
      }
      return [updated]
    })
  }

  const logImportAttempt = async (datos) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      fetch('/api/logImport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(datos)
      }).catch(() => {})
    } catch { /* el log/mail nunca debe romper el flujo de carga */ }
  }

  const handleUploadPDF = async () => {
    if (!archivo) return
    setStep('processing')
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const { data: rulesRaw } = await supabase.from('user_rules')
        .select('texto_original, categories(nombre), subcategories(nombre)')
        .eq('user_id', user.id)
        .not('texto_original', 'like', 'contexto_%')
      const rules = (rulesRaw || []).map(r => ({
        texto_original: r.texto_original,
        categoria: r.categories?.nombre || null,
        subcategoria: r.subcategories?.nombre || null,
      })).filter(r => r.categoria)

      // Fetch ingresos existentes para dar contexto al análisis
      const ingresosAcc = accounts.find(a => a.tipo === 'ingreso')
      let incomeExamples = []
      if (ingresosAcc) {
        const { data: incomeTxs } = await supabase
          .from('transactions')
          .select('nombre, detalle, tag')
          .eq('account_id', ingresosAcc.id)
          .eq('tipo', 'ingreso')
          .limit(40)
        incomeExamples = incomeTxs || []
      }

      const isImage = archivo.type.startsWith('image/')
      let result
      if (isImage) {
        result = await analyzeImageWithClaude(archivo, rules || [], token)
      } else {
        const pdfText = await extractTextFromPDF(archivo)
        if (pdfText) {
          result = tryDirectParsePDF(pdfText)
          if (!result) {
            result = await analyzeStatementWithClaude(pdfText, 'auto', rules || [], token, incomeExamples, categoriasDB, subcategoriasDB, childrenDB, userAliases)
          }
        } else {
          // El PDF no se pudo leer como texto (dañado, escaneado, o la tabla
          // de movimientos no está en la capa de texto): la IA lo lee entero.
          result = await analyzePdfDocumentWithClaude(archivo, 'auto', rules || [], token, incomeExamples, categoriasDB, subcategoriasDB, childrenDB, userAliases)
        }
      }
      // Re-aplica reglas/alias por código (no depende de que la IA haya obedecido el prompt),
      // así las reglas que el cliente ya creó se usan solas en cada resumen nuevo.
      if (result?.transacciones) {
        result.transacciones = aplicarReglasYAlias(result.transacciones, rules, userAliases)
        const { validas, omitidas } = sanitizarTxImport(result.transacciones)
        result.transacciones = validas
        if (omitidas > 0) showToast(`Se omitieron ${omitidas} movimiento(s) con fecha o monto ilegible.`, 'warning')
      }
      // En tarjetas el período es el mes de CIERRE del resumen, no el de las
      // compras (el resumen que cierra en junio trae compras de mayo). La IA
      // tiende a nombrar por las compras, así que lo derivamos de la fecha de
      // facturación para que dos resúmenes seguidos no queden con igual período.
      if (result?.tipo_documento === 'tarjeta' && result.fecha_facturacion) {
        const isoFact = parseFechaArgentina(result.fecha_facturacion)
        const mFact = /^(\d{4})-(\d{2})/.exec(isoFact || '')
        if (mFact) {
          const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
          result.periodo = `${MESES_LARGOS[+mFact[2] - 1]} ${mFact[1]}`
        }
      }
      logImportAttempt({
        tipo: isImage ? 'imagen' : 'pdf',
        nombreArchivo: archivo.name,
        estado: 'exito',
        tarjetaDetectada: result.tarjeta_detectada || null,
        tipoDocumento: result.tipo_documento || null,
        transaccionesDetectadas: result.transacciones?.length ?? null,
      })
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
        setStep('select_account_banco')
      } else {
        setStep('select_account')
      }
    } catch (err) {
      showToast('Error procesando el PDF: ' + err.message, 'error')
      logImportAttempt({
        tipo: archivo?.type?.startsWith('image/') ? 'imagen' : 'pdf',
        nombreArchivo: archivo?.name,
        estado: 'error',
        errorMensaje: err.message,
      })
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
        const nombreBase = prevMatch.nombre.replace(/\s*\d+\/\d+\s*$/, '').trim()
        const nombreConCuota = nombreBase ? `${nombreBase} ${num}/${total}` : `${num}/${total}`
        return {
          ...t,
          nombre_limpio: nombreConCuota,
          categoria_sugerida: prevMatch.categories?.nombre || t.categoria_sugerida,
          subcategoria_sugerida: prevMatch.subcategories?.nombre || t.subcategoria_sugerida,
        }
      })
    } catch { return transacciones }
  }

  const calcularDuplicadosPDF = async (transacciones, accountId, fechaFacturacion) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      // Los ingresos de un extracto de banco se guardan en la cuenta "Ingresos" separada
      // (ver guardarImportacion), no en la cuenta que se está importando. Si no se consulta
      // también esa cuenta, nunca se detectan como duplicados los ingresos ya cargados a mano.
      const ingresosAcc = accounts.find(a => a.tipo === 'ingreso')
      const accountIds = (ingresosAcc && ingresosAcc.id !== accountId) ? [accountId, ingresosAcc.id] : [accountId]
      const txExistentes = await fetchAllTxPages(() =>
        supabase.from('transactions')
          .select('fecha, monto, moneda, account_id')
          .eq('user_id', user.id)
          .in('account_id', accountIds)
      )

      let billingMes = null
      if (fechaFacturacion) {
        const parts = fechaFacturacion.split('/')
        if (parts.length === 3) {
          const year = parts[2].length === 2 ? '20' + parts[2] : parts[2]
          billingMes = `${year}-${parts[1].padStart(2,'0')}`
        }
      }

      const fechaCercana = (f1, f2, dias = 5) => {
        if (!f1 || !f2) return false
        const d1 = new Date(f1.slice(0, 10) + 'T12:00:00')
        const d2 = new Date(f2.slice(0, 10) + 'T12:00:00')
        return Math.abs(d1 - d2) <= dias * 86400000
      }

      const dupes = new Set()
      const selec = new Set()
      transacciones.forEach((t, i) => {
        const esCuota = t.cuotas_total > 1
        const esIngreso = t.tipo === 'ingreso' || t.es_credito
        const cuentaEsperada = (esIngreso && ingresosAcc) ? ingresosAcc.id : accountId
        const isDupe = txExistentes?.some(e => {
          if (e.account_id !== cuentaEsperada) return false
          if ((e.moneda || 'ARS') !== (t.moneda || 'ARS')) return false
          const montoMatch = Math.abs(Math.abs(Number(e.monto)) - Math.abs(Number(t.monto))) < 0.01
          if (!montoMatch) return false
          if (esCuota && billingMes) return e.fecha?.slice(0, 7) === billingMes
          return fechaCercana(e.fecha, t.fecha, 5)
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

  const crearYSeleccionarCuenta = async (nombre, tipo) => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: account } = await supabase.from('accounts').insert({
      user_id: user.id, nombre, tipo,
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

  const handleCreateNewForUpload = async (e) => {
    e.preventDefault()
    await crearYSeleccionarCuenta(newAccountForUpload.nombre, newAccountForUpload.tipo)
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

    // Actualizar todas las transacciones con el mismo detalle (no solo la actual)
    const { data: { user: uClasif } } = await supabase.auth.getUser()
    if (detalle) {
      await supabase.from('transactions').update({
        nombre: txEditTemp.nombre,
        category_id: catObj?.id || null,
        subcategory_id: subcatObj?.id || null,
        estado: 'identificado'
      }).eq('user_id', uClasif.id).eq('detalle', detalle).eq('estado', 'a_identificar')
    } else {
      await supabase.from('transactions').update({
        nombre: txEditTemp.nombre,
        category_id: catObj?.id || null,
        subcategory_id: subcatObj?.id || null,
        estado: 'identificado'
      }).eq('id', txId)
    }

    // Guardar regla aprendida
    if (detalle && catObj) {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('user_rules').upsert({
        user_id: user.id,
        texto_original: detalle.trim(),
        nombre_asignado: txEditTemp.nombre || detalle.trim(),
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
      setTxEditTemp({ nombre: next.detalle || '', categoria: 'A Identificar', subcategoria: '' })
    } else {
      // Terminamos, ir a contexto o cerrar
      finalizarCarga()
    }
  }

  const handleSaltarClasificacion = () => {
    if (txIdentificarIdx + 1 < txSinIdentificar.length) {
      const next = txSinIdentificar[txIdentificarIdx + 1]
      setTxIdentificarIdx(i => i + 1)
      setTxEditTemp({ nombre: next.detalle || '', categoria: 'A Identificar', subcategoria: '' })
    } else {
      finalizarCarga()
    }
  }

  const handleMarcarNeutro = async (txId) => {
    const txDet = txSinIdentificar[txIdentificarIdx]?.detalle
    const { data: { user: uNeutro } } = await supabase.auth.getUser()
    if (txDet) {
      await supabase.from('transactions').update({ tipo: 'neutro', estado: 'identificado' }).eq('user_id', uNeutro.id).eq('detalle', txDet).eq('estado', 'a_identificar')
    } else {
      await supabase.from('transactions').update({ tipo: 'neutro', estado: 'identificado' }).eq('id', txId)
    }
    if (txIdentificarIdx + 1 < txSinIdentificar.length) {
      const next = txSinIdentificar[txIdentificarIdx + 1]
      setTxIdentificarIdx(i => i + 1)
      setTxEditTemp({ nombre: next.detalle || '', categoria: 'A Identificar', subcategoria: '' })
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
      const { data: { user } } = await supabase.auth.getUser()
      const { data } = await supabase.from('children').insert({ user_id: user.id, nombre }).select().single()
      if (data) setChildrenDB(prev => [...prev, data].sort((a, b) => a.nombre.localeCompare(b.nombre)))
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
    try {
    const { data: { user } } = await supabase.auth.getUser()
    const esBanco = statementData.tipo_documento === 'banco'

    const { data: categorias } = await supabase.from('categories').select('id, nombre').or(`user_id.eq.${user.id},es_sistema.eq.true`)
    const getCategoryId = (cat) => {
      if (!categorias || !cat) return null
      return categorias.find(c => c.nombre.toLowerCase() === cat.toLowerCase())?.id || null
    }
    const catIdsForSub2 = (categorias || []).map(c => c.id)
    const { data: subcategorias } = catIdsForSub2.length > 0
      ? await supabase.from('subcategories').select('id, nombre, category_id').in('category_id', catIdsForSub2)
      : { data: [] }
    const getSubcategoryId = (sub, catId) => {
      if (!subcategorias || !sub || !catId) return null
      return subcategorias.find(s => s.nombre.toLowerCase() === sub.toLowerCase() && s.category_id === catId)?.id || null
    }
    // Valida que el "hijo" sugerido por la IA corresponda a un hijo real registrado
    const getHijoTag = (hijo) => {
      if (!hijo) return null
      return childrenDB.find(c => c.nombre.toLowerCase() === hijo.toLowerCase())?.nombre || null
    }
    // Contextos propios del usuario (wallets, cuentas, nombre propio) → auto-neutro en créditos
    const { data: contextoRules } = await supabase.from('user_rules')
      .select('texto_original').eq('user_id', user.id).like('texto_original', 'contexto_%')
    const contextoNames = (contextoRules || [])
      .map(r => r.texto_original.replace('contexto_', '').toLowerCase().trim())
      .filter(n => n.length > 3)

    // Historial de ingresos ya editados: si el usuario cambió el nombre/tag antes, aplicarlo automáticamente
    const { data: incomeHistory } = await supabase.from('transactions')
      .select('detalle, nombre, tag').eq('user_id', user.id).eq('tipo', 'ingreso').not('nombre', 'is', null).not('tag', 'is', null)
    const matchIngresoHistorial = (detalle) => {
      if (!incomeHistory || !detalle) return null
      const exacto = incomeHistory.find(h => h.detalle === detalle && h.nombre && h.tag)
      if (exacto) return { nombre: exacto.nombre, tag: exacto.tag }
      // fuzzy: si el detalle comienza igual (primer 30 chars) — captura variaciones de monto/referencia
      const prefix = detalle.trim().slice(0, 30).toLowerCase()
      const fuzzy = incomeHistory.find(h => h.detalle && h.detalle.trim().toLowerCase().startsWith(prefix) && h.nombre && h.tag)
      return fuzzy ? { nombre: fuzzy.nombre, tag: fuzzy.tag } : null
    }

    if (esBanco) {
      // Cuenta de egresos: la que el usuario eligió en el paso select_account_banco
      const cuentaEgresos = targetAccount
      if (!cuentaEgresos) {
        showToast('No se seleccionó la cuenta de destino', 'error')
        setLoading(false)
        return
      }

      const { data: existing } = await supabase.from('statements')
        .select('id').eq('account_id', cuentaEgresos.id).eq('periodo', statementData.periodo).maybeSingle()
      if (existing) {
        // Si el extracto existente no tiene transacciones, es el resto de un
        // intento que falló a mitad de camino: se limpia y se reintenta.
        const { count: txCount } = await supabase.from('transactions')
          .select('id', { count: 'exact', head: true }).eq('statement_id', existing.id)
        if ((txCount || 0) > 0) {
          // Puede ser un extracto distinto con el mismo período detectado
          // (ej. resumen que cierra al mes siguiente): consultar, no denegar.
          const seguir = window.confirm(`Ya cargaste un extracto de ${statementData.periodo} para esta cuenta.\n\nSi este es OTRO extracto (por ejemplo, el que cierra el mes siguiente), podés cargarlo igual: los movimientos repetidos aparecen tachados como "ya cargados".\n\n¿Querés cargarlo?`)
          if (!seguir) { setLoading(false); return }
        } else {
          await supabase.from('statements').delete().eq('id', existing.id)
        }
      }

      // Ingresos van a la cuenta Ingresos principal (tipo='ingreso')
      const cuentaIngresos = await getOrCreateIngresosAccount(user)
      const hayIngresosParaGuardar = statementData.transacciones.some((t, i) => pdfTxSelections.has(i) && (t.tipo === 'ingreso' || t.es_credito))
      if (hayIngresosParaGuardar && !cuentaIngresos) {
        showToast('No se pudo crear la cuenta de Ingresos. Revisá los permisos.', 'error')
        setLoading(false)
        return
      }

      const { data: stmtEgresos, error: errStmtEg } = await supabase.from('statements').insert({
        user_id: user.id, account_id: cuentaEgresos.id, nombre_archivo: archivo.name,
        periodo: statementData.periodo, fecha_desde: null,
        fecha_hasta: parseFechaArgentina(statementData.fecha_facturacion), total_resumen: null, estado: 'completo'
      }).select().single()
      if (errStmtEg || !stmtEgresos) {
        showToast(`Error creando el extracto: ${errStmtEg?.message || 'desconocido'}`, 'error')
        logImportAttempt({ tipo: 'pdf', nombreArchivo: archivo?.name, estado: 'error', errorMensaje: `Guardado banco (statement): ${errStmtEg?.message || 'desconocido'}` })
        setLoading(false)
        return
      }

      // Statement de ingresos solo si hay transacciones de ingreso
      const hayIngresosEnExtracto = statementData.transacciones.some(t => (t.tipo || (t.es_credito ? 'ingreso' : 'gasto')) === 'ingreso')
      let stmtIngresos = null
      if (hayIngresosEnExtracto && cuentaIngresos) {
        // Verificar si ya existe statement para ingresos en este periodo
        const { data: existingIngreso } = await supabase.from('statements')
          .select('id').eq('account_id', cuentaIngresos.id).eq('periodo', statementData.periodo).maybeSingle()
        if (existingIngreso) {
          stmtIngresos = existingIngreso
        } else {
          const { data: si } = await supabase.from('statements').insert({
            user_id: user.id, account_id: cuentaIngresos.id, nombre_archivo: archivo.name,
            periodo: statementData.periodo, fecha_desde: null,
            fecha_hasta: parseFechaArgentina(statementData.fecha_facturacion), total_resumen: null, estado: 'completo'
          }).select().single()
          stmtIngresos = si
        }
      }

      const txEgresos = []
      const txIngresos = []

      const inferirTagIngreso = (detalle, nombreLimpio, subcatSugerida) => {
        const txt = ((detalle || '') + ' ' + (nombreLimpio || '')).toLowerCase()
        if (txt.includes('rendimiento') || txt.includes('interes') || txt.includes('interés')) return 'Inversiones'
        if (txt.includes('cuota alimentaria') || txt.includes('alimentos')) return 'Cuota Alimentaria'
        if (subcatSugerida && subcatSugerida !== 'Otros') return subcatSugerida
        return null
      }

      statementData.transacciones.forEach((t, i) => {
        if (!pdfTxSelections.has(i)) return
        const categoryId = getCategoryId(t.categoria_sugerida)
        const subcategoryId = getSubcategoryId(t.subcategoria_sugerida, categoryId)
        const detalleTxLower = ((t.nombre_original || '') + ' ' + (t.nombre_limpio || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        const esDevolucion = detalleTxLower.includes('devoluci') || detalleTxLower.includes('dev.imp') || detalleTxLower.includes('reintegro') || detalleTxLower.includes('acreditacion') || detalleTxLower.includes('acreditación')
        const esNeutroAuto = detalleTxLower.includes('conversion a eur') || detalleTxLower.includes('conversion a usd') || detalleTxLower.includes('fondeo') || detalleTxLower.includes('repatriaci') || detalleTxLower.includes('transferencia entre cuenta') || (t.es_credito && contextoNames.some(n => detalleTxLower.includes(n)))
        const tipoTx = esNeutroAuto ? 'neutro' : esDevolucion ? 'ingreso' : (t.tipo || (t.es_credito ? 'ingreso' : 'gasto'))
        if (tipoTx === 'ingreso' && cuentaIngresos) {
          // Ingresos: van a la cuenta Ingresos principal, usan tag para categoría
          const histMatch = matchIngresoHistorial(t.nombre_original)
          txIngresos.push({
            user_id: user.id, fecha: t.fecha,
            nombre: histMatch?.nombre || (t.nombre_limpio !== t.nombre_original ? t.nombre_limpio : (t.nombre_limpio || null)),
            detalle: t.nombre_original,
            monto: Math.abs(t.monto), moneda: t.moneda || 'ARS',
            cuotas_total: null, cuota_numero: null,
            category_id: null, subcategory_id: null,
            tag: histMatch?.tag || inferirTagIngreso(t.nombre_original, t.nombre_limpio, t.subcategoria_sugerida),
            estado: 'identificado', es_manual: false,
            account_id: cuentaIngresos.id, statement_id: stmtIngresos?.id || null, tipo: 'ingreso',
            fx_rate: (t.moneda || 'ARS') === 'USD' ? (parseFloat(tipoCambioEfectivo) || null) : null,
          })
        } else if (tipoTx !== 'ingreso') {
          txEgresos.push({
            user_id: user.id, fecha: t.fecha,
            nombre: t.nombre_limpio !== t.nombre_original ? t.nombre_limpio : null,
            detalle: t.nombre_original,
            monto: Math.abs(t.monto), moneda: t.moneda || 'ARS',
            cuotas_total: null, cuota_numero: null,
            category_id: categoryId, subcategory_id: subcategoryId,
            fx_rate: (t.moneda || 'ARS') === 'USD' ? (parseFloat(tipoCambioEfectivo) || null) : null,
            tag: getHijoTag(t.hijo),
            estado: (tipoTx === 'neutro' || (t.nombre_limpio && t.nombre_limpio !== t.nombre_original)) ? 'identificado' : 'a_identificar',
            es_manual: false,
            account_id: cuentaEgresos.id, statement_id: stmtEgresos.id, tipo: tipoTx === 'neutro' ? 'neutro' : 'gasto'
          })
        }
      })

      const insertedIds = []
      const txEgresosFinal = dividirTresVias(txEgresos, categorias, subcategorias)
      if (txEgresosFinal.length > 0) {
        const { data: ins, error: errEg } = await supabase.from('transactions').insert(txEgresosFinal).select('id, detalle, estado')
        if (errEg) {
          showToast(`Error egresos: ${errEg.message}`, 'error')
          logImportAttempt({ tipo: 'pdf', nombreArchivo: archivo?.name, estado: 'error', errorMensaje: `Guardado banco (egresos): ${errEg.message}` })
          // Dejar el estado limpio para que el reintento no quede bloqueado
          await supabase.from('statements').delete().eq('id', stmtEgresos.id)
          setLoading(false); return
        }
        if (ins) insertedIds.push(...ins)
      }
      if (txIngresos.length > 0) {
        const { data: ins, error: errIn } = await supabase.from('transactions').insert(txIngresos).select('id, detalle, estado')
        if (errIn) {
          showToast(`Error ingresos: ${errIn.message}`, 'error')
          logImportAttempt({ tipo: 'pdf', nombreArchivo: archivo?.name, estado: 'error', errorMensaje: `Guardado banco (ingresos): ${errIn.message}` })
          setLoading(false); return
        }
        if (ins) insertedIds.push(...ins)
      }
      if (txEgresos.length === 0 && txIngresos.length === 0) {
        showToast('No se detectaron transacciones para importar.', 'error')
        setLoading(false)
        return
      }

      // Preparar paso identificar — deduplicar por detalle (una pregunta por nombre único)
      const sinId = insertedIds.filter(t => t.estado === 'a_identificar')
      const seen = new Set()
      const sinIdUnicos = sinId.filter(t => { const k = (t.detalle || String(t.id)).toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true })
      if (sinIdUnicos.length > 0) {
        setTxSinIdentificar(sinIdUnicos)
        setTxIdentificarIdx(0)
        setTxEditTemp({ nombre: sinIdUnicos[0].detalle || '', categoria: 'A Identificar', subcategoria: '' })
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
        // Si el extracto existente no tiene transacciones, es el resto de un
        // intento que falló a mitad de camino: se limpia y se reintenta.
        const { count: txCount } = await supabase.from('transactions')
          .select('id', { count: 'exact', head: true }).eq('statement_id', existing.id)
        if ((txCount || 0) > 0) {
          // Puede ser un resumen distinto con el mismo período detectado
          // (ej. resumen que cierra al mes siguiente): consultar, no denegar.
          const seguir = window.confirm(`Ya cargaste un resumen de ${statementData.periodo} para esta cuenta.\n\nSi este es OTRO resumen (por ejemplo, el que cierra el mes siguiente), podés cargarlo igual: los movimientos repetidos aparecen tachados como "ya cargados".\n\n¿Querés cargarlo?`)
          if (!seguir) { setLoading(false); return }
        } else {
          await supabase.from('statements').delete().eq('id', existing.id)
        }
      }

      const { data: statement, error: errStmt } = await supabase.from('statements').insert({
        user_id: user.id, account_id: account.id, nombre_archivo: archivo.name,
      periodo: statementData.periodo, fecha_desde: null,
        fecha_hasta: parseFechaArgentina(statementData.fecha_facturacion),
        fecha_vencimiento: parseFechaArgentina(statementData.fecha_vencimiento),
        total_resumen: statementData.total_pesos,
        total_dolares: statementData.total_dolares ?? null, estado: 'completo'
      }).select().single()
      if (errStmt || !statement) {
        showToast(`Error creando el extracto: ${errStmt?.message || 'desconocido'}`, 'error')
        logImportAttempt({ tipo: 'pdf', nombreArchivo: archivo?.name, estado: 'error', errorMensaje: `Guardado tarjeta (statement): ${errStmt?.message || 'desconocido'}` })
        setLoading(false)
        return
      }

      const fechaResumen = statementData.fecha_facturacion || null
      // Solo importar las transacciones que el usuario seleccionó en el preview
      const transaccionesCandidatas = statementData.transacciones
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
          const detalleTxLowerC = ((t.nombre_original || '') + ' ' + (t.nombre_limpio || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
          const esDevolucionC = detalleTxLowerC.includes('devoluci') || detalleTxLowerC.includes('dev.imp') || detalleTxLowerC.includes('reintegro')
          const esCreditoC = t.es_credito || esDevolucionC || t.tipo === 'ingreso'
          return {
            user_id: user.id, account_id: account.id, statement_id: statement.id,
            fecha: fechaFinal,
            nombre: t.nombre_limpio !== t.nombre_original ? t.nombre_limpio : null,
            detalle: t.nombre_original,
            monto: Math.abs(t.monto),
            moneda: t.moneda, cuotas_total: t.cuotas_total, cuota_numero: t.cuota_numero,
            tipo: t.tipo === 'neutro' ? 'neutro' : (esCreditoC ? 'ingreso' : 'gasto'), category_id: categoryId,
            subcategory_id: getSubcategoryId(t.subcategoria_sugerida, categoryId),
            fx_rate: t.moneda === 'USD' ? (parseFloat(tipoCambioEfectivo) || null) : null,
            tag: getHijoTag(t.hijo),
            estado: (!t.nombre_limpio || t.nombre_limpio === t.nombre_original) ? 'a_identificar' : 'identificado',
            es_manual: false
          }
        })

      // Evitar duplicar movimientos que ya estaban cargados en la cuenta (ej. por Excel,
      // mientras se esperaba este resumen): mismo día, monto y detalle → se omite.
      const existentesTarjeta = await fetchAllTxPages(() =>
        supabase.from('transactions').select('fecha, monto, moneda, detalle').eq('account_id', account.id)
      )
      const normDetTarjeta = (s) => (s || '').toLowerCase().trim()
      const transacciones = transaccionesCandidatas.filter(cand =>
        !(existentesTarjeta || []).some(e =>
          e.fecha === cand.fecha &&
          (e.moneda || 'ARS') === (cand.moneda || 'ARS') &&
          Math.abs(Number(e.monto) - cand.monto) < 0.01 &&
          normDetTarjeta(e.detalle) === normDetTarjeta(cand.detalle)
        )
      )
      const omitidasTarjeta = transaccionesCandidatas.length - transacciones.length

      if (transacciones.length === 0) {
        showToast(`Todas las transacciones de este resumen ya estaban cargadas (${omitidasTarjeta} duplicadas omitidas).`, 'error')
        await supabase.from('statements').delete().eq('id', statement.id)
        setLoading(false)
        return
      }

      const transaccionesFinal = dividirTresVias(transacciones, categorias, subcategorias)
      const { data: inserted, error: errTxTarjeta } = await supabase.from('transactions').insert(transaccionesFinal).select('id, detalle, estado')
      if (errTxTarjeta) {
        showToast(`Error al guardar: ${errTxTarjeta.message}`, 'error')
        logImportAttempt({ tipo: 'pdf', nombreArchivo: archivo?.name, estado: 'error', errorMensaje: `Guardado tarjeta: ${errTxTarjeta.message}` })
        // Dejar el estado limpio para que el reintento no quede bloqueado
        await supabase.from('statements').delete().eq('id', statement.id)
        setLoading(false)
        return
      }
      if (omitidasTarjeta > 0) {
        showToast(`${transacciones.length} transacciones importadas. ${omitidasTarjeta} duplicadas exactas omitidas.`)
      }

      // Los movimientos sueltos (sin statement_id) que caen dentro del período que este
      // resumen cierra se ligan solos la próxima vez que se abra la cuenta — ver
      // reconciliarSueltas en AccountDetail.js, que usa directamente la fecha de cierre
      // del resumen en vez de tratar de adivinar cuáles del PDF ya estaban cargadas.

      // El "Contando desde" manual (ciclo_actual_desde) existe para trackear el gasto
      // sin resumen todavía; una vez que llega el PDF real, ese propósito ya se cumplió.
      // Si no se limpia, la tarjeta "Ciclo actual" sigue apareciendo (aunque en $0) en vez
      // de desaparecer, y el próximo ciclo abierto quedaría mal acotado por una fecha vieja.
      await supabase.from('accounts').update({ ciclo_actual_desde: null }).eq('id', account.id)

      // Preparar paso identificar — deduplicar por detalle
      const sinId = (inserted || []).filter(t => t.estado === 'a_identificar')
      const seen2 = new Set()
      const sinIdUnicos2 = sinId.filter(t => { const k = (t.detalle || String(t.id)).toLowerCase().trim(); if (seen2.has(k)) return false; seen2.add(k); return true })
      if (sinIdUnicos2.length > 0) {
        setTxSinIdentificar(sinIdUnicos2)
        setTxIdentificarIdx(0)
        setTxEditTemp({ nombre: sinIdUnicos2[0].detalle || '', categoria: 'A Identificar', subcategoria: '' })
        setStep('identificar')
      } else {
        finalizarCarga()
      }
    }

    fetchAccounts()
    } catch (err) {
      showToast('Error al guardar: ' + err.message, 'error')
      logImportAttempt({ tipo: 'pdf', nombreArchivo: archivo?.name, estado: 'error', errorMensaje: `Guardado: ${err.message}` })
    } finally {
      setLoading(false)
    }
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

  const isMobile = windowWidth < 640
  const styles = getStyles(darkMode, isMobile)

  // Mini chart: TC histórico por mes (mismo modelo que AccountDetail.getTC) —
  // memoizado: usa el tcMap/tcMapEUR de arriba en vez de reconstruirlos acá adentro,
  // y solo recalcula cuando cambian sus propias dependencias, no en cada render.
  const miniChartDataComputed = useMemo(() => {
    const mesActual = new Date().toISOString().slice(0, 7)
    return miniChartMeses.map(ym => {
      const tc = ym === mesActual
        ? (parseFloat(tipoCambio) || 1)
        : (tcMap[ym] ? Number(tcMap[ym]) : parseFloat(tipoCambio) || 1)
      const txsMes = miniChartTxs.filter(t => t.fecha?.startsWith(ym))
      const tcEuroMes = ym === mesActual ? (parseFloat(tipoCambioEUR) || 0) : (tcMapEUR[ym] ? Number(tcMapEUR[ym]) : (parseFloat(tipoCambioEUR) || 0))
      const total = txsMes.reduce((s, t) => s + (t.moneda === 'USD' ? t.monto * tc : t.moneda === 'EUR' ? t.monto * tcEuroMes : t.monto), 0)
      const label = new Date(ym + '-15').toLocaleString('es-AR', { month: 'short' })
      return { mes: label.charAt(0).toUpperCase() + label.slice(1), total: Math.round(total) }
    })
  }, [miniChartMeses, miniChartTxs, tipoCambio, tipoCambioEUR, tcMap, tcMapEUR])
  const isTablet = windowWidth >= 640 && windowWidth < 960
  const isPortraitMobile = isMobile && windowHeight > windowWidth
  const txActual = txSinIdentificar[txIdentificarIdx]
  const contextoActual = contextoDetectado[contextoIdx]

  // Cuotas pendientes: proyección de cuotas restantes de compras financiadas, por mes,
  // próximos 6 períodos. Memoizado a nivel del componente (no adentro de sideWidgets,
  // que es una función plana invocada condicionalmente — un hook ahí violaría las
  // Rules of Hooks) porque antes se recalculaba entero (agrupar, desduplicar sufijos,
  // proyectar) en cada render en el que se mostrara el widget.
  const cuotasPendientesMemo = useMemo(() => {
    // Alquiler/Expensas no son compras financiadas aunque hayan quedado
    // cargadas con cuotas — son un gasto fijo recurrente, no algo con
    // fecha de fin, así que no cuentan para esta proyección.
    const conCuotas = accountTransactions.filter(t =>
      t.tipo === 'gasto' && (t.cuotas_total || 1) > 1 && (t.cuota_numero || 0) > 0 && t.fecha &&
      !(t.categories?.nombre === 'Casa' && ['Alquiler', 'Expensas'].includes(t.subcategories?.nombre))
    )
    if (conCuotas.length === 0) return []

    // Sacar primero la marca de "dividir en 3" (Vitto/Amelia/yo) y recién
    // después el sufijo de cuota propio del banco ("Compra 4/12"): si la
    // marca queda pegada al final, el "4/12" ya no está al final del
    // string y no se reconoce como sufijo, así que cada cuota de una
    // misma compra dividida quedaba con un nombre distinto ("Compra 4/12
    // (1/3)", "Compra 3/12 (1/3)", ...) y se contaban como compras
    // separadas, cada una proyectando sus cuotas restantes por separado.
    const stripCuotaSuffix = n => (n || '')
      .replace(/\s*\(1\/3\)\s*$/, '')
      .replace(/\s+\d+\/\d+\s*$/, '')
      .trim()
    // El mes en que arrancó la compra (cuota 1) identifica la compra de
    // forma estable entre sus cuotas, a diferencia del monto: si el monto
    // varía cuota a cuota (ej. en dólares, con el tipo de cambio de cada
    // mes), usar Math.round(monto) partía la misma compra en varias
    // entradas, cada una proyectando sus propias cuotas restantes por
    // separado — duplicando el total de los meses futuros.
    const mesInicioCompra = t => {
      const f = new Date(t.fecha + 'T12:00:00')
      const d = new Date(f.getFullYear(), f.getMonth() - ((t.cuota_numero || 1) - 1), 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    const groupKey = t => `${stripCuotaSuffix(t.nombre || t.detalle || '').toLowerCase()}|${t.cuotas_total}|${t.account_id}|${mesInicioCompra(t)}`
    // Una compra dividida en 3 (Vitto/Amelia/yo) queda como 3 filas reales
    // con el mismo número de cuota — hay que sumarlas para recuperar el
    // monto total de esa cuota, no quedarnos con una sola parte.
    const maxCuotaPorGrupo = {}
    conCuotas.forEach(t => {
      const key = groupKey(t)
      const cn = t.cuota_numero || 0
      if (!maxCuotaPorGrupo[key] || cn > maxCuotaPorGrupo[key]) maxCuotaPorGrupo[key] = cn
    })
    const latestByPurchase = {}
    conCuotas.forEach(t => {
      const key = groupKey(t)
      if ((t.cuota_numero || 0) !== maxCuotaPorGrupo[key]) return
      if (!latestByPurchase[key]) latestByPurchase[key] = { ...t, monto: 0 }
      latestByPurchase[key].monto += Number(t.monto)
    })

    const today = new Date()
    const todayPeriod = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`
    const tc = parseFloat(tipoCambio) || 0
    const byPeriod = {}

    Object.values(latestByPurchase).forEach(t => {
      const remaining = (t.cuotas_total || 1) - (t.cuota_numero || 1)
      if (remaining <= 0) return
      const baseDate = new Date(t.fecha + 'T12:00:00')
      for (let i = 1; i <= remaining; i++) {
        const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1)
        const period = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        if (period < todayPeriod) continue
        if (!byPeriod[period]) byPeriod[period] = { items: [], total_ars: 0 }
        const arsEquiv = t.moneda === 'USD' && tc > 0 ? t.monto * tc : t.moneda === 'ARS' ? t.monto : t.monto
        byPeriod[period].total_ars += arsEquiv
        byPeriod[period].items.push({
          nombre: stripCuotaSuffix(t.nombre || t.detalle || 'Sin nombre'),
          monto: t.monto,
          moneda: t.moneda || 'ARS',
          cuotaNum: (t.cuota_numero || 1) + i,
          cuotasTotal: t.cuotas_total,
          cuenta: t.accounts?.nombre || ''
        })
      }
    })

    return Object.entries(byPeriod).sort(([a], [b]) => a.localeCompare(b)).slice(0, 6)
  }, [accountTransactions, tipoCambio])

  // Evolución por categoría (sidebar): opciones de categoría/subcategoría/hijo
  // (gasto) o tag (ingreso) con datos + serie de 6 meses de CADA selección activa —
  // selección múltiple y libre, mezclando categorías y subcategorías a la vez.
  // Memoizado a nivel del componente por la misma razón que cuotasPendientesMemo
  // (sideWidgets no puede llamar hooks). El TC histórico (tcMap/tcMapEUR, promedio
  // por mes según el tipo de dólar elegido) es el mismo criterio que ya usa el resto
  // de la app para convertir USD/EUR de meses pasados — no se tocó esa lógica.
  const evolucionCategoriaMemo = useMemo(() => {
    const categoriasConTx = [...new Set(
      accountTransactions.filter(t => t.tipo === 'gasto' && t.categories?.nombre)
        .map(t => t.categories.nombre)
    )].sort()
    // Subcategorías con datos, como pares [categoría, subcategoría] — dos categorías
    // distintas pueden tener una subcategoría con el mismo nombre, así que la clave
    // de selección necesita la categoría para no confundirlas.
    const subcatsConTx = [...new Map(
      accountTransactions.filter(t => t.tipo === 'gasto' && t.categories?.nombre && t.subcategories?.nombre)
        .map(t => [`${t.categories.nombre}::${t.subcategories.nombre}`, { categoria: t.categories.nombre, subcategoria: t.subcategories.nombre }])
    ).values()].sort((a, b) => a.categoria.localeCompare(b.categoria) || a.subcategoria.localeCompare(b.subcategoria))
    const ingresosConTx = [...new Set(
      accountTransactions.filter(t => t.tipo === 'ingreso' && t.tag)
        .map(t => t.tag)
    )].sort()
    const getHijoName = (t) => t.children?.nombre || t.tag || null
    const hijosConTx = [...new Set(
      accountTransactions.filter(t => t.tipo === 'gasto' && getHijoName(t))
        .map(t => getHijoName(t))
    )].sort()

    const matchesKey = (t, key) => {
      if (key.startsWith('ingreso:')) return t.tipo === 'ingreso' && t.tag === key.slice(8)
      if (key.startsWith('hijo:')) return t.tipo === 'gasto' && getHijoName(t) === key.slice(5)
      if (key.startsWith('sub:')) {
        const [cat, sub] = key.slice(4).split('::')
        return t.tipo === 'gasto' && t.categories?.nombre === cat && t.subcategories?.nombre === sub
      }
      return t.tipo === 'gasto' && t.categories?.nombre === key.slice(4)
    }
    const labelDeKey = (key) => {
      if (key.startsWith('ingreso:')) return key.slice(8)
      if (key.startsWith('hijo:')) return key.slice(5)
      if (key.startsWith('sub:')) { const [cat, sub] = key.slice(4).split('::'); return `${cat} › ${sub}` }
      return key.slice(4)
    }
    // Color/ícono consistentes con el resto de la app: subcategorías toman el color
    // determinístico de su propio nombre (distinto del de la categoría padre),
    // hijos el determinístico de su nombre, categorías/ingresos el resolver
    // compartido (mapeo manual o determinístico).
    const colorDeKey = (key) => {
      if (key.startsWith('ingreso:')) return resolveCategoryColor(key.slice(8), { isIncome: true })
      if (key.startsWith('sub:')) { const [, sub] = key.slice(4).split('::'); return resolveCategoryColor(sub) }
      if (key.startsWith('hijo:')) return resolveCategoryColor(key.slice(5))
      return resolveCategoryColor(key.slice(4))
    }
    const iconDeKey = (key) => {
      if (key.startsWith('ingreso:')) return resolveCategoryIcon(key.slice(8), { customIcons, isIncome: true })
      if (key.startsWith('hijo:')) return customIcons?.[key.slice(5)] || '👧'
      if (key.startsWith('sub:')) return '·'
      return resolveCategoryIcon(key.slice(4), { customIcons })
    }

    const mesActual = new Date().toISOString().slice(0, 7)
    const evolData = getLast6Months().map(m => {
      const tc = tcMap[m] ? Number(tcMap[m]) : (parseFloat(tipoCambio) || 1)
      const tcEuro = m === mesActual ? (parseFloat(tipoCambioEUR) || 0) : (tcMapEUR[m] ? Number(tcMapEUR[m]) : (parseFloat(tipoCambioEUR) || 0))
      const row = { mes: mesLabel(m) }
      sidebarCatEvol.forEach(key => {
        const total = accountTransactions
          .filter(t => t.fecha?.startsWith(m) && matchesKey(t, key))
          .reduce((s, t) => {
            const monto = Number(t.monto)
            return s + (t.moneda === 'USD' && tc > 0 ? monto * tc : t.moneda === 'EUR' && tcEuro > 0 ? monto * tcEuro : t.moneda === 'ARS' ? monto : 0)
          }, 0)
        row[key] = Math.round(total)
      })
      return row
    })
    const seleccion = sidebarCatEvol.map(key => ({ key, label: labelDeKey(key), color: colorDeKey(key), icon: iconDeKey(key) }))

    return { categoriasConTx, subcatsConTx, ingresosConTx, hijosConTx, evolData, seleccion }
  }, [accountTransactions, sidebarCatEvol, tipoCambio, tipoCambioEUR, tcMap, tcMapEUR, customIcons])

  const sideWidgets = () => (
    <>
            {miniChartDataComputed.length > 0 && (
              <div style={{ backgroundColor: styles.savingsPanel.backgroundColor, borderRadius: '16px', padding: '20px 16px', boxShadow: styles.savingsPanel.boxShadow }}>
                <h3 style={styles.savingsPanelTitle}>Resumen general<br/>últimos 6 meses</h3>
                {(() => {
                  const miniAvg = miniChartDataComputed.length > 0 ? Math.round(miniChartDataComputed.reduce((s, d) => s + d.total, 0) / miniChartDataComputed.length) : 0
                  return (
                    <ResponsiveContainer width="100%" height={130}>
                      <BarChart data={miniChartDataComputed} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                        <XAxis dataKey="mes" tick={{ fontSize: 10, fill: darkMode ? '#9A8A9A' : '#888', fontFamily: '"Montserrat", sans-serif' }} axisLine={false} tickLine={false} />
                        <Tooltip
                          formatter={v => [`$ ${v.toLocaleString('es-AR')}`, 'Egresos']}
                          contentStyle={{ borderRadius: '8px', border: 'none', backgroundColor: darkMode ? '#3A333A' : '#fff', fontSize: '11px', fontFamily: '"Montserrat", sans-serif' }}
                          labelStyle={{ color: darkMode ? '#F0EDEC' : '#1d1d1f', fontWeight: '600' }}
                          itemStyle={{ color: darkMode ? '#C8B8C8' : '#555' }}
                          cursor={{ fill: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}
                        />
                        <ReferenceLine y={miniAvg} stroke={darkMode ? '#9A8A9A' : '#8C7B8C'} strokeDasharray="4 3" strokeWidth={1.5} label={{ value: `Prom`, position: 'insideTopLeft', fontSize: 9, fill: darkMode ? '#9A8A9A' : '#8C7B8C', fontFamily: '"Montserrat", sans-serif' }} />
                        <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                          {miniChartDataComputed.map((_, i) => (
                            <Cell key={i} fill={i === miniChartDataComputed.length - 1 ? '#5C4F5C' : (darkMode ? '#4A3F4A' : '#C4B8C4')} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )
                })()}
              </div>
            )}
            {/* Widget: Cuotas pendientes */}
            {(() => {
              const periods = cuotasPendientesMemo
              if (periods.length === 0) return null

              const fmt = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(v))
              const txtClr = darkMode ? '#F0EDEC' : '#1d1d1f'

              return (
                <div style={{ ...styles.savingsPanel }}>
                  <h3 style={styles.savingsPanelTitle}>Cuotas pendientes</h3>
                  {periods.map(([period, data], pi) => {
                    const expandido = cuotasPendientesExpandido === period
                    return (
                      <div key={period} style={{ padding: pi > 0 ? '6px 0 0' : '2px 0 0' }}>
                        <div
                          onClick={() => setCuotasPendientesExpandido(p => p === period ? null : period)}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', cursor: 'pointer' }}>
                          <span style={{ fontSize: '11px', fontWeight: '700', color: txtClr, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{expandido ? '▾' : '▸'} {mesLabel(period)}</span>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: '#5C4F5C' }}>$ {fmt(data.total_ars)}</span>
                        </div>
                        {expandido && (
                          <div style={{ marginTop: '6px', paddingLeft: '8px', borderLeft: `2px solid ${darkMode ? '#3A333A' : '#E2DDE0'}` }}>
                            {data.items.map((it, ii) => (
                              <div key={ii} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73', padding: '2px 0' }}>
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.nombre} ({it.cuotaNum}/{it.cuotasTotal}) · {it.cuenta}</span>
                                <span style={{ whiteSpace: 'nowrap' }}>{it.moneda === 'USD' ? 'U$S' : '$'} {fmt(it.monto)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {(() => {
              const { categoriasConTx, subcatsConTx, ingresosConTx, hijosConTx, evolData, seleccion } = evolucionCategoriaMemo
              const borderClr = darkMode ? '#3A333A' : '#E2DDE0'
              const bgClr = darkMode ? '#1C1A1C' : '#F0EDEC'
              const txtClr = darkMode ? '#F0EDEC' : '#5C4F5C'
              const toggleClave = (key) => setSidebarCatEvol(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
              const cambiarTipo = (v) => { if (evolucionTipo !== v) { setEvolucionTipo(v); setSidebarCatEvol([]) } }
              const chip = (key, label, icon) => {
                const activo = sidebarCatEvol.includes(key)
                const color = resolveCategoryColor(key.includes('::') ? key.split('::')[1] : label, { isIncome: evolucionTipo === 'ingreso' })
                return (
                  <button key={key} onClick={() => toggleClave(key)}
                    style={{ padding: '5px 11px', borderRadius: '16px', border: `1.5px solid ${activo ? color : borderClr}`, backgroundColor: activo ? color : 'transparent', color: activo ? '#2d2d2d' : txtClr, fontSize: '11px', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif', fontWeight: activo ? '600' : '400', outline: 'none', whiteSpace: 'nowrap' }}>
                    {icon} {label}
                  </button>
                )
              }
              const sinOpciones = evolucionTipo === 'gasto'
                ? categoriasConTx.length === 0 && hijosConTx.length === 0
                : ingresosConTx.length === 0
              return (
                <div style={styles.savingsPanel}>
                  <h3 style={styles.savingsPanelTitle}>📈 Evolución de {evolucionTipo === 'ingreso' ? 'ingresos' : 'gastos'} · ARS (USD/EUR convertidos) · últimos 6 meses</h3>
                  <div style={{ display: 'flex', borderRadius: '8px', border: `1.5px solid ${borderClr}`, overflow: 'hidden', margin: '10px 0 12px' }}>
                    {[{ v: 'gasto', label: 'Gastos' }, { v: 'ingreso', label: 'Ingresos' }].map(opt => (
                      <button key={opt.v} onClick={() => cambiarTipo(opt.v)}
                        style={{ flex: 1, padding: '6px 0', border: 'none', background: evolucionTipo === opt.v ? '#5C4F5C' : 'transparent', color: evolucionTipo === opt.v ? 'white' : (darkMode ? '#9A8A9A' : '#6e6e73'), cursor: 'pointer', fontSize: '12px', fontWeight: '600', fontFamily: '"Montserrat", sans-serif', outline: 'none' }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* Chips de selección múltiple — categorías/subcategorías/hijos (gastos)
                      o tags (ingresos), mezclados libremente, pensados para tocar con el
                      dedo en mobile en vez de un dropdown de un solo valor. */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px', maxHeight: '150px', overflowY: 'auto' }}>
                    {evolucionTipo === 'gasto' && categoriasConTx.map(c => chip(`cat:${c}`, c, resolveCategoryIcon(c, { customIcons })))}
                    {evolucionTipo === 'gasto' && subcatsConTx.map(({ categoria, subcategoria }) => chip(`sub:${categoria}::${subcategoria}`, `${categoria} › ${subcategoria}`, '·'))}
                    {evolucionTipo === 'gasto' && hijosConTx.map(h => chip(`hijo:${h}`, h, customIcons?.[h] || '👧'))}
                    {evolucionTipo === 'ingreso' && ingresosConTx.map(t => chip(`ingreso:${t}`, t, resolveCategoryIcon(t, { customIcons, isIncome: true })))}
                    {sinOpciones && <p style={{ color: '#8e8e93', fontSize: '12px', margin: 0 }}>Sin datos para elegir todavía.</p>}
                  </div>
                  {seleccion.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={190}>
                        <LineChart data={evolData} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                          <XAxis dataKey="mes" tick={{ fontSize: 9, fill: txtClr, fontFamily: '"Montserrat", sans-serif' }} />
                          <YAxis tick={{ fontSize: 9, fill: txtClr, fontFamily: '"Montserrat", sans-serif' }} tickFormatter={v => `$${new Intl.NumberFormat('es-AR', {maximumFractionDigits: 0}).format(v)}`} width={60} />
                          <Tooltip
                            formatter={(value, key) => [`$ ${formatMontoFull(value)}`, seleccion.find(s => s.key === key)?.label || key]}
                            labelFormatter={(l) => l}
                            contentStyle={{ fontFamily: '"Montserrat", sans-serif', borderRadius: '8px', backgroundColor: bgClr, border: `1px solid ${borderClr}`, fontSize: '11px' }}
                            labelStyle={{ color: txtClr, fontWeight: '600' }}
                          />
                          {seleccion.map(s => (
                            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 2.5, fill: s.color }} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: '8px' }}>
                        {seleccion.map(s => (
                          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: txtClr }}>
                            <div style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                            {s.icon} {s.label}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    !sinOpciones && <p style={{ color: '#aaa', fontSize: '12px', margin: 0 }}>Elegí una o más categorías, subcategorías, hijos o ingresos para ver su evolución.</p>
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
              <div style={{ display: 'flex', gap: '6px' }}>
                {['ARS', 'USD', 'EUR'].map(m => (
                  <button key={m} onClick={() => setAhorro({...ahorro, moneda: m})} style={{ flex: 1, padding: '8px 0', borderRadius: '8px', border: `1px solid ${ahorro.moneda === m ? '#5C4F5C' : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: ahorro.moneda === m ? '#5C4F5C' : 'transparent', color: ahorro.moneda === m ? '#fff' : (darkMode ? '#9A8A9A' : '#6e6e73'), cursor: 'pointer', fontSize: '13px', fontFamily: '"Montserrat", sans-serif', fontWeight: ahorro.moneda === m ? '600' : '400', outline: 'none', transition: 'all 0.15s' }}>
                    {m}
                  </button>
                ))}
              </div>
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
              const tc = parseFloat(tipoCambio) || 0
              const tcE = parseFloat(tipoCambioEUR) || 0
              if (ahorro.moneda === 'EUR' && tcE === 0) return <p style={styles.savingsHint}>Cargá el tipo de cambio EUR para ver la proyección</p>
              if (ahorro.moneda === 'USD' && tc === 0) return <p style={styles.savingsHint}>Cargá el tipo de cambio USD para ver la proyección</p>
              const fmt = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(v))
              const totalEnARS = ahorro.moneda === 'ARS' ? total : ahorro.moneda === 'USD' ? total * tc : total * tcE
              const totalUSD = tc > 0 ? totalEnARS / tc : null
              const totalEURres = tcE > 0 ? totalEnARS / tcE : null
              return (
                <div style={styles.savingsResult}>
                  <p style={styles.savingsResultPhrase}>Para {anioFin} tendrías</p>
                  {tasa > 0 && <p style={{ ...styles.savingsResultNote, marginBottom: '10px' }}>interés compuesto mensual</p>}
                  {ahorro.moneda !== 'ARS' && <><p style={styles.savingsResultLabel}>Final en pesos</p>
                  <p style={{ ...styles.savingsResultAmount, fontSize: '18px', marginBottom: '12px' }}>$ {fmt(totalEnARS)}</p></>}
                  {ahorro.moneda !== 'USD' && totalUSD != null && <><p style={styles.savingsResultLabel}>Final equiv. en USD</p>
                  <p style={{ ...styles.savingsResultAmount, fontSize: '18px', marginBottom: '12px' }}>U$S {fmt(totalUSD)}</p></>}
                  {ahorro.moneda !== 'EUR' && totalEURres != null && <><p style={styles.savingsResultLabel}>Final equiv. en EUR</p>
                  <p style={{ ...styles.savingsResultAmount, fontSize: '18px', marginBottom: '12px' }}>€ {fmt(totalEURres)}</p></>}
                  <p style={styles.savingsResultLabel}>
                    {ahorro.moneda === 'ARS' ? 'Total acumulado' : ahorro.moneda === 'USD' ? 'Total en USD' : 'Total en EUR'}
                  </p>
                  <p style={{ ...styles.savingsResultAmount, marginBottom: 0 }}>
                    {ahorro.moneda === 'ARS' ? `$ ${fmt(total)}` : ahorro.moneda === 'USD' ? `U$S ${fmt(total)}` : `€ ${fmt(total)}`}
                  </p>
                </div>
              )
            })()}
          </div>
    </>
  )

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

          const eurValor = dolarRates.eur || (tipoCambioEUR ? parseFloat(tipoCambioEUR) : null)
          const eurCard = (
            <div style={{ width: isMobile ? '100px' : '140px', borderRadius: '14px', border: `1px solid ${cardBorder}`, backgroundColor: cardBg, padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', alignSelf: 'flex-start' }}>
              <p style={{ fontSize: '11px', color: '#8e8e93', letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center', margin: 0, fontWeight: 700 }}>Euro</p>
              {eurValor ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: '10px', color: '#8e8e93' }}>€1 =</p>
                  <p style={{ margin: 0, fontSize: isMobile ? '15px' : '18px', fontWeight: 700, color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>$ {new Intl.NumberFormat('es-AR').format(Math.round(eurValor))}</p>
                  {dolarRates.eur && <p style={{ margin: 0, fontSize: '9px', color: '#2ba36e' }}>● en vivo · prom.</p>}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '12px', color: '#8e8e93', textAlign: 'center' }}>Cargando...</p>
              )}
            </div>
          )

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
                <p style={{ margin: 0, fontSize: '12px', color: '#8e8e93', textAlign: 'center' }}>Cargando...</p>
              )}
            </div>
          )

          const vencCard = (
            <div style={{ width: '140px', position: 'relative', borderRadius: '14px', border: `1px solid ${cardBorder}`, backgroundColor: cardBg, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden', boxSizing: 'border-box', maxHeight: vencExpanded ? 'none' : `${dolarCardH || 0}px` }}>
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

          const tcChip = (label, val, unit) => val ? (
            <div style={{ borderRadius: '8px', border: `1px solid ${cardBorder}`, backgroundColor: cardBg, padding: '5px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '80px' }}>
              <p style={{ margin: 0, fontSize: '9px', color: '#8e8e93', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>{label}</p>
              <p style={{ margin: 0, fontSize: '11px', color: '#8e8e93' }}>{unit} =</p>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>$ {new Intl.NumberFormat('es-AR').format(Math.round(val))}</p>
            </div>
          ) : null

          return (
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: isMobile ? '12px 16px' : isTablet ? '12px 20px' : '20px 32px', position: 'relative', minHeight: isMobile ? '60px' : isTablet ? '90px' : '160px' }}>
              {/* Izquierda */}
              {isMobile ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', zIndex: 1 }}>
                  <button onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', fontSize: '26px', cursor: 'pointer', opacity: 0.8, padding: 0 }}>☰</button>
                  {(rateActivo || eurValor || vencList.length > 0) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                      {(rateActivo || eurValor) && (
                        <div style={{ borderRadius: '10px', border: `1px solid ${cardBorder}`, backgroundColor: cardBg, padding: '5px 10px', display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                          {rateActivo && (
                            <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: darkMode ? '#F0EDEC' : '#1d1d1f', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: '9px', color: '#8e8e93', textTransform: 'uppercase', fontWeight: 700, marginRight: '4px' }}>USD</span>
                              $ {new Intl.NumberFormat('es-AR').format(Math.round(rateActivo))}
                            </p>
                          )}
                          {eurValor && (
                            <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: darkMode ? '#F0EDEC' : '#1d1d1f', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: '9px', color: '#8e8e93', textTransform: 'uppercase', fontWeight: 700, marginRight: '4px' }}>EUR</span>
                              $ {new Intl.NumberFormat('es-AR').format(Math.round(eurValor))}
                            </p>
                          )}
                        </div>
                      )}
                      {vencList.length > 0 && (
                        <div onClick={() => { setSelectedAccount('all'); setDashboardTab('vencimientos') }}
                          style={{ borderRadius: '10px', border: `1px solid ${cardBorder}`, backgroundColor: cardBg, padding: '4px 10px', cursor: 'pointer' }}>
                          <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: pendientes.length > 0 ? '#c07a2b' : '#2ba36e', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: '9px', color: '#8e8e93', textTransform: 'uppercase', fontWeight: 700, marginRight: '4px' }}>📅 Venc.</span>
                            {pendientes.length > 0 ? `${pendientes.length} pend.` : '✓ Al día'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : isTablet ? (
                // maxWidth + wrap: que los chips pasen a segunda fila antes de
                // pisar el logo, que está centrado con posición absoluta detrás
                <div style={{ display: 'flex', gap: '6px', zIndex: 1, alignItems: 'flex-start', flexWrap: 'wrap', maxWidth: '34%' }}>
                  {tcChip('Dólar', rateActivo, 'U$S 1')}
                  {tcChip('Euro', eurValor, '€1')}
                  <div onClick={() => { setSelectedAccount('all'); setDashboardTab('vencimientos') }}
                    style={{ borderRadius: '8px', border: `1px solid ${cardBorder}`, backgroundColor: cardBg, padding: '5px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '80px', cursor: 'pointer' }}>
                    <p style={{ margin: 0, fontSize: '9px', color: '#8e8e93', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Vencimientos</p>
                    <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: vencList.length === 0 ? '#8e8e93' : pendientes.length > 0 ? '#c07a2b' : '#2ba36e' }}>
                      {vencList.length === 0 ? '—' : pendientes.length > 0 ? `${pendientes.length} pend.` : '✓ Al día'}
                    </p>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px', zIndex: 1, alignItems: 'flex-start' }}>
                  {usdCard}
                  {eurCard}
                  {vencCard}
                </div>
              )}
              {/* Centro: logo */}
              <img src={logo} alt="MAF" style={{ ...styles.logoImg, height: isMobile ? '60px' : isTablet ? '75px' : '160px', position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: isMobile ? '12px' : isTablet ? '8px' : '20px', pointerEvents: 'none' }} />
              {/* Derecha: luna + config (desktop) + cerrar sesión */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', zIndex: 1 }}>
                <button onClick={() => { const next = !darkMode; setDarkMode(next); localStorage.setItem('darkmode_ma', next); const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', next ? '#3A333A' : '#E4E7F3') }} title={darkMode ? 'Modo claro' : 'Modo oscuro'} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', opacity: 0.7, marginTop: '2px' }}>
                  {darkMode ? '☀️' : '🌙'}
                 </button>
                {!isMobile && (
                  <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
                    <button onClick={() => setConfigOpen(o => !o)} style={{ padding: '7px 13px', borderRadius: '8px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: configOpen ? (darkMode ? '#3A333A' : '#EDE8EC') : 'none', cursor: 'pointer', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73', fontFamily: '"Montserrat", sans-serif', letterSpacing: '0.04em', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '5px' }}>
                      ⚙️ Configuración <span style={{ fontSize: '9px', opacity: 0.7 }}>{configOpen ? '▴' : '▾'}</span>
                    </button>
                    <button onClick={handleLogout} style={{ padding: '7px 13px', borderRadius: '8px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, background: 'none', cursor: 'pointer', fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73', fontFamily: '"Montserrat", sans-serif', letterSpacing: '0.04em', fontWeight: 500 }}>
                      Cerrar sesión
                    </button>
                    {configOpen && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200, display: 'flex', flexDirection: 'column', gap: '4px', backgroundColor: darkMode ? '#1C1A1C' : '#F7F5F8', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, borderRadius: '10px', padding: '8px', minWidth: '220px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
                        <button style={styles.sidebarBtnSecondary} onClick={() => setShowAddAccount(true)}>➕ CREAR CUENTA</button>
                        <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openCategorias()}>✏️ EDITAR CATEGORÍAS</button>
                        {tieneHijos !== false && <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openHijos()}>👧 HIJOS</button>}
                        <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openAliases()}>📋 REGLAS DE CLASIFICACIÓN</button>
                        <button style={styles.sidebarBtnSecondary} onClick={handleReclasificar}>🤖 RE-CLASIFICAR CON IA</button>
                        <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openCambiarClave()}>🔑 CAMBIAR CONTRASEÑA</button>
                        <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openTipoCambio()}>💱 TIPO DE CAMBIO</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Banner: rotar teléfono — solo mobile portrait */}
        {isPortraitMobile && (
          <div style={{ margin: '0 12px 10px', padding: '10px 14px', borderRadius: '12px', backgroundColor: darkMode ? '#2A202A' : '#EDE8EC', border: `1px solid ${darkMode ? '#3A333A' : '#D0C8CC'}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>📱↔️</span>
            <p style={{ margin: 0, fontSize: '12px', color: darkMode ? '#C8B4E8' : '#5C4F5C', fontWeight: '500' }}>
              Girá el teléfono en horizontal para mejor experiencia
            </p>
          </div>
        )}

        <div style={{ ...styles.layout, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-start', padding: isMobile ? '0 12px 48px 12px' : isTablet ? '0 16px 48px 16px' : '0 32px 48px 32px', gap: isMobile ? '12px' : isTablet ? '14px' : '24px' }}>

          {/* Sidebar izquierdo + widget Ahorros (columna izquierda) */}
          {isMobile && (
            <div
              style={{
                position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 150,
                opacity: sidebarOpen ? 1 : 0,
                pointerEvents: sidebarOpen ? 'auto' : 'none',
                transition: 'opacity 0.28s ease',
              }}
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', ...(isMobile ? {} : { flexShrink: 0, alignSelf: 'flex-start' }) }}>
          <div className="sidebar-scroll" style={{ ...styles.sidebar, ...(isTablet ? { width: '200px' } : {}), ...(isMobile ? { position: 'fixed', top: 0, left: 0, bottom: 0, height: '100vh', boxSizing: 'border-box', borderRadius: '0 20px 20px 0', overflow: 'hidden', zIndex: 200, display: 'flex', width: '85vw', maxWidth: '360px', transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)', pointerEvents: sidebarOpen ? 'auto' : 'none' } : {}) }}>
             {/* Zona top fija: solo mobile — botón cerrar */}
            {isMobile && (
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                <button onClick={() => setSidebarOpen(false)} style={{ alignSelf: 'flex-end', background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: darkMode ? '#F0EDEC' : '#1d1d1f', marginBottom: '8px', padding: '4px 8px' }}>
                  ✕
                </button>
              </div>
            )}
            
            {/* Zona media scrollable: lista de cuentas */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', ...(isMobile ? { flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: '8px' } : {}) }}>
            {(() => {
              const cuentasNoIngreso = accounts.filter(a => a.tipo !== 'ingreso')
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

                  {/* CUENTAS + INGRESOS en la misma fila */}
                  {(() => {
                    const cuentaIngresos = ingresoCuentas[0]
                    const isIngresosSelected = !!(cuentaIngresos?.id && selectedAccount?.id === cuentaIngresos.id)
                    const handleClickIngresos = async () => {
                      if (isIngresosSelected) { setSelectedAccount(null); return }
                      if (cuentaIngresos) { setSelectedAccount(cuentaIngresos); setSidebarOpen(false); return }
                      const { data: { user } } = await supabase.auth.getUser()
                      const { data: nueva } = await supabase.from('accounts').insert({ user_id: user.id, nombre: 'Ingresos', tipo: 'ingreso' }).select().single()
                      fetchAccounts()
                      setSelectedAccount(nueva)
                      setSidebarOpen(false)
                    }
                    return (
                      <>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {/* Header INGRESOS — izquierda, sin flecha */}
                          <div style={{ flex: 1, ...styles.sidebarHeader, marginBottom: 0, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={handleClickIngresos}>
                            <span style={{ ...styles.sidebarTitle, ...(isIngresosSelected ? { color: darkMode ? '#8C7B8C' : '#5C4F5C', fontWeight: '600' } : {}) }}>INGRESOS</span>
                          </div>
                          {/* Header CUENTAS — derecha, con flecha */}
                          <div style={{ flex: 1, ...styles.sidebarHeader, marginBottom: 0, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}
                            onClick={() => setCuentasOpen(o => !o)}>
                            <span style={styles.sidebarTitle}>CUENTAS</span>
                            <span style={{ fontSize: '10px', opacity: 0.5, display: 'inline-block', transform: cuentasOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>▼</span>
                          </div>
                        </div>

                        {/* Lista de cuentas (solo cuando está abierta) */}
                        {cuentasOpen && (
                          <div style={{ ...styles.accountsList, marginBottom: '12px', marginTop: '8px' }}>
                            {cuentasNoIngreso.length === 0
                              ? <p style={styles.emptyText}>Sin cuentas.</p>
                              : cuentasNoIngreso.map(renderAccount)
                            }
                            <p style={{ fontSize: '11px', color: '#9A8A9A', margin: '8px 0 0', textAlign: 'center', fontStyle: 'italic' }}>
                              Agregá más cuentas en Configuración ⚙️
                            </p>
                          </div>
                        )}
                      </>
                    )
                  })()}
                </>
              )
            })()}
            </div>{/* fin zona media scrollable */}

            {/* Zona bottom fija: botones de acción — siempre visible */}
            <div style={{ borderTop: `1px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`, paddingTop: '12px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
              {/* Cargar movimiento (gasto / ingreso / neutro) */}
              <button style={styles.sidebarBtnPrimary} onClick={async () => {
                const { data: { user } } = await supabase.auth.getUser()
                let { data: existentes } = await supabase.from('accounts')
                  .select('*').eq('user_id', user.id).eq('tipo', 'efectivo').limit(1)
                let ce = existentes?.[0]
                if (!ce) {
                  const { data: nueva } = await supabase.from('accounts')
                    .insert({ user_id: user.id, nombre: 'Efectivo', tipo: 'efectivo' }).select().single()
                  ce = nueva
                  fetchAccounts()
                }
                setCuentaEfectivoId(ce.id)
                setEfectivo(prev => ({ ...prev, cuenta: ce.id, hijo: '' }))
                setTipoMovimiento('gasto')
                setShowMovimiento(true)
              }}>
                + Cargar movimiento
              </button>

              {/* Importar */}
              <div style={{ position: 'relative' }}>
                <button style={styles.sidebarBtnPrimary} onClick={() => setImportMenuOpen(o => !o)}>
                  + IMPORTAR {importMenuOpen ? '▴' : '▾'}
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
                      <button style={styles.sidebarBtnSecondary} onClick={() => setShowAddAccount(true)}>➕ CREAR CUENTA</button>
                      <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openCategorias()}>✏️ EDITAR CATEGORÍAS</button>
                      {tieneHijos !== false && <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openHijos()}>👧 HIJOS</button>}
                      <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openAliases()}>📋 REGLAS DE CLASIFICACIÓN</button>
                      <button style={styles.sidebarBtnSecondary} onClick={handleReclasificar}>🤖 RE-CLASIFICAR CON IA</button>
                      <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openCambiarClave()}>🔑 CAMBIAR CONTRASEÑA</button>
                      <button style={styles.sidebarBtnSecondary} onClick={() => configPanelRef.current?.openTipoCambio()}>💱 TIPO DE CAMBIO</button>
                    </div>
                  )}
                </>
              )}
              {isMobile && (
                <button style={{ ...styles.logoutBtn, marginTop: '4px' }} onClick={handleLogout}>Cerrar sesión</button>
              )}
            </div>
          </div>

          {/* ── Widget Mis Ahorros — abajo del sidebar, solo no-mobile ── */}
          {!isMobile && (() => {
            const mesActual = new Date().toISOString().slice(0, 7)
            const tc = parseFloat(tipoCambio) || 0
            const tcELive = parseFloat(tipoCambioEUR) || 0
            const tcEDB = Number(exchangeRates.find(r => r.tipo === 'euro' && r.periodo === mesActual)?.valor || 0)
            const tcE = tcELive || tcEDB
            const fmt = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(v))
            const sym = m => m === 'USD' ? 'U$S' : m === 'EUR' ? '€' : '$'
            const totalAhorro = cuentasAhorro.reduce((s, c) => {
              const m = parseFloat(c.monto) || 0
              return s + (c.moneda === 'ARS' ? m : c.moneda === 'USD' ? m * tc : c.moneda === 'EUR' ? m * tcE : 0)
            }, 0)
            const addAhorro = () => {
              const m = parseFloat(newCuentaAhorro.monto)
              if (!newCuentaAhorro.cuenta.trim() || !m || m <= 0) return
              setCuentasAhorro(prev => [...prev, { id: Date.now(), ...newCuentaAhorro, monto: m }])
              setNewCuentaAhorro({ cuenta: '', monto: '', moneda: newCuentaAhorro.moneda })
              setShowAddCuentaAhorro(false)
            }
            return (
              <div style={{ ...styles.savingsPanel, width: '100%', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ ...styles.savingsPanelTitle, margin: 0 }}>Mis ahorros</h3>
                  <button onClick={() => setShowAddCuentaAhorro(v => !v)} style={{ background: 'none', border: `1px solid #5C4F5C`, borderRadius: '6px', color: '#5C4F5C', cursor: 'pointer', fontSize: '16px', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none', lineHeight: 1 }}>
                    {showAddCuentaAhorro ? '✕' : '+'}
                  </button>
                </div>
                {cuentasAhorro.length === 0 && !showAddCuentaAhorro && (
                  <p style={{ fontSize: '12px', color: darkMode ? '#6e6e73' : '#aaa', textAlign: 'center', margin: '4px 0 8px' }}>Sin cuentas cargadas</p>
                )}
                {cuentasAhorro.map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${darkMode ? '#2A272A' : '#F0EDF0'}` }}>
                    <span style={{ fontSize: '12px', color: darkMode ? '#e0e0e0' : '#3a3a3c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.cuenta}</span>
                    <span style={{ fontSize: '12px', fontWeight: '600', color: darkMode ? '#F0EDEC' : '#1d1d1f', marginLeft: '8px', flexShrink: 0 }}>{sym(c.moneda)} {fmt(c.monto)}</span>
                    <button onClick={() => setCuentasAhorro(prev => prev.filter(x => x.id !== c.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '14px', padding: '0 0 0 6px', outline: 'none', flexShrink: 0 }}>×</button>
                  </div>
                ))}
                {showAddCuentaAhorro && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                    <input style={{ ...styles.savingsInput, fontSize: '12px', padding: '6px 8px' }} placeholder="Nombre de la cuenta" value={newCuentaAhorro.cuenta} onChange={e => setNewCuentaAhorro(p => ({ ...p, cuenta: e.target.value }))} />
                    <input style={{ ...styles.savingsInput, fontSize: '12px', padding: '6px 8px' }} type="number" placeholder="Monto" value={newCuentaAhorro.monto} onChange={e => setNewCuentaAhorro(p => ({ ...p, monto: e.target.value }))} />
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {['ARS','USD','EUR'].map(m => (
                        <button key={m} onClick={() => setNewCuentaAhorro(p => ({ ...p, moneda: m }))} style={{ flex: 1, padding: '5px 0', borderRadius: '6px', border: `1px solid ${newCuentaAhorro.moneda === m ? '#5C4F5C' : (darkMode ? '#3A333A' : '#E2DDE0')}`, backgroundColor: newCuentaAhorro.moneda === m ? '#5C4F5C' : 'transparent', color: newCuentaAhorro.moneda === m ? '#fff' : (darkMode ? '#9A8A9A' : '#6e6e73'), cursor: 'pointer', fontSize: '11px', fontFamily: '"Montserrat", sans-serif', fontWeight: newCuentaAhorro.moneda === m ? '600' : '400', outline: 'none' }}>
                          {m}
                        </button>
                      ))}
                    </div>
                    <button onClick={addAhorro} style={{ ...styles.savingsInput, backgroundColor: '#5C4F5C', color: 'white', border: 'none', cursor: 'pointer', fontWeight: '600', fontSize: '12px', textAlign: 'center', padding: '7px' }}>Agregar</button>
                  </div>
                )}
                {cuentasAhorro.length > 0 && (
                  <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total equiv.</span>
                      <span style={{ fontSize: '15px', fontWeight: '700', color: darkMode ? '#F0EDEC' : '#1d1d1f' }}>$ {fmt(totalAhorro)}</span>
                    </div>
                    {['ARS','USD','EUR'].map(mon => {
                      const sub = cuentasAhorro.filter(c => c.moneda === mon).reduce((s, c) => s + (parseFloat(c.monto) || 0), 0)
                      if (!sub) return null
                      return <div key={mon} style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                        <span style={{ fontSize: '11px', color: darkMode ? '#9A8A9A' : '#6e6e73' }}>{mon}</span>
                        <span style={{ fontSize: '12px', color: darkMode ? '#C0B0C0' : '#5C4F5C' }}>{sym(mon)} {fmt(sub)}</span>
                      </div>
                    })}
                  </div>
                )}
              </div>
            )
          })()}
          {(isTablet || (!isMobile && selectedAccount === 'all' && (dashboardTab === 'resumen' || dashboardTab === 'apagar' || dashboardTab === 'caja'))) && sideWidgets()}
          </div>{/* cierra wrapper columna izquierda */}

          {/* Contenido derecho */}
          <div style={styles.mainContent}>
            {selectedAccount === 'all' ? (
              <div style={{...styles.section, padding: isMobile ? '16px' : '24px'}}>
                {/* Tabs — patrón pill/segmented */}
                <div style={{ position: 'relative', marginBottom: '24px' }}>
                  <div
                    ref={tabsScrollRef}
                    className="tabs-scroll"
                    style={{
                      display: 'flex', gap: '3px', overflowX: 'auto',
                      background: darkMode ? '#2A272A' : '#EDE8EC',
                      borderRadius: '12px', padding: '3px'
                    }}
                  >
                    {[
                      { key: 'resumen', label: '📊 Movimientos del mes' },
                      { key: 'caja', label: '💵 Resúmenes mensuales' },
                      { key: 'apagar', label: '📌 A pagar' },
                      ...(childrenDB.length > 0 ? [{ key: 'hijos', label: '👧 Hijos' }] : [])
                    ].map(tab => (
                      <button key={tab.key}
                        data-tab={tab.key}
                        onClick={() => {
                          setDashboardTab(tab.key)
                          const el = tabsScrollRef.current?.querySelector(`[data-tab="${tab.key}"]`)
                          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
                        }}
                        style={{
                          padding: isMobile ? '7px 9px' : '9px 16px', border: 'none', cursor: 'pointer', borderRadius: '9px',
                          fontSize: isMobile ? '11.5px' : '14px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif',
                          color: dashboardTab === tab.key ? '#FFFFFF' : (darkMode ? '#C0B0C0' : '#5C5560'),
                          background: dashboardTab === tab.key ? '#5C4F5C' : 'transparent',
                          outline: 'none', whiteSpace: 'nowrap', flex: '0 0 auto',
                          transition: 'background-color 0.2s ease, color 0.2s ease'
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {/* Gradiente para indicar que hay más tabs a la derecha en mobile */}
                  {isMobile && (
                    <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: '28px', borderRadius: '0 12px 12px 0', background: `linear-gradient(to right, transparent, ${darkMode ? '#2A272A' : '#EDE8EC'})`, pointerEvents: 'none' }} />
                  )}
                </div>

                {dashboardTab === 'resumen' && (
                  <AccountDetail accounts={accounts} allAccounts refreshKey={refreshKey} searchQuery={searchQuery} onSearchChange={setSearchQuery} tipoCambio={tipoCambio} tipoCambioEUR={tipoCambioEUR} tcMap={tcMap} tcMapEUR={tcMapEUR} darkMode={darkMode} onPeriodChange={setSharedPeriod} onTransactionsLoaded={setAccountTransactions} customIcons={customIcons} onAccountsChanged={fetchAccounts} />
                )}

                {dashboardTab === 'caja' && (
                  <CashView accounts={accounts} refreshKey={refreshKey} darkMode={darkMode} tipoCambio={tipoCambioEfectivo} tcManual={tcManual} customIcons={customIcons} />
                )}

                {dashboardTab === 'apagar' && (
                  <AccountDetail accounts={accounts} allAccounts soloAPagar refreshKey={refreshKey} darkMode={darkMode} tipoCambio={tipoCambioEfectivo} tcManual={tcManual} onTransactionsLoaded={setAccountTransactions} customIcons={customIcons} onAccountsChanged={fetchAccounts} userEmail={userEmail} onNavigateToHijo={handleNavigateToHijo} />
                )}

                {dashboardTab === 'hijos' && childrenDB.length > 0 && (
                  <div>
                    {Object.keys(hijosResumenMes).length > 0 && (
                      <div style={{ fontSize: '13px', color: darkMode ? '#C0B0C0' : '#6e6e73', marginBottom: '14px', fontFamily: '"Montserrat", sans-serif' }}>
                        {childrenDB.map((c, i) => (
                          <span key={c.id}>
                            {i > 0 && ' · '}
                            {c.nombre}: {formatMontoFull(hijosResumenMes[c.nombre] || 0)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
                      {childrenDB.map(c => {
                        const activo = (selectedHijoNombre || childrenDB[0].nombre) === c.nombre
                        return (
                          <button key={c.id}
                            onClick={() => setSelectedHijoNombre(c.nombre)}
                            style={{
                              padding: '8px 16px', border: 'none', borderRadius: '20px', cursor: 'pointer',
                              fontSize: '13.5px', fontWeight: '500', fontFamily: '"Montserrat", sans-serif',
                              color: activo ? '#FFFFFF' : (darkMode ? '#C0B0C0' : '#5C5560'),
                              background: activo ? '#5C4F5C' : (darkMode ? '#2A272A' : '#EDE8EC'),
                              transition: 'background-color 0.2s ease, color 0.2s ease',
                              display: 'flex', alignItems: 'center', gap: '6px'
                            }}
                          >
                            <span>{customIcons[c.nombre] || '👧'}</span>
                            <span>{c.nombre}</span>
                          </button>
                        )
                      })}
                    </div>
                    <HijoDetail
                      hijoNombre={selectedHijoNombre || childrenDB[0].nombre}
                      hijoId={childrenDB.find(c => c.nombre === (selectedHijoNombre || childrenDB[0].nombre))?.id}
                      darkMode={darkMode}
                      tipoCambio={tipoCambio}
                      tcMap={tcMap}
                      tipoCambioEUR={tipoCambioEUR}
                      tcMapEUR={tcMapEUR}
                      refreshKey={refreshKey}
                      initialPeriod={sharedPeriod}
                      customIcons={customIcons}
                    />
                  </div>
                )}

                {dashboardTab === 'apagar' && (
                  <div style={{ marginTop: '32px' }}>
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
                            await persistServicios(user.id, updated)
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
                              {(s.dia || s.vencimiento) && <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#6e6e73' }}>📅 Vence el día {s.dia || s.vencimiento}</p>}
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
                                await persistServicios(user.id, updated)
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
                <AccountDetail account={selectedAccount} accounts={accounts} refreshKey={refreshKey} searchQuery={searchQuery} onSearchChange={setSearchQuery} tipoCambio={tipoCambio} tipoCambioEUR={tipoCambioEUR} tcMap={tcMap} tcMapEUR={tcMapEUR} darkMode={darkMode} onTransactionsLoaded={setAccountTransactions} onAddIngreso={selectedAccount?.tipo === 'ingreso' ? handleAddIngreso : undefined} customIcons={customIcons} onAccountsChanged={fetchAccounts} />
              </div>
            ) : (
              <div style={styles.emptyState}>
                <p style={styles.emptyStateIcon}>💳</p>
                <p style={styles.emptyStateText}>Seleccioná una cuenta para ver sus movimientos</p>
              </div>
            )}
          </div>

          {/* Widgets — desktop: tercera columna fija a la derecha (se oculta en Resumen/A pagar
              de Todas las cuentas para darle más ancho a la tabla) */}
          {!isMobile && !isTablet && !(selectedAccount === 'all' && (dashboardTab === 'resumen' || dashboardTab === 'apagar' || dashboardTab === 'caja')) && (
          <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '16px', position: 'sticky', top: '24px', alignSelf: 'flex-start' }}>
            {sideWidgets()}
          </div>
          )}

          {/* Widgets — mobile: full-width debajo del contenido principal */}
          {isMobile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 12px 24px' }}>
            {/* Mis Ahorros — solo mobile (en desktop/tablet está bajo el sidebar) */}
            {(() => {
              const tc = parseFloat(tipoCambio) || 0
              const mesActual = new Date().toISOString().slice(0,7)
              const tcELive = parseFloat(tipoCambioEUR) || 0
              const tcEDB = Number(exchangeRates.find(r => r.tipo === 'euro' && r.periodo === mesActual)?.valor || 0)
              const tcE = tcELive || tcEDB
              const fmtA = v => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Math.round(v))
              const symA = m => m === 'USD' ? 'U$S' : m === 'EUR' ? '€' : '$'
              const totalAhorro = cuentasAhorro.reduce((s, c) => { const m = parseFloat(c.monto)||0; return s + (c.moneda==='ARS'?m:c.moneda==='USD'?m*tc:c.moneda==='EUR'?m*tcE:0) }, 0)
              const addA = () => { const m=parseFloat(newCuentaAhorro.monto); if(!newCuentaAhorro.cuenta.trim()||!m||m<=0)return; setCuentasAhorro(p=>[...p,{id:Date.now(),...newCuentaAhorro,monto:m}]); setNewCuentaAhorro({cuenta:'',monto:'',moneda:newCuentaAhorro.moneda}); setShowAddCuentaAhorro(false) }
              return (
                <div style={{ ...styles.savingsPanel }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
                    <h3 style={{ ...styles.savingsPanelTitle, margin:0 }}>Mis ahorros</h3>
                    <button onClick={() => setShowAddCuentaAhorro(v => !v)} style={{ background:'none', border:`1px solid #5C4F5C`, borderRadius:'6px', color:'#5C4F5C', cursor:'pointer', fontSize:'16px', width:'26px', height:'26px', display:'flex', alignItems:'center', justifyContent:'center', outline:'none', lineHeight:1 }}>{showAddCuentaAhorro?'✕':'+'}</button>
                  </div>
                  {cuentasAhorro.length===0&&!showAddCuentaAhorro&&<p style={{fontSize:'12px',color:darkMode?'#6e6e73':'#aaa',textAlign:'center',margin:'4px 0 8px'}}>Sin cuentas cargadas</p>}
                  {cuentasAhorro.map(c=>(
                    <div key={c.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${darkMode?'#2A272A':'#F0EDF0'}`}}>
                      <span style={{fontSize:'12px',color:darkMode?'#e0e0e0':'#3a3a3c',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{c.cuenta}</span>
                      <span style={{fontSize:'12px',fontWeight:'600',color:darkMode?'#F0EDEC':'#1d1d1f',marginLeft:'8px',flexShrink:0}}>{symA(c.moneda)} {fmtA(c.monto)}</span>
                      <button onClick={()=>setCuentasAhorro(p=>p.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',cursor:'pointer',color:'#aaa',fontSize:'14px',padding:'0 0 0 6px',outline:'none',flexShrink:0}}>×</button>
                    </div>
                  ))}
                  {showAddCuentaAhorro&&(
                    <div style={{display:'flex',flexDirection:'column',gap:'6px',marginTop:'10px'}}>
                      <input style={{...styles.savingsInput,fontSize:'12px',padding:'6px 8px'}} placeholder="Nombre de la cuenta" value={newCuentaAhorro.cuenta} onChange={e=>setNewCuentaAhorro(p=>({...p,cuenta:e.target.value}))} />
                      <input style={{...styles.savingsInput,fontSize:'12px',padding:'6px 8px'}} type="number" placeholder="Monto" value={newCuentaAhorro.monto} onChange={e=>setNewCuentaAhorro(p=>({...p,monto:e.target.value}))} />
                      <div style={{display:'flex',gap:'4px'}}>
                        {['ARS','USD','EUR'].map(m=>(
                          <button key={m} onClick={()=>setNewCuentaAhorro(p=>({...p,moneda:m}))} style={{flex:1,padding:'5px 0',borderRadius:'6px',border:`1px solid ${newCuentaAhorro.moneda===m?'#5C4F5C':(darkMode?'#3A333A':'#E2DDE0')}`,backgroundColor:newCuentaAhorro.moneda===m?'#5C4F5C':'transparent',color:newCuentaAhorro.moneda===m?'#fff':(darkMode?'#9A8A9A':'#6e6e73'),cursor:'pointer',fontSize:'11px',fontFamily:'"Montserrat", sans-serif',fontWeight:newCuentaAhorro.moneda===m?'600':'400',outline:'none'}}>{m}</button>
                        ))}
                      </div>
                      <button onClick={addA} style={{...styles.savingsInput,backgroundColor:'#5C4F5C',color:'white',border:'none',cursor:'pointer',fontWeight:'600',fontSize:'12px',textAlign:'center',padding:'7px'}}>Agregar</button>
                    </div>
                  )}
                  {cuentasAhorro.length>0&&(
                    <div style={{marginTop:'12px',paddingTop:'10px',borderTop:`2px solid ${darkMode?'#3A333A':'#EDE8EC'}`}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'4px'}}>
                        <span style={{fontSize:'11px',color:darkMode?'#9A8A9A':'#6e6e73',textTransform:'uppercase',letterSpacing:'0.06em'}}>Total equiv.</span>
                        <span style={{fontSize:'15px',fontWeight:'700',color:darkMode?'#F0EDEC':'#1d1d1f'}}>$ {fmtA(totalAhorro)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
            {sideWidgets()}
          </div>
          )}

        </div>
      </div>


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
                <label htmlFor="uploadInput" style={{ display: 'block', marginTop: '10px', padding: '12px', backgroundColor: archivo ? 'transparent' : '#5C4F5C', color: archivo ? '#5C4F5C' : 'white', border: `2px solid #5C4F5C`, borderRadius: '12px', textAlign: 'center', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: '"Montserrat", sans-serif' }}>
                  {archivo ? `✅ ${archivo.name}` : '📁 Seleccionar archivo'}
                </label>
                <input id="uploadInput" type="file" accept=".pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg" style={{display:'none'}}
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
                  <div style={{...styles.timerFill, width: timer > 0 ? `${(timer / 180) * 100}%` : '100%', backgroundColor: timer === 0 ? '#b8a8c8' : timer < 30 ? '#e07b39' : '#5C4F5C', ...(timer === 0 ? { opacity: 0.7 } : {})}} />
                </div>
                <p style={styles.timerText}>
                  {timer > 0 ? `${timer}s restantes` : 'El extracto es largo y está tardando un poco más... seguimos procesando, no cierres la página'}
                </p>
              </div>
            )}

            {step === 'select_account_banco' && statementData && (
              <>
                <h3 style={styles.modalTitle}>¿A qué cuenta bancaria pertenece? 🏦</h3>
                <p style={{fontSize: '14px', color: '#666', marginBottom: '4px'}}>
                  Detectamos: <strong>{statementData.tarjeta_detectada}</strong>
                </p>
                <p style={{fontSize: '13px', color: '#aaa', marginBottom: '16px'}}>
                  Los egresos e inversiones se guardarán aquí. Los ingresos van automáticamente a tu cuenta de Ingresos.
                </p>
                {(() => {
                  const detectado = (statementData.tarjeta_detectada || '').trim().toLowerCase()
                  const disponibles = accounts.filter(a => a.tipo !== 'ingreso')
                  const match = detectado ? disponibles.find(a => a.nombre.trim().toLowerCase() === detectado) : null
                  const resto = disponibles.filter(a => a.id !== match?.id)
                  return (
                    <div style={{display:'flex', flexDirection:'column', gap:'10px', marginBottom:'8px'}}>
                      {match && (
                        <button style={{...styles.selectAccountBtn, border: '2px solid #27AE60'}}
                          onClick={() => handleSelectAccount(match)}>
                          🏦 {match.nombre}
                          <span style={{fontSize:'12px', color:'#27AE60', fontWeight:'600', marginLeft:'8px'}}>✓ Coincide con lo detectado</span>
                        </button>
                      )}
                      {!match && statementData.tarjeta_detectada && (
                        <button style={{...styles.selectAccountBtn, ...styles.selectAccountBtnNew}}
                          onClick={() => crearYSeleccionarCuenta(statementData.tarjeta_detectada, 'debito')}>
                          + Crear "{statementData.tarjeta_detectada}"
                        </button>
                      )}
                      {resto.map(acc => (
                        <button key={acc.id} style={styles.selectAccountBtn}
                          onClick={() => handleSelectAccount(acc)}>
                          🏦 {acc.nombre}
                          <span style={{fontSize:'12px', color:'#aaa', fontWeight:'400', marginLeft:'8px'}}>{tipoLabel(acc.tipo)}</span>
                        </button>
                      ))}
                      <button style={{...styles.selectAccountBtn, ...styles.selectAccountBtnNew}}
                        onClick={() => { setNewAccountForUpload({ nombre: '', tipo: 'debito' }); setStep('new_account') }}>
                        + Crear nueva cuenta bancaria
                      </button>
                    </div>
                  )
                })()}
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => { setShowUpload(false); resetUpload() }}>Cancelar</button>
                </div>
              </>
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
                {(() => {
                  const detectado = (statementData.tarjeta_detectada || '').trim().toLowerCase()
                  const match = detectado ? accounts.find(a => a.nombre.trim().toLowerCase() === detectado) : null
                  const resto = accounts.filter(a => a.id !== match?.id)
                  return (
                    <div style={{display:'flex', flexDirection:'column', gap:'10px', marginBottom:'8px'}}>
                      {match && (
                        <button style={{...styles.selectAccountBtn, border: '2px solid #27AE60'}}
                          onClick={() => handleSelectAccount(match)}>
                          💳 {match.nombre}
                          <span style={{fontSize:'12px', color:'#27AE60', fontWeight:'600', marginLeft:'8px'}}>✓ Coincide con lo detectado</span>
                        </button>
                      )}
                      {!match && statementData.tarjeta_detectada && (
                        <button style={{...styles.selectAccountBtn, ...styles.selectAccountBtnNew}}
                          onClick={() => crearYSeleccionarCuenta(statementData.tarjeta_detectada, 'credito')}>
                          + Crear "{statementData.tarjeta_detectada}"
                        </button>
                      )}
                      {resto.map(acc => (
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
                  )
                })()}
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
                    <button type="button" style={styles.cancelBtn} onClick={() => setStep(statementData?.tipo_documento === 'banco' ? 'select_account_banco' : 'select_account')}>← Volver</button>
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
                {(() => {
                  const esBancoPreview = statementData?.tipo_documento === 'banco'
                  const txSelec = statementData.transacciones.filter((_, i) => pdfTxSelections.has(i))
                  const totalARS = txSelec.filter(t => t.moneda === 'ARS').reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
                  const totalUSD = txSelec.filter(t => t.moneda === 'USD').reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
                  const totalEURprev = txSelec.filter(t => t.moneda === 'EUR').reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
                  return (
                    <div style={styles.previewStats}>
                      <div style={styles.previewStat}><span style={styles.previewStatLabel}>Período</span><span style={styles.previewStatValue}>{statementData.periodo}</span></div>
                      {esBancoPreview ? <>
                        {totalARS > 0 && <div style={styles.previewStat}><span style={styles.previewStatLabel}>Total ARS</span><span style={styles.previewStatValue}>$ {formatMonto(totalARS)}</span></div>}
                        {totalUSD > 0 && <div style={styles.previewStat}><span style={styles.previewStatLabel}>Total USD</span><span style={styles.previewStatValue}>U$S {formatMontoFull(totalUSD)}</span></div>}
                        {totalEURprev > 0 && <div style={styles.previewStat}><span style={styles.previewStatLabel}>Total EUR</span><span style={styles.previewStatValue}>€ {formatMontoFull(totalEURprev)}</span></div>}
                      </> : <>
                        <div style={styles.previewStat}><span style={styles.previewStatLabel}>Total ARS</span><span style={styles.previewStatValue}>$ {formatMonto(statementData.total_pesos)}</span></div>
                        {statementData.fecha_vencimiento && <div style={styles.previewStat}><span style={styles.previewStatLabel}>Vencimiento</span><span style={styles.previewStatValue}>{statementData.fecha_vencimiento}</span></div>}
                      </>}
                      <div style={styles.previewStat}><span style={styles.previewStatLabel}>Seleccionadas</span><span style={styles.previewStatValue}>{pdfTxSelections.size} / {statementData.transacciones.length}</span></div>
                    </div>
                  )
                })()}
                <div style={{ fontSize: '12px', color: '#8e8e93', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: '24px' }}>
                  <span>{pdfTxDuplicadas.size > 0 ? 'Las tachadas ya podrían estar cargadas. Marcalas si querés importarlas igual.' : ''}</span>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button onClick={() => setPdfTxSelections(new Set(statementData.transacciones.map((_, i) => i)))} style={{ background: darkMode ? '#3A2F4A' : '#f0ebfa', border: `1px solid ${darkMode ? '#5C4F8C' : '#c9b8f0'}`, borderRadius: '6px', color: '#7c5cbf', cursor: 'pointer', fontSize: '11px', fontFamily: '"Montserrat", sans-serif', padding: '3px 8px', fontWeight: '600' }}>Seleccionar todo</button>
                    <button onClick={() => setPdfTxSelections(new Set())} style={{ background: darkMode ? '#2A232A' : '#f5f5f5', border: `1px solid ${darkMode ? '#3A333A' : '#ddd'}`, borderRadius: '6px', color: darkMode ? '#9e9e9e' : '#6e6e73', cursor: 'pointer', fontSize: '11px', fontFamily: '"Montserrat", sans-serif', padding: '3px 8px', fontWeight: '600' }}>Ninguna</button>
                  </div>
                </div>
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
                        {(() => {
                          const esPos = statementData?.tipo_documento === 'banco' ? t.tipo === 'ingreso' : t.es_credito
                          return (
                            <p style={{ ...styles.transactionMonto, color: esPos ? '#3a7d44' : undefined }}>
                              {esPos ? '+' : '-'} {t.moneda === 'USD' ? 'U$S' : t.moneda === 'EUR' ? '€' : '$'} {formatMonto(Math.abs(t.monto))}
                            </p>
                          )
                        })()}
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
                      <option value="A Identificar" disabled>— Elegí una categoría —</option>
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
                  <div style={styles.modalButtons}>
                    <button style={styles.cancelBtn} onClick={handleSaltarClasificacion}>
                      Saltar →
                    </button>
                    <button style={styles.saveBtn}
                      onClick={() => handleGuardarClasificacion(txActual.id, txActual.detalle)}
                      disabled={!txEditTemp.nombre || txEditTemp.categoria === 'A Identificar'}>
                      Guardar y siguiente →
                    </button>
                  </div>
                  <button
                    onClick={() => handleMarcarNeutro(txActual.id)}
                    style={{ width: '100%', padding: '9px', borderRadius: '10px', border: '1px solid #C4B8C4', background: 'none', color: '#8e8e93', fontSize: '13px', fontFamily: '"Montserrat", sans-serif', cursor: 'pointer' }}>
                    ↩ Es neutro (pago, transferencia, etc.)
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
          <div style={{ ...styles.modal, maxWidth: excelPreview ? 'min(96vw, 980px)' : '600px' }}>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '-12px 0 16px 0' }}>
                      <p style={{ fontSize: '13px', color: '#6e6e73', margin: 0 }}>
                        Si el archivo tiene varias hojas, usamos la que se llame <strong>GASTOS</strong> (sin importar mayúsculas); si no, la primera.
                      </p>
                      <button onClick={downloadExcelTemplate} style={{ fontSize: '12px', color: '#5C4F5C', background: 'none', border: '1px solid #5C4F5C', borderRadius: '8px', padding: '5px 10px', cursor: 'pointer', fontFamily: '"Montserrat", sans-serif', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: '10px' }}>
                        ⬇ Plantilla
                      </button>
                    </div>
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
                        {['Fecha', 'Descripción', 'Tipo', 'Cuenta', 'Monto', 'Categoría', 'Subcategoría', ...(childrenDB.length > 0 ? ['Hijo'] : [])].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '7px 10px', borderBottom: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`, color: '#6e6e73', fontWeight: '400', textTransform: 'uppercase', fontSize: '11px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {excelPreview.slice(0, 10).map((row, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${darkMode ? '#3A333A' : '#f0f2f8'}` }}>
                          <td style={{ padding: '7px 10px', color: darkMode ? '#F0EDEC' : '#1d1d1f', whiteSpace: 'nowrap' }}>{row.fecha}</td>
                          <td style={{ padding: '7px 10px', color: darkMode ? '#F0EDEC' : '#1d1d1f', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.nombre || row.notas || '—'}</td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontSize: '11px' }}>
                            <span style={{ padding: '2px 7px', borderRadius: '8px', fontWeight: '500', backgroundColor: row.tipo === 'ingreso' ? '#e8f5e9' : row.tipo === 'neutro' ? '#f3f3f3' : (darkMode ? '#3A333A' : '#EDE8EC'), color: row.tipo === 'ingreso' ? '#2e7d32' : row.tipo === 'neutro' ? '#8e8e93' : '#5C4F5C' }}>
                              {row.tipo || 'gasto'}
                            </span>
                          </td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontSize: '11px' }}>
                            {row.tipo === 'ingreso'
                              ? <span style={{ color: '#2e7d32', fontWeight: '500' }}>Ingresos</span>
                              : <span style={{ color: '#6e6e73' }}>{row.modo_pago || 'Efectivo'}</span>
                            }
                          </td>
                          <td style={{ padding: '7px 10px', fontWeight: '600', whiteSpace: 'nowrap', color: darkMode ? '#F0EDEC' : '#2d2d2d' }}>
                            {row.moneda === 'USD' ? 'U$S' : '$'} {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(row.monto)}
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            <select
                              value={row.cat || ''}
                              onChange={e => updateExcelPreviewRow(i, { cat: e.target.value || null, subcat: null })}
                              style={{ padding: '4px 6px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '11px', backgroundColor: row.cat && row.cat !== 'A Identificar' ? 'transparent' : '#fff8e1', color: darkMode ? '#F0EDEC' : '#1d1d1f', maxWidth: '130px' }}>
                              <option value="">❓ Sin identificar</option>
                              {categoriasDB.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            <select
                              value={row.subcat || ''}
                              onChange={e => updateExcelPreviewRow(i, { subcat: e.target.value || null })}
                              style={{ padding: '4px 6px', borderRadius: '6px', border: `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`, fontSize: '11px', backgroundColor: 'transparent', color: darkMode ? '#F0EDEC' : '#1d1d1f', maxWidth: '130px' }}>
                              <option value="">— Sin subcategoría</option>
                              {subcategoriasDB.filter(s => s.category_id === categoriasDB.find(c => c.nombre === row.cat)?.id).map(s => <option key={s.id} value={s.nombre}>{s.nombre}</option>)}
                            </select>
                          </td>
                          {childrenDB.length > 0 && <td style={{ padding: '7px 10px', color: '#6e6e73', whiteSpace: 'nowrap' }}>{row.hijo || '—'}</td>}
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

      {showMovimiento && (
        <div style={styles.overlay}>
          <div style={{ ...styles.modal, maxWidth: '440px', width: '90%' }}>
            <h3 style={styles.modalTitle}>+ Cargar movimiento</h3>
            <div style={{ display: 'flex', gap: '8px', margin: '-4px 0 16px 0' }}>
              {[
                { v: 'gasto', label: '💸 Gasto' },
                { v: 'ingreso', label: '💰 Ingreso' },
                { v: 'neutro', label: '🔄 Neutro' },
              ].map(opt => (
                <button key={opt.v} type="button" onClick={() => { setTipoMovimiento(opt.v); setEfectivo(prev => ({ ...prev, categoria: '', subcategoria: '', cuenta: opt.v === 'ingreso' ? '' : (cuentaEfectivoId || '') })) }}
                  style={{
                    flex: 1, padding: '8px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
                    fontFamily: '"Montserrat", sans-serif',
                    fontWeight: tipoMovimiento === opt.v ? '600' : '400',
                    border: tipoMovimiento === opt.v ? '2px solid #5C4F5C' : `1px solid ${darkMode ? '#3A333A' : '#E2DDE0'}`,
                    background: tipoMovimiento === opt.v ? (darkMode ? '#3A2F4A' : '#EDE8F4') : 'transparent',
                    color: darkMode ? '#F0EDEC' : '#1d1d1f',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleGuardarMovimiento}>
              <p style={{fontSize:'12px', color:'#8e8e93', margin:'0 0 16px 0'}}>Los campos con <span style={{color:'#c0392b'}}>*</span> son obligatorios</p>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
                <div style={styles.field}>
                  <label style={styles.label}>Fecha <span style={{color:'#c0392b'}}>*</span></label>
                  <input style={{ ...styles.input, WebkitAppearance: 'none', appearance: 'none' }} type="date" value={efectivo.fecha}
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
                  placeholder={tipoMovimiento === 'neutro' ? 'Ej: Pago tarjeta desde cuenta corriente...' : tipoMovimiento === 'ingreso' ? 'Ej: Sueldo mayo, pago cliente X...' : 'Ej: Almuerzo, taxi, mercado...'} required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Monto <span style={{color:'#c0392b'}}>*</span></label>
                <input style={styles.input} type="number" step="0.01" value={efectivo.monto}
                  onChange={e => setEfectivo({...efectivo, monto: e.target.value})}
                  placeholder="0.00" required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>
                  Cuenta <span style={{color:'#c0392b'}}>*</span>
                  {tipoMovimiento === 'ingreso' && <span style={{fontSize:'11px', color:'#8e8e93', fontWeight:'400'}}> — ¿a qué cuenta entró?</span>}
                </label>
                <select style={styles.input}
                  value={efectivo.cuenta || (tipoMovimiento === 'ingreso' ? (accounts.find(a => a.tipo === 'ingreso')?.id || '') : (cuentaEfectivoId || ''))}
                  onChange={e => setEfectivo({...efectivo, cuenta: e.target.value})}>
                  {(tipoMovimiento === 'ingreso'
                    ? [...accounts.filter(a => a.tipo !== 'ingreso'), ...accounts.filter(a => a.tipo === 'ingreso')]
                    : accounts.filter(a => a.tipo !== 'ingreso')
                  ).map(a => (
                    <option key={a.id} value={a.id}>{a.nombre}</option>
                  ))}
                </select>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px'}}>
                <div style={styles.field}>
                  <label style={styles.label}>Categoría <span style={{fontSize:'11px', color:'#8e8e93'}}>(opcional)</span></label>
                  <select style={styles.input} value={efectivo.categoria}
                    onChange={e => setEfectivo({...efectivo, categoria: e.target.value, subcategoria: ''})}>
                    <option value="">— Elegir —</option>
                    {categoriasDB.filter(c => (c.tipo || 'gasto') === tipoMovimiento).map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Subcategoría <span style={{fontSize:'11px', color:'#8e8e93'}}>(opcional)</span></label>
                  <select style={styles.input} value={efectivo.subcategoria}
                    onChange={e => setEfectivo({...efectivo, subcategoria: e.target.value})}
                    disabled={!efectivo.categoria}>
                    <option value="">— Elegir —</option>
                    {(tipoMovimiento === 'ingreso'
                      ? subcategoriasDeIngreso(categoriasDB, subcategoriasDB)
                      : subcategoriasDB.filter(s => s.category_id === categoriasDB.find(c => c.nombre === efectivo.categoria && (c.tipo || 'gasto') === tipoMovimiento)?.id)
                    ).map(s => <option key={s.id} value={s.nombre}>{s.nombre}</option>)}
                  </select>
                </div>
              </div>
              {tipoMovimiento !== 'ingreso' && childrenDB.length > 0 && (
                <div style={styles.field}>
                  <label style={styles.label}>Hijo/a <span style={{fontSize:'11px', color:'#8e8e93'}}>(opcional)</span></label>
                  <select style={styles.input} value={efectivo.hijo}
                    onChange={e => setEfectivo({...efectivo, hijo: e.target.value})}>
                    <option value="">— Ninguno —</option>
                    {childrenDB.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                  </select>
                </div>
              )}
              {tipoMovimiento !== 'ingreso' && (
                <div style={styles.field}>
                  <label style={styles.label}>Nota <span style={{fontSize:'11px', color:'#8e8e93'}}>(opcional)</span></label>
                  <input style={styles.input} type="text" value={efectivo.nota}
                    onChange={e => setEfectivo({...efectivo, nota: e.target.value})}
                    placeholder="Detalles adicionales..." />
                </div>
              )}
              <div style={styles.modalButtons}>
                <button type="button" style={styles.cancelBtn} onClick={() => setShowMovimiento(false)}>Cancelar</button>
                <button type="submit" style={styles.saveBtn} disabled={loading}>
                  {loading ? 'Guardando...' : tipoMovimiento === 'ingreso' ? 'Guardar ingreso' : tipoMovimiento === 'neutro' ? 'Guardar movimiento' : 'Guardar gasto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '12px 16px 12px 24px', borderRadius: '12px',
          backgroundColor: toast.type === 'error' ? '#c0392b' : toast.type === 'warning' ? '#c07a2b' : '#2e8b6a',
          color: 'white', fontSize: '14px', fontWeight: '500',
          fontFamily: '"Montserrat", sans-serif',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          maxWidth: '90vw', textAlign: 'center',
          display: 'flex', alignItems: 'center', gap: '10px',
          animation: 'fadeInUp 0.2s ease'
        }}>
          <span>{toast.type === 'error' ? '⚠️ ' : toast.type === 'warning' ? '⚠️ ' : '✅ '}{toast.msg}</span>
          <button
            onClick={() => { clearTimeout(toastTimeoutRef.current); setToast(null) }}
            style={{ background: 'none', border: 'none', color: 'white', opacity: 0.8, cursor: 'pointer', fontSize: '15px', padding: '2px 4px', flexShrink: 0, outline: 'none' }}
          >✕</button>
        </div>
      )}

      <ConfigPanel
        ref={configPanelRef}
        darkMode={darkMode}
        isMobile={isMobile}
        categoriasDB={categoriasDB}
        subcategoriasDB={subcategoriasDB}
        childrenDB={childrenDB}
        customIcons={customIcons}
        userAliases={userAliases}
        fetchCategorias={fetchCategorias}
        fetchChildren={fetchChildren}
        fetchUserAliases={fetchUserAliases}
        saveCustomIcon={saveCustomIcon}
        showToast={showToast}
        onRefresh={() => setRefreshKey(k => k + 1)}
        tcManual={tcManual}
        onSaveTC={guardarTipoCambioManual}
      />
    </>
  )
}

const getStyles = (dark, mobile = false) => {
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
      width: '100%', padding: '9px 10px', backgroundColor: 'transparent', color: p,
      border: `1px solid ${p}`, borderRadius: '10px', cursor: 'pointer',
      fontSize: '12px', fontWeight: '400', letterSpacing: '0.08em', textTransform: 'uppercase',
      textAlign: 'center', outline: 'none', fontFamily: '"Montserrat", sans-serif'
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
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: mobile ? '12px' : '20px', boxSizing: 'border-box' },
    modal: { backgroundColor: panel, borderRadius: mobile ? '14px' : '16px', padding: mobile ? '20px 16px' : '32px', width: '100%', maxWidth: '520px', boxShadow: '0 8px 32px rgba(0,0,0,0.20)', maxHeight: mobile ? '95vh' : '90vh', overflowY: 'auto' },
    modalTitle: { fontSize: mobile ? '17px' : '20px', fontWeight: '500', color: txt, margin: mobile ? '0 0 16px 0' : '0 0 24px 0' },
    field: { marginBottom: '16px' },
    label: { display: 'block', fontSize: '14px', fontWeight: '400', color: dark ? '#C0B0C0' : '#444', marginBottom: '6px' },
    input: { width: '100%', padding: '11px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: mobile ? '16px' : '14px', outline: 'none', boxSizing: 'border-box', backgroundColor: inputBg, color: txt, colorScheme: dark ? 'dark' : 'light' },
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
    transactionsList: { maxHeight: '300px', overflowY: 'auto', marginBottom: '16px', paddingRight: '6px', scrollbarWidth: 'thin' },
    transactionItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px', borderBottom: `1px solid ${border}` },
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