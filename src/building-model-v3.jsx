import React, { useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, DoorOpen, Plus, ShieldCheck, Trash2, UserCog, Users, Wrench } from 'lucide-react'
import { apiV3 } from './api-v3.js'
import { ErrorPanel, Spinner } from './views.jsx'
import PersonAccessControl from './person-access-control.jsx'
import './building-model-v3.css'

const relationLabel = value => ({ owner: 'Copropriétaire', occupant: 'Occupant', tenant: 'Locataire' }[value] || value)

export default function BuildingModelV3View({ buildingSlug, onBack, setToast }) {
  const [state, setState] = useState({ status: 'loading', data: null, access: [], error: null })
  const [personDraft, setPersonDraft] = useState({ fullName: '', email: '', phone: '' })
  const [unitDraft, setUnitDraft] = useState({ label: '', floor: '', shareLabel: '' })
  const [relationDraft, setRelationDraft] = useState({ personId: '', unitId: '', relationType: 'owner', shareLabel: '' })
  const [referentPersonId, setReferentPersonId] = useState('')
  const [professionalDraft, setProfessionalDraft] = useState({ professionalType: 'syndic', organizationName: '', contactName: '', email: '', phone: '' })

  const load = async () => {
    setState(current => ({ ...current, status: current.data ? 'refreshing' : 'loading', error: null }))
    try {
      const [data, accessData] = await Promise.all([apiV3.model(buildingSlug), apiV3.accessStates(buildingSlug)])
      setState({ status: 'ready', data, access: accessData.access || [], error: null })
    } catch (error) {
      setState({ status: 'error', data: null, access: [], error: error.message })
    }
  }

  useEffect(() => { load() }, [buildingSlug])

  const model = state.data
  const visibilityByPerson = useMemo(() => new Map((model?.visibility || []).map(item => [item.personId, item])), [model])
  const accessByPerson = useMemo(() => new Map((state.access || []).map(item => [item.personId, item.state])), [state.access])

  const mutate = async action => {
    try {
      await action()
      await load()
      setToast?.('Modèle V3 enregistré dans la base de test.')
    } catch (error) {
      setToast?.(error.message)
      throw error
    }
  }

  const saveEmail = async (person, email) => {
    await apiV3.update(buildingSlug, 'person', person.id, { email })
    await load()
    setToast?.('Adresse e-mail enregistrée.')
  }

  const invite = async person => {
    const result = await apiV3.invitePerson(buildingSlug, person.id)
    await load()
    setToast?.(result.message || 'Accès CoproLink préparé.')
  }

  if (!buildingSlug) return <ErrorPanel title="Aucun immeuble" message="Sélectionnez un immeuble." />
  if (state.status === 'loading') return <Spinner label="Chargement du modèle V3…" />
  if (state.status === 'error') return <ErrorPanel title="Modèle V3 indisponible" message={state.error} onRetry={load} />

  return (
    <main className="m3-shell">
      <header className="m3-head">
        <div><span>MODÈLE PERSISTANT V3</span><h1>Structure réelle de la copropriété</h1><p>Lots, personnes, relations, référents et professionnels sont enregistrés en base.</p></div>
        <button onClick={onBack}>Retour à l’immeuble</button>
      </header>

      <section className="m3-banner"><ShieldCheck /><div><strong>Environnement de validation</strong><span>Une personne peut exister sans compte. Ajoutez son e-mail puis invitez-la sur CoproLink quand vous le souhaitez.</span></div></section>

      <section className="m3-stats">
        <article><DoorOpen /><strong>{model.units.length}</strong><span>lots</span></article>
        <article><Users /><strong>{model.people.length}</strong><span>personnes</span></article>
        <article><UserCog /><strong>{model.referents.length}</strong><span>référents</span></article>
        <article><Wrench /><strong>{model.professionals.filter(p => p.isActive).length}</strong><span>professionnels actifs</span></article>
      </section>

      <div className="m3-grid">
        <section className="m3-card">
          <div className="m3-title"><DoorOpen /><div><span>LOTS</span><h2>Lots de l’immeuble</h2></div></div>
          <form onSubmit={event => { event.preventDefault(); if (!unitDraft.label.trim()) return; mutate(async () => { await apiV3.create(buildingSlug, 'unit', unitDraft); setUnitDraft({ label: '', floor: '', shareLabel: '' }) }) }}>
            <input placeholder="Lot (ex. 4A)" value={unitDraft.label} onChange={e => setUnitDraft(v => ({ ...v, label: e.target.value }))} required />
            <input placeholder="Étage" value={unitDraft.floor} onChange={e => setUnitDraft(v => ({ ...v, floor: e.target.value }))} />
            <input placeholder="Quotité" value={unitDraft.shareLabel} onChange={e => setUnitDraft(v => ({ ...v, shareLabel: e.target.value }))} />
            <button><Plus /> Ajouter</button>
          </form>
          <div className="m3-list">{model.units.map(unit => <div key={unit.id}><div><strong>{unit.label}</strong><span>{unit.floor ? `Étage ${unit.floor}` : 'Étage non renseigné'}{unit.shareLabel ? ` · ${unit.shareLabel}` : ''}</span></div><button onClick={() => mutate(() => apiV3.remove(buildingSlug, 'unit', unit.id))}><Trash2 /></button></div>)}</div>
        </section>

        <section className="m3-card">
          <div className="m3-title"><Users /><div><span>PERSONNES</span><h2>Personnes liées</h2></div></div>
          <form onSubmit={event => { event.preventDefault(); if (!personDraft.fullName.trim()) return; mutate(async () => { await apiV3.create(buildingSlug, 'person', personDraft); setPersonDraft({ fullName: '', email: '', phone: '' }) }) }}>
            <input placeholder="Nom et prénom" value={personDraft.fullName} onChange={e => setPersonDraft(v => ({ ...v, fullName: e.target.value }))} required />
            <input placeholder="E-mail (optionnel)" type="email" value={personDraft.email} onChange={e => setPersonDraft(v => ({ ...v, email: e.target.value }))} />
            <input placeholder="Téléphone" value={personDraft.phone} onChange={e => setPersonDraft(v => ({ ...v, phone: e.target.value }))} />
            <button><Plus /> Ajouter</button>
          </form>
          <div className="m3-list">{model.people.map(person => {
            const vis = visibilityByPerson.get(person.id)
            const access = accessByPerson.get(person.id) || 'none'
            return <div key={person.id} className="m3-person-row"><div className="m3-person-copy"><strong>{person.fullName}</strong><span>Annuaire {vis?.directoryVisible === false ? 'masqué' : 'visible'}</span><PersonAccessControl person={person} access={access} onSaveEmail={email => saveEmail(person, email)} onInvite={() => invite(person)} /></div><button onClick={() => mutate(() => apiV3.remove(buildingSlug, 'person', person.id))}><Trash2 /></button></div>
          })}</div>
        </section>

        <section className="m3-card">
          <div className="m3-title"><Building2 /><div><span>RELATIONS</span><h2>Qui est lié à quel lot ?</h2></div></div>
          <form onSubmit={event => { event.preventDefault(); if (!relationDraft.personId || !relationDraft.unitId) return; mutate(async () => { await apiV3.create(buildingSlug, 'relation', { ...relationDraft, personId: Number(relationDraft.personId), unitId: Number(relationDraft.unitId) }); setRelationDraft(v => ({ ...v, shareLabel: '' })) }) }}>
            <select value={relationDraft.personId} onChange={e => setRelationDraft(v => ({ ...v, personId: e.target.value }))} required><option value="">Personne…</option>{model.people.map(person => <option value={person.id} key={person.id}>{person.fullName}</option>)}</select>
            <select value={relationDraft.unitId} onChange={e => setRelationDraft(v => ({ ...v, unitId: e.target.value }))} required><option value="">Lot…</option>{model.units.map(unit => <option value={unit.id} key={unit.id}>{unit.label}</option>)}</select>
            <select value={relationDraft.relationType} onChange={e => setRelationDraft(v => ({ ...v, relationType: e.target.value }))}><option value="owner">Copropriétaire</option><option value="occupant">Occupant</option><option value="tenant">Locataire</option></select>
            <input placeholder="Quotité éventuelle" value={relationDraft.shareLabel} onChange={e => setRelationDraft(v => ({ ...v, shareLabel: e.target.value }))} />
            <button><Plus /> Lier</button>
          </form>
          <div className="m3-list">{model.relations.map(rel => { const person = model.people.find(p => p.id === rel.personId); const unit = model.units.find(u => u.id === rel.unitId); return <div key={rel.id}><div><strong>{person?.fullName || 'Personne'} → {unit?.label || 'Lot'}</strong><span>{relationLabel(rel.relationType)}{rel.shareLabel ? ` · ${rel.shareLabel}` : ''}{rel.endDate ? ' · historique' : ''}</span></div><button onClick={() => mutate(() => apiV3.remove(buildingSlug, 'relation', rel.id))}><Trash2 /></button></div> })}</div>
        </section>

        <section className="m3-card">
          <div className="m3-title"><UserCog /><div><span>RÉFÉRENTS</span><h2>Gouvernance CoproLink</h2></div></div>
          <form onSubmit={event => { event.preventDefault(); if (!referentPersonId) return; mutate(async () => { await apiV3.create(buildingSlug, 'referent', { personId: Number(referentPersonId) }); setReferentPersonId('') }) }}>
            <select value={referentPersonId} onChange={e => setReferentPersonId(e.target.value)} required><option value="">Choisir une personne…</option>{model.people.map(person => <option value={person.id} key={person.id}>{person.fullName}</option>)}</select>
            <button><Plus /> Désigner</button>
          </form>
          <div className="m3-list">{model.referents.map(ref => { const person = model.people.find(p => p.id === ref.personId); return <div key={ref.id}><div><strong>{person?.fullName || 'Personne'}</strong><span>{ref.isPrimary ? 'Référent principal' : 'Référent CoproLink'}</span></div><button onClick={() => mutate(() => apiV3.remove(buildingSlug, 'referent', ref.id))}><Trash2 /></button></div> })}</div>
        </section>

        <section className="m3-card m3-wide">
          <div className="m3-title"><Wrench /><div><span>PROFESSIONNELS</span><h2>Syndic et intervenants</h2></div></div>
          <form onSubmit={event => { event.preventDefault(); if (!professionalDraft.organizationName.trim() && !professionalDraft.contactName.trim()) return; mutate(async () => { await apiV3.create(buildingSlug, 'professional', professionalDraft); setProfessionalDraft({ professionalType: 'syndic', organizationName: '', contactName: '', email: '', phone: '' }) }) }}>
            <select value={professionalDraft.professionalType} onChange={e => setProfessionalDraft(v => ({ ...v, professionalType: e.target.value }))}><option value="syndic">Syndic</option><option value="provider">Prestataire</option><option value="insurance">Assurance</option><option value="maintenance">Maintenance</option><option value="other">Autre</option></select>
            <input placeholder="Organisation" value={professionalDraft.organizationName} onChange={e => setProfessionalDraft(v => ({ ...v, organizationName: e.target.value }))} />
            <input placeholder="Contact" value={professionalDraft.contactName} onChange={e => setProfessionalDraft(v => ({ ...v, contactName: e.target.value }))} />
            <input placeholder="E-mail" value={professionalDraft.email} onChange={e => setProfessionalDraft(v => ({ ...v, email: e.target.value }))} />
            <input placeholder="Téléphone" value={professionalDraft.phone} onChange={e => setProfessionalDraft(v => ({ ...v, phone: e.target.value }))} />
            <button><Plus /> Ajouter</button>
          </form>
          <div className="m3-list">{model.professionals.map(pro => <div key={pro.id}><div><strong>{pro.organizationName || pro.contactName || pro.professionalType}</strong><span>{pro.professionalType} · {pro.isActive ? 'actif' : 'inactif'}</span></div>{pro.isActive ? <button onClick={() => mutate(() => apiV3.remove(buildingSlug, 'professional', pro.id))}><Trash2 /></button> : <CheckCircle2 />}</div>)}</div>
        </section>
      </div>
    </main>
  )
}
