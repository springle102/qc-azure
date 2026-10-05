import { api } from './api';
import { applicationServerKey, bindNotificationAccount, prepareNotificationWorker } from '../utils/deviceNotifications.mjs';

const OWNER_KEY = 'wz-notification-account';
const preferenceKey = (accountId) => `wz-notification-choice:${accountId}`;
export function getNotificationChoice(accountId) {
  try { return localStorage.getItem(preferenceKey(accountId)); } catch { return null; }
}
export function setNotificationChoice(accountId, choice) {
  try { localStorage.setItem(preferenceKey(accountId), choice); } catch { /* The choice still applies until this page closes. */ }
}

export async function enableDevicePush(accountId, publicKey, registration, isCurrent = () => true) {
  const worker = registration || await prepareNotificationWorker();
  if (!isCurrent()) return;
  let subscription = await worker.pushManager.getSubscription();
  const key = applicationServerKey(publicKey);
  // Rotating a VAPID key requires a new browser subscription.
  const currentKey = subscription?.options?.applicationServerKey;
  if (subscription && currentKey && !new Uint8Array(currentKey).every((byte, index) => byte === key[index])) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  if (!isCurrent()) { await subscription.unsubscribe(); return; }
  await bindNotificationAccount(worker, accountId);
  try {
    await api.subscribePush(subscription.toJSON());
    if (!isCurrent()) { await disableDevicePush(); return; }
    try { localStorage.setItem(OWNER_KEY, String(accountId)); } catch { /* Worker binding remains active for this session. */ }
    setNotificationChoice(accountId, 'enabled');
    return subscription;
  } catch (error) {
    await bindNotificationAccount(worker, null);
    await subscription.unsubscribe();
    throw error;
  }
}

export async function disableDevicePush({ forgetChoice = false } = {}) {
  let owner;
  try { owner = localStorage.getItem(OWNER_KEY); localStorage.removeItem(OWNER_KEY); } catch { /* Storage may be disabled. */ }
  if (forgetChoice && owner) setNotificationChoice(owner, 'disabled');
  if (!navigator.serviceWorker) return;
  const worker = await navigator.serviceWorker.getRegistration('/');
  if (!worker) return;
  const subscription = await worker.pushManager.getSubscription();
  // Clear the device binding first, including queued notifications, even when the API is offline.
  let failure;
  try { await bindNotificationAccount(worker, null); } catch (error) { failure = error; }
  if (subscription) {
    try { await subscription.unsubscribe(); } catch (error) { failure = error; }
    try { await api.unsubscribePush(subscription.toJSON()); } catch (error) { failure ||= error; }
  }
  if (failure) throw failure;
}

export function deviceAccountOwner() {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
}
