import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ nombre: '', tipo: 'credito' })
  const [archivo, setArchivo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

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
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('accounts').insert({
      user_id: user.id,
      nombre: newAccount.nombre,
      tipo: newAccount.tipo,
    })

    setNewAccount({ nombre: '', tipo: 'credito' })
    setArchivo(null)
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
                <button style={styles.addBtn} onClick={() => setShowAddAccount(true)}>
                  + Agregar
                </button>
              )}
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
                  onChange={(e) => {
                    const file = e.target.files[0]
                    if (file) setArchivo(file)
                  }}
                />
              </div>

              <div style={styles.modalButtons}>
                <button
                  type="button"
                  style={styles.cancelBtn}
                  onClick={() => { setShowAddAccount(false); setArchivo(null) }}
                >
                  Cancelar
                </button>
                <button type="submit" style={styles.saveBtn} disabled={loading}>
                  {loading ? 'Procesando...' : 'Guardar y procesar'}
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
  accountCard: {
    backgroundColor: '#f8f6f3', borderRadius: '12px', padding: '20px',
    border: '1px solid #ede8f5'
  },
  accountType: { fontSize: '12px', color: '#9B59B6', margin: '0 0 6px 0', fontWeight: '600' },
  accountName: { fontSize: '18px', fontWeight: 'bold', color: '#2d2d2d', margin: 0 },
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000
  },
  modal: {
    backgroundColor: 'white', borderRadius: '16px', padding: '32px',
    width: '100%', maxWidth: '480px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
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
    textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s',
    backgroundColor: '#fafafa'
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
  }
}