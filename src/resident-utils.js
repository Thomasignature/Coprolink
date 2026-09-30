const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export const localDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = type => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export const splitEvents = (events, now = new Date()) => {
  const today = localDateKey(now)
  const valid = (Array.isArray(events) ? events : []).filter(event => DATE_ONLY.test(event?.eventDate || ''))
  return {
    future: valid.filter(event => event.eventDate >= today).sort((a, b) => a.eventDate.localeCompare(b.eventDate)),
    past: valid.filter(event => event.eventDate < today).sort((a, b) => b.eventDate.localeCompare(a.eventDate)),
  }
}

export const validateReport = input => {
  const errors = {}
  const required = [['category', 'La catégorie'], ['location', 'L’emplacement'], ['description', 'La description']]
  for (const [field, label] of required) if (!String(input[field] || '').trim()) errors[field] = `${label} est obligatoire.`
  if (String(input.title || '').trim().length > 120) errors.title = 'Le titre ne peut pas dépasser 120 caractères.'
  if (String(input.location || '').trim().length > 120) errors.location = 'L’emplacement ne peut pas dépasser 120 caractères.'
  if (String(input.description || '').trim().length > 1000) errors.description = 'La description ne peut pas dépasser 1 000 caractères.'
  return errors
}
