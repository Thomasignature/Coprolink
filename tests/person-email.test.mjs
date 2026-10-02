import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { eq } from 'drizzle-orm'

// Imported production wrappers initialize their driver; all queries below use isolated PGlite.
process.env.NETLIFY_DB_URL = 'postgresql://test:test@127.0.0.1:1/test'
register('./helpers/typescript-loader.mjs', import.meta.url)
const { correctPersonEmailInTransaction, normalizePersonEmail } = await import('../netlify/lib/person-email.mts')
const { grantMembershipInTransaction } = await import('../netlify/lib/membership-access.mts')
const { buildings, users, buildingMembers, pendingMembers, auditLog } = await import('../db/schema.ts')
const { buildingPeople, buildingUnits, unitPersonRelations } = await import('../db/schema-v3.ts')

const membership = { role: 'resident', unitLabel: 'A1', shareLabel: '10' }
const ctx = { buildingId: 1, principal: { kind: 'user', userId: 'operator' }, actorLabel: 'Syndic', role: 'manager' }

async function fixture(t) {
  const client = new PGlite()
  t.after(() => client.close())
  for (const migration of [
    '20260909105520_create_coprolink_core_schema', '20260911141654_add_pending_members',
    '20260916122000_create_persistent_building_model_v3', '20260929143000_add_general_assemblies',
    '20261001090000_add_membership_and_mandate_lifecycle',
  ]) {
    await client.exec(await readFile(new URL(`../netlify/database/migrations/${migration}/migration.sql`, import.meta.url), 'utf8'))
  }
  const db = drizzle({ client })
  await db.insert(buildings).values([{ id: 1, slug: 'one', name: 'One' }, { id: 2, slug: 'two', name: 'Two' }])
  await db.insert(users).values([{ id: 'operator', email: 'syndic@example.test' }, { id: 'wrong', email: 'typo@example.test' }, { id: 'right', email: 'correct@example.test' }])
  await db.insert(buildingPeople).values({ id: 1, buildingId: 1, fullName: 'Person', email: 'typo@example.test', userId: 'wrong' })
  await db.insert(buildingUnits).values({ id: 1, buildingId: 1, label: 'A1' })
  await db.insert(unitPersonRelations).values({ unitId: 1, personId: 1, relationType: 'owner' })
  return db
}
const correct = db => db.transaction(tx => correctPersonEmailInTransaction(tx, ctx, 1, 'correct@example.test', 'typo@example.test'))

test('a sent invitation loses building access while identity, other buildings and lot relations survive', async t => {
  const db = await fixture(t)
  await db.insert(buildingMembers).values([{ buildingId: 1, userId: 'wrong', ...membership }, { buildingId: 2, userId: 'wrong', ...membership }])
  const before = await db.select().from(unitPersonRelations)
  assert.equal((await correct(db)).reinvite, true)
  const members = await db.select().from(buildingMembers)
  assert.equal(members.find(m => m.buildingId === 1).endedReason, 'email_correction')
  assert.ok(members.find(m => m.buildingId === 1).endedAt)
  assert.equal(members.find(m => m.buildingId === 2).endedAt, null)
  assert.deepEqual(await db.select().from(unitPersonRelations), before)
  const [person] = await db.select().from(buildingPeople)
  assert.equal(person.email, 'correct@example.test')
  assert.equal(person.userId, null)
  assert.equal((await db.select().from(users).where(eq(users.id, 'wrong')))[0].email, 'typo@example.test')
  assert.equal((await db.select().from(auditLog))[0].action, 'access.email_corrected')
})

test('cancelled pending invitation cannot be claimed from a stale read', async t => {
  const db = await fixture(t)
  const [pending] = await db.insert(pendingMembers).values({ buildingId: 1, email: 'typo@example.test', ...membership }).returning()
  assert.equal((await correct(db)).reinvite, true)
  const result = await db.transaction(tx => grantMembershipInTransaction(tx, 1, 'wrong', membership, { pendingId: pending.id }))
  assert.equal(result.member, null)
  assert.deepEqual(await db.select().from(buildingMembers), [])
  assert.deepEqual(await db.select().from(pendingMembers), [])
})

test('an invitation already in flight cannot restore the previous address after correction', async t => {
  const db = await fixture(t)
  await correct(db)
  const result = await db.transaction(tx => grantMembershipInTransaction(tx, 1, 'wrong', membership, { person: { id: 1, email: 'typo@example.test' } }))
  assert.equal(result.member, null)
  assert.deepEqual(await db.select().from(buildingMembers), [])
})

