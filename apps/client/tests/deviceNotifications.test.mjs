import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { notificationSupport, requestBrowserNotificationPermission, applicationServerKey } from '../src/utils/deviceNotifications.mjs';

function browser({ permission = 'default', ios = false, standalone = false, secure = true } = {}) {
  const state = { calls: 0 };
  const scope = { isSecureContext: secure, PushManager: {}, navigator: { userAgent: ios ? 'iPhone Safari' : 'Chrome', serviceWorker: {} }, matchMedia: () => ({ matches: standalone }), Notification: { permission, requestPermission: () => { state.calls += 1; return Promise.resolve('granted'); } } };
  return { state, scope };
}

test('native permission is invoked synchronously on user action and not repeated after a decision', async () => {
  const { state, scope } = browser();
  const response = requestBrowserNotificationPermission(scope);
  assert.equal(state.calls, 1);
  assert.equal(await response, 'granted');
  for (const permission of ['denied', 'granted']) {
    const browserState = browser({ permission });
    assert.equal(await requestBrowserNotificationPermission(browserState.scope), permission);
    assert.equal(browserState.state.calls, 0);
  }
});

test('iOS requires home-screen mode and insecure or unsupported browsers never request permission', async () => {
  for (const [options, support] of [[{ ios: true }, 'install'], [{ ios: true, standalone: true }, 'supported'], [{ secure: false }, 'insecure']]) {
    const { state, scope } = browser(options);
    assert.equal(notificationSupport(scope), support);
    if (support !== 'supported') { assert.equal(await requestBrowserNotificationPermission(scope), 'unsupported'); assert.equal(state.calls, 0); }
  }
  const { scope } = browser();
  delete scope.Notification;
  assert.equal(notificationSupport(scope), 'unsupported');
  const bytes = applicationServerKey('AQIDBA');
  assert.deepEqual([...bytes], [1, 2, 3, 4]);
});

function workerHarness() {
  const events = new Map();
  const entries = new Map();
  const shown = [];
  const opened = [];
  const closed = [];
  const self = {
    location: { origin: 'https://example.com' },
    addEventListener: (name, callback) => events.set(name, callback),
    registration: { showNotification: async (title, options) => shown.push({ title, options }), getNotifications: async () => shown.map((item) => ({ data: item.options.data, close: () => closed.push(item) })) },
    clients: { matchAll: async () => [], openWindow: async (url) => opened.push(url) }
  };
  const caches = { open: async () => ({ put: async (key, response) => entries.set(key, await response.text()), match: async (key) => entries.has(key) ? new Response(entries.get(key)) : undefined, delete: async (key) => entries.delete(key) }) };
  runInNewContext(readFileSync(new URL('../public/notification-sw.js', import.meta.url), 'utf8'), { self, caches, URL, Response });
  const dispatch = async (name, values) => {
    let work;
    events.get(name)({ ...values, waitUntil: (promise) => { work = promise; } });
    await work;
  };
  const bind = (accountId) => dispatch('message', { data: { type: 'notification-account', accountId }, ports: [{ postMessage: () => {} }] });
  const push = (payload) => dispatch('push', { data: { json: () => payload } });
  return { shown, opened, closed, bind, push, dispatch, events };
}

test('service worker displays only the current account and removes old notifications on logout', async () => {
  const worker = workerHarness();
  assert.equal(worker.events.has('fetch'), false);
  await worker.bind('7');
  await worker.push({ accountId: '8', title: 'Wrong user' });
  assert.equal(worker.shown.length, 0);
  await worker.push({ accountId: '7', title: 'Deadline', url: '/?view=deadlines&seriesId=42' });
  assert.equal(worker.shown.length, 1);
  await worker.bind(null);
  assert.equal(worker.closed.length, 1);
  await worker.push({ accountId: '7', title: 'Queued old notification' });
  assert.equal(worker.shown.length, 1);
});

test('notification clicks cannot open external URLs or a different account', async () => {
  const worker = workerHarness();
  await worker.bind('7');
  let closed = false;
  await worker.dispatch('notificationclick', { notification: { data: { accountId: '8', url: 'https://example.com/' }, close: () => { closed = true; } } });
  assert.equal(closed, true);
  assert.equal(worker.opened.length, 0);
  await worker.dispatch('notificationclick', { notification: { data: { accountId: '7', url: 'https://evil.test/' }, close: () => {} } });
  assert.equal(worker.opened[0], 'https://example.com/');
});
