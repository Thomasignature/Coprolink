import React, { useEffect, useState } from 'react'
import {
  Activity, AlertTriangle, Bell, Building2, CalendarDays, CheckCircle2, ChevronRight,
  Database, Eye, FileText, HelpCircle, LayoutDashboard, LogOut, Mail, Search, Settings, Sparkles, Wrench,
} from 'lucide-react'
import { api } from './api.js'
import { Logo, Spinner, ErrorPanel } from './views.jsx'
import InboxAIView from './inbox-ai.jsx'
import BuildingManagementView from './building-management.jsx'
import PreviewAsView from './preview-as.jsx'
import BuildingModelV3View from './building-model-v3.jsx'

const goBuilding = slug => { location.hash = `/portfolio?view=building&building=${encodeURIComponent(slug)}` }
const goInbox = slug => { location.hash = `/portfolio?view=inbox${slug ? `&building=${encodeURIComponent(slug)}` : ''}` }
const goPreview = slug => { location.hash = `/portfolio?view=preview&building=${encodeURIComponent(slug)}&as=owner` }
const goModelV3 = slug => { location.hash = `/portfolio?view=model-v3&building=${encodeURIComponent(slug)}` }

const statusLabel = status => ({ ok: 'Sous contrôle', watch: 'À surveiller', action: 'Action requise' }[status] || 'Sous contrôle')
const statusClass = status => ({ ok: 'v2-status-ok', watch: 'v2-status-watch', action: 'v2-status-action' }[status] || 'v2-status-ok')

const relativeDate = value => {
  if (!value) return 'Aucune date'
  const target = new Date(`${value}T12:00:00`)
  const diff = Math.ceil((target.getTime() - Date.now()) / 86400000)
  if (diff <= 0) return "aujourd’hui"
  if (diff === 1) return 'demain'
  return `dans ${diff} jours`
}