test('claim followed by correction also ends the old access', async t => {
  const db = await fixture(t)
  const [pending] = await db.insert(pendingMembers).values({ buildingId: 1, email: 'typo@example.test', ...membership }).returning()
  await db.transaction(tx => grantMembershipInTransaction(tx, 1, 'wrong', membership, { pendingId: pending.id }))
  await correct(db)
  assert.ok((await db.select().from(buildingMembers))[0].endedAt)
  assert.deepEqual(await db.select().from(pendingMembers), [])
})

test('stale edits, cross-building person IDs and duplicate emails are rejected before changes', async t => {
  const db = await fixture(t)
  await assert.rejects(db.transaction(tx => correctPersonEmailInTransaction(tx, ctx, 1, 'correct@example.test', 'stale@example.test')), { status: 409 })
  await assert.rejects(db.transaction(tx => correctPersonEmailInTransaction(tx, { ...ctx, buildingId: 2 }, 1, 'correct@example.test', 'typo@example.test')), { status: 404 })
  await db.insert(buildingPeople).values({ id: 2, buildingId: 1, email: 'correct@example.test', fullName: 'Other' })
  await assert.rejects(correct(db), { status: 409 })
  assert.equal((await db.select().from(buildingPeople).where(eq(buildingPeople.id, 1)))[0].email, 'typo@example.test')
  assert.deepEqual(await db.select().from(auditLog), [])
})

test('manager access cannot be revoked by correcting a resident record', async t => {
  const db = await fixture(t)
  await db.insert(buildingMembers).values({ buildingId: 1, userId: 'wrong', ...membership, role: 'manager' })
  await assert.rejects(correct(db), { status: 409 })
  assert.equal((await db.select().from(buildingMembers))[0].endedAt, null)
  const demotion = await db.transaction(tx => grantMembershipInTransaction(tx, 1, 'wrong', membership))
  assert.equal(demotion.blocked, true)
})

test('a transaction failure rolls back revocation, cancellation and email together', async t => {
  const db = await fixture(t)
  await db.insert(buildingMembers).values({ buildingId: 1, userId: 'wrong', ...membership })
  await db.insert(pendingMembers).values({ buildingId: 1, email: 'typo@example.test', ...membership })
  await assert.rejects(db.transaction(tx => correctPersonEmailInTransaction(tx,
    { ...ctx, principal: { kind: 'user', userId: 'missing-audit-actor' } }, 1, 'correct@example.test', 'typo@example.test')))
  assert.equal((await db.select().from(buildingMembers))[0].endedAt, null)
  assert.equal((await db.select().from(pendingMembers)).length, 1)
  assert.equal((await db.select().from(buildingPeople))[0].email, 'typo@example.test')
})

test('claiming an edited invitation uses its current role instead of stale privileges', async t => {
  const db = await fixture(t)
  const [pending] = await db.insert(pendingMembers).values({ buildingId: 1, email: 'typo@example.test', ...membership, role: 'manager' }).returning()
  await db.update(pendingMembers).set({ role: 'resident' }).where(eq(pendingMembers.id, pending.id))
  const result = await db.transaction(tx => grantMembershipInTransaction(tx, 1, 'wrong', { ...membership, role: 'manager' }, { pendingId: pending.id }))
  assert.equal(result.member.role, 'resident')
})

test('an existing council role is preserved when the corrected person gains access', async t => {
  const db = await fixture(t)
  await correct(db)
  await db.insert(buildingMembers).values({ buildingId: 1, userId: 'right', ...membership, role: 'council_member' })
  const result = await db.transaction(tx => grantMembershipInTransaction(tx, 1, 'right', membership, { person: { id: 1, email: 'correct@example.test' }, preserveRole: true }))
  assert.equal(result.member.role, 'council_member')
  assert.equal((await db.select().from(buildingPeople))[0].userId, 'right')
})

test('missing and malformed emails are rejected; harmless case changes are normalized', () => {
  assert.equal(normalizePersonEmail(' Correct@Example.test '), 'correct@example.test')
  for (const value of [null, '', 'a@b', 'a @b.test', 'a@b@c.test', 'a\nb@example.test']) {
    assert.throws(() => normalizePersonEmail(value), { status: 422 })
  }
})
