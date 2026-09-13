import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Building2, CalendarDays, Check, ChevronRight, CircleUserRound, DoorOpen,
  FileText, KeyRound, LayoutDashboard, LogOut, Mail, Plus, Search, Settings, ShieldCheck,
  Sparkles, UserCog, Users, Wrench,
} from 'lucide-react'
import { api } from './api.js'
import { ErrorPanel, Logo, Spinner } from './views.jsx'
import { roleLabel } from './format.js'
import './building-management.css'

const STORE_PREFIX = 'coprolink-building-model-v1:'
const PERSON_TYPES = {
  owner: 'Copropriétaire',
  occupant: 'Occupant',
  tenant: 'Locataire',
  external: 'Intervenant externe',
}

const readStore = slug => {
  try {
    const raw = localStorage.getItem(`${STORE_PREFIX}${slug}`)
    return raw ? JSON.parse(raw) : { overrides: {}, localPeople: [] }
  } catch { return { overrides: {}, localPeople: [] } }
}

const writeStore = (slug, value) => {
  try { localStorage.setItem(`${STORE_PREFIX}${slug}`, JSON.stringify(value)) } catch { /* sandbox */ }
}

const guessFloor = unit => {
  const value = String(unit || '')
  const floor = value.match(/(?:étage|etage|e\.?|^|\s)(-?\d{1,2})(?:\s|e|er|ème|eme|$)/i)?.[1]
    || value.match(/\b(\d{1,2})[A-Za-z]\b/)?.[1]
  return floor ?? ''
}

