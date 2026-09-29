import { createPortal } from 'react-dom';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconEye, IconFilter, IconRefresh, IconSearch, IconUsers, IconX } from '../common/Icons';
import { getSalaryMonth, isSalaryMonth } from '../../utils/bonus.mjs';

export function SalaryManagementView({ currentUser = {}, salaries = [], fields = [], month = getSalaryMonth(), onMonthChange, isLoading, onRefresh }) {
  const [search, setSearch] = useState('');
  const [fieldFilter, setFieldFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [columnSort, setColumnSort] = useState(null);
  const [selectedQR, setSelectedQR] = useState(null);
  const [selectedBonus, setSelectedBonus] = useState(null);
  const members = useMemo(() => Array.isArray(salaries) ? salaries.filter((row) => row.salaryMonth === month) : [], [salaries, month]);
  const missingDateCount = members.reduce((count, row) => count + (row.missingDateChapters?.length || 0), 0);
  const canUseScopeFilters = currentUser?.role !== 'Freelancer';
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
      const matchesField = !canUseScopeFilters || !fieldFilter || memberFields.some((field) => (
        String(field).trim().toLowerCase() === fieldFilter.trim().toLowerCase()
      ));
      const matchesRole = !canUseScopeFilters || !roleFilter || memberRole === roleFilter;

      return matchesSearch && matchesField && matchesRole;
    });
    const sorted = [...filtered];
    if (columnSort) {
      return sorted.sort((left, right) => compareSalaryRows(left, right, columnSort.key, columnSort.direction));
    }
    return sorted.sort((left, right) => compareNumericValues(
      left.fId ?? left.fIld ?? left.qcId ?? left.id,
      right.fId ?? right.fIld ?? right.qcId ?? right.id
    ));
  }, [canUseScopeFilters, columnSort, fieldFilter, members, roleFilter, search]);

  const salaryTotals = useMemo(() => filteredFreelancers.reduce((totals, member) => {
    // totalSalary already includes bonus (or the transferred amount for QC).
    const salary = Number(member.totalSalary ?? member.salary ?? member.luong);
    const bonus = Number(member.isQc ? member.transferredAmount : member.bonus);
    return {
      salaryCents: totals.salaryCents + (Number.isFinite(salary) ? Math.round(salary * 100) : 0),
      bonusCents: totals.bonusCents + (Number.isFinite(bonus) ? Math.round(bonus * 100) : 0)
    };
  }, { salaryCents: 0, bonusCents: 0 }), [filteredFreelancers]);

  const updateColumnSort = (key, direction) => {
    setColumnSort((current) => current?.key === key && current.direction === direction ? null : { key, direction });
  };

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">NHÂN SỰ</span>
          <h2 className="page-title">Lương</h2>
          <p className="page-subtitle">Kỳ {month} · Theo Ngày nộp (giờ Việt Nam), các task đã tick Thanh toán.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
          <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      <section className="glass-panel qc-table-panel">
        <div className="table-toolbar">
          <label className="salary-month-filter">Tháng lương
            <input className="form-input" type="month" value={month} max="9999-12" onChange={(event) => {
              if (isSalaryMonth(event.target.value)) { setSelectedBonus(null); onMonthChange?.(event.target.value); }
            }} />
          </label>
          <div className="toolbar-search">
            <IconSearch size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo ID, họ tên hoặc mảng" />
          </div>
          {canUseScopeFilters && (
            <>
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
            </>
          )}
        </div>

        {missingDateCount > 0 && <p className="salary-date-warning" role="status">Có {missingDateCount} task đã tick Thanh toán nhưng thiếu Ngày nộp hợp lệ, chưa được tính vào kỳ lương nào. Mở chi tiết Bonus của freelancer để xem task cần bổ sung.</p>}
        <div className="table-wrapper table-wrapper-flat">
            <table className="custom-table salary-table">
            <thead>
              <tr>
                <th><div className="deadline-column-header"><span>Id</span><SalarySortButton label="Id" activeSortDirection={columnSort?.key === 'id' ? columnSort.direction : null} onSort={(direction) => updateColumnSort('id', direction)} /></div></th>
                <th><div className="deadline-column-header"><span>Họ và tên</span><SalarySortButton label="Họ và tên" activeSortDirection={columnSort?.key === 'name' ? columnSort.direction : null} onSort={(direction) => updateColumnSort('name', direction)} /></div></th>
                <th><div className="deadline-column-header"><span>Mảng</span><SalarySortButton label="Mảng" activeSortDirection={columnSort?.key === 'field' ? columnSort.direction : null} onSort={(direction) => updateColumnSort('field', direction)} /></div></th>
                <th><div className="deadline-column-header"><span>Tổng lương</span><SalarySortButton label="Tổng lương" activeSortDirection={columnSort?.key === 'totalSalary' ? columnSort.direction : null} onSort={(direction) => updateColumnSort('totalSalary', direction)} /></div></th>
                <th><div className="deadline-column-header"><span>Bonus / Chuyển QC</span><SalarySortButton label="Bonus / Chuyển QC" activeSortDirection={columnSort?.key === 'bonus' ? columnSort.direction : null} onSort={(direction) => updateColumnSort('bonus', direction)} /></div></th>
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
                  <td className="salary-cell">{freelancer.isQc ? formatSalary(freelancer.transferredAmount) : (
                    <button type="button" className="salary-bonus-button" onClick={() => setSelectedBonus(freelancer)} title="Xem cách tính bonus">
                      {formatSalary(freelancer.bonus)} <IconEye size={15} />
                    </button>
                  )}</td>
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
            <tfoot>
              <tr className="salary-total-row">
                <th scope="row" colSpan={3}>Tổng cộng (gồm bonus)</th>
                <td className="salary-cell">{isLoading ? 'Đang tải...' : formatSalary(salaryTotals.salaryCents / 100)}</td>
                <td className="salary-cell" title="Đã được tính trong tổng lương">{isLoading ? 'Đang tải...' : formatSalary(salaryTotals.bonusCents / 100)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {selectedBonus && createPortal(
        <div className="modal-overlay" onClick={() => setSelectedBonus(null)}>
          <div className="modal-content modal-lg" role="dialog" aria-modal="true" aria-labelledby="salary-bonus-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3 id="salary-bonus-title">Bonus {selectedBonus.name} · {month}</h3>
              <button type="button" className="icon-button" aria-label="Đóng" onClick={() => setSelectedBonus(null)}><IconX size={18} /></button>
            </div>
            <div className="modal-body bonus-policy-form">
              <p className="form-help">Thứ tự chap theo Ngày nộp; nếu trùng thời điểm, theo ID truyện rồi chapter. Chỉ đếm task Submitted/Done đã tick Thanh toán. Chap được thưởng phải hoàn thành đúng 100%.</p>
              {(selectedBonus.bonusByField || []).map((summary) => <section className="bonus-policy-card" key={summary.field}>
                <h4>{summary.field || 'Chưa có mảng'} · {summary.chapterCount} chap, {summary.fullCompletionCount} chap đạt 100%</h4>
                <BonusGateDetails title="Thưởng KPI" gate={summary.kpi} />
                <BonusGateDetails title="Thưởng sau mốc" gate={summary.after} />
                <p>Sau mốc: {summary.after.rewardedCount} chap × {formatSalary(summary.after.amountPerChapter)} = {formatSalary(summary.after.amount)}</p>
                <strong>Tổng bonus mảng: {formatSalary(summary.total)}</strong>
              </section>)}
              {!selectedBonus.bonusByField?.length && <p>Chưa có chap đủ điều kiện trong tháng này.</p>}
              {selectedBonus.missingDateChapters?.length > 0 && <section className="bonus-policy-card">
                <h4>Task thiếu Ngày nộp — chưa tính lương/bonus</h4>
                <ul className="bonus-policy-history">{selectedBonus.missingDateChapters.map((chapter) => <li key={`${chapter.seriesId}:${chapter.chapterNumber}`}>{chapter.field} · ID {chapter.seriesId} · Chapter {chapter.chapterNumber}</li>)}</ul>
              </section>}
              <strong>Tổng bonus: {formatSalary(selectedBonus.bonus)}</strong>
            </div>
          </div>
        </div>, document.body
      )}

      {selectedQR && createPortal(
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
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function BonusGateDetails({ title, gate }) {
  if (!gate.enabled) return <p>{title}: đã tắt.</p>;
  return <div>
    <p>{title} · Mốc {gate.threshold} chap: {gate.unlocked ? 'Đã đạt' : 'Chưa đạt'} · {formatSalary(gate.amount)}</p>
    {gate.missingCount > 0 && <p className="form-help">Còn thiếu {gate.missingCount} chap để đạt mốc.</p>}
    {gate.blockedChapters.length > 0 && <details><summary>{gate.blockedChapters.length} chap trong mốc chưa đạt 100%</summary>
      <ul className="bonus-policy-history">{gate.blockedChapters.map((chapter) => <li key={`${chapter.seriesId}:${chapter.chapterNumber}`}>ID {chapter.seriesId} · Chapter {chapter.chapterNumber}: {chapter.completionPercent ?? 'Chưa nhập'}%</li>)}</ul>
    </details>}
  </div>;
}

function SalarySortButton({ label, activeSortDirection, onSort }) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const isActive = Boolean(activeSortDirection);

  useEffect(() => {
    if (!isOpen) return undefined;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 220;
      setMenuPosition({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      });
    };
    const handleOutsidePointer = (event) => {
      if (!buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    updatePosition();
    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  const applySort = (direction) => {
    onSort(activeSortDirection === direction ? null : direction);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={'column-filter-button' + (isActive ? ' active' : '')}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
        aria-label={`Sắp xếp cột ${label}`}
        aria-expanded={isOpen}
        title={`Sắp xếp cột ${label}`}
      >
        <IconFilter size={14} />
      </button>
      {isOpen && menuPosition && createPortal(
        <div ref={menuRef} className="column-filter-menu salary-sort-menu" style={menuPosition} onClick={(event) => event.stopPropagation()}>
          <div className="column-filter-menu-title">Sắp xếp {label}</div>
          <div className="column-filter-sort">
            <button type="button" className={'column-filter-sort-button' + (activeSortDirection === 'asc' ? ' active' : '')} onClick={() => applySort('asc')}>A → Z</button>
            <button type="button" className={'column-filter-sort-button' + (activeSortDirection === 'desc' ? ' active' : '')} onClick={() => applySort('desc')}>Z → A</button>
          </div>
        </div>,
        document.body
      )}
    </>
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

function getSalarySortValue(member, key) {
  if (key === 'id') return member.fId ?? member.fIld ?? member.qcId ?? member.id;
  if (key === 'name') return member.name;
  if (key === 'field') return getMemberFields(member).join(', ');
  if (key === 'bonus') return member.isQc ? member.transferredAmount : member.bonus;
  return member.totalSalary ?? member.salary ?? member.luong;
}

function compareSalaryRows(left, right, key, direction) {
  const leftValue = getSalarySortValue(left, key);
  const rightValue = getSalarySortValue(right, key);
  const isNumeric = ['id', 'totalSalary', 'bonus'].includes(key);
  const comparison = isNumeric
    ? compareNumericValues(leftValue, rightValue)
    : String(leftValue ?? '').localeCompare(String(rightValue ?? ''), 'vi', { numeric: true, sensitivity: 'base' });
  return direction === 'desc' ? -comparison : comparison;
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
