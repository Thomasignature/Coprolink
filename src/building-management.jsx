import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Building2, CalendarDays, Check, ChevronRight, CircleUserRound, DoorOpen,
  FileText, KeyRound, LayoutDashboard, LogOut, Plus, Search, Settings, ShieldCheck,
  Sparkles, UserCog, Users, Wrench,
} from 'lucide-react'
import { api } from './api.js'
import { apiV3 } from './api-v3.js'
import { ErrorPanel, Logo, Spinner } from './views.jsx'
import PersonAccessControl from './person-access-control.jsx'
import './building-management.css'

const RELATION_PRESETS = {
  owner: { relations: ['owner'], label: 'Copropriétaire' },
  occupant: { relations: ['occupant'], label: 'Occupant' },
  tenant: { relations: ['tenant'], label: 'Locataire' },
  owner_occupant: { relations: ['owner', 'occupant'], label: 'Copropriétaire + occupant' },
}

const clean = value => String(value ?? '').trim()
const initials = name => clean(name).split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '??'
const today = () => new Date().toISOString().slice(0, 10)

const floorLabel = value => {
  const raw = clean(value)
  if (!raw) return 'Étage à renseigner'
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  if (n === -1) return 'Sous-sol'
  if (n === 0) return 'Rez-de-chaussée'
  if (n === 1) return '1er étage'
  return `${n}e étage`
}

const relationPresetFor = relations => {
  const list = [...new Set(relations || [])]
  if (list.includes('owner') && list.includes('occupant')) return 'owner_occupant'
  if (list.includes('owner')) return 'owner'
  if (list.includes('tenant')) return 'tenant'
  return 'occupant'
}

const relationLabel = relations => RELATION_PRESETS[relationPresetFor(relations)]?.label || 'Occupant'

