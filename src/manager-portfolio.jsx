import React, { useEffect, useState } from 'react'
import {
  Activity, AlertTriangle, Bell, Building2, CalendarDays, CheckCircle2, ChevronRight,
  ClipboardCopy, FileText, HelpCircle, Info, LayoutDashboard, LogOut, Mail, RefreshCw,
  Search, Settings, ShieldCheck, Sparkles, Wrench, X,
} from 'lucide-react'
import { api } from './api.js'
import { Logo, Spinner, ErrorPanel } from './views.jsx'
import InboxAIView from './inbox-ai.jsx'
import BuildingManagementView from './building-management.jsx'
import PreviewAsView from './preview-as.jsx'
import BuildingModelV3View from './building-model-v3.jsx'
import './manager-release.css'

const PREFS_KEY = 'coprolink-manager-preferences-v1'
const defaultPrefs = { reminderDays: 14, showResolvedNotifications: false }

const readPrefs = () => {
  try { return { ...defaultPrefs, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')) } }
  catch { return defaultPrefs }
}
const savePrefs = prefs => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* préférence locale uniquement */ }
}

const goPortfolioView = view => { location.hash = view === 'dashboard' ? '/portfolio' : `/portfolio?view=${encodeURIComponent(view)}` }
const goBuilding = slug => { location.hash = `/portfolio?view=building&building=${encodeURIComponent(slug)}` }

const statusLabel = status => ({ ok: 'Sous contrôle', watch: 'À surveiller', action: 'Action requise' }[status] || 'Sous contrôle')
const statusClass = status => ({ ok: 'v2-status-ok', watch: 'v2-status-watch', action: 'v2-status-action' }[status] || 'v2-status-ok')
const ticketLabel = status => ({ new: 'Nouveau', waiting: 'À relancer', scheduled: 'Planifié', resolved: 'Résolu', in_progress: 'En cours' }[status] || 'En cours')

