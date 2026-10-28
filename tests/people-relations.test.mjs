import assert from 'node:assert/strict'
import test from 'node:test'
import { directoryRows, validateRelationEnd } from '../src/people-relations.js'

const units = [{ id: 1, label: '4A', floor: '4' }, { id: 2, label: 'Garage', floor: '-1' }]
const people = [{ id: 1, fullName: 'Alice', email: 'alice@example.be' }, { id: 2, fullName: 'Bob' }, { id: 3, fullName: 'Sans lot' }]
const relations = [
  { id: 1, personId: 1, unitId: 1, relationType: 'owner', startDate: '2025-01-01' },
  { id: 2, personId: 1, unitId: 1, relationType: 'occupant', startDate: '2025-01-01', endDate: '2026-09-30', endReason: 'move' },
  { id: 3, personId: 2, unitId: 1, relationType: 'tenant', startDate: '2024-01-01', endDate: '2025-01-01', endReason: 'lease_end' },
  { id: 4, personId: 1, unitId: 2, relationType: 'owner' },
]

test('a move keeps ownership current and preserves the former occupancy and lot', () => {
  const current = directoryRows(units, people, relations)
  assert.deepEqual(current.map(row => row.person.id), [1, 1, 3])
  assert.deepEqual(current[0].relations.map(rel => rel.relationType), ['owner'])
  const former = directoryRows(units, people, relations, 'former')
  assert.equal(former.length, 2)
  assert.equal(former[0].unit.label, '4A')
  assert.equal(former[0].relations[0].endReason, 'move')
  assert.equal(directoryRows(units, people, relations, 'all').length, 5)
})

test('a sale archives the person without creating a misleading unlinked current entry', () => {
  const ended = relations.map(rel => ({ ...rel, endDate: rel.endDate || '2026-10-01', endReason: rel.endReason || 'sale' }))
  assert.deepEqual(directoryRows(units, people, ended).map(row => row.person.id), [3])
  assert.equal(directoryRows(units, people, ended, 'former', 'vente').length, 2)
})

test('history keeps separate periods and searches across all filters', () => {
  const old = { ...relations[2], id: 5, startDate: '2022-01-01', endDate: '2023-01-01' }
  assert.equal(directoryRows(units, people, [...relations, old], 'former', 'Bob').length, 2)
  assert.equal(directoryRows(units, people, relations, 'former', 'déménagement').length, 1)
  assert.equal(directoryRows(units, people, relations, 'all', 'Garage').length, 1)
})

test('end form requires active selection, valid period, reason, and an effective date', () => {
  assert.equal(validateRelationEnd(relations, [1], '2026-10-01', 'move', '2026-10-01'), '')
  for (const args of [
    [[], '2026-10-01', 'move'], [[2], '2026-10-01', 'move'],
    [[1], '2024-01-01', 'move'], [[1], '2027-01-01', 'sale'],
    [[1], '2026-02-30', 'sale'], [[1], '', 'sale'], [[1], '2026-10-01', ''],
  ]) assert.notEqual(validateRelationEnd(relations, ...args, '2026-10-01'), '')
})
