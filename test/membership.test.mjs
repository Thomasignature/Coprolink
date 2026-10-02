import assert from 'node:assert/strict'
import test from 'node:test'
import { localBusinessDate, parseMembershipEndDate } from '../netlify/lib/membership.mts'

const now = new Date('2026-10-02T12:00:00.000Z')

test('conserve la date civile sans la transformer en instant UTC', () => {
  assert.equal(parseMembershipEndDate('2026-10-02', now), '2026-10-02')
})

test('utilise le jour de Bruxelles autour de minuit UTC', () => {
  assert.equal(localBusinessDate(new Date('2026-03-29T22:30:00.000Z')), '2026-03-30')
  assert.equal(parseMembershipEndDate('2026-03-30', new Date('2026-03-29T22:30:00.000Z')), '2026-03-30')
})

test('reste stable lors des deux changements d’heure', () => {
  assert.equal(localBusinessDate(new Date('2026-03-29T00:30:00.000Z')), '2026-03-29')
  assert.equal(localBusinessDate(new Date('2026-10-25T01:30:00.000Z')), '2026-10-25')
})

test('refuse une date future', () => {
  assert.throws(() => parseMembershipEndDate('2026-10-03', now), /ne peut pas être future/)
})

test('refuse les dates civiles impossibles et les formats ambigus', () => {
  assert.throws(() => parseMembershipEndDate('2026-02-30', now), /invalide/)
  assert.throws(() => parseMembershipEndDate('02\/10\/2026', now), /invalide/)
})
