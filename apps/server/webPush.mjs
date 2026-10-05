import { createHash, createECDH, randomUUID } from 'node:crypto';
import webPush from 'web-push';
import { eligibleReminderTask, reminderAppUrl, reminderDueAt, reminderIdentity, reminderMilestone } from './taskReminderEmail.mjs';
import { buildBellNotifications } from '../shared/bellNotifications.mjs';

const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });
const pushHosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];

export function validatePushSubscription(value) {
  let url;
  try { url = new URL(value?.endpoint); } catch { throw invalid('Đăng ký thông báo không hợp lệ.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || url.href.length > 2048 || !(pushHosts.includes(host) || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com'))) {
    throw invalid('Địa chỉ dịch vụ thông báo không được hỗ trợ.');
  }
  const decode = (key, length) => typeof key === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(key) && Buffer.from(key, 'base64url').length === length;
  if (!decode(value?.keys?.p256dh, 65) || !decode(value?.keys?.auth, 16)) throw invalid('Khóa đăng ký thông báo không hợp lệ.');
  try { createECDH('prime256v1').setPublicKey(Buffer.from(value.keys.p256dh, 'base64url')); } catch { throw invalid('Khóa đăng ký thông báo không hợp lệ.'); }
  return { endpoint: url.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

export const pushSubscriptionId = (subscription) => createHash('sha256').update(subscription.endpoint).digest('hex');

export function getWebPushConfig(env = process.env) {
  if (env.WEB_PUSH_ENABLED !== 'true') throw Object.assign(new Error('Thông báo trên thiết bị chưa được bật trên máy chủ.'), { statusCode: 503 });
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY || '';
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY || '';
  const subject = env.WEB_PUSH_VAPID_SUBJECT || '';
  try {
    webPush.getVapidHeaders('https://fcm.googleapis.com', subject, publicKey, privateKey, 'aes128gcm');
    const key = createECDH('prime256v1');
    key.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== publicKey) throw new Error();
    const appUrl = reminderAppUrl(env.APP_PUBLIC_URL);
    if (appUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname)) throw new Error();
    return { publicKey, privateKey, subject, appUrl: appUrl.href };
  } catch {
    throw Object.assign(new Error('Cần cấu hình khóa Web Push, địa chỉ liên hệ và APP_PUBLIC_URL hợp lệ trên backend.'), { statusCode: 503 });
  }
}

export async function validateWebPushStore(store) {
  try {
    if ((await store('capabilities'))?.version !== 2) throw new Error();
  } catch {
    throw Object.assign(new Error('Chưa sẵn sàng lưu thông báo. Chạy migration 20261005_web_push.sql rồi 20261005_web_push_bell_notifications.sql.'), { statusCode: 503 });
  }
}

export function buildDeadlinePush(task, milestone, accountId, appUrl) {
  const title = { '24h': 'Task sắp đến hạn', '6h': 'Task còn tối đa 6 tiếng', '3h': 'Task còn tối đa 3 tiếng', overdue: 'Task đã quá hạn' }[milestone];
  const url = reminderAppUrl(appUrl);
  url.searchParams.set('view', 'deadlines');
  url.searchParams.set('seriesId', String(task.seriesId));
  url.searchParams.set('chapterNumber', String(task.chapterNumber));
  return {
    title: `WZ System — ${title}`,
    body: `${String(task.seriesName || task.seriesId).slice(0, 180)} — Chapter ${String(task.chapterNumber).slice(0, 60)}. Bấm để xem deadline.`,
    tag: `deadline-${reminderIdentity(task, milestone).deliveryKey}`,
    url: url.href, accountId: String(accountId)
  };
}

export function sendWebPush(subscription, payload, config, { ttl = 3600 } = {}) {
  return webPush.sendNotification(validatePushSubscription(subscription), JSON.stringify(payload), {
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
    TTL: ttl, urgency: 'high', timeout: 15_000
  });
}

