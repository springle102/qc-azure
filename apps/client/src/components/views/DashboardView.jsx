import React, { useMemo } from 'react';
import {
  IconAlertTriangle,
  IconBook,
  IconCheckCircle,
  IconClock,
  IconExternalLink,
  IconFolder,
  IconRefresh,
  IconTasks
} from '../common/Icons';

const isComplete = (item) => ['hoàn thành', 'completed', 'done', 'complete'].includes(String(item?.status || item?.statusRaw || '').trim().toLowerCase());
const isAssigned = (item) => Boolean(item?.fId || item?.fIld || item?.freelancerId || item?.assignedToId || item?.assignedTo);
const isAssignedToQC = (item) => Boolean(item?.qcId || item?.qcld || item?.qcID || item?.qcName);
const needsQC = (item) => /qc|review|duyệt|kiểm/i.test(String(item?.status || item?.statusRaw || ''));
const isDoing = (item) => normalizeStatus(item) === 'doing';
const isUpcoming = (item) => {
  const dueAt = getDueDate(item);
  const status = normalizeStatus(item);
  if (!dueAt || ['submitted', 'done'].includes(status)) return false;
  const remaining = dueAt.getTime() - Date.now();
  return remaining >= 0 && remaining <= 3 * 60 * 60 * 1000;
};

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

function LinkCard({ icon: Icon, label, value }) {
  const hasLink = Boolean(value);
  return (
    <div className="dashboard-link-card">
      <div className="dashboard-link-icon"><Icon size={20} /></div>
      <div className="dashboard-link-content">
        <span>{label}</span>
        {hasLink ? (
          <a href={value} target="_blank" rel="noreferrer" title={value}>{value}</a>
        ) : (
          <strong className="empty-inline">Chưa có đường dẫn</strong>
        )}
      </div>
      {hasLink && <IconExternalLink size={16} className="dashboard-link-arrow" />}
    </div>
  );
}

export function DashboardView({ dashboard = {}, tasks = [], deadlines = [], currentUser = {}, isLoading, onRefresh, onNavigate }) {
  const isFreelancer = currentUser.role === 'Freelancer';
  const freelancerTasks = useMemo(() => deadlines.length > 0 ? deadlines : tasks, [deadlines, tasks]);
  const fieldResources = useMemo(() => {
    if (Array.isArray(dashboard.fieldResources) && dashboard.fieldResources.length > 0) return dashboard.fieldResources;
    return [{ field: '', guideUrl: dashboard.guideUrl || '', resourceUrl: dashboard.resourceUrl || '' }];
  }, [dashboard]);
  const metrics = useMemo(() => ({
    waiting: Number.isFinite(Number(dashboard.waitingTasks)) ? Number(dashboard.waitingTasks) : tasks.filter((item) => !isAssigned(item)).length,
    assigned: Number.isFinite(Number(dashboard.assignedTasks)) ? Number(dashboard.assignedTasks) : tasks.filter(isAssigned).length,
    review: Number.isFinite(Number(dashboard.reviewTasks)) ? Number(dashboard.reviewTasks) : tasks.filter(needsQC).length,
    completed: Number.isFinite(Number(dashboard.completedTasks)) ? Number(dashboard.completedTasks) : tasks.filter(isComplete).length
  }), [dashboard, tasks]);
  const freelancerMetrics = useMemo(() => ({
    doing: Number.isFinite(Number(dashboard.inProgressTasks)) ? Number(dashboard.inProgressTasks) : freelancerTasks.filter(isDoing).length,
    upcoming: Array.isArray(dashboard.upcomingTasks) ? dashboard.upcomingTasks.length : freelancerTasks.filter(isUpcoming).length,
    completed: Number.isFinite(Number(dashboard.completedTasks)) ? Number(dashboard.completedTasks) : freelancerTasks.filter(isComplete).length
  }), [dashboard, freelancerTasks]);
  const upcomingTasks = useMemo(() => {
    if (Array.isArray(dashboard.upcomingTasks)) return dashboard.upcomingTasks;
    return freelancerTasks.filter(isUpcoming).sort((left, right) => getDueDate(left) - getDueDate(right));
  }, [dashboard, freelancerTasks]);

  const recentChaptersByRole = useMemo(() => {
    const records = deadlines.length ? deadlines : tasks;
    const recent = [...records]
      .sort((a, b) => new Date(b.endTask || b.deadline || 0) - new Date(a.endTask || a.deadline || 0));

    return {
      qc: recent.filter(isAssignedToQC).slice(0, 5),
      freelancer: recent.filter(isAssigned).slice(0, 5)
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
          <h2 className="page-title">{isFreelancer ? 'Dashboard Freelancer' : 'Dashboard QC'}</h2>
          <p className="page-subtitle">{isFreelancer ? 'Theo dõi deadline và lương của riêng bạn.' : 'Theo dõi deadline, chapter và chất lượng công việc.'}</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
          <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới dữ liệu'}
        </button>
      </div>

      <div className="dashboard-link-grid">
        {fieldResources.flatMap((resource) => [
          <LinkCard key={`${resource.field || 'default'}-guide`} icon={IconBook} label={resource.field ? `Guide · ${resource.field}` : 'Guide'} value={resource.guideUrl} />,
          <LinkCard key={`${resource.field || 'default'}-resource`} icon={IconFolder} label={resource.field ? `Tài nguyên · ${resource.field}` : 'Tài nguyên'} value={resource.resourceUrl} />
        ])}
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
            <RecentChaptersPanel title="Deadline của tôi" chapters={recentChaptersByRole.freelancer} onNavigate={onNavigate} />
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
          <span>Các task còn tối đa 3 giờ và chưa Submitted sẽ xuất hiện ở đây.</span>
        </div>
      ) : (
        <div className="upcoming-tasks-table-wrap">
          <table className="custom-table upcoming-tasks-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Hạn</th>
                <th>Còn lại</th>
                <th>Trạng thái</th>
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
                  <td><span className="data-status pending">{task.statusRaw || task.status || 'Chưa bắt đầu'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecentChaptersPanel({ title, chapters, onNavigate }) {
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
              <span className={`data-status ${isComplete(chapter) ? 'success' : 'pending'}`}>
                {chapter.statusRaw || chapter.status || 'Chưa có trạng thái'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function normalizeStatus(item) {
  const value = String(item?.status || item?.statusRaw || '').trim().toLowerCase();
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

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value);
}

function formatTimeRemaining(value) {
  if (!value) return '—';
  const minutes = Math.max(0, Math.ceil((value.getTime() - Date.now()) / 60000));
  if (minutes < 60) return `${minutes} phút`;
  return `${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
}
