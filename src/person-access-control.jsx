import React, { useEffect, useState } from 'react'
import { Check, Mail, UserPlus, X } from 'lucide-react'
import './person-access-control.css'

const labelFor = state => ({ active: 'Accès actif', pending: 'Activation en attente', prepared: 'Mail non envoyé', none: 'Sans accès' }[state] || 'Sans accès')

export default function PersonAccessControl({ person, access = 'none', onSaveEmail, onInvite, compact = false, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [email, setEmail] = useState(person.email || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => setEmail(person.email || ''), [person.email])

  const save = async () => {
    const value = email.trim().toLowerCase()
    if (!value || !value.includes('@')) {
      setError('Adresse e-mail invalide')
      return
    }
    setBusy(true); setError('')
    try {
      await onSaveEmail(value)
      setEditing(false)
    } catch (err) {
      setError(err?.message || 'Impossible d’enregistrer l’e-mail')
    } finally { setBusy(false) }
  }

  const invite = async () => {
    setBusy(true); setError(''); setNotice('')
    try { const result = await onInvite(); setNotice(result?.message || 'Demande d’envoi acceptée. Vérifiez aussi les courriers indésirables.') }
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
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="nom@exemple.be" autoFocus />
          <button type="button" onClick={save} disabled={busy} title="Enregistrer"><Check /></button>
          <button type="button" onClick={() => { setEditing(false); setEmail(person.email || ''); setError('') }} disabled={busy} title="Annuler"><X /></button>
        </div>
      ) : !person.email ? (
        <button type="button" className="pac-email" onClick={() => setEditing(true)}><Mail /> Ajouter un e-mail</button>
      ) : (
        <div className="pac-actions">
          <button type="button" className="pac-email" onClick={() => setEditing(true)}><Mail /> Modifier</button>
          <button type="button" className="pac-invite" onClick={invite} disabled={busy}><UserPlus /> {busy ? 'Envoi…' : access === 'active' ? 'Envoyer un lien d’accès' : access === 'pending' ? 'Renvoyer le lien' : 'Inviter sur CoproLink'}</button>
        </div>
      )}
      {error && <small className="pac-error">{error}</small>}
      {notice && <small role="status">{notice}</small>}
    </div>
  )
}
