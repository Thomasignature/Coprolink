import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMembershipEndDate } from '../netlify/lib/membership.mts'

const now = new Date('2026-10-02T12:00:00.000Z')

test('accepte la date du jour et la normalise', () => {
  assert.equal(parseMembershipEndDate('2026-10-02', now).toISOString(), '2026-10-02T23:59:59.999Z')
})

test('refuse une date future', () => {
  assert.throws(() => parseMembershipEndDate('2026-10-03', now), /ne peut pas être future/)
})

test('refuse les dates civiles impossibles et les formats ambigus', () => {
  assert.throws(() => parseMembershipEndDate('2026-02-30', now), /invalide/)
  assert.throws(() => parseMembershipEndDate('02\/10\/2026', now), /invalide/)
})
