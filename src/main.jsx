import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, AlertTriangle, ArrowLeft, Bell, BookOpen, Building2, CalendarDays, Check,
  ChevronRight, CircleDollarSign, Clock3, Download, FileText, Gauge, HardHat, Home,
  Info, LayoutDashboard, LogOut, Menu, MessageSquareText, Plus, QrCode, Search,
  Settings, ShieldCheck, Smartphone, Sparkles, TicketCheck, Users, Wrench, X,
  CircleCheckBig, CircleDashed, ExternalLink, WalletCards, Mail, RefreshCcw
} from 'lucide-react'
import './styles.css'

const STORAGE_KEY = 'coprolink-mvp-state-v1'

const seedState = {
  building: {
    id: 'res-jardins', name: 'Résidence Les Jardins', address: 'Avenue des Tilleuls 18, 5000 Namur',
    lots: 36, manager: 'Atlas Syndic', emergency: '+32 81 00 00 00', reserveFund: 128400,
    yearlyBudget: 96500, yearlySpent: 61140, healthScore: 82
  },
  announcements: [
    {id:'a1', title:'Nettoyage du parking', body:'Le parking -1 sera nettoyé le 8 octobre de 07:00 à 12:00. Merci de libérer les emplacements.', date:'2026-09-08', priority:'important'},
    {id:'a2', title:'Entretien des espaces verts', body:'Passage de l’équipe d’entretien prévu vendredi matin. Aucun accès aux jardins privatifs n’est nécessaire.', date:'2026-09-05', priority:'normal'}
  ],
  events: [
    {id:'e1', date:'2026-09-12', time:'14:00', title:'Éclairage du hall', detail:'Passage du technicien'},
    {id:'e2', date:'2026-09-17', time:'09:00', title:'Porte du garage', detail:'Intervention GarageTech'},
    {id:'e3', date:'2026-09-21', time:'08:30', title:'Maintenance ascenseur', detail:'Entretien trimestriel'},
    {id:'e4', date:'2026-10-08', time:'07:00', title:'Nettoyage parking', detail:'Parking -1 à libérer'}
  ],
  tickets: [
    {id:'T-1042', title:'Porte du garage', category:'Garage', location:'Niveau -1', description:'La porte reste parfois bloquée à mi-course.', status:'scheduled', public:true, created:'2026-09-02', reporter:'Concierge', next:'Intervention le 17 septembre à 09:00', timeline:[
      {label:'Signalé', date:'02/09'}, {label:'Prestataire contacté', date:'02/09'}, {label:'Rendez-vous confirmé', date:'04/09'}
    ]},
    {id:'T-1047', title:'Éclairage du hall', category:'Éclairage', location:'Rez-de-chaussée', description:'Deux spots sont hors service près des boîtes aux lettres.', status:'scheduled', public:true, created:'2026-09-07', reporter:'S. Lambert', next:'Technicien prévu le 12 septembre à 14:00', timeline:[{label:'Signalé', date:'07/09'},{label:'Rendez-vous confirmé', date:'08/09'}]},
    {id:'T-1035', title:'Humidité local vélos', category:'Bâtiment', location:'Niveau -1', description:'Trace d’humidité sur le mur côté cour.', status:'waiting', public:true, created:'2026-08-29', reporter:'Conseil de copropriété', next:'Devis d’étanchéité en attente', timeline:[{label:'Signalé',date:'29/08'},{label:'Visite technique',date:'03/09'}]},
    {id:'T-1022', title:'Serrure porte arrière', category:'Accès', location:'Rez-de-chaussée', description:'La serrure a été remplacée.', status:'resolved', public:true, created:'2026-08-18', reporter:'M. Dupont', next:'Dossier clôturé', timeline:[{label:'Signalé',date:'18/08'},{label:'Prestataire contacté',date:'18/08'},{label:'Intervention',date:'20/08'},{label:'Résolu',date:'20/08'}]}
  ],
  documents: [
    {id:'d1', name:"Règlement d'ordre intérieur", type:'PDF', access:'public', updated:'2026-06-10'},
    {id:'d2', name:'Consignes incendie', type:'PDF', access:'public', updated:'2026-01-12'},
    {id:'d3', name:'PV Assemblée générale 2026', type:'PDF', access:'private', updated:'2026-05-28'},
    {id:'d4', name:'Décompte individuel 2025-2026', type:'PDF', access:'private', updated:'2026-06-15'},
    {id:'d5', name:'Plan pluriannuel des travaux', type:'PDF', access:'private', updated:'2026-07-02'}
  ],
  resident: {name:'Sophie Lambert', unit:'Appartement B23', share:'82/10.000', quarterlyCall:612.40, paymentStatus:'paid', balance:0},
  activity: [
    {id:'l1', text:'GarageTech a confirmé son intervention pour la porte du garage.', date:'2026-09-08T10:15:00'},
    {id:'l2', text:'Une communication “Nettoyage du parking” a été publiée.', date:'2026-09-08T08:42:00'},
    {id:'l3', text:'Le ticket T-1047 a été planifié.', date:'2026-09-08T08:15:00'}
  ]
}

