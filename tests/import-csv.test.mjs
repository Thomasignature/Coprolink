import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/import-csv.js';
import { matchImportPerson } from '../netlify/lib/import-matching.mts';

test('CSV preserves quoted separators, escaped quotes and CRLF', () => {
  const [row] = parseCsv('Lot;Étage;Nom;E-mail;Rôle;Quotité\r\nQA-4;3;"Dupont; ""Alice""";;Copropriétaire;25/1000');
  assert.equal(row.fullName, 'Dupont; "Alice"');
  assert.equal(row.email, '');
  assert.equal(row.relationPreset, 'owner');
  assert.equal(row.sourceRow, 2);
});

test('comma CSV supports multiline names and BOM', () => {
  const rows = parseCsv('\uFEFFLot,Étage,Nom,E-mail,Rôle,Quotité\n1,0,"Alice\nDupont",,occupant,\n2,1,Bob,,locataire,');
  assert.equal(rows[0].fullName, 'Alice\nDupont');
  assert.equal(rows[1].sourceRow, 4);
});

test('invalid role, email, columns and quotes block import instead of silently changing data', () => {
  for (const csv of ['1;0;Alice;;inconnu;', '1;0;Alice;invalide;occupant;', '1;Alice', '1;0;"Alice;;occupant;', '1;0;"Alice"oops;;occupant;']) {
    assert.throws(() => parseCsv(csv));
  }
  assert.throws(() => parseCsv(Array(501).fill('1;0;Alice;;occupant;').join('\n')), /500/);
});

test('a person without email is reused on repeated import of the same active unit', () => {
  const person = { id: 1, fullName: 'Alice  Dupont', email: '' };
  assert.equal(matchImportPerson([person, person], ' alice dupont '), person);
  assert.equal(matchImportPerson([person], 'Bob'), null);
  assert.equal(matchImportPerson([{ ...person, email: 'alice@example.invalid' }], 'Alice Dupont'), null);
});

test('existing duplicate people are reported for manual review rather than guessed', () => {
  assert.throws(() => matchImportPerson([
    { id: 1, fullName: 'Alice', email: '' },
    { id: 2, fullName: 'alice', email: '' },
  ], 'Alice'), /Plusieurs personnes/);
});
