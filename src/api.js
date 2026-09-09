const TERMINAL_TOKEN_KEY = 'coprolink-terminal-token'

/**
 * Jeton de terminal.
 *
 * Il est conservé dans le localStorage de la tablette uniquement, jamais dans un
 * cookie : il ne doit accompagner que les appels du mode écran, et jamais une
 * requête faite depuis une session copropriétaire ou syndic.
 */
export const terminalToken = {
  read: () => {
    try { return localStorage.getItem(TERMINAL_TOKEN_KEY) } catch { return null }
  },
  save: token => {
    try { localStorage.setItem(TERMINAL_TOKEN_KEY, token) } catch { /* stockage indisponible */ }
  },
  clear: () => {
    try { localStorage.removeItem(TERMINAL_TOKEN_KEY) } catch { /* stockage indisponible */ }
  },
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/**
 * `terminal: true` ajoute l'en-tête de jeton de terminal. Les appels des espaces
 * authentifiés s'appuient sur le cookie `nf_jwt` posé par Netlify Identity.
 */
async function request(path, { method = 'GET', body, terminal = false, extraHeaders } = {}) {
  const headers = { ...extraHeaders }
  if (body !== undefined) headers['content-type'] = 'application/json'

  if (terminal) {
    const token = terminalToken.read()
    if (!token) throw new ApiError(401, 'Aucun jeton de terminal enregistré sur cet appareil')
    headers['x-terminal-token'] = token
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return null

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error || `Erreur ${response.status}`)
  }
  return payload
}

const buildingQuery = slug => (slug ? `?building=${encodeURIComponent(slug)}` : '')

export const api = {
  session: () => request('/api/session'),
  terminalSession: () => request('/api/session', { terminal: true }),

  workspace: slug => request(`/api/workspace${buildingQuery(slug)}`),
  display: () => request('/api/display', { terminal: true }),

  createTicket: (slug, data) =>
    request(`/api/tickets${buildingQuery(slug)}`, { method: 'POST', body: data }),
  reportFromTerminal: data =>
    request('/api/tickets', { method: 'POST', body: data, terminal: true }),
  updateTicketStatus: (slug, reference, status, note = '') =>
    request(`/api/tickets/${encodeURIComponent(reference)}${buildingQuery(slug)}`, {
      method: 'PATCH',
      body: { status, note },
    }),

  publishAnnouncement: (slug, data) =>
    request(`/api/announcements${buildingQuery(slug)}`, { method: 'POST', body: data }),
  createEvent: (slug, data) =>
    request(`/api/events${buildingQuery(slug)}`, { method: 'POST', body: data }),

  listTerminals: slug => request(`/api/terminals${buildingQuery(slug)}`),
  createTerminal: (slug, data) =>
    request(`/api/terminals${buildingQuery(slug)}`, { method: 'POST', body: data }),
  setTerminalReporting: (slug, id, canReport) =>
    request(`/api/terminals/${id}${buildingQuery(slug)}`, { method: 'PATCH', body: { canReport } }),
  revokeTerminal: (slug, id) =>
    request(`/api/terminals/${id}${buildingQuery(slug)}`, { method: 'DELETE' }),

  listMembers: slug => request(`/api/members${buildingQuery(slug)}`),
  addMember: (slug, data) =>
    request(`/api/members${buildingQuery(slug)}`, { method: 'POST', body: data }),
  updateMember: (slug, id, data) =>
    request(`/api/members/${id}${buildingQuery(slug)}`, { method: 'PATCH', body: data }),
  removeMember: (slug, id) =>
    request(`/api/members/${id}${buildingQuery(slug)}`, { method: 'DELETE' }),

  setupBuilding: ({ setupToken, ...data }) =>
    request('/api/setup', {
      method: 'POST',
      body: data,
      extraHeaders: setupToken ? { 'x-setup-token': setupToken } : undefined,
    }),
}
