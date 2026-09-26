import React from 'react';
import {
  IconDashboard,
  IconUsers,
  IconTasks,
  IconUser,
  IconLogOut
} from '../common/Icons';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: IconDashboard },
  { id: 'freelancers', label: 'Quản lý freelancer', icon: IconUsers },
  { id: 'deadlines', label: 'Quản lý Deadline', icon: IconTasks },
  { id: 'pricing', label: 'Giá tiền', icon: IconTasks },
  { id: 'settings', label: 'Cấu hình chung', icon: IconTasks },
  { id: 'salary', label: 'Lương', icon: IconUsers },
  { id: 'profile', label: 'Hồ sơ cá nhân', icon: IconUser }
];

const ROLE_VIEWS = {
  Admin: ['dashboard', 'freelancers', 'deadlines', 'pricing', 'settings', 'salary', 'profile'],
  QC: ['dashboard', 'profile', 'salary', 'deadlines'],
  Freelancer: ['dashboard', 'profile', 'salary', 'deadlines']
};

export function Sidebar({ currentView, onNavigate, currentUser, role = 'QC', onOpenLogout, isOpen = false }) {
  const visibleItems = NAV_ITEMS
    .filter(({ id }) => (ROLE_VIEWS[role] || ROLE_VIEWS.Freelancer).includes(id))
    .map((item) => item.id === 'deadlines' && role === 'Freelancer' ? { ...item, label: 'Deadline của tôi' } : item);

  return (
    <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
      <div className="qc-sidebar-brand">
        <div className="qc-sidebar-mark">Q</div>
        <div>
          <strong>QC WEBTOON</strong>
          <span>DEADLINE MANAGEMENT</span>
        </div>
      </div>

      <div className="sidebar-section-title">{role === 'Freelancer' ? 'Không gian Freelancer' : 'Không gian QC'}</div>
      <nav className="qc-sidebar-nav" aria-label={role === 'Freelancer' ? 'Điều hướng Freelancer' : 'Điều hướng QC'}>
        {visibleItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className={`nav-link ${currentView === id ? 'active' : ''}`}
          >
            <span className="nav-link-left">
              <Icon size={18} />
              <span>{label}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="qc-sidebar-note">
        <span className="status-dot" />
        <div>
          <strong>Dữ liệu trực tiếp</strong>
          <span>Kết nối qua API / Supabase</span>
        </div>
      </div>

      <div className="sidebar-user-card qc-sidebar-user">
        <div className="qc-avatar-placeholder" aria-hidden="true">
          {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : 'Q'}
        </div>
        <div className="qc-user-label">
          <strong>{currentUser?.name || currentUser?.username || 'Account'}</strong>
          <span>{currentUser?.role || '—'}</span>
        </div>
        {onOpenLogout && (
          <button type="button" onClick={onOpenLogout} className="icon-button" title="Đăng xuất">
            <IconLogOut size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
