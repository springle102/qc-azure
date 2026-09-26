import React from 'react';
import { IconMenu, IconUser } from '../common/Icons';

export function Header({ currentUser, onOpenProfile, onToggleSidebar }) {
  return (
    <header className="app-header qc-header">
      <div className="header-left">
        <button type="button" onClick={onToggleSidebar} className="header-btn qc-mobile-menu" title="Mở menu">
          <IconMenu size={20} />
        </button>
        <div>
          <div className="qc-header-eyebrow">HỆ THỐNG QUẢN LÝ DEADLINE WEBTOON</div>
          <h1 className="qc-header-title">Không gian làm việc QC</h1>
        </div>
      </div>

      <button type="button" className="qc-header-profile" onClick={onOpenProfile}>
        <span className="qc-header-avatar"><IconUser size={17} /></span>
        <span>
          <strong>{currentUser?.name || 'QC'}</strong>
          <small>{currentUser?.email || 'Tài khoản QC'}</small>
        </span>
      </button>
    </header>
  );
}
