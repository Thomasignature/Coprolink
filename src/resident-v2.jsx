import React, { useMemo, useState } from 'react'
import {
  Bell, Building2, CalendarDays, CheckCircle2, ChevronRight, FileText, Home,
  LogOut, Megaphone, Plus, Settings, Wrench,
} from 'lucide-react'
import { Logo } from './views.jsx'
import { longDate, metaFor } from './format.js'
import './resident-mobile.css'

export default function ResidentV2View({ data, session, onReport, onLogout, setToast, previewRole = null, readOnly = false }) {
  const [section, setSection] = useState('overview')
  const [reportOpen, setReportOpen] = useState(false)

  const firstName = (session.user.fullName || session.user.email).split(' ')[0]
  const buildingTickets = Array.isArray(data.buildingTickets) ? data.buildingTickets : []
  const myTickets = Array.isArray(data.myTickets) ? data.myTickets : []
  const events = Array.isArray(data.events) ? data.events : []
  const announcements = Array.isArray(data.announcements) ? data.announcements : []
  const documents = Array.isArray(data.documents) ? data.documents : []
  const residentLabel = previewRole === 'tenant' ? 'Locataire / occupant' : 'Copropriétaire'

  const openReport = () => {
    if (readOnly) {
      setToast('Mode prévisualisation : le signalement ne sera pas envoyé.')
      return
    }
    setReportOpen(true)
  }

  const active = useMemo(() => buildingTickets.filter(ticket => ticket.status !== 'resolved'), [buildingTickets])
  const ownOpen = useMemo(() => myTickets.filter(ticket => ticket.status !== 'resolved'), [myTickets])
  const nextEvent = events[0] || null
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
      meta: metaFor(active[0].status).label, action: () => setSection('tickets'),
    })
    if (nextEvent) rows.push({
      type: 'event', icon: <CalendarDays />, title: nextEvent.title,
      subtitle: nextEvent.detail || 'Prochaine échéance de la copropriété',
      meta: longDate(nextEvent.eventDate), action: () => setSection('building'),
    })
    if (latestAnnouncement) rows.push({
      type: 'news', icon: <Megaphone />, title: latestAnnouncement.title,
      subtitle: latestAnnouncement.body || 'Nouvelle communication',
      meta: 'À lire', action: () => setSection('building'),
    })
    return rows.slice(0, 3)
  }, [active, nextEvent, latestAnnouncement])

  return (
    <main className="v2-shell rm-shell">
      <aside className="v2-sidebar v2-resident-sidebar">
        <Logo />
        <nav>
          <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}><Home /> Accueil</button>
          <button className={section === 'tickets' ? 'active' : ''} onClick={() => setSection('tickets')}><Megaphone /> Signalements{ownOpen.length > 0 && <b>{ownOpen.length}</b>}</button>
          <button className={section === 'documents' ? 'active' : ''} onClick={() => setSection('documents')}><FileText /> Documents</button>
          <button className={section === 'building' ? 'active' : ''} onClick={() => setSection('building')}><Building2 /> Mon immeuble</button>
        </nav>
        <div className="v2-sidebar-bottom">
          <button><Settings /> Paramètres</button>
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
              <button className="rm-priority-card" onClick={() => setSection('building')}>
                <span><CalendarDays /></span>
                <div><strong>Prochaine échéance</strong><small>{nextEvent ? nextEvent.title : 'Aucune date prévue'}</small><em>{nextEvent ? longDate(nextEvent.eventDate) : 'Tout est à jour'}</em></div>
                <ChevronRight />
              </button>
              <button className="rm-priority-card" onClick={() => setSection('building')}>
                <span><Megaphone /></span>
                <div><strong>Dernière communication</strong><small>{latestAnnouncement ? latestAnnouncement.title : 'Aucune nouvelle communication'}</small><em>{latestAnnouncement ? 'Consulter' : 'Rien à lire'}</em></div>
                <ChevronRight />
              </button>
            </div>

            <section className="rm-section">
              <div className="rm-section-head"><h2>Actions rapides</h2></div>
              <div className="rm-action-grid">
                <button className="rm-action" onClick={openReport}><span><Megaphone /></span><strong>Signaler</strong><small>{readOnly ? 'Disponible hors prévisualisation' : 'Un problème dans l’immeuble'}</small></button>
                <button className="rm-action" onClick={() => setSection('documents')}><span><FileText /></span><strong>Documents</strong><small>Retrouver les documents utiles</small></button>
                <button className="rm-action" onClick={() => setSection('building')}><span><Building2 /></span><strong>Mon immeuble</strong><small>Infos, syndic et prochaines dates</small></button>
              </div>
            </section>

            <section className="rm-section">
              <div className="rm-section-head"><h2>À suivre</h2><button onClick={() => setSection('tickets')}>Voir tout <ChevronRight /></button></div>
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

            <button className="rm-building-card" onClick={() => setSection('building')}>
              <span><Building2 /></span>
              <div><strong>{data.building.name}</strong><small>{data.building.address || 'Adresse à compléter'}</small><em>{data.building.lots || '—'} lots</em></div>
              <ChevronRight />
            </button>
          </div>
        )}

        {section === 'tickets' && (
          <div className="rm-content">
            <div className="rm-page-head"><span>SIGNALEMENTS</span><h1>{previewRole === 'tenant' ? 'Mes signalements' : 'Mes demandes'}</h1><p>Un suivi simple, sans devoir relancer le syndic pour savoir où en est votre demande.</p></div>
            <button className="rm-primary" onClick={openReport}><Plus /> Nouveau signalement</button>
            {readOnly && <p className="preview-readonly-note">En prévisualisation, aucune action ne sera enregistrée.</p>}
            <div className="rm-list" style={{ marginTop: 14 }}>
              {myTickets.length === 0
                ? <div className="rm-empty"><CheckCircle2 /><strong>Aucun signalement personnel dans cet aperçu</strong><span>Les demandes propres à l’utilisateur apparaîtront ici une fois connecté avec son compte.</span></div>
                : myTickets.map(ticket => (
                  <article className="rm-ticket" key={ticket.reference}>
                    <div><small>{ticket.reference}</small><h3>{ticket.title}</h3><p>{ticket.location || 'Emplacement non précisé'}</p><p style={{ marginTop: 8 }}>{ticket.nextStep || 'Suivi en cours'}</p></div>
                    <i className="rm-ticket-status">{metaFor(ticket.status).label}</i>
                  </article>
                ))}
            </div>
          </div>
        )}

        {section === 'documents' && (
          <div className="rm-content">
            <div className="rm-page-head"><span>DOCUMENTS</span><h1>Documents utiles</h1><p>{previewRole === 'tenant' ? 'Uniquement les documents autorisés aux occupants.' : 'Les documents de votre copropriété sans devoir rechercher dans vos e-mails.'}</p></div>
            <div className="rm-list">
              {documents.length === 0
                ? <div className="rm-empty"><FileText /><strong>Aucun document accessible</strong><span>Les documents disponibles pour ce profil apparaîtront ici.</span></div>
                : documents.map(doc => (
                  <button className="rm-doc" key={doc.id} onClick={() => setToast(doc.available ? 'Ouverture du document bientôt disponible' : 'Le stockage du fichier n’est pas encore activé')}>
                    <FileText /><div><strong>{doc.name}</strong><small>Mis à jour le {longDate(doc.updatedOn)}</small></div><ChevronRight />
                  </button>
                ))}
            </div>
          </div>
        )}

        {section === 'building' && (
          <div className="rm-content">
            <div className="rm-page-head"><span>MON IMMEUBLE</span><h1>{data.building.name}</h1><p>{data.building.address || 'Adresse à compléter'}</p></div>
            <div className="rm-building-grid">
              <article><Building2 /><span>Lots</span><strong>{data.building.lots || '—'}</strong></article>
              <article><Wrench /><span>Interventions ouvertes</span><strong>{active.length}</strong></article>
              <article><CalendarDays /><span>Prochaine date</span><strong>{nextEvent ? longDate(nextEvent.eventDate) : 'Aucune'}</strong></article>
              <article><Bell /><span>Syndic</span><strong>{data.building.managerName || 'À compléter'}</strong></article>
            </div>
            <section className="rm-info-card" style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 12 }}>Informations utiles</strong>
              <p style={{ fontSize: 10, color: '#748079' }}><strong>Numéro d’urgence :</strong> {data.building.emergencyPhone || 'Non renseigné'}</p>
              {latestAnnouncement && <div style={{ marginTop: 12 }}><strong style={{ fontSize: 11 }}>{latestAnnouncement.title}</strong><p style={{ fontSize: 10, color: '#748079', lineHeight: 1.5 }}>{latestAnnouncement.body}</p></div>}
            </section>
          </div>
        )}

        <nav className="rm-bottom-nav">
          <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}><Home /><span>Accueil</span></button>
          <button className={section === 'tickets' ? 'active' : ''} onClick={() => setSection('tickets')}><Megaphone /><span>Signalements</span></button>
          <button className={section === 'documents' ? 'active' : ''} onClick={() => setSection('documents')}><FileText /><span>Documents</span></button>
          <button className={section === 'building' ? 'active' : ''} onClick={() => setSection('building')}><Building2 /><span>Immeuble</span></button>
        </nav>
      </section>

      {reportOpen && !readOnly && <ReportDialog onClose={() => setReportOpen(false)} onSubmit={onReport} setToast={setToast} />}
    </main>
  )
}

function ReportDialog({ onClose, onSubmit, setToast }) {
  const [form, setForm] = useState({ category: 'Entretien', title: '', location: '', description: '', isPublic: true })
  const [busy, setBusy] = useState(false)

  const submit = async event => {
    event.preventDefault()
    if (busy) return
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
    <div className="v2-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form className="v2-modal" onSubmit={submit}>
        <div className="v2-panel-head"><div><span>SIGNALEMENT</span><h3>Signaler un problème</h3></div><button type="button" onClick={onClose}>×</button></div>
        <label>Catégorie<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}><option>Entretien</option><option>Ascenseur</option><option>Électricité</option><option>Eau</option><option>Chauffage</option><option>Autre</option></select></label>
        <label>Titre<input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="Ex. Lumière du parking en panne" /></label>
        <label>Emplacement<input required value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} placeholder="Ex. Parking -1" /></label>
        <label>Description<textarea required value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="Décrivez brièvement le problème…" /></label>
        <label className="v2-check"><input type="checkbox" checked={form.isPublic} onChange={event => setForm({ ...form, isPublic: event.target.checked })} /> Visible aux autres copropriétaires</label>
        <button className="v2-primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le signalement'}</button>
      </form>
    </div>
  )
}