export function deviceNotificationRole(account, device) {
  if (!account || account.isActive === false) return null;
  const roles = Array.isArray(account.roles) && account.roles.length ? account.roles : [account.role];
  const role = device.notificationRole || ['Admin', 'QC', 'Freelancer'].find((value) => roles.includes(value));
  return roles.includes(role) ? role : null;
}

export function accountBellNotifications(account, role, tasks, errors, now) {
  // Use the same error scope as /api/errors, in addition to the shared bell rules.
  const userId = account.freelancerId;
  const scopedErrors = userId === null || userId === undefined || userId === '' ? []
    : errors.filter((row) => String(row.editorFreelancerId ?? '') === String(userId));
  const user = { ...account, role, name: account.name || account.displayName || account.username || '' };
  return buildBellNotifications(tasks, scopedErrors, user, now);
}

export function bellNotificationFingerprint(notification) {
  // Generic updatedAt and display timestamps change during unrelated edits/syncs.
  return createHash('sha256').update(JSON.stringify([
    notification.id, notification.title, notification.message, notification.view, notification.target, notification.revision
  ])).digest('hex');
}

export function buildBellPush(notification, accountId, appUrl) {
  const url = reminderAppUrl(appUrl);
  url.searchParams.set('view', notification.view);
  for (const [name, value] of Object.entries(notification.target || {})) url.searchParams.set(name, value);
  return {
    title: `WZ System — ${notification.title}`, body: notification.message.slice(0, 600),
    tag: `bell-${createHash('sha256').update(notification.id).digest('hex')}`,
    url: url.href, accountId: String(accountId)
  };
}