const relativeDate = value => {
  if (!value) return 'Aucune date'
  const target = new Date(`${value}T12:00:00`)
  const diff = Math.ceil((target.getTime() - Date.now()) / 86400000)
  if (diff <= 0) return "aujourd’hui"
  if (diff === 1) return 'demain'
  return `dans ${diff} jours`
}
const dateLabel = value => {
  if (!value) return '—'
  return new Intl.DateTimeFormat('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
}
const daysUntil = value => {
  const target = new Date(`${value}T12:00:00`).getTime()
  return Math.ceil((target - Date.now()) / 86400000)
}

export default function ManagerPortfolioView({ session, onLogout, setToast }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [query, setQuery] = useState('')
  const [prefs, setPrefs] = useState(readPrefs)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  const view = params.get('view') || 'dashboard'
  const buildingSlug = params.get('building') || ''
  const previewRole = params.get('as') || 'owner'
  const inboxMode = view === 'inbox'
  const buildingMode = view === 'building'
  const previewMode = view === 'preview'
  const modelV3Mode = view === 'model-v3'
  const portfolioView = ['dashboard', 'buildings', 'tickets', 'documents', 'deadlines', 'help', 'settings'].includes(view) ? view : 'dashboard'

  const updatePrefs = patch => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(next)
  }

  const load = async () => {
    setState(s => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }))
    try {
      const data = await api.managerDashboard()
      setState({ status: 'ready', data, error: null })
    } catch (error) {
      setState({ status: 'error', data: null, error: error.message })
    }
  }

  useEffect(() => { if (!inboxMode && !buildingMode && !previewMode && !modelV3Mode) load() }, [inboxMode, buildingMode, previewMode, modelV3Mode, portfolioView])
  useEffect(() => setNotificationsOpen(false), [portfolioView])

  if (inboxMode) return <InboxAIView session={session} onLogout={onLogout} />
  if (buildingMode) return <BuildingManagementView session={session} buildingSlug={buildingSlug} onLogout={onLogout} />
  if (previewMode) return <PreviewAsView session={session} buildingSlug={buildingSlug} initialRole={previewRole} onLogout={onLogout} setToast={setToast} />
  if (modelV3Mode) return <BuildingModelV3View buildingSlug={buildingSlug} setToast={setToast} onBack={() => goBuilding(buildingSlug)} />
  if (state.status === 'loading') return <Spinner label="Chargement de votre espace…" />
  if (state.status === 'error') return <ErrorPanel title="Espace indisponible" message={state.error} onRetry={load} />

  const data = state.data
  const firstName = (session.user.fullName || session.user.email).split(' ')[0]
  const needle = query.trim().toLowerCase()
  const filteredBuildings = needle ? data.buildings.filter(b => `${b.name} ${b.address}`.toLowerCase().includes(needle)) : data.buildings
  const filteredTickets = needle ? data.tickets.filter(t => `${t.reference} ${t.title} ${t.location} ${t.buildingName}`.toLowerCase().includes(needle)) : data.tickets
  const filteredDocuments = needle ? data.documents.filter(d => `${d.name} ${d.fileType} ${d.buildingName}`.toLowerCase().includes(needle)) : data.documents
  const filteredEvents = needle ? data.events.filter(e => `${e.title} ${e.detail} ${e.buildingName}`.toLowerCase().includes(needle)) : data.events

  const ticketNotifications = (data.tickets || [])
    .filter(item => prefs.showResolvedNotifications || item.status !== 'resolved')
    .filter(item => ['new', 'waiting'].includes(item.status))
    .map(item => ({
      id: `ticket-${item.id}`, type: 'ticket', icon: <Wrench size={16} />,
      title: item.title, meta: `${item.buildingName} · ${ticketLabel(item.status)}`,
      when: 'À traiter', onClick: () => goBuilding(item.buildingSlug),
    }))
  const eventNotifications = (data.events || [])
    .filter(item => daysUntil(item.eventDate) >= 0 && daysUntil(item.eventDate) <= Number(prefs.reminderDays || 14))
    .map(item => ({
      id: `event-${item.id}`, type: 'event', icon: <CalendarDays size={16} />,
      title: item.title, meta: item.buildingName,
      when: relativeDate(item.eventDate), onClick: () => goBuilding(item.buildingSlug),
    }))
  const notifications = [...ticketNotifications, ...eventNotifications].slice(0, 12)
  const showSearch = !['help', 'settings'].includes(portfolioView)

  return (
    <main className="v2-shell v2-manager-shell">
      <aside className="v2-sidebar">
        <Logo />
        <nav>
          <button className={portfolioView === 'dashboard' ? 'active' : ''} onClick={() => goPortfolioView('dashboard')}><LayoutDashboard /> Tableau de bord</button>
          <button className={portfolioView === 'buildings' ? 'active' : ''} onClick={() => goPortfolioView('buildings')}><Building2 /> Copropriétés</button>
          <button className={portfolioView === 'tickets' ? 'active' : ''} onClick={() => goPortfolioView('tickets')}><Wrench /> Signalements</button>
          <button className={portfolioView === 'documents' ? 'active' : ''} onClick={() => goPortfolioView('documents')}><FileText /> Documents</button>
          <button className={portfolioView === 'deadlines' ? 'active' : ''} onClick={() => goPortfolioView('deadlines')}><CalendarDays /> Échéances</button>
        </nav>
        <div className="v2-sidebar-bottom">
          <button className={portfolioView === 'help' ? 'active' : ''} onClick={() => goPortfolioView('help')}><HelpCircle /> Aide & support</button>
          <button className={portfolioView === 'settings' ? 'active' : ''} onClick={() => goPortfolioView('settings')}><Settings /> Paramètres</button>
          <div className="v2-user-card">
            <span>{(session.user.fullName || 'CL').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}</span>
            <div><strong>{session.user.fullName || session.user.email}</strong><small>Administration CoproLink</small></div>
          </div>
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>

      <section className="v2-main">
        <header className="v2-manager-topbar">
          <div>
            <h1>{portfolioView === 'dashboard' ? `Bonjour ${firstName} 👋` : titleForView(portfolioView)}</h1>
            <p>{subtitleForView(portfolioView)}</p>
          </div>
          <div className="v2-manager-tools">
            {showSearch && <label className="v2-search"><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={searchPlaceholder(portfolioView)} /></label>}
            <div className="release-notification-wrap">
              <button className="v2-icon-btn release-bell" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(value => !value)}>
                <Bell />{notifications.length > 0 && <span className="release-bell-badge">{notifications.length > 9 ? '9+' : notifications.length}</span>}
              </button>
              {notificationsOpen && <NotificationPanel notifications={notifications} onClose={() => setNotificationsOpen(false)} />}
            </div>
          </div>
        </header>

        {portfolioView === 'dashboard' && <DashboardView data={data} filteredBuildings={filteredBuildings} goBuilding={goBuilding} />}
        {portfolioView === 'buildings' && <BuildingsView buildings={filteredBuildings} goBuilding={goBuilding} />}
        {portfolioView === 'tickets' && <TicketsView tickets={filteredTickets} goBuilding={goBuilding} />}
        {portfolioView === 'documents' && <DocumentsView documents={filteredDocuments} goBuilding={goBuilding} />}
        {portfolioView === 'deadlines' && <DeadlinesView events={filteredEvents} goBuilding={goBuilding} />}
        {portfolioView === 'help' && <HelpView session={session} data={data} onRefresh={load} setToast={setToast} />}
        {portfolioView === 'settings' && <SettingsView session={session} prefs={prefs} updatePrefs={updatePrefs} />}
      </section>
    </main>
  )
}

