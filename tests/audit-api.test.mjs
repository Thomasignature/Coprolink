import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { Webhook } from 'svix'

// Exercise the actual handlers and authorization against a local Postgres engine.
// Only the environment (Identity + database connector) is substituted.
test('audit APIs: real policies, migrations, ownership periods and revocation', async t => {
  const pg = new PGlite()
  globalThis.__coprolinkAuditDb = drizzle({ client: pg })
  globalThis.Netlify = { env: { get: () => undefined } }
  const folder = resolve('.netlify/audit-tests')
  await mkdir(folder, { recursive: true })
  const handlers = {}
  const plugins = [{ name: 'isolated-test-environment', setup(b) {
    b.onResolve({ filter: /db\/index\.js$/ }, () => ({ path: 'db', namespace: 'test-env' }))
    b.onResolve({ filter: /^@netlify\/blobs$/ }, () => ({ path: 'blobs', namespace: 'test-env' }))
    b.onResolve({ filter: /^@netlify\/identity$/ }, () => ({ path: 'identity', namespace: 'test-env' }))
    b.onLoad({ filter: /.*/, namespace: 'test-env' }, args => ({ contents: args.path === 'db'
      ? 'export const db=globalThis.__coprolinkAuditDb;'
      : args.path === 'blobs' ? 'export const getStore=()=>globalThis.__coprolinkAuditStore;'
      : 'export const getUser=async()=>globalThis.__coprolinkAuditUser; export const admin={listUsers:async(...a)=>globalThis.__coprolinkAuditIdentity.listUsers(...a)}; export const getIdentityConfig=()=>globalThis.__coprolinkAuditIdentity?.config ?? ({});', loader: 'js' }))
  }}]
  try {
    for (const entry of (await readdir('netlify/database/migrations')).sort()) {
      if (entry < '20261028') await pg.exec(await readFile(`netlify/database/migrations/${entry}/migration.sql`, 'utf8'))
    }
    await pg.exec(`INSERT INTO buildings (slug,name) VALUES ('qa','QA'),('other','Other');
      INSERT INTO users(id,email,full_name) VALUES ('manager','manager@example.invalid','Syndic'),('owner','owner@example.invalid','Owner'),('tenant','tenant@example.invalid','Tenant'),('neighbour','other@example.invalid','Neighbour');
      INSERT INTO building_members(building_id,user_id,role,unit_label,quarterly_call,balance) VALUES (1,'manager','manager','',0,0),(1,'owner','resident','A',999,999),(1,'tenant','resident','C',777,777),(1,'neighbour','resident','D',100,100);
      INSERT INTO building_units(building_id,label,share_label) VALUES (1,'A','10/100'),(1,'B','20/100'),(1,'C','30/100'),(1,'D','40/100');
      INSERT INTO building_people(building_id,user_id,email,full_name) VALUES (1,'owner','owner@example.invalid','Owner'),(1,'tenant','tenant@example.invalid','Tenant'),(1,'neighbour','other@example.invalid','Neighbour');
      INSERT INTO unit_person_relations(unit_id,person_id,relation_type,start_date) VALUES (1,1,'owner','2026-01-01'),(2,1,'owner','2026-01-01'),(3,2,'tenant','2026-01-01'),(4,3,'owner','2026-01-01');
      `)
    for (const entry of (await readdir('netlify/database/migrations')).sort()) {
      if (entry >= '20261028') await pg.exec(await readFile(`netlify/database/migrations/${entry}/migration.sql`, 'utf8'))
    }
    await t.test('migration only copies unambiguous ownership and preserves legacy amounts', async () => {
      const copied = await pg.query('SELECT relation_id, balance::text FROM relation_finances ORDER BY relation_id')
      assert.deepEqual(copied.rows, [{ relation_id: 4, balance: '100.00' }])
      assert.equal((await pg.query("SELECT balance::text FROM building_members WHERE user_id='owner'")).rows[0].balance,'999.00')
    })
    await pg.exec('INSERT INTO relation_finances(relation_id,quarterly_call,balance) VALUES (1,0,-25),(2,200,20),(3,888,888),(4,9999,9999) ON CONFLICT(relation_id) DO UPDATE SET quarterly_call=excluded.quarterly_call,balance=excluded.balance')
    for (const name of ['workspace', 'building-model', 'person-access', 'finances', 'members', 'tickets', 'inbound-email', 'onboarding-import', 'notification-status', 'announcements', 'notification-delivery', 'documents', 'events', 'assemblies', 'display']) {
      const outfile = `${folder}/${name}.mjs`
      await build({ entryPoints: [`netlify/functions/${name}.mts`], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', plugins, logLevel: 'silent' })
      handlers[name] = (await import(outfile)).default
    }
    const as = id => { globalThis.__coprolinkAuditUser = { id, email: `${id === 'neighbour' ? 'other' : id}@example.invalid`, name: id, roles: [] } }
    const call = (name, method = 'GET', body, params = {}, building = 'qa') => handlers[name](new Request(`https://qa.invalid/api/${name}?building=${building}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }), { params })

    await t.test('a tenant receives no financial fields even with populated legacy and relation amounts', async () => {
      as('tenant')
      const response = await call('workspace'); assert.equal(response.status, 200)
      const data = await response.json()
      assert.equal(data.capabilities.includes('resident:owner'), false)
      assert.equal(data.lots.length, 1)
      assert.equal(data.lots[0].unitLabel, 'C')
      for (const field of ['quarterlyCall','balance','shareLabel']) assert.equal(field in data.member, false)
      assert.equal((await call('workspace', 'GET', null, {}, 'other')).status, 403)
    })
    await t.test('an owner sees both lots, zero and credit, never neighbour balances', async () => {
      as('owner')
      const data = await (await call('workspace')).json()
      assert.deepEqual(data.lots.map(l => [l.unitLabel,l.quarterlyCall,l.balance]), [['A',0,-25],['B',200,20]])
    })
    await t.test('financial writes reject another ACP and closed/non-owner relations', async () => {
      as('manager')
      assert.equal((await call('finances','PATCH',{ relationId:3,quarterlyCall:10,balance:10 })).status,404)
      assert.equal((await call('finances','PATCH',{ relationId:1,quarterlyCall:0,balance:-30 })).status,200)
      as('tenant')
      assert.equal((await call('finances','GET')).status,403)
    })
    await t.test('server rejects future and invalid closure dates and protects the last manager', async () => {
      as('manager')
      assert.equal((await call('building-model','PATCH',{ entity:'relation',id:1,endDate:'2999-01-01',endReason:'sale' })).status,422)
      assert.equal((await call('building-model','PATCH',{ entity:'relation',id:1,endDate:'2026-02-30',endReason:'sale' })).status,422)
      assert.equal((await call('members','DELETE',null,{ id:'1' })).status,409)
    })
    await t.test('partial departure keeps other lot access, history cannot reopen, final departure revokes', async () => {
      as('manager')
      assert.equal((await call('building-model','PATCH',{ entity:'relation',id:1,endDate:'2026-10-01',endReason:'sale' })).status,200)
      assert.equal((await call('building-model','PATCH',{ entity:'relation',id:1,endDate:null })).status,409)
      as('owner')
      const remaining = await (await call('workspace')).json(); assert.deepEqual(remaining.lots.map(l=>l.unitLabel), ['B'])
      as('manager')
      await pg.exec("INSERT INTO pending_members(building_id,email) VALUES (1,'owner@example.invalid')")
      assert.equal((await call('building-model','PATCH',{ entity:'relation',id:2,endDate:'2026-10-01',endReason:'sale' })).status,200)
      assert.equal((await call('person-access','POST',{personId:1})).status,409)
      assert.equal((await pg.query("SELECT count(*)::int AS count FROM pending_members WHERE email='owner@example.invalid'")).rows[0].count,0)
      await pg.exec("INSERT INTO pending_members(building_id,email) VALUES (1,'owner@example.invalid')")
      as('owner')
      assert.equal((await call('workspace')).status,403)
      const rows = await pg.query('SELECT count(*)::int AS count FROM relation_finances WHERE relation_id IN (1,2)')
      assert.equal(rows.rows[0].count,2)
    })
    await t.test('scheduled interventions require a date and persist it in history', async () => {
      await pg.exec("INSERT INTO tickets(reference,building_id,title,reporter_user_id) VALUES ('T-0001',1,'Test','tenant')")
      as('manager')
      assert.equal((await call('tickets','PATCH',{status:'scheduled'},{reference:'T-0001'})).status,422)
      const response = await call('tickets','PATCH',{status:'scheduled',scheduledOn:'2999-01-01',scheduledTime:'09:30'},{reference:'T-0001'})
      assert.equal(response.status,200)
      const ticket = await response.json(); assert.equal(ticket.scheduledOn,'2999-01-01'); assert.match(ticket.nextStep,/09:30/)
    })
    await t.test('repeated concurrent imports without email create a single person and relation', async () => {
      as('manager')
      const body = { rows: [{ unitLabel: 'E', fullName: 'Sans Email', relationPreset: 'tenant' }] }
      const responses = await Promise.all([call('onboarding-import','POST',body),call('onboarding-import','POST',body)])
      for (const response of responses) assert.equal(response.status,201)
      assert.equal((await pg.query("SELECT count(*)::int AS count FROM building_people WHERE full_name='Sans Email'")).rows[0].count,1)
    })
    await t.test('re-importing with e-mails completes people; shared addresses are reported per row', async () => {
      as('manager')
      const first = await (await call('onboarding-import','POST',{ rows: [{ unitLabel: 'F', fullName: 'Jean Dupont', relationPreset: 'owner' }] })).json()
      assert.equal(first.peopleCreated, 1)
      const second = await (await call('onboarding-import','POST',{ rows: [
        { unitLabel: 'F', fullName: 'Jean Dupont', email: 'Famille@Example.Invalid', relationPreset: 'owner' },
        { unitLabel: 'F', fullName: 'Marie Dupont', email: 'famille@example.invalid', relationPreset: 'owner' },
      ] })).json()
      assert.equal(second.peopleCreated, 0)
      assert.deepEqual(second.errors.map(e => e.row), [2])
      assert.match(second.errors[0].message, /appartient déjà à Jean Dupont/)
      const again = await (await call('onboarding-import','POST',{ rows: [{ unitLabel: 'F', fullName: 'Jean Dupont', relationPreset: 'owner' }] })).json()
      assert.deepEqual([again.peopleCreated, again.relationsCreated], [0, 0])
      const people = await pg.query("SELECT email FROM building_people WHERE full_name IN ('Jean Dupont','Marie Dupont')")
      assert.deepEqual(people.rows, [{ email: 'famille@example.invalid' }])
    })
    await t.test('invalid Inbox dates are refused without creating an event', async () => {
      await pg.exec("INSERT INTO inbound_emails(building_id,provider_email_id,subject) VALUES (1,'fake','Test')")
      as('manager')
      assert.equal((await call('inbound-email','PATCH',{emailId:1,action:'create_calendar_event',eventDate:'2026-02-30'})).status,422)
      assert.equal((await pg.query('SELECT count(*)::int AS count FROM events')).rows[0].count,0)
    })
    await t.test('Inbox repeated validation creates only one event', async () => {
      as('manager')
      const body = { emailId:1, action:'create_calendar_event',eventDate:'2999-01-01' }
      const responses = await Promise.all([call('inbound-email','PATCH',body),call('inbound-email','PATCH',body)])
      for (const response of responses) assert.ok(response.ok)
      assert.equal((await pg.query('SELECT count(*)::int AS count FROM events')).rows[0].count,1)
      assert.equal((await pg.query('SELECT is_public FROM events')).rows[0].is_public,false)
    })
    await t.test('Inbox archives provider attachment bytes, ignores client storage keys, and deduplicates', async () => {
      as('manager')
      const originalFetch = globalThis.fetch
      globalThis.Netlify.env.get = key => key === 'RESEND_API_KEY' ? 'test-only' : undefined
      const stored = new Map()
      globalThis.__coprolinkAuditStore = { set: async (key, value) => { stored.set(key, value) } }
      globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('https://api.resend.com/')) return Response.json({ data: [{ id:'attachment-1', filename:'test.pdf', size:9, download_url:'https://inbound-cdn.resend.com/attachment' }], has_more:false })
        assert.equal(String(url),'https://inbound-cdn.resend.com/attachment')
        assert.equal(options.headers,undefined)
        return new Response('%PDF-test')
      }
      try {
        const body = { emailId:1, action:'classify_documents',files:['test.pdf'],_preparedAttachments:[{storageKey:'another-building'}] }
        assert.equal((await call('inbound-email','PATCH',body)).status,201)
        assert.equal((await call('inbound-email','PATCH',body)).status,200)
        const docs = await pg.query('SELECT storage_key FROM documents')
        assert.equal(docs.rows.length,1)
        assert.match(docs.rows[0].storage_key,/^buildings\/1\/inbound-/)
        assert.equal(new TextDecoder().decode(stored.get(docs.rows[0].storage_key)),'%PDF-test')
      } finally { globalThis.fetch=originalFetch; globalThis.Netlify.env.get=()=>undefined }
    })
    await t.test('notification outbox deduplicates, rechecks access and records delivery', async () => {
      as('manager')
      const vars = { CONTEXT:'production',COPROLINK_NOTIFICATIONS_ENABLED:'true',RESEND_API_KEY:'fake',COPROLINK_EMAIL_FROM:'qa@example.invalid',SITE_ID:'local-qa' }
      globalThis.Netlify.env.get = key => vars[key]
      const originalFetch = globalThis.fetch
      const deliveries = []
      globalThis.fetch = async (url, options) => {
        assert.equal(url,'https://api.resend.com/emails')
        deliveries.push({body:JSON.parse(options.body),key:options.headers['Idempotency-Key']})
        return Response.json({id:`local-${deliveries.length}`})
      }
      try {
        const published = await call('announcements','POST',{title:'Test',body:'Communication'})
        assert.equal(published.status,201)
        assert.equal((await pg.query('SELECT count(*)::int AS count FROM notification_outbox')).rows[0].count,3)
        await pg.exec("UPDATE building_members SET ended_at=now() WHERE user_id='tenant'")
        await handlers['notification-delivery']()
        assert.equal(deliveries.length,2)
        assert.ok(deliveries.every(d=>!d.body.to.includes('tenant@example.invalid')))
        assert.equal(new Set(deliveries.map(d=>d.key)).size,2)
        await handlers['notification-delivery']()
        assert.equal(deliveries.length,2)
        const status = await (await call('notification-status')).json()
        assert.equal(status.notifications.filter(n=>n.status==='sent').length,2)
        assert.equal(status.notifications.filter(n=>n.status==='cancelled').length,1)
      } finally { globalThis.fetch=originalFetch; globalThis.Netlify.env.get=()=>undefined }
    })
    await t.test('person invitations ask Identity, never claim delivery and attach the right lot', async () => {
      as('manager')
      const identity = { accounts: [], calls: [], fail: null }
      globalThis.__coprolinkAuditIdentity = {
        config: { url: 'https://identity.invalid', token: 'operator-test' },
        listUsers: async () => identity.accounts,
      }
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (url, options) => {
        const path = String(url).replace('https://identity.invalid', '')
        identity.calls.push([path, JSON.parse(options.body).email])
        if (identity.fail === 'rate') return Response.json({ msg: 'rate limit exceeded' }, { status: 429 })
        if (identity.fail === 'down') return Response.json({ msg: 'unavailable' }, { status: 503 })
        if (path === '/invite') {
          const account = { id: `identity-${identity.accounts.length + 1}`, email: JSON.parse(options.body).email, confirmedAt: null }
          identity.accounts.push(account)
          return Response.json(account)
        }
        return Response.json({})
      }
      try {
        const { rows: [person] } = await pg.query("INSERT INTO building_people(building_id,email,full_name) VALUES (1,'Nouvelle.Personne@Example.Invalid','Nouvelle') RETURNING id")
        await pg.query("INSERT INTO unit_person_relations(unit_id,person_id,relation_type,start_date) VALUES (3,$1,'occupant','2026-01-01')", [person.id])
        // A local mirror whose Identity account disappeared must not short-circuit the invitation.
        await pg.exec("INSERT INTO users(id,email,full_name) VALUES ('stale-mirror','nouvelle.personne@example.invalid','Ancien')")

        identity.fail = 'down'
        const down = await call('person-access', 'POST', { personId: person.id })
        assert.equal(down.status, 503)
        assert.match((await down.json()).error, /Aucun envoi confirmé/)
        identity.fail = 'rate'
        assert.equal((await call('person-access', 'POST', { personId: person.id })).status, 429)
        assert.equal((await pg.query("SELECT count(*)::int AS count FROM building_members WHERE user_id LIKE 'identity-%'")).rows[0].count, 0)

        identity.fail = null; identity.calls.length = 0
        const invited = await call('person-access', 'POST', { personId: person.id })
        assert.equal(invited.status, 201)
        const result = await invited.json()
        assert.equal(result.invited, true)
        assert.equal(result.deliveryConfirmed, false)
        assert.equal('emailSent' in result, false)
        assert.doesNotMatch(result.message, /envoyée/)
        assert.deepEqual(identity.calls, [['/invite', 'nouvelle.personne@example.invalid']])
        const member = (await pg.query("SELECT role, unit_label, ended_at FROM building_members WHERE user_id='identity-1'")).rows[0]
        assert.deepEqual([member.role, member.unit_label, member.ended_at], ['resident', 'C', null])

        // Second request for the same, still unconfirmed account: recovery link, not a new invite.
        identity.calls.length = 0
        const resent = await (await call('person-access', 'POST', { personId: person.id })).json()
        assert.equal(resent.invited, false)
        assert.match(resent.message, /pas encore activé/)
        assert.deepEqual(identity.calls, [['/recover', 'nouvelle.personne@example.invalid']])

        // The invited person logs in with a differently cased address and sees only lot C, without amounts.
        globalThis.__coprolinkAuditUser = { id: 'identity-1', email: 'Nouvelle.Personne@example.invalid', name: 'Nouvelle', roles: [] }
        const workspace = await (await call('workspace')).json()
        assert.deepEqual(workspace.lots.map(l => [l.unitLabel, 'balance' in l]), [['C', false]])
      } finally { globalThis.fetch = originalFetch; delete globalThis.__coprolinkAuditIdentity }
    })
    await t.test('a pending invitation stored with uppercase letters is claimed case-insensitively', async () => {
      await pg.exec("INSERT INTO users(id,email,full_name) VALUES ('case-user','casse@example.invalid','Casse'); INSERT INTO pending_members(building_id,email,role) VALUES (2,'Casse@Example.Invalid','resident')")
      globalThis.__coprolinkAuditUser = { id: 'case-user', email: 'casse@example.invalid', name: 'Casse', roles: [] }
      assert.equal((await call('workspace', 'GET', null, {}, 'other')).status, 200)
      assert.equal((await call('workspace')).status, 403)
    })
    await t.test('an owner-occupant who moves out keeps ownership, amounts and access', async () => {
      as('manager')
      const created = await call('building-model', 'POST', { entity: 'relation', unitId: 4, personId: 3, relationType: 'occupant', startDate: '2026-01-01' })
      assert.equal(created.status, 201)
      const occupant = await created.json()
      assert.equal((await call('building-model', 'POST', { entity: 'relation', unitId: 4, personId: 3, relationType: 'occupant' })).status, 409)
      assert.equal((await call('building-model', 'PATCH', { entity: 'relation', id: occupant.id, endDate: '2026-10-01', endReason: 'move' })).status, 200)
      as('neighbour')
      const data = await (await call('workspace')).json()
      assert.deepEqual(data.lots.map(l => [l.unitLabel, l.relationTypes, l.balance]), [['D', ['owner'], 9999]])
    })
    await t.test('a returning person gets a new period without the previous amounts', async () => {
      as('manager')
      assert.equal((await call('building-model', 'POST', { entity: 'relation', unitId: 1, personId: 1, relationType: 'owner', startDate: '2026-09-01' })).status, 422)
      assert.equal((await call('building-model', 'POST', { entity: 'relation', unitId: 1, personId: 1, relationType: 'owner', startDate: '2026-10-15' })).status, 201)
      globalThis.__coprolinkAuditIdentity = { config: { url: 'https://identity.invalid', token: 'operator-test' }, listUsers: async () => [{ id: 'owner', email: 'owner@example.invalid', confirmedAt: '2026-01-01T00:00:00Z' }] }
      const originalFetch = globalThis.fetch
      const calls = []
      globalThis.fetch = async (url, options) => { calls.push([String(url), JSON.parse(options.body).email]); return Response.json({}) }
      try {
        const response = await call('person-access', 'POST', { personId: 1 })
        assert.equal(response.status, 201)
        assert.match((await response.json()).message, /Compte déjà actif/)
        assert.deepEqual(calls, [['https://identity.invalid/recover', 'owner@example.invalid']])
      } finally { globalThis.fetch = originalFetch; delete globalThis.__coprolinkAuditIdentity }
      as('owner')
      const data = await (await call('workspace')).json()
      assert.deepEqual(data.lots.map(l => [l.unitLabel, l.quarterlyCall, l.balance]), [['A', null, null]])
    })
    await t.test('inbound e-mails are routed on any To/Cc address of the inbound domain', async () => {
      const secret = 'whsec_' + Buffer.from('a secure test key with enough entropy').toString('base64')
      globalThis.Netlify.env.get = key => ({ RESEND_WEBHOOK_SECRET: secret, COPROLINK_INBOUND_DOMAIN: 'in.example.invalid' })[key]
      const send = async data => {
        const raw = JSON.stringify({ type: 'email.received', data })
        const id = `msg_${data.email_id}`; const now = new Date()
        const headers = { 'svix-id': id, 'svix-timestamp': String(Math.floor(now / 1000)), 'svix-signature': new Webhook(secret).sign(id, now, raw) }
        return handlers['inbound-email'](new Request('https://qa.invalid/api/inbound-email', { method: 'POST', headers, body: raw }))
      }
      try {
        const routed = await send({ email_id: 'route-1', from: 'Syndic <syndic@agence.invalid>', to: ['syndic@agence.invalid'], cc: ['QA <qa@in.example.invalid>'], subject: 'Devis' })
        assert.equal(routed.status, 200)
        assert.equal((await routed.json()).building, 'qa')
        // A local part equal to a building slug on a foreign domain must not route the e-mail there.
        assert.equal((await send({ email_id: 'route-2', from: 'x@y.invalid', to: ['other@agence.invalid'], subject: 'x' })).status, 422)
      } finally { globalThis.Netlify.env.get = () => undefined }
    })
    await t.test('an unsupported attachment is reported without blocking the others; a ticket note is never the raw body', async () => {
      as('manager')
      const { rows: [mail] } = await pg.query("INSERT INTO inbound_emails(building_id,provider_email_id,subject,text_body) VALUES (1,'attach-2','Devis','Corps complet confidentiel du prestataire') RETURNING id")
      await pg.exec("INSERT INTO tickets(reference,building_id,title,reporter_user_id) VALUES ('T-0002',1,'Fuite','tenant')")
      const originalFetch = globalThis.fetch
      globalThis.Netlify.env.get = key => key === 'RESEND_API_KEY' ? 'test-only' : undefined
      const stored = new Map()
      globalThis.__coprolinkAuditStore = { set: async (key, value) => { stored.set(key, value) }, delete: async key => { stored.delete(key) } }
      globalThis.fetch = async url => String(url).startsWith('https://api.resend.com/')
        ? Response.json({ data: [{ id: 'a1', filename: 'devis.pdf', size: 4, download_url: 'https://inbound-cdn.resend.com/a1' }, { id: 'a2', filename: 'logo.gif', size: 4, download_url: 'https://inbound-cdn.resend.com/a2' }], has_more: false })
        : new Response('%PDF')
      try {
        const response = await call('inbound-email', 'PATCH', { emailId: mail.id, action: 'classify_documents', files: ['devis.pdf', 'logo.gif'] })
        assert.equal(response.status, 201)
        const result = await response.json()
        assert.equal(result.documentIds.length, 1)
        assert.deepEqual(result.skipped.map(item => item.name), ['logo.gif'])
        // A failing download removes the files already written for this operation.
        globalThis.fetch = async url => String(url).startsWith('https://api.resend.com/')
          ? Response.json({ data: [{ id: 'b1', filename: 'a.pdf', size: 4, download_url: 'https://inbound-cdn.resend.com/b1' }, { id: 'b2', filename: 'b.pdf', size: 4, download_url: 'https://inbound-cdn.resend.com/b2' }], has_more: false })
          : String(url).endsWith('b2') ? new Response('', { status: 500 }) : new Response('%PDF')
        const before = stored.size
        const { rows: [other] } = await pg.query("INSERT INTO inbound_emails(building_id,provider_email_id,subject) VALUES (1,'attach-3','x') RETURNING id")
        assert.equal((await call('inbound-email', 'PATCH', { emailId: other.id, action: 'classify_documents', files: ['a.pdf', 'b.pdf'] })).status, 502)
        assert.equal(stored.size, before)
      } finally { globalThis.fetch = originalFetch; globalThis.Netlify.env.get = () => undefined }
      assert.equal((await call('inbound-email', 'PATCH', { emailId: mail.id, action: 'update_ticket', reference: 'T-0002' })).status, 200)
      const note = (await pg.query("SELECT note FROM ticket_updates u JOIN tickets t ON t.id=u.ticket_id WHERE t.reference='T-0002'")).rows[0].note
      assert.equal(note, 'Devis')
    })
    await t.test('scheduled history records the transition so every screen can show « Planifié »', async () => {
      as('manager')
      await call('tickets', 'PATCH', { status: 'scheduled', scheduledOn: '2999-01-02', scheduledTime: null }, { reference: 'T-0002' })
      const ticket = (await (await call('workspace')).json()).buildingTickets.find(item => item.reference === 'T-0002')
      assert.equal(ticket.status, 'scheduled')
      assert.equal(ticket.scheduledTime, '')
      assert.equal(ticket.timeline.at(-1).toStatus, 'scheduled')
      assert.match(ticket.nextStep, /02\/01\/2999/)
    })
    await t.test('a document is kept when its file cannot be erased', async () => {
      as('manager')
      const { rows: [doc] } = await pg.query("INSERT INTO documents(building_id,name,file_type,folder,access,storage_key) VALUES (1,'PV','PDF','AG','owners','buildings/1/pv.pdf') RETURNING id")
      globalThis.__coprolinkAuditStore = { delete: async () => { throw new Error('store down') } }
      assert.equal((await call('documents', 'DELETE', null, { id: String(doc.id) })).status, 502)
      assert.equal((await pg.query('SELECT count(*)::int AS count FROM documents WHERE id=$1', [doc.id])).rows[0].count, 1)
      globalThis.__coprolinkAuditStore = { delete: async () => {} }
      assert.equal((await call('documents', 'DELETE', null, { id: String(doc.id) })).status, 200)
      assert.equal((await pg.query('SELECT count(*)::int AS count FROM documents WHERE id=$1', [doc.id])).rows[0].count, 0)
    })
    await t.test('impossible agenda/AG dates return 422 and a past AG cannot be answered', async () => {
      as('manager')
      assert.equal((await call('events', 'POST', { title: 'Visite', eventDate: '2026-13-45' })).status, 422)
      assert.equal((await call('events', 'POST', { title: 'Visite', eventDate: '2999-01-01', eventTime: '25:00' })).status, 422)
      assert.equal((await call('assemblies', 'POST', { action: 'create_assembly', assemblyDate: 'nope' })).status, 422)
      const { rows: [past] } = await pg.query("INSERT INTO general_assemblies(building_id,title,assembly_date) VALUES (1,'AG 2020','2020-01-01') RETURNING id")
      as('neighbour')
      assert.equal((await call('assemblies', 'POST', { action: 'respond', assemblyId: past.id, responseType: 'present' })).status, 409)
    })
    await t.test('a shared address is refused before any Identity call and never breaks login', async () => {
      as('manager')
      await pg.exec("INSERT INTO building_people(building_id,email,full_name) VALUES (1,'couple@example.invalid','Jean'),(1,'couple@example.invalid','Marie')")
      await pg.exec("INSERT INTO unit_person_relations(unit_id,person_id,relation_type,start_date) SELECT 3,id,'occupant','2026-01-01' FROM building_people WHERE email='couple@example.invalid'")
      const { rows: [jean] } = await pg.query("SELECT id FROM building_people WHERE full_name='Jean' AND email='couple@example.invalid'")
      const response = await call('person-access', 'POST', { personId: jean.id })
      assert.equal(response.status, 409)
      assert.match((await response.json()).error, /Marie/)
      await pg.exec("INSERT INTO users(id,email,full_name) VALUES ('couple','couple@example.invalid','Jean'); INSERT INTO pending_members(building_id,email,role) VALUES (1,'couple@example.invalid','resident')")
      globalThis.__coprolinkAuditUser = { id: 'couple', email: 'couple@example.invalid', name: 'Jean', roles: [] }
      assert.equal((await call('workspace')).status, 200)
      assert.equal((await pg.query("SELECT count(*)::int AS count FROM building_people WHERE user_id='couple'")).rows[0].count, 1)
    })
    await t.test('queued notifications are cancelled once the last relation of a linked resident ended', async () => {
      as('manager')
      const vars = { CONTEXT: 'production', COPROLINK_NOTIFICATIONS_ENABLED: 'true', RESEND_API_KEY: 'fake', COPROLINK_EMAIL_FROM: 'qa@example.invalid', SITE_ID: 'local-qa' }
      globalThis.Netlify.env.get = key => vars[key]
      const originalFetch = globalThis.fetch
      const recipients = []
      globalThis.fetch = async (url, options) => { recipients.push(...JSON.parse(options.body).to); return Response.json({ id: `n-${recipients.length}` }) }
      try {
        await pg.exec("UPDATE notification_outbox SET status='sent'")
        assert.equal((await call('announcements', 'POST', { title: 'Travaux', body: 'Information' })).status, 201)
        // Relation ended directly in data (e.g. older closure) while the membership row stayed active.
        await pg.exec("UPDATE unit_person_relations SET end_date='2026-10-01', end_reason='sale' WHERE person_id=3")
        await handlers['notification-delivery']()
        assert.equal(recipients.includes('other@example.invalid'), false)
      } finally { globalThis.fetch = originalFetch; globalThis.Netlify.env.get = () => undefined }
    })
    await t.test('a non-syndic referent reads governance but every syndic write is refused', async () => {
      await pg.exec("INSERT INTO users(id,email,full_name) VALUES ('referent','referent@example.invalid','Ref'); INSERT INTO building_members(building_id,user_id,role) VALUES (1,'referent','resident')")
      const { rows: [person] } = await pg.query("INSERT INTO building_people(building_id,user_id,email,full_name) VALUES (1,'referent','referent@example.invalid','Ref') RETURNING id")
      await pg.query("INSERT INTO unit_person_relations(unit_id,person_id,relation_type,start_date) VALUES (2,$1,'tenant','2026-01-01')", [person.id])
      await pg.query('INSERT INTO building_referents(building_id,person_id) VALUES (1,$1)', [person.id])
      globalThis.__coprolinkAuditUser = { id: 'referent', email: 'referent@example.invalid', name: 'Ref', roles: [] }
      assert.equal((await call('building-model')).status, 200)
      assert.equal((await call('person-access')).status, 200)
      assert.equal((await call('assemblies')).status, 200)
      for (const [name, method, body] of [['building-model','POST',{ entity:'unit', label:'Z' }], ['person-access','POST',{ personId: person.id }], ['onboarding-import','POST',{ rows:[{ unitLabel:'Z', fullName:'X', relationPreset:'owner' }] }], ['assemblies','POST',{ action:'create_assembly', assemblyDate:'2999-01-01' }], ['finances','GET'], ['members','GET'], ['announcements','POST',{ title:'x', body:'y' }], ['notification-status','GET']]) {
        assert.equal((await call(name, method, body)).status, 403, `${method} ${name}`)
      }
      const workspace = await (await call('workspace')).json()
      assert.equal(workspace.lots.every(lot => !('balance' in lot)), true)
      assert.equal((await call('workspace', 'GET', null, {}, 'other')).status, 403)
    })
    await t.test('the hall terminal reads only public data of its own building', async () => {
      await pg.exec("INSERT INTO documents(building_id,name,file_type,folder,access,storage_key) VALUES (1,'Public','PDF','x','public','buildings/1/public.pdf'),(1,'Privé','PDF','x','private','buildings/1/private.pdf'),(1,'Propriétaires','PDF','x','owners','buildings/1/owners.pdf'),(2,'Autre ACP','PDF','x','public','buildings/2/public.pdf')")
      await pg.query("INSERT INTO terminals(building_id,label,token_hash) VALUES (1,'Hall',$1)", [createHash('sha256').update('hall-token').digest('hex')])
      globalThis.__coprolinkAuditUser = null
      globalThis.__coprolinkAuditStore = { get: async () => new Response('%PDF').body }
      const terminal = (name, params = {}, building = 'qa') => handlers[name](new Request(`https://qa.invalid/api/${name}?building=${building}`, { headers: { 'x-terminal-token': 'hall-token' } }), { params })
      const display = await terminal('display'); assert.equal(display.status, 200)
      const payload = JSON.stringify(await display.json())
      for (const secret of ['Privé', 'Propriétaires', 'Autre ACP', 'tenant@example.invalid', 'Corps complet']) assert.equal(payload.includes(secret), false, secret)
      assert.equal((await terminal('workspace')).status, 403)
      const ids = (await pg.query("SELECT id, name FROM documents WHERE name IN ('Public','Privé','Propriétaires','Autre ACP') ORDER BY id")).rows
      const statuses = await Promise.all(ids.map(async doc => [doc.name, (await terminal('documents', { id: String(doc.id) }, 'other')).status]))
      assert.deepEqual(statuses, [['Public', 200], ['Privé', 404], ['Propriétaires', 404], ['Autre ACP', 404]])
    })
    await t.test('syndic replacement keeps the ACP memory and removes the former syndic', async () => {
      as('manager')
      const before = (await pg.query('SELECT (SELECT count(*) FROM audit_log)::int AS audit, (SELECT count(*) FROM tickets)::int AS tickets, (SELECT count(*) FROM documents)::int AS docs')).rows[0]
      await pg.exec("INSERT INTO users(id,email,full_name) VALUES ('new-syndic','new@example.invalid','Nouveau syndic'); INSERT INTO building_members(building_id,user_id,role) VALUES (1,'new-syndic','manager')")
      const { rows: [old] } = await pg.query("SELECT id FROM building_members WHERE user_id='manager' AND building_id=1")
      globalThis.__coprolinkAuditUser = { id: 'new-syndic', email: 'new@example.invalid', name: 'Nouveau', roles: [] }
      assert.equal((await call('members', 'DELETE', null, { id: String(old.id) })).status, 200)
      const { rows: [self] } = await pg.query("SELECT id FROM building_members WHERE user_id='new-syndic'")
      assert.equal((await call('members', 'DELETE', null, { id: String(self.id) })).status, 409)
      as('manager')
      assert.equal((await call('workspace')).status, 403)
      const after = (await pg.query('SELECT (SELECT count(*) FROM audit_log)::int AS audit, (SELECT count(*) FROM tickets)::int AS tickets, (SELECT count(*) FROM documents)::int AS docs')).rows[0]
      assert.deepEqual([after.tickets, after.docs], [before.tickets, before.docs])
      assert.ok(after.audit > before.audit)
      globalThis.__coprolinkAuditUser = { id: 'new-syndic', email: 'new@example.invalid', name: 'Nouveau', roles: [] }
      const workspace = await (await call('workspace')).json()
      assert.equal(workspace.activity.length > 0, true)
      assert.ok((await pg.query("SELECT count(*)::int AS count FROM audit_log WHERE building_id=1 AND actor_user_id='manager'")).rows[0].count > 0)
    })
  } finally {
    await pg.close()
    delete globalThis.__coprolinkAuditDb
    delete globalThis.__coprolinkAuditUser
    delete globalThis.Netlify
  }
})
