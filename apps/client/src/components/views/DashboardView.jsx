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
const needsQC = (item) => /qc|review|duyệt|kiểm/i.test(String(item?.status || item?.statusRaw || ''));

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

export function DashboardView({ dashboard = {}, tasks = [], deadlines = [], isLoading, onRefresh, onNavigate }) {
  const metrics = useMemo(() => ({
    waiting: Number.isFinite(Number(dashboard.waitingTasks)) ? Number(dashboard.waitingTasks) : tasks.filter((item) => !isAssigned(item)).length,
    assigned: Number.isFinite(Number(dashboard.assignedTasks)) ? Number(dashboard.assignedTasks) : tasks.filter(isAssigned).length,
    review: Number.isFinite(Number(dashboard.reviewTasks)) ? Number(dashboard.reviewTasks) : tasks.filter(needsQC).length,
    completed: Number.isFinite(Number(dashboard.completedTasks)) ? Number(dashboard.completedTasks) : tasks.filter(isComplete).length
  }), [dashboard, tasks]);

  const recentChapters = useMemo(() => {
    const records = deadlines.length ? deadlines : tasks;
    return [...records]
      .sort((a, b) => new Date(b.endTask || b.deadline || b.startTask || 0) - new Date(a.endTask || a.deadline || a.startTask || 0))
      .slice(0, 5);
  }, [deadlines, tasks]);

  const cards = [
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
          <h2 className="page-title">Dashboard QC</h2>
          <p className="page-subtitle">Theo dõi deadline, chapter và chất lượng công việc.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
          <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới dữ liệu'}
        </button>
      </div>

      <div className="dashboard-link-grid">
        <LinkCard icon={IconBook} label="Guide" value={dashboard.guideUrl} />
        <LinkCard icon={IconFolder} label="Tài nguyên" value={dashboard.resourceUrl} />
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

      <div className="dashboard-single-column">
        <section className="glass-panel dashboard-section">
          <div className="section-heading">
            <div>
              <span className="qc-kicker">CẬP NHẬT GẦN ĐÂY</span>
              <h3>Danh sách chapter</h3>
            </div>
            <button type="button" className="text-button" onClick={() => onNavigate('deadlines')}>Mở danh sách</button>
          </div>

          {recentChapters.length === 0 ? (
            <div className="empty-state compact">
              <IconClock size={26} />
              <strong>Chưa có chapter gần đây</strong>
              <span>Danh sách sẽ được lấy trực tiếp từ bảng deadline.</span>
            </div>
          ) : (
            <div className="recent-chapter-list">
              {recentChapters.map((chapter, index) => (
                <div className="recent-chapter-row" key={chapter.seriesId || chapter.id || index}>
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
      </div>
    </div>
  );
}
