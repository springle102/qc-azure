import React from 'react';
import {
  IconDashboard,
  IconUsers,
  IconTasks,
  IconQRCode,
  IconBug,
  IconUser,
  IconLogOut,
  IconClock
} from '../common/Icons';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: IconDashboard },
  { id: 'profile', label: 'Hồ sơ cá nhân', icon: IconUser },
  { id: 'freelancers', label: 'Quản lý freelancer', icon: IconUsers },
  { id: 'company-deadlines', label: 'Deadline công ty', icon: IconClock },
  { id: 'deadlines', label: 'Quản lý deadline', icon: IconTasks },
  { id: 'qrcodes', label: 'Quản lý QR', icon: IconQRCode },
  { id: 'errors', label: 'Quản lý lỗi', icon: IconBug }
];

export function Sidebar({ currentView, onNavigate, currentUser, onOpenLogout, isOpen = false }) {
  return (
    <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
      <div className="qc-sidebar-brand">
        <div className="qc-sidebar-mark">Q</div>
        <div>
          <strong>QC WEBTOON</strong>
          <span>DEADLINE MANAGEMENT</span>
        </div>
      </div>

      <div className="sidebar-section-title">Không gian QC</div>
      <nav className="qc-sidebar-nav" aria-label="Điều hướng QC">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
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
          <strong>{currentUser?.name || 'QC'}</strong>
          <span>Vai trò kiểm soát</span>
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
