import React, { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, UserRoundCheck, UsersRound } from 'lucide-react'
import { api } from './api.js'
import { longDate } from './format.js'
import './assembly-panel.css'

const responseLabel = value => ({ present: 'Je serai présent', absent: 'Je serai absent', proxy: 'Je donne procuration' }[value] || 'Répondre')

export default function AssemblyPanel({ buildingSlug, readOnly = false, setToast }) {
  const [state, setState] = useState({ status: 'loading', assemblies: [], error: '' })
  const [proxyFor, setProxyFor] = useState(null)
  const [proxyName, setProxyName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setState(current => ({ ...current, status: current.assemblies.length ? 'refreshing' : 'loading', error: '' }))
    try {
      const data = await api.listAssemblies(buildingSlug)
      setState({ status: 'ready', assemblies: data.assemblies || [], error: '' })
    } catch (error) {
      setState({ status: 'error', assemblies: [], error: error.message || 'Impossible de charger les assemblées.' })
    }
  }

  useEffect(() => { load() }, [buildingSlug])

  const upcoming = useMemo(() => [...state.assemblies].sort((a, b) => String(a.assemblyDate).localeCompare(String(b.assemblyDate))), [state.assemblies])

  const respond = async (assembly, responseType, name = '') => {
    if (readOnly) return setToast?.('Mode prévisualisation : aucune réponse ne sera enregistrée.')
    setBusy(true)
    try {
      await api.respondToAssembly(buildingSlug, { assemblyId: assembly.id, responseType, proxyName: name })
      setProxyFor(null); setProxyName('')
      setToast?.('Votre réponse à l’assemblée est enregistrée.')
      await load()
    } catch (error) {
      setToast?.(error.message || 'Impossible d’enregistrer votre réponse.')
    } finally { setBusy(false) }
  }

  if (state.status === 'loading') return <div className="ag-empty"><CalendarDays /><strong>Chargement des assemblées…</strong></div>
  if (state.status === 'error') return <div className="ag-empty"><CalendarDays /><strong>Assemblées indisponibles</strong><span>{state.error}</span><button onClick={load}>Réessayer</button></div>
  if (!upcoming.length) return <div className="ag-empty"><CheckCircle2 /><strong>Aucune assemblée programmée</strong><span>La prochaine convocation apparaîtra ici dès sa publication par le syndic.</span></div>

  return <div className="ag-list">{upcoming.map(assembly => (
    <article className="ag-card" key={assembly.id}>
      <div className="ag-card-head">
        <div className="ag-date"><CalendarDays /><span>{longDate(assembly.assemblyDate)}</span>{assembly.assemblyTime && <em>{assembly.assemblyTime}</em>}</div>
        {assembly.myResponse && <span className="ag-status"><CheckCircle2 /> {responseLabel(assembly.myResponse.responseType)}</span>}
      </div>
      <h3>{assembly.title}</h3>
      {assembly.location && <p className="ag-location">{assembly.location}</p>}
      {assembly.description && <p>{assembly.description}</p>}

      <div className="ag-summary">
        <span><UsersRound /> {assembly.summary.responses} réponse{assembly.summary.responses > 1 ? 's' : ''}</span>
        <span><UserRoundCheck /> {assembly.summary.present} présent{assembly.summary.present > 1 ? 's' : ''}</span>
        <span><ClipboardCheck /> {assembly.summary.proxy} procuration{assembly.summary.proxy > 1 ? 's' : ''}</span>
      </div>

      {assembly.agenda?.length > 0 && <details className="ag-agenda"><summary>Ordre du jour <ChevronRight /></summary><ol>{assembly.agenda.map(item => <li key={item.id}><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</li>)}</ol></details>}

      <div className="ag-actions">
        <button disabled={busy} className={assembly.myResponse?.responseType === 'present' ? 'active' : ''} onClick={() => respond(assembly, 'present')}>Présent</button>
        <button disabled={busy} className={assembly.myResponse?.responseType === 'absent' ? 'active' : ''} onClick={() => respond(assembly, 'absent')}>Absent</button>
        <button disabled={busy} className={assembly.myResponse?.responseType === 'proxy' ? 'active' : ''} onClick={() => { setProxyFor(assembly.id); setProxyName(assembly.myResponse?.proxyName || '') }}>Donner procuration</button>
      </div>

      {proxyFor === assembly.id && <div className="ag-proxy"><label>Nom du mandataire<input value={proxyName} onChange={event => setProxyName(event.target.value)} placeholder="Nom et prénom" /></label><div><button onClick={() => setProxyFor(null)}>Annuler</button><button className="primary" disabled={busy || !proxyName.trim()} onClick={() => respond(assembly, 'proxy', proxyName.trim())}>Enregistrer la procuration</button></div></div>}
    </article>
  ))}</div>
}
