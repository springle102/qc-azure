import React, { useMemo, useState } from 'react';
import { IconRefresh, IconSearch, IconUsers } from '../common/Icons';

export function FreelancerManagementView({ freelancers = [], isLoading, onRefresh }) {
  const [field, setField] = useState('');
  const [search, setSearch] = useState('');

  const filteredFreelancers = useMemo(() => freelancers.filter((freelancer) => {
    const matchesField = !field || String(freelancer.field || '').toLowerCase() === field.toLowerCase();
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [freelancer.fId || freelancer.fIld, freelancer.name, freelancer.email, freelancer.field]
      .some((value) => String(value || '').toLowerCase().includes(query));
    return matchesField && matchesSearch;
  }), [field, search, freelancers]);

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">NHÂN SỰ</span>
          <h2 className="page-title">Quản lý freelancer</h2>
          <p className="page-subtitle">Tra cứu freelancer theo mảng làm việc và thông tin trong bảng Freelancer.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
          <IconRefresh size={16} /> Làm mới
        </button>
      </div>

      <section className="glass-panel qc-table-panel">
        <div className="table-toolbar">
          <div className="toolbar-search">
            <IconSearch size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo ID, họ tên hoặc email" />
          </div>
          <select className="form-select toolbar-filter" value={field} onChange={(event) => setField(event.target.value)}>
            <option value="">Tất cả mảng</option>
            <option value="Japan">Japan</option>
            <option value="Latin">Latin</option>
          </select>
        </div>

        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table">
            <thead>
              <tr>
                <th>fId</th>
                <th>Họ và tên</th>
                <th>Email</th>
                <th>Mảng</th>
                <th>Ảnh QR</th>
              </tr>
            </thead>
            <tbody>
              {filteredFreelancers.length === 0 ? (
                <tr><td colSpan="5"><EmptyTable icon={<IconUsers size={24} />} text={isLoading ? 'Đang tải dữ liệu...' : 'Chưa có freelancer trong hệ thống.'} /></td></tr>
              ) : filteredFreelancers.map((freelancer) => (
                <tr key={freelancer.fId || freelancer.id}>
                  <td className="mono-cell">{freelancer.fId || freelancer.fIld || '—'}</td>
                  <td className="strong-cell">{freelancer.name || '—'}</td>
                  <td>{freelancer.email || '—'}</td>
                  <td><span className="field-badge">{freelancer.field || '—'}</span></td>
                  <td>{freelancer.imageQR ? <a href={freelancer.imageQR} target="_blank" rel="noreferrer" className="table-link">Xem mã QR</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EmptyTable({ icon, text }) {
  return <div className="empty-state table-empty">{icon}<strong>{text}</strong></div>;
}
