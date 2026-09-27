import React, { useMemo, useState } from 'react';
import { IconEye, IconRefresh, IconSearch, IconUsers, IconX } from '../common/Icons';

const SALARY_FIELDS = ['Japan', 'Latin', 'QC'];

export function SalaryManagementView({ salaries = [], fields = [], bonusConfig, isLoading, onRefresh }) {
  const [search, setSearch] = useState('');
  const [field, setField] = useState('');
  const [selectedQR, setSelectedQR] = useState(null);
  const members = useMemo(() => Array.isArray(salaries) ? salaries : [], [salaries]);
  const fieldOptions = useMemo(() => fields.length > 0 ? fields.map((item) => item.name || item).filter(Boolean) : SALARY_FIELDS, [fields]);

  const filteredFreelancers = useMemo(() => members.filter((freelancer) => {
    const query = search.trim().toLowerCase();
    const memberFields = getMemberFields(freelancer);
    const matchesField = !field || memberFields.includes(field);
    const matchesSearch = !query || [
      freelancer.fId || freelancer.fIld,
      freelancer.name,
      memberFields.join(', '),
      freelancer.totalSalary ?? freelancer.salary ?? freelancer.luong,
      freelancer.earnedAmount,
      freelancer.bonus
    ].some((value) => String(value ?? '').toLowerCase().includes(query));

    return matchesField && matchesSearch;
  }), [field, members, search]);

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">NHÂN SỰ</span>
          <h2 className="page-title">Lương</h2>
          <p className="page-subtitle">
            Tổng lương = tổng tiền freelancer nhận từ các task + bonus.
            {bonusConfig && ` Từ task thứ ${Number(bonusConfig.taskThreshold || 0) + 1}, bonus ${formatSalary(bonusConfig.bonusPerTask)} mỗi task.`}
          </p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
          <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      <section className="glass-panel qc-table-panel">
        <div className="table-toolbar">
          <div className="toolbar-search">
            <IconSearch size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo ID, họ tên hoặc mảng" />
          </div>
          <select className="form-select toolbar-filter" value={field} onChange={(event) => setField(event.target.value)}>
            <option value="">Tất cả mảng</option>
            {fieldOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>

        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table salary-table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Họ và tên</th>
                <th>Mảng</th>
                <th>Tổng lương</th>
                <th>Bonus</th>
                <th>Mã QR</th>
              </tr>
            </thead>
            <tbody>
              {filteredFreelancers.length === 0 ? (
                <tr>
                  <td colSpan="6">
                    <div className="empty-state table-empty">
                      <IconUsers size={24} />
                      <strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có dữ liệu lương trong hệ thống.'}</strong>
                    </div>
                  </td>
                </tr>
              ) : filteredFreelancers.map((freelancer) => (
                <tr key={freelancer.fId || freelancer.fIld || freelancer.id}>
                  <td className="mono-cell">{freelancer.fId || freelancer.fIld || '—'}</td>
                  <td className="strong-cell">{freelancer.name || '—'}</td>
                  <td><span className="field-badge">{getMemberFields(freelancer).join(', ') || '—'}</span></td>
                  <td className="salary-cell">{formatSalary(freelancer.totalSalary ?? freelancer.salary ?? freelancer.luong)}</td>
                  <td className="salary-cell">{formatSalary(freelancer.bonus)}</td>
                  <td>
                    {freelancer.imageQR || freelancer.imageQr || freelancer.qrUrl || freelancer.url ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedQR(freelancer)}>
                        <IconEye size={15} /> Hiển thị QR
                      </button>
                    ) : 'Chưa có mã QR'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedQR && (
        <div className="modal-overlay" onClick={() => setSelectedQR(null)}>
          <div className="modal-content qr-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Mã QR</span>
              <button type="button" className="icon-button" onClick={() => setSelectedQR(null)} title="Đóng">
                <IconX size={18} />
              </button>
            </div>
            <div className="modal-body qr-preview-body">
              <img src={selectedQR.imageQR || selectedQR.imageQr || selectedQR.qrUrl || selectedQR.url} alt="Mã QR" />
              <span>{selectedQR.name || 'Chưa có tên'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSalary(value) {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ₫` : String(value);
}

function getMemberFields(member) {
  if (Array.isArray(member.fields) && member.fields.length > 0) return member.fields;
  return member.field ? [member.field] : [];
}
