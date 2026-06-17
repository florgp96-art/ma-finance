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

  const [msgIndex, setMsgIndex] = useState(0)
  const msgInterval = useRef(null)

  useEffect(() => { fetchAccounts() }, [])

  useEffect(() => {
    if (step === 'processing') {
      setMsgIndex(0)
      msgInterval.current = setInterval(() => {
        setMsgIndex(i => (i + 1) % PROCESSING_MSGS.length)
      }, 3000)
    } else {
      clearInterval(msgInterval.current)
    }
    return () => clearInterval(msgInterval.current)
  }, [step])

  const fetchAccounts = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('accounts').select('*').eq('user_id', user.id)
    setAccounts(data || [])
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
  }

  const handleUploadPDF = async () => {
    if (!archivo) return
    setStep('processing')
    setLoading(true)
    try {
      const pdfText = await extractTextFromPDF(archivo)
      const result = await analyzeStatementWithClaude(pdfText, 'auto')
      setStatementData(result)
      setNewAccountForUpload({ nombre: result.tarjeta_detectada || '', tipo: 'credito' })
      setStep('select_account')
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

  const handleConfirmTransactions = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const account = targetAccount

    const { data: categorias } = await supabase.from('categories').select('id, nombre')
    const getCategoryId = (cat) => {
      if (!categorias || !cat) return null
      return categorias.find(c => c.nombre.toLowerCase() === cat.toLowerCase())?.id || null
    }

    const { data: existing } = await supabase.from('statements')
      .select('id').eq('account_id', account.id).eq('periodo', statementData.periodo).single()
    if (existing) {
      alert(`Ya cargaste el extracto de ${statementData.periodo} para esta tarjeta.`)
      setLoading(false)
      return
    }

    const { data: statement } = await supabase.from('statements').insert({
      user_id: user.id, account_id: account.id, nombre_archivo: archivo.name,
      periodo: statementData.periodo, fecha_desde: null,
      fecha_hasta: statementData.fecha_facturacion, total_resumen: statementData.total_pesos, estado: 'completo'
    }).select().single()

    const { data: subcategorias } = await supabase.from('subcategories').select('id, nombre, category_id')
    const getSubcategoryId = (sub, catId) => {
      if (!subcategorias || !sub || !catId) return null
      return subcategorias.find(s => s.nombre.toLowerCase() === sub.toLowerCase() && s.category_id === catId)?.id || null
    }

    const transacciones = statementData.transacciones.map(t => {
      const categoryId = getCategoryId(t.categoria_sugerida)
      return {
        user_id: user.id, account_id: account.id, statement_id: statement.id,
        fecha: t.fecha,
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

    await supabase.from('transactions').insert(transacciones)
    resetUpload()
    setShowUpload(false)
    fetchAccounts()
    setRefreshKey(k => k + 1)
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

  return (
    <>
      <div style={styles.container}>

        {/* Header: mismo fondo que la página, logo grande centrado */}
        <div style={styles.header}>
          <img src={logo} alt="Moms Assist Finance" style={styles.logoImg} />
        </div>

        {/* Layout dos columnas */}
        <div style={styles.layout}>

          {/* Sidebar izquierdo */}
          <div style={styles.sidebar}>
            <div style={styles.sidebarHeader}>
              <h2 style={styles.sidebarTitle}>CUENTAS</h2>
            </div>

            <button style={styles.sidebarBtnPrimary} onClick={() => { resetUpload(); setShowUpload(true) }}>
              + CARGAR PDF
            </button>
            <button style={styles.sidebarBtnPrimary} onClick={() => alert('Próximamente')}>
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
                <AccountDetail accounts={accounts} allAccounts refreshKey={refreshKey} />
              </div>
            ) : selectedAccount ? (
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>📊 {selectedAccount.nombre}</h2>
                <AccountDetail account={selectedAccount} refreshKey={refreshKey} />
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
                <h3 style={styles.modalTitle}>Revisá las transacciones ✅</h3>
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
                    ❓ Hay {statementData.transacciones.filter(t => t.categoria_sugerida === 'A Identificar').length} {statementData.transacciones.filter(t => t.categoria_sugerida === 'A Identificar').length === 1 ? 'transacción' : 'transacciones'} sin identificar. Podrás nombrarlas después.
                  </div>
                )}
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => setStep('select_account')}>← Atrás</button>
                  <button style={styles.saveBtn} onClick={handleConfirmTransactions} disabled={loading}>{loading ? 'Guardando...' : 'Confirmar y guardar'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#E4E7F3', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },

  // Header sin color — se funde con el fondo
  header: {
    backgroundColor: '#E4E7F3',
    padding: '24px 32px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImg: { height: '220px', objectFit: 'contain' },

  // Layout dos columnas
  layout: {
    display: 'flex',
    alignItems: 'flex-start',
    maxWidth: '1280px',
    margin: '0 auto',
    padding: '0 24px 48px 24px',
    gap: '24px',
  },

  // Sidebar izquierdo
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
    border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', textAlign: 'center'
  },
  sidebarBtnSecondary: {
    width: '100%', padding: '10px', backgroundColor: 'white', color: '#6B7BB8',
    border: '2px solid #6B7BB8', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', textAlign: 'center'
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
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px', opacity: 0.7 },
  sidebarFooter: { marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid #eef0f8' },
  logoutBtn: {
    width: '100%', padding: '9px', backgroundColor: 'transparent', color: '#6B7BB8',
    border: '1.5px solid #6B7BB8', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600'
  },

  // Contenido principal derecho
  mainContent: { flex: 1, minWidth: 0 },
  section: { backgroundColor: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(107,123,184,0.10)' },
  sectionTitle: { fontSize: '18px', fontWeight: '700', color: '#1d1d1f', margin: '0 0 24px 0' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', color: '#6e6e73' },
  emptyStateIcon: { fontSize: '48px', margin: '0 0 12px 0' },
  emptyStateText: { fontSize: '15px', color: '#6e6e73', fontWeight: '500' },

  // Modales
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
  cancelBtn: { flex: 1, padding: '12px', backgroundColor: 'white', color: '#6B7BB8', border: '2px solid #6B7BB8', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' },
  saveBtn: { flex: 1, padding: '12px', backgroundColor: '#6B7BB8', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' },
  selectAccountBtn: { width: '100%', padding: '14px 16px', backgroundColor: 'white', color: '#2d2d2d', border: '2px solid #d0d5ee', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: '600', textAlign: 'left' },
  selectAccountBtnNew: { borderStyle: 'dashed', color: '#6B7BB8', fontWeight: '500', fontSize: '14px' },
  processingContainer: { textAlign: 'center', padding: '20px 0' },
  processingIcon: { fontSize: '52px', margin: '0 0 16px 0', display: 'block' },
  processingTitle: { fontSize: '20px', fontWeight: 'bold', color: '#2d2d2d', margin: '0 0 8px 0' },
  processingText: { fontSize: '14px', color: '#888', margin: '0 0 24px 0' },
  processingDots: { display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '24px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#d0d5ee' },
  dotActive: { backgroundColor: '#6B7BB8' },
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
  warningBox: { backgroundColor: '#fff8e1', border: '1px solid #ffe082', borderRadius: '10px', padding: '12px', fontSize: '13px', color: '#856404', marginBottom: '16px' }
}