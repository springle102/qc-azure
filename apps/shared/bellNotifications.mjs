export function buildBellNotifications(deadlines, errors, currentUser, now = Date.now()) {
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
          target: deadlineTarget(deadline),
          title: 'Bạn có lỗi cần sửa',
          message: `${getDeadlineLabel(deadline)}${deadline.feedback ? ` — ${deadline.feedback}` : ' đã được QC ghi nhận lỗi.'}`,
          action: 'Bấm để xem feedback',
          tone: 'danger',
          icon: 'alert',
          timestamp: getNotificationTimestamp(deadline, ['updatedAt', 'submittedAt', 'doingStartedAt']),
          view: 'deadlines'
        });
      });

    errors
      .filter((error) => !error.fixCheck && isErrorAssignedToUser(error, userId, currentUser))
      .forEach((error) => {
        notifications.push({
          id: `error-${error.id}`,
          target: { errorId: String(error.id) },
          title: 'Bạn có lỗi cần kiểm tra',
          message: `${error.title || 'Task'} · Chapter ${error.chapter || '—'}${error.error ? ` — ${error.error}` : ''}`,
          action: 'Bấm để mở Quản lý lỗi',
          tone: 'danger',
          icon: 'alert',
          timestamp: getNotificationTimestamp(error, ['updatedAt', 'createdAt']),
          view: 'errors'
        });
      });

    visibleDeadlines
      .filter((deadline) => !hasTaskStatus(deadline) && isRawReady(deadline))
      .forEach((deadline) => {
        notifications.push({
          id: `raw-${deadline.seriesId}-${deadline.chapterNumber}`,
          target: deadlineTarget(deadline),
          title: 'Đã có raw',
          message: `Đã có raw cho task ${deadline.seriesId ?? '—'}. ${deadline.seriesName || '—'} ${deadline.chapterNumber ?? '—'}`,
          action: 'Bấm vào đây để xem',
          tone: 'success',
          icon: 'check',
          timestamp: getNotificationTimestamp(deadline, ['updatedAt', 'statusRawUpdatedAt', 'rawUpdatedAt']),
          view: 'deadlines'
        });
      });

    visibleDeadlines
      .filter((deadline) => normalizeHeaderStatus(deadline) !== 'submitted' && isDueToday(deadline, now))
      .forEach((deadline) => {
        notifications.push({
          id: `upcoming-${deadline.seriesId}-${deadline.chapterNumber}`,
          target: deadlineTarget(deadline),
          revision: getCalendarDateKey(deadline.endTask || deadline.deadline || deadline.dueDate),
          title: 'Task sắp đến hạn',
          message: `${getDeadlineLabel(deadline)} có Hạn DL trong hôm nay.`,
          action: 'Bấm để xem deadline',
          tone: 'warning',
          icon: 'clock',
          timestamp: getNotificationTimestamp(deadline, ['updatedAt', 'createdAt']),
          view: 'deadlines'
        });
      });

    visibleDeadlines
      .filter((deadline) => (
        !['fixing', 'done', 'submitted'].includes(normalizeHeaderStatus(deadline))
        && !isDueToday(deadline, now)
      ))
      .forEach((deadline) => {
        notifications.push({
          id: `assigned-${deadline.seriesId}-${deadline.chapterNumber}`,
          target: deadlineTarget(deadline),
          revision: getCalendarDateKey(deadline.endTask || deadline.deadline || deadline.dueDate),
          title: 'Bạn có deadline mới',
          message: `${getDeadlineLabel(deadline)} đang được giao cho bạn.`,
          action: 'Bấm để xem deadline',
          tone: 'info',
          icon: 'clock',
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

function isDueToday(deadline, now = Date.now()) {
  const value = deadline?.endTask || deadline?.deadline || deadline?.dueDate;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return getCalendarDateKey(date) === getCalendarDateKey(now);
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

function deadlineTarget(deadline) {
  return { seriesId: String(deadline.seriesId ?? ''), chapterNumber: String(deadline.chapterNumber ?? '') };
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
