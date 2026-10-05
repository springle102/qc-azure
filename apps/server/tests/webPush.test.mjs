import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import webPush from 'web-push';
import { buildDeadlinePush, createWebPushWorker, getWebPushConfig, pushSubscriptionId, validatePushSubscription } from '../webPush.mjs';
import { reminderDueAt } from '../taskReminderEmail.mjs';

const keys = webPush.generateVAPIDKeys();
const config = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:test@example.com', appUrl: 'https://example.com/' };
const deviceKey = createECDH('prime256v1');
deviceKey.generateKeys();
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device', keys: { p256dh: deviceKey.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
const task = { seriesId: 42, chapterNumber: '1&A', seriesName: 'Bộ thử', fIld: 9, endTask: '2026-10-05', status: 'Doing' };
const due = Date.parse(reminderDueAt(task.endTask));

test('configuration requires an enabled flag, matching keys and a secure frontend', () => {
  const env = { WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey, WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey, WEB_PUSH_VAPID_SUBJECT: config.subject, APP_PUBLIC_URL: config.appUrl };
  assert.deepEqual(getWebPushConfig(env), config);
  for (const changes of [{ WEB_PUSH_ENABLED: 'false' }, { WEB_PUSH_VAPID_PRIVATE_KEY: webPush.generateVAPIDKeys().privateKey }, { WEB_PUSH_VAPID_SUBJECT: '' }, { APP_PUBLIC_URL: 'http://example.com/' }]) {
    assert.throws(() => getWebPushConfig({ ...env, ...changes }));
  }
});

test('subscription validation prevents server-side requests to arbitrary or internal hosts', () => {
  assert.deepEqual(validatePushSubscription(subscription), subscription);
  for (const endpoint of ['http://fcm.googleapis.com/send', 'https://127.0.0.1/', 'https://example.com/', 'https://fcm.googleapis.com.evil.test/', 'https://fcm.googleapis.com:444/', 'https://user:password@fcm.googleapis.com/', 'https://fcm.googleapis.com/#fragment']) {
    assert.throws(() => validatePushSubscription({ ...subscription, endpoint }));
  }
  for (const host of ['updates.push.services.mozilla.com', 'web.push.apple.com', 'wns.notify.windows.com']) {
    assert.ok(validatePushSubscription({ ...subscription, endpoint: `https://${host}/test` }));
  }
  assert.throws(() => validatePushSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65).toString('base64url') } }));
  assert.throws(() => validatePushSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'short' } }));
  assert.equal(pushSubscriptionId(subscription).length, 64);
});

test('deadline payload links to the exact task and carries the account binding', () => {
  const payload = buildDeadlinePush(task, '3h', 7, config.appUrl);
  assert.equal(payload.accountId, '7');
  assert.match(payload.title, /3 tiếng/);
  assert.equal(new URL(payload.url).searchParams.get('chapterNumber'), '1&A');
  assert.equal(new URL(payload.url).searchParams.get('seriesId'), '42');
  assert.equal(new URL(payload.url).searchParams.get('view'), 'deadlines');
});

function harness() {
  const state = { now: due - 24 * 3_600_000, tasks: [structuredClone(task)], accounts: [{ id: 7, freelancerId: 9, isActive: true }], devices: [{ id: 'device-1', accountId: '7', subscription }, { id: 'device-2', accountId: '7', subscription }], deliveries: new Map(), sent: [], errors: [], beforeSend: null, failure: null };
  const store = async (action, data = {}) => {
    if (action === 'capabilities') return { version: 1 };
    if (action === 'subscriptions') return structuredClone(state.devices);
    if (action === 'claim') {
      const existing = state.deliveries.get(data.deliveryKey);
      if (existing && (existing.status !== 'retry' || existing.nextAttemptAt > state.now || existing.attemptCount >= 4)) return null;
      const item = { ...data, status: 'processing', attemptCount: (existing?.attemptCount || 0) + 1 };
      state.deliveries.set(data.deliveryKey, item);
      state.beforeSend?.();
      return structuredClone(item);
    }
    if (action === 'get') return structuredClone(state.devices.find((item) => item.id === data.subscriptionId && item.accountId === data.accountId) || null);
    if (action === 'remove') { state.devices = state.devices.filter((item) => item.id !== data.subscriptionId); return {}; }
    if (action === 'finish') Object.assign(state.deliveries.get(data.deliveryKey), { status: data.status, nextAttemptAt: state.now + 300_000 });
    return {};
  };
  const worker = createWebPushWorker({
    store, config: () => config, now: () => state.now,
    selectRows: async (name) => structuredClone(name === 'deadlines' ? state.tasks : state.accounts),
    send: async (device, payload, settings, options) => { if (state.failure) throw state.failure; state.sent.push({ device, payload, options }); },
    onError: (error) => state.errors.push(error)
  });
  return { state, worker };
}

test('all milestones are delivered once per device; email settings are not required', async () => {
  const { state, worker } = harness();
  for (const time of [due - 24 * 3_600_000, due - 6 * 3_600_000, due - 3 * 3_600_000, due + 1]) {
    state.now = time;
    await worker.tick(); await worker.tick();
  }
  assert.equal(state.sent.length, 8);
  assert.equal(state.deliveries.size, 8);
  assert.equal(state.errors.length, 0);
  assert.ok(state.sent.every((item) => item.payload.accountId === '7' && item.options.ttl <= 3600));
});

test('submitted tasks, inactive accounts and changed assignments do not receive reminders', async () => {
  for (const scenario of ['submitted', 'inactive', 'assigned', 'consent', 'changed-after-claim']) {
    const { state, worker } = harness();
    if (scenario === 'submitted') state.tasks[0].status = 'Submitted';
    if (scenario === 'inactive') state.accounts[0].isActive = false;
    if (scenario === 'assigned') state.tasks[0].fIld = 100;
    if (scenario === 'consent') state.beforeSend = () => { state.devices = []; };
    if (scenario === 'changed-after-claim') state.beforeSend = () => { state.tasks[0].status = 'Submitted'; };
    await worker.tick();
    assert.equal(state.sent.length, 0, scenario);
  }
});

test('expired subscriptions are removed and ambiguous sends are not repeated', async () => {
  for (const code of [410, 404, undefined, 500]) {
    const { state, worker } = harness();
    state.failure = Object.assign(new Error('Test failure'), { statusCode: code });
    await worker.tick();
    state.failure = null;
    state.now += 600_000;
    await worker.tick();
    assert.equal(state.sent.length, 0);
    if ([404, 410].includes(code)) assert.equal(state.devices.length, 0);
  }
});

test('explicit throttling is retried after the backoff', async () => {
  const { state, worker } = harness();
  state.failure = Object.assign(new Error('Throttled'), { statusCode: 429 });
  await worker.tick();
  state.failure = null;
  await worker.tick();
  assert.equal(state.sent.length, 0);
  state.now += 300_000;
  await worker.tick();
  assert.equal(state.sent.length, 2);
});
