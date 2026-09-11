import React, { useEffect, useRef, useState } from 'react'
import {
  Activity, ArrowLeft, Bell, BookOpen, Building2, CalendarDays, Check, ChevronRight, CircleDashed,
  CircleCheckBig, Clock3, ExternalLink, FileText, Gauge, Home, Info, LayoutDashboard, LogOut, Mail,
  MessageSquareText, Plus, Search, ShieldCheck, Smartphone, Sparkles, TicketCheck, Trash2, Users,
  WalletCards, Wrench, X,
} from 'lucide-react'
import { dayAndTime, dayNumber, longDate, metaFor, money, monthShort, roleLabel, shortDate, statusMeta, timelineDate } from './format.js'

export function Logo({ compact = false }) {
  return (
    <div className="logo-lockup">
      <div className="logo-mark"><Building2 size={compact ? 18 : 22} /></div>
      {!compact && <div><strong>CoproLink</strong><span>Building OS</span></div>}
    </div>
  )
}

/**
 * Enveloppe commune des fenêtres modales : fermeture au clavier, rôle ARIA et
 * focus initial. Sans cela, l'application était inutilisable au clavier et
 * inaudible pour un lecteur d'écran.
 */
function Modal({ onClose, labelledBy, className = 'modal-card', backdropClass = 'modal-backdrop', children }) {
  const panel = useRef(null)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={backdropClass} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={panel}>
        {children}
      </div>
    </div>
  )
}

export function Spinner({ label = 'Chargement…' }) {
  return <div className="loading-panel" role="status" aria-live="polite"><span className="loading-dot" />{label}</div>
}

export function ErrorPanel({ title = 'Une erreur est survenue', message, onRetry, retryLabel = 'Réessayer' }) {
  return (
    <div className="error-panel" role="alert">
      <h3>{title}</h3>
      <p>{message}</p>
      {onRetry && <button className="primary-btn" onClick={onRetry}>{retryLabel}</button>}
    </div>
  )
}

