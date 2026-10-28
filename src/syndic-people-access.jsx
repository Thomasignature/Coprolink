import React, { useEffect, useState } from 'react'
import { apiV3 } from './api-v3.js'
import PersonAccessControl from './person-access-control.jsx'

// Both entry points edit the same building_people record and use the same
// invitation endpoint. Identity credentials remain managed by the account owner.
export function PeopleAccessList({ model, access, onSaveEmail, onInvite }) {
  const states = new Map(access.map(item => [item.personId, item.state]))
  return <div className="terminal-list">{model.people.map(person => {
    const periods = model.relations.filter(item => item.personId === person.id)
    const active = periods.filter(item => !item.endDate)
    const historical = periods.length > 0 && active.length === 0
    const labels = [...new Set(active.map(item => model.units.find(unit => unit.id === item.unitId)?.label).filter(Boolean))]
    return <div className="terminal-row" key={person.id}>
      <div>
        <strong>{person.fullName}</strong>
        <small>{person.email || 'E-mail non renseigné'}{labels.length ? ` · ${labels.join(', ')}` : ''}{historical ? ' · Ancienne relation' : ''}</small>
        <PersonAccessControl person={person} access={states.get(person.id) || 'none'} readOnly={historical}
          onSaveEmail={email => onSaveEmail(person, email)} onInvite={() => onInvite(person)} />
      </div>
    </div>
  })}</div>
}

export default function SyndicPeopleAccess({ buildingSlug, refreshToken, onAccessChanged }) {
  const [state, setState] = useState({ model: null, access: [], error: '', loading: true })
  const load = async () => {
    const [model, access] = await Promise.all([apiV3.model(buildingSlug), apiV3.accessStates(buildingSlug)])
    setState({ model, access: access.access || [], error: '', loading: false })
  }
  useEffect(() => {
    let cancelled = false
    setState(current => ({ ...current, error: '', loading: true }))
    Promise.all([apiV3.model(buildingSlug), apiV3.accessStates(buildingSlug)])
      .then(([model, access]) => { if (!cancelled) setState({ model, access: access.access || [], error: '', loading: false }) })
      .catch(error => { if (!cancelled) setState({ model: null, access: [], error: error.message, loading: false }) })
    return () => { cancelled = true }
  }, [buildingSlug, refreshToken])
  const saveEmail = async (person, email) => {
    await apiV3.update(buildingSlug, 'person', person.id, { email })
    await load()
  }
  const invite = async person => {
    const result = await apiV3.invitePerson(buildingSlug, person.id)
    // A refresh failure must not suggest that the user should send another mail.
    try { await load(); await onAccessChanged?.() }
    catch { setState(current => ({ ...current, error: 'Demande acceptée. Actualisez la liste pour mettre à jour les accès.' })) }
    return result
  }
  return <section className="card table-card">
    <div className="card-head"><div><span className="overline">Personnes & accès</span><h3>Coordonnées et invitations</h3>
      <p className="subtle">Les mêmes personnes et les mêmes outils que dans la gestion de l’immeuble. Modifiez l’e-mail de contact, puis demandez un lien à cette adresse. L’adresse de connexion d’un compte existant reste gérée par son titulaire.</p>
    </div></div>
    {state.loading && <p role="status">Chargement des personnes…</p>}
    {state.error && <div role="alert"><p>{state.error}</p><button className="ghost-btn" onClick={() => load().catch(error => setState(current => ({ ...current, error: error.message })))}>Actualiser</button></div>}
    {state.model && <PeopleAccessList model={state.model} access={state.access} onSaveEmail={saveEmail} onInvite={invite} />}
    {state.model?.people.length === 0 && <p>Aucune personne enregistrée. Ajoutez les personnes et leurs lots dans la gestion de l’immeuble.</p>}
    <a className="ghost-btn" href={`#/portfolio?view=building&building=${encodeURIComponent(buildingSlug)}&section=people`}>Gérer les personnes et leurs lots</a>
  </section>
}
