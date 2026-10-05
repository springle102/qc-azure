import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildBellNotifications } from '../../../../shared/bellNotifications.mjs';
import { IconAlertTriangle, IconBell, IconCheckCircle, IconChevronRight, IconClock, IconMenu, IconMoon, IconSun, IconUser } from '../common/Icons';
import { DeviceNotificationPrompt, DeviceNotificationSettings } from '../common/DeviceNotifications';
import { useDeviceNotifications } from '../common/useDeviceNotifications';

const NOTIFICATION_ICONS = { alert: IconAlertTriangle, check: IconCheckCircle, clock: IconClock };

export function Header({ currentUser, deadlines = [], errors = [], onNavigate, onOpenProfile, onToggleSidebar, onOpenNotifications, isDarkMode = true, onToggleTheme }) {
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState([]);
  const notificationRef = useRef(null);
  const deviceNotifications = useDeviceNotifications(currentUser?.id, currentUser?.role);
  const notifications = useMemo(() => buildBellNotifications(deadlines, errors, currentUser).map((notification) => ({ ...notification, icon: NOTIFICATION_ICONS[notification.icon] })), [currentUser, deadlines, errors]);
  const unreadCount = notifications.filter((notification) => !readNotificationIds.includes(notification.id)).length;
  const ThemeIcon = isDarkMode ? IconSun : IconMoon;
  const themeLabel = isDarkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';

  const reviewCount = useMemo(() => {
    return (deadlines || []).filter((item) => ['submitted', 'checking'].includes(String(item?.status ?? '').trim().toLowerCase())).length;
  }, [deadlines]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!notificationRef.current?.contains(event.target)) setIsNotificationsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsNotificationsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const markNotificationRead = (notification) => {
    setReadNotificationIds((current) => current.includes(notification.id) ? current : [...current, notification.id]);
    setIsNotificationsOpen(false);
    if (notification.view) onNavigate?.(notification.view);
  };

  const markAllNotificationsRead = () => {
    setReadNotificationIds(notifications.map((notification) => notification.id));
  };

  return (
    <header className="app-header qc-header">
      <div className="header-left">
        <button
          type="button"
          onClick={() => {
            setIsNotificationsOpen(false);
            onToggleSidebar?.();
          }}
          className="header-btn qc-mobile-menu"
          title="Mở menu"
        >
          <IconMenu size={20} />
        </button>
        <div>
          <div className="qc-header-eyebrow">HỆ THỐNG QUẢN LÝ DEADLINE WEBTOON</div>
          <h1 className="qc-header-title">Workspace Studio</h1>
        </div>
      </div>

      <div className="qc-header-actions">
        {currentUser?.role !== 'Freelancer' && reviewCount > 0 && (
          <div className="qc-header-ticker" title="Các chapter đang chờ QC">
            <span className="qc-ticker-dot" />
            <span><strong>{reviewCount} chapter</strong> đang chờ QC</span>
          </div>
        )}
        <div ref={notificationRef} className="qc-notification-wrap">
          <button
            type="button"
            className={`qc-notification-button ${isNotificationsOpen ? 'is-open' : ''}`}
            onClick={() => {
              if (!isNotificationsOpen) onOpenNotifications?.();
              setIsNotificationsOpen((open) => !open);
            }}
            aria-label="Mở thông báo"
            aria-expanded={isNotificationsOpen}
            aria-haspopup="true"
          >
            <IconBell size={18} />
            {unreadCount > 0 && <span className="qc-notification-count">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>
          {isNotificationsOpen && (
            <div className="qc-notification-panel">
              <div className="qc-notification-header">
                <div>
                  <strong>Thông báo</strong>
                  <span>{unreadCount > 0 ? `${unreadCount} thông báo chưa đọc` : 'Bạn đã xem hết thông báo'}</span>
                </div>
                {unreadCount > 0 && <button type="button" className="qc-notification-mark-read" onClick={markAllNotificationsRead}>Đánh dấu đã đọc</button>}
              </div>
              <DeviceNotificationSettings controller={deviceNotifications} />
              <div className="qc-notification-list">
                {notifications.length === 0 ? (
                  <div className="qc-notification-empty">
                    <IconCheckCircle size={22} />
                    <strong>Chưa có hoạt động mới</strong>
                    <span>Các thông báo quan trọng sẽ xuất hiện ở đây.</span>
                  </div>
                ) : notifications.map((notification) => (
                  <button
                    type="button"
                    key={notification.id}
                    className={`qc-notification-item ${readNotificationIds.includes(notification.id) ? 'is-read' : ''}`}
                    onClick={() => markNotificationRead(notification)}
                  >
                    <span className={`qc-notification-icon ${notification.tone}`}><notification.icon size={16} /></span>
                    <span className="qc-notification-content">
                      <strong>{notification.title}</strong>
                      <span>{notification.message}</span>
                      <small>{notification.action} <IconChevronRight size={12} /></small>
                    </span>
                    <span className="qc-notification-meta">
                      <time className="qc-notification-time" dateTime={notification.timestamp}>{formatNotificationTime(notification.timestamp)}</time>
                      {!readNotificationIds.includes(notification.id) && <span className="qc-notification-unread-dot" />}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="qc-theme-button"
          onClick={onToggleTheme}
          aria-label={themeLabel}
          aria-pressed={!isDarkMode}
          title={themeLabel}
        >
          <ThemeIcon size={18} />
        </button>

        <button type="button" className="qc-header-profile" onClick={onOpenProfile}>
          <span className="qc-header-avatar">
            {currentUser?.avatar ? <img src={currentUser.avatar} alt="" /> : <IconUser size={17} />}
          </span>
          <span>
            <strong>{currentUser?.name || currentUser?.username || 'Account'}</strong>
            <small>{currentUser?.email || currentUser?.role || 'Tài khoản'}</small>
          </span>
        </button>
      </div>
      <DeviceNotificationPrompt controller={deviceNotifications} />
    </header>
  );
}

function formatNotificationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute} ${values.day}/${values.month}/${values.year}`;
}
