import React from 'react';
import {
  IconDashboard,
  IconAlertTriangle,
  IconUsers,
  IconBook,
  IconTasks,
  IconDollarSign,
  IconBanknote,
  IconSettings,
  IconUser,
  IconLogOut
} from '../common/Icons';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: IconDashboard, tone: 'violet' },
  { id: 'freelancers', label: 'Quản lý freelancer', icon: IconUsers, tone: 'cyan' },
  { id: 'deadlineRegistrations', label: 'Đăng ký deadline', icon: IconBook, tone: 'indigo' },
  { id: 'deadlines', label: 'Quản lý Deadline', icon: IconTasks, tone: 'violet' },
  { id: 'errors', label: 'Quản lý lỗi', icon: IconAlertTriangle, tone: 'rose' },
  { id: 'pricing', label: 'Giá tiền', icon: IconDollarSign, tone: 'amber' },
  { id: 'salary', label: 'Lương & QR', icon: IconBanknote, tone: 'emerald' },
  { id: 'settings', label: 'Cấu hình chung', icon: IconSettings, tone: 'slate' },
  { id: 'profile', label: 'Hồ sơ cá nhân', icon: IconUser, tone: 'blue' }
];

const ROLE_VIEWS = {
  Admin: ['dashboard', 'freelancers', 'deadlineRegistrations', 'deadlines', 'errors', 'pricing', 'settings', 'salary', 'profile'],
  QC: ['dashboard', 'profile', 'salary', 'deadlineRegistrations', 'deadlines', 'errors'],
  Freelancer: ['dashboard', 'profile', 'salary', 'deadlineRegistrations', 'deadlines', 'errors']
};

export function Sidebar({ currentView, onNavigate, currentUser, role = 'QC', onOpenLogout, isOpen = false }) {
  const visibleItems = NAV_ITEMS
    .filter(({ id }) => (ROLE_VIEWS[role] || ROLE_VIEWS.Freelancer).includes(id))
    .map((item) => item.id === 'deadlines' && role === 'Freelancer' ? { ...item, label: 'Deadline của tôi' } : item);

  return (
    <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
      <div className="qc-sidebar-brand">
        <div className="qc-sidebar-brand-icon">
          <svg className="qc-brand-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div>
          <div className="qc-brand-title-wrap">
            <strong>WZ System</strong>
          </div>
          <span>DEADLINE MANAGEMENT</span>
        </div>
      </div>

      <div className="sidebar-section-title">
        {role === 'Freelancer' ? 'Không gian Freelancer' : (role === 'Admin' ? 'Không gian Admin / QC' : 'Không gian QC')}
      </div>

      <nav className="qc-sidebar-nav" aria-label={role === 'Freelancer' ? 'Điều hướng Freelancer' : 'Điều hướng QC'}>
        {visibleItems.map(({ id, label, icon: Icon, tone, badge }) => (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className={`nav-link ${currentView === id ? 'active' : ''} nav-tone-${tone || 'violet'}`}
          >
            <span className="nav-link-left">
              <span className="nav-icon-wrap"><Icon size={18} /></span>
              <span>{label}</span>
            </span>
            {badge && <span className="nav-badge-pill">{badge}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-user-card qc-sidebar-user">
        <div className="qc-avatar-squircle" aria-hidden="true">
          {currentUser?.avatar
            ? <img src={currentUser.avatar} alt="" />
            : (currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : (role ? role.charAt(0) : 'U'))}
        </div>
        <div className="qc-user-label">
          <strong className="qc-user-name">{currentUser?.name || currentUser?.username || 'Studio Member'}</strong>
          <span className="qc-user-role-badge">Role: {currentUser?.role || role || 'Member'}</span>
        </div>
        {onOpenLogout && (
          <button type="button" onClick={onOpenLogout} className="qc-logout-button" title="Đăng xuất">
            <IconLogOut size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