function loadState(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || seedState } catch { return seedState }
}
function saveState(state){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) }

const money = n => new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n)
const longDate = d => new Intl.DateTimeFormat('fr-BE',{day:'numeric',month:'long',year:'numeric'}).format(new Date(d+'T12:00:00'))
const shortDate = d => new Intl.DateTimeFormat('fr-BE',{day:'2-digit',month:'short'}).format(new Date(d+'T12:00:00')).replace('.','')
const statusMeta = {
  new: {label:'Nouveau', cls:'status-blue'},
  in_progress: {label:'En cours', cls:'status-amber'},
  waiting: {label:'En attente', cls:'status-violet'},
  scheduled: {label:'Planifié', cls:'status-teal'},
  resolved: {label:'Résolu', cls:'status-green'}
}

function App(){
  const [state,setState] = useState(loadState)
  const [route,setRoute] = useState(() => location.hash.replace('#/','') || 'home')
  const [toast,setToast] = useState('')
  useEffect(()=>{ saveState(state) },[state])
  useEffect(()=>{
    const h=()=>setRoute(location.hash.replace('#/','') || 'home'); addEventListener('hashchange',h); return()=>removeEventListener('hashchange',h)
  },[])
  useEffect(()=>{ if(!toast)return; const t=setTimeout(()=>setToast(''),2800); return()=>clearTimeout(t)},[toast])
  const go = r => { location.hash = '#/'+r }
  const updateTicket = (id, patch) => setState(s=>({...s,tickets:s.tickets.map(t=>t.id===id?{...t,...patch}:t)}))
  const addTicket = data => {
    const id='T-'+String(1050+state.tickets.length)
    const ticket={id,...data,status:'new',public:data.public??true,created:new Date().toISOString().slice(0,10),timeline:[{label:'Signalé',date:new Intl.DateTimeFormat('fr-BE',{day:'2-digit',month:'2-digit'}).format(new Date())}],next:'En attente de prise en charge'}
    setState(s=>({...s,tickets:[ticket,...s.tickets],activity:[{id:crypto.randomUUID?.()||Date.now(),text:`Nouveau signalement ${id} : ${data.title}.`,date:new Date().toISOString()},...s.activity]}))
    return id
  }
  const addAnnouncement = data => setState(s=>({...s,announcements:[{id:crypto.randomUUID?.()||Date.now(),date:new Date().toISOString().slice(0,10),priority:'normal',...data},...s.announcements],activity:[{id:Date.now(),text:`Communication “${data.title}” publiée.`,date:new Date().toISOString()},...s.activity]}))
  const resetDemo = ()=>{ setState(structuredClone(seedState)); setToast('Données de démonstration réinitialisées') }
  return <>
    {route==='home' && <DemoHub state={state} go={go} resetDemo={resetDemo}/>} 
    {route==='display' && <DisplayView state={state} addTicket={addTicket} go={go} setToast={setToast}/>} 
    {route==='resident' && <ResidentView state={state} addTicket={addTicket} go={go} setToast={setToast}/>} 
    {route==='syndic' && <SyndicView state={state} updateTicket={updateTicket} addAnnouncement={addAnnouncement} go={go} setToast={setToast}/>} 
    {toast && <div className="toast"><CircleCheckBig size={18}/>{toast}</div>}
  </>
}

function Logo({compact=false}){
  return <div className="logo-lockup"><div className="logo-mark"><Building2 size={compact?18:22}/></div>{!compact&&<div><strong>CoproLink</strong><span>Building OS</span></div>}</div>
}

function DemoHub({state,go,resetDemo}){
  return <main className="hub-page">
    <header className="hub-nav"><Logo/><button className="ghost-btn" onClick={resetDemo}><RefreshCcw size={16}/> Réinitialiser la démo</button></header>
    <section className="hero">
      <div className="eyebrow"><Sparkles size={16}/> Prototype interactif</div>
      <h1>La copropriété devient<br/><em>lisible, vivante et durable.</em></h1>
      <p>Une seule mémoire numérique pour l’immeuble, accessible aux copropriétaires, au syndic et depuis l’écran installé dans les communs.</p>
    </section>
    <section className="mode-grid">
      <ModeCard icon={<Gauge/>} kicker="Dans les communs" title="Écran de la résidence" desc="Information publique, incidents, agenda et signalement en quelques secondes." action="Ouvrir le mode tablette" onClick={()=>go('display')} accent="dark"/>
      <ModeCard icon={<Home/>} kicker="Espace privé" title="Copropriétaire" desc="Suivi personnel, documents, appels de fonds et signalements sans rechercher dans ses e-mails." action="Voir l’expérience résident" onClick={()=>go('resident')}/>
      <ModeCard icon={<LayoutDashboard/>} kicker="Back-office" title="Syndic" desc="Prioriser les demandes, publier une information et garder toute la copropriété alignée avec le moins de saisie possible." action="Voir l’espace syndic" onClick={()=>go('syndic')}/>
    </section>
    <section className="hub-proof">
      <div><strong>{state.building.lots}</strong><span>lots dans la résidence démo</span></div>
      <div><strong>{state.tickets.filter(t=>t.status!=='resolved').length}</strong><span>interventions actives</span></div>
      <div><strong>{state.documents.length}</strong><span>documents centralisés</span></div>
      <div><strong>1</strong><span>historique qui reste avec l’ACP</span></div>
    </section>
  </main>
}
function ModeCard({icon,kicker,title,desc,action,onClick,accent}){
  return <button className={'mode-card '+(accent==='dark'?'mode-card-dark':'')} onClick={onClick}>
    <div className="mode-icon">{icon}</div><span className="mode-kicker">{kicker}</span><h2>{title}</h2><p>{desc}</p><div className="mode-action">{action}<ChevronRight size={18}/></div>
  </button>
}

