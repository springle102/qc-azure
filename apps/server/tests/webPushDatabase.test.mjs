import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createECDH, randomBytes, scryptSync } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import webPush from 'web-push';
import { pushSubscriptionId } from '../webPush.mjs';

const connectionString = process.env.TEST_WEB_PUSH_DATABASE_URL;
test('Web Push migration, consent ownership, atomic claims and authenticated APIs on disposable PostgreSQL', { skip: !connectionString }, async (t) => {
  const target = new URL(connectionString);
  assert.equal(target.hostname, '127.0.0.1');
  assert.match(target.pathname, /^\/qc_web_push_test/);
  const db = new pg.Pool({ connectionString });
  t.after(() => db.end());
  await db.query(readFileSync(new URL('../../../docs/migrations/20261005_web_push.sql', import.meta.url), 'utf8'));
  // Migration is safe to reapply, including the stored function and grants.
  await db.query(readFileSync(new URL('../../../docs/migrations/20261005_web_push.sql', import.meta.url), 'utf8'));
  await db.query('TRUNCATE public."WebPushSubscriptions" CASCADE');
  const call = async (action, data = {}) => (await db.query('SELECT public.web_push_store($1, $2::jsonb) AS result', [action, JSON.stringify(data)])).rows[0].result;
  assert.deepEqual(await call('capabilities'), { version: 1 });
  const device = createECDH('prime256v1'); device.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/unit-test-device', keys: { p256dh: device.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  const subscriptionId = pushSubscriptionId(subscription);
  await call('subscribe', { subscriptionId, accountId: '101', subscription });

  await t.test('only the owning account can remove a subscription; transfer needs matching device keys', async () => {
    await call('remove', { subscriptionId, accountId: '102' });
    assert.ok(await call('get', { subscriptionId, accountId: '101' }));
    await assert.rejects(() => call('subscribe', { subscriptionId, accountId: '102', subscription: { ...subscription, keys: { ...subscription.keys, auth: 'different' } } }));
    await call('subscribe', { subscriptionId, accountId: '102', subscription });
    assert.equal(await call('get', { subscriptionId, accountId: '101' }), null);
    await call('subscribe', { subscriptionId, accountId: '101', subscription });
  });

  await t.test('replicas cannot claim the same notification or recover an ambiguous send', async () => {
    const values = { deliveryKey: 'notification-1', subscriptionId, accountId: '101' };
    const claims = await Promise.all(Array.from({ length: 12 }, () => call('claim', { ...values, leaseToken: randomUUID() })));
    assert.equal(claims.filter(Boolean).length, 1);
    const claimed = claims.find(Boolean);
    await call('finish', { deliveryKey: values.deliveryKey, leaseToken: randomUUID(), status: 'sent' });
    assert.equal((await db.query('SELECT status FROM public."WebPushDeliveries" WHERE "deliveryKey" = $1', [values.deliveryKey])).rows[0].status, 'processing');
    await db.query('UPDATE public."WebPushDeliveries" SET "leaseUntil" = now() - interval \'1 hour\'');
    assert.equal(await call('claim', { ...values, leaseToken: randomUUID() }), null);
    await call('finish', { deliveryKey: values.deliveryKey, leaseToken: claimed.leaseToken, status: 'retry' });
    assert.equal(await call('claim', { ...values, leaseToken: randomUUID() }), null);
    await db.query('UPDATE public."WebPushDeliveries" SET "nextAttemptAt" = now() - interval \'1 hour\'');
    assert.ok(await call('claim', { ...values, leaseToken: randomUUID() }));
  });

  const salt = randomBytes(16).toString('hex');
  const password = 'fixture-password-only';
  const passwordHash = scryptSync(password, salt, 64).toString('hex');
  await db.query(`
    CREATE TABLE IF NOT EXISTS public."Accounts" (id integer PRIMARY KEY, username text, "passwordHash" text, "passwordSalt" text, role text, roles jsonb, "displayName" text, email text, "freelancerId" integer, "isActive" boolean);
    CREATE TABLE IF NOT EXISTS public."Freelancer" ("fIld" integer PRIMARY KEY, name text, email text, field text);
    CREATE TABLE IF NOT EXISTS public."SeriesList" ("seriesId" integer, "chapterNumber" text, "seriesName" text, "fIld" integer, "endTask" timestamptz, status text, "submittedAt" timestamptz);
  `);
  await db.query('INSERT INTO public."Accounts" (id, username, "passwordHash", "passwordSalt", role, roles, "displayName", "isActive") VALUES (101, $1, $2, $3, \'Freelancer\', \'["Freelancer"]\', \'Push Fixture\', true) ON CONFLICT (id) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "passwordSalt" = EXCLUDED."passwordSalt"', ['push-fixture', passwordHash, salt]);

  // Reserve a local port without touching the running application's port.
  const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
  const port = portProbe.address().port; await new Promise((resolve) => portProbe.close(resolve));
  const vapid = webPush.generateVAPIDKeys();
  const child = spawn(process.execPath, ['apps/server/server.js'], {
    cwd: new URL('../../../', import.meta.url), windowsHide: true,
    env: { ...process.env, PORT: String(port), DATABASE_URL: connectionString, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: vapid.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: vapid.privateKey, WEB_PUSH_VAPID_SUBJECT: 'mailto:test@example.com', APP_PUBLIC_URL: 'https://example.com/' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const base = `http://127.0.0.1:${port}/api`;
  let started = false;
  for (let i = 0; i < 100; i += 1) {
    try { started = (await fetch(`${base}/health`)).ok; } catch { /* Wait for the isolated backend. */ }
    if (started) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(started, output);
  assert.equal((await fetch(`${base}/push/config`)).status, 401);
  assert.equal((await fetch(`${base}/push/subscriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription }) })).status, 401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'push-fixture', password }) });
  assert.equal(login.status, 200);
  const session = (await login.json()).data;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` };
  const settings = (await (await fetch(`${base}/push/config`, { headers })).json()).data;
  assert.deepEqual(settings, { ready: true, publicKey: vapid.publicKey });
  const saved = await fetch(`${base}/push/subscriptions`, { method: 'POST', headers, body: JSON.stringify({ accountId: '102', subscription }) });
  assert.equal(saved.status, 200);
  assert.ok(await call('get', { subscriptionId, accountId: '101' }));
  assert.equal(await call('get', { subscriptionId, accountId: '102' }), null);
  const invalid = await fetch(`${base}/push/subscriptions`, { method: 'POST', headers, body: JSON.stringify({ subscription: { ...subscription, endpoint: 'https://127.0.0.1/admin' } }) });
  assert.equal(invalid.status, 400);
  const removed = await fetch(`${base}/push/subscriptions`, { method: 'DELETE', headers, body: JSON.stringify({ subscription }) });
  assert.equal(removed.status, 200);
  assert.equal(await call('get', { subscriptionId, accountId: '101' }), null);
  assert.equal((await db.query('SELECT count(*)::integer AS total FROM public."WebPushDeliveries"')).rows[0].total, 0);
});
