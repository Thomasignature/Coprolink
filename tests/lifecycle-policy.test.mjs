import assert from 'node:assert/strict'
import test from 'node:test'
import { canPermanentlyDeletePerson, capabilitiesForRelations, isIsoDate, localBusinessDate, readEndReason, shouldRevokeBuildingAccess, wouldRemoveLastManager } from '../netlify/lib/lifecycle-policy.mts'

test('a final relation revokes only the building access', () => {
  assert.equal(shouldRevokeBuildingAccess(0), true)
  assert.equal(shouldRevokeBuildingAccess(1), false)
})

test('owner, tenant and occupant capabilities remain distinct', () => {
  assert.deepEqual(capabilitiesForRelations(['tenant']), ['resident:tenant'])
  assert.equal(capabilitiesForRelations(['occupant']).includes('finance:read:own'), false)
  assert.equal(capabilitiesForRelations(['owner']).includes('finance:read:own'), true)
  assert.equal(capabilitiesForRelations(['owner', 'occupant']).includes('assemblies:respond'), true)
})

test('relationship end data is constrained', () => {
  assert.equal(isIsoDate('2026-09-30'), true)
  assert.equal(isIsoDate('30/09/2026'), false)
  assert.equal(readEndReason('sale'), 'sale')
  assert.throws(() => readEndReason('delete'))
})

test('permanent deletion is limited to unused erroneous records', () => {
  assert.equal(canPermanentlyDeletePerson({ relations: 0, referents: 0, assemblyResponses: 0, activeAccess: 0 }), true)
  assert.equal(canPermanentlyDeletePerson({ relations: 1, referents: 0, assemblyResponses: 0, activeAccess: 0 }), false)
  assert.equal(canPermanentlyDeletePerson({ relations: 0, referents: 0, assemblyResponses: 0, activeAccess: 1 }), false)
})

test('every role mutation protects the final active manager', () => {
  assert.equal(wouldRemoveLastManager({ currentRole: 'manager', nextRole: 'resident', otherActiveManagers: 0 }), true)
  assert.equal(wouldRemoveLastManager({ currentRole: 'manager', nextRole: 'resident', otherActiveManagers: 1 }), false)
  assert.equal(wouldRemoveLastManager({ currentRole: 'resident', nextRole: 'resident', otherActiveManagers: 0 }), false)
})

test('business dates follow Brussels around midnight and daylight-saving changes', () => {
  assert.equal(localBusinessDate(new Date('2026-03-29T22:30:00.000Z')), '2026-03-30')
  assert.equal(localBusinessDate(new Date('2026-10-25T01:30:00.000Z')), '2026-10-25')
})