export function EmptyState({ icon, title, text }) {
  return <div className="empty-state">{icon}<h3>{title}</h3><p>{text}</p></div>
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="clock">
      <strong>{new Intl.DateTimeFormat('fr-BE', { hour: '2-digit', minute: '2-digit' }).format(now)}</strong>
      <span>{new Intl.DateTimeFormat('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</span>
    </div>
  )
}

function PageTitle({ kicker, title, onBack }) {
  return (
    <div className="page-title">
      <button className="icon-btn" onClick={onBack} aria-label="Retour"><ArrowLeft /></button>
      <div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div>
    </div>
  )
}

function DockButton({ icon, label, active, onClick }) {
  return (
    <button className={'dock-btn ' + (active ? 'active' : '')} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {icon}<span>{label}</span>
    </button>
  )
}

function NavItem({ icon, label, badge, active, onClick }) {
  return (
    <button className={'nav-item ' + (active ? 'active' : '')} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {icon}<span>{label}</span>{badge > 0 && <b>{badge}</b>}
    </button>
  )
}

function AgendaRow({ e }) {
  return (
    <div className="agenda-row">
      <div className="agenda-date"><strong>{dayNumber(e.eventDate)}</strong><span>{monthShort(e.eventDate)}</span></div>
      <div><strong>{e.title}</strong><p>{e.detail}</p></div>
      <time>{e.eventTime}</time>
    </div>
  )
}

function DocumentTile({ d, onOpen }) {
  return (
    <button className="document-tile" onClick={() => onOpen(d)}>
      <div className="doc-icon"><FileText /></div>
      <div>
        <strong>{d.name}</strong>
        <span>Mis à jour le {longDate(d.updatedOn)}{d.access === 'private' ? ' · privé' : ''}</span>
      </div>
      <ExternalLink size={18} />
    </button>
  )
}

function MiniTimeline({ timeline = [] }) {
  if (timeline.length === 0) return <p className="muted-p">Historique en cours de constitution.</p>
  return (
    <div className="mini-timeline">
      {timeline.map((step, i) => (
        <div key={i}>
          <span />
          <p><strong>{step.label}</strong><small>{timelineDate(step.date)}</small>{step.note ? <em>{step.note}</em> : null}</p>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Écran des communs. Alimenté par /api/display et un jeton de terminal.
 * ------------------------------------------------------------------ */

export function DisplayView({ data, onReport, onRefresh, setToast }) {
  const [tab, setTab] = useState('home')
  const [reportOpen, setReportOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const active = data.tickets

  useEffect(() => {
    let timer
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { setTab('home'); setReportOpen(false); setSelected(null) }, 120000)
    }
    const handlers = ['pointerdown', 'keydown']
    handlers.forEach(e => addEventListener(e, reset))
    reset()
    return () => { clearTimeout(timer); handlers.forEach(e => removeEventListener(e, reset)) }
  }, [])

  // Rafraîchissement périodique : la tablette reflète les changements du syndic
  // sans intervention sur place.
  useEffect(() => {
    const t = setInterval(onRefresh, 60000)
    return () => clearInterval(t)
  }, [onRefresh])

  const headline = active.length === 0
    ? 'Aucune intervention en cours'
    : `${active.length} intervention${active.length > 1 ? 's' : ''} suivie${active.length > 1 ? 's' : ''} dans la résidence.`

  return (
    <main className="display-shell">
      <header className="display-top">
        <Logo />
        <div className="display-building">
          <span>{data.building.name}</span>
          <small>{data.building.address}</small>
        </div>
        <Clock />
      </header>
      <section className="display-main">
        <div className="display-content">
          {tab === 'home' && (
            <>
              <div className="building-status">
                <div><span className="pulse-dot" /><strong>Tout fonctionne normalement</strong></div>
                <p>{headline}</p>
              </div>
              <div className="display-grid">
                <div className="big-panel">
                  <div className="section-head">
                    <div><span className="section-kicker">Suivi en cours</span><h2>Ce qui se passe dans l'immeuble</h2></div>
                    <button className="text-btn" onClick={() => setTab('tickets')}>Tout voir <ChevronRight size={17} /></button>
                  </div>
                  <div className="ticket-stack">
                    {active.length === 0
                      ? <EmptyState icon={<TicketCheck />} title="Rien à signaler" text="Aucune intervention publique en cours." />
                      : active.slice(0, 3).map(t => <DisplayTicket key={t.reference} t={t} onClick={() => setSelected(t)} />)}
                  </div>
                </div>
                <div className="side-stack">
                  {data.announcements[0]
                    ? <AnnouncementCard item={data.announcements[0]} />
                    : <EmptyState icon={<Bell />} title="Aucune communication" text="Les informations du syndic s'afficheront ici." />}
                  {data.events[0] && <NextEvent event={data.events[0]} />}
                </div>
              </div>
            </>
          )}
          {tab === 'tickets' && (
            <div className="big-panel full">
              <PageTitle kicker="Interventions" title="Suivi de la résidence" onBack={() => setTab('home')} />
              <div className="ticket-stack">
                {active.length === 0
                  ? <EmptyState icon={<TicketCheck />} title="Rien à signaler" text="Aucune intervention publique en cours." />
                  : active.map(t => <DisplayTicket key={t.reference} t={t} onClick={() => setSelected(t)} />)}
              </div>
            </div>
          )}
          {tab === 'agenda' && (
            <div className="big-panel full">
              <PageTitle kicker="Agenda" title="Prochaines dates" onBack={() => setTab('home')} />
              <div className="agenda-list">
                {data.events.length === 0
                  ? <EmptyState icon={<CalendarDays />} title="Aucune date" text="L'agenda est vide pour le moment." />
                  : data.events.map(e => <AgendaRow key={e.id} e={e} />)}
              </div>
            </div>
          )}
          {tab === 'docs' && (
            <div className="big-panel full">
              <PageTitle kicker="Documents publics" title="Informations pratiques" onBack={() => setTab('home')} />
              <div className="document-grid">
                {data.documents.length === 0
                  ? <EmptyState icon={<FileText />} title="Aucun document" text="Les documents publics apparaîtront ici." />
                  : data.documents.map(d => (
                    <DocumentTile key={d.id} d={d} onOpen={() => setToast('Le stockage des documents n\'est pas encore activé')} />
                  ))}
              </div>
            </div>
          )}
        </div>
        <nav className="display-dock">
          <DockButton active={tab === 'home'} icon={<Home />} label="Accueil" onClick={() => setTab('home')} />
          <DockButton active={tab === 'tickets'} icon={<Wrench />} label="Interventions" onClick={() => setTab('tickets')} />
          {data.terminal.canReport
            ? <button className="report-fab" onClick={() => setReportOpen(true)}><Plus size={26} /><span>Signaler</span></button>
            : <span className="report-fab disabled" aria-hidden="true"><Plus size={26} /><span>Signaler</span></span>}
          <DockButton active={tab === 'agenda'} icon={<CalendarDays />} label="Agenda" onClick={() => setTab('agenda')} />
          <DockButton active={tab === 'docs'} icon={<FileText />} label="Documents" onClick={() => setTab('docs')} />
        </nav>
      </section>
      {reportOpen && (
        <ReportModal onClose={() => setReportOpen(false)} onSubmit={onReport} setToast={setToast} />
      )}
      {selected && <TicketModal ticket={selected} onClose={() => setSelected(null)} publicView />}
    </main>
  )
}

function DisplayTicket({ t, onClick }) {
  const m = metaFor(t.status)
  return (
    <button className="display-ticket" onClick={onClick}>
      <div className="ticket-icon"><Wrench /></div>
      <div className="ticket-copy">
        <div><strong>{t.title}</strong><span className={'status ' + m.cls}>{m.label}</span></div>
        <p>{t.nextStep}</p>
        <small>{t.location}</small>
      </div>
      <ChevronRight />
    </button>
  )
}

function AnnouncementCard({ item }) {
  return (
    <article className="notice-card">
      <div className="notice-icon"><Bell /></div>
      <span className="section-kicker">À savoir</span>
      <h3>{item.title}</h3>
      <p>{item.body}</p>
      <small>Publié le {longDate(item.publishedOn)}</small>
    </article>
  )
}

function NextEvent({ event }) {
  return (
    <article className="next-event">
      <div className="date-block"><strong>{dayNumber(event.eventDate)}</strong><span>{monthShort(event.eventDate)}</span></div>
      <div>
        <span className="section-kicker">Prochaine intervention</span>
        <h3>{event.title}</h3>
        <p>{event.detail}{event.eventTime ? ` · ${event.eventTime}` : ''}</p>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ *
 * Espace copropriétaire.
 * ------------------------------------------------------------------ */

export function ResidentView({ data, session, onReport, onLogout, setToast }) {
  const [section, setSection] = useState('overview')
  const [report, setReport] = useState(false)
  const openCount = data.myTickets.filter(t => t.status !== 'resolved').length

  return (
    <main className="app-shell">
      <aside className="side-nav">
        <Logo />
        <div className="nav-building">
          <Building2 />
          <div><strong>{data.building.name}</strong><span>{data.member?.unitLabel || roleLabel(data.role)}</span></div>
        </div>
        <nav>
          <NavItem icon={<LayoutDashboard />} label="Vue d'ensemble" active={section === 'overview'} onClick={() => setSection('overview')} />
          <NavItem icon={<Wrench />} label="Mes demandes" badge={openCount} active={section === 'tickets'} onClick={() => setSection('tickets')} />
          <NavItem icon={<FileText />} label="Documents" active={section === 'documents'} onClick={() => setSection('documents')} />
          <NavItem icon={<WalletCards />} label="Finances" active={section === 'finance'} onClick={() => setSection('finance')} />
          <NavItem icon={<CalendarDays />} label="Agenda" active={section === 'agenda'} onClick={() => setSection('agenda')} />
        </nav>
        <div className="side-bottom">
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>
      <section className="app-content">
        <MobileHeader title="CoproLink" onExit={onLogout} />
        <div className="content-wrap">
          {section === 'overview' && <ResidentOverview data={data} session={session} setSection={setSection} setReport={setReport} />}
          {section === 'tickets' && <ResidentTickets tickets={data.myTickets} onReport={() => setReport(true)} />}
          {section === 'documents' && <DocumentsSection docs={data.documents} setToast={setToast} />}
          {section === 'finance' && <ResidentFinance data={data} />}
          {section === 'agenda' && <AgendaSection events={data.events} />}
        </div>
        <MobileNav section={section} setSection={setSection} />
      </section>
      {report && <ReportModal onClose={() => setReport(false)} onSubmit={onReport} setToast={setToast} allowPrivate />}
    </main>
  )
}

function MobileHeader({ title, onExit }) {
  return (
    <header className="mobile-header">
      <Logo compact /><strong>{title}</strong>
      <button className="icon-btn" onClick={onExit} aria-label="Se déconnecter"><LogOut /></button>
    </header>
  )
}

function MobileNav({ section, setSection }) {
  return (
    <nav className="mobile-bottom-nav">
      <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}><Home /><span>Accueil</span></button>
      <button className={section === 'tickets' ? 'active' : ''} onClick={() => setSection('tickets')}><Wrench /><span>Demandes</span></button>
      <button className={section === 'documents' ? 'active' : ''} onClick={() => setSection('documents')}><FileText /><span>Documents</span></button>
      <button className={section === 'finance' ? 'active' : ''} onClick={() => setSection('finance')}><WalletCards /><span>Finances</span></button>
    </nav>
  )
}

function ResidentOverview({ data, session, setSection, setReport }) {
  const open = data.buildingTickets.filter(t => t.status !== 'resolved')
  const nextEvent = data.events[0]
  const firstName = (session.user.fullName || session.user.email).split(' ')[0]

  return (
    <>
      <div className="content-heading">
        <div><span className="overline">Bonjour {firstName}</span><h1>Votre résidence, en un coup d'œil.</h1></div>
        <button className="primary-btn" onClick={() => setReport(true)}><Plus /> Signaler un problème</button>
      </div>
      <div className="resident-grid">
        <section className="span-2 card welcome-card">
          <div>
            <div className="eyebrow soft"><ShieldCheck /> {roleLabel(data.role)}</div>
            <h2>{data.building.name}</h2>
            <p>
              {open.length} intervention{open.length > 1 ? 's' : ''} en cours.
              {nextEvent ? ` La prochaine date est le ${longDate(nextEvent.eventDate)}.` : ' Aucune date planifiée.'}
            </p>
          </div>
          {data.building.healthScore > 0 && (
            <div className="health-ring"><strong>{data.building.healthScore}</strong><span>/100</span><small>Indice bâtiment</small></div>
          )}
        </section>
        <MetricCard icon={<WalletCards />} label="Prochain appel de fonds" value={money(data.member?.quarterlyCall)} helper="Montant enregistré par le syndic" />
        <MetricCard
          icon={<CircleCheckBig />}
          label="Situation"
          value={Number(data.member?.balance) > 0 ? money(data.member.balance) : 'À jour'}
          helper={Number(data.member?.balance) > 0 ? 'Solde ouvert' : 'Aucun solde à payer'}
          positive={!(Number(data.member?.balance) > 0)}
        />
        <section className="card span-2">
          <div className="card-head">
            <div><span className="overline">Interventions</span><h3>En cours dans l'immeuble</h3></div>
            <button className="text-btn" onClick={() => setSection('tickets')}>Mes demandes <ChevronRight /></button>
          </div>
          <div className="compact-tickets">
            {open.length === 0
              ? <EmptyState icon={<TicketCheck />} title="Aucune intervention" text="Rien n'est en cours dans les communs." />
              : open.slice(0, 3).map(t => <CompactTicket key={t.reference} t={t} />)}
          </div>
        </section>
        {data.announcements[0] && (
          <section className="card">
            <div className="card-head"><div><span className="overline">Communication</span><h3>{data.announcements[0].title}</h3></div></div>
            <p className="muted-p">{data.announcements[0].body}</p>
            <small className="subtle">{longDate(data.announcements[0].publishedOn)}</small>
          </section>
        )}
        {nextEvent && (
          <section className="card">
            <div className="card-head"><div><span className="overline">Prochaine date</span><h3>{nextEvent.title}</h3></div><CalendarDays /></div>
            <p className="event-big">{shortDate(nextEvent.eventDate)} <span>· {nextEvent.eventTime}</span></p>
            <small className="subtle">{nextEvent.detail}</small>
          </section>
        )}
      </div>
    </>
  )
}

function MetricCard({ icon, label, value, helper, positive }) {
  return (
    <article className="card metric">
      <div className={'metric-icon ' + (positive ? 'positive' : '')}>{icon}</div>
      <span>{label}</span><strong>{value}</strong><small>{helper}</small>
    </article>
  )
}

function CompactTicket({ t }) {
  const m = metaFor(t.status)
  return (
    <div className="compact-ticket">
      <div className="ticket-icon sm"><Wrench /></div>
      <div><strong>{t.title}</strong><span>{t.nextStep}</span></div>
      <span className={'status ' + m.cls}>{m.label}</span>
    </div>
  )
}

function ResidentTickets({ tickets, onReport }) {
  return (
    <>
      <div className="content-heading">
        <div>
          <span className="overline">Demandes</span><h1>Suivez vos signalements.</h1>
          <p>Plus besoin de relancer pour savoir où en est une intervention.</p>
        </div>
        <button className="primary-btn" onClick={onReport}><Plus /> Nouveau signalement</button>
      </div>
      <section className="card">
        <div className="timeline-list">
          {tickets.length
            ? tickets.map(t => <ResidentTicket key={t.reference} t={t} />)
            : <EmptyState icon={<TicketCheck />} title="Aucune demande" text="Vos signalements personnels apparaîtront ici." />}
        </div>
      </section>
    </>
  )
}

function ResidentTicket({ t }) {
  const m = metaFor(t.status)
  // Les étapes atteintes sont déduites de l'historique réellement écrit en base.
  const reachedLabels = new Set((t.timeline ?? []).map(s => s.label))
  const steps = [
    { label: 'Signalé', done: true },
    { label: 'Pris en charge', done: reachedLabels.has('Pris en charge') || reachedLabels.has('En attente d\'un tiers') || reachedLabels.has('Rendez-vous confirmé') || t.status === 'resolved' },
    { label: 'Planifié', done: reachedLabels.has('Rendez-vous confirmé') || t.status === 'resolved' },
    { label: 'Résolu', done: t.status === 'resolved' },
  ]

  return (
    <article className="resident-ticket">
      <div className="ticket-top">
        <div><span className="overline">{t.reference} · {t.location}</span><h3>{t.title}</h3></div>
        <span className={'status ' + m.cls}>{m.label}</span>
      </div>
      <p>{t.description}</p>
      <div className="steps">
        {steps.map(s => (
          <div className={s.done ? 'done' : ''} key={s.label}>
            <span>{s.done ? <Check /> : <CircleDashed />}</span><small>{s.label}</small>
          </div>
        ))}
      </div>
      <div className="ticket-next"><Clock3 /><span>{t.nextStep}</span></div>
    </article>
  )
}

function DocumentsSection({ docs, setToast }) {
  return (
    <>
      <div className="content-heading">
        <div>
          <span className="overline">Documents</span><h1>Tout retrouver au même endroit.</h1>
          <p>Documents de l'ACP et documents réservés à votre espace.</p>
        </div>
      </div>
      <div className="notice-inline">
        <Info size={16} />
        <span>Les fichiers ne sont pas encore stockés sur la plateforme : seules leurs fiches sont référencées.</span>
      </div>
      <div className="document-list">
        {docs.length === 0
          ? <EmptyState icon={<FileText />} title="Aucun document" text="Le syndic n'a référencé aucun document." />
          : docs.map(d => <DocumentTile key={d.id} d={d} onOpen={() => setToast('Le stockage des documents n\'est pas encore activé')} />)}
      </div>
    </>
  )
}

function ResidentFinance({ data }) {
  const { yearlyBudget, yearlySpent, reserveFund } = data.building
  const pct = yearlyBudget > 0 ? Math.round((yearlySpent / yearlyBudget) * 100) : 0
  const balance = Number(data.member?.balance) || 0

  return (
    <>
      <div className="content-heading">
        <div>
          <span className="overline">Finances</span><h1>Comprendre avant de payer.</h1>
          <p>Une vue simple des principaux éléments financiers de la copropriété.</p>
        </div>
      </div>
      <div className="finance-grid">
        <section className="card finance-hero">
          <span className="overline">Votre situation</span>
          {balance > 0
            ? <div className="paid-badge open"><Clock3 /> Solde ouvert</div>
            : <div className="paid-badge"><CircleCheckBig /> À jour</div>}
          <h2>{money(data.member?.quarterlyCall)}</h2>
          <p>Prochain appel enregistré pour {data.member?.unitLabel || 'votre lot'}</p>
        </section>
        <section className="card">
          <span className="overline">Fonds de réserve ACP</span>
          <h2 className="big-money">{money(reserveFund)}</h2>
          <p className="muted-p">Réserve disponible pour anticiper les travaux importants.</p>
        </section>
        <section className="card span-2">
          <div className="card-head">
            <div><span className="overline">Budget annuel</span><h3>{money(yearlySpent)} consommés sur {money(yearlyBudget)}</h3></div>
            <strong>{pct}%</strong>
          </div>
          <div className="progress"><span style={{ width: pct + '%' }} /></div>
          <p className="muted-p">Les détails comptables restent issus du logiciel métier du syndic.</p>
        </section>
      </div>
    </>
  )
}

function AgendaSection({ events }) {
  return (
    <>
      <div className="content-heading"><div><span className="overline">Agenda</span><h1>Les dates qui comptent.</h1></div></div>
      <section className="card">
        <div className="agenda-list">
          {events.length === 0
            ? <EmptyState icon={<CalendarDays />} title="Aucune date" text="L'agenda est vide pour le moment." />
            : events.map(e => <AgendaRow key={e.id} e={e} />)}
        </div>
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Espace syndic.
 * ------------------------------------------------------------------ */

export function SyndicView({ data, session, actions, onLogout, setToast }) {
  const [section, setSection] = useState('dashboard')
  const [selected, setSelected] = useState(null)
  const [compose, setCompose] = useState(false)
  const [eventOpen, setEventOpen] = useState(false)

  const tickets = data.buildingTickets
  const open = tickets.filter(t => t.status !== 'resolved')
  const counts = {
    new: tickets.filter(t => t.status === 'new').length,
    waiting: tickets.filter(t => t.status === 'waiting').length,
    scheduled: tickets.filter(t => t.status === 'scheduled').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
  }

  const changeStatus = async (ticket, status) => {
    try {
      const updated = await actions.updateTicketStatus(ticket.reference, status)
      setSelected(updated)
      setToast('Statut mis à jour pour tous les utilisateurs')
    } catch (error) {
      setToast(error.message)
    }
  }

  const current = selected ? tickets.find(t => t.reference === selected.reference) ?? selected : null

  return (
    <main className="app-shell syndic-shell">
      <aside className="side-nav">
        <Logo />
        <div className="nav-building">
          <Building2 />
          <div><strong>{data.building.name}</strong><span>{data.building.lots} lots</span></div>
        </div>
        <nav>
          <NavItem icon={<LayoutDashboard />} label="Pilotage" active={section === 'dashboard'} onClick={() => setSection('dashboard')} />
          <NavItem icon={<TicketCheck />} label="Demandes" badge={open.length} active={section === 'tickets'} onClick={() => setSection('tickets')} />
          <NavItem icon={<MessageSquareText />} label="Communications" active={section === 'comms'} onClick={() => setSection('comms')} />
          <NavItem icon={<CalendarDays />} label="Agenda" active={section === 'agenda'} onClick={() => setSection('agenda')} />
          <NavItem icon={<FileText />} label="Documents" active={section === 'docs'} onClick={() => setSection('docs')} />
          <NavItem icon={<Gauge />} label="Écrans" active={section === 'terminals'} onClick={() => setSection('terminals')} />
          <NavItem icon={<Users />} label="Accès" active={section === 'members'} onClick={() => setSection('members')} />
        </nav>
        <div className="automation-note">
          <Sparkles />
          <div><strong>{roleLabel(data.role)}</strong><span>{session.user.email}</span></div>
        </div>
        <div className="side-bottom"><button onClick={onLogout}><LogOut /> Se déconnecter</button></div>
      </aside>
      <section className="app-content">
        <MobileHeader title="Espace syndic" onExit={onLogout} />
        <div className="content-wrap syndic-wrap">
          {section === 'dashboard' && (
            <SyndicDashboard
              data={data} counts={counts} open={open}
              setSelected={setSelected} setSection={setSection} setCompose={setCompose}
            />
          )}
          {section === 'tickets' && <SyndicTickets tickets={tickets} setSelected={setSelected} />}
          {section === 'comms' && <SyndicComms data={data} setCompose={setCompose} />}
          {section === 'agenda' && <SyndicAgenda events={data.events} onAdd={() => setEventOpen(true)} />}
          {section === 'docs' && <DocumentsSection docs={data.documents} setToast={setToast} />}
          {section === 'terminals' && <TerminalsPanel actions={actions} setToast={setToast} />}
          {section === 'members' && <MembersPanel actions={actions} setToast={setToast} />}
        </div>
      </section>
      {current && <SyndicTicketDrawer ticket={current} onClose={() => setSelected(null)} changeStatus={changeStatus} />}
      {compose && (
        <ComposeModal
          onClose={() => setCompose(false)}
          onPublish={async payload => {
            try {
              await actions.publishAnnouncement(payload)
              setCompose(false)
              setToast(payload.isPublic ? 'Communication publiée sur l\'app et l\'écran' : 'Communication publiée dans l\'app')
            } catch (error) { setToast(error.message) }
          }}
        />
      )}
      {eventOpen && (
        <EventModal
          onClose={() => setEventOpen(false)}
          onCreate={async payload => {
            try {
              await actions.createEvent(payload)
              setEventOpen(false)
              setToast('Date ajoutée à l\'agenda')
            } catch (error) { setToast(error.message) }
          }}
        />
      )}
    </main>
  )
}

function SyndicDashboard({ data, counts, open, setSelected, setSection, setCompose }) {
  return (
    <>
      <div className="content-heading">
        <div>
          <span className="overline">Pilotage · {data.building.name}</span>
          <h1>Voici ce qui mérite votre attention.</h1>
          <p>File opérationnelle et dernières activités enregistrées.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-btn" onClick={() => setCompose(true)}><Mail /> Nouvelle communication</button>
          <button className="primary-btn" onClick={() => setSection('tickets')}><TicketCheck /> Traiter les demandes</button>
        </div>
      </div>
      <div className="manager-metrics">
        <ManagerMetric label="Nouvelles demandes" value={counts.new} helper="à qualifier" tone="blue" />
        <ManagerMetric label="En attente" value={counts.waiting} helper="d'un tiers" tone="violet" />
        <ManagerMetric label="Planifiées" value={counts.scheduled} helper="avec date confirmée" tone="teal" />
        <ManagerMetric label="Résolues" value={counts.resolved} helper="dossiers clôturés" tone="green" />
      </div>
      <div className="manager-grid">
        <section className="card span-2">
          <div className="card-head">
            <div><span className="overline">À traiter</span><h3>File opérationnelle</h3></div>
            <button className="text-btn" onClick={() => setSection('tickets')}>Voir tout <ChevronRight /></button>
          </div>
          <div className="manager-ticket-list">
            {open.length === 0
              ? <EmptyState icon={<TicketCheck />} title="File vide" text="Aucune demande ouverte." />
              : open.slice(0, 4).map(t => (
                <button key={t.reference} onClick={() => setSelected(t)}>
                  <div className="ticket-icon sm"><Wrench /></div>
                  <div><strong>{t.title}</strong><span>{t.reference} · {t.location}</span></div>
                  <span className={'status ' + metaFor(t.status).cls}>{metaFor(t.status).label}</span>
                  <ChevronRight />
                </button>
              ))}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div><span className="overline">Activité</span><h3>Journal de l'immeuble</h3></div><Activity /></div>
          <div className="activity-feed">
            {data.activity.length === 0
              ? <p className="muted-p">Aucune activité enregistrée.</p>
              : data.activity.slice(0, 5).map(a => (
                <div key={a.id}><span /><p>{a.summary}<small>{a.actorLabel} · {dayAndTime(a.createdAt)}</small></p></div>
              ))}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><div><span className="overline">Diffusion</span><h3>Une saisie, trois canaux</h3></div><Sparkles /></div>
          <div className="channel-list">
            <span><Smartphone /> App copropriétaires <Check /></span>
            <span><Gauge /> Écran du hall <Check /></span>
            <span><BookOpen /> Journal d'audit ACP <Check /></span>
          </div>
          <p className="muted-p">Chaque changement de statut est écrit une fois et lu partout.</p>
        </section>
      </div>
    </>
  )
}

function ManagerMetric({ label, value, helper, tone }) {
  return <article className={'manager-metric ' + tone}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>
}

function SyndicTickets({ tickets, setSelected }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const visible = tickets.filter(t =>
    (filter === 'all' || t.status === filter) &&
    `${t.reference} ${t.title} ${t.location}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <>
      <div className="content-heading">
        <div><span className="overline">Demandes</span><h1>Une file claire, sans e-mails dispersés.</h1></div>
      </div>
      <div className="toolbar">
        <div className="search-box">
          <Search />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un ticket…" aria-label="Rechercher un ticket" />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filtrer par statut">
          <option value="all">Tous les statuts</option>
          {Object.entries(statusMeta).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
        </select>
      </div>
      <section className="card table-card">
        <div className="ticket-table">
          <div className="ticket-row head"><span>Demande</span><span>Lieu</span><span>Statut</span><span>Suite</span><span /></div>
          {visible.length === 0
            ? <EmptyState icon={<TicketCheck />} title="Aucun résultat" text="Aucune demande ne correspond à ce filtre." />
            : visible.map(t => (
              <button className="ticket-row" key={t.reference} onClick={() => setSelected(t)}>
                <span><strong>{t.title}</strong><small>{t.reference} · {longDate(t.createdAt)}</small></span>
                <span>{t.location}</span>
                <span><i className={'status ' + metaFor(t.status).cls}>{metaFor(t.status).label}</i></span>
                <span>{t.nextStep}</span>
                <ChevronRight />
              </button>
            ))}
        </div>
      </section>
    </>
  )
}

function SyndicComms({ data, setCompose }) {
  return (
    <>
      <div className="content-heading">
        <div>
          <span className="overline">Communications</span><h1>Informer une fois, partout.</h1>
          <p>Une publication marquée publique alimente aussi l'écran des communs.</p>
        </div>
        <button className="primary-btn" onClick={() => setCompose(true)}><Plus /> Nouvelle communication</button>
      </div>
      <div className="communication-list">
        {data.announcements.length === 0
          ? <EmptyState icon={<MessageSquareText />} title="Aucune communication" text="Publiez une première information." />
          : data.announcements.map(a => (
            <article className="card" key={a.id}>
              <div className="card-head">
                <div><span className="overline">Publié le {longDate(a.publishedOn)}</span><h3>{a.title}</h3></div>
                <span className="status status-green">Publié</span>
              </div>
              <p className="muted-p">{a.body}</p>
              <div className="distribution">
                <span><Smartphone /> App</span>
                {a.isPublic && <span><Gauge /> Écran</span>}
                <span><BookOpen /> Journal</span>
              </div>
            </article>
          ))}
      </div>
    </>
  )
}

function SyndicAgenda({ events, onAdd }) {
  return (
    <>
      <div className="content-heading">
        <div><span className="overline">Agenda</span><h1>Les dates qui comptent.</h1></div>
        <button className="primary-btn" onClick={onAdd}><Plus /> Ajouter une date</button>
      </div>
      <section className="card">
        <div className="agenda-list">
          {events.length === 0
            ? <EmptyState icon={<CalendarDays />} title="Aucune date" text="Ajoutez une première date à l'agenda." />
            : events.map(e => <AgendaRow key={e.id} e={e} />)}
        </div>
      </section>
    </>
  )
}

function SyndicTicketDrawer({ ticket, onClose, changeStatus }) {
  return (
    <Modal onClose={onClose} className="drawer" backdropClass="modal-backdrop drawer-backdrop" labelledBy="drawer-title">
      <div className="drawer-head">
        <div><span className="overline">{ticket.reference}</span><h2 id="drawer-title">{ticket.title}</h2></div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer"><X /></button>
      </div>
      <div className="drawer-section">
        <span className={'status ' + metaFor(ticket.status).cls}>{metaFor(ticket.status).label}</span>
        <p>{ticket.description}</p>
        <div className="info-pairs">
          <span><small>Lieu</small><strong>{ticket.location}</strong></span>
          <span><small>Signalé par</small><strong>{ticket.reporterLabel || '—'}</strong></span>
          <span><small>Créé le</small><strong>{longDate(ticket.createdAt)}</strong></span>
          <span><small>Visibilité</small><strong>{ticket.isPublic ? 'Publique' : 'Privée'}</strong></span>
        </div>
      </div>
      <div className="drawer-section">
        <span className="overline">Mettre à jour</span>
        <div className="status-actions">
          {Object.entries(statusMeta).map(([key, m]) => (
            <button key={key} className={ticket.status === key ? 'selected' : ''} onClick={() => changeStatus(ticket, key)}>
              <span className={'status-dot ' + m.cls} />{m.label}{ticket.status === key && <Check />}
            </button>
          ))}
        </div>
      </div>
      <div className="drawer-section">
        <span className="overline">Historique</span>
        <MiniTimeline timeline={ticket.timeline} />
      </div>
      <div className="drawer-foot">
        <p><Info /> Chaque changement de statut est horodaté et conservé dans le journal de l'immeuble.</p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ *
 * Écrans et accès (syndic).
 * ------------------------------------------------------------------ */

function TerminalsPanel({ actions, setToast }) {
  const [state, setState] = useState({ loading: true, error: null, terminals: [] })
  const [label, setLabel] = useState('')
  const [canReport, setCanReport] = useState(true)
  const [issued, setIssued] = useState(null)

  const reload = async () => {
    setState(s => ({ ...s, loading: true }))
    try {
      const data = await actions.listTerminals()
      setState({ loading: false, error: null, terminals: data.terminals })
    } catch (error) {
      setState({ loading: false, error: error.message, terminals: [] })
    }
  }

  useEffect(() => { reload() }, [])

  const create = async e => {
    e.preventDefault()
    if (!label.trim()) return
    try {
      const created = await actions.createTerminal({ label: label.trim(), canReport })
      setIssued(created)
      setLabel('')
      reload()
    } catch (error) { setToast(error.message) }
  }

  return (
    <>
      <div className="content-heading">
        <div>
          <span className="overline">Écrans des communs</span><h1>Jetons de terminal.</h1>
          <p>Chaque tablette reçoit son propre jeton, révocable, sans compte copropriétaire.</p>
        </div>
      </div>

      <div className="notice-inline">
        <ShieldCheck size={16} />
        <span>
          Un jeton de terminal est en lecture seule : il n'accède à aucune donnée nominative,
          à aucun document privé, et ne peut modifier aucun enregistrement existant.
        </span>
      </div>

      <section className="card">
        <div className="card-head"><div><span className="overline">Nouveau</span><h3>Créer un jeton</h3></div></div>
        <form className="inline-form" onSubmit={create}>
          <label className="grow">
            Emplacement de l'écran
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex. Hall d'entrée bloc A" maxLength={80} required />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={canReport} onChange={e => setCanReport(e.target.checked)} />
            Autoriser les signalements depuis cet écran
          </label>
          <button className="primary-btn"><Plus /> Créer</button>
        </form>
      </section>

      {issued && (
        <section className="card token-card">
          <div className="card-head"><div><span className="overline">Jeton créé</span><h3>{issued.label}</h3></div></div>
          <p className="muted-p">
            Ouvrez cette adresse une seule fois sur la tablette. Le jeton est ensuite conservé sur
            l'appareil et retiré de l'URL. Il n'est plus affichable après avoir quitté cette page.
          </p>
          <code className="token-value">{`${location.origin}/#/display?token=${issued.token}`}</code>
          <div className="modal-actions">
            <button
              className="secondary-btn"
              onClick={() => {
                navigator.clipboard?.writeText(`${location.origin}/#/display?token=${issued.token}`)
                setToast('Adresse copiée')
              }}
            >Copier l'adresse</button>
            <button className="primary-btn" onClick={() => setIssued(null)}>J'ai enregistré le jeton</button>
          </div>
        </section>
      )}

      <section className="card table-card">
        <div className="card-head"><div><span className="overline">Parc</span><h3>Écrans enregistrés</h3></div></div>
        {state.loading && <Spinner />}
        {state.error && <ErrorPanel message={state.error} onRetry={reload} />}
        {!state.loading && !state.error && (
          state.terminals.length === 0
            ? <EmptyState icon={<Gauge />} title="Aucun écran" text="Créez un premier jeton de terminal." />
            : (
              <div className="terminal-list">
                {state.terminals.map(t => (
                  <div className={'terminal-row ' + (t.revokedAt ? 'revoked' : '')} key={t.id}>
                    <div>
                      <strong>{t.label}</strong>
                      <small>Jeton …{t.tokenHint} · {t.lastSeenAt ? `vu le ${dayAndTime(t.lastSeenAt)}` : 'jamais connecté'}</small>
                    </div>
                    <span className={'status ' + (t.revokedAt ? 'status-violet' : 'status-green')}>
                      {t.revokedAt ? 'Révoqué' : 'Actif'}
                    </span>
                    {!t.revokedAt && (
                      <>
                        <label className="checkbox tight">
                          <input
                            type="checkbox"
                            checked={t.canReport}
                            onChange={async e => {
                              try {
                                await actions.setTerminalReporting(t.id, e.target.checked)
                                reload()
                              } catch (error) { setToast(error.message) }
                            }}
                          />
                          Signalements
                        </label>
                        <button
                          className="danger-btn"
                          onClick={async () => {
                            try {
                              await actions.revokeTerminal(t.id)
                              setToast('Jeton révoqué')
                              reload()
                            } catch (error) { setToast(error.message) }
                          }}
                        ><Trash2 size={16} /> Révoquer</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )
        )}
      </section>
    </>
  )
}

function MembersPanel({ actions, setToast }) {
  const [state, setState] = useState({ loading: true, error: null, members: [], roles: [] })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('resident')
  const [unitLabel, setUnitLabel] = useState('')

  const reload = async () => {
    setState(s => ({ ...s, loading: true }))
    try {
      const data = await actions.listMembers()
      setState({ loading: false, error: null, members: data.members, roles: data.assignableRoles })
    } catch (error) {
      setState({ loading: false, error: error.message, members: [], roles: [] })
    }
  }

  useEffect(() => { reload() }, [])

  const add = async e => {
    e.preventDefault()
    try {
      const result = await actions.inviteMember({ email: email.trim(), role, unitLabel: unitLabel.trim() })
      setEmail(''); setUnitLabel('')
      setToast(result?.invited ? `Invitation envoyée à ${result.email}` : 'Accès accordé')
      reload()
    } catch (error) { setToast(error.message) }
  }

  return (
    <>
      <div className="content-heading">
        <div>
          <span className="overline">Accès</span><h1>Qui peut voir quoi.</h1>
          <p>Le rôle est attribué par immeuble et vérifié côté serveur à chaque requête.</p>
        </div>
      </div>

      <div className="notice-inline">
        <Info size={16} />
        <span>
          La personne doit déjà posséder un compte : invitez-la depuis l'onglet Identity de Netlify,
          puis accordez-lui un rôle ici.
        </span>
      </div>

      <section className="card">
        <div className="card-head"><div><span className="overline">Nouvel accès</span><h3>Accorder un rôle</h3></div></div>
        <form className="inline-form" onSubmit={add}>
          <label className="grow">
            E-mail du compte
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="personne@exemple.be" required />
          </label>
          <label>
            Rôle
            <select value={role} onChange={e => setRole(e.target.value)}>
              {(state.roles.length ? state.roles : ['resident', 'council_member', 'manager']).map(r => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
          </label>
          <label>
            Lot
            <input value={unitLabel} onChange={e => setUnitLabel(e.target.value)} placeholder="Appartement B23" maxLength={80} />
          </label>
          <button className="primary-btn"><Plus /> Accorder</button>
        </form>
      </section>

      <section className="card table-card">
        <div className="card-head"><div><span className="overline">Membres</span><h3>Accès en vigueur</h3></div></div>
        {state.loading && <Spinner />}
        {state.error && <ErrorPanel message={state.error} onRetry={reload} />}
        {!state.loading && !state.error && (
          state.members.length === 0
            ? <EmptyState icon={<Users />} title="Aucun membre" text="Accordez un premier accès." />
            : (
              <div className="terminal-list">
                {state.members.map(m => (
                  <div className="terminal-row" key={m.id}>
                    <div><strong>{m.fullName || m.email}</strong><small>{m.email}{m.unitLabel ? ` · ${m.unitLabel}` : ''}</small></div>
                    <select
                      value={m.role}
                      aria-label={`Rôle de ${m.email}`}
                      onChange={async e => {
                        try {
                          await actions.updateMember(m.id, { role: e.target.value })
                          setToast('Rôle mis à jour')
                          reload()
                        } catch (error) { setToast(error.message); reload() }
                      }}
                    >
                      {(state.roles.length ? state.roles : ['resident', 'council_member', 'manager']).map(r => (
                        <option key={r} value={r}>{roleLabel(r)}</option>
                      ))}
                    </select>
                    <button
                      className="danger-btn"
                      onClick={async () => {
                        try {
                          await actions.removeMember(m.id)
                          setToast('Accès retiré')
                          reload()
                        } catch (error) { setToast(error.message) }
                      }}
                    ><Trash2 size={16} /> Retirer</button>
                  </div>
                ))}
              </div>
            )
        )}
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Fenêtres modales partagées.
 * ------------------------------------------------------------------ */

const CATEGORIES = [
  ['Éclairage', '💡'], ['Ascenseur', '🛗'], ['Garage', '🚗'],
  ['Eau / fuite', '💧'], ['Nettoyage', '🧹'], ['Autre', '•••'],
]

function ReportModal({ onClose, onSubmit, setToast, allowPrivate = false }) {
  const [step, setStep] = useState(1)
  const [category, setCategory] = useState('Éclairage')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  const submit = async () => {
    if (!location.trim() || !description.trim() || busy) return
    setBusy(true)
    try {
      const ticket = await onSubmit({
        title: category,
        category,
        location: location.trim(),
        description: description.trim(),
        isPublic: allowPrivate ? isPublic : true,
      })
      setResult(ticket.reference)
      setStep(3)
      setToast('Signalement transmis')
    } catch (error) {
      setToast(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="modal-card report-modal" labelledBy="report-title">
      <div className="modal-head">
        <div>
          <span className="overline">Signalement rapide</span>
          <h2 id="report-title">{step === 3 ? 'Merci, c\'est transmis.' : 'Que se passe-t-il ?'}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer"><X /></button>
      </div>

      {step === 1 && (
        <>
          <div className="category-grid">
            {CATEGORIES.map(([c, ico]) => (
              <button key={c} className={category === c ? 'selected' : ''} onClick={() => setCategory(c)}>
                <span>{ico}</span><strong>{c}</strong>
              </button>
            ))}
          </div>
          <button className="primary-btn full-btn" onClick={() => setStep(2)}>Continuer <ChevronRight /></button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="selected-category">
            <span>{CATEGORIES.find(x => x[0] === category)?.[1]}</span>
            <strong>{category}</strong>
            <button onClick={() => setStep(1)}>Modifier</button>
          </div>
          <label>
            Où ?
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Ex. Hall d'entrée, niveau -1…" maxLength={80} />
          </label>
          <label>
            Décrivez brièvement le problème
            <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Quelques mots suffisent pour permettre la prise en charge…" maxLength={250} />
          </label>
          {allowPrivate && (
            <label className="checkbox">
              <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
              Visible par les autres occupants et sur l'écran du hall
            </label>
          )}
          <button className="primary-btn full-btn" disabled={!location.trim() || !description.trim() || busy} onClick={submit}>
            {busy ? 'Envoi…' : 'Envoyer le signalement'}
          </button>
        </>
      )}

      {step === 3 && (
        <div className="success-panel">
          <div className="success-icon"><Check /></div>
          <h3>Référence {result}</h3>
          <p>Le signalement est enregistré et visible dans la file du gestionnaire. Son statut pourra être suivi sans nouvelle relance.</p>
          <button className="primary-btn full-btn" onClick={onClose}>Terminer</button>
        </div>
      )}
    </Modal>
  )
}

function TicketModal({ ticket, onClose, publicView = false }) {
  return (
    <Modal onClose={onClose} labelledBy="ticket-title">
      <div className="modal-head">
        <div><span className="overline">{ticket.reference}</span><h2 id="ticket-title">{ticket.title}</h2></div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer"><X /></button>
      </div>
      <span className={'status ' + metaFor(ticket.status).cls}>{metaFor(ticket.status).label}</span>
      {/* En vue publique, la description libre n'est pas transmise par l'API. */}
      {!publicView && ticket.description && <p className="modal-description">{ticket.description}</p>}
      <div className="ticket-next big"><Clock3 /><span>{ticket.nextStep}</span></div>
      <MiniTimeline timeline={ticket.timeline} />
    </Modal>
  )
}

function ComposeModal({ onClose, onPublish }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [busy, setBusy] = useState(false)

  return (
    <Modal onClose={onClose} className="modal-card compose" labelledBy="compose-title">
      <form
        onSubmit={async e => {
          e.preventDefault()
          if (!title.trim() || !body.trim() || busy) return
          setBusy(true)
          await onPublish({ title: title.trim(), body: body.trim(), isPublic })
          setBusy(false)
        }}
      >
        <div className="modal-head">
          <div><span className="overline">Communication</span><h2 id="compose-title">Publier une information</h2></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer"><X /></button>
        </div>
        <label>Titre<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex. Coupure d'eau programmée" required maxLength={80} /></label>
        <label>Message<textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="Information utile aux occupants…" required maxLength={500} /></label>
        <label className="checkbox">
          <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
          Diffuser aussi sur l'écran des communs
        </label>
        <div className="publish-preview">
          <Check />
          <span>Publication sur <strong>l'app{isPublic ? ', l\'écran du hall' : ''} et le journal de l'immeuble</strong>.</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>Annuler</button>
          <button className="primary-btn" disabled={busy}><Mail /> {busy ? 'Publication…' : 'Publier'}</button>
        </div>
      </form>
    </Modal>
  )
}

function EventModal({ onClose, onCreate }) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventTime, setEventTime] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [busy, setBusy] = useState(false)

  return (
    <Modal onClose={onClose} className="modal-card compose" labelledBy="event-title">
      <form
        onSubmit={async e => {
          e.preventDefault()
          if (!title.trim() || !eventDate || busy) return
          setBusy(true)
          await onCreate({ title: title.trim(), detail: detail.trim(), eventDate, eventTime, isPublic })
          setBusy(false)
        }}
      >
        <div className="modal-head">
          <div><span className="overline">Agenda</span><h2 id="event-title">Ajouter une date</h2></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer"><X /></button>
        </div>
        <label>Intitulé<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex. Maintenance ascenseur" required maxLength={80} /></label>
        <label>Détail<input value={detail} onChange={e => setDetail(e.target.value)} placeholder="Ex. Entretien trimestriel" maxLength={200} /></label>
        <div className="field-row">
          <label>Date<input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} required /></label>
          <label>Heure<input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)} /></label>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
          Afficher sur l'écran des communs
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>Annuler</button>
          <button className="primary-btn" disabled={busy}><CalendarDays /> {busy ? 'Ajout…' : 'Ajouter'}</button>
        </div>
      </form>
    </Modal>
  )
}