export function createWebPushWorker({ selectRows, store, send = sendWebPush, config = getWebPushConfig, now = Date.now, onError = (error) => console.error('Web Push:', error.message) }) {
  let running = false;
  let stopped = false;
  let timer;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const settings = config();
      await validateWebPushStore(store);
      const subscriptions = await store('subscriptions');
      if (!subscriptions.length) return;
      const [tasks, accounts] = await Promise.all([selectRows('deadlines', { fresh: true }), selectRows('accounts', { fresh: true })]);
      const errors = await selectRows('errors', { fresh: true });
      const eventStates = new Map();
      for (const device of subscriptions) {
        const account = accounts.find((row) => String(row.id) === device.accountId && row.isActive !== false);
        const role = deviceNotificationRole(account, device);
        if (!role) continue;
        const bell = accountBellNotifications(account, role, tasks, errors, now());
        const accountScope = JSON.stringify([device.accountId, role]);
        if (!eventStates.has(accountScope)) {
          eventStates.set(accountScope, await store('sync_notifications', {
            accountId: device.accountId, role,
            notifications: bell.map((notification) => ({ eventId: notification.id, fingerprint: bellNotificationFingerprint(notification) }))
          }));
        }
        let expired = false;
        for (const notification of bell) {
          if (stopped) return;
          const eventState = eventStates.get(accountScope).find((row) => row.eventId === notification.id);
          if (!eventState) continue;
          const deliveryKey = createHash('sha256').update(JSON.stringify([device.id, device.accountId, role, notification.id, eventState.version])).digest('hex');
          const leaseToken = randomUUID();
          if (!await store('claim', { deliveryKey, subscriptionId: device.id, accountId: device.accountId, leaseToken })) continue;
          const finish = (status) => store('finish', { deliveryKey, leaseToken, status });
          try {
            const [currentTasks, currentErrors, currentAccounts, consent, currentState] = await Promise.all([
              selectRows('deadlines', { fresh: true }), selectRows('errors', { fresh: true }), selectRows('accounts', { fresh: true }),
              store('get', { subscriptionId: device.id, accountId: device.accountId }),
              store('notification_state', { accountId: device.accountId, role, eventId: notification.id })
            ]);
            const currentAccount = currentAccounts.find((row) => String(row.id) === device.accountId);
            const currentNotification = currentAccount && accountBellNotifications(currentAccount, role, currentTasks, currentErrors, now()).find((row) => row.id === notification.id);
            if (stopped || !consent || deviceNotificationRole(currentAccount, consent) !== role || !currentNotification
              || !currentState?.active || currentState.version !== eventState.version
              || bellNotificationFingerprint(currentNotification) !== eventState.fingerprint) {
              await finish('cancelled'); continue;
            }
            await send(consent.subscription, buildBellPush(currentNotification, device.accountId, settings.appUrl), settings);
            await finish('sent');
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) {
              await store('remove', { subscriptionId: device.id, accountId: device.accountId });
              expired = true; break;
            }
            await finish(error.statusCode === 429 ? 'retry' : 'failed');
            onError(new Error(`Không gửi được thông báo (mã ${Number(error.statusCode) || 'kết nối'}).`));
          }
        }
        if (expired || role !== 'Freelancer' || account.freelancerId === null || account.freelancerId === undefined) continue;
        for (const task of tasks) {
          if (stopped) return;
          if (!eligibleReminderTask(task) || String(task.fIld) !== String(account.freelancerId)) continue;
          const dueAt = reminderDueAt(task.endTask);
          const milestone = reminderMilestone(dueAt, now());
          if (!milestone) continue;
          const identity = reminderIdentity(task, milestone);
          // A separate record for each device and account survives restarts and replica concurrency.
          const deliveryKey = createHash('sha256').update(`${device.id}:${device.accountId}:${identity.deliveryKey}`).digest('hex');
          const leaseToken = randomUUID();
          const claimed = await store('claim', { deliveryKey, subscriptionId: device.id, accountId: device.accountId, leaseToken });
          if (!claimed) continue;
          const finish = (status) => store('finish', { deliveryKey, leaseToken, status });
          try {
            // Recheck assignment and consent just before sending a potentially private reminder.
            const [currentTasks, currentAccounts, consent] = await Promise.all([
              selectRows('deadlines', { fresh: true }), selectRows('accounts', { fresh: true }),
              store('get', { subscriptionId: device.id, accountId: device.accountId })
            ]);
            const currentTask = currentTasks.find((row) => String(row.seriesId) === identity.seriesId && String(row.chapterNumber) === identity.chapterNumber);
            const currentAccount = currentAccounts.find((row) => String(row.id) === device.accountId && row.isActive !== false);
            if (stopped || !consent || deviceNotificationRole(currentAccount, consent) !== role || !currentTask || !eligibleReminderTask(currentTask)
              || String(currentAccount.freelancerId ?? '') !== identity.freelancerId || String(currentTask.fIld) !== identity.freelancerId
              || reminderDueAt(currentTask.endTask) !== dueAt || reminderMilestone(dueAt, now()) !== milestone) {
              await finish('cancelled');
              continue;
            }
            const ttl = Math.min(3600, Math.max(0, Math.floor((Date.parse(dueAt) - now()) / 1000)));
            await send(consent.subscription, buildDeadlinePush(currentTask, milestone, device.accountId, settings.appUrl), settings, { ttl: milestone === 'overdue' ? 3600 : ttl });
            await finish('sent');
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) {
              await store('remove', { subscriptionId: device.id, accountId: device.accountId });
              break;
            }
            // Retry only when the push service explicitly declined due to throttling.
            // An interrupted or ambiguous send is not repeated automatically.
            await finish(error.statusCode === 429 ? 'retry' : 'failed');
            onError(new Error(`Không gửi được thông báo (mã ${Number(error.statusCode) || 'kết nối'}).`));
          }
        }
      }
    } catch (error) { onError(error); } finally { running = false; }
  }
  return {
    tick,
    start() { if (timer) return; stopped = false; void tick(); timer = setInterval(() => { void tick(); }, 60_000); timer.unref?.(); },
    stop() { stopped = true; clearInterval(timer); timer = undefined; }
  };
}
