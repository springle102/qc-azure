import React from 'react';

export function Footer() {
  return (
    <footer className="app-footer">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: '#38bdf8',
          boxShadow: '0 0 10px #38bdf8',
          display: 'inline-block'
        }} />
        <span>Hệ thống quản lý deadline Webtoon</span>
      </div>
    </footer>
  );
}
