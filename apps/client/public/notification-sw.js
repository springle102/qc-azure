/* Device notifications only: page and API requests always go to the network. */
const ACCOUNT_CACHE = 'wz-notification-account-v1';
const ACCOUNT_URL = new URL('/__notification_account__', self.location.origin).href;

self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'notification-account') return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(ACCOUNT_CACHE);
      if (event.data.accountId === null) await cache.delete(ACCOUNT_URL);
      else await cache.put(ACCOUNT_URL, new Response(String(event.data.accountId)));
      const notifications = await self.registration.getNotifications();
      for (const notification of notifications) {
        if (notification.data?.accountId !== event.data.accountId) notification.close();
      }
      event.ports[0]?.postMessage({ ok: true });
    } catch { event.ports[0]?.postMessage({ ok: false }); }
  })());
});

async function activeAccount() {
  const cache = await caches.open(ACCOUNT_CACHE);
  const entry = await cache.match(ACCOUNT_URL);
  return entry ? entry.text() : null;
}

function safeNotificationUrl(value) {
  try {
    const url = new URL(value || '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL('/', self.location.origin).href;
  } catch { return new URL('/', self.location.origin).href; }
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (!payload || String(payload.accountId) !== await activeAccount()) return;
    await self.registration.showNotification(payload.title || 'WZ System', {
      body: payload.body || 'Bạn có thông báo deadline mới.',
      icon: '/notification-icon-192.png', badge: '/notification-icon-192.png',
      tag: payload.tag || 'wz-deadline',
      data: { url: safeNotificationUrl(payload.url), accountId: String(payload.accountId) }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    if (event.notification.data?.accountId !== await activeAccount()) return;
    const url = safeNotificationUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'navigate' in client) {
        const target = await client.navigate(url);
        if (target) { await target.focus(); return; }
      }
    }
    await self.clients.openWindow(url);
  })());
});
