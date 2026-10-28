import React, { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, ClipboardList, Plus, RefreshCw, UsersRound } from 'lucide-react'
import { api } from './api.js'
import { longDate } from './format.js'
import './syndic-assemblies.css'

export default function SyndicAssembliesPanel({ buildingSlug, readOnly = false }) {
  const [state, setState] = useState({ status: 'loading', assemblies: [], error: '' })
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ title: 'Assemblée générale statutaire', assemblyDate: '', assemblyTime: '', location: '', description: '' })
  const [agendaDraft, setAgendaDraft] = useState({})

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

  const createAssembly = async event => {
    event.preventDefault()
    if (busy || readOnly) return
    setBusy(true)
    try {
      await api.createAssembly(buildingSlug, form)
      setForm({ title: 'Assemblée générale statutaire', assemblyDate: '', assemblyTime: '', location: '', description: '' })
      setShowCreate(false)
      await load()
    } finally { setBusy(false) }
  }

  const addAgenda = async (assemblyId) => {
    const draft = agendaDraft[assemblyId] || { title: '', description: '' }
    if (!draft.title?.trim() || busy || readOnly) return
    setBusy(true)
    try {
      const assembly = state.assemblies.find(item => item.id === assemblyId)
      await api.addAssemblyAgendaItem(buildingSlug, {
        assemblyId,
        position: (assembly?.agenda?.length || 0) + 1,
        title: draft.title.trim(),
        description: draft.description?.trim() || '',
      })
      setAgendaDraft(current => ({ ...current, [assemblyId]: { title: '', description: '' } }))
      await load()
    } finally { setBusy(false) }
  }

  if (state.status === 'loading') return <div className="sam-empty"><CalendarDays /><strong>Chargement des assemblées…</strong></div>
  if (state.status === 'error') return <div className="sam-empty"><CalendarDays /><strong>Assemblées indisponibles</strong><span>{state.error}</span><button onClick={load}><RefreshCw /> Réessayer</button></div>

  return <div className="sam-wrap">
    <div className="sam-head"><div><span>ASSEMBLÉES GÉNÉRALES</span><h2>Préparer, mobiliser et suivre</h2><p>Créez l’AG, ajoutez l’ordre du jour et suivez les premières réponses des copropriétaires.</p></div>{!readOnly && <button className="sam-primary" onClick={() => setShowCreate(value => !value)}><Plus /> Nouvelle AG</button>}</div>

    {showCreate && !readOnly && <form className="sam-form" onSubmit={createAssembly}>
      <label>Titre<input required value={form.title} onChange={e => setForm(v => ({ ...v, title: e.target.value }))} /></label>
      <div className="sam-row"><label>Date<input required type="date" value={form.assemblyDate} onChange={e => setForm(v => ({ ...v, assemblyDate: e.target.value }))} /></label><label>Heure<input type="time" value={form.assemblyTime} onChange={e => setForm(v => ({ ...v, assemblyTime: e.target.value }))} /></label></div>
      <label>Lieu<input value={form.location} onChange={e => setForm(v => ({ ...v, location: e.target.value }))} placeholder="Salle, adresse ou visioconférence" /></label>
      <label>Message / contexte<textarea value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))} placeholder="Informations utiles pour les copropriétaires" /></label>
      <div className="sam-actions"><button type="button" onClick={() => setShowCreate(false)}>Annuler</button><button className="sam-primary" disabled={busy}>{busy ? 'Création…' : 'Créer l’assemblée'}</button></div>
    </form>}

    {state.assemblies.length === 0 ? <div className="sam-empty"><CheckCircle2 /><strong>Aucune assemblée programmée</strong><span>Créez la première AG pour activer le suivi de présence et des procurations.</span></div> : <div className="sam-list">{state.assemblies.map(assembly => (
      <article className="sam-card" key={assembly.id}>
        <div className="sam-card-head"><div><span>{longDate(assembly.assemblyDate)}{assembly.assemblyTime ? ` · ${assembly.assemblyTime}` : ''}</span><h3>{assembly.title}</h3><p>{assembly.location || 'Lieu à compléter'}</p></div><div className="sam-count"><UsersRound /><strong>{assembly.summary.responses}</strong><span>réponses</span></div></div>
        <div className="sam-metrics"><span>{assembly.summary.present} présent{assembly.summary.present > 1 ? 's' : ''}</span><span>{assembly.summary.proxy} procuration{assembly.summary.proxy > 1 ? 's' : ''}</span><span>{assembly.summary.absent} absent{assembly.summary.absent > 1 ? 's' : ''}</span></div>
        <section className="sam-agenda"><div><ClipboardList /><strong>Ordre du jour</strong></div>{assembly.agenda?.length ? <ol>{assembly.agenda.map(item => <li key={item.id}><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</li>)}</ol> : <p>Aucun point ajouté.</p>}
          {!readOnly && <div className="sam-agenda-add"><input value={agendaDraft[assembly.id]?.title || ''} onChange={e => setAgendaDraft(current => ({ ...current, [assembly.id]: { ...(current[assembly.id] || {}), title: e.target.value } }))} placeholder="Ajouter un point à l’ordre du jour" /><textarea value={agendaDraft[assembly.id]?.description || ''} onChange={e => setAgendaDraft(current => ({ ...current, [assembly.id]: { ...(current[assembly.id] || {}), description: e.target.value } }))} placeholder="Description optionnelle" /><button disabled={busy || !(agendaDraft[assembly.id]?.title || '').trim()} onClick={() => addAgenda(assembly.id)}><Plus /> Ajouter</button></div>}
        </section>
      </article>
    ))}</div>}
  </div>
}
