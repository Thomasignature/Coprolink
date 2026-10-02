import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Bell, Building2, CalendarDays, CheckCircle2, ChevronRight, FileText, Home,
  LogOut, Mail, Megaphone, Phone, Plus, Settings, Wrench, X,
} from 'lucide-react'
import { Logo } from './views.jsx'
import { longDate, metaFor } from './format.js'
import ResidentLotView from './resident-lot.jsx'
import AssemblyPanel from './assembly-panel.jsx'
import { documentDownloadUrl } from './api.js'
import { splitEvents, validateReport } from './resident-utils.js'
import './resident-mobile.css'

const SECTIONS = new Set(['overview', 'tickets', 'documents', 'assemblies', 'lot', 'building', 'settings'])

export default function ResidentV2View({ data, session, onReport, onLogout, setToast, previewRole = null, readOnly = false, initialSection = 'overview', onNavigate }) {
  const [section, setSection] = useState(SECTIONS.has(initialSection) ? initialSection : 'overview')
  const [reportOpen, setReportOpen] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState(null)
  const reportTrigger = useRef(null)

  useEffect(() => { setSection(SECTIONS.has(initialSection) ? initialSection : 'overview') }, [initialSection])
  const navigate = next => { setSection(next); onNavigate?.(next) }

  const firstName = (session.user.fullName || session.user.email).split(' ')[0]
  const buildingTickets = Array.isArray(data.buildingTickets) ? data.buildingTickets : []
  const myTickets = Array.isArray(data.myTickets) ? data.myTickets : []
  const events = Array.isArray(data.events) ? data.events : []
  const announcements = Array.isArray(data.announcements) ? data.announcements : []
  const documents = Array.isArray(data.documents) ? data.documents : []
  const professionals = Array.isArray(data.professionals) ? data.professionals : []
  const residentLabel = previewRole === 'tenant' ? 'Locataire / occupant' : 'Copropriétaire'

  const openReport = () => {
    if (readOnly) {
      setToast('Mode prévisualisation : le signalement ne sera pas envoyé.')
      return
    }
    reportTrigger.current = document.activeElement
    setReportOpen(true)
  }

  const active = useMemo(() => buildingTickets.filter(ticket => ticket.status !== 'resolved'), [buildingTickets])
  const ownOpen = useMemo(() => myTickets.filter(ticket => ticket.status !== 'resolved'), [myTickets])
  const { future: futureEvents, past: pastEvents } = useMemo(() => splitEvents(events), [events])
  const nextEvent = futureEvents[0] || null
  const latestAnnouncement = announcements[0] || null

  const attentionCount = active.length + (latestAnnouncement ? 1 : 0)
  const heroTitle = attentionCount === 0 ? 'Tout est sous contrôle' : attentionCount === 1 ? '1 information à consulter' : `${attentionCount} informations à consulter`
  const heroText = attentionCount === 0
    ? 'Aucun élément important ne demande votre attention aujourd’hui.'
    : 'CoproLink regroupe ici uniquement ce qui mérite votre attention.'

  const stream = useMemo(() => {
    const rows = []
    if (active[0]) rows.push({
      type: 'ticket', icon: <Wrench />, title: active[0].title,
      subtitle: active[0].nextStep || active[0].location || 'Intervention en cours',
      meta: metaFor(active[0].status).label, action: () => { navigate('tickets'); setSelectedTicket(active[0]) },
    })
    if (nextEvent) rows.push({
      type: 'event', icon: <CalendarDays />, title: nextEvent.title,
      subtitle: nextEvent.detail || 'Prochaine échéance de la copropriété',
      meta: longDate(nextEvent.eventDate), action: () => navigate('building'),
    })
    if (latestAnnouncement) rows.push({
      type: 'news', icon: <Megaphone />, title: latestAnnouncement.title,
      subtitle: latestAnnouncement.body || 'Nouvelle communication',
      meta: 'À lire', action: () => navigate('building'),
    })
    return rows.slice(0, 3)
  }, [active, nextEvent, latestAnnouncement])

  return (
    <main className="v2-shell rm-shell">
      <aside className="v2-sidebar v2-resident-sidebar">
        <Logo />
        <nav>
          <button className={section === 'overview' ? 'active' : ''} onClick={() => navigate('overview')}><Home /> Accueil</button>
          <button className={section === 'tickets' ? 'active' : ''} onClick={() => navigate('tickets')}><Megaphone /> Signalements{ownOpen.length > 0 && <b>{ownOpen.length}</b>}</button>
          <button className={section === 'documents' ? 'active' : ''} onClick={() => navigate('documents')}><FileText /> Documents</button>
          <button className={section === 'assemblies' ? 'active' : ''} onClick={() => navigate('assemblies')}><CalendarDays /> Assemblées générales</button>
          <button className={section === 'lot' ? 'active' : ''} onClick={() => navigate('lot')}><Building2 /> Mon lot</button>
          <button className={section === 'building' ? 'active' : ''} onClick={() => navigate('building')}><Building2 /> Mon immeuble</button>
        </nav>
        <div className="v2-sidebar-bottom">
          <button className={section === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><Settings /> Paramètres</button>
          <div className="v2-user-card"><span>{firstName.slice(0, 2).toUpperCase()}</span><div><strong>{session.user.fullName || session.user.email}</strong><small>{residentLabel}</small></div></div>
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>

      <section className="v2-main rm-main">
        <header className="rm-topbar">
          <Logo />
          <div className="rm-building-pill"><Building2 /><span>{data.building.name}</span></div>
        </header>

        {section === 'overview' && (
          <div className="rm-content">
            <p className="rm-greeting">Bonjour {firstName} 👋{previewRole && <span> · vue {residentLabel.toLowerCase()}</span>}</p>

            <section className="rm-hero">
              <span className={`rm-hero-status ${attentionCount ? 'attention' : ''}`}><CheckCircle2 /></span>
              <div className="rm-hero-copy">
                <h1>{heroTitle}</h1>
                <p>{heroText}</p>
                <small>Les détails restent disponibles, mais ne prennent jamais le dessus sur l’essentiel.</small>
              </div>
              <div className="rm-hero-building"><Building2 /></div>
            </section>

            <div className="rm-priority-grid">
              <button className="rm-priority-card" onClick={() => navigate('building')}>
                <span><CalendarDays /></span>
                <div><strong>Prochaine échéance</strong><small>{nextEvent ? nextEvent.title : 'Aucune date prévue'}</small><em>{nextEvent ? longDate(nextEvent.eventDate) : 'Tout est à jour'}</em></div>
                <ChevronRight />
              </button>
              <button className="rm-priority-card" onClick={() => navigate('building')}>
                <span><Megaphone /></span>
                <div><strong>Dernière communication</strong><small>{latestAnnouncement ? latestAnnouncement.title : 'Aucune nouvelle communication'}</small><em>{latestAnnouncement ? 'Consulter' : 'Rien à lire'}</em></div>
                <ChevronRight />
              </button>
            </div>

            <section className="rm-section">
              <div className="rm-section-head"><h2>Actions rapides</h2></div>
              <div className="rm-action-grid">
                <button className="rm-action" onClick={openReport}><span><Megaphone /></span><strong>Signaler</strong><small>{readOnly ? 'Disponible hors prévisualisation' : 'Un problème dans l’immeuble'}</small></button>
                <button className="rm-action" onClick={() => navigate('documents')}><span><FileText /></span><strong>Documents</strong><small>Retrouver les documents utiles</small></button>
                <button className="rm-action" onClick={() => navigate('assemblies')}><span><CalendarDays /></span><strong>Assemblée générale</strong><small>Présence, procuration et ordre du jour</small></button>
                <button className="rm-action" onClick={() => navigate('lot')}><span><Building2 /></span><strong>Mon lot</strong><small>Mon logement et mes informations</small></button>
              </div>
            </section>

            <section className="rm-section">
              <div className="rm-section-head"><h2>À suivre</h2><button onClick={() => navigate('tickets')}>Voir les interventions <ChevronRight /></button></div>
              <div className="rm-stream">
                {stream.length === 0
                  ? <div className="rm-empty"><CheckCircle2 /><strong>Rien ne demande votre attention</strong><span>Votre copropriété est à jour.</span></div>
                  : stream.map((item, index) => (
                    <button key={`${item.type}-${index}`} onClick={item.action}>
                      <span className={`rm-stream-icon ${item.type}`}>{item.icon}</span>
                      <div><strong>{item.title}</strong><small>{item.subtitle}</small></div>
                      <em>{item.meta}</em><ChevronRight />
                    </button>
                  ))}
              </div>
            </section>

            <button className="rm-building-card" onClick={() => navigate('building')}>
              <span><Building2 /></span>
              <div><strong>{data.building.name}</strong><small>{data.building.address || 'Adresse à compléter'}</small><em>{data.building.lots || '—'} lots</em></div>
              <ChevronRight />
            </button>
          </div>
        )}

        {section === 'tickets' && (
          <div className="rm-content">
            <div className="rm-page-head"><span>SIGNALEMENTS</span><h1>Interventions et demandes</h1><p>Les interventions communes sont séparées de vos demandes privées.</p></div>
            <button className="rm-primary" onClick={openReport}><Plus /> Nouveau signalement</button>
            {readOnly && <p className="preview-readonly-note">En prévisualisation, aucune action ne sera enregistrée.</p>}
            <section className="rm-section">
              <div className="rm-section-head"><h2>Interventions communes</h2></div>
              <div className="rm-list">
                {buildingTickets.length === 0
                  ? <div className="rm-empty"><CheckCircle2 /><strong>Aucune intervention commune</strong><span>Les interventions partagées de l’immeuble apparaîtront ici.</span></div>
                  : buildingTickets.map(ticket => <TicketCard key={ticket.reference} ticket={ticket} onOpen={() => setSelectedTicket(ticket)} />)}
              </div>
            </section>
            <section className="rm-section">
              <div className="rm-section-head"><h2>Mes demandes</h2></div>
            <div className="rm-list" style={{ marginTop: 14 }}>
              {myTickets.length === 0
                ? <div className="rm-empty"><CheckCircle2 /><strong>Vous n’avez encore créé aucun signalement</strong><span>Utilisez « Nouveau signalement » pour transmettre une demande au syndic.</span></div>
                : myTickets.map(ticket => <TicketCard key={ticket.reference} ticket={ticket} onOpen={() => setSelectedTicket(ticket)} />)}
            </div>
            </section>
            {selectedTicket && <TicketDetail ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />}
          </div>
        )}

        {section === 'documents' && (
          <div className="rm-content">
            <div className="rm-page-head"><span>DOCUMENTS</span><h1>Documents utiles</h1><p>{previewRole === 'tenant' ? 'Uniquement les documents autorisés aux occupants.' : 'Les documents de votre copropriété sans devoir rechercher dans vos e-mails.'}</p></div>
            <div className="rm-list">
              {documents.length === 0
                ? <div className="rm-empty"><FileText /><strong>Aucun document accessible</strong><span>Les documents disponibles pour ce profil apparaîtront ici.</span></div>
                : documents.map(doc => doc.available
                  ? <a className="rm-doc" key={doc.id} href={documentDownloadUrl(data.building.slug, doc.id)} download>
                      <FileText /><div><strong>{doc.name}</strong><small>{doc.folder ? `${doc.folder} · ` : ''}Mis à jour le {longDate(doc.updatedOn)}</small></div><span>Télécharger</span>
                    </a>
                  : <div className="rm-doc rm-doc-missing" key={doc.id}>
                      <AlertTriangle /><div><strong>{doc.name}</strong><small>Fichier non déposé — contactez le syndic si vous en avez besoin.</small></div><span>Indisponible</span>
                    </div>)}
            </div>
          </div>
        )}

        {section === 'assemblies' && (
          <div className="rm-content">
            <div className="rm-page-head"><span>ASSEMBLÉES GÉNÉRALES</span><h1>Participer simplement</h1><p>Consultez les informations de l’AG, l’ordre du jour et indiquez votre présence ou votre procuration.</p></div>
            <AssemblyPanel buildingSlug={data.building.slug} readOnly={readOnly} setToast={setToast} />
          </div>
        )}

        {section === 'lot' && <ResidentLotView data={data} previewRole={previewRole} />}

        {section === 'building' && (
          <div className="rm-content">
            <div className="rm-page-head"><span>MON IMMEUBLE</span><h1>{data.building.name}</h1><p>{data.building.address || 'Adresse à compléter'}</p></div>
            <div className="rm-building-grid">
              <article><Building2 /><span>Lots</span><strong>{data.building.lots || '—'}</strong></article>
              <article><Wrench /><span>Interventions ouvertes</span><strong>{active.length}</strong></article>
              <article><CalendarDays /><span>Prochaine date</span><strong>{nextEvent ? longDate(nextEvent.eventDate) : 'Aucune date future'}</strong></article>
              <article><Bell /><span>Syndic</span><strong>{data.building.managerName || 'À compléter'}</strong></article>
            </div>
            <section className="rm-info-card" style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 12 }}>Informations utiles</strong>
              <p style={{ fontSize: 10, color: '#748079' }}><strong>Numéro d’urgence :</strong> {data.building.emergencyPhone || 'Non renseigné'}</p>
              {professionals.length > 0 && <div style={{ marginTop: 12 }}>
                <strong style={{ fontSize: 11 }}>Contacts de l’immeuble</strong>
                {professionals.map(pro => <div key={pro.id} className="rm-contact"><strong>{pro.organizationName || pro.contactName || 'Intervenant'}</strong><p>{pro.professionalType === 'syndic' ? 'Syndic' : 'Professionnel'}</p><div>{pro.phone && <a href={`tel:${pro.phone.replace(/\s/g, '')}`}><Phone />{pro.phone}</a>}{pro.email && <a href={`mailto:${pro.email}`}><Mail />{pro.email}</a>}{!pro.phone && !pro.email && <span>Coordonnées non renseignées</span>}</div></div>)}
              </div>}
              {latestAnnouncement && <div style={{ marginTop: 12 }}><strong style={{ fontSize: 11 }}>{latestAnnouncement.title}</strong><p style={{ fontSize: 10, color: '#748079', lineHeight: 1.5 }}>{latestAnnouncement.body}</p></div>}
            </section>
            {pastEvents.length > 0 && <section className="rm-section"><div className="rm-section-head"><h2>Dates passées</h2></div><div className="rm-list">{pastEvents.map(event => <article className="rm-info-card" key={event.id}><strong>{event.title}</strong><p>{longDate(event.eventDate)}{event.eventTime ? ` · ${event.eventTime}` : ''}</p></article>)}</div></section>}
          </div>
        )}

        {section === 'settings' && <div className="rm-content"><div className="rm-page-head"><span>PARAMÈTRES</span><h1>Mon compte</h1><p>Consultez les informations liées à votre compte.</p></div><section className="rm-info-card"><strong>{session.user.fullName || 'Nom non renseigné'}</strong><p>{session.user.email}</p><p>La modification du mot de passe se fait depuis le lien de récupération de l’écran de connexion.</p></section></div>}

        <nav className="rm-bottom-nav">
          <button className={section === 'overview' ? 'active' : ''} onClick={() => navigate('overview')}><Home /><span>Accueil</span></button>
          <button className={section === 'tickets' ? 'active' : ''} onClick={() => navigate('tickets')}><Megaphone /><span>Signalements</span></button>
          <button className={section === 'documents' ? 'active' : ''} onClick={() => navigate('documents')}><FileText /><span>Documents</span></button>
          <button className={section === 'lot' ? 'active' : ''} onClick={() => navigate('lot')}><Building2 /><span>Mon lot</span></button>
        </nav>
      </section>

      {reportOpen && !readOnly && <ReportDialog onClose={() => { setReportOpen(false); requestAnimationFrame(() => reportTrigger.current?.focus()) }} onSubmit={onReport} setToast={setToast} />}
    </main>
  )
}

