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

const STORE_PREFIX = 'coprolink-building-model-v2:'

const RELATION_PRESETS = {
  owner: { relations: ['owner'], label: 'Copropriétaire' },
  occupant: { relations: ['occupant'], label: 'Occupant' },
  tenant: { relations: ['tenant'], label: 'Locataire' },
  owner_occupant: { relations: ['owner', 'occupant'], label: 'Copropriétaire + occupant' },
}

const clean = value => String(value ?? '').trim()
const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`

const emptyModel = () => ({ version: 2, overrides: {}, localPeople: [] })

const normalizeRelations = value => {
  if (Array.isArray(value)) return [...new Set(value.filter(item => ['owner', 'occupant', 'tenant'].includes(item)))]
  if (value === 'owner') return ['owner']
  if (value === 'occupant') return ['occupant']
  if (value === 'tenant') return ['tenant']
  return []
}

const normalizeModel = value => {
  if (!value || typeof value !== 'object') return emptyModel()
  const overrides = value.overrides && typeof value.overrides === 'object' ? value.overrides : {}
  const localPeople = Array.isArray(value.localPeople) ? value.localPeople.map(person => ({
    ...person,
    relations: normalizeRelations(person.relations ?? person.personType),
    directoryVisible: person.directoryVisible !== false,
    hallVisible: person.hallVisible === true,
    isReferent: person.isReferent === true,
  })) : []
  const migratedOverrides = Object.fromEntries(Object.entries(overrides).map(([key, patch]) => [key, {
    ...patch,
    relations: patch?.relations ? normalizeRelations(patch.relations) : patch?.personType ? normalizeRelations(patch.personType) : undefined,
  }]))
  return { version: 2, overrides: migratedOverrides, localPeople }
}

const readStore = slug => {
  if (!slug) return emptyModel()
  try {
    const raw = localStorage.getItem(`${STORE_PREFIX}${slug}`)
    return normalizeModel(raw ? JSON.parse(raw) : null)
  } catch { return emptyModel() }
}

const writeStore = (slug, value) => {
  if (!slug) return
  try { localStorage.setItem(`${STORE_PREFIX}${slug}`, JSON.stringify(value)) } catch { /* sandbox only */ }
}

// On ne déduit volontairement PAS l'étage d'un lot comme "4A" : ce serait une hypothèse métier.
const legacyFloor = unit => {
  const value = clean(unit)
  const explicit = value.match(/(?:étage|etage)\s*(-?\d{1,2})/i)?.[1]
    || value.match(/\b(-?\d{1,2})(?:er|e|ème|eme)\s*(?:étage|etage)\b/i)?.[1]
  return explicit ?? ''
}

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
  const list = normalizeRelations(relations)
  if (list.includes('owner') && list.includes('occupant')) return 'owner_occupant'
  if (list.includes('owner')) return 'owner'
  if (list.includes('tenant')) return 'tenant'
  return 'occupant'
}

const relationLabel = relations => RELATION_PRESETS[relationPresetFor(relations)]?.label || 'Occupant'

const initials = name => clean(name).split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '??'

export default function BuildingManagementView({ session, buildingSlug, onLogout }) {
  const fallback = session.memberships.find(m => m.role === 'manager')?.buildingSlug || session.memberships[0]?.buildingSlug || ''
  const slug = buildingSlug || fallback
  const membership = session.memberships.find(item => item.buildingSlug === slug)
  const isAllowed = session.user.isPlatformAdmin || membership?.role === 'manager'

  const [state, setState] = useState({ status: 'loading', workspace: null, members: null, membersError: null, error: null })
  const [section, setSection] = useState('overview')
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState({
    fullName: '', email: '', unitLabel: '', floor: '', relationPreset: 'owner_occupant',
    isReferent: false, directoryVisible: true, hallVisible: false,
  })
  const [model, setModel] = useState(() => readStore(slug))

  useEffect(() => { setModel(readStore(slug)) }, [slug])

  const load = async () => {
    if (!slug || !isAllowed) return
    setState(current => ({ ...current, status: current.workspace ? 'refreshing' : 'loading', error: null }))

    const [workspaceResult, membersResult] = await Promise.allSettled([api.workspace(slug), api.listMembers(slug)])
    if (workspaceResult.status === 'rejected') {
      setState({ status: 'error', workspace: null, members: null, membersError: null, error: workspaceResult.reason?.message || 'Impossible de charger cet immeuble.' })
      return
    }

    setState({
      status: 'ready',
      workspace: workspaceResult.value,
      members: membersResult.status === 'fulfilled' ? membersResult.value : { members: [], pendingMembers: [] },
      membersError: membersResult.status === 'rejected' ? (membersResult.reason?.message || 'Annuaire des accès indisponible.') : null,
      error: null,
    })
  }

  useEffect(() => { load() }, [slug, isAllowed])

  const saveModel = next => {
    const normalized = normalizeModel(next)
    setModel(normalized)
    writeStore(slug, normalized)
  }

  const people = useMemo(() => {
    const activeMembers = Array.isArray(state.members?.members) ? state.members.members : []
    const pendingMembers = Array.isArray(state.members?.pendingMembers) ? state.members.pendingMembers : []

    const mapMember = (member, source) => {
      const isProfessional = member.role === 'manager' || member.role === 'platform_admin'
      return {
        key: `${source}:${member.id}`,
        id: member.id,
        source,
        fullName: clean(member.fullName) || clean(member.email) || 'Personne sans nom',
        email: clean(member.email),
        accessRole: member.role,
        activated: source === 'pending' ? false : member.activated,
        unitLabel: clean(member.unitLabel),
        floor: legacyFloor(member.unitLabel),
        relations: isProfessional ? [] : ['owner'],
        isProfessional,
        directoryVisible: !isProfessional,
        hallVisible: false,
        isReferent: false,
      }
    }

    const serverPeople = [
      ...activeMembers.map(member => mapMember(member, 'member')),
      ...pendingMembers.map(member => mapMember(member, 'pending')),
    ]

    const localPeople = model.localPeople.map(person => ({
      ...person,
      key: `local:${person.id}`,
      source: 'local',
      accessRole: null,
      activated: null,
      isProfessional: false,
      relations: normalizeRelations(person.relations),
    }))

    return [...serverPeople, ...localPeople].map(person => {
      const patch = model.overrides[person.key] || {}
      return {
        ...person,
        ...patch,
        relations: patch.relations ? normalizeRelations(patch.relations) : normalizeRelations(person.relations),
        isProfessional: person.isProfessional === true,
      }
    })
  }, [state.members, model])

  const residents = people.filter(person => !person.isProfessional)
  const professionals = people.filter(person => person.isProfessional)
  const referents = residents.filter(person => person.isReferent)
  const uniqueLots = new Set(residents.map(person => clean(person.unitLabel)).filter(Boolean))
  const openTickets = (state.workspace?.buildingTickets || []).filter(ticket => ticket.status !== 'resolved').length

  const needle = query.trim().toLocaleLowerCase('fr-BE')
  const filteredResidents = residents.filter(person => {
    if (!needle) return true
    return `${person.fullName} ${person.email} ${person.unitLabel} ${floorLabel(person.floor)} ${relationLabel(person.relations)}`.toLocaleLowerCase('fr-BE').includes(needle)
  })

  const floors = useMemo(() => {
    const grouped = new Map()
    for (const person of filteredResidents) {
      const key = clean(person.floor)
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(person)
    }
    return [...grouped.entries()].sort(([a], [b]) => {
      if (!a && b) return 1
      if (a && !b) return -1
      const an = Number(a); const bn = Number(b)
      if (Number.isFinite(an) && Number.isFinite(bn)) return bn - an
      return a.localeCompare(b, 'fr-BE')
    })
  }, [filteredResidents])

  const updatePerson = (key, patch) => saveModel({
    ...model,
    overrides: { ...model.overrides, [key]: { ...(model.overrides[key] || {}), ...patch } },
  })

  const addPerson = event => {
    event.preventDefault()
    if (!clean(draft.fullName)) return
    const preset = RELATION_PRESETS[draft.relationPreset] || RELATION_PRESETS.occupant
    const person = {
      id: newId(),
      fullName: clean(draft.fullName),
      email: clean(draft.email),
      unitLabel: clean(draft.unitLabel),
      floor: clean(draft.floor),
      relations: preset.relations,
      isReferent: draft.isReferent === true,
      directoryVisible: draft.directoryVisible !== false,
      hallVisible: draft.hallVisible === true,
    }
    saveModel({ ...model, localPeople: [...model.localPeople, person] })
    setDraft({ fullName: '', email: '', unitLabel: '', floor: '', relationPreset: 'owner_occupant', isReferent: false, directoryVisible: true, hallVisible: false })
    setShowAdd(false)
  }

  const removeLocal = id => saveModel({ ...model, localPeople: model.localPeople.filter(person => person.id !== id) })

  if (!slug) return <ErrorPanel title="Aucun immeuble" message="Aucune copropriété administrable n’est associée à ce compte." />
  if (!isAllowed) return <ErrorPanel title="Accès non autorisé" message="La gestion de l’immeuble est réservée au référent/gestionnaire pendant cette phase de transition." onRetry={() => { location.hash = '/portfolio' }} retryLabel="Retour au portefeuille" />
  if (state.status === 'loading') return <Spinner label="Chargement de l’immeuble…" />
  if (state.status === 'error') return <ErrorPanel title="Immeuble inaccessible" message={state.error} onRetry={load} />

  const workspace = state.workspace || {}
  const building = workspace.building || { slug, name: membership?.buildingName || 'Copropriété', address: '', lots: 0 }
  const nextEvent = Array.isArray(workspace.events) ? workspace.events[0] : null
  const documentsCount = Array.isArray(workspace.documents) ? workspace.documents.length : 0

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
          <div className="v2-user-card"><span>{initials(session.user.fullName || session.user.email)}</span><div><strong>{session.user.fullName || session.user.email}</strong><small>Administration de l’immeuble</small></div></div>
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>

      <section className="v2-main bm-main">
        <header className="bm-topbar">
          <div className="bm-title"><button onClick={() => { location.hash = '/portfolio' }} aria-label="Retour au portefeuille"><ArrowLeft /></button><div><span>GESTION DE L’IMMEUBLE</span><h1>{building.name}</h1><p>{building.address || 'Adresse à compléter'}</p></div></div>
          <div className="bm-top-actions"><span className="bm-sandbox"><ShieldCheck /> Modèle V2 en validation</span><button onClick={() => { location.hash = `/syndic?building=${encodeURIComponent(slug)}` }}>Outils actuels <ChevronRight /></button></div>
        </header>

        <section className="bm-banner"><KeyRound /><div><strong>La copropriété devient le centre du modèle</strong><span>Les statuts, étages, référents et préférences de visibilité sont encore testés localement. Aucune donnée réelle n’est modifiée.</span></div></section>
        {state.membersError && <section className="bm-warning"><ShieldCheck /><div><strong>Les accès utilisateurs ne sont pas disponibles pour le moment</strong><span>{state.membersError} La fiche immeuble reste consultable et les données locales du prototype sont conservées.</span></div></section>}

        {section === 'overview' && (
          <div className="bm-content">
            <section className="bm-hero"><div><span>ESPACE PERMANENT DE LA COPROPRIÉTÉ</span><h2>{building.name}</h2><p>Une mémoire unique pour les personnes, lots, documents, échéances et interventions — indépendamment du syndic en place.</p></div><Building2 /></section>
            <section className="bm-stats">
              <article><DoorOpen /><strong>{uniqueLots.size || building.lots || 0}</strong><span>lots renseignés</span></article>
              <article><Users /><strong>{residents.length}</strong><span>personnes liées</span></article>
              <article className={referents.length < 2 ? 'attention' : ''}><UserCog /><strong>{referents.length}</strong><span>référent{referents.length > 1 ? 's' : ''} CoproLink</span></article>
              <article className={openTickets ? 'attention' : ''}><Wrench /><strong>{openTickets}</strong><span>signalements ouverts</span></article>
            </section>

            <div className="bm-grid">
              <section className="bm-card">
                <div className="bm-card-head"><div><span>CONTINUITÉ</span><h3>Référents CoproLink</h3></div><UserCog /></div>
                {referents.length ? referents.map(person => <div className="bm-person-row" key={person.key}><CircleUserRound /><div><strong>{person.fullName}</strong><small>{person.unitLabel || relationLabel(person.relations)}</small></div><span>Référent</span></div>) : <div className="bm-empty"><UserCog /><strong>Aucun référent désigné</strong><p>Je recommande au moins deux référents pour éviter toute dépendance à une seule personne.</p><button onClick={() => setSection('roles')}>Désigner des référents</button></div>}
              </section>

              <section className="bm-card"><div className="bm-card-head"><div><span>ANNUAIRE</span><h3>Résidents & lots</h3></div><Users /></div><p className="bm-card-copy">L’annuaire est organisé par étage et lot. Une personne peut être à la fois copropriétaire et occupante.</p><button className="bm-primary" onClick={() => setSection('directory')}>Ouvrir l’annuaire <ChevronRight /></button></section>

              <section className="bm-card"><div className="bm-card-head"><div><span>SYNDIC / PROFESSIONNELS</span><h3>Intervenants liés</h3></div><Wrench /></div>{professionals.length ? professionals.map(person => <div className="bm-person-row" key={person.key}><Wrench /><div><strong>{person.fullName}</strong><small>{person.email || 'Compte professionnel'}</small></div><span>{roleLabel(person.accessRole)}</span></div>) : <div className="bm-contact-line"><strong>{building.managerName || 'Syndic à renseigner'}</strong><small>Le syndic est lié à l’immeuble mais n’apparaît pas dans l’annuaire des résidents.</small></div>}</section>

              <section className="bm-card"><div className="bm-card-head"><div><span>ÉCHÉANCES</span><h3>Prochaine date</h3></div><CalendarDays /></div>{nextEvent ? <div className="bm-next"><strong>{nextEvent.title}</strong><span>{nextEvent.eventDate} {nextEvent.eventTime || ''}</span><p>{nextEvent.detail || 'Événement de la copropriété'}</p></div> : <p className="bm-card-copy">Aucune date à venir.</p>}</section>

              <section className="bm-card"><div className="bm-card-head"><div><span>DOCUMENTS</span><h3>Mémoire de l’immeuble</h3></div><FileText /></div><strong className="bm-big-number">{documentsCount}</strong><p className="bm-card-copy">documents actuellement référencés. La future V2 les classera par catégorie, contrat et échéance.</p></section>
            </div>
          </div>
        )}

        {section === 'directory' && (
          <div className="bm-content">
            <div className="bm-page-head"><div><span>ANNUAIRE DE LA RÉSIDENCE</span><h2>Personnes, étages & lots</h2><p>Le lien avec l’immeuble est séparé du rôle d’accès à l’application.</p></div><button className="bm-primary" onClick={() => setShowAdd(value => !value)}><Plus /> Ajouter une personne</button></div>
            <div className="bm-directory-tools"><label><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher un nom, un lot, un étage…" /></label><span>{filteredResidents.length} personne{filteredResidents.length > 1 ? 's' : ''}</span></div>

            {showAdd && (
              <form className="bm-add-form" onSubmit={addPerson}>
                <div>
                  <label>Nom et prénom<input value={draft.fullName} onChange={event => setDraft(value => ({ ...value, fullName: event.target.value }))} required /></label>
                  <label>E-mail<input value={draft.email} onChange={event => setDraft(value => ({ ...value, email: event.target.value }))} type="email" /></label>
                  <label>Lot / appartement<input value={draft.unitLabel} onChange={event => setDraft(value => ({ ...value, unitLabel: event.target.value }))} placeholder="4A" /></label>
                  <label>Étage<input value={draft.floor} onChange={event => setDraft(value => ({ ...value, floor: event.target.value }))} placeholder="4" /></label>
                  <label>Lien avec le lot<select value={draft.relationPreset} onChange={event => setDraft(value => ({ ...value, relationPreset: event.target.value }))}>{Object.entries(RELATION_PRESETS).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
                </div>
                <div className="bm-add-options"><label><input type="checkbox" checked={draft.directoryVisible} onChange={event => setDraft(value => ({ ...value, directoryVisible: event.target.checked }))} /> Visible dans l’annuaire privé</label><label><input type="checkbox" checked={draft.hallVisible} onChange={event => setDraft(value => ({ ...value, hallVisible: event.target.checked }))} /> Visible sur écran / hall</label><label><input type="checkbox" checked={draft.isReferent} onChange={event => setDraft(value => ({ ...value, isReferent: event.target.checked }))} /> Référent CoproLink</label></div>
                <div className="bm-form-actions"><button type="button" onClick={() => setShowAdd(false)}>Annuler</button><button className="bm-primary" type="submit"><Check /> Ajouter au prototype</button></div>
              </form>
            )}

            <div className="bm-floor-list">
              {floors.map(([floor, floorPeople]) => (
                <section className="bm-floor" key={floor || 'unknown'}>
                  <header><span>{floorLabel(floor)}</span><small>{floorPeople.length} personne{floorPeople.length > 1 ? 's' : ''}</small></header>
                  <div>{[...floorPeople].sort((a, b) => clean(a.unitLabel).localeCompare(clean(b.unitLabel), 'fr-BE')).map(person => (
                    <article key={person.key}>
                      <label className="bm-inline-field">Lot<input value={person.unitLabel || ''} onChange={event => updatePerson(person.key, { unitLabel: event.target.value })} placeholder="4A" /></label>
                      <div className="bm-person-main"><span className="bm-avatar">{initials(person.fullName)}</span><div><strong>{person.fullName}</strong><small>{relationLabel(person.relations)}{person.email ? ` · ${person.email}` : ''}</small></div></div>
                      <label className="bm-inline-field">Étage<input value={person.floor || ''} onChange={event => updatePerson(person.key, { floor: event.target.value })} placeholder="4" /></label>
                      <label className="bm-select-label">Lien<select value={relationPresetFor(person.relations)} onChange={event => updatePerson(person.key, { relations: RELATION_PRESETS[event.target.value]?.relations || ['occupant'] })}>{Object.entries(RELATION_PRESETS).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
                      <div className="bm-visibility"><label className="bm-check"><input type="checkbox" checked={person.directoryVisible !== false} onChange={event => updatePerson(person.key, { directoryVisible: event.target.checked })} /> Annuaire privé</label><label className="bm-check"><input type="checkbox" checked={person.hallVisible === true} onChange={event => updatePerson(person.key, { hallVisible: event.target.checked })} /> Écran / hall</label></div>
                      <label className="bm-check"><input type="checkbox" checked={person.isReferent === true} onChange={event => updatePerson(person.key, { isReferent: event.target.checked })} /> Référent</label>
                      {person.source === 'local' && <button type="button" className="bm-remove" onClick={() => removeLocal(person.id)}>Retirer</button>}
                    </article>
                  ))}</div>
                </section>
              ))}
              {floors.length === 0 && <div className="bm-empty bm-empty-directory"><Users /><strong>Aucune personne à afficher</strong><p>Ajoutez une personne au prototype ou vérifiez les accès existants.</p></div>}
            </div>
          </div>
        )}

        {section === 'roles' && (
          <div className="bm-content">
            <div className="bm-page-head"><div><span>GOUVERNANCE</span><h2>Référents & rôles</h2><p>Le rôle dans la copropriété et le niveau d’accès numérique sont deux choses différentes.</p></div></div>
            <section className="bm-role-explainer"><article><UserCog /><h3>Référent CoproLink</h3><p>Administre les accès, maintient l’annuaire et veille à la continuité de l’espace. Ne remplace pas juridiquement le syndic.</p></article><article><Wrench /><h3>Syndic</h3><p>Intervient sur les dossiers qui le concernent et peut continuer à travailler depuis son e-mail ou son logiciel habituel.</p></article><article><Users /><h3>Copropriétaires & occupants</h3><p>Consultent, signalent et reçoivent les informations selon leurs droits et leur lien avec le lot.</p></article></section>

            <section className="bm-card bm-referent-card">
              <div className="bm-card-head"><div><span>RÉFÉRENTS COPROLINK</span><h3>Continuité de l’espace</h3></div><UserCog /></div>
              <p className="bm-card-copy">Je recommande au moins deux référents. Leur statut est une fonction CoproLink, pas une responsabilité juridique de syndic.</p>
              <div className="bm-referent-list">{residents.map(person => <label key={person.key}><span className="bm-avatar">{initials(person.fullName)}</span><div><strong>{person.fullName}</strong><small>{person.unitLabel || relationLabel(person.relations)}</small></div><input type="checkbox" checked={person.isReferent === true} onChange={event => updatePerson(person.key, { isReferent: event.target.checked })} /></label>)}</div>
            </section>

            <section className="bm-card bm-access-card"><div className="bm-card-head"><div><span>ACCÈS TECHNIQUES ACTUELS</span><h3>Ce qui existe déjà dans CoproLink</h3></div><KeyRound /></div><p className="bm-card-copy">Ces rôles restent inchangés pendant la refonte. Ils seront migrés seulement après validation du nouveau modèle.</p><div className="bm-access-list">{people.filter(person => person.source !== 'local').map(person => <div key={person.key}><div><strong>{person.fullName}</strong><small>{person.email}{person.unitLabel ? ` · ${person.unitLabel}` : ''}</small></div><span>{roleLabel(person.accessRole)}</span><em>{person.source === 'pending' ? 'Invitation en attente' : person.activated === false ? 'À activer' : 'Actif'}</em></div>)}</div></section>
          </div>
        )}
      </section>
    </main>
  )
}
