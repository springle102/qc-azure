import React, { useMemo } from 'react';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconClock,
  IconRefresh,
  IconTrash,
  IconTasks
} from '../common/Icons';
import { showToast } from '../common/ToastContainer';

const isSubmitted = (item) => normalizeStatus(item) === 'submitted';
const isKpiComplete = (item, role) => normalizeStatus(item) === (role === 'Freelancer' ? 'submitted' : 'done');
const isFinishedForDashboard = (item) => ['submitted', 'checking', 'fixing', 'done'].includes(normalizeStatus(item));
const hasFreelancerAssignment = (item) => [item?.fId, item?.fIld, item?.freelancerId]
  .some((value) => value !== null && value !== undefined && String(value).trim() !== '');
const needsQC = (item) => {
  const status = String(item?.status || item?.statusRaw || '').trim().toLowerCase();
  return status === 'submitted' || /đã gửi|chờ qc|qc|review|duyệt|kiểm/.test(status);
};
const isDoing = (item) => normalizeStatus(item) === 'doing';
const isUpcoming = (item) => {
  const dueAt = getDueDate(item);
  if (!dueAt || isFinishedForDashboard(item)) return false;
  return getCalendarDateKey(dueAt) === getCalendarDateKey(Date.now());
};

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

export function DashboardView({ dashboard = {}, tasks = [], deadlines = [], freelancers = [], currentUser = {}, isLoading, onRefresh, onResetAll, onNavigate }) {
  const isFreelancer = currentUser.role === 'Freelancer';
  const canViewChecklists = ['Admin', 'Freelancer'].includes(currentUser.role);
  const [isResetting, setIsResetting] = React.useState(false);
  const freelancerTasks = useMemo(() => deadlines.length > 0 ? deadlines : tasks, [deadlines, tasks]);
  const fieldResources = useMemo(() => {
    if (Array.isArray(dashboard.fieldResources) && dashboard.fieldResources.length > 0) return dashboard.fieldResources;
    return [{ field: '', guideUrl: dashboard.guideUrl || '', resourceUrl: dashboard.resourceUrl || '', checklists: [] }];
  }, [dashboard]);
  const metrics = useMemo(() => ({
    waiting: Number.isFinite(Number(dashboard.waitingTasks)) ? Number(dashboard.waitingTasks) : tasks.filter((item) => !hasFreelancerAssignment(item)).length,
    assigned: Number.isFinite(Number(dashboard.assignedTasks)) ? Number(dashboard.assignedTasks) : tasks.filter(hasFreelancerAssignment).length,
    review: Number.isFinite(Number(dashboard.reviewTasks)) ? Number(dashboard.reviewTasks) : tasks.filter(needsQC).length,
    completed: Number.isFinite(Number(dashboard.completedTasks))
      ? Number(dashboard.completedTasks)
      : tasks.filter((item) => isKpiComplete(item, currentUser.role)).length
  }), [currentUser.role, dashboard, tasks]);
  const freelancerMetrics = useMemo(() => ({
    doing: Number.isFinite(Number(dashboard.inProgressTasks)) ? Number(dashboard.inProgressTasks) : freelancerTasks.filter(isDoing).length,
    upcoming: Array.isArray(dashboard.upcomingTasks) ? dashboard.upcomingTasks.length : freelancerTasks.filter(isUpcoming).length,
    completed: Number.isFinite(Number(dashboard.completedTasks))
      ? Number(dashboard.completedTasks)
      : freelancerTasks.filter((item) => isKpiComplete(item, 'Freelancer')).length
  }), [dashboard, freelancerTasks]);
  const upcomingTasks = useMemo(() => {
    if (Array.isArray(dashboard.upcomingTasks)) return dashboard.upcomingTasks;
    return freelancerTasks.filter(isUpcoming).sort((left, right) => getDueDate(left) - getDueDate(right));
  }, [dashboard, freelancerTasks]);

  const resetAll = async () => {
    if (!window.confirm('Bạn có chắc muốn reset toàn bộ dữ liệu deadline và lương về rỗng? Các account, freelancer, giá tiền và cấu hình sẽ được giữ nguyên.')) return;
    setIsResetting(true);
    try {
      await onResetAll?.();
      showToast('Đã reset dữ liệu deadline và lương.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể reset dữ liệu.', 'error');
    } finally {
      setIsResetting(false);
    }
  };

  const recentChaptersByRole = useMemo(() => {
    const records = deadlines.length ? deadlines : tasks;
    const recent = [...records]
      .sort((a, b) => getTaskReceivedTimestamp(b) - getTaskReceivedTimestamp(a));

    return {
      qc: recent.filter(isSubmitted).slice(0, 5),
      freelancer: recent.filter(hasFreelancerAssignment).slice(0, 5)
    };
  }, [deadlines, tasks]);

  const cards = isFreelancer ? [
    { label: 'Tổng task đang làm', value: freelancerMetrics.doing, tone: 'cyan', icon: IconTasks, desc: 'Đang thực hiện', percent: '45%' },
    { label: 'Tổng task sắp đến hạn', value: freelancerMetrics.upcoming, tone: 'amber', icon: IconAlertTriangle, desc: 'Ưu tiên hoàn thành', percent: '15%' },
    { label: 'Tổng task đã hoàn thành', value: freelancerMetrics.completed, tone: 'green', icon: IconCheckCircle, desc: 'Đạt chuẩn chất lượng', percent: '96%' }
  ] : [
    { label: 'Tổng task chờ giao', value: metrics.waiting, tone: 'cyan', icon: IconClock, desc: 'Đang chờ phân bổ', percent: '25%' },
    { label: 'Tổng task đã giao', value: metrics.assigned, tone: 'indigo', icon: IconTasks, desc: 'Đang thực hiện', percent: '68%' },
    { label: 'Task cần QC', value: metrics.review, tone: 'amber', icon: IconAlertTriangle, desc: 'Đang cần QC gấp', percent: '12%' },
    { label: 'Tổng task đã hoàn thành', value: metrics.completed, tone: 'green', icon: IconCheckCircle, desc: 'Đạt chuẩn chất lượng', percent: '96%' }
  ];

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">TỔNG QUAN HỆ THỐNG</span>
          <h2 className="page-title">Dashboard Studio</h2>
          <p className="page-subtitle">{isFreelancer ? 'Theo dõi deadline và lương của riêng bạn.' : 'Theo dõi deadline, chapter và chất lượng công việc toàn bộ studio.'}</p>
        </div>
        <div className="dashboard-header-actions">
          <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading || isResetting}>
            <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới dữ liệu'}
          </button>
          {currentUser.role === 'Admin' && (
            <button type="button" className="btn btn-danger dashboard-reset-button" onClick={resetAll} disabled={isLoading || isResetting}>
              <IconTrash size={16} /> {isResetting ? 'Đang reset...' : 'Reset all'}
            </button>
          )}
        </div>
      </div>

      {/* 4 Bento KPI Cards */}
      <div className="kpi-grid qc-kpi-grid">
        {cards.map(({ label, value, tone, icon: Icon, desc, percent }) => (
          <div className={`kpi-card qc-kpi-card tone-${tone}`} key={label}>
            <div className="kpi-top-row">
              <span className="kpi-title">{label}</span>
              <div className="kpi-icon-wrap"><Icon size={20} /></div>
            </div>
            <div className="kpi-bottom-row">
              <div>
                <div className="kpi-value">{value}</div>
                <div className="kpi-desc-status">{desc}</div>
              </div>
              <div className="kpi-mini-circle">{percent}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Bento Resource Links & Status Legend Row */}
      <div className="dashboard-bento-row">
        {/* Left: Tài nguyên & Hướng dẫn */}
        <div className="resource-bento-panel">
          <div className="bento-panel-title">Tài nguyên & Guide & Checklist</div>
          <div className="bento-panel-subtitle">Tài nguyên chính thức phục vụ cho công việc.</div>
          <div className="bento-resource-grid">
            {fieldResources.flatMap((resource, rIdx) => {
              const checklistCards = canViewChecklists && Array.isArray(resource.checklists)
                ? resource.checklists.map((checklist, index) => (
                  <div className="bento-resource-card" key={`cl-${rIdx}-${checklist.id || index}`}>
                    <div className="bento-resource-left">
                      <span className="bento-color-dot dot-emerald" />
                      <div className="bento-resource-text">
                        <strong>{checklist.name || 'Checklist kiểm duyệt'}</strong>
                        <span>{resource.field ? `Mảng ${resource.field}` : 'Quy chuẩn Studio'}</span>
                      </div>
                    </div>
                    {checklist.url ? (
                      <a href={checklist.url} target="_blank" rel="noreferrer" className="bento-resource-link">Xem link →</a>
                    ) : (
                      <span className="empty-inline" style={{ fontSize: 11 }}>Chưa có link</span>
                    )}
                  </div>
                ))
                : [];
              return [
                <div className="bento-resource-card" key={`g-${rIdx}`}>
                  <div className="bento-resource-left">
                    <span className="bento-color-dot dot-violet" />
                    <div className="bento-resource-text">
                      <strong>{resource.field ? `Guide ${resource.field}` : 'Guide Chuẩn Dịch Thuật'}</strong>
                      <span>Quy tắc chung</span>
                    </div>
                  </div>
                  {resource.guideUrl ? (
                    <a href={resource.guideUrl} target="_blank" rel="noreferrer" className="bento-resource-link">Xem link →</a>
                  ) : (
                    <span className="empty-inline" style={{ fontSize: 11 }}>Chưa có link</span>
                  )}
                </div>,
                <div className="bento-resource-card" key={`r-${rIdx}`}>
                  <div className="bento-resource-left">
                    <span className="bento-color-dot dot-cyan" />
                    <div className="bento-resource-text">
                      <strong>{resource.field ? `Tài nguyên ${resource.field}` : 'Drive Tài Nguyên Font & PSD'}</strong>
                      <span>Các action và file bóng đa dạng</span>
                    </div>
                  </div>
                  {resource.resourceUrl ? (
                    <a href={resource.resourceUrl} target="_blank" rel="noreferrer" className="bento-resource-link">Xem link →</a>
                  ) : (
                    <span className="empty-inline" style={{ fontSize: 11 }}>Chưa có link</span>
                  )}
                </div>,
                ...checklistCards
              ];
            })}
          </div>
        </div>

        {/* Right: Quy định trạng thái */}
        <div className="legend-bento-panel">
          <div className="bento-panel-title">Quy Định Trạng Thái</div>
          <div className="bento-panel-subtitle">Mã màu chuẩn của hệ thống QC:</div>
          <div className="legend-list">
            <div className="legend-item-row">
              <span>Đang thực hiện:</span>
              <span className="task-status-badge task-status-doing">Doing</span>
            </div>
            <div className="legend-item-row">
              <span>Đã nộp chờ duyệt:</span>
              <span className="task-status-badge task-status-submitted">Submitted</span>
            </div>
            <div className="legend-item-row">
              <span>Đang kiểm tra:</span>
              <span className="task-status-badge task-status-checking">Checking</span>
            </div>
            <div className="legend-item-row">
              <span>Có lỗi cần sửa:</span>
              <span className="task-status-badge task-status-fixing">Fixing</span>
            </div>
            <div className="legend-item-row">
              <span>Đã hoàn thành:</span>
              <span className="task-status-badge task-status-done">Done</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-two-column">
        {isFreelancer ? (
          <>
            <RecentChaptersPanel title="Deadline của tôi" chapters={recentChaptersByRole.freelancer} onNavigate={onNavigate} showDeadlineStatus />
            <UpcomingTasksPanel tasks={upcomingTasks} onNavigate={onNavigate} />
          </>
        ) : (
          <>
            <RecentChaptersPanel title="Danh sách chapter đang chờ QC" chapters={recentChaptersByRole.qc} onNavigate={onNavigate} showQcStatus />
            <RecentChaptersPanel title="Các task được giao gần đây" chapters={recentChaptersByRole.freelancer} freelancers={freelancers} onNavigate={onNavigate} showAssignmentDetails />
          </>
        )}
      </div>
    </div>
  );
}