function DisplayView({state,addTicket,go,setToast}){
  const [tab,setTab]=useState('home'); const [reportOpen,setReportOpen]=useState(false); const [selected,setSelected]=useState(null)
  const active=state.tickets.filter(t=>t.public&&t.status!=='resolved')
  useEffect(()=>{ let timer; const reset=()=>{clearTimeout(timer);timer=setTimeout(()=>{setTab('home');setReportOpen(false);setSelected(null)},120000)}; ['pointerdown','keydown'].forEach(e=>addEventListener(e,reset));reset();return()=>{clearTimeout(timer);['pointerdown','keydown'].forEach(e=>removeEventListener(e,reset))}},[])
  return <main className="display-shell">
    <header className="display-top"><Logo/><div className="display-building"><span>{state.building.name}</span><small>{state.building.address}</small></div><Clock/></header>
    <section className="display-main">
      <div className="display-content">
        {tab==='home' && <>
          <div className="building-status"><div><span className="pulse-dot"></span><strong>Tout fonctionne normalement</strong></div><p>{active.length} interventions sont actuellement suivies dans la résidence.</p></div>
          <div className="display-grid">
            <div className="big-panel"><div className="section-head"><div><span className="section-kicker">Suivi en cours</span><h2>Ce qui se passe dans l’immeuble</h2></div><button className="text-btn" onClick={()=>setTab('tickets')}>Tout voir <ChevronRight size={17}/></button></div>
              <div className="ticket-stack">{active.slice(0,3).map(t=><DisplayTicket key={t.id} t={t} onClick={()=>setSelected(t)}/>)}</div>
            </div>
            <div className="side-stack"><AnnouncementCard item={state.announcements[0]}/><NextEvent event={state.events[0]}/></div>
          </div>
        </>}
        {tab==='tickets' && <div className="big-panel full"><PageTitle kicker="Interventions" title="Suivi de la résidence" onBack={()=>setTab('home')}/><div className="ticket-stack">{active.map(t=><DisplayTicket key={t.id} t={t} onClick={()=>setSelected(t)}/>)}</div></div>}
        {tab==='agenda' && <div className="big-panel full"><PageTitle kicker="Agenda" title="Prochaines dates" onBack={()=>setTab('home')}/><div className="agenda-list">{state.events.map(e=><AgendaRow key={e.id} e={e}/>)}</div></div>}
        {tab==='docs' && <div className="big-panel full"><PageTitle kicker="Documents publics" title="Informations pratiques" onBack={()=>setTab('home')}/><div className="document-grid">{state.documents.filter(d=>d.access==='public').map(d=><DocumentTile key={d.id} d={d} publicMode setToast={setToast}/>)}</div></div>}
      </div>
      <nav className="display-dock">
        <DockButton active={tab==='home'} icon={<Home/>} label="Accueil" onClick={()=>setTab('home')}/>
        <DockButton active={tab==='tickets'} icon={<Wrench/>} label="Interventions" onClick={()=>setTab('tickets')}/>
        <button className="report-fab" onClick={()=>setReportOpen(true)}><Plus size={26}/><span>Signaler</span></button>
        <DockButton active={tab==='agenda'} icon={<CalendarDays/>} label="Agenda" onClick={()=>setTab('agenda')}/>
        <DockButton active={tab==='docs'} icon={<FileText/>} label="Documents" onClick={()=>setTab('docs')}/>
      </nav>
    </section>
    <button className="demo-exit" onClick={()=>go('home')}><ArrowLeft size={16}/> Démo</button>
    {reportOpen&&<ReportModal onClose={()=>setReportOpen(false)} addTicket={addTicket} setToast={setToast} publicSource/>}
    {selected&&<TicketModal ticket={selected} onClose={()=>setSelected(null)}/>} 
  </main>
}
function Clock(){ const [now,setNow]=useState(new Date()); useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t)},[]); return <div className="clock"><strong>{new Intl.DateTimeFormat('fr-BE',{hour:'2-digit',minute:'2-digit'}).format(now)}</strong><span>{new Intl.DateTimeFormat('fr-BE',{weekday:'long',day:'numeric',month:'long'}).format(now)}</span></div> }
function DockButton({icon,label,active,onClick}){return <button className={'dock-btn '+(active?'active':'')} onClick={onClick}>{icon}<span>{label}</span></button>}
function PageTitle({kicker,title,onBack}){return <div className="page-title"><button className="icon-btn" onClick={onBack}><ArrowLeft/></button><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div></div>}
function DisplayTicket({t,onClick}){const m=statusMeta[t.status];return <button className="display-ticket" onClick={onClick}><div className="ticket-icon"><Wrench/></div><div className="ticket-copy"><div><strong>{t.title}</strong><span className={'status '+m.cls}>{m.label}</span></div><p>{t.next}</p><small>{t.location}</small></div><ChevronRight/></button>}
function AnnouncementCard({item}){return <article className="notice-card"><div className="notice-icon"><Bell/></div><span className="section-kicker">À savoir</span><h3>{item.title}</h3><p>{item.body}</p><small>Publié le {longDate(item.date)}</small></article>}
function NextEvent({event}){return <article className="next-event"><div className="date-block"><strong>{new Date(event.date+'T12:00:00').getDate()}</strong><span>{new Intl.DateTimeFormat('fr-BE',{month:'short'}).format(new Date(event.date+'T12:00:00')).replace('.','')}</span></div><div><span className="section-kicker">Prochaine intervention</span><h3>{event.title}</h3><p>{event.detail} · {event.time}</p></div></article>}
function AgendaRow({e}){return <div className="agenda-row"><div className="agenda-date"><strong>{new Date(e.date+'T12:00:00').getDate()}</strong><span>{new Intl.DateTimeFormat('fr-BE',{month:'short'}).format(new Date(e.date+'T12:00:00')).replace('.','')}</span></div><div><strong>{e.title}</strong><p>{e.detail}</p></div><time>{e.time}</time></div>}
function DocumentTile({d,setToast,publicMode}){return <button className="document-tile" onClick={()=>setToast(publicMode?'Prototype : ouverture du document public':'Prototype : document prêt à être ouvert')}><div className="doc-icon"><FileText/></div><div><strong>{d.name}</strong><span>Mis à jour le {longDate(d.updated)}</span></div><ExternalLink size={18}/></button>}

