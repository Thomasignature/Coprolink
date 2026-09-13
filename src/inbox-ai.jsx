import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Bot, Building2, CalendarDays, Check, CheckCircle2, ChevronRight,
  FileText, FolderCheck, HelpCircle, Inbox, LayoutDashboard, LogOut, Mail, MessageSquareText,
  Paperclip, RotateCcw, Search, Settings, ShieldCheck, Sparkles, TicketCheck, Trash2, X,
} from 'lucide-react'
import { Logo } from './views.jsx'
import './inbox-ai.css'

const STORAGE_PREFIX = 'coprolink-inbox-sandbox-v1:'

const MONTHS = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
}

const EXAMPLES = [
  {
    label: 'Intervention ascenseur',
    sender: 'planning@ascenseurs-xyz.be',
    senderName: 'Ascenseurs XYZ',
    subject: 'Intervention ascenseur — 18 septembre',
    body: "Bonjour, notre technicien interviendra le 18 septembre 2026 entre 9h et 11h pour l’entretien annuel de l’ascenseur. L’appareil sera indisponible pendant l’intervention. Bien à vous.",
    attachments: 'Rapport_entretien_ascenseur.pdf',
  },
  {
    label: 'PV d’assemblée générale',
    sender: 'syndic@cabinet-exemple.be',
    senderName: 'Cabinet Exemple',
    subject: 'PV de l’assemblée générale du 4 septembre 2026',
    body: 'Bonjour, veuillez trouver en annexe le procès-verbal de l’assemblée générale qui s’est tenue le 4 septembre 2026. Merci de le mettre à disposition des copropriétaires.',
    attachments: 'PV_AG_04-09-2026.pdf',
  },
  {
    label: 'Échéance assurance',
    sender: 'courtier@assurances-exemple.be',
    senderName: 'Assurances Exemple',
    subject: 'Échéance du contrat immeuble',
    body: 'Bonjour, nous vous rappelons que le contrat multirisque immeuble arrive à échéance le 31 décembre 2026. Vous trouverez la police actuelle en annexe.',
    attachments: 'Police_multirisque_2026.pdf',
  },
  {
    label: 'Réponse à un signalement',
    sender: 'syndic@cabinet-exemple.be',
    senderName: 'Cabinet Exemple',
    subject: 'Re: signalement T-1001 — fuite garage',
    body: 'Bonjour, concernant le ticket T-1001, le plombier a été contacté. Son passage est prévu le 22 septembre 2026 à 08h30. Bien à vous.',
    attachments: '',
  },
]

const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
const pad = value => String(value).padStart(2, '0')
const clean = value => String(value || '').trim()
const lower = value => clean(value).toLocaleLowerCase('fr-BE')

