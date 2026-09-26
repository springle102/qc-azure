import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconBell, IconCheckCircle, IconChevronRight, IconClock, IconMenu, IconMoon, IconSun, IconUser } from '../common/Icons';

export function Header({ currentUser, deadlines = [], onNavigate, onOpenProfile, onToggleSidebar, isDarkMode = true, onToggleTheme }) {
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState([]);
  const notificationRef = useRef(null);
  const notifications = useMemo(() => buildNotifications(deadlines, currentUser), [currentUser, deadlines]);
  const unreadCount = notifications.filter((notification) => !readNotificationIds.includes(notification.id)).length;
  const ThemeIcon = isDarkMode ? IconSun : IconMoon;
  const themeLabel = isDarkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';

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
        <button type="button" onClick={onToggleSidebar} className="header-btn qc-mobile-menu" title="Mở menu">
          <IconMenu size={20} />
        </button>
        <div>
          <div className="qc-header-eyebrow">HỆ THỐNG QUẢN LÝ DEADLINE WEBTOON</div>
          <h1 className="qc-header-title">{currentUser?.role === 'Freelancer' ? 'Không gian làm việc Freelancer' : 'Không gian làm việc QC'}</h1>
        </div>
      </div>

      <div className="qc-header-actions">
        <div ref={notificationRef} className="qc-notification-wrap">
          <button
            type="button"
            className={`qc-notification-button ${isNotificationsOpen ? 'is-open' : ''}`}
            onClick={() => setIsNotificationsOpen((open) => !open)}
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
                    {!readNotificationIds.includes(notification.id) && <span className="qc-notification-unread-dot" />}
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
          <span className="qc-header-avatar"><IconUser size={17} /></span>
          <span>
            <strong>{currentUser?.name || currentUser?.username || 'Account'}</strong>
            <small>{currentUser?.email || currentUser?.role || 'Tài khoản'}</small>
          </span>
        </button>
      </div>
    </header>
  );
}

function buildNotifications(deadlines, currentUser) {
  const role = currentUser?.role;
  const userId = currentUser?.freelancerId ?? currentUser?.fIld;
  const visibleDeadlines = role === 'Freelancer'
    ? deadlines.filter((deadline) => String(deadline.fIld ?? deadline.fId ?? '') === String(userId ?? ''))
    : deadlines;
  const notifications = [];

  if (role === 'Freelancer') {
    visibleDeadlines
      .filter((deadline) => String(deadline.status || '').toLowerCase() === 'fixing')
      .slice(0, 4)
      .forEach((deadline) => {
        notifications.push({
          id: `fixing-${deadline.seriesId}-${deadline.chapterNumber}`,
          title: 'Bạn có lỗi cần sửa',
          message: `${getDeadlineLabel(deadline)}${deadline.feedback ? ` — ${deadline.feedback}` : ' đã được QC ghi nhận lỗi.'}`,
          action: 'Bấm để xem feedback',
          tone: 'danger',
          icon: IconAlertTriangle,
          view: 'deadlines'
        });
      });

    visibleDeadlines
      .filter((deadline) => !['fixing', 'done'].includes(String(deadline.status || '').toLowerCase()))
      .slice(0, 4)
      .forEach((deadline) => {
        notifications.push({
          id: `assigned-${deadline.seriesId}-${deadline.chapterNumber}`,
          title: 'Bạn có deadline mới',
          message: `${getDeadlineLabel(deadline)} đang được giao cho bạn.`,
          action: 'Bấm để xem deadline',
          tone: 'info',
          icon: IconClock,
          view: 'deadlines'
        });
      });
  } else {
    visibleDeadlines
      .filter((deadline) => String(deadline.status || '').toLowerCase() === 'submitted')
      .slice(0, 6)
      .forEach((deadline) => {
        notifications.push({
          id: `submitted-${deadline.seriesId}-${deadline.chapterNumber}`,
          title: 'Có deadline cần check',
          message: `${getDeadlineLabel(deadline)} đã được gửi lên, bấm để check lỗi do QC ghi nhận.`,
          action: 'Bấm để mở danh sách check',
          tone: 'warning',
          icon: IconAlertTriangle,
          view: 'deadlines'
        });
      });
  }

  return notifications;
}

function getDeadlineLabel(deadline) {
  const name = deadline.seriesName || `Bộ truyện #${deadline.seriesId ?? '—'}`;
  return `${name} · Chapter ${deadline.chapterNumber ?? '—'}`;
}
