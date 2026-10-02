import React, { useEffect, useRef, useState } from 'react'
import { END_REASONS, relationTypeLabel, validateRelationEnd } from './people-relations.js'

export default function EndRelationsDialog({ row, relations, today, onClose, onEnd }) {
  const dialog = useRef(null)
  const [selectedIds, setSelectedIds] = useState(row.relations.map(rel => rel.id))
  const [endDate, setEndDate] = useState(today)
  const [endReason, setEndReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = relations.filter(rel => rel.personId === row.person.id && rel.unitId === row.unit.id && !rel.endDate)
  const remaining = relations.filter(rel => rel.personId === row.person.id && !rel.endDate && !selectedIds.includes(rel.id))

  useEffect(() => {
    const trigger = document.activeElement
    dialog.current.showModal()
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus() }
  }, [])

  const requestClose = () => {
    const dirty = selectedIds.length !== row.relations.length || endDate !== today || Boolean(endReason)
    if (!dirty || window.confirm('Abandonner cette clôture ? Votre saisie sera perdue.')) onClose()
  }

  const submit = async event => {
    event.preventDefault()
    if (busy) return
    const validation = validateRelationEnd(options, selectedIds, endDate, endReason, today)
    if (validation) { setError(validation); return }
    setBusy(true); setError('')
    let completed = 0
    try {
      for (const rel of options.filter(item => selectedIds.includes(item.id))) {
        await onEnd(rel, { endDate, endReason })
        completed++
        setSelectedIds(ids => ids.filter(id => id !== rel.id))
      }
      onClose()
    } catch (err) {
      setError(`${completed ? `${completed} relation(s) clôturée(s). Les autres restent à traiter. ` : ''}${err.message || 'Impossible de clôturer la relation.'}`)
    } finally { setBusy(false) }
  }

  return <dialog ref={dialog} className="bm-end-dialog" aria-labelledby="bm-end-title" onCancel={event => { event.preventDefault(); if (!busy) requestClose() }}>
    <form onSubmit={submit}>
      <h2 id="bm-end-title">Mettre fin à la relation</h2>
      <p><strong>{row.person.fullName}</strong> · Lot {row.unit.label}</p>
      <fieldset disabled={busy}><legend>Relations à clôturer</legend>
        {options.map(rel => <label className="bm-end-option" key={rel.id}><input type="checkbox" checked={selectedIds.includes(rel.id)} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, rel.id] : ids.filter(id => id !== rel.id))} /> {relationTypeLabel(rel.relationType)}{rel.startDate ? ` · depuis le ${new Date(`${rel.startDate.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-BE')}` : ''}</label>)}
      </fieldset>
      <div className="bm-end-field"><label htmlFor="bm-end-date">Date de fin</label><input id="bm-end-date" type="date" value={endDate} max={today} required disabled={busy} onChange={event => setEndDate(event.target.value)} /></div>
      <div className="bm-end-field"><label htmlFor="bm-end-reason">Motif</label><select id="bm-end-reason" value={endReason} required disabled={busy} onChange={event => setEndReason(event.target.value)}><option value="">Choisir un motif…</option>{Object.entries(END_REASONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <p className="bm-end-impact">Les relations clôturées resteront dans l’historique. {remaining.length ? 'Une autre relation active subsiste dans cet immeuble : l’accès sera conservé.' : 'Il s’agit des dernières relations actives : l’accès résident à cet immeuble sera révoqué.'} La clôture prend effet dès l’enregistrement.</p>
      {error && <p role="alert" className="bm-end-error">{error}</p>}
      <div className="bm-form-actions"><button type="button" disabled={busy} onClick={requestClose}>Annuler</button><button type="submit" className="bm-primary" disabled={busy || !selectedIds.length}>{busy ? 'Enregistrement…' : 'Confirmer la clôture'}</button></div>
    </form>
  </dialog>
}
