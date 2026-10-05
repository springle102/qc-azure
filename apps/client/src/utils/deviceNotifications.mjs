export function notificationSupport(scope = globalThis) {
  if (!scope.isSecureContext) return 'insecure';
  const ios = /iPad|iPhone|iPod/.test(scope.navigator?.userAgent || '')
    || (scope.navigator?.platform === 'MacIntel' && scope.navigator?.maxTouchPoints > 1);
  const standalone = scope.matchMedia?.('(display-mode: standalone)')?.matches || scope.navigator?.standalone === true;
  if (ios && !standalone) return 'install';
  if (!scope.Notification || !scope.navigator?.serviceWorker || !scope.PushManager) return 'unsupported';
  return 'supported';
}

// Call directly from the click handler, before awaiting network or service-worker work.
export function requestBrowserNotificationPermission(scope = globalThis) {
  if (notificationSupport(scope) !== 'supported') return Promise.resolve('unsupported');
  if (scope.Notification.permission !== 'default') return Promise.resolve(scope.Notification.permission);
  return scope.Notification.requestPermission();
}

export function applicationServerKey(value) {
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function prepareNotificationWorker(scope = globalThis) {
  await scope.navigator.serviceWorker.register('/notification-sw.js', { scope: '/', updateViaCache: 'none' });
  return scope.navigator.serviceWorker.ready;
}

export async function bindNotificationAccount(registration, accountId) {
  if (!registration?.active) throw new Error('Thông báo chưa sẵn sàng. Vui lòng tải lại trang.');
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Không thể cập nhật thiết bị nhận thông báo.')); }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data?.ok) resolve();
      else reject(new Error('Không thể lưu lựa chọn thông báo trên thiết bị.'));
    };
    registration.active.postMessage({ type: 'notification-account', accountId: accountId === null ? null : String(accountId) }, [channel.port2]);
  });
}
