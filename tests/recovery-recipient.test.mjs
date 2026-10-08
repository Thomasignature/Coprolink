import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRecoveryRecipient, RecoveryAccountMissingError } from '../netlify/lib/recovery-recipient.mts'
import { deliverPersonInvitation } from '../netlify/lib/person-invitation.mts'

test('recovery preserves the Identity spelling of an existing mixed-case address', async () => {
  const stored = { email: 'Jean.Dupont@Gmail.com' }
  const recipient = await resolveRecoveryRecipient(' jean.dupont@gmail.com ', async requested => {
    assert.equal(requested.toLowerCase(), stored.email.toLowerCase())
    return stored
  })
  assert.equal(recipient, 'Jean.Dupont@Gmail.com')
})
test('a stale local account cannot turn an unknown Identity account into a successful resend', async () => {
  let recoveryRequests = 0
  const account = { id: 'stale-user', email: 'deleted@example.com', fullName: 'Deleted', activated: true }
  await assert.rejects(deliverPersonInvitation(account.email, account.fullName, account, {
    invite: async () => { throw new Error('Unexpected invitation') },
    find: async () => null,
    isDuplicate: () => false,
    resend: async email => {
      await resolveRecoveryRecipient(email, async () => null)
      recoveryRequests++
    },
  }), RecoveryAccountMissingError)
  assert.equal(recoveryRequests, 0)
})
test('an unavailable administration API blocks unverified recovery requests', async () => {
  const failure = new Error('Administration unavailable')
  await assert.rejects(resolveRecoveryRecipient('test@example.com', async () => { throw failure }), error => error === failure)
})
test('an account without a delivery address is rejected', async () => {
  await assert.rejects(resolveRecoveryRecipient('test@example.com', async () => ({ email: '' })), RecoveryAccountMissingError)
})
