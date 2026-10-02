const roles = {
  'copropriétaire': 'owner', 'proprietaire': 'owner', 'propriétaire': 'owner', owner: 'owner',
  'copropriétaire occupant': 'owner_occupant', 'propriétaire occupant': 'owner_occupant',
  'copropriétaire + occupant': 'owner_occupant', 'owner occupant': 'owner_occupant', owner_occupant: 'owner_occupant',
  locataire: 'tenant', tenant: 'tenant', occupant: 'occupant',
}

export function parseCsv(text) {
  const input = String(text || '').replace(/^\uFEFF/, '')
  // Choose the delimiter from the first record, ignoring quoted separators.
  let quoted = false, semicolons = 0, commas = 0
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '"') {
      if (quoted && input[i + 1] === '"') i++
      else quoted = !quoted
    } else if (!quoted) {
      if (input[i] === '\n' || input[i] === '\r') break
      if (input[i] === ';') semicolons++
      if (input[i] === ',') commas++
    }
  }
  const delimiter = semicolons >= commas ? ';' : ','
  const records = []
  let cells = [], cell = '', inQuotes = false, closed = false, line = 1, sourceRow = 1
  const finishCell = () => { cells.push(cell.trim()); cell = ''; closed = false }
  const finishRecord = () => {
    finishCell()
    if (cells.some(Boolean)) records.push({ cells, sourceRow })
    cells = []
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++ }
        else { inQuotes = false; closed = true }
      } else { cell += char; if (char === '\n') line++ }
    } else if (char === delimiter) finishCell()
    else if (char === '\n' || char === '\r') {
      finishRecord()
      if (char === '\r' && input[i + 1] === '\n') i++
      line++; sourceRow = line
    } else if (char === '"') {
      if (cell.trim() || closed) throw new Error(`Ligne ${line} : guillemet inattendu.`)
      cell = ''; inQuotes = true
    } else {
      if (closed && char.trim()) throw new Error(`Ligne ${line} : caractère après un champ entre guillemets.`)
      cell += char
    }
  }
  if (inQuotes) throw new Error(`Ligne ${sourceRow} : guillemet non fermé.`)
  if (cell || cells.length) finishRecord()
  if (!records.length) return []
  const hasHeader = /^(lot|unit)$/i.test(records[0].cells[0])
  const rows = records.slice(hasHeader ? 1 : 0)
  if (rows.length > 500) throw new Error('Import limité à 500 lignes. Séparez votre fichier en plusieurs imports.')
  return rows.map(({ cells, sourceRow }) => {
    if (cells.length < 5 || cells.length > 6) throw new Error(`Ligne ${sourceRow} : 5 ou 6 colonnes attendues.`)
    const [unitLabel, floor, fullName, email, role, shareLabel = ''] = cells
    const roleKey = role.toLowerCase()
    const relationPreset = Object.hasOwn(roles, roleKey) ? roles[roleKey] : null
    if (!unitLabel || !fullName) throw new Error(`Ligne ${sourceRow} : lot et nom obligatoires.`)
    if (!relationPreset) throw new Error(`Ligne ${sourceRow} : rôle « ${role} » non reconnu.`)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Ligne ${sourceRow} : e-mail invalide.`)
    return { sourceRow, unitLabel, floor, fullName, email, relationPreset, shareLabel }
  })
}
