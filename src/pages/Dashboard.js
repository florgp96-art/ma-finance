import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { extractTextFromPDF, analyzeStatementWithClaude } from '../lib/pdfReader'

export default function Dashboard() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ nombre: '', tipo: 'credito' })
  const [archivo, setArchivo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [step, setStep] = useState('form') // form | processing | preview | adicionales
  const [statementData, setStatementData] = useState(null)
  const [separarAdicionales, setSepararAdicionales] = useState(null)

  useEffect(() => { fetchAccounts() }, [])

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
    if (!archivo) { alert('Por favor cargá el extracto PDF'); return }
    
    setStep('processing')
    setLoading(true)

    try {
      const pdfText = await extractTextFromPDF(archivo)
      const result = await analyzeStatementWithClaude(pdfText, newAccount.nombre)
      setStatementData(result)

      if (result.adicionales && result.adicionales.length > 0) {
        setStep('adicionales')
      } else {
        setStep('preview')
      }
    } catch (err) {
      alert('Error procesando el PDF: ' + err.message)
      setStep('form')
    }
    setLoading(false)
  }

  const handleConfirmAdicionales = (separar) => {
    setSepararAdicionales(separar)
    setStep('preview')
  }

  const handleConfirmTransactions = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()

    // Crear cuenta
    const { data: account } = await supabase.from('accounts').insert({
      user_id: user.id,
      nombre: newAccount.nombre,
      tipo: newAccount.tipo,
    }).select().single()

    // Crear extracto
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

    // Insertar transacciones
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
      estado: (!t.nombre_limpio || t.nombre_limpio === t.nombre_original) ? 'a_identificar' : 'identificado',
      es_manual: false
    }))

    await supabase.from('transactions').insert(transacciones)

    setNewAccount({ nombre: '', tipo: 'credito' })
    setArchivo(null)
    setStatementData(null)
    setStep('form')
    setShowAddAccount(false)
    fetchAccounts()
    setLoading(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type === 'application/pdf') setArchivo(file)
    else alert('Solo se aceptan archivos PDF')
  }

  const tipoLabel = (tipo) => {
    if (tipo === 'credito') return '💳 Crédito'
    if (tipo === 'debito') return '🏦 Débito'
    return '💵 Efectivo'
  }

  const formatMonto = (monto) => {
    return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(monto)
  }

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
              <p style={styles.cardLabel}>Total del mes</p>
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

          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Mis tarjetas y cuentas</h2>
              {accounts.length > 0 && (
                <button style={styles.addBtn} onClick={() => { setShowAddAccount(true); setStep('form') }}>
                  + Agregar
                </button>
              )}
            </div>

            {accounts.length === 0 ? (
              <div style={styles.empty}>
                <p>Todavía no agregaste ninguna tarjeta.</p>
                <button style={styles.addBtnLarge} onClick={() => { setShowAddAccount(true); setStep('form') }}>
                  + Agregar mi primera tarjeta
                </button>
              </div>
            ) : (
              <div style={styles.accountsGrid}>
                {accounts.map(acc => (
                  <div key={acc.id} style={styles.accountCard}>
                    <p style={styles.accountType}>{tipoLabel(acc.tipo)}</p>
                    <p style={styles.accountName}>{acc.nombre}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddAccount && (
        <div style={styles.overlay}>
          <div style={styles.modal}>

            {/* STEP: FORM */}
            {step === 'form' && (
              <>
                <h3 style={styles.modalTitle}>Agregar tarjeta</h3>
                <form onSubmit={handleAddAccount}>
                  <div style={styles.field}>
                    <label style={styles.label}>Nombre de la tarjeta</label>
                    <input
                      style={styles.input}
                      value={newAccount.nombre}
                      onChange={(e) => setNewAccount({...newAccount, nombre: e.target.value})}
                      placeholder="Ej: AMEX, Visa Galicia, Mastercard BBVA"
                      required
                    />
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>Tipo</label>
                    <select
                      style={styles.input}
                      value={newAccount.tipo}
                      onChange={(e) => setNewAccount({...newAccount, tipo: e.target.value})}
                    >
                      <option value="credito">💳 Tarjeta de crédito</option>
                      <option value="debito">🏦 Débito / Cuenta bancaria</option>
                    </select>
                  </div>

                  <div style={styles.field}>
                    <label style={styles.label}>Extracto del banco (PDF)</label>
                    <div
                      style={{
                        ...styles.dropzone,
                        ...(dragOver ? styles.dropzoneActive : {}),
                        ...(archivo ? styles.dropzoneDone : {})
                      }}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => document.getElementById('fileInput').click()}
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
                    <input
                      id="fileInput"
                      type="file"
                      accept=".pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => { if (e.target.files[0]) setArchivo(e.target.files[0]) }}
                    />
                  </div>

                  <div style={styles.modalButtons}>
                    <button type="button" style={styles.cancelBtn}
                      onClick={() => { setShowAddAccount(false); setArchivo(null) }}>
                      Cancelar
                    </button>
                    <button type="submit" style={styles.saveBtn} disabled={loading}>
                      {loading ? 'Procesando...' : 'Guardar y procesar'}
                    </button>
                  </div>
                </form>
              </>
            )}

            {/* STEP: PROCESSING */}
            {step === 'processing' && (
              <div style={styles.processingContainer}>
                <p style={styles.processingIcon}>🤖</p>
                <h3 style={styles.processingTitle}>Analizando tu extracto...</h3>
                <p style={styles.processingText}>La IA está leyendo y clasificando tus transacciones. Esto puede tardar unos segundos.</p>
                <div style={styles.loader} />
              </div>
            )}

            {/* STEP: ADICIONALES */}
            {step === 'adicionales' && statementData && (
              <>
                <h3 style={styles.modalTitle}>Detectamos adicionales 👥</h3>
                <p style={styles.stepSubtitle}>
                  En este extracto encontramos gastos de otras personas:
                </p>
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

            {/* STEP: PREVIEW */}
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
                    <div key={i} style={{
                      ...styles.transactionItem,
                      ...(t.estado === 'a_identificar' ? styles.transactionUnknown : {})
                    }}>
                      <div style={styles.transactionLeft}>
                        <p style={styles.transactionName}>
                          {t.nombre_limpio || t.nombre_original}
                          {t.nombre_limpio === t.nombre_original && 
                            <span style={styles.unknownBadge}> ❓</span>}
                        </p>
                        <p style={styles.transactionDetail}>
                          {t.fecha} · {t.categoria_sugerida}
                          {t.cuotas_total > 1 && ` · Cuota ${t.cuota_numero}/${t.cuotas_total}`}
                          {separarAdicionales && t.titular && ` · ${t.titular}`}
                        </p>
                      </div>
                      <p style={{
                        ...styles.transactionMonto,
                        color: t.es_credito ? '#27AE60' : '#2d2d2d'
                      }}>
                        {t.es_credito ? '+' : '-'} {t.moneda === 'USD' ? 'U$S' : '$'} {formatMonto(t.monto)}
                      </p>
                    </div>
                  ))}
                  {statementData.transacciones.length > 10 && (
                    <p style={styles.moreTransactions}>
                      + {statementData.transacciones.length - 10} transacciones más
                    </p>
                  )}
                </div>

                {statementData.transacciones.some(t => t.nombre_limpio === t.nombre_original) && (
                  <div style={styles.warningBox}>
                    ❓ Hay {statementData.transacciones.filter(t => t.nombre_limpio === t.nombre_original).length} transacciones sin identificar. Podrás nombrarlas después.
                  </div>
                )}

                <div style={styles.modalButtons}>
                  <button style={styles.cancelBtn} onClick={() => setStep('form')}>
                    ← Atrás
                  </button>
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
  summaryCards: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' },
  summaryCard: { backgroundColor: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  cardLabel: { fontSize: '13px', color: '#888', margin: '0 0 8px 0' },
  cardValue: { fontSize: '28px', fontWeight: 'bold', color: '#2d2d2d', margin: 0 },
  section: { backgroundColor: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
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
  accountCard: { backgroundColor: '#f8f6f3', borderRadius: '12px', padding: '20px', border: '1px solid #ede8f5' },
  accountType: { fontSize: '12px', color: '#9B59B6', margin: '0 0 6px 0', fontWeight: '600' },
  accountName: { fontSize: '18px', fontWeight: 'bold', color: '#2d2d2d', margin: 0 },
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
    border: '2px dashed #e0e0e0', borderRadius: '12px', padding: '32px',
    textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s', backgroundColor: '#fafafa'
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
  processingIcon: { fontSize: '48px', margin: '0 0 16px 0' },
  processingTitle: { fontSize: '20px', fontWeight: 'bold', color: '#2d2d2d', margin: '0 0 8px 0' },
  processingText: { fontSize: '14px', color: '#888', margin: '0 0 24px 0' },
  loader: {
    width: '40px', height: '40px', border: '4px solid #f0e6fa',
    borderTop: '4px solid #9B59B6', borderRadius: '50%',
    animation: 'spin 1s linear infinite', margin: '0 auto'
  },
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
    backgroundColor: 'white', cursor: 'pointer', transition: 'all 0.2s',
    gap: '4px'
  },
  opcionIcon: { fontSize: '28px' },
  opcionTitle: { fontSize: '14px', fontWeight: '600', color: '#2d2d2d' },
  opcionDesc: { fontSize: '12px', color: '#888' },
  previewStats: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px'
  },
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
  transactionUnknown: { opacity: 0.7 },
  transactionLeft: { flex: 1, paddingRight: '12px' },
  transactionName: { fontSize: '14px', fontWeight: '500', color: '#2d2d2d', margin: '0 0 2px 0' },
  transactionDetail: { fontSize: '12px', color: '#aaa', margin: 0 },
  transactionMonto: { fontSize: '14px', fontWeight: '600', whiteSpace: 'nowrap' },
  unknownBadge: { fontSize: '12px' },
  moreTransactions: { fontSize: '13px', color: '#9B59B6', textAlign: 'center', padding: '8px 0' },
  warningBox: {
    backgroundColor: '#fff8e1', border: '1px solid #ffe082',
    borderRadius: '10px', padding: '12px', fontSize: '13px', color: '#856404',
    marginBottom: '16px'
  }
}