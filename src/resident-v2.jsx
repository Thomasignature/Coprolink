import React, { useMemo, useState } from 'react'
import {
  Bell, Building2, CalendarDays, CheckCircle2, ChevronRight, FileText, Home,
  LogOut, Megaphone, Plus, Settings, Wrench,
} from 'lucide-react'
import { Logo } from './views.jsx'
import { longDate, metaFor } from './format.js'

const sections = {
  overview: 'Accueil',
  tickets: 'Signalements',
  documents: 'Documents',
  building: 'Mon immeuble',
}

export default function ResidentV2View({ data, session, onReport, onLogout, setToast }) {
  const [section, setSection] = useState('overview')
  const [reportOpen, setReportOpen] = useState(false)

  const firstName = (session.user.fullName || session.user.email).split(' ')[0]
  const active = useMemo(() => data.buildingTickets.filter(ticket => ticket.status !== 'resolved'), [data.buildingTickets])
  const ownOpen = useMemo(() => data.myTickets.filter(ticket => ticket.status !== 'resolved'), [data.myTickets])
  const nextEvent = data.events[0] || null
  const latestAnnouncement = data.announcements[0] || null

  const follow = useMemo(() => {
    const rows = []
    if (active[0]) rows.push({ type: 'ticket', icon: <Wrench />, title: active[0].title, subtitle: active[0].nextStep || active[0].location, meta: metaFor(active[0].status).label, action: () => setSection('tickets') })
    if (nextEvent) rows.push({ type: 'event', icon: <CalendarDays />, title: nextEvent.title, subtitle: nextEvent.detail || 'Prochaine échéance', meta: longDate(nextEvent.eventDate), action: () => setSection('building') })
    if (latestAnnouncement) rows.push({ type: 'news', icon: <Megaphone />, title: latestAnnouncement.title, subtitle: 'Nouvelle communication', meta: 'À lire', action: () => setSection('building') })
    return rows.slice(0, 3)
  }, [active, nextEvent, latestAnnouncement])

  return (
    <main className="v2-shell v2-resident-shell">
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
          <div className="v2-user-card"><span>{firstName.slice(0, 2).toUpperCase()}</span><div><strong>{session.user.fullName || session.user.email}</strong><small>Copropriétaire</small></div></div>
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>

      <section className="v2-main v2-resident-main">
        <header className="v2-resident-topbar">
          <div className="v2-mobile-brand"><Logo /></div>
          <div className="v2-building-switch"><Bell /><span>{data.building.name}</span></div>
        </header>

        {section === 'overview' && (
          <div className="v2-resident-content">
            <p className="v2-greeting">Bonjour {firstName} 👋</p>
            <section className="v2-resident-hero">
              <CheckCircle2 />
              <div>
                <h1>{active.length === 0 ? 'Tout est sous contrôle' : active.length === 1 ? '1 élément est à suivre' : `${active.length} éléments sont à suivre`}</h1>
                <p>{active.length === 0 ? 'Aucun élément urgent dans votre immeuble aujourd’hui.' : 'Les éléments utiles sont regroupés ici, sans vous noyer dans les détails.'}</p>
                <small>CoproLink veille sur votre copropriété et vous montre uniquement ce qui compte.</small>
              </div>
              <div className="v2-resident-building-art"><Building2 /></div>
            </section>

            <section className="v2-follow-section">
              <div className="v2-section-title"><h2>À suivre</h2><button onClick={() => setSection('tickets')}>Voir tout <ChevronRight /></button></div>
              <div className="v2-follow-card">
                {follow.length === 0
                  ? <div className="v2-empty"><CheckCircle2 /><strong>Rien ne demande votre attention</strong><span>Profitez de votre tranquillité.</span></div>
                  : follow.map((item, index) => (
                    <button key={`${item.type}-${index}`} onClick={item.action}>
                      <span className={`v2-follow-icon ${item.type}`}>{item.icon}</span>
                      <div><strong>{item.title}</strong><small>{item.subtitle}</small></div>
                      <em>{item.meta}</em><ChevronRight />
                    </button>
                  ))}
              </div>
            </section>

            <section className="v2-quick-section">
              <h2>Accès rapides</h2>
              <div className="v2-quick-grid">
                <button onClick={() => setReportOpen(true)}><Megaphone /><div><strong>Signaler un problème</strong><small>Une anomalie dans l’immeuble ?</small></div><ChevronRight /></button>
                <button onClick={() => setSection('documents')}><FileText /><div><strong>Documents</strong><small>Retrouvez les documents utiles</small></div><ChevronRight /></button>
                <button onClick={() => setSection('building')}><Building2 /><div><strong>Mon immeuble</strong><small>Informations et détails</small></div><ChevronRight /></button>
              </div>
            </section>

            <button className="v2-residence-card" onClick={() => setSection('building')}>
              <span><Building2 /></span><div><strong>{data.building.name}</strong><small>{data.building.address || 'Adresse à compléter'}</small><em>{data.building.lots} lots</em></div><ChevronRight />
            </button>
          </div>
        )}

        {section === 'tickets' && (
          <div className="v2-resident-content">
            <div className="v2-page-heading"><div><span>SIGNALEMENTS</span><h1>Suivez vos demandes simplement.</h1><p>Vous savez où en est chaque intervention sans devoir relancer.</p></div><button className="v2-primary" onClick={() => setReportOpen(true)}><Plus /> Nouveau signalement</button></div>
            <div className="v2-resident-list">
              {data.myTickets.length === 0
                ? <div className="v2-empty"><CheckCircle2 /><strong>Aucun signalement</strong><span>Vos demandes apparaîtront ici.</span></div>
                : data.myTickets.map(ticket => (
                  <article key={ticket.reference}>
                    <div><span>{ticket.reference}</span><h3>{ticket.title}</h3><p>{ticket.location}</p></div>
                    <i className={`v2-ticket-status ${ticket.status}`}>{metaFor(ticket.status).label}</i>
                    <strong>{ticket.nextStep || 'Suivi en cours'}</strong>
                  </article>
                ))}
            </div>
          </div>
        )}

        {section === 'documents' && (
          <div className="v2-resident-content">
            <div className="v2-page-heading"><div><span>DOCUMENTS</span><h1>Tout retrouver au même endroit.</h1><p>Les documents de votre copropriété, accessibles sans chercher dans vos e-mails.</p></div></div>
            <div className="v2-document-grid">
              {data.documents.length === 0
                ? <div className="v2-empty"><FileText /><strong>Aucun document</strong><span>Les documents ajoutés par le syndic apparaîtront ici.</span></div>
                : data.documents.map(doc => (
                  <button key={doc.id} onClick={() => setToast(doc.available ? 'Ouverture du document bientôt disponible' : 'Le stockage du fichier n’est pas encore activé')}>
                    <FileText /><div><strong>{doc.name}</strong><small>Mis à jour le {longDate(doc.updatedOn)}</small></div><ChevronRight />
                  </button>
                ))}
            </div>
          </div>
        )}

        {section === 'building' && (
          <div className="v2-resident-content">
            <div className="v2-page-heading"><div><span>MON IMMEUBLE</span><h1>{data.building.name}</h1><p>{data.building.address}</p></div></div>
            <div className="v2-building-grid">
              <section><Building2 /><span>Lots</span><strong>{data.building.lots || '—'}</strong></section>
              <section><Wrench /><span>Interventions ouvertes</span><strong>{active.length}</strong></section>
              <section><CalendarDays /><span>Prochaine date</span><strong>{nextEvent ? longDate(nextEvent.eventDate) : 'Aucune'}</strong></section>
              <section><Bell /><span>Syndic</span><strong>{data.building.managerName || 'À compléter'}</strong></section>
            </div>
            <section className="v2-panel v2-building-info">
              <h3>Informations utiles</h3>
              <p><strong>Numéro d’urgence :</strong> {data.building.emergencyPhone || 'Non renseigné'}</p>
              {latestAnnouncement && <div className="v2-building-news"><Megaphone /><div><strong>{latestAnnouncement.title}</strong><span>{latestAnnouncement.body}</span></div></div>}
            </section>
          </div>
        )}

        <nav className="v2-mobile-nav">
          <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}><Home /><span>Accueil</span></button>
          <button className={section === 'tickets' ? 'active' : ''} onClick={() => setSection('tickets')}><Megaphone /><span>Signalements</span></button>
          <button className={section === 'documents' ? 'active' : ''} onClick={() => setSection('documents')}><FileText /><span>Documents</span></button>
          <button className={section === 'building' ? 'active' : ''} onClick={() => setSection('building')}><Building2 /><span>Immeuble</span></button>
        </nav>
      </section>

      {reportOpen && <ReportDialog onClose={() => setReportOpen(false)} onSubmit={onReport} setToast={setToast} />}
    </main>
  )
}

function ReportDialog({ onClose, onSubmit, setToast }) {
  const [form, setForm] = useState({ category: 'Entretien', title: '', location: '', description: '', isPublic: true })
  const [busy, setBusy] = useState(false)

  const submit = async e => {
    e.preventDefault()
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
    <div className="v2-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form className="v2-modal" onSubmit={submit}>
        <div className="v2-panel-head"><div><span>SIGNALEMENT</span><h3>Signaler un problème</h3></div><button type="button" onClick={onClose}>×</button></div>
        <label>Catégorie<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option>Entretien</option><option>Ascenseur</option><option>Électricité</option><option>Eau</option><option>Chauffage</option><option>Autre</option></select></label>
        <label>Titre<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ex. Lumière du parking en panne" /></label>
        <label>Emplacement<input required value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Ex. Parking -1" /></label>
        <label>Description<textarea required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Décrivez brièvement le problème…" /></label>
        <label className="v2-check"><input type="checkbox" checked={form.isPublic} onChange={e => setForm({ ...form, isPublic: e.target.checked })} /> Visible aux autres copropriétaires</label>
        <button className="v2-primary" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer le signalement'}</button>
      </form>
    </div>
  )
}
