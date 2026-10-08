import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverPersonInvitation } from '../netlify/lib/person-invitation.mts'

const account = { id: 'user-1', email: 'test@example.com', fullName: 'Test', activated: false }
const duplicate = new Error('Account already exists')
const setup = (overrides = {}) => {
  const calls = []
  return { calls, delivery: {
    invite: async (...args) => { calls.push(['invite', ...args]); return account },
    find: async email => { calls.push(['find', email]); return account },
    resend: async email => { calls.push(['resend', email]) },
    isDuplicate: error => error === duplicate,
    ...overrides,
  } }
}
test('a new account requests an invitation exactly once', async () => {
  const { calls, delivery } = setup()
  assert.deepEqual(await deliverPersonInvitation(account.email, 'Test', null, delivery), { account, invited: true })
  assert.deepEqual(calls, [['invite', account.email, 'Test']])
})
for (const activated of [false, true]) {
  test(`an existing ${activated ? 'active' : 'inactive'} account receives a fresh link`, async () => {
    const { calls, delivery } = setup()
    const existing = { ...account, activated }
    assert.deepEqual(await deliverPersonInvitation(account.email, 'Test', existing, delivery), { account: existing, invited: false })
    assert.deepEqual(calls, [['resend', account.email]])
  })
}
test('an account created concurrently is looked up before resending', async () => {
  const { calls, delivery } = setup({ invite: async () => { throw duplicate } })
  assert.equal((await deliverPersonInvitation(account.email, 'Test', null, delivery)).invited, false)
  assert.deepEqual(calls, [['find', account.email], ['resend', account.email]])
})
test('a failed invitation never falls back to recovery for an unknown account', async () => {
  const failure = new Error('Service unavailable')
  const { calls, delivery } = setup({ invite: async () => { throw failure } })
  await assert.rejects(deliverPersonInvitation(account.email, 'Test', null, delivery), error => error === failure)
  assert.deepEqual(calls, [])
})
test('a duplicate account that cannot be verified is not treated as a successful send', async () => {
  const { calls, delivery } = setup({ invite: async () => { throw duplicate }, find: async () => null })
  await assert.rejects(deliverPersonInvitation(account.email, 'Test', null, delivery), error => error === duplicate)
  assert.deepEqual(calls, [])
})
test('a rejected resend propagates the failure instead of granting silent access', async () => {
  const failure = new Error('Rate limit')
  const { delivery } = setup({ resend: async () => { throw failure } })
  await assert.rejects(deliverPersonInvitation(account.email, 'Test', account, delivery), error => error === failure)
})
