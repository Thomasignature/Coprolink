import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const applyMigration = async (db, path) => {
  const sql = await readFile(new URL(path, import.meta.url), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) await db.exec(statement)
}

test('la migration conserve une période terminée et autorise une nouvelle période active', async () => {
  const db = new PGlite()
  await db.exec(`
    CREATE TABLE building_members (
      id serial PRIMARY KEY, building_id integer NOT NULL, user_id text NOT NULL,
      role text NOT NULL DEFAULT 'resident', created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX building_members_building_user_idx ON building_members (building_id, user_id);
    INSERT INTO building_members (building_id, user_id, role) VALUES (1, 'user-a', 'resident');
  `)
  await applyMigration(db, '../netlify/database/migrations/20261002193000_preserve_ended_memberships/migration.sql')
  await db.exec("UPDATE building_members SET ended_at = '2026-09-30T10:15:00Z', end_reason = 'Vente' WHERE id = 1")
  await applyMigration(db, '../netlify/database/migrations/20261002210000_membership_periods/migration.sql')

  await db.exec("INSERT INTO building_members (building_id, user_id, role) VALUES (1, 'user-a', 'resident')")
  await assert.rejects(
    db.exec("INSERT INTO building_members (building_id, user_id, role) VALUES (1, 'user-a', 'manager')"),
    /unique|duplicate/i,
  )
  const result = await db.query("SELECT id, ended_on, end_reason, revoked_at FROM building_members WHERE building_id = 1 AND user_id = 'user-a' ORDER BY id")
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].end_reason, 'Vente')
  assert.equal(new Date(result.rows[0].ended_on).toISOString().slice(0, 10), '2026-09-30')
  assert.ok(result.rows[0].revoked_at)
  assert.equal(result.rows[1].revoked_at, null)
  await db.close()
})
