/** Valide une date civile de fin et la normalise à la fin de la journée UTC. */
export function parseMembershipEndDate(value: unknown, now = new Date()): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('La date de fin est invalide')
  }
  const endedAt = new Date(`${value}T23:59:59.999Z`)
  if (Number.isNaN(endedAt.getTime()) || endedAt.toISOString().slice(0, 10) !== value) {
    throw new Error('La date de fin est invalide')
  }
  if (endedAt > new Date(`${now.toISOString().slice(0, 10)}T23:59:59.999Z`)) {
    throw new Error('La date de fin ne peut pas être future')
  }
  return endedAt
}
