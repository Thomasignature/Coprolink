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
  correctPersonEmail: (slug, person, email) => request(`/api/person-access${q(slug)}`, {
    method: 'PATCH', body: { personId: person.id, email, previousEmail: person.email || '' },
  }),
  bulkImport: (slug, rows) => request(`/api/onboarding-import${q(slug)}`, { method: 'POST', body: { rows } }),
  inboundEmails: slug => request(`/api/inbound-email${q(slug)}`),
  executeInboundAction: (slug, data) => request(`/api/inbound-email${q(slug)}`, { method: 'PATCH', body: data }),
}

export const correctAndReinvitePerson = async (slug, person, email) => {
  const correction = await apiV3.correctPersonEmail(slug, person, email)
  if (!correction.reinvite) return correction
  try {
    return await apiV3.invitePerson(slug, person.id)
  } catch (error) {
    const failure = new ApiError(error.status || 500,
      `Adresse corrigée et ancien accès retiré. La nouvelle invitation a échoué : ${error.message}. Réessayez avec « Inviter sur CoproLink ».`)
    failure.emailCorrected = true
    throw failure
  }
}
