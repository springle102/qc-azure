import React, { useMemo } from 'react';
import {
  IconAlertTriangle,
  IconBook,
  IconCheckCircle,
  IconClock,
  IconExternalLink,
  IconFolder,
  IconRefresh,
  IconTrash,
  IconTasks
} from '../common/Icons';
import { showToast } from '../common/ToastContainer';

const isComplete = (item) => normalizeStatus(item) === 'submitted';
const isKpiComplete = (item, role) => normalizeStatus(item) === (role === 'Freelancer' ? 'submitted' : 'done');
const isFinishedForDashboard = (item) => ['submitted', 'checking', 'fixing', 'done'].includes(normalizeStatus(item));
const hasFreelancerAssignment = (item) => [item?.fId, item?.fIld, item?.freelancerId]
  .some((value) => value !== null && value !== undefined && String(value).trim() !== '');
const isAssignedToQC = (item) => Boolean(item?.qcId || item?.qcld || item?.qcID || item?.qcName);
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

function LinkCard({ icon: Icon, label, value, linkText = 'Xem tại đây' }) {
  const hasLink = Boolean(value);
  return (
    <div className="dashboard-link-card">
      <div className="dashboard-link-icon"><Icon size={20} /></div>
      <div className="dashboard-link-content">
        <span>{label}</span>
        {hasLink ? (
          <a href={value} target="_blank" rel="noreferrer" title={linkText}>{linkText}</a>
        ) : (
          <strong className="empty-inline">Chưa có đường dẫn</strong>
        )}
      </div>
      {hasLink && <IconExternalLink size={16} className="dashboard-link-arrow" />}
    </div>
  );
}

export function DashboardView({ dashboard = {}, tasks = [], deadlines = [], currentUser = {}, isLoading, onRefresh, onResetAll, onNavigate }) {
  const isFreelancer = currentUser.role === 'Freelancer';
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
      .sort((a, b) => new Date(b.endTask || b.deadline || 0) - new Date(a.endTask || a.deadline || 0));

    return {
      qc: recent.filter(isAssignedToQC).slice(0, 5),
      freelancer: recent.filter(hasFreelancerAssignment).slice(0, 5)
    };
  }, [deadlines, tasks]);

  const cards = isFreelancer ? [
    { label: 'Tổng task đang làm', value: freelancerMetrics.doing, tone: 'cyan', icon: IconTasks },
    { label: 'Tổng task sắp đến hạn', value: freelancerMetrics.upcoming, tone: 'amber', icon: IconAlertTriangle },
    { label: 'Tổng task đã hoàn thành', value: freelancerMetrics.completed, tone: 'green', icon: IconCheckCircle }
  ] : [
    { label: 'Tổng task chờ giao', value: metrics.waiting, tone: 'blue', icon: IconClock },
    { label: 'Tổng task đã giao', value: metrics.assigned, tone: 'cyan', icon: IconTasks },
    { label: 'Task cần QC', value: metrics.review, tone: 'amber', icon: IconAlertTriangle },
    { label: 'Tổng task đã hoàn thành', value: metrics.completed, tone: 'green', icon: IconCheckCircle }
  ];

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">TỔNG QUAN</span>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-subtitle">{isFreelancer ? 'Theo dõi deadline và lương của riêng bạn.' : 'Theo dõi deadline, chapter và chất lượng công việc.'}</p>
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

      <div className="dashboard-link-grid">
        {fieldResources.flatMap((resource) => {
          const checklistCards = isFreelancer && Array.isArray(resource.checklists)
            ? resource.checklists.map((checklist, index) => (
              <LinkCard
                key={`${resource.field || 'default'}-checklist-${checklist.id || index}`}
                icon={IconCheckCircle}
                label={`${checklist.name || 'Checklist'}${resource.field ? ` · ${resource.field}` : ''}`}
                value={checklist.url}
                linkText="Xem checklist tại đây"
              />
            ))
            : [];
          return [
            <LinkCard key={`${resource.field || 'default'}-guide`} icon={IconBook} label={resource.field ? `Guide · ${resource.field}` : 'Guide'} value={resource.guideUrl} linkText="Xem guide tại đây" />,
            <LinkCard key={`${resource.field || 'default'}-resource`} icon={IconFolder} label={resource.field ? `Tài nguyên · ${resource.field}` : 'Tài nguyên'} value={resource.resourceUrl} linkText="Xem tài nguyên tại đây" />,
            ...checklistCards
          ];
        })}
      </div>

      <div className="kpi-grid qc-kpi-grid">
        {cards.map(({ label, value, tone, icon: Icon }) => (
          <div className={`kpi-card qc-kpi-card tone-${tone}`} key={label}>
            <div className="kpi-top-row">
              <span className="kpi-title">{label}</span>
              <div className="kpi-icon-wrap"><Icon size={20} /></div>
            </div>
            <div className="kpi-value">{value}</div>
            <span className="kpi-caption">Theo dữ liệu hiện có</span>
          </div>
        ))}
      </div>

      <div className="dashboard-two-column">
        {isFreelancer ? (
          <>
            <RecentChaptersPanel title="Deadline của tôi" chapters={recentChaptersByRole.freelancer} onNavigate={onNavigate} showDeadlineStatus />
            <UpcomingTasksPanel tasks={upcomingTasks} onNavigate={onNavigate} />
          </>
        ) : (
          <>
            <RecentChaptersPanel title="Danh sách chapter QC" chapters={recentChaptersByRole.qc} onNavigate={onNavigate} />
            <RecentChaptersPanel title="Danh sách chapter Freelancer" chapters={recentChaptersByRole.freelancer} onNavigate={onNavigate} />
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

function RecentChaptersPanel({ title, chapters, onNavigate, showDeadlineStatus = false }) {
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
                <span>Chapter {chapter.chapterNumber ?? chapter.chapter ?? '—'} · Hạn {formatDate(chapter.endTask || chapter.deadline)}</span>
              </div>
              {showDeadlineStatus ? <DeadlineStatusBadge item={chapter} /> : (
                <span className={`data-status ${isComplete(chapter) ? 'success' : 'pending'}`}>
                  {chapter.statusRaw || chapter.status || 'Chưa có trạng thái'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
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
