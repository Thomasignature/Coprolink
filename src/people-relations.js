export const END_REASONS = {
  sale: 'Vente', lease_end: 'Fin de bail', move: 'Déménagement',
  inheritance: 'Succession', other: 'Autre',
}

export const relationTypeLabel = type => ({ owner: 'Copropriétaire', occupant: 'Occupant', tenant: 'Locataire' }[type] || type)

// Keep each historical period separate, even when a person still has an active role.
export function directoryRows(units, people, relations, filter = 'current', query = '') {
  const unitById = new Map(units.map(unit => [unit.id, unit]))
  const personById = new Map(people.map(person => [person.id, person]))
  const grouped = new Map()
  for (const relation of relations) {
    const historical = Boolean(relation.endDate)
    if (filter === 'current' && historical || filter === 'former' && !historical) continue
    const person = personById.get(relation.personId)
    if (!person) continue
    const period = historical ? JSON.stringify([relation.startDate, relation.endDate, relation.endReason]) : 'current'
    const key = `${relation.unitId}:${person.id}:${period}`
    if (!grouped.has(key)) grouped.set(key, { key, unit: unitById.get(relation.unitId), person, historical, relations: [] })
    grouped.get(key).relations.push(relation)
  }
  if (filter !== 'former') {
    const linked = new Set(relations.map(relation => relation.personId))
    for (const person of people.filter(item => !linked.has(item.id))) {
      grouped.set(`unlinked:${person.id}`, { key: `unlinked:${person.id}`, unit: null, person, historical: false, relations: [] })
    }
  }
  const needle = query.trim().toLocaleLowerCase('fr-BE')
  return [...grouped.values()].filter(row => {
    const haystack = [row.person.fullName, row.person.email, row.unit?.label, row.unit?.floor,
      ...row.relations.flatMap(rel => [relationTypeLabel(rel.relationType), END_REASONS[rel.endReason], rel.startDate, rel.endDate]),
    ].join(' ').toLocaleLowerCase('fr-BE')
    return !needle || haystack.includes(needle)
  })
}

export function validateRelationEnd(relations, selectedIds, endDate, endReason, today) {
  const selected = relations.filter(rel => selectedIds.includes(rel.id) && !rel.endDate)
  if (!selected.length) return 'Sélectionnez au moins une relation active.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(Date.parse(`${endDate}T00:00:00Z`)) || new Date(`${endDate}T00:00:00Z`).toISOString().slice(0, 10) !== endDate) return 'Indiquez une date de fin valide.'
  if (endDate > today) return 'La clôture prend effet immédiatement : choisissez aujourd’hui ou une date passée.'
  if (selected.some(rel => rel.startDate && endDate < rel.startDate.slice(0, 10))) return 'La date de fin ne peut pas précéder le début d’une relation sélectionnée.'
  if (!Object.hasOwn(END_REASONS, endReason)) return 'Sélectionnez un motif.'
  return ''
}
