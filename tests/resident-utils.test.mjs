import assert from 'node:assert/strict'
import test from 'node:test'
import { localDateKey, splitEvents, validateReport } from '../src/resident-utils.js'

test('selects future events in Brussels and separates past events', () => {
  const now = new Date('2026-09-29T22:30:00.000Z') // 30 September in Brussels
  assert.equal(localDateKey(now), '2026-09-30')
  const result = splitEvents([
    { id: 1, eventDate: '2026-09-21' },
    { id: 2, eventDate: '2026-10-04' },
    { id: 3, eventDate: '2026-09-30' },
  ], now)
  assert.deepEqual(result.future.map(item => item.id), [3, 2])
  assert.deepEqual(result.past.map(item => item.id), [1])
})

test('report validation rejects whitespace and enforces limits in French', () => {
  const errors = validateReport({ category: ' ', location: ' ', description: ' ', title: 'x'.repeat(121) })
  assert.equal(errors.category, 'La catégorie est obligatoire.')
  assert.equal(errors.location, 'L’emplacement est obligatoire.')
  assert.equal(errors.description, 'La description est obligatoire.')
  assert.match(errors.title, /120 caractères/)
})

test('a valid private report has no validation error', () => {
  assert.deepEqual(validateReport({ category: 'Entretien', location: 'Hall', description: 'Lampe éteinte', isPublic: false }), {})
})