export default function BuildingManagementView({ session, buildingSlug, onLogout }) {
  const fallback = session.memberships.find(m => m.role === 'manager')?.buildingSlug || session.memberships[0]?.buildingSlug || ''
  const slug = buildingSlug || fallback
  const membership = session.memberships.find(item => item.buildingSlug === slug)
  const isAllowed = session.user.isPlatformAdmin || membership?.role === 'manager' || membership?.isReferent === true

  const [state, setState] = useState({ status: 'loading', workspace: null, model: null, access: [], error: null })
  const [section, setSection] = useState('overview')
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [actionError, setActionError] = useState('')
  const [draft, setDraft] = useState({
    fullName: '', email: '', unitLabel: '', floor: '', relationPreset: 'owner_occupant',
    isReferent: false, directoryVisible: true, hallVisible: false,
  })

  const load = async () => {
    if (!slug || !isAllowed) return
    setState(current => ({ ...current, status: current.workspace && current.model ? 'refreshing' : 'loading', error: null }))
    try {
      const [workspace, model, accessData] = await Promise.all([
        api.workspace(slug),
        apiV3.model(slug),
        apiV3.accessStates(slug),
      ])
      setState({ status: 'ready', workspace, model, access: accessData.access || [], error: null })
    } catch (error) {
      setState({ status: 'error', workspace: null, model: null, access: [], error: error.message || 'Impossible de charger cet immeuble.' })
    }
  }

  useEffect(() => { load() }, [slug, isAllowed])

  if (!slug) return <ErrorPanel title="Aucun immeuble" message="Aucune copropriété administrable n’est associée à ce compte." />
  if (!isAllowed) return <ErrorPanel title="Accès non autorisé" message="La gestion CoproLink est réservée aux référents et gestionnaires autorisés." onRetry={() => { location.hash = '/portfolio' }} retryLabel="Retour au portefeuille" />
  if (state.status === 'loading') return <Spinner label="Chargement de l’immeuble…" />
  if (state.status === 'error') return <ErrorPanel title="Immeuble inaccessible" message={state.error} onRetry={load} />

  const workspace = state.workspace || {}
  const model = state.model || { units: [], people: [], relations: [], referents: [], professionals: [], visibility: [] }
  const building = workspace.building || { slug, name: membership?.buildingName || 'Copropriété', address: '', lots: 0 }
  const units = Array.isArray(model.units) ? model.units : []
  const people = Array.isArray(model.people) ? model.people : []
  const activeRelations = (Array.isArray(model.relations) ? model.relations : []).filter(item => !item.endDate)
  const referents = (Array.isArray(model.referents) ? model.referents : []).filter(item => !item.endedAt)
  const professionals = (Array.isArray(model.professionals) ? model.professionals : []).filter(item => item.isActive !== false && !item.endedAt)
  const visibility = Array.isArray(model.visibility) ? model.visibility : []
  const access = Array.isArray(state.access) ? state.access : []
  const openTickets = (workspace.buildingTickets || []).filter(ticket => ticket.status !== 'resolved').length
  const nextEvent = Array.isArray(workspace.events) ? workspace.events[0] : null
  const documentsCount = Array.isArray(workspace.documents) ? workspace.documents.length : 0

  const unitById = useMemo(() => new Map(units.map(unit => [unit.id, unit])), [units])
  const personById = useMemo(() => new Map(people.map(person => [person.id, person])), [people])
  const visibilityByPerson = useMemo(() => new Map(visibility.map(item => [item.personId, item])), [visibility])
  const accessByPerson = useMemo(() => new Map(access.map(item => [item.personId, item.state])), [access])
  const referentByPerson = useMemo(() => new Map(referents.map(item => [item.personId, item])), [referents])

  const personSummary = person => {
    const rels = activeRelations.filter(item => item.personId === person.id)
    const firstUnit = rels.length ? unitById.get(rels[0].unitId) : null
    return {
      ...person,
      relations: rels.map(item => item.relationType),
      unitLabel: firstUnit?.label || '',
      floor: firstUnit?.floor || '',
      isReferent: referentByPerson.has(person.id),
    }
  }

  const residents = people.map(personSummary)
  const referentPeople = residents.filter(person => person.isReferent)

  const needle = query.trim().toLocaleLowerCase('fr-BE')
  const directoryEntries = useMemo(() => {
    const rows = []
    const linked = new Set()
    for (const unit of units) {
      const grouped = new Map()
      for (const rel of activeRelations.filter(item => item.unitId === unit.id)) {
        const person = personById.get(rel.personId)
        if (!person) continue
        linked.add(person.id)
        const current = grouped.get(person.id) || { person, relations: [] }
        current.relations.push(rel)
        grouped.set(person.id, current)
      }
      for (const current of grouped.values()) {
        const types = current.relations.map(item => item.relationType)
        const haystack = `${current.person.fullName} ${current.person.email} ${unit.label} ${unit.floor} ${relationLabel(types)}`.toLocaleLowerCase('fr-BE')
        if (!needle || haystack.includes(needle)) rows.push({ key: `${unit.id}:${current.person.id}`, unit, person: current.person, relations: current.relations })
      }
    }
    for (const person of people.filter(item => !linked.has(item.id))) {
      const haystack = `${person.fullName} ${person.email}`.toLocaleLowerCase('fr-BE')
      if (!needle || haystack.includes(needle)) rows.push({ key: `unlinked:${person.id}`, unit: null, person, relations: [] })
    }
    return rows
  }, [units, activeRelations, people, personById, needle])

  const floors = useMemo(() => {
    const grouped = new Map()
    for (const row of directoryEntries) {
      const key = clean(row.unit?.floor)
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(row)
    }
    return [...grouped.entries()].sort(([a], [b]) => {
      if (!a && b) return 1
      if (a && !b) return -1
      const an = Number(a); const bn = Number(b)
      if (Number.isFinite(an) && Number.isFinite(bn)) return bn - an
      return a.localeCompare(b, 'fr-BE')
    })
  }, [directoryEntries])

  const runAction = async action => {
    setActionError('')
    try {
      const result = await action()
      await load()
      return result
    } catch (error) {
      setActionError(error.message || 'Impossible d’enregistrer la modification.')
      throw error
    }
  }

  const saveEmail = (person, email) => runAction(() => apiV3.update(slug, 'person', person.id, { email }))
  const invitePerson = person => runAction(() => apiV3.invitePerson(slug, person.id))

  const toggleReferent = async (personId, checked) => {
    const existing = referentByPerson.get(personId)
    if (checked && !existing) await runAction(() => apiV3.create(slug, 'referent', { personId }))
    if (!checked && existing) await runAction(() => apiV3.remove(slug, 'referent', existing.id))
  }

  const setRelationPreset = async (personId, unitId, presetKey) => {
    const desired = new Set((RELATION_PRESETS[presetKey] || RELATION_PRESETS.occupant).relations)
    const current = activeRelations.filter(item => item.personId === personId && item.unitId === unitId)
    await runAction(async () => {
      for (const rel of current.filter(item => !desired.has(item.relationType))) {
        await apiV3.update(slug, 'relation', rel.id, { endDate: today() })
      }
      const currentTypes = new Set(current.map(item => item.relationType))
      for (const relationType of desired) {
        if (!currentTypes.has(relationType)) await apiV3.create(slug, 'relation', { unitId, personId, relationType })
      }
    })
  }

  const addPerson = async event => {
    event.preventDefault()
    if (!clean(draft.fullName)) return
    setActionError('')
    try {
      let unit = units.find(item => clean(item.label).toLocaleLowerCase('fr-BE') === clean(draft.unitLabel).toLocaleLowerCase('fr-BE')) || null
      if (clean(draft.unitLabel) && !unit) unit = await apiV3.create(slug, 'unit', { label: clean(draft.unitLabel), floor: clean(draft.floor) })
      const person = await apiV3.create(slug, 'person', {
        fullName: clean(draft.fullName),
        email: clean(draft.email),
        directoryVisible: draft.directoryVisible,
        hallVisible: draft.hallVisible,
      })
      if (unit) {
        const preset = RELATION_PRESETS[draft.relationPreset] || RELATION_PRESETS.occupant
        for (const relationType of preset.relations) await apiV3.create(slug, 'relation', { unitId: unit.id, personId: person.id, relationType })
      }
      if (draft.isReferent) await apiV3.create(slug, 'referent', { personId: person.id })
      setDraft({ fullName: '', email: '', unitLabel: '', floor: '', relationPreset: 'owner_occupant', isReferent: false, directoryVisible: true, hallVisible: false })
      setShowAdd(false)
      await load()
    } catch (error) {
      setActionError(error.message || 'Impossible d’ajouter cette personne.')
    }
  }

  return (
    <main className="v2-shell bm-shell">
      <aside className="v2-sidebar">
        <Logo />
        <nav>
          <button onClick={() => { location.hash = '/portfolio' }}><LayoutDashboard /> Tableau de bord</button>
          <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}><Building2 /> Vue d’ensemble</button>
          <button className={section === 'directory' ? 'active' : ''} onClick={() => setSection('directory')}><Users /> Annuaire & lots</button>
          <button className={section === 'roles' ? 'active' : ''} onClick={() => setSection('roles')}><UserCog /> Référents & accès</button>
          <button onClick={() => { location.hash = `/syndic?building=${encodeURIComponent(slug)}` }}><Wrench /> Espace syndic</button>
        </nav>
        <div className="v2-sidebar-bottom">
          <button><Settings /> Paramètres</button>
          <div className="v2-user-card"><span>{initials(session.user.fullName || session.user.email)}</span><div><strong>{session.user.fullName || session.user.email}</strong><small>Administration de l’immeuble</small></div></div>
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>

      <section className="v2-main bm-main">
        <header className="bm-topbar">
          <div className="bm-title"><button onClick={() => { location.hash = '/portfolio' }} aria-label="Retour au tableau de bord"><ArrowLeft /></button><div><span>COPROPRIÉTÉ</span><h1>{building.name}</h1><p>{building.address || 'Adresse à compléter'}</p></div></div>
        </header>

        {actionError && <section className="bm-warning"><ShieldCheck /><div><strong>Modification non enregistrée</strong><span>{actionError}</span></div></section>}

        {section === 'overview' && (
          <div className="bm-content">
            <section className="bm-hero"><div><span>VUE D’ENSEMBLE</span><h2>{building.name}</h2><p>Retrouvez au même endroit les personnes, lots, échéances, documents et interventions de la copropriété.</p></div><Building2 /></section>
            <section className="bm-stats">
              <article><DoorOpen /><strong>{units.length}</strong><span>lots renseignés</span></article>
              <article><Users /><strong>{people.length}</strong><span>personnes liées</span></article>
              <article className={referentPeople.length < 2 ? 'attention' : ''}><UserCog /><strong>{referentPeople.length}</strong><span>référent{referentPeople.length > 1 ? 's' : ''} CoproLink</span></article>
              <article className={openTickets ? 'attention' : ''}><Wrench /><strong>{openTickets}</strong><span>signalements ouverts</span></article>
            </section>

            <div className="bm-grid">
              <section className="bm-card"><div className="bm-card-head"><div><span>CONTINUITÉ</span><h3>Référents CoproLink</h3></div><UserCog /></div>{referentPeople.length ? referentPeople.map(person => <div className="bm-person-row" key={person.id}><CircleUserRound /><div><strong>{person.fullName}</strong><small>{person.unitLabel || relationLabel(person.relations)}</small></div><span>Référent</span></div>) : <div className="bm-empty"><UserCog /><strong>Aucun référent désigné</strong><p>Deux référents sont recommandés pour assurer la continuité.</p><button onClick={() => setSection('roles')}>Désigner des référents</button></div>}</section>
              <section className="bm-card"><div className="bm-card-head"><div><span>ANNUAIRE</span><h3>Résidents & lots</h3></div><Users /></div><p className="bm-card-copy">{people.length} personne{people.length > 1 ? 's' : ''} et {units.length} lot{units.length > 1 ? 's' : ''} enregistrés.</p><button className="bm-primary" onClick={() => setSection('directory')}>Ouvrir l’annuaire <ChevronRight /></button></section>
              <section className="bm-card"><div className="bm-card-head"><div><span>SYNDIC / PROFESSIONNELS</span><h3>Intervenants liés</h3></div><Wrench /></div>{professionals.length ? professionals.map(item => <div className="bm-person-row" key={item.id}><Wrench /><div><strong>{item.organizationName || item.contactName || 'Professionnel'}</strong><small>{item.email || item.phone || item.professionalType}</small></div><span>{item.professionalType === 'syndic' ? 'Syndic' : 'Professionnel'}</span></div>) : <p className="bm-card-copy">Aucun professionnel enregistré.</p>}</section>
              <section className="bm-card"><div className="bm-card-head"><div><span>ÉCHÉANCES</span><h3>Prochaine date</h3></div><CalendarDays /></div>{nextEvent ? <div className="bm-next"><strong>{nextEvent.title}</strong><span>{nextEvent.eventDate} {nextEvent.eventTime || ''}</span></div> : <p className="bm-card-copy">Aucune date à venir.</p>}</section>
              <section className="bm-card"><div className="bm-card-head"><div><span>DOCUMENTS</span><h3>Mémoire de l’immeuble</h3></div><FileText /></div><strong className="bm-big-number">{documentsCount}</strong><p className="bm-card-copy">documents actuellement référencés.</p></section>
            </div>
          </div>
        )}

        {section === 'directory' && (
          <div className="bm-content">
            <div className="bm-page-head"><div><span>ANNUAIRE DE LA RÉSIDENCE</span><h2>Personnes, étages & lots</h2><p>Ajoutez une personne, complétez son e-mail et donnez-lui accès à CoproLink depuis le même écran.</p></div><button className="bm-primary" onClick={() => setShowAdd(value => !value)}><Plus /> Ajouter une personne</button></div>
            <div className="bm-directory-tools"><label><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher un nom, un lot, un étage…" /></label><span>{directoryEntries.length} entrée{directoryEntries.length > 1 ? 's' : ''}</span></div>

            {showAdd && (
              <form className="bm-add-form" onSubmit={addPerson}>
                <div>
                  <label>Nom et prénom<input value={draft.fullName} onChange={event => setDraft(value => ({ ...value, fullName: event.target.value }))} required /></label>
                  <label>E-mail (optionnel)<input value={draft.email} onChange={event => setDraft(value => ({ ...value, email: event.target.value }))} type="email" /></label>
                  <label>Lot / appartement<input value={draft.unitLabel} onChange={event => setDraft(value => ({ ...value, unitLabel: event.target.value }))} placeholder="4A" /></label>
                  <label>Étage<input value={draft.floor} onChange={event => setDraft(value => ({ ...value, floor: event.target.value }))} placeholder="4" /></label>
                  <label>Lien avec le lot<select value={draft.relationPreset} onChange={event => setDraft(value => ({ ...value, relationPreset: event.target.value }))}>{Object.entries(RELATION_PRESETS).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
                </div>
                <div className="bm-add-options"><label><input type="checkbox" checked={draft.directoryVisible} onChange={event => setDraft(value => ({ ...value, directoryVisible: event.target.checked }))} /> Visible dans l’annuaire privé</label><label><input type="checkbox" checked={draft.hallVisible} onChange={event => setDraft(value => ({ ...value, hallVisible: event.target.checked }))} /> Visible sur écran / hall</label><label><input type="checkbox" checked={draft.isReferent} onChange={event => setDraft(value => ({ ...value, isReferent: event.target.checked }))} /> Référent CoproLink</label></div>
                <div className="bm-form-actions"><button type="button" onClick={() => setShowAdd(false)}>Annuler</button><button className="bm-primary" type="submit"><Check /> Enregistrer</button></div>
              </form>
            )}

            <div className="bm-floor-list">
              {floors.map(([floor, rows]) => (
                <section className="bm-floor" key={floor || 'unknown'}>
                  <header><span>{floorLabel(floor)}</span><small>{rows.length} entrée{rows.length > 1 ? 's' : ''}</small></header>
                  <div>{rows.map(row => {
                    const types = row.relations.map(item => item.relationType)
                    const prefs = visibilityByPerson.get(row.person.id) || { directoryVisible: true, hallVisible: false }
                    const accessState = accessByPerson.get(row.person.id) || 'none'
                    return (
                      <article key={row.key}>
                        <label className="bm-inline-field">Lot<input defaultValue={row.unit?.label || ''} disabled={!row.unit} onBlur={event => row.unit && clean(event.target.value) !== clean(row.unit.label) && runAction(() => apiV3.update(slug, 'unit', row.unit.id, { label: event.target.value }))} placeholder="4A" /></label>
                        <div className="bm-person-main"><span className="bm-avatar">{initials(row.person.fullName)}</span><div><strong>{row.person.fullName}</strong><small>{relationLabel(types)}</small><PersonAccessControl compact person={row.person} access={accessState} onSaveEmail={email => saveEmail(row.person, email)} onInvite={() => invitePerson(row.person)} /></div></div>
                        <label className="bm-inline-field">Étage<input defaultValue={row.unit?.floor || ''} disabled={!row.unit} onBlur={event => row.unit && clean(event.target.value) !== clean(row.unit.floor) && runAction(() => apiV3.update(slug, 'unit', row.unit.id, { floor: event.target.value }))} placeholder="4" /></label>
                        <label className="bm-select-label">Lien<select disabled={!row.unit} value={relationPresetFor(types)} onChange={event => row.unit && setRelationPreset(row.person.id, row.unit.id, event.target.value)}>{Object.entries(RELATION_PRESETS).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
                        <div className="bm-visibility"><label className="bm-check"><input type="checkbox" checked={prefs.directoryVisible !== false} onChange={event => runAction(() => apiV3.update(slug, 'person', row.person.id, { directoryVisible: event.target.checked }))} /> Annuaire privé</label><label className="bm-check"><input type="checkbox" checked={prefs.hallVisible === true} onChange={event => runAction(() => apiV3.update(slug, 'person', row.person.id, { hallVisible: event.target.checked }))} /> Écran / hall</label></div>
                        <label className="bm-check"><input type="checkbox" checked={referentByPerson.has(row.person.id)} onChange={event => toggleReferent(row.person.id, event.target.checked)} /> Référent</label>
                      </article>
                    )
                  })}</div>
                </section>
              ))}
              {floors.length === 0 && <div className="bm-empty bm-empty-directory"><Users /><strong>Aucune personne à afficher</strong><p>Ajoutez une personne ou modifiez votre recherche.</p></div>}
            </div>
          </div>
        )}

        {section === 'roles' && (
          <div className="bm-content">
            <div className="bm-page-head"><div><span>GOUVERNANCE</span><h2>Référents & accès</h2><p>Le statut dans la copropriété et l’accès numérique sont gérés séparément.</p></div></div>
            <section className="bm-role-explainer"><article><UserCog /><h3>Référent CoproLink</h3><p>Administre l’espace CoproLink et ses accès, sans devenir syndic.</p></article><article><Wrench /><h3>Syndic</h3><p>Professionnel lié à l’immeuble, séparé des résidents.</p></article><article><Users /><h3>Copropriétaires & occupants</h3><p>Leur lien est porté par le lot et peut évoluer sans perdre l’historique.</p></article></section>
            <section className="bm-card bm-referent-card"><div className="bm-card-head"><div><span>RÉFÉRENTS COPROLINK</span><h3>Continuité de l’espace</h3></div><UserCog /></div><p className="bm-card-copy">Deux référents sont recommandés pour éviter qu’un seul compte ne devienne indispensable.</p><div className="bm-referent-list">{residents.map(person => <label key={person.id}><span className="bm-avatar">{initials(person.fullName)}</span><div><strong>{person.fullName}</strong><small>{person.unitLabel || relationLabel(person.relations)}</small></div><input type="checkbox" checked={person.isReferent} onChange={event => toggleReferent(person.id, event.target.checked)} /></label>)}</div></section>
          </div>
        )}
      </section>
    </main>
  )
}