function NotificationPanel({ notifications, onClose }) {
  return (
    <div className="release-notifications">
      <div className="release-notifications-head"><div><strong>Notifications</strong><span>Ce qui mérite votre attention</span></div><button onClick={onClose} aria-label="Fermer"><X size={16} /></button></div>
      <div className="release-notification-list">
        {notifications.length ? notifications.map(item => (
          <button className="release-notification-item" key={item.id} onClick={() => { onClose(); item.onClick() }}>
            <span>{item.icon}</span><span><strong>{item.title}</strong><small>{item.meta}</small></span><em>{item.when}</em>
          </button>
        )) : <div className="release-empty"><CheckCircle2 size={22} /><p>Rien de nouveau pour le moment.</p></div>}
      </div>
    </div>
  )
}

function DashboardView({ data, filteredBuildings, goBuilding }) {
  return (
    <>
      <section className="v2-manager-hero">
        <div className="v2-manager-hero-copy"><CheckCircle2 /><div><h2>{data.summary.attention ? `${data.summary.attention} élément${data.summary.attention > 1 ? 's' : ''} à suivre` : 'Tout est sous contrôle'}</h2><p>CoproLink centralise les informations importantes de vos copropriétés et fait remonter les actions utiles.</p></div></div>
        <div className="v2-manager-stats">
          <article><Building2 /><strong>{data.summary.buildings}</strong><span>copropriétés</span></article>
          <article><Bell /><strong>{data.summary.attention}</strong><span>éléments à traiter</span></article>
          <article><CalendarDays /><strong>{data.summary.upcoming}</strong><span>échéances proches</span></article>
          <article className={data.summary.openTickets ? 'attention' : ''}><AlertTriangle /><strong>{data.summary.openTickets}</strong><span>signalements ouverts</span></article>
        </div>
      </section>
      <div className="v2-manager-grid">
        <section className="v2-panel v2-priority-panel"><div className="v2-panel-head"><div><span>PRIORITÉS</span><h3>À traiter</h3></div></div><div className="v2-priority-list">{data.priority.length === 0 ? <div className="v2-empty"><CheckCircle2 /><strong>Aucune priorité urgente</strong><span>Votre espace est à jour.</span></div> : data.priority.slice(0, 5).map(item => <button key={item.id} onClick={() => goBuilding(item.buildingSlug)}><span className="v2-round-icon"><Wrench /></span><div><strong>{item.buildingName}</strong><small>{item.title}{item.location ? ` · ${item.location}` : ''}</small></div><em className={item.status === 'new' ? 'urgent' : item.status === 'waiting' ? 'wait' : ''}>{ticketLabel(item.status)}</em><ChevronRight /></button>)}</div></section>
        <section className="v2-panel v2-portfolio-panel"><div className="v2-panel-head"><div><span>COPROPRIÉTÉS</span><h3>Vue d’ensemble</h3></div><small>{filteredBuildings.length} copropriété{filteredBuildings.length > 1 ? 's' : ''}</small></div><div className="v2-portfolio-table"><div className="head"><span>Copropriété</span><span>Statut</span><span>Signalements</span><span>Prochaine date</span><span /></div>{filteredBuildings.map(building => <button key={building.id} onClick={() => goBuilding(building.slug)}><span><strong>{building.name}</strong><small>{building.address}</small></span><span><i className={statusClass(building.status)}>{statusLabel(building.status)}</i></span><span className={building.openTickets ? 'v2-count-alert' : ''}>{building.openTickets}</span><span>{building.nextEvent ? relativeDate(building.nextEvent.eventDate) : '—'}</span><ChevronRight /></button>)}</div></section>
        <section className="v2-panel"><div className="v2-panel-head"><div><span>ÉCHÉANCES</span><h3>Prochaines dates</h3></div><CalendarDays /></div><div className="v2-simple-list">{data.upcoming.slice(0, 5).map(item => <button key={item.id} onClick={() => goBuilding(item.buildingSlug)}><CalendarDays /><div><strong>{item.buildingName}</strong><small>{item.title}</small></div><span>{relativeDate(item.eventDate)}</span><ChevronRight /></button>)}{data.upcoming.length === 0 && <p>Aucune échéance proche.</p>}</div></section>
        <section className="v2-panel"><div className="v2-panel-head"><div><span>AUTOMATISATION</span><h3>Inbox intelligente</h3></div><Sparkles /></div><div className="v2-inbox-placeholder ai-ready-card"><BotPreview /><strong>Bientôt disponible</strong><p>CoproLink pourra transformer les e-mails reçus en échéances, documents, signalements et communications structurées.</p></div></section>
        <section className="v2-panel"><div className="v2-panel-head"><div><span>ACTIVITÉ</span><h3>Activité récente</h3></div><Activity /></div><div className="v2-activity-list">{data.activity.slice(0, 5).map(item => <div key={item.id}><span /><p><strong>{item.summary}</strong><small>{item.buildingName || 'CoproLink'} · {new Date(item.createdAt).toLocaleString('fr-BE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></p></div>)}{data.activity.length === 0 && <p>Aucune activité récente.</p>}</div></section>
      </div>
    </>
  )
}

function BuildingsView({ buildings, goBuilding }) {
  return <section className="v2-panel v2-portfolio-panel"><div className="v2-panel-head"><div><span>COPROPRIÉTÉS</span><h3>Tous les immeubles</h3></div><small>{buildings.length}</small></div><div className="v2-portfolio-table"><div className="head"><span>Copropriété</span><span>Statut</span><span>Signalements</span><span>Prochaine date</span><span /></div>{buildings.map(building => <button key={building.id} onClick={() => goBuilding(building.slug)}><span><strong>{building.name}</strong><small>{building.address}</small></span><span><i className={statusClass(building.status)}>{statusLabel(building.status)}</i></span><span className={building.openTickets ? 'v2-count-alert' : ''}>{building.openTickets}</span><span>{building.nextEvent ? relativeDate(building.nextEvent.eventDate) : '—'}</span><ChevronRight /></button>)}</div></section>
}
function TicketsView({ tickets, goBuilding }) {
  return <section className="v2-panel"><div className="v2-panel-head"><div><span>SIGNALEMENTS</span><h3>Tous les signalements</h3></div><small>{tickets.length}</small></div><div className="v2-priority-list">{tickets.length ? tickets.map(item => <button key={item.id} onClick={() => goBuilding(item.buildingSlug)}><span className="v2-round-icon"><Wrench /></span><div><strong>{item.title}</strong><small>{item.buildingName} · {item.reference}{item.location ? ` · ${item.location}` : ''}</small></div><em className={item.status === 'new' ? 'urgent' : item.status === 'waiting' ? 'wait' : ''}>{ticketLabel(item.status)}</em><ChevronRight /></button>) : <div className="v2-empty"><CheckCircle2 /><strong>Aucun signalement</strong><span>Les demandes de vos copropriétés apparaîtront ici.</span></div>}</div></section>
}
function DocumentsView({ documents, goBuilding }) {
  return <section className="v2-panel"><div className="v2-panel-head"><div><span>DOCUMENTS</span><h3>Bibliothèque des copropriétés</h3></div><small>{documents.length}</small></div><div className="v2-simple-list">{documents.length ? documents.map(item => <button key={item.id} onClick={() => goBuilding(item.buildingSlug)}><FileText /><div><strong>{item.name}</strong><small>{item.buildingName} · {item.fileType} · {item.access === 'public' ? 'Public' : 'Privé'}</small></div><span>{dateLabel(item.updatedOn)}</span><ChevronRight /></button>) : <p>Aucun document référencé.</p>}</div></section>
}
function DeadlinesView({ events, goBuilding }) {
  return <section className="v2-panel"><div className="v2-panel-head"><div><span>ÉCHÉANCES</span><h3>Agenda consolidé</h3></div><small>{events.length}</small></div><div className="v2-simple-list">{events.length ? events.map(item => <button key={item.id} onClick={() => goBuilding(item.buildingSlug)}><CalendarDays /><div><strong>{item.title}</strong><small>{item.buildingName}{item.detail ? ` · ${item.detail}` : ''}</small></div><span>{dateLabel(item.eventDate)}{item.eventTime ? ` · ${item.eventTime}` : ''}</span><ChevronRight /></button>) : <p>Aucune échéance à venir.</p>}</div></section>
}

function HelpView({ session, data, onRefresh, setToast }) {
  const copyDiagnostic = async () => {
    const payload = `CoproLink\nCompte: ${session.user.email}\nCopropriétés: ${data.summary.buildings}\nSignalements ouverts: ${data.summary.openTickets}\nNavigateur: ${navigator.userAgent}`
    try { await navigator.clipboard.writeText(payload); setToast?.('Informations de diagnostic copiées.') }
    catch { setToast?.('Impossible de copier automatiquement les informations.') }
  }
  return (
    <div className="release-page">
      <div className="release-grid">
        <section className="release-card wide"><div className="release-card-head"><div><span>DÉMARRAGE RAPIDE</span><h3>Les trois gestes essentiels</h3></div><HelpCircle /></div><div className="release-help-steps"><div className="release-help-step"><b>1</b><strong>Compléter l’annuaire</strong><p>Ajoutez les personnes, leur lot et leur relation avec l’immeuble.</p></div><div className="release-help-step"><b>2</b><strong>Donner accès</strong><p>Ajoutez l’e-mail d’une personne puis invitez-la directement sur CoproLink.</p></div><div className="release-help-step"><b>3</b><strong>Suivre l’immeuble</strong><p>Centralisez signalements, échéances, documents et communications.</p></div></div></section>
        <section className="release-card"><div className="release-card-head"><div><span>FAQ</span><h3>Questions fréquentes</h3></div><Info /></div><div className="release-faq"><details><summary>Qui peut administrer CoproLink ?</summary><p>Les Référents CoproLink autorisés administrent l’espace de l’immeuble. Le rôle reste distinct de celui du syndic.</p></details><details><summary>Une personne doit-elle avoir un compte ?</summary><p>Non. Une personne peut exister dans l’annuaire sans accès numérique. L’invitation est une action séparée.</p></details><details><summary>Les données disparaissent-elles après un refresh ?</summary><p>Non. Les données métier de l’immeuble sont enregistrées dans la base persistante.</p></details></div></section>
        <section className="release-card"><div className="release-card-head"><div><span>SUPPORT</span><h3>Vérifier l’application</h3></div><ShieldCheck /></div><div className="release-note"><Info size={17} /><span>En cas de problème, actualisez d’abord les données. Si le problème persiste, copiez les informations de diagnostic pour les joindre à votre demande de support.</span></div><div className="release-actions"><button className="primary" onClick={async () => { await onRefresh(); setToast?.('Données actualisées.') }}><RefreshCw size={15} /> Actualiser les données</button><button onClick={copyDiagnostic}><ClipboardCopy size={15} /> Copier le diagnostic</button></div></section>
      </div>
    </div>
  )
}

function SettingsView({ session, prefs, updatePrefs }) {
  return (
    <div className="release-page">
      <div className="release-grid">
        <section className="release-card"><div className="release-card-head"><div><span>COMPTE</span><h3>Votre profil</h3></div><Settings /></div><div className="release-profile"><div className="release-field"><span>Nom</span><strong>{session.user.fullName || '—'}</strong></div><div className="release-field"><span>E-mail</span><strong>{session.user.email}</strong></div><div className="release-field"><span>Immeubles accessibles</span><strong>{session.memberships.length}</strong></div><div className="release-field"><span>Type d’accès</span><strong>{session.user.isPlatformAdmin ? 'Administrateur plateforme' : 'Administration CoproLink'}</strong></div></div></section>
        <section className="release-card"><div className="release-card-head"><div><span>NOTIFICATIONS</span><h3>Préférences d’affichage</h3></div><Bell /></div><div className="release-setting"><div><strong>Rappeler les échéances</strong><small>Affichées dans la cloche avant leur date.</small></div><select value={prefs.reminderDays} onChange={e => updatePrefs({ reminderDays: Number(e.target.value) })}><option value={7}>7 jours avant</option><option value={14}>14 jours avant</option><option value={30}>30 jours avant</option></select></div><div className="release-setting"><div><strong>Conserver les éléments résolus</strong><small>Inclure les signalements clôturés dans les notifications.</small></div><input className="release-switch" type="checkbox" checked={prefs.showResolvedNotifications} onChange={e => updatePrefs({ showResolvedNotifications: e.target.checked })} /></div></section>
        <section className="release-card wide"><div className="release-card-head"><div><span>DONNÉES</span><h3>Ce qui est enregistré où</h3></div><ShieldCheck /></div><div className="release-note"><ShieldCheck size={17} /><span>Les personnes, lots, relations, référents et accès de l’immeuble sont enregistrés dans la base CoproLink. Les préférences de cet écran restent uniquement dans ce navigateur et ne modifient pas les données de la copropriété.</span></div></section>
      </div>
    </div>
  )
}

function titleForView(view) {
  return { buildings: 'Copropriétés', tickets: 'Signalements', documents: 'Documents', deadlines: 'Échéances', help: 'Aide & support', settings: 'Paramètres' }[view] || 'Tableau de bord'
}
function subtitleForView(view) {
  return {
    dashboard: 'Voici ce qui mérite votre attention aujourd’hui.', buildings: 'Retrouvez et ouvrez rapidement chaque copropriété.',
    tickets: 'Suivez l’ensemble des demandes et interventions.', documents: 'Retrouvez les documents référencés pour vos immeubles.',
    deadlines: 'Toutes les prochaines dates dans une seule vue.', help: 'Les réponses et outils utiles pour utiliser CoproLink sereinement.',
    settings: 'Gérez votre profil et vos préférences d’interface.',
  }[view] || ''
}
function searchPlaceholder(view) {
  return { dashboard: 'Rechercher une copropriété…', buildings: 'Rechercher une copropriété…', tickets: 'Rechercher un signalement…', documents: 'Rechercher un document…', deadlines: 'Rechercher une échéance…' }[view] || 'Rechercher…'
}
function BotPreview() { return <span className="ai-bot-preview"><Sparkles /><Mail /></span> }
