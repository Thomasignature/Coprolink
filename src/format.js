export const money = n =>
  new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(Number(n) || 0)

/** Accepte aussi bien "2026-09-08" (colonnes date) qu'un horodatage ISO complet. */
const toDate = value => {
  if (!value) return null
  const date = new Date(typeof value === 'string' && value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? null : date
}

const format = (value, options) => {
  const date = toDate(value)
  return date ? new Intl.DateTimeFormat('fr-BE', options).format(date) : '—'
}

export const longDate = value => format(value, { day: 'numeric', month: 'long', year: 'numeric' })
export const shortDate = value =>
  format(value, { day: '2-digit', month: 'short' }).replace('.', '')
export const dayAndTime = value =>
  format(value, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
export const timelineDate = value => format(value, { day: '2-digit', month: '2-digit' })
export const dayNumber = value => toDate(value)?.getDate() ?? '—'
export const monthShort = value => format(value, { month: 'short' }).replace('.', '')

export const statusMeta = {
  new: { label: 'Nouveau', cls: 'status-blue' },
  in_progress: { label: 'En cours', cls: 'status-amber' },
  waiting: { label: 'En attente', cls: 'status-violet' },
  scheduled: { label: 'Planifié', cls: 'status-teal' },
  resolved: { label: 'Résolu', cls: 'status-green' },
}

export const metaFor = status => statusMeta[status] ?? { label: status ?? '—', cls: 'status-blue' }

export const ROLE_LABELS = {
  resident: 'Copropriétaire',
  council_member: 'Conseil de copropriété',
  manager: 'Syndic / gestionnaire',
  platform_admin: 'Administrateur plateforme',
}

export const roleLabel = role => ROLE_LABELS[role] ?? role ?? '—'
