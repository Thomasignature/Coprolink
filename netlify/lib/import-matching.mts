export const normalizeImportName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');

/** Candidates must already be scoped to the same building and active unit. */
export function matchImportPerson<T extends { id: number; fullName: string; email: string }>(candidates: T[], name: string): T | null {
  const matches = [...new Map(candidates.filter(person => !person.email.trim() &&
    normalizeImportName(person.fullName) === normalizeImportName(name)).map(person => [person.id, person])).values()];
  if (matches.length > 1) throw new Error('Plusieurs personnes sans e-mail portent ce nom dans ce lot. Vérifiez les doublons avant de réimporter.');
  return matches[0] ?? null;
}
