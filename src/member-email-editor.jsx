import React, { useState } from 'react'
import { Mail } from 'lucide-react'

export default function MemberEmailEditor({ member, pending = false, disabled, onSave }) {
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState(member.email)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async event => {
    event.preventDefault()
    if (busy || disabled) return
    const value = email.trim().toLowerCase()
    if (value === member.email.toLowerCase()) { setEditing(false); return }
    if (!pending && !window.confirm(`Transférer l’accès à cet immeuble vers ${value} ? L’ancien accès sera retiré et un lien sera demandé à la nouvelle adresse. Les autres immeubles et le compte personnel restent inchangés.`)) return
    setBusy(true); setError('')
    try { await onSave(value); setEditing(false) }
    catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  if (!editing) return <button className="ghost-btn" type="button" disabled={disabled} onClick={() => { setEmail(member.email); setEditing(true) }}><Mail size={16} /> Modifier l’adresse e-mail</button>
  return <form className="inline-form" onSubmit={submit}>
    <label>E-mail de {member.fullName || member.email}<input autoFocus type="email" required maxLength={200} value={email} onChange={event => setEmail(event.target.value)} /></label>
    <p className="subtle">{pending ? 'L’adresse de l’invitation sera corrigée. Utilisez ensuite « Relancer l’invitation ».' : 'L’accès à cet immeuble sera transféré à la nouvelle adresse, avec le même rôle et les mêmes lots. Un lien sera demandé.'}</p>
    <button className="primary-btn" disabled={busy || disabled}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
    <button className="ghost-btn" type="button" disabled={busy} onClick={() => { setEditing(false); setError('') }}>Annuler</button>
    {error && <small role="alert">{error}</small>}
  </form>
}
