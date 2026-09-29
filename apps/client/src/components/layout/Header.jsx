import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconBell, IconCheckCircle, IconChevronRight, IconClock, IconMenu, IconMoon, IconSun, IconUser } from '../common/Icons';

export function Header({ currentUser, deadlines = [], errors = [], onNavigate, onOpenProfile, onToggleSidebar, isDarkMode = true, onToggleTheme }) {
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState([]);
  const notificationRef = useRef(null);
  const notifications = useMemo(() => buildNotifications(deadlines, errors, currentUser), [currentUser, deadlines, errors]);
  const unreadCount = notifications.filter((notification) => !readNotificationIds.includes(notification.id)).length;
  const ThemeIcon = isDarkMode ? IconSun : IconMoon;
  const themeLabel = isDarkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';

  const todayDateKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const urgentCount = useMemo(() => {
    return (deadlines || []).filter((item) => {
      const end = String(item.endTask || '').trim();
      const status = String(item.status || '').toLowerCase();
      return end.startsWith(todayDateKey) && !['submitted', 'done'].includes(status);
    }).length;
  }, [deadlines, todayDateKey]);

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
          <h1 className="qc-header-title">Workspace Studio</h1>
        </div>
      </div>

      <div className="qc-header-actions">
        {currentUser?.role !== 'Freelancer' && urgentCount > 0 && (
          <div className="qc-header-ticker" title="Các chapter có hạn hôm nay cần hoàn thành / kiểm duyệt">
            <span className="qc-ticker-dot" />
            <span>Hôm nay: <strong>{urgentCount} chapter</strong> cần QC gấp</span>
          </div>
        )}
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
    </header>
  );
}

function buildNotifications(deadlines, errors, currentUser) {
  const role = currentUser?.role;
  const userId = currentUser?.freelancerId ?? currentUser?.fIld;
  const visibleDeadlines = role === 'Freelancer'
    ? deadlines.filter((deadline) => {
      const assignedId = deadline.fIld ?? deadline.fId ?? deadline.freelancerId;
      return assignedId !== null
        && assignedId !== undefined
        && assignedId !== ''
        && userId !== null
        && userId !== undefined
        && userId !== ''
        && String(assignedId) === String(userId);
    })
    : deadlines;
  const notifications = [];

  if (role === 'Freelancer') {
    visibleDeadlines
      .filter((deadline) => String(deadline.status || '').toLowerCase() === 'fixing')
      .forEach((deadline) => {
        notifications.push({
          id: `fixing-${deadline.seriesId}-${deadline.chapterNumber}`,
          title: 'Bạn có lỗi cần sửa',
          message: `${getDeadlineLabel(deadline)}${deadline.feedback ? ` — ${deadline.feedback}` : ' đã được QC ghi nhận lỗi.'}`,
          action: 'Bấm để xem feedback',
          tone: 'danger',
          icon: IconAlertTriangle,
          timestamp: getNotificationTimestamp(deadline, ['updatedAt', 'submittedAt', 'doingStartedAt']),
          view: 'deadlines'
        });
      });

    errors
      .filter((error) => !error.fixCheck && isErrorAssignedToUser(error, userId, currentUser))
      .forEach((error) => {
        notifications.push({
          id: `error-${error.id}`,
          title: 'Bạn có lỗi cần kiểm tra',
          message: `${error.title || 'Task'} · Chapter ${error.chapter || '—'}${error.error ? ` — ${error.error}` : ''}`,
          action: 'Bấm để mở Quản lý lỗi',
          tone: 'danger',
          icon: IconAlertTriangle,
          timestamp: getNotificationTimestamp(error, ['updatedAt', 'createdAt']),
          view: 'errors'
        });
      });

    visibleDeadlines
      .filter((deadline) => !hasTaskStatus(deadline) && isRawReady(deadline))
      .forEach((deadline) => {
        notifications.push({
          id: `raw-${deadline.seriesId}-${deadline.chapterNumber}`,
          title: 'Đã có raw',
          message: `Đã có raw cho task ${deadline.seriesId ?? '—'}. ${deadline.seriesName || '—'} ${deadline.chapterNumber ?? '—'}`,
          action: 'Bấm vào đây để xem',
          tone: 'success',
          icon: IconCheckCircle,
          timestamp: getNotificationTimestamp(deadline, ['updatedAt', 'statusRawUpdatedAt', 'rawUpdatedAt']),
          view: 'deadlines'
        });
      });

    visibleDeadlines
      .filter((deadline) => normalizeHeaderStatus(deadline) !== 'submitted' && isDueToday(deadline))
      .forEach((deadline) => {
        notifications.push({
          id: `upcoming-${deadline.seriesId}-${deadline.chapterNumber}`,
          title: 'Task sắp đến hạn',
          message: `${getDeadlineLabel(deadline)} có Hạn DL trong hôm nay.`,
          action: 'Bấm để xem deadline',
          tone: 'warning',
          icon: IconClock,
          timestamp: getNotificationTimestamp(deadline, ['updatedAt', 'createdAt']),
          view: 'deadlines'
        });
      });

    visibleDeadlines
      .filter((deadline) => (
        !['fixing', 'done', 'submitted'].includes(normalizeHeaderStatus(deadline))
        && !isDueToday(deadline)
      ))
      .forEach((deadline) => {
        notifications.push({
          id: `assigned-${deadline.seriesId}-${deadline.chapterNumber}`,
          title: 'Bạn có deadline mới',
          message: `${getDeadlineLabel(deadline)} đang được giao cho bạn.`,
          action: 'Bấm để xem deadline',
          tone: 'info',
          icon: IconClock,
          timestamp: getNotificationTimestamp(deadline, ['updatedAt', 'createdAt']),
          view: 'deadlines'
        });
      });
  }

  return notifications;
}

function normalizeHeaderStatus(item) {
  const value = String(item?.status || item?.statusRaw || '').trim().toLowerCase();
  if (value === 'submitted' || /đã gửi|chờ qc/.test(value)) return 'submitted';
  if (value === 'fixing' || /sửa|fix/.test(value)) return 'fixing';
  if (value === 'done' || /hoàn thành|completed|complete/.test(value)) return 'done';
  return value;
}

function hasTaskStatus(item) {
  return String(item?.status ?? '').trim() !== '';
}

function isRawReady(deadline) {
  const value = String(deadline?.statusRaw ?? deadline?.rawStatus ?? deadline?.file ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'done', 'completed', 'hoàn thành', 'đã hoàn thành', 'đã up raw'].includes(value);
}

function isDueToday(deadline) {
  const value = deadline?.endTask || deadline?.deadline || deadline?.dueDate;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return getCalendarDateKey(date) === getCalendarDateKey(Date.now());
}

function getCalendarDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getDeadlineLabel(deadline) {
  const name = deadline.seriesName || `Bộ truyện #${deadline.seriesId ?? '—'}`;
  return `${name} · Chapter ${deadline.chapterNumber ?? '—'}`;
}

function isErrorAssignedToUser(error, userId, currentUser) {
  const assignedId = error?.editorFreelancerId ?? error?.editorId;
  if (assignedId !== null && assignedId !== undefined && assignedId !== '' && userId !== null && userId !== undefined && userId !== '') {
    return String(assignedId) === String(userId);
  }
  const assignedName = String(error?.editor || '').trim().toLowerCase();
  const currentName = String(currentUser?.name || '').trim().toLowerCase();
  return Boolean(assignedName && currentName && assignedName === currentName);
}

function getNotificationTimestamp(item, keys = []) {
  for (const key of keys) {
    const timestamp = new Date(item?.[key] ?? '').getTime();
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
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