const readStore = slug => {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${slug}`)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

const writeStore = (slug, messages) => {
  try { localStorage.setItem(`${STORAGE_PREFIX}${slug}`, JSON.stringify(messages)) } catch { /* sandbox only */ }
}

const formatDate = value => {
  if (!value) return 'Date non détectée'
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)
}

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
  let year = named[3] ? Number(named[3]) : new Date().getFullYear()
  const candidate = new Date(`${year}-${pad(month)}-${pad(day)}T12:00:00`)
  const thirtyDaysAgo = Date.now() - 30 * 86400000
  if (!named[3] && candidate.getTime() < thirtyDaysAgo) year += 1
  return `${year}-${pad(month)}-${pad(day)}`
}

const toTime = (hour, minute = '0') => `${pad(Math.min(23, Number(hour)))}:${pad(Math.min(59, Number(minute || 0)))}`

const parseTimes = text => {
  const source = lower(text)
  const range = source.match(/(?:entre|de)?\s*(\d{1,2})(?:\s*[h:]\s*(\d{1,2}))?\s*h?\s*(?:et|à|a|\-|–)\s*(\d{1,2})(?:\s*[h:]\s*(\d{1,2}))?\s*h?\b/)
  if (range) return { start: toTime(range[1], range[2]), end: toTime(range[3], range[4]) }
  const single = source.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{1,2})?\b/)
  return single ? { start: toTime(single[1], single[2]), end: null } : { start: null, end: null }
}

const classify = text => {
  const value = lower(text)
  if (/\bT-\d{4,}\b/i.test(text) || /signalement|ticket/.test(value)) return { key: 'ticket_reply', label: 'Réponse à un signalement' }
  if (/assembl[ée]e g[ée]n[ée]rale|\bag\b|proc[èe]s-verbal|\bpv\b/.test(value)) return { key: 'meeting', label: 'Assemblée générale' }
  if (/contrat|[ée]ch[ée]ance|renouvellement|assurance|police/.test(value)) return { key: 'contract', label: 'Contrat / échéance' }
  if (/ascenseur|intervention|technicien|entretien|maintenance|travaux|plombier|chauffagiste|passage/.test(value)) return { key: 'intervention', label: 'Intervention' }
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
  if (/travaux|intervention|maintenance|entretien/.test(value)) return 'Interventions'
  return 'Documents reçus'
}

const summarize = (subject, body) => {
  const source = clean(body).replace(/\s+/g, ' ')
  const first = source.split(/(?<=[.!?])\s+/)[0]
  const summary = first && first.length > 24 ? first : clean(subject)
  return summary.slice(0, 220)
}

const analysisFor = ({ sender, senderName, subject, body, attachments }) => {
  const fullText = `${subject}\n${body}`
  const classification = classify(fullText)
  const eventDate = parseDate(fullText)
  const times = parseTimes(fullText)
  const ticketRef = fullText.match(/\bT-\d{4,}\b/i)?.[0]?.toUpperCase() || null
  const files = attachments.split(/[\n,;]+/).map(clean).filter(Boolean).slice(0, 8)
  const provider = clean(senderName) || clean(sender).split('@')[0] || 'Expéditeur'
  const summary = summarize(subject, body)

  let confidence = 72
  if (classification.key !== 'information') confidence += 8
  if (eventDate) confidence += 9
  if (files.length) confidence += 5
  if (ticketRef) confidence += 6
  confidence = Math.min(98, confidence)

  const actions = []
  if (eventDate) {
    const timeLabel = times.start ? `${times.start}${times.end ? `–${times.end}` : ''}` : 'heure non précisée'
    actions.push({
      id: uid(), type: 'event', status: 'executed', confidence: Math.min(99, confidence + 1),
      title: 'Date ajoutée au calendrier',
      detail: `${clean(subject) || classification.label} · ${formatDate(eventDate)} · ${timeLabel}`,
      payload: { title: clean(subject) || classification.label, eventDate, eventTime: times.start || '', endTime: times.end || '', detail: summary },
    })
  }

  files.forEach(name => actions.push({
    id: uid(), type: 'document', status: 'executed', confidence,
    title: 'Document classé automatiquement',
    detail: `${name} → ${folderFor(fullText)}`,
    payload: { name, folder: folderFor(fullText) },
  }))

  if (ticketRef) {
    actions.push({
      id: uid(), type: 'ticket', status: 'executed', confidence: Math.min(99, confidence + 1),
      title: `${ticketRef} mis à jour`,
      detail: summary,
      payload: { reference: ticketRef, note: summary },
    })
  }

  if (['intervention', 'meeting', 'information'].includes(classification.key)) {
    actions.push({
      id: uid(), type: 'announcement', status: 'review', confidence: Math.max(78, confidence - 2),
      title: 'Communication préparée',
      detail: `Brouillon prêt pour les copropriétaires : « ${clean(subject) || classification.label} »`,
      payload: { title: clean(subject) || classification.label, body: summary, priority: classification.key === 'intervention' ? 'important' : 'normal' },
    })
  }

  if (actions.length === 0) {
    actions.push({
      id: uid(), type: 'archive', status: 'executed', confidence,
      title: 'Mail structuré dans l’Inbox',
      detail: 'Le message est conservé et pourra être reclassé ou traité plus tard.',
      payload: {},
    })
  }

  return {
    classification, eventDate, startTime: times.start, endTime: times.end, ticketRef,
    provider, files, summary, confidence, actions,
  }
}

const actionIcon = type => ({
  event: <CalendarDays />, document: <FolderCheck />, announcement: <MessageSquareText />,
  ticket: <TicketCheck />, archive: <Inbox />,
}[type] || <Sparkles />)

const statusLabel = status => ({ executed: 'Automatique', review: 'À valider', rejected: 'Ignorée' }[status] || status)

export default function InboxAIView({ session, onLogout }) {
  const eligibleBuildings = useMemo(
    () => session.memberships.filter(m => m.role === 'manager' || m.role === 'council_member'),
    [session.memberships],
  )
  const initialSlug = new URLSearchParams(location.hash.split('?')[1] || '').get('building') || eligibleBuildings[0]?.buildingSlug || ''
  const [buildingSlug, setBuildingSlug] = useState(initialSlug)
  const [messages, setMessages] = useState(() => readStore(initialSlug))
  const [selectedId, setSelectedId] = useState(() => readStore(initialSlug)[0]?.id || null)
  const [form, setForm] = useState({ sender: '', senderName: '', subject: '', body: '', attachments: '' })
  const [query, setQuery] = useState('')

  const building = eligibleBuildings.find(item => item.buildingSlug === buildingSlug) || eligibleBuildings[0]

  useEffect(() => {
    if (!buildingSlug && eligibleBuildings[0]) setBuildingSlug(eligibleBuildings[0].buildingSlug)
  }, [buildingSlug, eligibleBuildings])

  useEffect(() => {
    const next = readStore(buildingSlug)
    setMessages(next)
    setSelectedId(next[0]?.id || null)
  }, [buildingSlug])

  const persist = next => {
    setMessages(next)
    writeStore(buildingSlug, next)
  }

  const selected = messages.find(message => message.id === selectedId) || messages[0] || null
  const filtered = messages.filter(message => {
    const needle = lower(query)
    return !needle || lower(`${message.subject} ${message.senderName} ${message.sender} ${message.analysis.classification.label}`).includes(needle)
  })

  const totals = useMemo(() => {
    const actions = messages.flatMap(message => message.analysis.actions)
    return {
      emails: messages.length,
      automatic: actions.filter(action => action.status === 'executed').length,
      review: actions.filter(action => action.status === 'review').length,
      dates: actions.filter(action => action.type === 'event' && action.status === 'executed').length,
    }
  }, [messages])

  const calendarItems = messages
    .flatMap(message => message.analysis.actions.map(action => ({ action, message })))
    .filter(item => item.action.type === 'event' && item.action.status === 'executed')
    .sort((a, b) => (a.action.payload.eventDate || '').localeCompare(b.action.payload.eventDate || ''))

  const documentItems = messages
    .flatMap(message => message.analysis.actions.map(action => ({ action, message })))
    .filter(item => item.action.type === 'document' && item.action.status === 'executed')

  const loadExample = example => setForm({
    sender: example.sender, senderName: example.senderName, subject: example.subject,
    body: example.body, attachments: example.attachments,
  })

  const analyse = event => {
    event.preventDefault()
    if (!clean(form.subject) && !clean(form.body)) return
    const message = {
      id: uid(), source: 'sandbox', sender: clean(form.sender) || 'expediteur@exemple.be',
      senderName: clean(form.senderName), subject: clean(form.subject) || '(Sans objet)', body: clean(form.body),
      attachments: clean(form.attachments), receivedAt: new Date().toISOString(),
      analysis: analysisFor(form),
    }
    const next = [message, ...messages]
    persist(next)
    setSelectedId(message.id)
  }

  const updateAction = (messageId, actionId, status) => {
    const next = messages.map(message => message.id !== messageId ? message : {
      ...message,
      analysis: { ...message.analysis, actions: message.analysis.actions.map(action => action.id === actionId ? { ...action, status } : action) },
    })
    persist(next)
  }

  const removeMessage = messageId => {
    const next = messages.filter(message => message.id !== messageId)
    persist(next)
    setSelectedId(next[0]?.id || null)
  }

  const reset = () => {
    if (!confirm('Réinitialiser toute la simulation Inbox pour cet immeuble ?')) return
    persist([])
    setSelectedId(null)
  }

  const changeBuilding = slug => {
    setBuildingSlug(slug)
    location.hash = `/portfolio?view=inbox&building=${encodeURIComponent(slug)}`
  }

  if (!building) {
    return <main className="ai-no-access"><ShieldCheck /><h1>Inbox IA indisponible</h1><p>Aucun immeuble administrable n’est associé à ce compte.</p><button onClick={() => { location.hash = '/resident' }}>Retour</button></main>
  }

  return (
    <main className="v2-shell ai-shell">
      <aside className="v2-sidebar">
        <Logo />
        <nav>
          <button onClick={() => { location.hash = '/portfolio' }}><LayoutDashboard /> Tableau de bord</button>
          <button onClick={() => { location.hash = '/portfolio' }}><Building2 /> Copropriétés</button>
          <button className="active"><Sparkles /> Inbox IA <b>BETA</b></button>
          <button><CalendarDays /> Échéances</button>
          <button><FileText /> Documents</button>
        </nav>
        <div className="v2-sidebar-bottom">
          <button><HelpCircle /> Aide & support</button>
          <button><Settings /> Paramètres</button>
          <div className="v2-user-card">
            <span>{(session.user.fullName || session.user.email).split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase()}</span>
            <div><strong>{session.user.fullName || session.user.email}</strong><small>Mode prototype sécurisé</small></div>
          </div>
          <button onClick={onLogout}><LogOut /> Se déconnecter</button>
        </div>
      </aside>

      <section className="v2-main ai-main">
        <header className="ai-topbar">
          <div className="ai-title-row">
            <button className="ai-back" onClick={() => { location.hash = '/portfolio' }} aria-label="Retour"><ArrowLeft /></button>
            <div><span className="ai-kicker">COPROLINK INTELLIGENCE</span><h1>Inbox intelligente</h1><p>Un mail arrive. CoproLink le comprend et prépare le travail à votre place.</p></div>
          </div>
          <div className="ai-top-actions">
            <span className="ai-sandbox-badge"><ShieldCheck /> Sandbox sécurisé</span>
            <select value={buildingSlug} onChange={event => changeBuilding(event.target.value)}>
              {eligibleBuildings.map(item => <option key={item.buildingSlug} value={item.buildingSlug}>{item.buildingName}</option>)}
            </select>
          </div>
        </header>

        <section className="ai-safety-note">
          <Bot />
          <div><strong>Prototype IA sans impact sur tes données réelles</strong><span>Les analyses et actions ci-dessous restent dans ce navigateur. Le futur moteur serveur reprendra exactement ce flux avant d’être connecté aux vrais e-mails.</span></div>
        </section>

        <section className="ai-stats">
          <article><Mail /><div><strong>{totals.emails}</strong><span>mails analysés</span></div></article>
          <article><Sparkles /><div><strong>{totals.automatic}</strong><span>actions automatisées</span></div></article>
          <article className={totals.review ? 'attention' : ''}><CheckCircle2 /><div><strong>{totals.review}</strong><span>à valider</span></div></article>
          <article><CalendarDays /><div><strong>{totals.dates}</strong><span>dates détectées</span></div></article>
        </section>

        <section className="ai-workspace">
          <div className="ai-left-column">
            <section className="ai-card ai-compose-card">
              <div className="ai-card-head"><div><span>SIMULATEUR D’E-MAIL</span><h2>Tester le cerveau de CoproLink</h2></div><Sparkles /></div>
              <div className="ai-example-row">
                {EXAMPLES.map(example => <button key={example.label} type="button" onClick={() => loadExample(example)}>{example.label}</button>)}
              </div>
              <form onSubmit={analyse} className="ai-compose-form">
                <div className="ai-two-cols">
                  <label><span>Nom de l’expéditeur</span><input value={form.senderName} onChange={e => setForm(f => ({ ...f, senderName: e.target.value }))} placeholder="Ascenseurs XYZ" /></label>
                  <label><span>Adresse e-mail</span><input type="email" value={form.sender} onChange={e => setForm(f => ({ ...f, sender: e.target.value }))} placeholder="planning@prestataire.be" /></label>
                </div>
                <label><span>Objet</span><input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Intervention ascenseur — 18 septembre" /></label>
                <label><span>Message</span><textarea rows="6" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Collez ici le contenu d’un e-mail réel ou utilisez un exemple…" /></label>
                <label><span>Pièces jointes <em>(noms séparés par une virgule)</em></span><div className="ai-input-icon"><Paperclip /><input value={form.attachments} onChange={e => setForm(f => ({ ...f, attachments: e.target.value }))} placeholder="rapport.pdf, devis.pdf" /></div></label>
                <button className="ai-analyse-btn" type="submit"><Sparkles /> Analyser avec CoproLink IA <ChevronRight /></button>
              </form>
            </section>

            <section className="ai-card ai-history-card">
              <div className="ai-card-head ai-history-head">
                <div><span>INBOX</span><h2>Historique simulé</h2></div>
                <div className="ai-history-tools">
                  <label><Search /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher…" /></label>
                  {messages.length > 0 && <button onClick={reset} title="Réinitialiser"><RotateCcw /></button>}
                </div>
              </div>
              <div className="ai-message-list">
                {filtered.map(message => {
                  const pending = message.analysis.actions.filter(action => action.status === 'review').length
                  return (
                    <button key={message.id} className={message.id === selected?.id ? 'selected' : ''} onClick={() => setSelectedId(message.id)}>
                      <span className="ai-avatar">{(message.senderName || message.sender || '?').slice(0, 1).toUpperCase()}</span>
                      <span className="ai-message-copy"><strong>{message.subject}</strong><small>{message.senderName || message.sender} · {message.analysis.classification.label}</small></span>
                      <span className="ai-confidence">{message.analysis.confidence}%</span>
                      {pending > 0 ? <em className="review">{pending} à valider</em> : <em><Check /> traité</em>}
                    </button>
                  )
                })}
                {filtered.length === 0 && <div className="ai-empty"><Inbox /><strong>Aucun e-mail analysé</strong><span>Charge un exemple ci-dessus pour voir CoproLink travailler.</span></div>}
              </div>
            </section>
          </div>

          <div className="ai-right-column">
            <section className="ai-card ai-result-card">
              <div className="ai-card-head"><div><span>ANALYSE IA</span><h2>{selected ? 'CoproLink a traité ce mail' : 'En attente d’un e-mail'}</h2></div>{selected && <span className="ai-confidence-large">{selected.analysis.confidence}%</span>}</div>
              {selected ? (
                <>
                  <div className="ai-analysis-summary">
                    <div className="ai-analysis-icon"><Bot /></div>
                    <div><span className="ai-type-chip">{selected.analysis.classification.label}</span><h3>{selected.analysis.summary}</h3><p>{selected.analysis.provider}{selected.analysis.eventDate ? ` · ${formatDate(selected.analysis.eventDate)}` : ''}{selected.analysis.ticketRef ? ` · ${selected.analysis.ticketRef}` : ''}</p></div>
                  </div>
                  <div className="ai-actions-title"><strong>Actions proposées par CoproLink</strong><span>Les actions sûres sont simulées automatiquement.</span></div>
                  <div className="ai-action-list">
                    {selected.analysis.actions.map(action => (
                      <article key={action.id} className={`ai-action ${action.status}`}>
                        <span className="ai-action-icon">{actionIcon(action.type)}</span>
                        <div><strong>{action.title}</strong><p>{action.detail}</p><small>{action.confidence}% de confiance</small></div>
                        <span className={`ai-action-status ${action.status}`}>{statusLabel(action.status)}</span>
                        {action.status === 'review' && (
                          <div className="ai-action-buttons">
                            <button className="approve" onClick={() => updateAction(selected.id, action.id, 'executed')}><Check /> Valider</button>
                            <button onClick={() => updateAction(selected.id, action.id, 'rejected')}><X /> Ignorer</button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                  <button className="ai-delete-mail" onClick={() => removeMessage(selected.id)}><Trash2 /> Retirer ce mail du sandbox</button>
                </>
              ) : <div className="ai-result-empty"><Sparkles /><p>Colle un e-mail ou choisis un scénario de démonstration. L’analyse apparaîtra ici instantanément.</p></div>}
            </section>

            <section className="ai-card ai-output-card">
              <div className="ai-card-head"><div><span>RÉSULTAT COPROLINK</span><h2>Données structurées</h2></div><CheckCircle2 /></div>
              <div className="ai-output-section">
                <div className="ai-output-heading"><CalendarDays /><strong>Calendrier</strong><span>{calendarItems.length}</span></div>
                {calendarItems.slice(0, 4).map(({ action, message }) => (
                  <div className="ai-output-row" key={action.id}><span className="ai-date-box"><b>{action.payload.eventDate?.slice(8, 10)}</b><small>{new Intl.DateTimeFormat('fr-BE', { month: 'short' }).format(new Date(`${action.payload.eventDate}T12:00:00`))}</small></span><div><strong>{action.payload.title}</strong><small>{action.payload.eventTime || 'Heure non précisée'} · {message.analysis.provider}</small></div></div>
                ))}
                {calendarItems.length === 0 && <p className="ai-mini-empty">Aucune date détectée pour le moment.</p>}
              </div>
              <div className="ai-output-section">
                <div className="ai-output-heading"><FolderCheck /><strong>Documents classés</strong><span>{documentItems.length}</span></div>
                {documentItems.slice(0, 4).map(({ action }) => (
                  <div className="ai-doc-row" key={action.id}><FileText /><div><strong>{action.payload.name}</strong><small>{action.payload.folder}</small></div><Check /></div>
                ))}
                {documentItems.length === 0 && <p className="ai-mini-empty">Aucune pièce jointe classée.</p>}
              </div>
            </section>
          </div>
        </section>
      </section>
    </main>
  )
}
