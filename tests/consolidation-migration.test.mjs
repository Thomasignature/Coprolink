import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('preview 23 snapshot alignment applies after existing integration migrations without changing data', async () => {
  const pg = new PGlite()
  const root = 'netlify/database/migrations'
  const alignment = '20261028130000_align_core_snapshot'
  try {
    for (const name of (await readdir(root)).sort()) {
      if (name === alignment) continue
      await pg.exec(await readFile(`${root}/${name}/migration.sql`, 'utf8'))
    }
    await pg.exec("INSERT INTO buildings(slug,name) VALUES ('qa-consolidation','ACP conservée')")
    const before = await pg.query('SELECT id,slug,name FROM buildings ORDER BY id')
    const migration = await readFile(`${root}/${alignment}/migration.sql`, 'utf8')
    await pg.exec(migration)
    await pg.exec(migration) // idempotent when the target objects already exist
    const after = await pg.query('SELECT id,slug,name FROM buildings ORDER BY id')
    assert.deepEqual(after.rows, before.rows)
    const columns = await pg.query("SELECT column_name FROM information_schema.columns WHERE table_name='tickets' AND column_name IN ('scheduled_on','scheduled_time') ORDER BY column_name")
    assert.deepEqual(columns.rows.map(row => row.column_name), ['scheduled_on','scheduled_time'])
  } finally { await pg.close() }
})
