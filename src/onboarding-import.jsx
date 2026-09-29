import React, { useMemo, useState } from 'react'
import { FileUp, Info, Upload, X } from 'lucide-react'
import { apiV3 } from './api-v3.js'
import './onboarding-import.css'

const normalizeRole = value => {
  const raw = String(value || '').trim().toLowerCase()
  if (['copropriétaire', 'proprietaire', 'propriétaire', 'owner'].includes(raw)) return 'owner'
  if (['copropriétaire occupant', 'propriétaire occupant', 'owner occupant', 'owner_occupant'].includes(raw)) return 'owner_occupant'
  if (['locataire', 'tenant'].includes(raw)) return 'tenant'
  return 'occupant'
}

const splitLine = line => {
  const delimiter = line.includes(';') ? ';' : ','
  return line.split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, ''))
}

const parseCsv = text => {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const first = splitLine(lines[0]).map(value => value.toLowerCase())
  const hasHeader = first.some(value => /lot|nom|name|email|étage|etage|rôle|role/.test(value))
  const start = hasHeader ? 1 : 0
  return lines.slice(start).map((line, index) => {
    const cells = splitLine(line)
    return {
      sourceRow: index + start + 1,
      unitLabel: cells[0] || '',
      floor: cells[1] || '',
      fullName: cells[2] || '',
      email: cells[3] || '',
      relationPreset: normalizeRole(cells[4]),
      shareLabel: cells[5] || '',
    }
  }).filter(row => row.unitLabel || row.fullName)
}

export default function OnboardingImport({ buildingSlug, onClose, onImported }) {
  const [text, setText] = useState('Lot;Étage;Nom;E-mail;Rôle;Quotité\n12A;12;Jean Exemple;jean@example.be;Copropriétaire occupant;25/1000\n12B;12;Marie Exemple;marie@example.be;Locataire;')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const rows = useMemo(() => parseCsv(text), [text])

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
      <textarea className="obi-textarea" value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
      <div className="obi-preview"><strong>{rows.length} ligne{rows.length > 1 ? 's' : ''} détectée{rows.length > 1 ? 's' : ''}</strong>{rows.slice(0, 5).map(row => <div key={`${row.sourceRow}-${row.unitLabel}-${row.fullName}`}><span>{row.unitLabel}</span><span>{row.floor || '—'}</span><span>{row.fullName || 'Nom manquant'}</span><span>{row.email || 'sans e-mail'}</span></div>)}{rows.length > 5 && <small>+ {rows.length - 5} autres lignes</small>}</div>
      {error && <div className="obi-error">{error}</div>}
      {result && <div className="obi-result"><Upload /><div><strong>Import terminé</strong><span>{result.peopleCreated} personne(s), {result.unitsCreated} lot(s), {result.relationsCreated} lien(s) créés{result.skipped ? ` · ${result.skipped} ligne(s) ignorée(s)` : ''}.</span></div></div>}
      <div className="obi-actions"><button type="button" onClick={onClose}>Fermer</button><button className="obi-primary" disabled={busy || !rows.length}><FileUp /> {busy ? 'Import en cours…' : `Importer ${rows.length} ligne${rows.length > 1 ? 's' : ''}`}</button></div>
    </form>
  </div>
}
