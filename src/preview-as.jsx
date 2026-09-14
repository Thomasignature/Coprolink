import React, { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { ErrorPanel, Spinner, SyndicView } from './views.jsx'
import ResidentV2View from './resident-v2.jsx'
import './preview-mode.css'

const LABELS = {
  owner: 'Copropriétaire',
  tenant: 'Locataire / occupant',
  syndic: 'Syndic',
}

const readOnlyError = () => Promise.reject(new Error('Mode prévisualisation : aucune donnée réelle n’a été modifiée.'))

const makeReadOnlyActions = () => ({
  createTicket: readOnlyError,
  updateTicketStatus: readOnlyError,
  publishAnnouncement: readOnlyError,
  createEvent: readOnlyError,
  listTerminals: async () => [],
  createTerminal: readOnlyError,
  setTerminalReporting: readOnlyError,
  revokeTerminal: readOnlyError,
  listMembers: async () => ({ members: [], pendingMembers: [], assignableRoles: [] }),
  inviteMember: readOnlyError,
  resendMemberInvite: readOnlyError,
  retryPendingInvite: readOnlyError,
  cancelPendingInvite: readOnlyError,
  updateMember: readOnlyError,
  removeMember: readOnlyError,
})

const publicTicket = ticket => ({
  reference: ticket.reference,
  title: ticket.title,
  category: ticket.category,
  location: ticket.location,
  status: ticket.status,
  nextStep: ticket.nextStep,
  createdAt: ticket.createdAt,
  timeline: Array.isArray(ticket.timeline)
    ? ticket.timeline.map(step => ({ label: step.label, date: step.date }))
    : [],
})

const residentTickets = workspace => (workspace.buildingTickets || [])
  .filter(ticket => ticket.isPublic !== false)
  .map(publicTicket)

const filterFor = (workspace, role) => {
  if (role === 'syndic') return workspace

  const base = {
    ...workspace,
    member: null,
    myTickets: [],
    buildingTickets: residentTickets(workspace),
    capabilities: [],
    activity: [],
  }

  if (role === 'tenant') {
    return {
      ...base,
      documents: (workspace.documents || []).filter(item => item.access === 'public'),
      announcements: (workspace.announcements || []).filter(item => item.isPublic !== false),
      events: (workspace.events || []).filter(item => item.isPublic !== false),
    }
  }

  return base
}

export default function PreviewAsView({ session, buildingSlug, initialRole = 'owner', onLogout, setToast }) {
  const [role, setRole] = useState(['owner', 'tenant', 'syndic'].includes(initialRole) ? initialRole : 'owner')
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  const load = async () => {
    setState(current => ({ ...current, status: current.data ? 'refreshing' : 'loading', error: null }))
    try {
      const data = await api.workspace(buildingSlug)
      setState({ status: 'ready', data, error: null })
    } catch (error) {
      setState({ status: 'error', data: null, error: error.message })
    }
  }

  useEffect(() => { load() }, [buildingSlug])

  const previewData = useMemo(() => state.data ? filterFor(state.data, role) : null, [state.data, role])
  const safeActions = useMemo(() => makeReadOnlyActions(), [])
  const previewSession = useMemo(() => ({ ...session, previewRole: role }), [session, role])

  if (!buildingSlug) return <ErrorPanel title="Aucun immeuble" message="Choisissez d’abord un immeuble à prévisualiser." />
  if (state.status === 'loading') return <Spinner label="Préparation de la prévisualisation…" />
  if (state.status === 'error') return <ErrorPanel title="Prévisualisation indisponible" message={state.error} onRetry={load} />

  const exit = () => { location.hash = `/portfolio?view=building&building=${encodeURIComponent(buildingSlug)}` }
  const changeRole = event => {
    const next = event.target.value
    setRole(next)
    location.hash = `/portfolio?view=preview&building=${encodeURIComponent(buildingSlug)}&as=${encodeURIComponent(next)}`
  }

  return (
    <div>
      <div className="preview-toolbar" role="status">
        <strong>Prévisualisation : {LABELS[role]}</strong>
        <span>Simulation en lecture seule · données filtrées selon le profil</span>
        <select aria-label="Prévisualiser comme" value={role} onChange={changeRole}>
          <option value="owner">Copropriétaire</option>
          <option value="tenant">Locataire / occupant</option>
          <option value="syndic">Syndic</option>
        </select>
        <button type="button" onClick={exit}>Quitter l’aperçu</button>
      </div>

      {role === 'syndic' ? (
        <SyndicView
          data={previewData}
          session={previewSession}
          actions={safeActions}
          onLogout={onLogout}
          setToast={setToast}
        />
      ) : (
        <ResidentV2View
          data={previewData}
          session={previewSession}
          setToast={setToast}
          onLogout={onLogout}
          onReport={readOnlyError}
          previewRole={role}
          readOnly
        />
      )}
    </div>
  )
}
