import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Bot, Building2, CalendarDays, CheckCircle2, FileText, FolderCheck,
  HelpCircle, Inbox, LayoutDashboard, LogOut, Mail, RefreshCw, Search, Settings,
  ShieldCheck, Sparkles, TicketCheck,
} from 'lucide-react'
import { Logo } from './views.jsx'
import { apiV3 } from './api-v3.js'
import './inbox-ai.css'

const MONTHS = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
}

const clean = value => String(value || '').trim()
const lower = value => clean(value).toLocaleLowerCase('fr-BE')
const pad = value => String(value).padStart(2, '0')

const stripHtml = html => clean(html)
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ')

const parseDate = text => {
  const source = lower(text)
  const numeric = source.match(/\b(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    let year = numeric[3] ? Number(numeric[3]) : new Date().getFullYear()
    if (year < 100) year += 2000
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return `${year}-${pad(month)}-${pad(day)}`
  }
  const names = Object.keys(MONTHS).join('|')
  const named = source.match(new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${names})(?:\\s+(20\\d{2}))?\\b`, 'i'))
  if (!named) return null
  const day = Number(named[1])
  const month = MONTHS[lower(named[2])]
  const year = named[3] ? Number(named[3]) : new Date().getFullYear()
  return `${year}-${pad(month)}-${pad(day)}`
}

const toTime = (hour, minute = '0') => `${pad(Math.min(23, Number(hour)))}:${pad(Math.min(59, Number(minute || 0)))}`
const parseTimes = text => {
  const source = lower(text)
  const range = source.match(/\b(?:entre|de)\s+(\d{1,2})(?:\s*(?:h|:)\s*(\d{1,2}))?\s*(?:et|à|a|\-|–)\s*(\d{1,2})(?:\s*(?:h|:)\s*(\d{1,2}))?\b/)
  if (range) return { start: toTime(range[1], range[2]), end: toTime(range[3], range[4]) }
  const single = source.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{1,2})?\b/)
  return single ? { start: toTime(single[1], single[2]), end: null } : { start: null, end: null }
}

const classify = text => {
  const value = lower(text)
  if (/\bT-\d{4,}\b/i.test(text) || /signalement|ticket/.test(value)) return { key: 'ticket_reply', label: 'Réponse à un signalement' }
  if (/assembl[ée]e g[ée]n[ée]rale|\bag\b|proc[èe]s-verbal|\bpv\b/.test(value)) return { key: 'meeting', label: 'Assemblée générale' }
  if (/contrat|[ée]ch[ée]ance|renouvellement|assurance|police/.test(value)) return { key: 'contract', label: 'Contrat / échéance' }
  if (/ascenseur|intervention|technicien|entretien|maintenance|travaux|plombier|chauffagiste|passage|peinture|peindre|carreleur/.test(value)) return { key: 'intervention', label: 'Intervention' }
  if (/facture|devis|rapport|annexe|pi[èe]ce jointe|document/.test(value)) return { key: 'document', label: 'Document' }
  return { key: 'information', label: 'Information' }
}

const folderFor = text => {
  const value = lower(text)
  if (/assembl[ée]e|\bag\b|proc[èe]s-verbal|\bpv\b/.test(value)) return 'Assemblées générales'
  if (/ascenseur/.test(value)) return 'Ascenseur'
  if (/assurance|police/.test(value)) return 'Assurances'
  if (/contrat|[ée]ch[ée]ance/.test(value)) return 'Contrats'
  if (/facture|devis/.test(value)) return 'Comptabilité'
  if (/travaux|intervention|maintenance|entretien|peinture|peindre|carreleur/.test(value)) return 'Interventions'
  return 'Documents reçus'
}

const analyseMail = mail => {
  const body = clean(mail.textBody) || stripHtml(mail.htmlBody)
  const fullText = `${mail.subject || ''}\n${body}`
  const classification = classify(fullText)
  const eventDate = parseDate(fullText)
  const times = parseTimes(fullText)
  const ticketRef = fullText.match(/\bT-\d{4,}\b/i)?.[0]?.toUpperCase() || null
  const files = (mail.attachments || []).map(item => item.filename || item.name || item.content_disposition || 'Pièce jointe').slice(0, 8)
  const summarySource = body.replace(/\s+/g, ' ')
  const summary = (summarySource.split(/(?<=[.!?])\s+/)[0] || mail.subject || '(Sans objet)').slice(0, 240)
  let confidence = 72
  if (classification.key !== 'information') confidence += 8
  if (eventDate) confidence += 9
  if (files.length) confidence += 5
  if (ticketRef) confidence += 6
  confidence = Math.min(98, confidence)
  return { body, classification, eventDate, times, ticketRef, files, summary, confidence }
}

const formatDate = value => value
  ? new Intl.DateTimeFormat('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
  : 'Date non détectée'

export default function InboxAIView({ session, onLogout }) {
  const eligibleBuildings = useMemo(
    () => session.memberships.filter(m => m.role === 'manager' || m.role === 'council_member' || m.isReferent),
    [session.memberships],
  )
  const initialSlug = new URLSearchParams(location.hash.split('?')[1] || '').get('building') || eligibleBuildings[0]?.buildingSlug || ''
  const [buildingSlug, setBuildingSlug] = useState(initialSlug)
  const [state, setState] = useState({ status: 'loading', emails: [], error: '' })
  const [selectedId, setSelectedId] = useState(null)
  const [query, setQuery] = useState('')
  const [actionState, setActionState] = useState({ emailId: null, error: '' })

  const building = eligibleBuildings.find(item => item.buildingSlug === buildingSlug) || eligibleBuildings[0]

  const load = async () => {
    if (!buildingSlug) return
    setState(current => ({ ...current, status: current.emails.length ? 'refreshing' : 'loading', error: '' }))
    try {
      const payload = await apiV3.inboundEmails(buildingSlug)
      const emails = (payload.emails || []).map(mail => ({ ...mail, analysis: analyseMail(mail) }))
      setState({ status: 'ready', emails, error: '' })
      setSelectedId(current => current && emails.some(item => item.id === current) ? current : emails[0]?.id || null)
    } catch (error) {
      setState({ status: 'error', emails: [], error: error.message || 'Impossible de charger les e-mails.' })
    }
  }

  useEffect(() => { load() }, [buildingSlug])

  const emails = state.emails
  const selected = emails.find(mail => mail.id === selectedId) || emails[0] || null
  const filtered = emails.filter(mail => {
    const needle = lower(query)
    return !needle || lower(`${mail.subject} ${mail.fromName} ${mail.fromAddress} ${mail.analysis.classification.label}`).includes(needle)
  })

  const totals = useMemo(() => ({
    emails: emails.length,
    ready: emails.filter(item => item.processingStatus === 'content_ready').length,
    dates: emails.filter(item => item.analysis.eventDate).length,
    attachments: emails.reduce((sum, item) => sum + item.analysis.files.length, 0),
  }), [emails])

  const createCalendarEvent = async mail => {
    if (!mail?.analysis?.eventDate || actionState.emailId) return
    setActionState({ emailId: mail.id, error: '' })
    try {
      await apiV3.executeInboundAction(buildingSlug, {
        emailId: mail.id,
        action: 'create_calendar_event',
        title: mail.subject || mail.analysis.classification.label,
        detail: mail.analysis.summary,
        eventDate: mail.analysis.eventDate,
        eventTime: mail.analysis.times.start || '',
      })
      await load()
      setActionState({ emailId: null, error: '' })
    } catch (error) {
      setActionState({ emailId: null, error: error.message || 'Impossible de créer l’événement.' })
    }
  }

  const changeBuilding = slug => {
    setBuildingSlug(slug)
    location.hash = `/portfolio?view=inbox&building=${encodeURIComponent(slug)}`
  }

  if (!building) {
    return <main className="ai-no-access"><ShieldCheck /><h1>Inbox indisponible</h1><p>Aucun immeuble administrable n’est associé à ce compte.</p></main>
  }

  return (
    <main className="v2-shell ai-shell">
      <aside className="v2-sidebar">
        <Logo />
        <nav>
          <button onClick={() => { location.hash = '/portfolio' }}><LayoutDashboard /> Tableau de bord</button>
          <button onClick={() => { location.hash = '/portfolio?view=buildings' }}><Building2 /> Copropriétés</button>
          <button className="active"><Sparkles /> Inbox intelligente <b>BETA</b></button>
          <button onClick={() => { location.hash = '/portfolio?view=deadlines' }}><CalendarDays /> Échéances</button>
          <button onClick={() => { location.hash = '/portfolio?view=documents' }}><FileText /> Documents</button>
        </nav>
        <div className="v2-sidebar-bottom">
          <button><HelpCircle /> Aide & support</button>
          <button><Settings /> Paramètres</button>
          <div className="v2-user-card"><span>{(session.user.fullName || session.user.email).slice(0, 2).toUpperCase()}</span><div><strong>{session.user.fullName || session.user.email}</strong><small>Inbox de test réelle</small></div></div>
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>

      <section className="v2-main ai-main">
        <header className="ai-topbar">
          <div className="ai-title-row">
            <button className="ai-back" onClick={() => { location.hash = '/portfolio' }} aria-label="Retour"><ArrowLeft /></button>
            <div><span className="ai-kicker">COPROLINK INTELLIGENCE</span><h1>Inbox intelligente</h1><p>Les vrais e-mails reçus par l’adresse de la copropriété apparaissent ici.</p></div>
          </div>
          <div className="ai-top-actions">
            <span className="ai-sandbox-badge"><ShieldCheck /> Deploy Preview</span>
            <button className="ai-mini-launch" onClick={load}><RefreshCw /> Actualiser</button>
            <select value={buildingSlug} onChange={event => changeBuilding(event.target.value)}>{eligibleBuildings.map(item => <option key={item.buildingSlug} value={item.buildingSlug}>{item.buildingName}</option>)}</select>
          </div>
        </header>

        <section className="ai-safety-note"><Bot /><div><strong>Réception réelle, actions sur validation</strong><span>Le mail est réellement reçu et stocké. CoproLink propose les actions détectées ; rien n’est exécuté sans ton clic de validation.</span></div></section>

        <section className="ai-stats">
          <article><Mail /><div><strong>{totals.emails}</strong><span>mails réellement reçus</span></div></article>
          <article><CheckCircle2 /><div><strong>{totals.ready}</strong><span>contenus récupérés</span></div></article>
          <article><CalendarDays /><div><strong>{totals.dates}</strong><span>dates détectées</span></div></article>
          <article><FolderCheck /><div><strong>{totals.attachments}</strong><span>pièces jointes détectées</span></div></article>
        </section>

        <section className="ai-workspace">
          <div className="ai-left-column">
            <section className="ai-card ai-history-card">
              <div className="ai-card-head ai-history-head"><div><span>INBOX RÉELLE</span><h2>{building.buildingName}</h2></div><div className="ai-history-tools"><label><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher…" /></label></div></div>
              {state.status === 'loading' && <div className="ai-empty"><RefreshCw /><strong>Chargement des e-mails…</strong></div>}
              {state.status === 'error' && <div className="ai-empty"><ShieldCheck /><strong>Inbox indisponible</strong><span>{state.error}</span><button className="ai-mini-launch" onClick={load}>Réessayer</button></div>}
              {state.status !== 'loading' && state.status !== 'error' && <div className="ai-message-list">
                {filtered.map(mail => <button key={mail.id} className={mail.id === selected?.id ? 'selected' : ''} onClick={() => { setSelectedId(mail.id); setActionState({ emailId: null, error: '' }) }}>
                  <span className="ai-avatar">{(mail.fromName || mail.fromAddress || '?').slice(0, 1).toUpperCase()}</span>
                  <span className="ai-message-copy"><strong>{mail.subject || '(Sans objet)'}</strong><small>{mail.fromName || mail.fromAddress} · {mail.analysis.classification.label}</small></span>
                  <span className="ai-confidence">{mail.analysis.confidence}%</span>
                  <em>{mail.calendarEventId ? 'agenda créé' : mail.processingStatus === 'content_ready' ? 'contenu lu' : 'en attente'}</em>
                </button>)}
                {filtered.length === 0 && <div className="ai-empty"><Inbox /><strong>Aucun e-mail reçu</strong><span>Envoie un nouveau message à l’adresse Resend de cet immeuble puis clique sur Actualiser.</span></div>}
              </div>}
            </section>
          </div>

          <div className="ai-right-column">
            <section className="ai-card ai-result-card">
              <div className="ai-card-head"><div><span>INTERPRÉTATION</span><h2>{selected ? 'CoproLink a lu ce mail' : 'En attente d’un e-mail'}</h2></div>{selected && <span className="ai-confidence-large">{selected.analysis.confidence}%</span>}</div>
              {selected ? <>
                <div className="ai-analysis-summary"><div className="ai-analysis-icon"><Bot /></div><div><span className="ai-type-chip">{selected.analysis.classification.label}</span><h3>{selected.analysis.summary}</h3><p>{selected.fromName || selected.fromAddress}{selected.analysis.eventDate ? ` · ${formatDate(selected.analysis.eventDate)}` : ''}{selected.analysis.ticketRef ? ` · ${selected.analysis.ticketRef}` : ''}</p></div></div>
                <div className="ai-actions-title"><strong>Actions proposées par CoproLink</strong><span>Validation humaine obligatoire.</span></div>
                <div className="ai-action-list">
                  {selected.analysis.eventDate && <article className={`ai-action ${selected.calendarEventId ? 'executed' : 'review'}`}><span className="ai-action-icon"><CalendarDays /></span><div><strong>Ajouter cette intervention au calendrier</strong><p>{formatDate(selected.analysis.eventDate)}{selected.analysis.times.start ? ` · ${selected.analysis.times.start}${selected.analysis.times.end ? `–${selected.analysis.times.end}` : ''}` : ' · heure non précisée'}</p><small>{selected.subject || selected.analysis.summary}</small></div><span className={`ai-action-status ${selected.calendarEventId ? 'executed' : 'review'}`}>{selected.calendarEventId ? 'Ajouté' : 'À valider'}</span>{!selected.calendarEventId && <div className="ai-action-buttons"><button className="approve" disabled={actionState.emailId === selected.id} onClick={() => createCalendarEvent(selected)}><CheckCircle2 /> {actionState.emailId === selected.id ? 'Ajout en cours…' : 'Valider et ajouter'}</button></div>}</article>}
                  {selected.analysis.ticketRef && <article className="ai-action"><span className="ai-action-icon"><TicketCheck /></span><div><strong>Signalement reconnu</strong><p>{selected.analysis.ticketRef}</p></div><span className="ai-action-status">Détecté</span></article>}
                  {selected.analysis.files.map((name, index) => <article className="ai-action" key={`${name}-${index}`}><span className="ai-action-icon"><FileText /></span><div><strong>{name}</strong><p>Classement proposé : {folderFor(`${selected.subject}\n${selected.analysis.body}`)}</p></div><span className="ai-action-status">Pièce jointe</span></article>)}
                </div>
                {actionState.error && <p style={{color:'#9a4f48',fontSize:'10px',margin:'10px 2px'}}>{actionState.error}</p>}
                <div className="ai-output-section"><div className="ai-output-heading"><Mail /><strong>Contenu reçu</strong><span>{selected.processingStatus === 'content_ready' ? 'OK' : '…'}</span></div><p className="ai-mini-empty" style={{fontSize:'10px',lineHeight:'1.6',whiteSpace:'pre-wrap'}}>{selected.analysis.body || 'Le corps du mail n’a pas encore pu être récupéré depuis Resend.'}</p></div>
              </> : <div className="ai-result-empty"><Sparkles /><p>Envoie un mail à l’adresse de la copropriété pour le voir apparaître ici.</p></div>}
            </section>
          </div>
        </section>
      </section>
    </main>
  )
}