function UpcomingTasksPanel({ tasks, onNavigate }) {
  return (
    <section className="glass-panel dashboard-section upcoming-tasks-panel">
      <div className="section-heading">
        <div>
          <span className="qc-kicker">CẦN ƯU TIÊN</span>
          <h3>Task sắp đến hạn</h3>
        </div>
        <button type="button" className="text-button" onClick={() => onNavigate('deadlines')}>Mở danh sách</button>
      </div>

      {tasks.length === 0 ? (
        <div className="empty-state compact">
          <IconCheckCircle size={26} />
          <strong>Không có task sắp đến hạn</strong>
          <span>Các task có Hạn DL trong ngày hôm nay và chưa Submitted sẽ xuất hiện ở đây.</span>
        </div>
      ) : (
        <div className="upcoming-tasks-table-wrap">
          <table className="custom-table upcoming-tasks-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Hạn</th>
                <th>Còn lại</th>
                <th>Nhắc hạn</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, index) => (
                <tr key={`${task.seriesId || task.id || 'task'}-${task.chapterNumber || index}`}>
                  <td>
                    <strong>{task.seriesName || task.series || 'Chưa đặt tên bộ truyện'}</strong>
                    <span>Chapter {task.chapterNumber ?? task.chapter ?? '—'}</span>
                  </td>
                  <td>{formatDateTime(getDueDate(task))}</td>
                  <td><span className="upcoming-time-badge">{formatTimeRemaining(getDueDate(task))}</span></td>
                  <td><DeadlineStatusBadge item={task} upcoming /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecentChaptersPanel({ title, chapters, freelancers = [], onNavigate, showDeadlineStatus = false, showQcStatus = false, showAssignmentDetails = false }) {
  return (
    <section className="glass-panel dashboard-section">
      <div className="section-heading">
        <div>
          <span className="qc-kicker">CẬP NHẬT GẦN ĐÂY</span>
          <h3>{title}</h3>
        </div>
        <button type="button" className="text-button" onClick={() => onNavigate('deadlines')}>Mở danh sách</button>
      </div>

      {chapters.length === 0 ? (
        <div className="empty-state compact">
          <IconClock size={26} />
          <strong>Chưa có chapter gần đây</strong>
          <span>Danh sách sẽ được lấy trực tiếp từ bảng deadline.</span>
        </div>
      ) : (
        <div className="recent-chapter-list">
          {chapters.map((chapter, index) => (
            <div className="recent-chapter-row" key={`${chapter.seriesId || chapter.id || 'chapter'}-${chapter.chapterNumber || index}`}>
              <div>
                <strong>{chapter.seriesName || chapter.series || 'Chưa đặt tên bộ truyện'}</strong>
                <span>ID bộ truyện: {chapter.seriesId ?? '—'} · Chapter {chapter.chapterNumber ?? chapter.chapter ?? '—'} · {showAssignmentDetails ? `Thời gian giao: ${formatReceivedTime(chapter)}` : `Hạn ${formatDate(chapter.endTask || chapter.deadline)}`}</span>
                {showAssignmentDetails && (
                  <span>Freelancer: {getFreelancerName(chapter, freelancers)}</span>
                )}
              </div>
              {showQcStatus ? <span className="data-status pending">Chờ QC</span> : showDeadlineStatus ? <DeadlineStatusBadge item={chapter} /> : showAssignmentDetails ? <AssignedTaskStatusBadge item={chapter} /> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AssignedTaskStatusBadge({ item }) {
  const status = normalizeStatus(item);
  const labels = {
    doing: 'Đang thực hiện',
    submitted: 'Đã nộp',
    checking: 'Đang kiểm tra',
    fixing: 'Có lỗi cần sửa',
    done: 'Đã hoàn thành'
  };
  const className = status === 'done' ? 'success' : status === 'fixing' ? 'overdue' : 'pending';
  return <span className={`data-status ${className}`}>{labels[status] || 'Chưa bắt đầu'}</span>;
}

function DeadlineStatusBadge({ item, upcoming = false }) {
  if (!hasTaskStatus(item)) return null;
  const status = upcoming ? getUpcomingTaskStatus(item) : getDashboardDeadlineStatus(item);
  if (!status) return null;
  return <span className={`data-status ${status.className}`}>{status.label}</span>;
}

function hasTaskStatus(item) {
  return String(item?.status ?? '').trim() !== '';
}

function normalizeStatus(item) {
  const value = String(item?.status ?? '').trim().toLowerCase();
  if (value === 'doing' || /đang thực hiện|đang làm/.test(value)) return 'doing';
  if (value === 'submitted' || /đã gửi|chờ qc/.test(value)) return 'submitted';
  if (value === 'done' || /hoàn thành|completed|complete/.test(value)) return 'done';
  return value;
}

function getFreelancerName(item, freelancers) {
  const freelancerId = item?.fIld ?? item?.fId ?? item?.freelancerId;
  const freelancer = freelancers.find((candidate) => (
    String(candidate.fIld ?? candidate.fId ?? candidate.id ?? '') === String(freelancerId ?? '')
  ));
  return freelancer?.name || freelancer?.displayName || item?.freelancerName || (freelancerId ? `FLID ${freelancerId}` : 'Chưa giao');
}

function getTaskReceivedTimestamp(item) {
  const timestamps = [item?.receivedAt, item?.createdAt, item?.assignedAt]
    .map((value) => new Date(value || 0).getTime())
    .filter(Number.isFinite);
  return Math.max(0, ...timestamps);
}

function formatReceivedTime(item) {
  const receivedTimestamp = getTaskReceivedTimestamp(item);
  if (!receivedTimestamp) return 'Chưa ghi nhận';
  return formatActivityDateTime(new Date(receivedTimestamp));
}

function formatActivityDateTime(value) {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value);
}

function getDueDate(item) {
  const value = item?.endTask || item?.deadline || item?.dueDate;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDeadlineOverdue(item) {
  const dueAt = getDueDate(item);
  return Boolean(dueAt && dueAt.getTime() < Date.now() && !isFinishedForDashboard(item));
}

function getDashboardDeadlineStatus(item) {
  if (!hasTaskStatus(item)) return null;
  if (isFinishedForDashboard(item)) return { label: 'Đã hoàn thành', className: 'success' };
  if (isDeadlineOverdue(item)) return { label: 'Đã quá hạn', className: 'overdue' };
  return { label: 'Sắp đến hạn', className: 'pending' };
}

function getUpcomingTaskStatus(item) {
  if (!hasTaskStatus(item)) return null;
  if (isFinishedForDashboard(item)) return { label: 'Đã hoàn thành', className: 'success' };
  if (isDeadlineOverdue(item)) return { label: 'Đã quá hạn', className: 'overdue' };
  const dueAt = getDueDate(item);
  if (!dueAt) return { label: 'Sắp đến hạn', className: 'pending' };
  const dayMonth = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(dueAt);
  return { label: `Hôm nay ${dayMonth}`, className: 'pending' };
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

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value);
}

function formatTimeRemaining(value) {
  if (!value) return '—';
  const minutes = Math.ceil((value.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return 'Đã quá hạn';
  if (minutes < 60) return `${minutes} phút`;
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
}
