import assert from 'node:assert/strict'
import test from 'node:test'
import { correctAndReinvitePerson } from '../src/api-v3.js'

const person = { id: 7, email: 'wrong@example.test' }
const reply = (body, status = 200) => Response.json(body, { status })

test('correct before inviting and include the previous address for stale-edit protection', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) })
    return options.method === 'PATCH' ? reply({ reinvite: true }) : reply({ invited: true, message: 'Invitation envoyée' })
  })
  const result = await correctAndReinvitePerson('building one', person, 'correct@example.test')
  assert.equal(result.invited, true)
  assert.deepEqual(calls, [
    { url: '/api/person-access?building=building%20one', method: 'PATCH', body: { personId: 7, email: 'correct@example.test', previousEmail: 'wrong@example.test' } },
    { url: '/api/person-access?building=building%20one', method: 'POST', body: { personId: 7 } },
  ])
})

test('changing contact details without prior access does not send an unsolicited invitation', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => reply({ reinvite: false, message: 'Enregistrée' }))
  assert.equal((await correctAndReinvitePerson('one', person, 'correct@example.test')).message, 'Enregistrée')
  assert.equal(fetch.mock.callCount(), 1)
})

test('a refused correction never sends to the new address', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => reply({ error: 'Doublon' }, 409))
  await assert.rejects(correctAndReinvitePerson('one', person, 'correct@example.test'), { status: 409, message: 'Doublon' })
  assert.equal(fetch.mock.callCount(), 1)
})

test('mail failure after correction is explicit and lets the UI show the retry action', async t => {
  t.mock.method(globalThis, 'fetch', async (_, options) => options.method === 'PATCH'
    ? reply({ reinvite: true }) : reply({ error: 'Envoi indisponible' }, 502))
  await assert.rejects(correctAndReinvitePerson('one', person, 'correct@example.test'), error => {
    assert.equal(error.emailCorrected, true)
    assert.match(error.message, /ancien accès retiré/)
    assert.match(error.message, /Inviter sur CoproLink/)
    return true
  })
})

test('preparing access without a confirmed email is not reported as a sent invitation', async t => {
  t.mock.method(globalThis, 'fetch', async (_, options) => options.method === 'PATCH'
    ? reply({ reinvite: true }) : reply({ invited: false, state: 'pending', message: 'Aucun e-mail confirmé. Renvoyer l’invitation.' }, 202))
  const result = await correctAndReinvitePerson('one', person, 'correct@example.test')
  assert.equal(result.invited, false)
  assert.match(result.message, /Aucun e-mail confirmé/)
})
