import React, { useEffect, useState } from 'react'
import { Mail, UserPlus, X } from 'lucide-react'
import './person-access-control.css'

const labelFor = state => ({ active: 'Accès actif', pending: 'Invitation en attente', none: 'Sans accès' }[state] || 'Sans accès')

export default function PersonAccessControl({ person, access = 'none', onSaveEmail, onInvite, compact = false, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState(person.email || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => setEmail(person.email || ''), [person.email])
  const changed = email.trim().toLowerCase() !== (person.email || '').trim().toLowerCase()
  const replacesAccess = changed && access !== 'none'

  const save = async () => {
    const value = email.trim().toLowerCase()
    if (value.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Adresse e-mail invalide')
      return
    }
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await onSaveEmail(value)
      setMessage(result?.message || 'Adresse enregistrée.')
      setEditing(false)
    } catch (err) {
      if (err?.emailCorrected) setEditing(false)
      setError(err?.message || 'Impossible d’enregistrer l’e-mail')
    } finally { setBusy(false) }
  }

  const invite = async () => {
    setBusy(true); setError(''); setMessage('')
    try { const result = await onInvite(); setMessage(result?.message || 'Invitation préparée.') }
    catch (err) { setError(err?.message || 'Impossible d’envoyer l’invitation') }
    finally { setBusy(false) }
  }

  return (
    <div className={`pac ${compact ? 'pac-compact' : ''}`}>
      <span className={`pac-state pac-${access}`}>{labelFor(access)}</span>
      {readOnly ? (
        <span className="pac-email pac-muted"><Mail /> {person.email || 'E-mail non renseigné'}</span>
      ) : editing ? (
        <div className="pac-editor">
          <Mail />
          <input value={email} onChange={e => setEmail(e.target.value)} disabled={busy} type="email" aria-label={`Adresse e-mail de ${person.fullName}`} placeholder="nom@exemple.be" autoFocus />
          <button type="button" className="pac-save" onClick={save} disabled={busy}>{busy ? 'Enregistrement…' : replacesAccess ? 'Corriger et réinviter' : 'Enregistrer'}</button>
          <button type="button" onClick={() => { setEditing(false); setEmail(person.email || ''); setError('') }} disabled={busy} title="Annuler" aria-label="Annuler la modification"><X /></button>
          {changed && person.email && <small className="pac-help">L’ancien e-mail envoyé ne peut pas être rappelé. Si cette adresse possède un accès, il sera retiré de cet immeuble et une invitation sera préparée pour la nouvelle adresse. Les liens avec les lots seront conservés.</small>}
        </div>
      ) : !person.email ? (
        <button type="button" className="pac-email" onClick={() => setEditing(true)}><Mail /> Ajouter un e-mail</button>
      ) : access === 'none' ? (
        <div className="pac-actions">
          <button type="button" className="pac-email" onClick={() => setEditing(true)}><Mail /> Modifier</button>
          <button type="button" className="pac-invite" onClick={invite} disabled={busy}><UserPlus /> {busy ? 'Envoi…' : 'Inviter sur CoproLink'}</button>
        </div>
      ) : (
        <div className="pac-actions">
          <button type="button" className="pac-email pac-muted" onClick={() => setEditing(true)}><Mail /> {person.email} · Corriger l’adresse</button>
          {access === 'pending' && <button type="button" className="pac-invite" onClick={invite} disabled={busy}><UserPlus /> {busy ? 'Envoi…' : 'Renvoyer l’invitation'}</button>}
        </div>
      )}
      {message && <small role="status" className="pac-help">{message}</small>}
      {error && <small role="alert" className="pac-error">{error}</small>}
    </div>
  )
}
