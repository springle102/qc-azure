import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/api';
import { deviceAccountOwner, disableDevicePush, enableDevicePush, getNotificationChoice, setNotificationChoice } from '../../services/devicePush';
import { notificationSupport, prepareNotificationWorker, requestBrowserNotificationPermission } from '../../utils/deviceNotifications.mjs';

export function useDeviceNotifications(accountId) {
  const [state, setState] = useState({ loading: true, ready: false, support: notificationSupport(), permission: globalThis.Notification?.permission || 'default', enabled: false, busy: false, prompt: false, message: '' });
  const workerRef = useRef(null);
  const configRef = useRef(null);
  const currentRef = useRef(null);

  useEffect(() => {
    const context = { active: true, accountId };
    currentRef.current = context;
    const support = notificationSupport();
    const permission = globalThis.Notification?.permission || 'default';
    const choice = getNotificationChoice(accountId);
    const update = (values) => { if (context.active) setState((current) => ({ ...current, ...values })); };
    update({ loading: true, support, permission, enabled: false, prompt: false, message: '' });
    (async () => {
      try {
        const config = await api.getPushConfiguration();
        if (!context.active) return;
        configRef.current = config;
        if (!config.ready) { update({ ready: false, message: 'Thông báo trên thiết bị chưa được thiết lập. Vui lòng liên hệ quản trị viên.' }); return; }
        update({ ready: true });
        if (support === 'supported') {
          const owner = deviceAccountOwner();
          if (owner && String(owner) !== String(accountId)) await disableDevicePush().catch(() => {});
          const worker = await prepareNotificationWorker();
          if (!context.active) return;
          workerRef.current = worker;
          if (permission === 'granted' && choice === 'enabled') {
            update({ busy: true });
            const subscription = await enableDevicePush(accountId, config.publicKey, worker, () => context.active);
            update({ enabled: Boolean(subscription) });
          } else if (permission !== 'denied' && !choice) update({ prompt: true });
        } else if (support === 'install' && !choice) update({ prompt: true });
      } catch {
        update({ message: 'Chưa kết nối được dịch vụ thông báo. Tải lại trang để thử lại.' });
      } finally { update({ loading: false, busy: false }); }
    })();
    const refresh = () => {
      const next = globalThis.Notification?.permission || 'default';
      update({ permission: next });
      if (next === 'denied') {
        update({ enabled: false, prompt: false });
        if (deviceAccountOwner() === String(accountId)) {
          setNotificationChoice(accountId, 'disabled');
          void disableDevicePush().catch(() => {});
        }
      }
    };
    window.addEventListener('focus', refresh);
    return () => { context.active = false; window.removeEventListener('focus', refresh); };
  }, [accountId]);

  const dismiss = () => {
    setNotificationChoice(accountId, 'dismissed');
    setState((current) => ({ ...current, prompt: false }));
  };

  const enable = async () => {
    if (state.busy || !state.ready || state.support !== 'supported') return;
    const context = currentRef.current;
    // Keep this call synchronous with the user's tap; iOS requires user activation.
    const permissionRequest = requestBrowserNotificationPermission();
    setState((current) => ({ ...current, busy: true, message: '', prompt: false }));
    try {
      const permission = await permissionRequest;
      if (!context.active) return;
      setState((current) => ({ ...current, permission }));
      if (permission !== 'granted') { setNotificationChoice(accountId, 'dismissed'); return; }
      const subscription = await enableDevicePush(accountId, configRef.current.publicKey, workerRef.current, () => context.active);
      if (context.active) setState((current) => ({ ...current, enabled: Boolean(subscription), message: 'Đã bật nhắc deadline trên thiết bị này.' }));
    } catch {
      if (context.active) setState((current) => ({ ...current, enabled: false, message: 'Chưa bật được thông báo. Vui lòng thử lại và kiểm tra kết nối mạng.' }));
    } finally {
      if (context.active) setState((current) => ({ ...current, busy: false }));
    }
  };

  const disable = async () => {
    const context = currentRef.current;
    setState((current) => ({ ...current, busy: true, message: '' }));
    setNotificationChoice(accountId, 'disabled');
    try {
      await disableDevicePush();
      if (context.active) setState((current) => ({ ...current, enabled: false, message: 'Đã tắt nhắc deadline trên thiết bị này.' }));
    } catch {
      if (context.active) setState((current) => ({ ...current, enabled: false, message: 'Đã ngừng nhận trên thiết bị. Chưa xác nhận được với máy chủ; bạn có thể Chặn thông báo trong cài đặt trang web.' }));
    } finally {
      if (context.active) setState((current) => ({ ...current, busy: false }));
    }
  };

  const test = async () => {
    const context = currentRef.current;
    setState((current) => ({ ...current, busy: true, message: '' }));
    try {
      const subscription = await workerRef.current?.pushManager.getSubscription();
      if (!subscription) throw new Error('Thiết bị chưa có đăng ký thông báo. Hãy tắt rồi bật lại.');
      await api.testPush(subscription.toJSON());
      if (context.active) setState((current) => ({ ...current, message: 'Đã gửi thông báo thử. Kiểm tra trung tâm thông báo của thiết bị.' }));
    } catch (error) {
      if (context.active) setState((current) => ({ ...current, message: error.message }));
    } finally { if (context.active) setState((current) => ({ ...current, busy: false })); }
  };

  return { ...state, dismiss, enable, disable, test };
}

