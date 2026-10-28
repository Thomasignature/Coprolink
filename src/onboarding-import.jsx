import React, { useMemo, useState } from 'react'
import { FileUp, Info, Upload, X } from 'lucide-react'
import { apiV3 } from './api-v3.js'
import './onboarding-import.css'

import { parseCsv } from './import-csv.js'

export default function OnboardingImport({ buildingSlug, onClose, onImported }) {
  const [text, setText] = useState('Lot;Étage;Nom;E-mail;Rôle;Quotité\n12A;12;Jean Exemple;jean@example.be;Copropriétaire occupant;25/1000\n12B;12;Marie Exemple;marie@example.be;Locataire;')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const parsed = useMemo(() => {
    try { return { rows: parseCsv(text), error: '' } }
    catch (err) { return { rows: [], error: err.message } }
  }, [text])
  const rows = parsed.rows

  const submit = async event => {
    event.preventDefault()
    if (!rows.length || busy) return
    setBusy(true); setError(''); setResult(null)
    try {
      const imported = await apiV3.bulkImport(buildingSlug, rows)
      setResult(imported)
      await onImported?.()
    } catch (err) {
      setError(err?.message || 'Import impossible')
    } finally { setBusy(false) }
  }

  return <div className="obi-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <form className="obi-modal" onSubmit={submit}>
      <div className="obi-head"><div><span>ONBOARDING SYNDIC</span><h2>Importer les lots et occupants</h2><p>Collez un CSV ou un export Excel enregistré en CSV. Aucune invitation n’est envoyée automatiquement.</p></div><button type="button" onClick={onClose} aria-label="Fermer"><X /></button></div>
      <div className="obi-note"><Info /><span>Colonnes attendues : <strong>Lot ; Étage ; Nom ; E-mail ; Rôle ; Quotité</strong>. Rôles reconnus : copropriétaire, copropriétaire occupant, locataire, occupant.</span></div>
      <textarea className="obi-textarea" value={text} disabled={busy} onChange={e => { setText(e.target.value); setResult(null); setError('') }} spellCheck={false} />
      <div className="obi-preview"><strong>{rows.length} ligne{rows.length > 1 ? 's' : ''} détectée{rows.length > 1 ? 's' : ''}</strong>{rows.slice(0, 5).map(row => <div key={`${row.sourceRow}-${row.unitLabel}-${row.fullName}`}><span>{row.unitLabel}</span><span>{row.floor || '—'}</span><span>{row.fullName || 'Nom manquant'}</span><span>{row.email || 'sans e-mail'}</span></div>)}{rows.length > 5 && <small>+ {rows.length - 5} autres lignes</small>}</div>
      {(error || parsed.error) && <div className="obi-error" role="alert">{error || parsed.error}</div>}
      {result?.errors?.length > 0 && <div className="obi-error" role="alert">{result.errors.map((item, index) => <p key={index}>Ligne {item.row} : {item.message}</p>)}</div>}
      {result && <div className="obi-result"><Upload /><div><strong>{result.skipped ? 'Import terminé avec des lignes ignorées' : 'Import terminé'}</strong><span>{result.peopleCreated} personne(s), {result.unitsCreated} lot(s), {result.relationsCreated} lien(s) créés{result.skipped ? ` · ${result.skipped} ligne(s) ignorée(s)` : ''}.</span></div></div>}
      <div className="obi-actions"><button type="button" onClick={onClose}>Fermer</button><button className="obi-primary" disabled={busy || !rows.length}><FileUp /> {busy ? 'Import en cours…' : `Importer ${rows.length} ligne${rows.length > 1 ? 's' : ''}`}</button></div>
    </form>
  </div>
}
