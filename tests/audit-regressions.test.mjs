import assert from 'node:assert/strict'
import test from 'node:test'
import { isIsoDate, validateRelationEnd } from '../netlify/lib/lifecycle-policy.mts'
import { serializeResidentLots } from '../netlify/lib/resident-policy.mts'
import { residentProfile, amountIsKnown } from '../src/resident-utils.js'
import { notificationSendingEnabled, notificationIsCurrent } from '../netlify/lib/notification-policy.mts'

test('relation end rejects impossible, future, reversed and already closed periods', () => {
  const now = new Date('2026-10-28T12:00:00Z')
  const period = { startDate: '2026-10-01', endDate: null }
  assert.equal(isIsoDate('2026-02-30'), false)
  assert.throws(() => validateRelationEnd(period, '2026-10-29', now), /future/)
  assert.throws(() => validateRelationEnd(period, '2026-09-30', now), /précéder/)
  assert.throws(() => validateRelationEnd({ ...period, endDate: '2026-10-27' }, null, now), /lecture seule/)
  assert.equal(validateRelationEnd(period, '2026-10-28', now), '2026-10-28')
})

test('multi-lot serialization keeps owner amounts separate and strips non-owner fields', () => {
  const row = { id: 1, label: 'A', floor: '1', unitShare: '50/1000', relationShare: '', relationId: 1, relationType: 'owner', quarterlyCall: '0.00', balance: '-20.50' }
  const lots = serializeResidentLots([row, { ...row, relationId: 2, relationType: 'occupant', quarterlyCall: '9999' }, { ...row, id: 2, label: 'B', relationId: 3, quarterlyCall: null, balance: null }], true)
  assert.equal(lots.length, 2)
  assert.equal(lots[0].quarterlyCall, 0)
  assert.equal(lots[0].balance, -20.5)
  assert.equal(lots[1].quarterlyCall, null)
  const tenant = serializeResidentLots([{ ...row, relationType: 'tenant' }], true)[0]
  assert.equal('balance' in tenant, false)
  assert.equal('shareLabel' in tenant, false)
  assert.equal('balance' in serializeResidentLots([row], false)[0], false)
})

test('real resident role comes from capabilities and zero is a known amount', () => {
  assert.equal(residentProfile({ capabilities: ['resident:tenant'] }).owner, false)
  assert.equal(residentProfile({ capabilities: ['resident:owner', 'resident:tenant'] }).owner, true)
  assert.equal(residentProfile({ capabilities: ['resident:owner'] }, 'tenant').owner, false)
  assert.equal(amountIsKnown(0), true)
  assert.equal(amountIsKnown(null), false)
  assert.equal(amountIsKnown(undefined), false)
})

test('notification sending cannot be enabled in a preview; retry expiry stays inside provider idempotency window', () => {
  const vars = { CONTEXT: 'deploy-preview', COPROLINK_NOTIFICATIONS_ENABLED: 'true', RESEND_API_KEY: 'fake', COPROLINK_EMAIL_FROM: 'fake@example.invalid' }
  const env = { get: key => vars[key] }
  assert.equal(notificationSendingEnabled(env), false)
  vars.CONTEXT = 'production'
  assert.equal(notificationSendingEnabled(env), true)
  const now = new Date('2026-10-28T12:00:00Z')
  assert.equal(notificationIsCurrent({ createdAt: new Date('2026-10-28T11:00:00Z'), attempts: 0 }, now), true)
  assert.equal(notificationIsCurrent({ createdAt: new Date('2026-10-27T12:00:00Z'), attempts: 0 }, now), false)
})