function ResidentView({state,addTicket,go,setToast}){
  const [section,setSection]=useState('overview'); const [report,setReport]=useState(false); const myTickets=state.tickets.filter(t=>t.reporter==='S. Lambert'||t.reporter===state.resident.name)
  return <main className="app-shell">
    <aside className="side-nav"><Logo/><div className="nav-building"><Building2/><div><strong>Les Jardins</strong><span>{state.resident.unit}</span></div></div>
      <nav><NavItem icon={<LayoutDashboard/>} label="Vue d’ensemble" active={section==='overview'} onClick={()=>setSection('overview')}/><NavItem icon={<Wrench/>} label="Mes demandes" badge={myTickets.filter(t=>t.status!=='resolved').length} active={section==='tickets'} onClick={()=>setSection('tickets')}/><NavItem icon={<FileText/>} label="Documents" active={section==='documents'} onClick={()=>setSection('documents')}/><NavItem icon={<WalletCards/>} label="Finances" active={section==='finance'} onClick={()=>setSection('finance')}/><NavItem icon={<CalendarDays/>} label="Agenda" active={section==='agenda'} onClick={()=>setSection('agenda')}/></nav>
      <div className="side-bottom"><button onClick={()=>go('home')}><ArrowLeft/> Quitter la démo</button></div>
    </aside>
    <section className="app-content"><MobileHeader title="CoproLink" onExit={()=>go('home')}/>
      <div className="content-wrap">
        {section==='overview'&&<ResidentOverview state={state} setSection={setSection} setReport={setReport}/>} 
        {section==='tickets'&&<ResidentTickets tickets={myTickets} onReport={()=>setReport(true)}/>} 
        {section==='documents'&&<ResidentDocuments docs={state.documents} setToast={setToast}/>} 
        {section==='finance'&&<ResidentFinance state={state}/>} 
        {section==='agenda'&&<ResidentAgenda events={state.events}/>} 
      </div>
      <MobileNav section={section} setSection={setSection}/>
    </section>
    {report&&<ReportModal onClose={()=>setReport(false)} addTicket={(d)=>addTicket({...d,reporter:'S. Lambert'})} setToast={setToast}/>} 
  </main>
}
function MobileHeader({title,onExit}){return <header className="mobile-header"><Logo compact/><strong>{title}</strong><button className="icon-btn" onClick={onExit}><LogOut/></button></header>}
function MobileNav({section,setSection}){return <nav className="mobile-bottom-nav"><button className={section==='overview'?'active':''} onClick={()=>setSection('overview')}><Home/><span>Accueil</span></button><button className={section==='tickets'?'active':''} onClick={()=>setSection('tickets')}><Wrench/><span>Demandes</span></button><button className={section==='documents'?'active':''} onClick={()=>setSection('documents')}><FileText/><span>Documents</span></button><button className={section==='finance'?'active':''} onClick={()=>setSection('finance')}><WalletCards/><span>Finances</span></button></nav>}
function NavItem({icon,label,badge,active,onClick}){return <button className={'nav-item '+(active?'active':'')} onClick={onClick}>{icon}<span>{label}</span>{badge>0&&<b>{badge}</b>}</button>}
function ResidentOverview({state,setSection,setReport}){
  const open=state.tickets.filter(t=>t.public&&t.status!=='resolved')
  return <><div className="content-heading"><div><span className="overline">Bonjour Sophie</span><h1>Votre résidence, en un coup d’œil.</h1></div><button className="primary-btn" onClick={()=>setReport(true)}><Plus/> Signaler un problème</button></div>
    <div className="resident-grid"><section className="span-2 card welcome-card"><div><div className="eyebrow soft"><ShieldCheck/> Résidence suivie</div><h2>{state.building.name}</h2><p>{open.length} interventions en cours. La prochaine intervention est prévue le {longDate(state.events[0].date)}.</p></div><div className="health-ring"><strong>{state.building.healthScore}</strong><span>/100</span><small>Indice bâtiment</small></div></section>
      <MetricCard icon={<WalletCards/>} label="Prochain appel de fonds" value={money(state.resident.quarterlyCall)} helper="Échéance 1er octobre"/>
      <MetricCard icon={<CircleCheckBig/>} label="Situation" value="À jour" helper="Aucun solde à payer" positive/>
      <section className="card span-2"><div className="card-head"><div><span className="overline">Interventions</span><h3>En cours dans l’immeuble</h3></div><button className="text-btn" onClick={()=>setSection('tickets')}>Mes demandes <ChevronRight/></button></div><div className="compact-tickets">{open.slice(0,3).map(t=><CompactTicket key={t.id} t={t}/>)}</div></section>
      <section className="card"><div className="card-head"><div><span className="overline">Communication</span><h3>{state.announcements[0].title}</h3></div></div><p className="muted-p">{state.announcements[0].body}</p><small className="subtle">{longDate(state.announcements[0].date)}</small></section>
      <section className="card"><div className="card-head"><div><span className="overline">Prochaine date</span><h3>{state.events[0].title}</h3></div><CalendarDays/></div><p className="event-big">{shortDate(state.events[0].date)} <span>· {state.events[0].time}</span></p><small className="subtle">{state.events[0].detail}</small></section>
    </div></>
}
function MetricCard({icon,label,value,helper,positive}){return <article className="card metric"><div className={'metric-icon '+(positive?'positive':'')}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>}
function CompactTicket({t}){const m=statusMeta[t.status];return <div className="compact-ticket"><div className="ticket-icon sm"><Wrench/></div><div><strong>{t.title}</strong><span>{t.next}</span></div><span className={'status '+m.cls}>{m.label}</span></div>}
function ResidentTickets({tickets,onReport}){return <><div className="content-heading"><div><span className="overline">Demandes</span><h1>Suivez vos signalements.</h1><p>Plus besoin de relancer pour savoir où en est une intervention.</p></div><button className="primary-btn" onClick={onReport}><Plus/> Nouveau signalement</button></div><section className="card"><div className="timeline-list">{tickets.length?tickets.map(t=><ResidentTicket key={t.id} t={t}/>):<EmptyState icon={<TicketCheck/>} title="Aucune demande" text="Vos signalements personnels apparaîtront ici."/>}</div></section></>}
function ResidentTicket({t}){const m=statusMeta[t.status];return <article className="resident-ticket"><div className="ticket-top"><div><span className="overline">{t.id} · {t.location}</span><h3>{t.title}</h3></div><span className={'status '+m.cls}>{m.label}</span></div><p>{t.description}</p><div className="steps">{['Signalé','Pris en charge','Planifié','Résolu'].map((s,i)=>{const reached = t.status==='resolved'||(t.status==='scheduled'&&i<=2)||(t.status==='waiting'&&i<=1)||(t.status==='in_progress'&&i<=1)||(t.status==='new'&&i===0);return <div className={reached?'done':''} key={s}><span>{reached?<Check/>:<CircleDashed/>}</span><small>{s}</small></div>})}</div><div className="ticket-next"><Clock3/><span>{t.next}</span></div></article>}
function ResidentDocuments({docs,setToast}){return <><div className="content-heading"><div><span className="overline">Documents</span><h1>Tout retrouver au même endroit.</h1><p>Documents de l’ACP et documents réservés à votre espace.</p></div></div><div className="document-list">{docs.map(d=><DocumentTile key={d.id} d={d} setToast={setToast}/>)}</div></>}
function ResidentFinance({state}){const pct=Math.round(state.building.yearlySpent/state.building.yearlyBudget*100);return <><div className="content-heading"><div><span className="overline">Finances</span><h1>Comprendre avant de payer.</h1><p>Une vue simple des principaux éléments financiers de la copropriété.</p></div></div><div className="finance-grid"><section className="card finance-hero"><span className="overline">Votre situation</span><div className="paid-badge"><CircleCheckBig/> À jour</div><h2>{money(state.resident.quarterlyCall)}</h2><p>Prochain appel trimestriel · échéance au 1er octobre</p></section><section className="card"><span className="overline">Fonds de réserve ACP</span><h2 className="big-money">{money(state.building.reserveFund)}</h2><p className="muted-p">Réserve disponible pour anticiper les travaux importants.</p></section><section className="card span-2"><div className="card-head"><div><span className="overline">Budget annuel</span><h3>{money(state.building.yearlySpent)} consommés sur {money(state.building.yearlyBudget)}</h3></div><strong>{pct}%</strong></div><div className="progress"><span style={{width:pct+'%'}}/></div><p className="muted-p">Donnée générale de démonstration. Les détails comptables resteraient issus du logiciel métier du syndic.</p></section></div></>}
function ResidentAgenda({events}){return <><div className="content-heading"><div><span className="overline">Agenda</span><h1>Les dates qui comptent.</h1></div></div><section className="card"><div className="agenda-list">{events.map(e=><AgendaRow key={e.id} e={e}/>)}</div></section></>}
function EmptyState({icon,title,text}){return <div className="empty-state">{icon}<h3>{title}</h3><p>{text}</p></div>}

