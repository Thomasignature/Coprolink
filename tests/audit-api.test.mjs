import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'

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
      : 'export const getUser=async()=>globalThis.__coprolinkAuditUser; export const admin={}; export const getIdentityConfig=()=>({});', loader: 'js' }))
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
    for (const name of ['workspace', 'building-model', 'person-access', 'finances', 'members', 'tickets', 'inbound-email', 'onboarding-import', 'notification-status', 'announcements', 'notification-delivery']) {
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
  } finally {
    await pg.close()
    delete globalThis.__coprolinkAuditDb
    delete globalThis.__coprolinkAuditUser
    delete globalThis.Netlify
  }
})
