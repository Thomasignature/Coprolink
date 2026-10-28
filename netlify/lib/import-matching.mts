export const normalizeImportName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');

/**
 * Candidates must already be scoped to the same building and active unit.
 * A row is matched by name on its lot so that re-importing a file with or
 * without e-mails never duplicates people; several homonyms are reported.
 */
export function matchImportPerson<T extends { id: number; fullName: string; email: string }>(
  candidates: T[], name: string, { withoutEmailOnly = false } = {},
): T | null {
  const matches = [...new Map(candidates.filter(person => (!withoutEmailOnly || !person.email.trim()) &&
    normalizeImportName(person.fullName) === normalizeImportName(name)).map(person => [person.id, person])).values()];
  if (matches.length > 1) throw new Error('Plusieurs personnes portent ce nom dans ce lot. Vérifiez les doublons avant de réimporter.');
  return matches[0] ?? null;
}

/** One address is one person: a different name on a known address is ambiguous. */
export function assertSameImportPerson(person: { fullName: string }, name: string) {
  if (normalizeImportName(person.fullName) !== normalizeImportName(name)) {
    throw new Error(`Cette adresse e-mail appartient déjà à ${person.fullName}. Chaque personne doit avoir sa propre adresse ; ligne laissée de côté.`);
  }
}