export default function ManagerPortfolioView({ session, onLogout, setToast }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [query, setQuery] = useState('')
  const params = new URLSearchParams(location.hash.split('?')[1] || '')
  const view = params.get('view') || 'dashboard'
  const buildingSlug = params.get('building') || ''
  const previewRole = params.get('as') || 'owner'
  const inboxMode = view === 'inbox'
  const buildingMode = view === 'building'
  const previewMode = view === 'preview'
  const modelV3Mode = view === 'model-v3'

  const load = async () => {
    setState(s => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }))
    try {
      const data = await api.managerDashboard()
      setState({ status: 'ready', data, error: null })
    } catch (error) {
      setState({ status: 'error', data: null, error: error.message })
    }
  }

  useEffect(() => { if (!inboxMode && !buildingMode && !previewMode && !modelV3Mode) load() }, [inboxMode, buildingMode, previewMode, modelV3Mode])

  if (inboxMode) return <InboxAIView session={session} onLogout={onLogout} />
  if (buildingMode) return <BuildingManagementView session={session} buildingSlug={buildingSlug} onLogout={onLogout} />
  if (previewMode) return <PreviewAsView session={session} buildingSlug={buildingSlug} initialRole={previewRole} onLogout={onLogout} setToast={setToast} />
  if (modelV3Mode) return <BuildingModelV3View buildingSlug={buildingSlug} setToast={setToast} onBack={() => goBuilding(buildingSlug)} />
  if (state.status === 'loading') return <Spinner label="Chargement de votre portefeuille…" />
  if (state.status === 'error') return <ErrorPanel title="Portefeuille indisponible" message={state.error} onRetry={load} />

  const data = state.data
  const firstName = (session.user.fullName || session.user.email).split(' ')[0]
  const needle = query.trim().toLowerCase()
  const filteredBuildings = needle
    ? data.buildings.filter(b => `${b.name} ${b.address}`.toLowerCase().includes(needle))
    : data.buildings

  return (
    <main className="v2-shell v2-manager-shell">
      <aside className="v2-sidebar">
        <Logo />
        <nav>
          <button className="active"><LayoutDashboard /> Tableau de bord</button>
          <button onClick={() => data.buildings[0] && goBuilding(data.buildings[0].slug)}><Building2 /> Copropriétés</button>
          <button onClick={() => data.buildings[0] && goPreview(data.buildings[0].slug)}><Eye /> Prévisualiser</button>
          <button onClick={() => data.buildings[0] && goModelV3(data.buildings[0].slug)}><Database /> Modèle V3</button>
          <button><Wrench /> Signalements</button>
          <button><FileText /> Documents</button>
          <button><CalendarDays /> Échéances</button>
          <button onClick={() => goInbox()}><Sparkles /> Inbox IA <b>BETA</b></button>
        </nav>
        <div className="v2-sidebar-bottom">
          <button><HelpCircle /> Aide & support</button>
          <button><Settings /> Paramètres</button>
          <div className="v2-user-card">
            <span>{(session.user.fullName || 'SY').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}</span>
            <div><strong>{session.user.fullName || session.user.email}</strong><small>Gestion des copropriétés</small></div>
          </div>
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>

      <section className="v2-main">
        <header className="v2-manager-topbar">
          <div>
            <h1>Bonjour {firstName} 👋</h1>
            <p>Voici la situation de votre portefeuille aujourd’hui.</p>
          </div>
          <div className="v2-manager-tools">
            <label className="v2-search"><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher une copropriété…" /></label>
            <button className="v2-icon-btn" aria-label="Notifications"><Bell /></button>
          </div>
        </header>

        <section className="v2-manager-hero">
          <div className="v2-manager-hero-copy">
            <CheckCircle2 />
            <div><h2>Votre portefeuille est sous contrôle</h2><p>CoproLink veille sur vos copropriétés et met en avant uniquement ce qui mérite votre attention.</p></div>
          </div>
          <div className="v2-manager-stats">
            <article><Building2 /><strong>{data.summary.buildings}</strong><span>copropriétés</span></article>
            <article><Bell /><strong>{data.summary.attention}</strong><span>éléments à traiter</span></article>
            <article><CalendarDays /><strong>{data.summary.upcoming}</strong><span>échéances proches</span></article>
            <article className={data.summary.openTickets ? 'attention' : ''}><AlertTriangle /><strong>{data.summary.openTickets}</strong><span>incidents ouverts</span></article>
          </div>
        </section>

        <div className="v2-manager-grid">
          <section className="v2-panel v2-priority-panel">
            <div className="v2-panel-head"><div><span>PRIORITÉS</span><h3>À traiter aujourd’hui</h3></div><button>Voir tout <ChevronRight /></button></div>
            <div className="v2-priority-list">
              {data.priority.length === 0
                ? <div className="v2-empty"><CheckCircle2 /><strong>Aucune priorité urgente</strong><span>Votre portefeuille est à jour.</span></div>
                : data.priority.slice(0, 5).map(item => (
                  <button key={item.id} onClick={() => goBuilding(item.buildingSlug)}>
                    <span className="v2-round-icon"><Wrench /></span>
                    <div><strong>{item.buildingName}</strong><small>{item.title}{item.location ? ` · ${item.location}` : ''}</small></div>
                    <em className={item.status === 'new' ? 'urgent' : item.status === 'waiting' ? 'wait' : ''}>{item.status === 'new' ? 'Nouveau' : item.status === 'waiting' ? 'À relancer' : 'En cours'}</em>
                    <ChevronRight />
                  </button>
                ))}
            </div>
          </section>

          <section className="v2-panel v2-portfolio-panel">
            <div className="v2-panel-head"><div><span>PORTEFEUILLE</span><h3>Vue d’ensemble</h3></div><small>{filteredBuildings.length} copropriété{filteredBuildings.length > 1 ? 's' : ''}</small></div>
            <div className="v2-portfolio-table">
              <div className="head"><span>Copropriété</span><span>Statut</span><span>Incidents</span><span>Prochaine date</span><span /></div>
              {filteredBuildings.map(building => (
                <button key={building.id} onClick={() => goBuilding(building.slug)}>
                  <span><strong>{building.name}</strong><small>{building.address}</small></span>
                  <span><i className={statusClass(building.status)}>{statusLabel(building.status)}</i></span>
                  <span className={building.openTickets ? 'v2-count-alert' : ''}>{building.openTickets}</span>
                  <span>{building.nextEvent ? relativeDate(building.nextEvent.eventDate) : '—'}</span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          </section>

          <section className="v2-panel">
            <div className="v2-panel-head"><div><span>ÉCHÉANCES</span><h3>Prochaines dates</h3></div><CalendarDays /></div>
            <div className="v2-simple-list">
              {data.upcoming.slice(0, 5).map(item => (
                <button key={item.id} onClick={() => goBuilding(item.buildingSlug)}>
                  <CalendarDays /><div><strong>{item.buildingName}</strong><small>{item.title}</small></div><span>{relativeDate(item.eventDate)}</span><ChevronRight />
                </button>
              ))}
              {data.upcoming.length === 0 && <p>Aucune échéance proche.</p>}
            </div>
          </section>

          <section className="v2-panel">
            <div className="v2-panel-head"><div><span>INBOX IA</span><h3>Transformer les e-mails en actions</h3></div><Sparkles /></div>
            <div className="v2-inbox-placeholder ai-ready-card">
              <BotPreview />
              <strong>Le prototype intelligent est prêt à tester</strong>
              <p>Collez un e-mail : CoproLink détecte les dates, classe les pièces jointes, rattache les tickets et prépare les communications.</p>
              <button className="ai-mini-launch" onClick={() => goInbox()}>Ouvrir l’Inbox IA <ChevronRight /></button>
            </div>
          </section>

          <section className="v2-panel">
            <div className="v2-panel-head"><div><span>ACTIVITÉ</span><h3>Activité récente</h3></div><Activity /></div>
            <div className="v2-activity-list">
              {data.activity.slice(0, 5).map(item => (
                <div key={item.id}><span /><p><strong>{item.summary}</strong><small>{item.buildingName || 'CoproLink'} · {new Date(item.createdAt).toLocaleString('fr-BE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></p></div>
              ))}
              {data.activity.length === 0 && <p>Aucune activité récente.</p>}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}

function BotPreview() {
  return <span className="ai-bot-preview"><Sparkles /><Mail /></span>
}
