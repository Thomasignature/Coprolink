import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { handleAuthCallback, logout, onAuthChange } from '@netlify/identity'
import { api, ApiError, terminalToken } from './api.js'
import { LoginView, NoAccessView, SetupView, TerminalEnrollView } from './auth-views.jsx'
import { DisplayView, ErrorPanel, Spinner, SyndicView } from './views.jsx'
import ManagerPortfolioView from './manager-portfolio.jsx'
import ResidentV2View from './resident-v2.jsx'

/* ------------------------------------------------------------------ *
 * Routage par hash.
 * ------------------------------------------------------------------ */

const readRoute = () => {
  const raw = location.hash.replace(/^#/, '')
  const [path, query] = raw.split('?')
  return {
    path: path.replace(/^\/+|\/+$/g, '') || '',
    params: new URLSearchParams(query || ''),
  }
}

const go = path => { location.hash = path }

const useRoute = () => {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => setRoute(readRoute())
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/** Espace naturel d'un membre selon son rôle sur l'immeuble. */
const homeFor = role => (role === 'manager' || role === 'platform_admin' ? '/portfolio' : '/resident')

function Toast({ message }) {
  if (!message) return null
  return <div className="toast" role="status" aria-live="polite">{message}</div>
}

const useToast = () => {
  const [message, setMessage] = useState('')
  const timer = useRef(null)
  const setToast = useCallback(text => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), 3600)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return [message, setToast]
}

/* ------------------------------------------------------------------ *
 * Application.
 * ------------------------------------------------------------------ */

export default function App() {
  const route = useRoute()
  const [toast, setToast] = useToast()

  const [authCallback, setAuthCallback] = useState({ done: false, mode: null, inviteToken: null })
  const [session, setSession] = useState({ status: 'loading', data: null, error: null })

  const loadSession = useCallback(async () => {
    try {
      const data = await api.session()
      setSession({ status: 'ready', data, error: null })
      return data.authenticated === true && data.kind === 'user'
    } catch (error) {
      setSession({ status: 'error', data: null, error: error.message })
      return false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let mode = null
      let inviteToken = null
      try {
        const result = await handleAuthCallback()
        if (result?.type === 'recovery') mode = 'reset'
        if (result?.type === 'invite') { mode = 'invite'; inviteToken = result.token ?? null }
      } catch (error) {
        if (!cancelled) setToast(error?.message || 'Ce lien d\'authentification est invalide ou expiré.')
      }
      if (cancelled) return
      setAuthCallback({ done: true, mode, inviteToken })
      await loadSession()
    })()
    return () => { cancelled = true }
  }, [loadSession, setToast])

  useEffect(() => onAuthChange(event => {
    if (event === 'logout' || event === 'login') loadSession()
  }), [loadSession])

  const onLogout = useCallback(async () => {
    try { await logout() } catch { /* session locale purgée quand même */ }
    setSession({ status: 'ready', data: { authenticated: false }, error: null })
    go('/')
  }, [])

  if (route.path === 'display') {
    return (
      <>
        <TerminalRoute route={route} setToast={setToast} />
        <Toast message={toast} />
      </>
    )
  }

  if (!authCallback.done || session.status === 'loading') return <Spinner label="Chargement de votre espace…" />

  if (session.status === 'error') {
    return <ErrorPanel title="Service indisponible" message={session.error} onRetry={loadSession} />
  }

  const data = session.data
  const pendingAuthFlow = authCallback.mode !== null

  if (pendingAuthFlow || !data.authenticated || data.kind !== 'user') {
    return (
      <>
        <LoginView
          mode={authCallback.mode ?? (route.path === 'signup' ? 'signup' : 'login')}
          inviteToken={authCallback.inviteToken}
          onAuthenticated={async () => {
            const ok = await loadSession()
            if (ok) setAuthCallback(c => ({ ...c, mode: null, inviteToken: null }))
            return ok
          }}
        />
        <Toast message={toast} />
      </>
    )
  }

  if (data.needsSetup) {
    return (
      <>
        {data.canBootstrap
          ? (
            <SetupView
              email={data.user.email}
              onLogout={onLogout}
              onCreated={async payload => {
                const created = await api.setupBuilding(payload)
                await loadSession()
                setToast(`${created.buildingName} est prêt`)
                go(homeFor(created.role))
              }}
            />
          )
          : <NoAccessView email={data.user.email} onLogout={onLogout} onRetry={loadSession} />}
        <Toast message={toast} />
      </>
    )
  }

  const managesBuildings = data.user.isPlatformAdmin || data.memberships.some(m => m.role === 'manager')
  const isBuildingReferent = data.memberships.some(m => m.isReferent === true)
  const wantsPortfolio = managesBuildings && (route.path === '' || route.path === 'portfolio')

  if (!managesBuildings && isBuildingReferent && (route.path === '' || route.path === 'portfolio')) {
    const referentBuilding = data.memberships.find(m => m.isReferent === true)
    if (referentBuilding) location.hash = `/portfolio?view=building&building=${encodeURIComponent(referentBuilding.buildingSlug)}`
    return <Spinner label="Ouverture de la gouvernance de l’immeuble…" />
  }

  if (wantsPortfolio) {
    return (
      <>
        <ManagerPortfolioView session={data} onLogout={onLogout} setToast={setToast} />
        <Toast message={toast} />
      </>
    )
  }

  return (
    <>
      <MemberRoutes route={route} session={data} onLogout={onLogout} setToast={setToast} />
      <Toast message={toast} />
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Espaces authentifiés par immeuble.
 * ------------------------------------------------------------------ */

function MemberRoutes({ route, session, onLogout, setToast }) {
  const memberships = session.memberships
  const requested = route.params.get('building')
  const membership = useMemo(
    () => memberships.find(m => m.buildingSlug === requested) ?? memberships[0],
    [memberships, requested],
  )
  const slug = membership.buildingSlug

  const [workspace, setWorkspace] = useState({ status: 'loading', data: null, error: null })

  const load = useCallback(async () => {
    setWorkspace(w => ({ ...w, status: w.data ? 'refreshing' : 'loading' }))
    try {
      const data = await api.workspace(slug)
      setWorkspace({ status: 'ready', data, error: null })
    } catch (error) {
      setWorkspace({ status: 'error', data: null, error: error.message })
    }
  }, [slug])

  useEffect(() => { load() }, [load])

  const actions = useMemo(() => ({
    createTicket: async payload => {
      const ticket = await api.createTicket(slug, payload)
      await load()
      return ticket
    },
    updateTicketStatus: async (reference, status) => {
      const ticket = await api.updateTicketStatus(slug, reference, status)
      await load()
      return ticket
    },
    publishAnnouncement: async payload => { await api.publishAnnouncement(slug, payload); await load() },
    createEvent: async payload => { await api.createEvent(slug, payload); await load() },
    listTerminals: () => api.listTerminals(slug),
    createTerminal: payload => api.createTerminal(slug, payload),
    setTerminalReporting: (id, canReport) => api.setTerminalReporting(slug, id, canReport),
    revokeTerminal: id => api.revokeTerminal(slug, id),
    listMembers: () => api.listMembers(slug),
    inviteMember: payload => api.inviteMember(slug, payload),
    resendMemberInvite: id => api.resendMemberInvite(slug, id),
    retryPendingInvite: pendingId => api.retryPendingInvite(slug, pendingId),
    cancelPendingInvite: pendingId => api.cancelPendingInvite(slug, pendingId),
    updateMember: (id, payload) => api.updateMember(slug, id, payload),
    removeMember: id => api.removeMember(slug, id),
  }), [slug, load])

  if (workspace.status === 'loading') return <Spinner label="Chargement de l'immeuble…" />
  if (workspace.status === 'error') return <ErrorPanel title="Immeuble inaccessible" message={workspace.error} onRetry={load} />

  const workspaceData = workspace.data
  const isManager = workspaceData.capabilities.includes('tickets:update')
  const wants = route.path === 'syndic' || (route.path !== 'resident' && isManager) ? 'syndic' : 'resident'

  if (wants === 'syndic' && !isManager) {
    return (
      <ErrorPanel
        title="Espace réservé au gestionnaire"
        message="Votre rôle sur cet immeuble ne permet pas d'accéder à l'espace syndic."
        retryLabel="Aller à mon espace"
        onRetry={() => go('/resident')}
      />
    )
  }

  if (wants === 'syndic') {
    return (
      <SyndicView
        data={workspaceData} session={session} actions={actions}
        onLogout={onLogout} setToast={setToast}
      />
    )
  }

  return (
    <ResidentV2View
      data={workspaceData} session={session} setToast={setToast} onLogout={onLogout}
      onReport={actions.createTicket}
    />
  )
}

/* ------------------------------------------------------------------ *
 * Écran des communs.
 * ------------------------------------------------------------------ */

function TerminalRoute({ route, setToast }) {
  const urlToken = route.params.get('token')
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  useEffect(() => {
    if (urlToken) {
      terminalToken.save(urlToken)
      history.replaceState(null, '', `${location.pathname}#/display`)
    }
  }, [urlToken])

  const load = useCallback(async () => {
    if (!terminalToken.read()) {
      setState({ status: 'enroll', data: null, error: null })
      return
    }
    try {
      const data = await api.display()
      setState({ status: 'ready', data, error: null })
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        terminalToken.clear()
        setState({ status: 'enroll', data: null, error: error.message })
        return
      }
      setState({ status: 'error', data: null, error: error.message })
    }
  }, [])

  useEffect(() => { load() }, [load, urlToken])

  if (state.status === 'loading') return <Spinner label="Connexion de l'écran…" />

  if (state.status === 'enroll') {
    return (
      <TerminalEnrollView
        error={state.error}
        onSubmit={token => {
          terminalToken.save(token)
          setState({ status: 'loading', data: null, error: null })
          load()
        }}
      />
    )
  }

  if (state.status === 'error') return <ErrorPanel title="Écran hors ligne" message={state.error} onRetry={load} />

  return (
    <DisplayView
      data={state.data}
      onRefresh={load}
      setToast={setToast}
      onReport={async payload => {
        const ticket = await api.reportFromTerminal(payload)
        await load()
        return ticket
      }}
    />
  )
}