function SyndicView({state,updateTicket,addAnnouncement,go,setToast}){
  const [section,setSection]=useState('dashboard'); const [selected,setSelected]=useState(null); const [compose,setCompose]=useState(false)
  const open=state.tickets.filter(t=>t.status!=='resolved')
  const counts={new:state.tickets.filter(t=>t.status==='new').length, waiting:state.tickets.filter(t=>t.status==='waiting').length, scheduled:state.tickets.filter(t=>t.status==='scheduled').length}
  const changeStatus=(ticket,status)=>{const nextMap={new:'À prendre en charge',in_progress:'Traitement en cours',waiting:'En attente d’un tiers',scheduled:'Intervention planifiée',resolved:'Dossier clôturé'}; updateTicket(ticket.id,{status,next:nextMap[status]}); setSelected({...ticket,status,next:nextMap[status]}); setToast('Statut mis à jour pour tous les utilisateurs')}
  return <main className="app-shell syndic-shell"><aside className="side-nav"><Logo/><div className="nav-building"><Building2/><div><strong>{state.building.name}</strong><span>{state.building.lots} lots</span></div><ChevronRight/></div><nav><NavItem icon={<LayoutDashboard/>} label="Pilotage" active={section==='dashboard'} onClick={()=>setSection('dashboard')}/><NavItem icon={<TicketCheck/>} label="Demandes" badge={open.length} active={section==='tickets'} onClick={()=>setSection('tickets')}/><NavItem icon={<MessageSquareText/>} label="Communications" active={section==='comms'} onClick={()=>setSection('comms')}/><NavItem icon={<CalendarDays/>} label="Agenda" active={section==='agenda'} onClick={()=>setSection('agenda')}/><NavItem icon={<FileText/>} label="Documents" active={section==='docs'} onClick={()=>setSection('docs')}/></nav><div className="automation-note"><Sparkles/><div><strong>Principe MVP</strong><span>Une saisie doit servir partout : app, écran et historique.</span></div></div><div className="side-bottom"><button onClick={()=>go('home')}><ArrowLeft/> Quitter la démo</button></div></aside>
    <section className="app-content"><MobileHeader title="Espace syndic" onExit={()=>go('home')}/><div className="content-wrap syndic-wrap">
      {section==='dashboard'&&<SyndicDashboard state={state} counts={counts} open={open} setSelected={setSelected} setSection={setSection} setCompose={setCompose}/>} 
      {section==='tickets'&&<SyndicTickets tickets={state.tickets} setSelected={setSelected}/>} 
      {section==='comms'&&<SyndicComms state={state} setCompose={setCompose}/>} 
      {section==='agenda'&&<ResidentAgenda events={state.events}/>} 
      {section==='docs'&&<ResidentDocuments docs={state.documents} setToast={setToast}/>} 
    </div></section>
    {selected&&<SyndicTicketDrawer ticket={state.tickets.find(t=>t.id===selected.id)||selected} onClose={()=>setSelected(null)} changeStatus={changeStatus}/>} 
    {compose&&<ComposeModal onClose={()=>setCompose(false)} onPublish={(data)=>{addAnnouncement(data);setCompose(false);setToast('Communication publiée sur l’app et l’écran')}}/>}
  </main>
}
function SyndicDashboard({state,counts,open,setSelected,setSection,setCompose}){return <><div className="content-heading"><div><span className="overline">Pilotage · {state.building.name}</span><h1>Bonjour, Thomas.</h1><p>Voici ce qui mérite votre attention aujourd’hui.</p></div><div className="heading-actions"><button className="secondary-btn" onClick={()=>setCompose(true)}><Mail/> Nouvelle communication</button><button className="primary-btn" onClick={()=>setSection('tickets')}><TicketCheck/> Traiter les demandes</button></div></div>
  <div className="manager-metrics"><ManagerMetric label="Nouvelles demandes" value={counts.new} helper="à qualifier" tone="blue"/><ManagerMetric label="En attente" value={counts.waiting} helper="d'un tiers" tone="violet"/><ManagerMetric label="Planifiées" value={counts.scheduled} helper="avec date confirmée" tone="teal"/><ManagerMetric label="Résolues ce mois" value="7" helper="dossiers clôturés" tone="green"/></div>
  <div className="manager-grid"><section className="card span-2"><div className="card-head"><div><span className="overline">À traiter</span><h3>File opérationnelle</h3></div><button className="text-btn" onClick={()=>setSection('tickets')}>Voir tout <ChevronRight/></button></div><div className="manager-ticket-list">{open.slice(0,4).map(t=><button key={t.id} onClick={()=>setSelected(t)}><div className="ticket-icon sm"><Wrench/></div><div><strong>{t.title}</strong><span>{t.id} · {t.location}</span></div><span className={'status '+statusMeta[t.status].cls}>{statusMeta[t.status].label}</span><ChevronRight/></button>)}</div></section>
    <section className="card"><div className="card-head"><div><span className="overline">Activité</span><h3>Derniers mouvements</h3></div><Activity/></div><div className="activity-feed">{state.activity.slice(0,4).map(a=><div key={a.id}><span></span><p>{a.text}<small>{new Intl.DateTimeFormat('fr-BE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(a.date))}</small></p></div>)}</div></section>
    <section className="card"><div className="card-head"><div><span className="overline">Diffusion</span><h3>Une saisie, trois canaux</h3></div><Sparkles/></div><div className="channel-list"><span><Smartphone/> App copropriétaires <Check/></span><span><Gauge/> Écran du hall <Check/></span><span><BookOpen/> Historique ACP <Check/></span></div><p className="muted-p">La plateforme doit réduire la double saisie, pas ajouter un logiciel métier supplémentaire.</p></section>
  </div></>}
function ManagerMetric({label,value,helper,tone}){return <article className={'manager-metric '+tone}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>}
function SyndicTickets({tickets,setSelected}){const [filter,setFilter]=useState('all'); const [query,setQuery]=useState(''); const visible=tickets.filter(t=>(filter==='all'||t.status===filter)&&(`${t.id} ${t.title} ${t.location}`.toLowerCase().includes(query.toLowerCase())));return <><div className="content-heading"><div><span className="overline">Demandes</span><h1>Une file claire, sans e-mails dispersés.</h1></div></div><div className="toolbar"><div className="search-box"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher un ticket…"/></div><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Tous les statuts</option><option value="new">Nouveau</option><option value="in_progress">En cours</option><option value="waiting">En attente</option><option value="scheduled">Planifié</option><option value="resolved">Résolu</option></select></div><section className="card table-card"><div className="ticket-table"><div className="ticket-row head"><span>Demande</span><span>Lieu</span><span>Statut</span><span>Suite</span><span></span></div>{visible.map(t=><button className="ticket-row" key={t.id} onClick={()=>setSelected(t)}><span><strong>{t.title}</strong><small>{t.id} · {longDate(t.created)}</small></span><span>{t.location}</span><span><i className={'status '+statusMeta[t.status].cls}>{statusMeta[t.status].label}</i></span><span>{t.next}</span><ChevronRight/></button>)}</div></section></>}
function SyndicComms({state,setCompose}){return <><div className="content-heading"><div><span className="overline">Communications</span><h1>Informer une fois, partout.</h1><p>Chaque publication alimente automatiquement l’application et l’écran public si elle est marquée publique.</p></div><button className="primary-btn" onClick={()=>setCompose(true)}><Plus/> Nouvelle communication</button></div><div className="communication-list">{state.announcements.map(a=><article className="card" key={a.id}><div className="card-head"><div><span className="overline">Publié le {longDate(a.date)}</span><h3>{a.title}</h3></div><span className="status status-green">Publié</span></div><p className="muted-p">{a.body}</p><div className="distribution"><span><Smartphone/> App</span><span><Gauge/> Écran</span><span><BookOpen/> Historique</span></div></article>)}</div></>}
function SyndicTicketDrawer({ticket,onClose,changeStatus}){return <div className="modal-backdrop drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><aside className="drawer"><div className="drawer-head"><div><span className="overline">{ticket.id}</span><h2>{ticket.title}</h2></div><button className="icon-btn" onClick={onClose}><X/></button></div><div className="drawer-section"><span className={'status '+statusMeta[ticket.status].cls}>{statusMeta[ticket.status].label}</span><p>{ticket.description}</p><div className="info-pairs"><span><small>Lieu</small><strong>{ticket.location}</strong></span><span><small>Signalé par</small><strong>{ticket.reporter}</strong></span><span><small>Créé le</small><strong>{longDate(ticket.created)}</strong></span><span><small>Visibilité</small><strong>{ticket.public?'Publique':'Privée'}</strong></span></div></div><div className="drawer-section"><span className="overline">Mettre à jour</span><div className="status-actions">{Object.entries(statusMeta).map(([key,m])=><button key={key} className={ticket.status===key?'selected':''} onClick={()=>changeStatus(ticket,key)}><span className={'status-dot '+m.cls}></span>{m.label}{ticket.status===key&&<Check/>}</button>)}</div></div><div className="drawer-section"><span className="overline">Historique</span><div className="mini-timeline">{ticket.timeline.map((x,i)=><div key={i}><span></span><p><strong>{x.label}</strong><small>{x.date}</small></p></div>)}</div></div><div className="drawer-foot"><p><Info/> Toute modification de statut est immédiatement visible dans les interfaces concernées.</p></div></aside></div>}
function ComposeModal({onClose,onPublish}){const [title,setTitle]=useState('');const[body,setBody]=useState('');return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><form className="modal-card compose" onSubmit={e=>{e.preventDefault();if(title.trim()&&body.trim())onPublish({title:title.trim(),body:body.trim()})}}><div className="modal-head"><div><span className="overline">Communication</span><h2>Publier une information</h2></div><button type="button" className="icon-btn" onClick={onClose}><X/></button></div><label>Titre<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex. Coupure d’eau programmée" required maxLength={80}/></label><label>Message<textarea value={body} onChange={e=>setBody(e.target.value)} rows={5} placeholder="Information utile aux occupants…" required maxLength={500}/></label><div className="publish-preview"><Check/><span>Publication prévue sur <strong>l’app, l’écran du hall et l’historique ACP</strong>.</span></div><div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Annuler</button><button className="primary-btn"><Mail/> Publier</button></div></form></div>}

function ReportModal({onClose,addTicket,setToast,publicSource=false}){const[step,setStep]=useState(1),[category,setCategory]=useState('Éclairage'),[location,setLocation]=useState(''),[description,setDescription]=useState(''),[result,setResult]=useState('');const cats=[['Éclairage','💡'],['Ascenseur','🛗'],['Garage','🚗'],['Eau / fuite','💧'],['Nettoyage','🧹'],['Autre','•••']];const submit=()=>{if(!location.trim()||!description.trim())return;const id=addTicket({title:category,category,location:location.trim(),description:description.trim(),reporter:publicSource?'Écran du hall':'S. Lambert',public:true});setResult(id);setStep(3);setToast('Signalement transmis')};return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal-card report-modal"><div className="modal-head"><div><span className="overline">Signalement rapide</span><h2>{step===3?'Merci, c’est transmis.':'Que se passe-t-il ?'}</h2></div><button className="icon-btn" onClick={onClose}><X/></button></div>{step===1&&<><div className="category-grid">{cats.map(([c,ico])=><button key={c} className={category===c?'selected':''} onClick={()=>setCategory(c)}><span>{ico}</span><strong>{c}</strong></button>)}</div><button className="primary-btn full-btn" onClick={()=>setStep(2)}>Continuer <ChevronRight/></button></>}{step===2&&<><div className="selected-category"><span>{cats.find(x=>x[0]===category)?.[1]}</span><strong>{category}</strong><button onClick={()=>setStep(1)}>Modifier</button></div><label>Où ?<input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Ex. Hall d’entrée, niveau -1…" maxLength={80}/></label><label>Décrivez brièvement le problème<textarea rows={4} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Quelques mots suffisent pour permettre la prise en charge…" maxLength={250}/></label><button className="primary-btn full-btn" disabled={!location.trim()||!description.trim()} onClick={submit}>Envoyer le signalement</button></>}{step===3&&<div className="success-panel"><div className="success-icon"><Check/></div><h3>Référence {result}</h3><p>Le signalement est maintenant visible dans la file du gestionnaire. Son statut pourra être suivi sans nouvelle relance.</p><button className="primary-btn full-btn" onClick={onClose}>Terminer</button></div>}</div></div>}
function TicketModal({ticket,onClose}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal-card"><div className="modal-head"><div><span className="overline">{ticket.id}</span><h2>{ticket.title}</h2></div><button className="icon-btn" onClick={onClose}><X/></button></div><span className={'status '+statusMeta[ticket.status].cls}>{statusMeta[ticket.status].label}</span><p className="modal-description">{ticket.description}</p><div className="ticket-next big"><Clock3/><span>{ticket.next}</span></div><div className="mini-timeline">{ticket.timeline.map((x,i)=><div key={i}><span></span><p><strong>{x.label}</strong><small>{x.date}</small></p></div>)}</div></div></div>}

createRoot(document.getElementById('root')).render(<App />)

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(()=>{})
}
