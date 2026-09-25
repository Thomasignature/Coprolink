import { ApiError } from './api.js'

const request = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, payload?.error || `Erreur ${response.status}`)
  return payload
}

const q = slug => `?building=${encodeURIComponent(slug)}`

export const apiV3 = {
  model: slug => request(`/api/building-model${q(slug)}`),
  create: (slug, entity, data) => request(`/api/building-model${q(slug)}`, { method: 'POST', body: { entity, ...data } }),
  update: (slug, entity, id, data) => request(`/api/building-model${q(slug)}`, { method: 'PATCH', body: { entity, id, ...data } }),
  remove: (slug, entity, id) => request(`/api/building-model${q(slug)}`, { method: 'DELETE', body: { entity, id } }),
  accessStates: slug => request(`/api/person-access${q(slug)}`),
  invitePerson: (slug, personId) => request(`/api/person-access${q(slug)}`, { method: 'POST', body: { personId } }),
  inboundEmails: slug => request(`/api/inbound-email${q(slug)}`),
  executeInboundAction: (slug, data) => request(`/api/inbound-email${q(slug)}`, { method: 'PATCH', body: data }),
}
