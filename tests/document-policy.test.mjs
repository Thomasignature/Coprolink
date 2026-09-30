import assert from 'node:assert/strict'
import test from 'node:test'
import { documentBelongsToBuilding, documentStoreName, mayReadDocument, safeDownloadName } from '../netlify/lib/document-policy.mts'

test('document storage keys are isolated by building', () => {
  assert.equal(documentBelongsToBuilding('buildings/12/meeting.pdf', 12), true)
  assert.equal(documentBelongsToBuilding('buildings/13/meeting.pdf', 12), false)
  assert.equal(documentBelongsToBuilding('buildings/12/../13/private.pdf', 12), false)
})

test('private documents require the server capability', () => {
  assert.equal(mayReadDocument('public', false), true)
  assert.equal(mayReadDocument('private', false), false)
  assert.equal(mayReadDocument('private', true), true)
  assert.equal(mayReadDocument('owners', true, false), false)
  assert.equal(mayReadDocument('owners', true, true), true)
})

test('download names cannot inject headers or paths', () => {
  assert.equal(safeDownloadName('../PV\r\n.pdf'), '.._PV__.pdf')
})

test('blob stores are separated by deploy context', () => {
  assert.equal(documentStoreName('production'), 'coprolink-documents-production')
  assert.equal(documentStoreName('deploy-preview'), 'coprolink-documents-deploy-preview')
  assert.notEqual(documentStoreName('production'), documentStoreName('deploy-preview'))
})
