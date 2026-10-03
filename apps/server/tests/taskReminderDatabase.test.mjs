import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { reminderIdentity } from '../taskReminderEmail.mjs';

// Opt-in only: the test creates fixture tables in a disposable localhost DB.
const connectionString = process.env.TEST_REMINDER_DATABASE_URL;

test('database migration, atomic claims, REST RPC and Admin API on an isolated PostgreSQL database', { skip: !connectionString }, async (t) => {
  const target = new URL(connectionString);
  assert.equal(target.hostname, '127.0.0.1');
  assert.match(target.pathname, /^\/qc_reminder_test/);
  const db = new pg.Pool({ connectionString });
  t.after(() => db.end());
  await db.query(`
    CREATE TABLE IF NOT EXISTS public."GeneralSettings" (id integer PRIMARY KEY);
    INSERT INTO public."GeneralSettings" (id) VALUES (1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS public."Accounts" (id integer PRIMARY KEY, username text, "passwordHash" text, "passwordSalt" text, role text, roles jsonb, "displayName" text, email text, "freelancerId" integer, "isActive" boolean);
    CREATE TABLE IF NOT EXISTS public."Freelancer" ("fIld" integer PRIMARY KEY, name text, email text, field text);
    CREATE TABLE IF NOT EXISTS public."SeriesList" ("seriesId" integer, "chapterNumber" text, "seriesName" text, type text, "fIld" integer, "endTask" timestamptz, status text, "submittedAt" timestamptz, PRIMARY KEY ("seriesId", "chapterNumber"));
    CREATE TABLE IF NOT EXISTS public."Fields" (id integer, name text);
    CREATE TABLE IF NOT EXISTS public."DifficultyLevels" (id integer, field text, name text);
    CREATE TABLE IF NOT EXISTS public."DifficultyPricing" (id integer, field text, difficulty text, price numeric);
    CREATE TABLE IF NOT EXISTS public."QC" ("qcId" integer, name text);
    CREATE TABLE IF NOT EXISTS public."Errors" (id integer, field text);
  `);
  const migration = readFileSync(new URL('../../../docs/migrations/20261003_task_reminders.sql', import.meta.url), 'utf8');
  await db.query(migration);
  await db.query(migration); // repeatable migration
  const gmailMigration = readFileSync(new URL('../../../docs/migrations/20261003_gmail_reminders.sql', import.meta.url), 'utf8');
  await db.query(gmailMigration);
  await db.query(gmailMigration);
  await db.query('TRUNCATE public."TaskReminderDeliveries"');
  const call = async (action, data = {}) => (await db.query('SELECT public.task_reminder_store($1, $2::jsonb) AS result', [action, JSON.stringify(data)])).rows[0].result;
  const identity = reminderIdentity({ seriesId: 42, chapterNumber: '1A', fIld: 9, endTask: '2026-10-05' }, '24h');
  const record = { ...identity, email: 'an@example.com', payload: { subject: 'fixture', text: 'test only' }, status: 'pending' };

  await t.test('one durable record and one lease across concurrent workers', async () => {
    await Promise.all([call('enqueue', { records: [record] }), call('enqueue', { records: [record] })]);
    const results = await Promise.all(Array.from({ length: 8 }, () => call('claim', { deliveryKey: identity.deliveryKey, leaseToken: randomUUID() })));
    const claims = results.filter(Boolean);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].attemptCount, 1);
    assert.equal(await call('finish', { deliveryKey: identity.deliveryKey, leaseToken: randomUUID(), status: 'sent' }), null);
    const sent = await call('finish', { deliveryKey: identity.deliveryKey, leaseToken: claims[0].leaseToken, status: 'sent', providerMessageId: 'test-mail' });
    assert.equal(sent.status, 'sent');
    assert.equal(await call('claim', { deliveryKey: identity.deliveryKey, leaseToken: randomUUID() }), null);
    const list = await call('list', { limit: 1, offset: 0 });
    assert.equal(list.total, 1);
    assert.equal(list.items.length, 1);
    assert.ok(!('payload' in list.items[0]));
    assert.ok(!('leaseToken' in list.items[0]));
    assert.equal((await call('list', { limit: 1, offset: 1 })).items.length, 0);
  });

  await t.test('expired leases recover and uncertain results older than 24h stop safely', async () => {
    const next = { ...record, ...reminderIdentity({ seriesId: 42, chapterNumber: '2', fIld: 9, endTask: '2026-10-05' }, 'overdue') };
    await call('enqueue', { records: [next] });
    const old = await call('claim', { deliveryKey: next.deliveryKey, leaseToken: randomUUID() });
    await db.query('UPDATE public."TaskReminderDeliveries" SET "leaseUntil" = now() - interval \'1 second\' WHERE "deliveryKey" = $1', [next.deliveryKey]);
    const recovered = await call('claim', { deliveryKey: next.deliveryKey, leaseToken: randomUUID() });
    assert.equal(recovered.attemptCount, 2);
    assert.notEqual(old.leaseToken, recovered.leaseToken);
    assert.deepEqual(old.payload, recovered.payload);
    await db.query('UPDATE public."TaskReminderDeliveries" SET "leaseUntil" = now() - interval \'1 second\', "firstAttemptAt" = now() - interval \'25 hours\' WHERE "deliveryKey" = $1', [next.deliveryKey]);
    assert.equal(await call('claim', { deliveryKey: next.deliveryKey, leaseToken: randomUUID() }), null);
    const row = (await db.query('SELECT status FROM public."TaskReminderDeliveries" WHERE "deliveryKey" = $1', [next.deliveryKey])).rows[0];
    assert.equal(row.status, 'needs_review');
  });

  await t.test('skipped missing emails can be corrected only before any attempt', async () => {
    const next = { ...record, ...reminderIdentity({ seriesId: 42, chapterNumber: '3', fIld: 9, endTask: '2026-10-05' }, '3h') };
    await call('enqueue', { records: [{ ...next, email: '', payload: null, status: 'skipped' }] });
    await call('enqueue', { records: [next] });
    assert.equal((await call('claim', { deliveryKey: next.deliveryKey, leaseToken: randomUUID() })).email, 'an@example.com');
    await db.query('UPDATE public."TaskReminderDeliveries" SET status = \'skipped\', "leaseUntil" = NULL WHERE "deliveryKey" = $1', [next.deliveryKey]);
    await call('enqueue', { records: [next] });
    assert.equal(await call('claim', { deliveryKey: next.deliveryKey, leaseToken: randomUUID() }), null);
  });

  await t.test('PostgreSQL adapter and PostgREST RPC adapter share the tested function', async () => {
    process.env.DATABASE_URL = connectionString;
    const postgres = await import('../supabaseRepository.js?reminder-postgres-test');
    assert.equal((await postgres.taskReminderStore('list', { limit: 1 })).total, 3);
    const rows = await postgres.selectRows('generalSettings');
    assert.equal(rows[0].taskRemindersEnabled, false);
    await db.query('UPDATE public."GeneralSettings" SET "taskRemindersEnabled" = true');
    assert.equal((await postgres.selectRows('generalSettings', { fresh: true }))[0].taskRemindersEnabled, true);
    await db.query('UPDATE public."GeneralSettings" SET "taskRemindersEnabled" = false');

    let wire;
    let updatedEmail = 'old@example.com';
    const rpc = createServer(async (req, res) => {
      try {
        assert.equal(req.headers.apikey, 'test-service-role');
        if (req.url.startsWith('/rest/v1/Freelancer?')) {
          const start = Number(req.headers.range.split('-')[0]);
          const length = Math.min(500, 1503 - start);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Range', `${start}-${start + length - 1}/1503`);
          res.end(JSON.stringify(Array.from({ length }, (_, index) => ({ fIld: start + index, email: updatedEmail }))));
          return;
        }
        assert.equal(req.url, '/rest/v1/rpc/task_reminder_store');
        let body = '';
        for await (const chunk of req) body += chunk;
        wire = JSON.parse(body);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(await call(wire.p_action, wire.p_data)));
      } catch (error) { res.writeHead(500); res.end(error.message); }
    });
    rpc.listen(0, '127.0.0.1');
    await once(rpc, 'listening');
    t.after(() => new Promise((resolve) => rpc.close(resolve)));
    process.env.DATABASE_URL = '';
    process.env.SUPABASE_URL = `http://127.0.0.1:${rpc.address().port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    const rest = await import('../supabaseRepository.js?reminder-rest-test');
    const people = await rest.selectRows('freelancers', { fresh: true });
    assert.equal(people.length, 1503, 'fresh scans paginate beyond configured PostgREST row limits');
    updatedEmail = 'new@example.com';
    assert.equal((await rest.selectRows('freelancers', { fresh: true }))[0].email, updatedEmail, 'fresh final checks bypass cached profiles');
    const list = await rest.taskReminderStore('list', { limit: 1, offset: 1 });
    assert.equal(list.total, 3);
    assert.equal(list.items.length, 1);
    assert.deepEqual(wire, { p_action: 'list', p_data: { limit: 1, offset: 1 } });
    const next = { ...record, ...reminderIdentity({ seriesId: 43, chapterNumber: 'RPC', fIld: 9, endTask: '2026-10-05' }, '6h') };
    await rest.taskReminderStore('enqueue', { records: [next] });
    const token = randomUUID();
    const claimed = await rest.taskReminderStore('claim', { deliveryKey: next.deliveryKey, leaseToken: token });
    assert.equal(claimed.attemptCount, 1);
    await rest.taskReminderStore('finish', { deliveryKey: next.deliveryKey, leaseToken: token, status: 'cancelled' });
    assert.equal((await rest.taskReminderStore('capabilities')).providerSafetyVersion, 1);
    const gmail = { ...next, provider: 'gmail', ...reminderIdentity({ seriesId: 43, chapterNumber: 'RPC-GMAIL', fIld: 9, endTask: '2026-10-05' }, 'overdue') };
    await rest.taskReminderStore('enqueue', { records: [gmail] });
    await rest.taskReminderStore('claim', { deliveryKey: gmail.deliveryKey, leaseToken: randomUUID() });
    await db.query('UPDATE public."TaskReminderDeliveries" SET "leaseUntil" = now() - interval \'1 second\' WHERE "deliveryKey" = $1', [gmail.deliveryKey]);
    assert.equal(await rest.taskReminderStore('claim', { deliveryKey: gmail.deliveryKey, leaseToken: randomUUID() }), null);
    assert.equal((await db.query('SELECT status FROM public."TaskReminderDeliveries" WHERE "deliveryKey" = $1', [gmail.deliveryKey])).rows[0].status, 'needs_review');
  });

  await t.test('live API requires Admin and refuses activation without mail configuration', async () => {
    const salt = 'test-salt';
    const password = 'reminder-test-only';
    const hash = scryptSync(password, salt, 64).toString('hex');
    for (const [id, role] of [[1, 'Admin'], [2, 'Freelancer'], [3, 'QC']]) {
      await db.query('INSERT INTO public."Accounts" (id, username, "passwordHash", "passwordSalt", role, roles, "displayName", "isActive") VALUES ($1,$2,$3,$4,$5,$6,$2,true) ON CONFLICT (id) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "passwordSalt" = EXCLUDED."passwordSalt"', [id, `reminder-${role.toLowerCase()}`, hash, salt, role, JSON.stringify([role])]);
    }
    const processEnv = { ...process.env, MAIL_PROVIDER: 'gmail', GMAIL_CLIENT_ID: '', GMAIL_CLIENT_SECRET: '', GMAIL_REFRESH_TOKEN: '', GMAIL_SENDER_EMAIL: '', DATABASE_URL: connectionString, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: '', RESEND_API_KEY: '', RESEND_FROM: '', APP_PUBLIC_URL: '', PORT: '55484' };
    const server = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: processEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    server.stdout.on('data', (chunk) => { logs += chunk; });
    server.stderr.on('data', (chunk) => { logs += chunk; });
    t.after(() => { server.kill(); });
    const base = 'http://127.0.0.1:55484/api';
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      ready = await fetch(`${base}/health`).then((response) => response.ok).catch(() => false);
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, logs);
    assert.equal((await fetch(`${base}/task-reminders`)).status, 401);
    for (const role of ['admin', 'freelancer', 'qc']) {
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `reminder-${role}`, password }) });
      const body = await login.json();
      assert.equal(login.status, 200, JSON.stringify(body));
      const headers = { Authorization: `Bearer ${body.data.token}`, 'Content-Type': 'application/json' };
      assert.equal((await fetch(`${base}/task-reminders`, { headers })).status, role === 'admin' ? 200 : 403);
      if (role === 'admin') {
        assert.equal((await fetch(`${base}/task-reminders?limit=0`, { headers })).status, 400);
        const settings = await (await fetch(`${base}/general-settings`, { headers })).json();
        assert.equal(settings.data.taskReminderConfiguration.ready, false);
        const activate = await fetch(`${base}/general-settings`, { method: 'PATCH', headers, body: JSON.stringify({ taskRemindersEnabled: true }) });
        assert.equal(activate.status, 503);
        assert.equal((await db.query('SELECT "taskRemindersEnabled" FROM public."GeneralSettings"')).rows[0].taskRemindersEnabled, false);
      }
    }
  });

  await t.test('configured Admin can enable and disable reminders without sending real email', async () => {
    await db.query('UPDATE public."Accounts" SET email = $1 WHERE id = 1', ['otp-fixture@example.com']);
    const bootstrap = `import assert from 'node:assert/strict';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (url, options) => String(url).startsWith('https://oauth2.googleapis.com/')
        ? Promise.resolve(new Response(JSON.stringify({ access_token: 'test-access-only', expires_in: 3600 }), { status: 200 }))
        : String(url).startsWith('https://gmail.googleapis.com/')
        ? (() => {
            assert.equal(String(url), 'https://gmail.googleapis.com/gmail/v1/users/test%40gmail.com/messages/send');
            assert.equal(options.headers.Authorization, 'Bearer test-access-only');
            const mime = Buffer.from(JSON.parse(options.body).raw, 'base64url').toString('utf8');
            assert.ok(mime.includes('To: otp-fixture@example.com'));
            assert.ok(mime.includes('Content-Type: text/html; charset=UTF-8'));
            return Promise.resolve(new Response(JSON.stringify({ id: 'test-provider-only' }), { status: 200 }));
          })()
        : originalFetch(url, options);
      await import('./server.js');`;
    const server = spawn(process.execPath, ['--input-type=module', '-e', bootstrap], {
      cwd: new URL('..', import.meta.url), windowsHide: true, stdio: 'ignore',
      env: { ...process.env, DATABASE_URL: connectionString, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: '',
        MAIL_PROVIDER: 'gmail', GMAIL_CLIENT_ID: 'test-client-only', GMAIL_CLIENT_SECRET: 'test-secret-only', GMAIL_REFRESH_TOKEN: 'test-refresh-only', GMAIL_SENDER_EMAIL: 'test@gmail.com', APP_PUBLIC_URL: 'https://example.com/', PORT: '55486' }
    });
    t.after(() => { server.kill(); });
    const base = 'http://127.0.0.1:55486/api';
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      ready = await fetch(`${base}/health`).then((response) => response.ok).catch(() => false);
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready);
    const login = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'reminder-admin', password: 'reminder-test-only' }) })).json();
    const headers = { Authorization: `Bearer ${login.data.token}`, 'Content-Type': 'application/json' };
    const settings = await (await fetch(`${base}/general-settings`, { headers })).json();
    assert.equal(settings.data.taskReminderConfiguration.ready, true);
    assert.ok(!JSON.stringify(settings).includes('test-provider-only'));
    for (const secret of ['test-client-only', 'test-secret-only', 'test-refresh-only']) assert.ok(!JSON.stringify(settings).includes(secret));
    for (const enabled of [true, false]) {
      const response = await fetch(`${base}/general-settings`, { method: 'PATCH', headers, body: JSON.stringify({ taskRemindersEnabled: enabled }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.taskRemindersEnabled, enabled);
      assert.equal((await db.query('SELECT "taskRemindersEnabled" FROM public."GeneralSettings"')).rows[0].taskRemindersEnabled, enabled);
    }
    assert.equal((await fetch(`${base}/general-settings`, { method: 'PATCH', headers, body: JSON.stringify({ taskRemindersEnabled: 'true' }) })).status, 400);
    const otp = await fetch(`${base}/auth/forgot-password/request-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'reminder-admin' }) });
    const result = await otp.json();
    assert.equal(otp.status, 200, JSON.stringify(result));
    assert.ok(result.data.challengeId);
    assert.equal(result.data.expiresInSeconds, 600);
  });

  await t.test('Gmail crashes stop for review while confirmed rate limits can retry in PostgreSQL', async () => {
    assert.equal((await call('capabilities')).providerSafetyVersion, 1);
    for (const mode of ['processing', 'retry', 'uncertain']) {
      const next = { ...record, provider: 'gmail', ...reminderIdentity({ seriesId: 44, chapterNumber: mode, fIld: 9, endTask: '2026-10-05' }, 'overdue') };
      await call('enqueue', { records: [next] });
      const claimed = await call('claim', { deliveryKey: next.deliveryKey, leaseToken: randomUUID() });
      assert.equal(claimed.provider, 'gmail');
      if (mode !== 'processing') await call('finish', { deliveryKey: next.deliveryKey, leaseToken: claimed.leaseToken, status: 'retry', uncertain: mode === 'uncertain' });
      await db.query('UPDATE public."TaskReminderDeliveries" SET "leaseUntil" = now() - interval \'1 second\' WHERE "deliveryKey" = $1', [next.deliveryKey]);
      const recovered = await call('claim', { deliveryKey: next.deliveryKey, leaseToken: randomUUID() });
      assert.equal(Boolean(recovered), mode === 'retry');
      const row = (await db.query('SELECT status FROM public."TaskReminderDeliveries" WHERE "deliveryKey" = $1', [next.deliveryKey])).rows[0];
      assert.equal(row.status, mode === 'retry' ? 'processing' : 'needs_review');
    }
  });
});