function ReportDialog({ onClose, onSubmit, setToast }) {
  const [form, setForm] = useState({ category: 'Entretien', title: '', location: '', description: '', priority: 'normal', isPublic: false })
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState({})
  const dialog = useRef(null)
  const firstField = useRef(null)
  const dirty = Object.entries(form).some(([key, value]) => key !== 'category' && key !== 'priority' && key !== 'isPublic' ? Boolean(String(value).trim()) : key === 'isPublic' && value)

  const requestClose = () => {
    if (busy) return
    if (dirty && !window.confirm('Abandonner ce signalement ? La saisie sera perdue.')) return
    onClose()
  }

  useEffect(() => {
    firstField.current?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); requestClose(); return }
      if (event.key !== 'Tab') return
      const focusable = [...dialog.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
      const first = focusable[0]; const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [dirty, busy])

  const submit = async event => {
    event.preventDefault()
    if (busy) return
    const nextErrors = validateReport(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      dialog.current?.querySelector('[aria-invalid="true"]')?.focus()
      return
    }
    setBusy(true)
    try {
      await onSubmit(form)
      setToast('Votre signalement a bien été transmis.')
      onClose()
    } catch (error) {
      setToast(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="v2-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) requestClose() }}>
      <form ref={dialog} className="v2-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="report-title" noValidate>
        <div className="v2-panel-head"><div><span>SIGNALEMENT</span><h3 id="report-title">Signaler un problème</h3></div><button type="button" onClick={requestClose} aria-label="Fermer le formulaire de signalement"><X /></button></div>
        <p className="rm-form-note">Ce formulaire n’est pas un service d’urgence.</p>
        <label>Catégorie <b aria-hidden="true">*</b><select ref={firstField} value={form.category} aria-invalid={Boolean(errors.category)} onChange={event => setForm({ ...form, category: event.target.value })}><option>Entretien</option><option>Ascenseur</option><option>Électricité</option><option>Eau</option><option>Chauffage</option><option>Autre</option></select>{errors.category && <small className="rm-field-error">{errors.category}</small>}</label>
        <label>Titre <small>(facultatif)</small><input maxLength="120" value={form.title} aria-invalid={Boolean(errors.title)} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Ex. Lumière du parking en panne" />{errors.title && <small className="rm-field-error">{errors.title}</small>}</label>
        <label>Emplacement <b aria-hidden="true">*</b><input maxLength="120" value={form.location} aria-invalid={Boolean(errors.location)} onChange={event => setForm({ ...form, location: event.target.value })} placeholder="Ex. Parking -1" />{errors.location && <small className="rm-field-error">{errors.location}</small>}</label>
        <label>Description <b aria-hidden="true">*</b><textarea maxLength="1000" value={form.description} aria-invalid={Boolean(errors.description)} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Décrivez brièvement le problème…" />{errors.description && <small className="rm-field-error">{errors.description}</small>}</label>
        <label>Priorité<select value={form.priority} onChange={event => setForm({ ...form, priority: event.target.value })}><option value="low">Faible</option><option value="normal">Normale</option><option value="high">Haute</option></select></label>
        <label className="v2-check"><input type="checkbox" checked={form.isPublic} onChange={event => setForm({ ...form, isPublic: event.target.checked })} /> Partager avec les autres copropriétaires</label>
        {form.isPublic && <p className="rm-form-note">Le titre, l’emplacement, le statut et l’historique maîtrisé seront visibles. Votre description libre et votre identité restent privées.</p>}
        <button className="v2-primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le signalement'}</button>
      </form>
    </div>
  )
}

function TicketCard({ ticket, onOpen }) {
  return <button type="button" className="rm-ticket" onClick={onOpen}><div><small>{ticket.reference}</small><h3>{ticket.title}</h3><p>{ticket.location || 'Emplacement non précisé'}</p><p style={{ marginTop: 8 }}>{ticket.nextStep || 'Suivi en cours'}</p></div><i className="rm-ticket-status">{metaFor(ticket.status).label}</i></button>
}

function TicketDetail({ ticket, onClose }) {
  return <section className="rm-ticket-detail" aria-labelledby="ticket-detail-title"><div className="rm-section-head"><h2 id="ticket-detail-title">{ticket.title}</h2><button onClick={onClose} aria-label="Fermer le détail"><X /></button></div><p><strong>{ticket.reference}</strong> · {metaFor(ticket.status).label}</p><p>{ticket.description || ticket.nextStep || 'Aucun détail supplémentaire.'}</p><dl><div><dt>Emplacement</dt><dd>{ticket.location || 'Non précisé'}</dd></div><div><dt>Créé le</dt><dd>{longDate(ticket.createdAt)}</dd></div>{ticket.updatedAt && <div><dt>Mis à jour le</dt><dd>{longDate(ticket.updatedAt)}</dd></div>}</dl><h3>Historique</h3>{ticket.timeline?.length ? <ol>{ticket.timeline.map((step, index) => <li key={`${step.date}-${index}`}><strong>{step.label}</strong><span>{longDate(step.date)}</span>{step.note && <p>{step.note}</p>}</li>)}</ol> : <p>Aucun historique disponible.</p>}</section>
}