const floorLabel = value => {
  if (value === '' || value == null) return 'Étage non renseigné'
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value)
  if (n === 0) return 'Rez-de-chaussée'
  if (n === 1) return '1er étage'
  return `${n}e étage`
}

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`

export default function BuildingManagementView({ session, buildingSlug, onLogout }) {
  const fallback = session.memberships.find(m => m.role === 'manager')?.buildingSlug || session.memberships[0]?.buildingSlug || ''
  const slug = buildingSlug || fallback
  const [state, setState] = useState({ status: 'loading', workspace: null, members: null, error: null })
  const [section, setSection] = useState('overview')
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState({ fullName: '', email: '', unitLabel: '', floor: '', personType: 'owner', isReferent: false, directoryVisible: true })
  const [model, setModel] = useState(() => readStore(slug))

  useEffect(() => { setModel(readStore(slug)) }, [slug])

  const load = async () => {
    setState(s => ({ ...s, status: s.workspace ? 'refreshing' : 'loading', error: null }))
    try {
      const [workspace, members] = await Promise.all([api.workspace(slug), api.listMembers(slug)])
      setState({ status: 'ready', workspace, members, error: null })
    } catch (error) {
      setState({ status: 'error', workspace: null, members: null, error: error.message })
    }
  }

  useEffect(() => { if (slug) load() }, [slug])

  const saveModel = next => {
    setModel(next)
    writeStore(slug, next)
  }

  const people = useMemo(() => {
    if (!state.members) return []
    const fromMembers = state.members.members.map(member => ({
      key: `member:${member.id}`,
      id: member.id,
      source: 'member',
      fullName: member.fullName || member.email,
      email: member.email,
      accessRole: member.role,
      activated: member.activated,
      unitLabel: member.unitLabel || '',
      floor: guessFloor(member.unitLabel),
      personType: member.role === 'manager' ? 'external' : 'owner',
      directoryVisible: member.role !== 'manager',
      isReferent: false,
    }))
    const pending = state.members.pendingMembers.map(member => ({
      key: `pending:${member.id}`,
      id: member.id,
      source: 'pending',
      fullName: member.fullName || member.email,
      email: member.email,
      accessRole: member.role,
      activated: false,
      unitLabel: member.unitLabel || '',
      floor: guessFloor(member.unitLabel),
      personType: member.role === 'manager' ? 'external' : 'owner',
      directoryVisible: member.role !== 'manager',
      isReferent: false,
    }))
    const locals = model.localPeople.map(person => ({ ...person, source: 'local', key: `local:${person.id}`, accessRole: null, activated: null }))
    return [...fromMembers, ...pending, ...locals].map(person => ({ ...person, ...(model.overrides[person.key] || {}) }))
  }, [state.members, model])

  const updatePerson = (key, patch) => {
    const next = { ...model, overrides: { ...model.overrides, [key]: { ...(model.overrides[key] || {}), ...patch } } }
    saveModel(next)
  }

  const addPerson = event => {
    event.preventDefault()
    if (!draft.fullName.trim()) return
    const person = { ...draft, id: newId(), fullName: draft.fullName.trim(), email: draft.email.trim() }
    saveModel({ ...model, localPeople: [...model.localPeople, person] })
    setDraft({ fullName: '', email: '', unitLabel: '', floor: '', personType: 'owner', isReferent: false, directoryVisible: true })
    setShowAdd(false)
  }

  const removeLocal = id => saveModel({ ...model, localPeople: model.localPeople.filter(person => person.id !== id) })

  const visibleResidents = people.filter(person => person.personType !== 'external')
  const referents = people.filter(person => person.isReferent)
  const uniqueLots = new Set(visibleResidents.map(person => person.unitLabel.trim()).filter(Boolean))
  const openTickets = state.workspace?.buildingTickets?.filter(ticket => ticket.status !== 'resolved').length || 0
  const needle = query.trim().toLowerCase()
  const filteredPeople = visibleResidents.filter(person => !needle || `${person.fullName} ${person.email} ${person.unitLabel} ${floorLabel(person.floor)}`.toLowerCase().includes(needle))

  const floors = useMemo(() => {
    const map = new Map()
    for (const person of filteredPeople) {
      const key = String(person.floor ?? '')
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(person)
    }
    return [...map.entries()].sort((a, b) => {
      const an = Number(a[0]); const bn = Number(b[0])
      if (Number.isFinite(an) && Number.isFinite(bn)) return bn - an
      if (Number.isFinite(an)) return -1
      if (Number.isFinite(bn)) return 1
      return a[0].localeCompare(b[0])
    })
  }, [filteredPeople])

  if (!slug) return <ErrorPanel title="Aucun immeuble" message="Aucune copropriété administrable n’est associée à ce compte." />
  if (state.status === 'loading') return <Spinner label="Chargement de l’immeuble…" />
  if (state.status === 'error') return <ErrorPanel title="Immeuble inaccessible" message={state.error} onRetry={load} />

  const building = state.workspace.building

  return (
    <main className="v2-shell bm-shell">
      <aside className="v2-sidebar">
        <Logo />
        <nav>
          <button onClick={() => { location.hash = '/portfolio' }}><LayoutDashboard /> Portefeuille</button>
          <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}><Building2 /> Vue d’ensemble</button>
          <button className={section === 'directory' ? 'active' : ''} onClick={() => setSection('directory')}><Users /> Annuaire & lots</button>
          <button className={section === 'roles' ? 'active' : ''} onClick={() => setSection('roles')}><UserCog /> Référents & rôles</button>
          <button onClick={() => { location.hash = `/syndic?building=${encodeURIComponent(slug)}` }}><Wrench /> Outils syndic actuels</button>
          <button onClick={() => { location.hash = `/portfolio?view=inbox&building=${encodeURIComponent(slug)}` }}><Sparkles /> Inbox IA</button>
        </nav>
        <div className="v2-sidebar-bottom">
          <button><Settings /> Paramètres</button>
          <div className="v2-user-card"><span>{(session.user.fullName || session.user.email).slice(0, 2).toUpperCase()}</span><div><strong>{session.user.fullName || session.user.email}</strong><small>Administration de l’immeuble</small></div></div>
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>

      <section className="v2-main bm-main">
        <header className="bm-topbar">
          <div className="bm-title"><button onClick={() => { location.hash = '/portfolio' }}><ArrowLeft /></button><div><span>GESTION DE L’IMMEUBLE</span><h1>{building.name}</h1><p>{building.address || 'Adresse à compléter'}</p></div></div>
          <div className="bm-top-actions"><span className="bm-sandbox"><ShieldCheck /> Modèle V2 en validation</span><button onClick={() => { location.hash = `/syndic?building=${encodeURIComponent(slug)}` }}>Outils actuels <ChevronRight /></button></div>
        </header>

        <section className="bm-banner"><KeyRound /><div><strong>La copropriété devient le centre du modèle</strong><span>Les nouveaux attributs “copropriétaire / occupant / référent / visibilité annuaire” sont testés ici sans modifier encore la base réelle.</span></div></section>

        {section === 'overview' && (
          <div className="bm-content">
            <section className="bm-hero"><div><span>ESPACE PERMANENT DE LA COPROPRIÉTÉ</span><h2>{building.name}</h2><p>Une mémoire unique pour les personnes, lots, documents, échéances et interventions — indépendamment du syndic en place.</p></div><Building2 /></section>
            <section className="bm-stats">
              <article><DoorOpen /><strong>{uniqueLots.size || building.lots || 0}</strong><span>lots renseignés</span></article>
              <article><Users /><strong>{visibleResidents.length}</strong><span>personnes liées</span></article>
              <article className={referents.length < 2 ? 'attention' : ''}><UserCog /><strong>{referents.length}</strong><span>référent{referents.length > 1 ? 's' : ''} CoproLink</span></article>
              <article className={openTickets ? 'attention' : ''}><Wrench /><strong>{openTickets}</strong><span>signalements ouverts</span></article>
            </section>
            <div className="bm-grid">
              <section className="bm-card"><div className="bm-card-head"><div><span>CONTINUITÉ</span><h3>Référents CoproLink</h3></div><UserCog /></div>{referents.length ? referents.map(person => <div className="bm-person-row" key={person.key}><CircleUserRound /><div><strong>{person.fullName}</strong><small>{person.unitLabel || PERSON_TYPES[person.personType]}</small></div><span>Référent</span></div>) : <div className="bm-empty"><UserCog /><strong>Aucun référent désigné</strong><p>Je recommande au moins deux référents pour éviter toute dépendance à une seule personne.</p><button onClick={() => setSection('roles')}>Désigner des référents</button></div>}</section>
              <section className="bm-card"><div className="bm-card-head"><div><span>ANNUAIRE</span><h3>Résidents & lots</h3></div><Users /></div><p className="bm-card-copy">L’annuaire est organisé par étage et par lot. Chaque personne peut avoir un statut et un niveau de visibilité distincts.</p><button className="bm-primary" onClick={() => setSection('directory')}>Ouvrir l’annuaire <ChevronRight /></button></section>
              <section className="bm-card"><div className="bm-card-head"><div><span>ÉCHÉANCES</span><h3>Prochaine date</h3></div><CalendarDays /></div>{state.workspace.events?.[0] ? <div className="bm-next"><strong>{state.workspace.events[0].title}</strong><span>{state.workspace.events[0].eventDate} {state.workspace.events[0].eventTime || ''}</span><p>{state.workspace.events[0].detail || 'Événement de la copropriété'}</p></div> : <p className="bm-card-copy">Aucune date à venir.</p>}</section>
              <section className="bm-card"><div className="bm-card-head"><div><span>DOCUMENTS</span><h3>Mémoire de l’immeuble</h3></div><FileText /></div><strong className="bm-big-number">{state.workspace.documents?.length || 0}</strong><p className="bm-card-copy">documents actuellement référencés. La future V2 les classera par catégorie, contrat et échéance.</p></section>
            </div>
          </div>
        )}

        {section === 'directory' && (
          <div className="bm-content">
            <div className="bm-page-head"><div><span>ANNUAIRE DE LA RÉSIDENCE</span><h2>Personnes, étages & lots</h2><p>Le statut de résidence est séparé du rôle d’accès à l’application.</p></div><button className="bm-primary" onClick={() => setShowAdd(v => !v)}><Plus /> Ajouter une personne</button></div>
            <div className="bm-directory-tools"><label><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un nom, un lot, un étage…" /></label><span>{filteredPeople.length} personne{filteredPeople.length > 1 ? 's' : ''}</span></div>
            {showAdd && <form className="bm-add-form" onSubmit={addPerson}><div><label>Nom et prénom<input value={draft.fullName} onChange={e => setDraft(d => ({ ...d, fullName: e.target.value }))} required /></label><label>E-mail<input value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} type="email" /></label><label>Lot / appartement<input value={draft.unitLabel} onChange={e => setDraft(d => ({ ...d, unitLabel: e.target.value }))} placeholder="4A" /></label><label>Étage<input value={draft.floor} onChange={e => setDraft(d => ({ ...d, floor: e.target.value }))} placeholder="4" /></label><label>Statut<select value={draft.personType} onChange={e => setDraft(d => ({ ...d, personType: e.target.value }))}>{Object.entries(PERSON_TYPES).filter(([key]) => key !== 'external').map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div><div className="bm-form-actions"><button type="button" onClick={() => setShowAdd(false)}>Annuler</button><button className="bm-primary" type="submit"><Check /> Ajouter au prototype</button></div></form>}
            <div className="bm-floor-list">{floors.map(([floor, floorPeople]) => <section className="bm-floor" key={floor}><header><span>{floorLabel(floor)}</span><small>{floorPeople.length} personne{floorPeople.length > 1 ? 's' : ''}</small></header><div>{floorPeople.sort((a,b) => (a.unitLabel || '').localeCompare(b.unitLabel || '')).map(person => <article key={person.key}><div className="bm-unit"><DoorOpen /><strong>{person.unitLabel || 'Lot à préciser'}</strong></div><div className="bm-person-main"><span className="bm-avatar">{person.fullName.split(' ').map(part => part[0]).join('').slice(0,2).toUpperCase()}</span><div><strong>{person.fullName}</strong><small>{PERSON_TYPES[person.personType]}{person.email ? ` · ${person.email}` : ''}</small></div></div><label className="bm-select-label">Statut<select value={person.personType} onChange={e => updatePerson(person.key, { personType: e.target.value })}><option value="owner">Copropriétaire</option><option value="occupant">Occupant</option><option value="tenant">Locataire</option></select></label><label className="bm-check"><input type="checkbox" checked={person.directoryVisible !== false} onChange={e => updatePerson(person.key, { directoryVisible: e.target.checked })} /> Visible annuaire</label><label className="bm-check"><input type="checkbox" checked={person.isReferent === true} onChange={e => updatePerson(person.key, { isReferent: e.target.checked })} /> Référent</label>{person.source === 'local' && <button className="bm-remove" onClick={() => removeLocal(person.id)}>Retirer</button>}</article>)}</div></section>)}</div>
          </div>
        )}

        {section === 'roles' && (
          <div className="bm-content">
            <div className="bm-page-head"><div><span>GOUVERNANCE</span><h2>Référents & rôles</h2><p>Le rôle dans la copropriété et le niveau d’accès numérique sont deux choses différentes.</p></div></div>
            <section className="bm-role-explainer"><article><UserCog /><h3>Référent CoproLink</h3><p>Administre les accès, maintient l’annuaire et veille à la continuité de l’espace. Ne remplace pas juridiquement le syndic.</p></article><article><Wrench /><h3>Syndic</h3><p>Intervient sur les dossiers qui le concernent et peut continuer à travailler depuis son e-mail ou son logiciel habituel.</p></article><article><Users /><h3>Copropriétaires & occupants</h3><p>Consultent, signalent et reçoivent les informations selon leurs droits et leur lien avec le lot.</p></article></section>
            <section className="bm-card bm-access-card"><div className="bm-card-head"><div><span>ACCÈS TECHNIQUES ACTUELS</span><h3>Ce qui existe déjà dans CoproLink</h3></div><KeyRound /></div><p className="bm-card-copy">Ces rôles restent inchangés pendant la refonte. Ils seront migrés seulement après validation du nouveau modèle.</p><div className="bm-access-list">{people.filter(p => p.source !== 'local').map(person => <div key={person.key}><div><strong>{person.fullName}</strong><small>{person.email}{person.unitLabel ? ` · ${person.unitLabel}` : ''}</small></div><span>{roleLabel(person.accessRole)}</span><em>{person.source === 'pending' ? 'Invitation en attente' : person.activated === false ? 'À activer' : 'Actif'}</em></div>)}</div></section>
          </div>
        )}
      </section>
    </main>
  )
}
