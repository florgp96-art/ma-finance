import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { extractTextFromPDF, analyzeStatementWithClaude } from '../lib/pdfReader'
import AccountDetail from '../components/AccountDetail'

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

  // Modal agregar tarjeta
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ nombre: '', tipo: 'credito' })

  // Modal editar tarjeta
  const [editAccount, setEditAccount] = useState(null)

  // Modal eliminar tarjeta
  const [confirmDelete, setConfirmDelete] = useState(null)

  // Carga de extracto
  const [archivo, setArchivo] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadDragOver, setUploadDragOver] = useState(false)
  const [step, setStep] = useState('upload')
  const [statementData, setStatementData] = useState(null)
  const [matchedAccount, setMatchedAccount] = useState(null)
  const [suggestedName, setSuggestedName] = useState('')
  const [newAccountForUpload, setNewAccountForUpload] = useState({ nombre: '', tipo: 'credito' })
  const [separarAdicionales, setSepararAdicionales] = useState(null)
  const [targetAccount, setTargetAccount] = useState(null)

  // Mensajes rotativos
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
    await supabase.from('accounts').insert({
      user_id: user.id,
      nombre: newAccount.nombre,
      tipo: newAccount.tipo,
    })
    setNewAccount({ nombre: '', tipo: 'credito' })
    setShowAddAccount(false)
    fetchAccounts()
    setLoading(false)
  }

  const handleEditAccount = async (e) => {
    e.preventDefault()
    setLoading(true)
    await supabase.from('accounts').update({
      nombre: editAccount.nombre,
      tipo: editAccount.tipo,
    }).eq('id', editAccount.id)
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
    setMatchedAccount(null)
    setSuggestedName('')
    setTargetAccount(null)
    setSepararAdicionales(null)
    setNewAccountForUpload({ nombre: '', tipo: 'credito' })
    setMsgIndex(0)
  }

  const findMatchingAccount = (statementResult) => {
    const cardNombre = statementResult.tarjeta_detectada || ''
    if (!cardNombre || accounts.length === 0) return null
    const cardLower = cardNombre.toLowerCase()
    return accounts.find(acc => {
      const accLower = acc.nombre.toLowerCase()
      return cardLower.includes(accLower) || accLower.includes(cardLower) ||
        accLower.split(' ').some(word => word.length > 3 && cardLower.includes(word))
    }) || null
  }

  const handleUploadPDF = async () => {
    if (!archivo) return
    setStep('processing')
    setLoading(true)
    try {
      const pdfText = await extractTextFromPDF(archivo)
      const result = await analyzeStatementWithClaude(pdfText, 'auto')
      setStatementData(result)
      const match = findMatchingAccount(result)
      if (match) {
        setMatchedAccount(match)
        setTargetAccount(match)
        setStep('match')
      } else {
        setSuggestedName(result.tarjeta_detectada || '')
        setNewAccountForUpload({ nombre: result.tarjeta_detectada || '', tipo: 'credito' })
        setStep('new_account')
      }
    } catch (err) {
      alert('Error procesando el PDF: ' + err.message)
      setStep('upload')
    }
    setLoading(false)
  }

  const handleConfirmMatch = () => {
    if (statementData.adicionales && statementData.adicionales.length > 0) {
      setStep('adicionales')
    } else {
      setStep('preview')
    }
  }

  const handleCreateNewForUpload = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: account } = await supabase.from('accounts').insert({
      user_id: user.id,
      nombre: newAccountForUpload.nombre,
      tipo: newAccountForUpload.tipo,
    }).select().single()
    setTargetAccount(account)
    fetchAccounts()
    setLoading(false)
    if (statementData.adicionales && statementData.adicionales.length > 0) {
      setStep('adicionales')
    } else {
      setStep('preview')
    }
  }

  const handleConfirmAdicionales = (separar) => {
    setSepararAdicionales(separar)
    setStep('preview')
  }

  const handleConfirmTransactions = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    const account = targetAccount

    // Traer categorías para hacer el match por nombre
    const { data: categorias } = await supabase.from('categories').select('id, nombre')
    const getCategoryId = (categoriaSugerida) => {
      if (!categorias || !categoriaSugerida) return null
      const match = categorias.find(c => c.nombre.toLowerCase() === categoriaSugerida.toLowerCase())
      return match ? match.id : null
    }

    const { data: statement } = await supabase.from('statements').insert({
      user_id: user.id,
      account_id: account.id,
      nombre_archivo: archivo.name,
      periodo: statementData.periodo,
      fecha_desde: null,
      fecha_hasta: statementData.fecha_facturacion,
      total_resumen: statementData.total_pesos,
      estado: 'completo'
    }).select().single()

    const transacciones = statementData.transacciones.map(t => ({
      user_id: user.id,
      account_id: account.id,
      statement_id: statement.id,
      fecha: t.fecha,
      nombre: t.nombre_limpio !== t.nombre_original ? t.nombre_limpio : null,
      detalle: t.nombre_original,
      monto: t.monto,
      moneda: t.moneda,
      cuotas_total: t.cuotas_total,
      cuota_numero: t.cuota_numero,
      tipo: t.es_credito ? 'ingreso' : 'gasto',
      category_id: getCategoryId(t.categoria_sugerida),
      estado: (!t.nombre_limpio || t.nombre_limpio === t.nombre_original) ? 'a_identificar' : 'identificado',
      es_manual: false
    }))

    await supabase.from('transactions').insert(transacciones)
    resetUpload()
    setShowUpload(false)
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

  const tipoLabel = (tipo) => {
    if (tipo === 'credito') return 'Crédito'
    if (tipo === 'debito') return 'Débito'
    return 'Efectivo'
  }

  const formatMonto = (monto) => {
    return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)
  }

  const currentMsg = PROCESSING_MSGS[msgIndex]

  return (
    <>
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.logo}>Moms Assist Finance</h1>
          <button style={styles.logoutBtn} onClick={handleLogout}>Cerrar sesión</button>
        </div>

        <div style={styles.content}>
          <div style={styles.summaryCards}>
            <div style={styles.summaryCard}>
              <p style={styles.cardLabel}>Total del Mes</p>
              <p style={styles.cardValue}>$ —</p>
            </div>
            <div style={styles.summaryCard}>
              <p style={styles.cardLabel}>Gastos</p>
              <p style={styles.cardValue}>$ —</p>
            </div>
            <div style={styles.summaryCard}>
              <p style={styles.cardLabel}>Ingresos</p>
              <p style={styles.cardValue}>$ —</p>
            </div>
          </div>

          <div style={styles.uploadBanner}>
            <div>
              <p style={styles.uploadBannerTitle}>📄 Cargar extracto</p>
              <p style={styles.uploadBannerDesc}>Subí el PDF de tu resumen y la IA lo clasifica automáticamente</p>
            </div>
            <button style={styles.uploadBannerBtn} onClick={() => { resetUpload(); setShowUpload(true) }}>
              Cargar PDF
            </button>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Tarjetas y Cuentas</h2>
              <button style={styles.addBtn} onClick={() => setShowAddAccount(true)}>+ Agregar</button>
            </div>

            {accounts.length === 0 ? (
              <div style={styles.empty}>
                <p>Todavía no agregaste ninguna tarjeta.</p>
                <button style={styles.addBtnLarge} onClick={() => setShowAddAccount(true)}>
                  + Agregar mi primera tarjeta
                </button>
              </div>
            ) : (
              <div style={styles.accountsGrid}>
                {accounts.map(acc => (
                  <div key={acc.id}
                    style={{...styles.accountCard, ...(selectedAccount?.id === acc.id ? styles.accountCardSelected : {})}}
                    onClick={() => setSelectedAccount(selectedAccount?.id === acc.id ? null : acc)}
                  >
                    <div style={styles.accountCardHeader}>
                      <p style={styles.accountType}>💳 {tipoLabel(acc.tipo)}</p>
                      <div style={styles.accountActions}>
                        <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); setEditAccount({...acc}) }} title="Editar">✏️</button>
                        <button style={styles.actionBtn} onClick={(e) => { e.stopPropagation(); setConfirmDelete(acc.id) }} title="Eliminar">🗑️</button>
                      </div>
                    </div>
                    <p style={styles.accountName}>{acc.nombre}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* DETALLE DE TARJETA */}
          {selectedAccount && (
            <div style={styles.section}>
              <h2 style={{...styles.sectionTitle, marginBottom: '24px'}}>
                📊 {selectedAccount.nombre}
              </h2>
              <AccountDetail account={selectedAccount} />
            </div>
          )}

        </div>
      </div>

      {/* MODAL AGREGAR TARJETA */}
      {showAddAccount && (
        <div style={styles.overlay}>
          <div style={{...styles.modal, maxWidth: '400px'}}>
            <h3 style={styles.modalTitle}>Agregar tarjeta</h3>
            <form onSubmit={handleAddAccount}>
              <div style={styles.field}>
                <label style={styles.label}>Nombre</label>
                <input style={styles.input} value={newAccount.nombre}
                  onChange={(e) => setNewAccount({...newAccount, nombre: e.target.value})}
                  placeholder="Ej: Amex, Visa Galicia, Mastercard" required />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Tipo</label>
                <select style={styles.input} value={newAccount.tipo}
                  onChange={(e) => setNewAccount({...newAccount, tipo: e.target.value})}>
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

      {/* MODAL EDITAR TARJETA */}
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
                <select style={styles.input} value={editAccount.tipo}
                  onChange={(e) => setEditAccount({...editAccount, tipo: e.target.value})}>
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

      {/* MODAL CONFIRMAR ELIMINACIÓN */}
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

      {/* MODAL CARGA DE EXTRACTO */}
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
                    <>
                      <p style={styles.dropzoneIcon}>✅</p>
                      <p style={styles.dropzoneText}>{archivo.name}</p>
                      <p style={styles.dropzoneHint}>Clickeá para cambiar</p>
                    </>
                  ) : (
                    <>
                      <p style={styles.dropzoneIcon}>📄</p>
                      <p style={styles.dropzoneText}>Arrastrá el PDF acá o clickeá para seleccionar</p>
                      <p style={styles.dropzoneHint}>Solo archivos PDF · Máx. 10MB</p>
                    </>
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

            {step === 'match' && matchedAccount && (
              <>
                <h3 style={styles.modalTitle}>Tarjeta detectada ✅</h3>
                <p style={{fontSize: '14px', color: '#666', marginBottom: '20px'}}>
                  Encontramos que este extracto pertenece a:
                </p>
                <div style={styles.matchCard}>
                  <p style={styles.matchCardType}>💳 {tipoLabel(matchedAccount.tipo)}</p>
                  <p style={styles.matchCardName}>{matchedAccount.nombre}</p>
                </div>
                <p style={{fontSize: '13px', color: '#aaa', marginBottom: '20px', textAlign: 'center'}}>¿Es correcto?</p>
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => { setStep('new_account'); setNewAccountForUpload({ nombre: suggestedName, tipo: 'credito' }) }}>
                    No, es otra
                  </button>
                  <button style={styles.saveBtn} onClick={handleConfirmMatch}>Sí, continuar</button>
                </div>
              </>
            )}

            {step === 'new_account' && (
              <>
                <h3 style={styles.modalTitle}>¿Crear nueva tarjeta?</h3>
                <p style={{fontSize: '14px', color: '#666', marginBottom: '20px'}}>
                  No encontramos esta tarjeta en tu lista. ¿Querés crearla?
                </p>
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
                    <button type="button" style={styles.cancelBtn} onClick={() => { setShowUpload(false); resetUpload() }}>Cancelar</button>
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
                  {statementData.adicionales.map((a, i) => (
                    <div key={i} style={styles.adicionalItem}>👤 {a}</div>
                  ))}
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
                  <div style={styles.previewStat}>
                    <span style={styles.previewStatLabel}>Período</span>
                    <span style={styles.previewStatValue}>{statementData.periodo}</span>
                  </div>
                  <div style={styles.previewStat}>
                    <span style={styles.previewStatLabel}>Total ARS</span>
                    <span style={styles.previewStatValue}>$ {formatMonto(statementData.total_pesos)}</span>
                  </div>
                  <div style={styles.previewStat}>
                    <span style={styles.previewStatLabel}>Vencimiento</span>
                    <span style={styles.previewStatValue}>{statementData.fecha_vencimiento}</span>
                  </div>
                  <div style={styles.previewStat}>
                    <span style={styles.previewStatLabel}>Transacciones</span>
                    <span style={styles.previewStatValue}>{statementData.transacciones.length}</span>
                  </div>
                </div>
                <div style={styles.transactionsList}>
                  {statementData.transacciones.slice(0, 10).map((t, i) => (
                    <div key={i} style={styles.transactionItem}>
                      <div style={styles.transactionLeft}>
                        <p style={styles.transactionName}>
                          {t.nombre_limpio || t.nombre_original}
                          {t.nombre_limpio === t.nombre_original && <span> ❓</span>}
                        </p>
                        <p style={styles.transactionDetail}>
                          {t.fecha} · {t.categoria_sugerida}
                          {t.cuotas_total > 1 && ` · Cuota ${t.cuota_numero}/${t.cuotas_total}`}
                          {separarAdicionales && t.titular && ` · ${t.titular}`}
                        </p>
                      </div>
                      <p style={{...styles.transactionMonto, color: t.es_credito ? '#27AE60' : '#2d2d2d'}}>
                        {t.es_credito ? '+' : '-'} {t.moneda === 'USD' ? 'U$S' : '$'} {formatMonto(t.monto)}
                      </p>
                    </div>
                  ))}
                  {statementData.transacciones.length > 10 && (
                    <p style={styles.moreTransactions}>+ {statementData.transacciones.length - 10} transacciones más</p>
                  )}
                </div>
                {statementData.transacciones.some(t => t.nombre_limpio === t.nombre_original) && (
                  <div style={styles.warningBox}>
                    ❓ Hay {statementData.transacciones.filter(t => t.nombre_limpio === t.nombre_original).length} transacciones sin identificar. Podrás nombrarlas después.
                  </div>
                )}
                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => setStep('upload')}>← Atrás</button>
                  <button style={styles.saveBtn} onClick={handleConfirmTransactions} disabled={loading}>
                    {loading ? 'Guardando...' : 'Confirmar y guardar'}
                  </button>
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
  container: { minHeight: '100vh', backgroundColor: '#f8f6f3', fontFamily: 'Arial, sans-serif' },
  header: {
    backgroundColor: 'white', padding: '16px 32px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
  },
  logo: { fontSize: '20px', fontWeight: 'bold', color: '#9B59B6', margin: 0 },
  logoutBtn: {
    padding: '8px 16px', backgroundColor: 'white', color: '#9B59B6',
    border: '2px solid #9B59B6', borderRadius: '8px', cursor: 'pointer', fontSize: '14px'
  },
  content: { maxWidth: '960px', margin: '32px auto', padding: '0 24px' },
  summaryCards: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' },
  summaryCard: { backgroundColor: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardLabel: { fontSize: '13px', color: '#888', margin: '0 0 8px 0' },
  cardValue: { fontSize: '28px', fontWeight: 'bold', color: '#2d2d2d', margin: 0 },
  uploadBanner: {
    backgroundColor: 'white', borderRadius: '16px', padding: '20px 24px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: '24px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    border: '2px dashed #ede8f5'
  },
  uploadBannerTitle: { fontSize: '15px', fontWeight: '600', color: '#2d2d2d', margin: '0 0 4px 0' },
  uploadBannerDesc: { fontSize: '13px', color: '#888', margin: 0 },
  uploadBannerBtn: {
    padding: '10px 20px', backgroundColor: '#9B59B6', color: 'white',
    border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600',
    whiteSpace: 'nowrap', marginLeft: '16px'
  },
  section: { backgroundColor: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: '24px' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  sectionTitle: { fontSize: '18px', fontWeight: 'bold', color: '#2d2d2d', margin: 0 },
  addBtn: {
    padding: '8px 16px', backgroundColor: '#9B59B6', color: 'white',
    border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600'
  },
  empty: { textAlign: 'center', padding: '40px', color: '#888' },
  addBtnLarge: {
    marginTop: '16px', padding: '12px 24px', backgroundColor: '#9B59B6', color: 'white',
    border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '15px', fontWeight: '600'
  },
  accountsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' },
  accountCard: {
    backgroundColor: '#f8f6f3', borderRadius: '12px', padding: '20px',
    border: '1px solid #ede8f5', cursor: 'pointer', transition: 'all 0.2s'
  },
  accountCardSelected: {
    border: '2px solid #9B59B6', backgroundColor: '#f5eefb'
  },
  accountCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  accountType: { fontSize: '12px', color: '#9B59B6', margin: 0, fontWeight: '600' },
  accountName: { fontSize: '18px', fontWeight: 'bold', color: '#2d2d2d', margin: 0 },
  accountActions: { display: 'flex', gap: '4px' },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '2px', opacity: 0.8 },
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000
  },
  modal: {
    backgroundColor: 'white', borderRadius: '16px', padding: '32px',
    width: '100%', maxWidth: '520px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
    maxHeight: '90vh', overflowY: 'auto'
  },
  modalTitle: { fontSize: '20px', fontWeight: 'bold', color: '#2d2d2d', margin: '0 0 24px 0' },
  field: { marginBottom: '16px' },
  label: { display: 'block', fontSize: '14px', fontWeight: '500', color: '#444', marginBottom: '6px' },
  input: {
    width: '100%', padding: '11px', borderRadius: '10px',
    border: '1px solid #e0e0e0', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
  },
  dropzone: {
    border: '2px dashed #e0e0e0', borderRadius: '12px', padding: '40px',
    textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', backgroundColor: '#fafafa',
    marginBottom: '16px'
  },
  dropzoneActive: { borderColor: '#9B59B6', backgroundColor: '#f5eefb' },
  dropzoneDone: { borderColor: '#27AE60', backgroundColor: '#f0faf5' },
  dropzoneIcon: { fontSize: '32px', margin: '0 0 8px 0' },
  dropzoneText: { fontSize: '14px', color: '#444', margin: '0 0 4px 0', fontWeight: '500' },
  dropzoneHint: { fontSize: '12px', color: '#aaa', margin: 0 },
  modalButtons: { display: 'flex', gap: '12px', marginTop: '24px' },
  cancelBtn: {
    flex: 1, padding: '12px', backgroundColor: 'white', color: '#9B59B6',
    border: '2px solid #9B59B6', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600'
  },
  saveBtn: {
    flex: 1, padding: '12px', backgroundColor: '#9B59B6', color: 'white',
    border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600'
  },
  processingContainer: { textAlign: 'center', padding: '20px 0' },
  processingIcon: { fontSize: '52px', margin: '0 0 16px 0', display: 'block' },
  processingTitle: { fontSize: '20px', fontWeight: 'bold', color: '#2d2d2d', margin: '0 0 8px 0' },
  processingText: { fontSize: '14px', color: '#888', margin: '0 0 24px 0' },
  processingDots: { display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '24px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#e0d0f0' },
  dotActive: { backgroundColor: '#9B59B6' },
  matchCard: {
    backgroundColor: '#f5eefb', borderRadius: '12px', padding: '20px',
    textAlign: 'center', marginBottom: '16px', border: '2px solid #ede8f5'
  },
  matchCardType: { fontSize: '12px', color: '#9B59B6', margin: '0 0 6px 0', fontWeight: '600' },
  matchCardName: { fontSize: '22px', fontWeight: 'bold', color: '#2d2d2d', margin: 0 },
  stepSubtitle: { fontSize: '14px', color: '#666', marginBottom: '16px' },
  adicionalesList: { marginBottom: '20px' },
  adicionalItem: {
    padding: '10px 14px', backgroundColor: '#f5eefb', borderRadius: '8px',
    marginBottom: '8px', fontSize: '14px', color: '#6C3483', fontWeight: '500'
  },
  stepQuestion: { fontSize: '15px', fontWeight: '600', color: '#2d2d2d', marginBottom: '16px' },
  opcionesGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  opcionBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '20px', border: '2px solid #e0e0e0', borderRadius: '12px',
    backgroundColor: 'white', cursor: 'pointer', gap: '4px'
  },
  opcionIcon: { fontSize: '28px' },
  opcionTitle: { fontSize: '14px', fontWeight: '600', color: '#2d2d2d' },
  opcionDesc: { fontSize: '12px', color: '#888' },
  previewStats: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' },
  previewStat: {
    backgroundColor: '#f8f6f3', borderRadius: '10px', padding: '12px',
    display: 'flex', flexDirection: 'column', gap: '4px'
  },
  previewStatLabel: { fontSize: '11px', color: '#888', textTransform: 'uppercase' },
  previewStatValue: { fontSize: '15px', fontWeight: '600', color: '#2d2d2d' },
  transactionsList: { maxHeight: '300px', overflowY: 'auto', marginBottom: '16px' },
  transactionItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 0', borderBottom: '1px solid #f0f0f0'
  },
  transactionLeft: { flex: 1, paddingRight: '12px' },
  transactionName: { fontSize: '14px', fontWeight: '500', color: '#2d2d2d', margin: '0 0 2px 0' },
  transactionDetail: { fontSize: '12px', color: '#aaa', margin: 0 },
  transactionMonto: { fontSize: '14px', fontWeight: '600', whiteSpace: 'nowrap' },
  moreTransactions: { fontSize: '13px', color: '#9B59B6', textAlign: 'center', padding: '8px 0' },
  warningBox: {
    backgroundColor: '#fff8e1', border: '1px solid #ffe082',
    borderRadius: '10px', padding: '12px', fontSize: '13px', color: '#856404', marginBottom: '16px'
  }
}