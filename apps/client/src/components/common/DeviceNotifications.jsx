import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconBell } from './Icons';

const SUPPORT_MESSAGES = {
  install: 'Trên iPhone/iPad (iOS 16.4 trở lên): mở web bằng Safari, chọn Chia sẻ → Thêm vào Màn hình chính. Mở lại từ biểu tượng WZ System rồi bấm Cho phép.',
  insecure: 'Hãy mở web bằng địa chỉ HTTPS để bật thông báo trên thiết bị.',
  unsupported: 'Trình duyệt này chưa hỗ trợ thông báo trên thiết bị. Hãy thử bằng trình duyệt hỗ trợ Web Push.'
};

export function DeviceNotificationSettings({ controller }) {
  const state = controller;
  return (
    <div className="device-notification-settings">
      <strong>Thông báo trên thiết bị</strong>
      <p>{state.loading ? 'Đang kiểm tra...' : SUPPORT_MESSAGES[state.support]
        || (state.permission === 'denied' ? 'Bạn đã chặn thông báo. Mở cài đặt quyền của trang web trong trình duyệt, đổi Thông báo thành Cho phép rồi tải lại trang.'
          : state.enabled ? 'Đang nhận nhắc deadline trên thiết bị này.' : 'Bật thông báo để nhận nhắc deadline cả khi không mở web.')}</p>
      {state.support === 'supported' && state.permission !== 'denied' && !state.loading && state.ready && (
        <div className="device-notification-actions">
          {state.enabled ? <>
            <button type="button" className="btn btn-outline btn-sm" disabled={state.busy} onClick={state.test}>Gửi thử</button>
            <button type="button" className="btn btn-outline btn-sm" disabled={state.busy} onClick={state.disable}>Tắt trên thiết bị này</button>
          </> : <button type="button" className="btn btn-primary btn-sm" disabled={state.busy} onClick={state.enable}>{state.busy ? 'Đang bật...' : 'Cho phép thông báo'}</button>}
        </div>
      )}
      {state.message && <p role="status">{state.message}</p>}
    </div>
  );
}

export function DeviceNotificationPrompt({ controller }) {
  const state = controller;
  const { prompt, dismiss } = state;
  useEffect(() => {
    if (!prompt) return;
    const escape = (event) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [prompt, dismiss]);
  if (!state.prompt) return null;
  return createPortal(
    <section className="device-notification-prompt" role="dialog" aria-labelledby="device-notification-title" aria-describedby="device-notification-description">
      <span className="device-notification-prompt-icon"><IconBell size={22} /></span>
      <div className="device-notification-prompt-content">
        <strong id="device-notification-title">Bạn muốn cho phép trang web này gửi thông báo cho bạn không?</strong>
        <p id="device-notification-description">{SUPPORT_MESSAGES[state.support] || 'Nhận nhắc deadline từ WZ System ngay trên thiết bị, cả khi không mở web.'}</p>
        <div className="device-notification-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={state.dismiss}>{state.support === 'install' ? 'Để sau' : 'Không cho phép'}</button>
          {state.support === 'supported' && <button type="button" className="btn btn-primary btn-sm" disabled={state.busy} onClick={state.enable}>Cho phép</button>}
        </div>
      </div>
    </section>, document.body
  );
}
