import React, { useMemo, useState } from 'react';
import { IconEye, IconRefresh, IconSearch, IconUsers, IconX } from '../common/Icons';

export function SalaryManagementView({ salaries = [], fields = [], isLoading, onRefresh }) {
  const [search, setSearch] = useState('');
  const [fieldFilter, setFieldFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedQR, setSelectedQR] = useState(null);
  const members = useMemo(() => Array.isArray(salaries) ? salaries : [], [salaries]);
  const fieldOptions = useMemo(() => getFieldOptions(fields, members), [fields, members]);
  const roleOptions = useMemo(() => getRoleOptions(members), [members]);

  const filteredFreelancers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = members.filter((freelancer) => {
      const memberFields = getMemberFields(freelancer);
      const memberRole = getMemberRole(freelancer);
      const matchesSearch = !query || [
        freelancer.fId || freelancer.fIld,
        freelancer.name,
        memberFields.join(', '),
        memberRole,
        freelancer.totalSalary ?? freelancer.salary ?? freelancer.luong,
        freelancer.earnedAmount,
        freelancer.bonus
      ].some((value) => String(value ?? '').toLowerCase().includes(query));
      const matchesField = !fieldFilter || memberFields.some((field) => (
        String(field).trim().toLowerCase() === fieldFilter.trim().toLowerCase()
      ));
      const matchesRole = !roleFilter || memberRole === roleFilter;

      return matchesSearch && matchesField && matchesRole;
    });
    return [...filtered].sort((left, right) => compareNumericValues(
      left.fId ?? left.fIld ?? left.qcId ?? left.id,
      right.fId ?? right.fIld ?? right.qcId ?? right.id
    ));
  }, [fieldFilter, members, roleFilter, search]);

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">NHÂN SỰ</span>
          <h2 className="page-title">Lương</h2>
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
          <select
            className="form-select toolbar-filter"
            value={fieldFilter}
            onChange={(event) => setFieldFilter(event.target.value)}
            aria-label="Lọc theo mảng"
          >
            <option value="">Tất cả mảng</option>
            {fieldOptions.map((field) => <option value={field} key={field}>{field}</option>)}
          </select>
          <select
            className="form-select toolbar-filter"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            aria-label="Lọc theo role"
          >
            <option value="">Tất cả role</option>
            {roleOptions.map((role) => <option value={role} key={role}>{role}</option>)}
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
                <th>Bonus / Chuyển QC</th>
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
                <tr key={`${freelancer.isQc ? 'qc' : 'freelancer'}-${freelancer.fId || freelancer.fIld || freelancer.qcId || freelancer.id}`}>
                  <td className="mono-cell">{freelancer.fId || freelancer.fIld || '—'}</td>
                  <td className="strong-cell">{freelancer.name || '—'}</td>
                  <td><span className="field-badge">{getMemberFields(freelancer).join(', ') || '—'}</span></td>
                  <td className="salary-cell">{formatSalary(freelancer.totalSalary ?? freelancer.salary ?? freelancer.luong)}</td>
                  <td className="salary-cell">{freelancer.isQc ? formatSalary(freelancer.transferredAmount) : formatSalary(freelancer.bonus)}</td>
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

function getMemberRole(member) {
  return member.isQc || member.role === 'QC' ? 'QC' : 'Freelancer';
}

function getFieldOptions(fields, members) {
  const values = [
    ...(Array.isArray(fields) ? fields.map((field) => field?.name || field) : []),
    ...members.flatMap((member) => getMemberFields(member))
  ]
    .map((field) => String(field ?? '').trim())
    .filter(Boolean);

  return [...new Map(values.map((field) => [field.toLowerCase(), field])).values()]
    .sort((left, right) => left.localeCompare(right, 'vi', { sensitivity: 'base' }));
}

function getRoleOptions(members) {
  const roles = new Set(['Freelancer', 'QC']);
  members.forEach((member) => roles.add(getMemberRole(member)));
  return [...roles].sort((left, right) => left === 'Freelancer' ? -1 : right === 'Freelancer' ? 1 : left.localeCompare(right, 'vi'));
}

function compareNumericValues(leftValue, rightValue) {
  const leftNumber = Number(leftValue);
  const rightNumber = Number(rightValue);
  const leftMissing = leftValue === null || leftValue === undefined || String(leftValue).trim() === '' || !Number.isFinite(leftNumber);
  const rightMissing = rightValue === null || rightValue === undefined || String(rightValue).trim() === '' || !Number.isFinite(rightNumber);
  if (leftMissing && !rightMissing) return 1;
  if (!leftMissing && rightMissing) return -1;
  if (!leftMissing && !rightMissing) return leftNumber - rightNumber;
  return String(leftValue ?? '').localeCompare(String(rightValue ?? ''), 'vi', { numeric: true, sensitivity: 'base' });
}
