import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORY_CONFIG } from './AccountDetail'

const ConfigPanel = forwardRef(function ConfigPanel({
  darkMode,
  isMobile,
  categoriasDB,
  subcategoriasDB,
  childrenDB,
  customIcons,
  userAliases,
  ingresoTags,
  onCreateIngresoTag,
  onDeleteIngresoTag,
  fetchCategorias,
  fetchChildren,
  fetchUserAliases,
  saveCustomIcon,
  showToast,
  onRefresh,
}, ref) {
  // Modal visibility
  const [showHijos, setShowHijos] = useState(false)
  const [showCategorias, setShowCategorias] = useState(false)
  const [showIconos, setShowIconos] = useState(false)
  const [showAliases, setShowAliases] = useState(false)
  const [showCambiarClave, setShowCambiarClave] = useState(false)

  // Hijos form
  const [newHijoNombre, setNewHijoNombre] = useState('')

  // Categorías form
  const [newCatNombre, setNewCatNombre] = useState('')
  const [newCatTipo, setNewCatTipo] = useState('gasto')
  const [newTagIngreso, setNewTagIngreso] = useState('')
  const [editingCat, setEditingCat] = useState(null)
  const [editingCatNombre, setEditingCatNombre] = useState('')
  const [newSubcatCatId, setNewSubcatCatId] = useState(null)
  const [newSubcatNombre, setNewSubcatNombre] = useState('')

  // Cambiar contraseña form
  const [nuevaClave, setNuevaClave] = useState('')
  const [confirmarClave, setConfirmarClave] = useState('')
  const [claveMsg, setClaveMsg] = useState(null)

  // Íconos
  const [iconEditingCat, setIconEditingCat] = useState(null)
  const [iconInput, setIconInput] = useState('')

  // Aliases form
  const [newAlias, setNewAlias] = useState({ alias: '', tipo: 'categoria', valor: '', subcategoria: '', descripcion: '' })
  const [pendingRulesCount, setPendingRulesCount] = useState(0)
  const [checkingPending, setCheckingPending] = useState(false)

  // ESC cierra el modal de íconos
  useEffect(() => {
    if (!showIconos) return
    const handler = (e) => {
      if (e.key === 'Escape') { setShowIconos(false); setIconEditingCat(null); setIconInput('') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showIconos])

  // Al abrir el modal (o cuando cambian las reglas) recalcula cuántos movimientos
  // existentes todavía no tienen aplicada alguna regla de categoría/hijo.
  useEffect(() => {
    if (!showAliases) return
    let cancelado = false
    const revisar = async () => {
      setCheckingPending(true)
      const { data: { user } } = await supabase.auth.getUser()
      const aplicables = (userAliases || []).filter(a => a.tipo === 'categoria' || a.tipo === 'hijo' || a.tipo === 'neutro')
      let total = 0
      for (const a of aplicables) {
        total += await countPendingForAlias(a, user)
      }
      if (!cancelado) { setPendingRulesCount(total); setCheckingPending(false) }
    }
    revisar()
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAliases, userAliases])

  // Expose imperative methods
  useImperativeHandle(ref, () => ({
    openHijos: () => { fetchChildren(); setShowHijos(true) },
    openCategorias: () => setShowCategorias(true),
    openAliases: () => { fetchUserAliases(); setShowAliases(true) },
    openCambiarClave: () => { setNuevaClave(''); setConfirmarClave(''); setClaveMsg(null); setShowCambiarClave(true) },
    openIconos: () => setShowIconos(true),
  }))

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleAddHijo = async (e) => {
    e.preventDefault()
    if (!newHijoNombre.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('children').insert({ user_id: user.id, nombre: newHijoNombre.trim() })
    setNewHijoNombre('')
    fetchChildren()
  }

  const handleDeleteHijo = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar a "${nombre}"?`)) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('children').delete().eq('id', id).eq('user_id', user.id)
    fetchChildren()
  }

  const handleAddCategoria = async (e) => {
    e.preventDefault()
    if (!newCatNombre.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('categories').insert({ user_id: user.id, nombre: newCatNombre.trim(), tipo: newCatTipo, orden: (categoriasDB?.length || 0) + 1 })
    setNewCatNombre('')
    setNewCatTipo('gasto')
    fetchCategorias()
  }

  const handleSaveEditCat = async (cat) => {
    if (!editingCatNombre.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('categories').update({ nombre: editingCatNombre.trim() }).eq('id', cat.id).eq('user_id', user.id)
    setEditingCat(null)
    fetchCategorias()
  }

  const handleChangeCatTipo = async (cat, tipo) => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('categories').update({ tipo }).eq('id', cat.id).eq('user_id', user.id)
    fetchCategorias()
  }

  const handleAddSubcat = async (e) => {
    e.preventDefault()
    if (!newSubcatNombre.trim() || !newSubcatCatId) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('subcategories').insert({ nombre: newSubcatNombre.trim(), category_id: newSubcatCatId, user_id: user.id })
    setNewSubcatNombre('')
    setNewSubcatCatId(null)
    fetchCategorias()
  }

  const handleDeleteCategoria = async (cat) => {
    if (!window.confirm(`¿Eliminar "${cat.nombre}" y sus subcategorías?`)) return
    const { data: { user } } = await supabase.auth.getUser()
    const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('category_id', cat.id).eq('user_id', user.id)
    if (count > 0) {
      showToast(`Esta categoría tiene ${count} transacción(es). Primero reclasificalas.`, 'error')
      return
    }
    await supabase.from('subcategories').delete().eq('category_id', cat.id).eq('user_id', user.id)
    await supabase.from('categories').delete().eq('id', cat.id).eq('user_id', user.id)
    fetchCategorias()
  }

  const handleDeleteSubcat = async (subcat) => {
    if (!window.confirm(`¿Eliminar "${subcat.nombre}"?`)) return
    const { data: { user } } = await supabase.auth.getUser()
    const { count } = await supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('subcategory_id', subcat.id).eq('user_id', user.id)
    if (count > 0) {
      showToast(`Esta subcategoría tiene ${count} transacción(es). Primero reclasificalas.`, 'error')
      return
    }
    await supabase.from('subcategories').delete().eq('id', subcat.id).eq('user_id', user.id)
    fetchCategorias()
  }

  const handleCambiarClave = async (e) => {
    e.preventDefault()
    setClaveMsg(null)
    if (nuevaClave.length < 6) { setClaveMsg({ tipo: 'error', texto: 'La contraseña debe tener al menos 6 caracteres.' }); return }
    if (nuevaClave !== confirmarClave) { setClaveMsg({ tipo: 'error', texto: 'Las contraseñas no coinciden.' }); return }
    const { error } = await supabase.auth.updateUser({ password: nuevaClave })
    if (error) { setClaveMsg({ tipo: 'error', texto: error.message }); return }
    setClaveMsg({ tipo: 'ok', texto: '¡Contraseña actualizada correctamente!' })
    setNuevaClave('')
    setConfirmarClave('')
  }

  // Cuenta cuántos gastos coinciden con la palabra clave de una regla pero todavía
  // no tienen esa categoría/hijo aplicado (para saber si hay algo pendiente).
  const countPendingForAlias = async (alias, user) => {
    const aliasKeyword = alias.alias
    if (alias.tipo === 'categoria') {
      const [catName, subcatName] = alias.valor.split(' > ').map(v => v.trim())
      const catObj = categoriasDB.find(c => c.nombre === catName)
      if (!catObj) return 0
      const subcatObj = subcatName ? subcategoriasDB.find(s => s.nombre === subcatName && s.category_id === catObj.id) : null
      const { data: matches } = await supabase.from('transactions')
        .select('id, category_id, subcategory_id')
        .eq('user_id', user.id).eq('tipo', 'gasto')
        .or(`detalle.ilike.%${aliasKeyword}%,nombre.ilike.%${aliasKeyword}%`)
      if (!matches) return 0
      return matches.filter(m => m.category_id !== catObj.id || (subcatObj ? m.subcategory_id !== subcatObj.id : false)).length
    }
    if (alias.tipo === 'hijo') {
      const { data: matches } = await supabase.from('transactions')
        .select('id, tag')
        .eq('user_id', user.id).eq('tipo', 'gasto')
        .or(`detalle.ilike.%${aliasKeyword}%,nombre.ilike.%${aliasKeyword}%`)
      if (!matches) return 0
      return matches.filter(m => m.tag !== alias.valor).length
    }
    if (alias.tipo === 'neutro') {
      const { data: matches } = await supabase.from('transactions')
        .select('id')
        .eq('user_id', user.id).eq('tipo', 'gasto')
        .or(`detalle.ilike.%${aliasKeyword}%,nombre.ilike.%${aliasKeyword}%`)
      return matches?.length || 0
    }
    return 0
  }

  // Busca gastos existentes que contengan la palabra clave de un alias y les aplica
  // la categoría/subcategoría (o el hijo). Devuelve cuántos movimientos actualizó.
  const applyAliasToExisting = async (alias, user) => {
    const aliasKeyword = alias.alias
    if (alias.tipo === 'categoria') {
      const [catName, subcatName] = alias.valor.split(' > ').map(v => v.trim())
      const catObj = categoriasDB.find(c => c.nombre === catName)
      if (!catObj) return 0
      const subcatObj = subcatName ? subcategoriasDB.find(s => s.nombre === subcatName && s.category_id === catObj.id) : null
      const { data: matches } = await supabase.from('transactions')
        .select('id')
        .eq('user_id', user.id).eq('tipo', 'gasto')
        .or(`detalle.ilike.%${aliasKeyword}%,nombre.ilike.%${aliasKeyword}%`)
      if (!matches || matches.length === 0) return 0
      await supabase.from('transactions').update({
        category_id: catObj.id,
        subcategory_id: subcatObj?.id || null,
        estado: 'identificado',
      }).in('id', matches.map(m => m.id))
      return matches.length
    }
    if (alias.tipo === 'hijo') {
      const { data: matches } = await supabase.from('transactions')
        .select('id')
        .eq('user_id', user.id).eq('tipo', 'gasto')
        .or(`detalle.ilike.%${aliasKeyword}%,nombre.ilike.%${aliasKeyword}%`)
      if (!matches || matches.length === 0) return 0
      await supabase.from('transactions').update({ tag: alias.valor }).in('id', matches.map(m => m.id))
      return matches.length
    }
    if (alias.tipo === 'neutro') {
      const { data: matches } = await supabase.from('transactions')
        .select('id')
        .eq('user_id', user.id).eq('tipo', 'gasto')
        .or(`detalle.ilike.%${aliasKeyword}%,nombre.ilike.%${aliasKeyword}%`)
      if (!matches || matches.length === 0) return 0
      await supabase.from('transactions').update({ tipo: 'neutro', estado: 'identificado' }).in('id', matches.map(m => m.id))
      return matches.length
    }
    return 0
  }

  const handleAddAlias = async (e) => {
    e.preventDefault()
    if (!newAlias.alias.trim() || (newAlias.tipo !== 'neutro' && !newAlias.valor.trim())) return
    const { data: { user } } = await supabase.auth.getUser()
    const aliasKeyword = newAlias.alias.trim().toUpperCase()
    const valorFinal = newAlias.tipo === 'neutro'
      ? 'Neutro'
      : newAlias.tipo === 'categoria' && newAlias.subcategoria
        ? `${newAlias.valor.trim()} > ${newAlias.subcategoria.trim()}`
        : newAlias.valor.trim()
    await supabase.from('user_aliases').insert({
      user_id: user.id,
      alias: aliasKeyword,
      tipo: newAlias.tipo,
      valor: valorFinal,
      descripcion: newAlias.descripcion.trim() || null
    })

    const actualizados = await applyAliasToExisting({ alias: aliasKeyword, tipo: newAlias.tipo, valor: valorFinal }, user)
    showToast(actualizados > 0 ? `Regla creada y aplicada a ${actualizados} movimiento(s) existente(s).` : 'Regla creada.')
    if (actualizados > 0) onRefresh?.()

    setNewAlias({ alias: '', tipo: 'categoria', valor: '', subcategoria: '', descripcion: '' })
    fetchUserAliases()
  }

  const handleApplyAllAliases = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const aplicables = (userAliases || []).filter(a => a.tipo === 'categoria' || a.tipo === 'hijo')
    if (aplicables.length === 0) { showToast('No hay reglas de categoría o hijo para aplicar.', 'error'); return }
    showToast('Aplicando reglas a movimientos existentes...')
    let total = 0
    for (const a of aplicables) {
      total += await applyAliasToExisting(a, user)
    }
    showToast(total > 0 ? `Reglas aplicadas a ${total} movimiento(s).` : 'No se encontraron movimientos que coincidan con tus reglas.')
    setPendingRulesCount(0)
    if (total > 0) onRefresh?.()
  }

  const handleDeleteAlias = async (id) => {
    if (!window.confirm('¿Eliminar este alias?')) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('user_aliases').delete().eq('id', id).eq('user_id', user.id)
    fetchUserAliases()
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const p = darkMode ? '#8C7B8C' : '#5C4F5C'
  const panel = darkMode ? '#2A272A' : 'white'
  const txt = darkMode ? '#F0EDEC' : '#1d1d1f'
  const border = darkMode ? '#3A333A' : '#E2DDE0'

  const s = {
    overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modal: { backgroundColor: panel, borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '520px', boxShadow: '0 8px 32px rgba(0,0,0,0.20)', maxHeight: '90vh', overflowY: 'auto' },
    modalTitle: { fontSize: '18px', fontWeight: '600', color: txt, margin: '0 0 20px' },
    input: { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: isMobile ? '16px' : '14px', outline: 'none', boxSizing: 'border-box', backgroundColor: darkMode ? '#1C1A1C' : '#fafafa', color: txt, fontFamily: '"Montserrat", sans-serif' },
    saveBtn: { flex: 1, padding: '12px', backgroundColor: p, color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', outline: 'none', fontFamily: '"Montserrat", sans-serif' },
    cancelBtn: { flex: 1, padding: '12px', backgroundColor: 'transparent', color: p, border: `2px solid ${p}`, borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', outline: 'none', fontFamily: '"Montserrat", sans-serif' },
    actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px', opacity: 0.7, outline: 'none' },
    label: { display: 'block', fontSize: '11px', fontWeight: '600', color: darkMode ? '#9A8A9A' : '#6e6e73', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: '"Montserrat", sans-serif' },
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Modal: Hijos */}
      {showHijos && (
        <div style={s.overlay}>
          <div style={{ ...s.modal, maxWidth: '380px' }}>
            <h3 style={s.modalTitle}>👧 Mis hijos</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {(childrenDB || []).map(h => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', backgroundColor: darkMode ? '#1C1A1C' : '#F7F5F8', borderRadius: '10px' }}>
                  <span style={{ fontSize: '14px', color: txt }}>{h.icono || '👧'} {h.nombre}</span>
                  <button style={s.actionBtn} onClick={() => handleDeleteHijo(h.id, h.nombre)}>🗑️</button>
                </div>
              ))}
              {(childrenDB || []).length === 0 && (
                <p style={{ fontSize: '13px', color: '#aaa', textAlign: 'center', padding: '16px 0' }}>Sin hijos registrados.</p>
              )}
            </div>
            <form onSubmit={handleAddHijo} style={{ display: 'flex', gap: '8px' }}>
              <input
                style={{ ...s.input, flex: 1 }}
                placeholder="Nombre del hijo/a"
                value={newHijoNombre}
                onChange={e => setNewHijoNombre(e.target.value)}
              />
              <button type="submit" style={{ ...s.saveBtn, flex: 'none', padding: '12px 20px' }}>+</button>
            </form>
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button style={s.cancelBtn} onClick={() => setShowHijos(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Íconos */}
      {showIconos && (
        <div style={s.overlay}>
          <div style={{ ...s.modal, maxWidth: '480px', width: '92%', maxHeight: '82vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}>
            <div style={{ padding: '20px 20px 12px' }}>
              <h3 style={{ ...s.modalTitle, marginBottom: '4px' }}>🎨 Íconos de categorías</h3>
              <p style={{ fontSize: '12px', color: '#8e8e93', margin: 0 }}>Tocá una fila para cambiar su ícono</p>
            </div>
            <div className="hide-scroll" style={{ overflowY: 'auto', flex: 1, padding: '0 20px' }}>
            {[
              ...(categoriasDB || []).map(c => ({ nombre: c.nombre, tipo: 'cat' })),
              ...(childrenDB || []).map(c => ({ nombre: c.nombre, tipo: 'hijo' })),
              ...(ingresoTags || []).map(t => ({ nombre: t, tipo: 'ingreso' })),
            ].map(({ nombre, tipo }) => {
              const defaultIcon = CATEGORY_CONFIG[nombre]?.icon || (tipo === 'hijo' ? '👧' : tipo === 'ingreso' ? '💰' : '❓')
              const currentIcon = customIcons[nombre] || defaultIcon
              const isEditing = iconEditingCat === nombre
              const EMOJI_GRID = ['🏠','🍔','🚗','💊','🎬','📱','👕','📚','💼','💰','🏦','👶','✈️','🎵','🐾','💄','🌿','🍕','☕','🎮','📦','🛒','🎁','🍷','🎨','🧴','💅','🐶','🎯','🏊']
              return (
                <div key={nombre} style={{ borderBottom: `1px solid ${darkMode ? '#2A272A' : '#F0EDEC'}`, paddingBottom: isEditing ? '12px' : '0' }}>
                  <div
                    onClick={() => { if (!isEditing) { setIconEditingCat(nombre); setIconInput(customIcons[nombre] || '') } }}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 4px', cursor: isEditing ? 'default' : 'pointer', borderRadius: '8px' }}
                  >
                    <span style={{ fontSize: '22px', width: '28px', textAlign: 'center' }}>{currentIcon}</span>
                    <span style={{ flex: 1, fontSize: '14px', color: txt, fontFamily: '"Montserrat", sans-serif' }}>{nombre}</span>
                    {customIcons[nombre] && <span style={{ fontSize: '10px', color: '#8e8e93' }}>custom</span>}
                    {!isEditing && <span style={{ fontSize: '12px', color: '#8e8e93' }}>✏️</span>}
                  </div>
                  {isEditing && (
                    <div style={{ paddingLeft: '38px' }}>
                      {!isMobile && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                          {EMOJI_GRID.map(e => (
                            <button key={e} onClick={() => setIconInput(e)} style={{ fontSize: '20px', padding: '4px', borderRadius: '6px', border: iconInput === e ? `2px solid ${p}` : '2px solid transparent', background: 'none', cursor: 'pointer' }}>{e}</button>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          value={iconInput}
                          onChange={e => setIconInput(e.target.value)}
                          placeholder={isMobile ? 'Escribí o pegá un emoji' : 'O escribí uno personalizado'}
                          maxLength={4}
                          style={{ flex: 1, padding: '7px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '20px', outline: 'none', backgroundColor: darkMode ? '#1C1A1C' : 'white', color: txt, fontFamily: '"Montserrat", sans-serif' }}
                        />
                        <button onClick={() => { saveCustomIcon(nombre, iconInput.trim()); setIconEditingCat(null); setIconInput('') }} style={{ padding: '7px 14px', borderRadius: '8px', backgroundColor: p, color: 'white', border: 'none', cursor: 'pointer', fontSize: '13px', fontFamily: '"Montserrat", sans-serif', fontWeight: '600' }}>
                          Guardar
                        </button>
                        {customIcons[nombre] && (
                          <button onClick={() => { saveCustomIcon(nombre, ''); setIconEditingCat(null); setIconInput('') }} style={{ padding: '7px 10px', borderRadius: '8px', border: `1px solid #c0392b`, color: '#c0392b', background: 'none', cursor: 'pointer', fontSize: '12px', fontFamily: '"Montserrat", sans-serif' }}>
                            Reset
                          </button>
                        )}
                        <button onClick={() => { setIconEditingCat(null); setIconInput('') }} style={{ padding: '7px 10px', borderRadius: '8px', border: `1px solid ${border}`, color: '#8e8e93', background: 'none', cursor: 'pointer', fontSize: '12px', fontFamily: '"Montserrat", sans-serif' }}>
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            </div>
            <div style={{ padding: '12px 20px 20px' }}>
              <button onClick={() => { setShowIconos(false); setIconEditingCat(null); setIconInput('') }} style={{ width: '100%', padding: '10px', borderRadius: '10px', border: 'none', backgroundColor: p, color: 'white', cursor: 'pointer', fontSize: '14px', fontFamily: '"Montserrat", sans-serif', fontWeight: '600' }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Categorías */}
      {showCategorias && (
        <div style={s.overlay}>
          <div style={{ ...s.modal, maxWidth: '520px' }}>
            <h3 style={s.modalTitle}>Categorías y subcategorías</h3>
            <div style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '20px' }}>
              {(categoriasDB || []).map(cat => (
                <div key={cat.id} style={{ marginBottom: '16px', borderBottom: `1px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`, paddingBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    {editingCat === cat.id ? (
                      <>
                        <input
                          style={{ ...s.input, flex: 1, padding: '6px 10px', fontSize: '13px' }}
                          value={editingCatNombre}
                          onChange={e => setEditingCatNombre(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleSaveEditCat(cat)}
                          autoFocus
                        />
                        <button style={{ ...s.saveBtn, flex: 'none', padding: '6px 12px', fontSize: '12px' }} onClick={() => handleSaveEditCat(cat)}>✓</button>
                        <button style={{ ...s.cancelBtn, flex: 'none', padding: '6px 12px', fontSize: '12px' }} onClick={() => setEditingCat(null)}>✕</button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontWeight: '500', fontSize: '14px', flex: 1, color: txt }}>{cat.nombre}</span>
                        <select
                          value={cat.tipo || 'gasto'}
                          onChange={e => handleChangeCatTipo(cat, e.target.value)}
                          style={{
                            fontSize: '10px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.03em',
                            padding: '2px 6px', borderRadius: '8px', border: 'none', cursor: 'pointer', outline: 'none',
                            backgroundColor: (cat.tipo || 'gasto') === 'ingreso' ? '#e8f5e9' : (cat.tipo || 'gasto') === 'neutro' ? '#f0f0f0' : (darkMode ? '#3A333A' : '#EDE8EC'),
                            color: (cat.tipo || 'gasto') === 'ingreso' ? '#2e7d32' : (cat.tipo || 'gasto') === 'neutro' ? '#8e8e93' : '#5C4F5C',
                          }}>
                          <option value="gasto">Gasto</option>
                          <option value="ingreso">Ingreso</option>
                          <option value="neutro">Neutro</option>
                        </select>
                        <button style={s.actionBtn} onClick={() => { setEditingCat(cat.id); setEditingCatNombre(cat.nombre) }}>✏️</button>
                        <button style={s.actionBtn} onClick={() => handleDeleteCategoria(cat)}>🗑️</button>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginLeft: '4px' }}>
                    {(subcategoriasDB || []).filter(s2 => s2.category_id === cat.id).map(sub => (
                      <span key={sub.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '12px', backgroundColor: darkMode ? '#3A303A' : '#EDE8EC', borderRadius: '6px', padding: '2px 8px', color: darkMode ? '#C0B0C0' : '#5C4F5C' }}>
                        {sub.nombre}
                        <button onClick={() => handleDeleteSubcat(sub)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: '#999', padding: '0 0 0 2px', lineHeight: 1 }}>×</button>
                      </span>
                    ))}
                    {newSubcatCatId === cat.id ? (
                      <form onSubmit={handleAddSubcat} style={{ display: 'flex', gap: '4px' }}>
                        <input
                          style={{ ...s.input, padding: '3px 8px', fontSize: '12px', width: '120px' }}
                          placeholder="Nueva subcategoría"
                          value={newSubcatNombre}
                          onChange={e => setNewSubcatNombre(e.target.value)}
                          autoFocus
                        />
                        <button type="submit" style={{ ...s.saveBtn, flex: 'none', padding: '3px 10px', fontSize: '12px' }}>+</button>
                        <button type="button" style={{ ...s.cancelBtn, flex: 'none', padding: '3px 8px', fontSize: '12px' }} onClick={() => setNewSubcatCatId(null)}>✕</button>
                      </form>
                    ) : (
                      <button
                        onClick={() => { setNewSubcatCatId(cat.id); setNewSubcatNombre('') }}
                        style={{ fontSize: '11px', color: p, background: 'none', border: `1px dashed ${p}`, borderRadius: '6px', padding: '2px 8px', cursor: 'pointer' }}
                      >+ sub</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={handleAddCategoria} style={{ display: 'flex', gap: '8px' }}>
              <input
                style={{ ...s.input, flex: 1 }}
                placeholder="Nueva categoría"
                value={newCatNombre}
                onChange={e => setNewCatNombre(e.target.value)}
              />
              <select style={{ ...s.input, flex: 'none', width: '110px' }} value={newCatTipo} onChange={e => setNewCatTipo(e.target.value)}>
                <option value="gasto">Gasto</option>
                <option value="ingreso">Ingreso</option>
                <option value="neutro">Neutro</option>
              </select>
              <button type="submit" style={{ ...s.saveBtn, flex: 'none', padding: '12px 20px' }}>Agregar</button>
            </form>
            {/* Sección: Tags de ingresos */}
            <div style={{ marginTop: '24px', borderTop: `2px solid ${darkMode ? '#3A333A' : '#EDE8EC'}`, paddingTop: '16px' }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: txt, fontFamily: '"Montserrat", sans-serif' }}>💰 Tags de ingresos</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                {(ingresoTags || []).map(tag => (
                  <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '12px', backgroundColor: darkMode ? '#3A303A' : '#EDE8EC', borderRadius: '6px', padding: '2px 8px', color: darkMode ? '#C0B0C0' : '#5C4F5C' }}>
                    {tag}
                    <button onClick={() => onDeleteIngresoTag && onDeleteIngresoTag(tag)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: '#999', padding: '0 0 0 2px', lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
              <form onSubmit={e => { e.preventDefault(); if (newTagIngreso.trim()) { onCreateIngresoTag && onCreateIngresoTag(newTagIngreso.trim()); setNewTagIngreso('') } }} style={{ display: 'flex', gap: '8px' }}>
                <input
                  style={{ ...s.input, flex: 1 }}
                  placeholder="Nuevo tag de ingreso"
                  value={newTagIngreso}
                  onChange={e => setNewTagIngreso(e.target.value)}
                />
                <button type="submit" style={{ ...s.saveBtn, flex: 'none', padding: '12px 20px' }}>Agregar</button>
              </form>
            </div>

            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button style={s.cancelBtn} onClick={() => { setShowCategorias(false); setEditingCat(null); setNewSubcatCatId(null) }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reglas de clasificación */}
      {showAliases && (
        <div style={s.overlay}>
          <div style={{ ...s.modal, maxWidth: '580px' }}>
            <h3 style={s.modalTitle}>📋 Reglas de clasificación</h3>
            <p style={{ fontSize: '13px', color: '#6e6e73', margin: '-12px 0 12px 0' }}>
              Enseñale a la IA cómo clasificar tus gastos. Estas reglas se aplican siempre, sin importar cómo cargues los datos.
            </p>
            {checkingPending ? (
              <p style={{ fontSize: '12px', color: '#aaa', margin: '0 0 14px 0' }}>Revisando movimientos pendientes...</p>
            ) : pendingRulesCount > 0 && (
              <button
                onClick={handleApplyAllAliases}
                style={{ ...s.actionBtn, background: 'none', border: '1.5px solid #c07a2b', color: '#c07a2b', borderRadius: '8px', padding: '7px 12px', fontSize: '12px', fontWeight: '500', marginBottom: '14px', cursor: 'pointer' }}
              >🔄 Aplicar {pendingRulesCount} movimiento(s) pendiente(s)</button>
            )}
            <div style={{ maxHeight: '280px', overflowY: 'auto', marginBottom: '16px' }}>
              {(userAliases || []).length === 0 ? (
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
                    {(userAliases || []).map(a => (
                      <tr key={a.id} style={{ borderBottom: `1px solid ${darkMode ? '#3A333A' : '#EDE8EC'}` }}>
                        <td style={{ padding: '8px', fontFamily: 'monospace', color: txt, fontWeight: '600', fontSize: '12px' }}>{a.alias}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{ backgroundColor: a.tipo === 'hijo' ? (darkMode ? '#1B3A1B' : '#E8F5E9') : a.tipo === 'cuenta' ? (darkMode ? '#1A2D3A' : '#E3F2FD') : a.tipo === 'neutro' ? (darkMode ? '#3A2E1B' : '#FFF3E0') : (darkMode ? '#2D1F2D' : '#F3E5F5'), color: p, padding: '2px 8px', borderRadius: '6px', fontSize: '11px' }}>{a.tipo}</span>
                        </td>
                        <td style={{ padding: '8px', color: '#6e6e73', fontSize: '13px' }}>{a.valor}{a.descripcion ? ` · ${a.descripcion}` : ''}</td>
                        <td style={{ padding: '8px' }}>
                          <button style={s.actionBtn} onClick={() => handleDeleteAlias(a.id)}>🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <form onSubmit={handleAddAlias} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : (newAlias.tipo === 'categoria' ? '1fr 90px 1fr 1fr auto' : '1fr 100px 1fr auto'), gap: '8px', alignItems: 'end', marginBottom: '20px' }}>
              <div>
                <label style={s.label}>Palabra clave</label>
                <input style={s.input} placeholder="ej. OSDE, DISCO, UBER" value={newAlias.alias} onChange={e => setNewAlias({...newAlias, alias: e.target.value})} />
              </div>
              <div>
                <label style={s.label}>Tipo</label>
                <select style={s.input} value={newAlias.tipo} onChange={e => setNewAlias({...newAlias, tipo: e.target.value, valor: '', subcategoria: ''})}>
                  <option value="categoria">Cat.</option>
                  <option value="hijo">Hijo/a</option>
                  <option value="cuenta">Cuenta</option>
                  <option value="neutro">Neutro</option>
                </select>
              </div>
              {newAlias.tipo === 'neutro' ? (
                <div>
                  <label style={s.label}>Descripción (opcional)</label>
                  <input style={s.input} placeholder="ej. Pago tarjeta Mercado Pago" value={newAlias.descripcion} onChange={e => setNewAlias({...newAlias, descripcion: e.target.value})} />
                </div>
              ) : newAlias.tipo === 'categoria' ? (
                <>
                  <div>
                    <label style={s.label}>Categoría</label>
                    <select style={s.input} value={newAlias.valor} onChange={e => setNewAlias({...newAlias, valor: e.target.value, subcategoria: ''})}>
                      <option value="">— Elegir —</option>
                      {categoriasDB.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={s.label}>Subcategoría</label>
                    <select style={s.input} value={newAlias.subcategoria} disabled={!newAlias.valor} onChange={e => setNewAlias({...newAlias, subcategoria: e.target.value})}>
                      <option value="">— Ninguna —</option>
                      {subcategoriasDB
                        .filter(sc => sc.category_id === categoriasDB.find(c => c.nombre === newAlias.valor)?.id)
                        .map(sc => <option key={sc.id} value={sc.nombre}>{sc.nombre}</option>)}
                    </select>
                  </div>
                </>
              ) : newAlias.tipo === 'hijo' ? (
                <div>
                  <label style={s.label}>Hijo/a</label>
                  <select style={s.input} value={newAlias.valor} onChange={e => setNewAlias({...newAlias, valor: e.target.value})}>
                    <option value="">— Elegir —</option>
                    {childrenDB.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label style={s.label}>Nombre de la cuenta</label>
                  <input style={s.input} placeholder="ej. Tarjeta Visa" value={newAlias.valor} onChange={e => setNewAlias({...newAlias, valor: e.target.value})} />
                </div>
              )}
              <button type="submit" style={{ ...s.saveBtn, padding: '11px 18px', marginTop: isMobile ? '0' : '20px' }}>+</button>
            </form>
            <div style={{ textAlign: 'right' }}>
              <button style={s.cancelBtn} onClick={() => setShowAliases(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cambiar contraseña */}
      {showCambiarClave && (
        <div style={s.overlay}>
          <div style={{ ...s.modal, maxWidth: '380px' }}>
            <h3 style={s.modalTitle}>🔑 Cambiar contraseña</h3>
            <form onSubmit={handleCambiarClave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={s.label}>Nueva contraseña</label>
                <input
                  type="password"
                  style={s.input}
                  placeholder="Mínimo 6 caracteres"
                  value={nuevaClave}
                  onChange={e => setNuevaClave(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={s.label}>Confirmar contraseña</label>
                <input
                  type="password"
                  style={s.input}
                  placeholder="Repetí la contraseña"
                  value={confirmarClave}
                  onChange={e => setConfirmarClave(e.target.value)}
                  required
                />
              </div>
              {claveMsg && (
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: claveMsg.tipo === 'ok' ? '#3a7d44' : '#c0392b' }}>
                  {claveMsg.texto}
                </p>
              )}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button type="button" style={s.cancelBtn} onClick={() => setShowCambiarClave(false)}>Cancelar</button>
                <button type="submit" style={s.saveBtn}>Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
})

export default ConfigPanel
