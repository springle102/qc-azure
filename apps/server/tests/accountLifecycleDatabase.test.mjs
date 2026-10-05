import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const connectionString = process.env.TEST_ACCOUNT_LIFECYCLE_DATABASE_URL;
test('profile reuse trigger and guarded duplicate repair on disposable PostgreSQL', { skip: !connectionString }, async (t) => {
  const target = new URL(connectionString);
  assert.equal(target.hostname, '127.0.0.1');
  assert.match(target.pathname, /^\/qc_account_lifecycle_test$/);
  const pool = new pg.Pool({ connectionString });
  const db = await pool.connect();
  t.after(async () => { db.release(); await pool.end(); });
  await db.query(`
    CREATE TABLE IF NOT EXISTS "Freelancer" ("fIld" integer PRIMARY KEY, name text, email text, field text, fields text[], "imageQR" text, note text, salary numeric);
    CREATE TABLE IF NOT EXISTS "Accounts" (id integer PRIMARY KEY, role text, roles text[], "displayName" text, email text, field text, fields text[], "freelancerId" integer REFERENCES "Freelancer"("fIld") ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS "SeriesList" (id integer PRIMARY KEY, "fIld" integer REFERENCES "Freelancer"("fIld"), price numeric, "paymentApproved" boolean);
    CREATE TABLE IF NOT EXISTS "DeadlineRegistrations" (id integer PRIMARY KEY, "fIld" integer REFERENCES "Freelancer"("fIld") ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS "Errors" (id integer PRIMARY KEY, "editorFreelancerId" integer REFERENCES "Freelancer"("fIld") ON DELETE SET NULL);
  `);
  const migration = readFileSync(new URL('../../../docs/migrations/20261005_reuse_account_freelancer.sql', import.meta.url), 'utf8');
  const repair = readFileSync(new URL('../../../docs/repairs/20261005_remove_unused_freelancer_15.sql', import.meta.url), 'utf8');
  await db.query(migration);
  await db.query(migration);
  const reset = () => db.query('TRUNCATE "Errors", "DeadlineRegistrations", "SeriesList", "Accounts", "Freelancer"');
  const profile = (id, email = 'person@example.test') => db.query('INSERT INTO "Freelancer" ("fIld", name, email, field, fields) VALUES ($1, $2, $3, $4, $5)', [id, 'Fixture Person', email, 'Latin', ['Latin']]);
  const account = (id, email = 'person@example.test', freelancerId = null) => db.query('INSERT INTO "Accounts" (id, role, roles, "displayName", email, field, fields, "freelancerId") VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING "freelancerId"', [id, 'Freelancer', ['Freelancer'], 'Fixture Person', email, 'Latin', ['Latin'], freelancerId]);

  await t.test('SQL account recreation retains profile, QR and task earnings', async () => {
    await reset(); await profile(15);
    await db.query('UPDATE "Freelancer" SET "imageQR" = $1 WHERE "fIld" = 15', ['fixture-qr']);
    await db.query('INSERT INTO "SeriesList" VALUES (1, 15, 900000, true)');
    assert.equal((await account(25, ' PERSON@example.test ')).rows[0].freelancerId, 15);
    await db.query('DELETE FROM "Accounts" WHERE id = 25');
    assert.equal((await account(26)).rows[0].freelancerId, 15);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Freelancer"')).rows[0].n, 1);
    assert.equal((await db.query('SELECT "imageQR" FROM "Freelancer"')).rows[0].imageQR, 'fixture-qr');
    assert.equal((await db.query('SELECT price FROM "SeriesList" WHERE "fIld" = 15')).rows[0].price, '900000');
  });
  await t.test('same name with a different email creates a separate profile', async () => {
    await reset(); await profile(15);
    assert.equal((await account(25, 'other@example.test')).rows[0].freelancerId, 16);
  });
  await t.test('ambiguous email and an already linked email stop instead of making duplicates', async () => {
    await reset(); await profile(15); await profile(20);
    await assert.rejects(() => account(25), /nhiều hồ sơ/);
    await account(25, 'person@example.test', 20);
    await assert.rejects(() => account(26), /account khác/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Freelancer"')).rows[0].n, 2);
  });
  await t.test('repair removes only unused 15 and preserves account/tasks/salary on 20; reapplication is safe', async () => {
    await reset(); await profile(15); await profile(20); await account(25, 'person@example.test', 20);
    await db.query('INSERT INTO "SeriesList" VALUES (1, 20, 900000, true)');
    await db.query(repair); await db.query(repair);
    assert.deepEqual((await db.query('SELECT "fIld" FROM "Freelancer"')).rows, [{ fIld: 20 }]);
    assert.equal((await db.query('SELECT "freelancerId" FROM "Accounts"')).rows[0].freelancerId, 20);
    assert.equal((await db.query('SELECT price FROM "SeriesList"')).rows[0].price, '900000');
  });
  await t.test('repair refuses to remove 15 if any task still belongs to 15', async () => {
    await reset(); await profile(15); await profile(20); await account(25, 'person@example.test', 20);
    await db.query('INSERT INTO "SeriesList" VALUES (1, 15, 900000, true)');
    await assert.rejects(() => db.query(repair), /has references/);
    await db.query('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "Freelancer"')).rows[0].n, 2);
    assert.equal((await db.query('SELECT "fIld" FROM "SeriesList"')).rows[0].fIld, 15);
  });
});
