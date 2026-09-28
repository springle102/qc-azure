import React, { useMemo, useState } from 'react';
import { IconEdit, IconPlus, IconRefresh, IconSearch, IconTasks, IconTrash, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';

const EMPTY_FORM = {
  fIld: '',
  name: '',
  chaptersPerWeek: '',
  chaptersPerMonth: '',
  stability: '',
  note: ''
};

const STABILITY_OPTIONS = [
  { value: 'Trong tháng', className: 'deadline-stability-month', backgroundColor: '#ffc9c3', color: '#b42318' },
  { value: '2-3 tháng kế', className: 'deadline-stability-next', backgroundColor: '#ffd0ac', color: '#9a4816' },
  { value: 'cố định mỗi tháng', className: 'deadline-stability-fixed', backgroundColor: '#ffdf8f', color: '#7a5a00' }
];

function getStabilityOption(value) {
  return STABILITY_OPTIONS.find((option) => option.value === value);
}

export function DeadlineRegistrationView({
  registrations = [],
  freelancers = [],
  currentUser = {},
  isLoading,
  onRefresh,
  onCreate,
  onUpdate,
  onDelete
}) {
  const [search, setSearch] = useState('');
  const [editingRegistration, setEditingRegistration] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const canManageAll = ['Admin', 'QC'].includes(currentUser.role);
  const ownFreelancerId = String(currentUser.freelancerId ?? '');

  const freelancerOptions = useMemo(() => (
    freelancers
      .map((freelancer) => ({
        id: freelancer.fIld ?? freelancer.fId ?? freelancer.id,
        name: freelancer.name || freelancer.email || `Freelancer ${freelancer.fIld ?? freelancer.fId ?? freelancer.id}`
      }))
      .filter((freelancer) => freelancer.id !== null && freelancer.id !== undefined && freelancer.id !== '')
      .sort((left, right) => String(left.name).localeCompare(String(right.name), 'vi'))
  ), [freelancers]);

  const ownRegistration = registrations.find((row) => String(row.fIld ?? row.fId ?? row.freelancerId ?? '') === ownFreelancerId);
  const filteredRegistrations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = !query
      ? registrations
      : registrations.filter((row) => [row.fIld, row.name, row.chaptersPerWeek, row.chaptersPerMonth, row.stability, row.note]
        .some((value) => String(value ?? '').toLowerCase().includes(query)));
    return [...filtered].sort((left, right) => compareNumericValues(
      left.fIld ?? left.fId ?? left.freelancerId,
      right.fIld ?? right.fId ?? right.freelancerId
    ));
  }, [registrations, search]);

  const openCreate = () => {
    const firstFreelancer = canManageAll ? freelancerOptions[0] : freelancerOptions.find((item) => String(item.id) === ownFreelancerId);
    if (!canManageAll && ownRegistration) {
      openEdit(ownRegistration);
      return;
    }
    setIsCreating(true);
    setEditingRegistration({
      ...EMPTY_FORM,
      fIld: firstFreelancer?.id ?? ownFreelancerId,
      name: firstFreelancer?.name ?? currentUser.name ?? ''
    });
  };

  const openEdit = (registration) => {
    setIsCreating(false);
    setEditingRegistration({
      fIld: registration.fIld ?? registration.fId ?? registration.freelancerId ?? '',
      name: registration.name || '',
      chaptersPerWeek: registration.chaptersPerWeek ?? '',
      chaptersPerMonth: registration.chaptersPerMonth ?? '',
      stability: registration.stability || '',
      note: registration.note || '',
      id: registration.id
    });
  };

  const updateField = (key, value) => {
    setEditingRegistration((current) => {
      const next = { ...current, [key]: value };
      if (key === 'fIld') {
        const selected = freelancerOptions.find((item) => String(item.id) === String(value));
        next.name = selected?.name || '';
      }
      return next;
    });
  };

  const saveRegistration = async (event) => {
    event.preventDefault();
    if (!editingRegistration) return;
    const weekly = Number(editingRegistration.chaptersPerWeek);
    const monthly = Number(editingRegistration.chaptersPerMonth);
    if (!Number.isInteger(weekly) || weekly < 0 || !Number.isInteger(monthly) || monthly < 0) {
      showToast('Số chap nhận được phải là số nguyên không âm.', 'error');
      return;
    }
    if (!editingRegistration.fIld) {
      showToast('Hãy chọn freelancer.', 'error');
      return;
    }
    if (!getStabilityOption(editingRegistration.stability)) {
      showToast('Hãy chọn độ ổn định.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        fIld: Number(editingRegistration.fIld),
        chaptersPerWeek: weekly,
        chaptersPerMonth: monthly,
        stability: editingRegistration.stability.trim(),
        note: editingRegistration.note.trim()
      };
      if (isCreating) {
        const created = await api.createDeadlineRegistration(payload);
        onCreate?.(created);
        showToast('Đã gửi đăng ký deadline lên Admin.', 'success');
      } else {
        const updated = await api.updateDeadlineRegistration(editingRegistration.id, payload);
        onUpdate?.(updated);
        showToast('Đã cập nhật đăng ký deadline.', 'success');
      }
      setEditingRegistration(null);
      setIsCreating(false);
    } catch (error) {
      showToast(error.message || 'Không thể lưu đăng ký deadline.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const removeRegistration = async (registration) => {
    if (!window.confirm(`Xóa đăng ký deadline của ${registration.name || `FLID ${registration.fIld}`}?`)) return;
    try {
      const deleted = await api.deleteDeadlineRegistration(registration.id);
      onDelete?.(deleted);
      showToast('Đã xóa đăng ký deadline.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể xóa đăng ký deadline.', 'error');
    }
  };

  const closeEditor = () => {
    if (!isSaving) {
      setEditingRegistration(null);
      setIsCreating(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">ĐĂNG KÝ KHẢ NĂNG NHẬN TASK</span>
          <h2 className="page-title"><IconTasks size={22} /> Đăng ký deadline</h2>
          <p className="page-subtitle">
            {canManageAll ? 'Theo dõi khả năng nhận chapter của freelancer.' : 'Cập nhật khả năng nhận chapter để Admin xem và sắp xếp deadline.'}
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading || isSaving}>
            <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}
          </button>
          {(!ownRegistration || canManageAll) && (
            <button type="button" className="btn btn-primary" onClick={openCreate} disabled={isLoading || isSaving || (canManageAll && freelancerOptions.length === 0)}>
              <IconPlus size={16} /> Thêm đăng ký
            </button>
          )}
        </div>
      </div>

      <section className="glass-panel qc-table-panel">
        {canManageAll && (
          <div className="table-toolbar">
            <div className="toolbar-search">
              <IconSearch size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo FLID, họ tên, độ ổn định hoặc note" />
            </div>
          </div>
        )}

        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table deadline-registration-table">
            <thead>
              <tr>
                <th>FLID</th>
                <th>Họ và tên</th>
                <th>Số chap 1 tuần nhận được</th>
                <th>Số chap 1 tháng</th>
                <th>Độ ổn định</th>
                <th>Note</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredRegistrations.length === 0 ? (
                <tr><td colSpan="7"><div className="empty-state table-empty"><IconTasks size={24} /><strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có đăng ký deadline.'}</strong></div></td></tr>
              ) : filteredRegistrations.map((registration) => (
                <tr key={registration.id}>
                  <td className="mono-cell">{registration.fIld ?? registration.fId ?? '—'}</td>
                  <td className="strong-cell">{registration.name || '—'}</td>
                  <td>{registration.chaptersPerWeek ?? '—'}</td>
                  <td>{registration.chaptersPerMonth ?? '—'}</td>
                  <td>
                    {registration.stability
                      ? <span className={`deadline-stability-badge ${getStabilityOption(registration.stability)?.className || 'deadline-stability-legacy'}`}>{registration.stability}</span>
                      : '—'}
                  </td>
                  <td>{registration.note || '—'}</td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(registration)}><IconEdit size={14} /> Sửa</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => removeRegistration(registration)}><IconTrash size={14} /> Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingRegistration && (
        <div className="modal-overlay" onClick={closeEditor}>
          <form className="modal-content deadline-registration-modal" onSubmit={saveRegistration} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="qc-kicker">ĐĂNG KÝ DEADLINE</span>
                <div className="modal-title">{isCreating ? 'Thêm đăng ký deadline' : 'Chỉnh sửa đăng ký deadline'}</div>
              </div>
              <button type="button" className="icon-button" onClick={closeEditor} disabled={isSaving} title="Đóng"><IconX size={18} /></button>
            </div>
            <div className="modal-body deadline-registration-form">
              <div className="form-group">
                <label className="form-label" htmlFor="deadline-registration-flid">FLID</label>
                {canManageAll ? (
                  <select id="deadline-registration-flid" className="form-select" value={editingRegistration.fIld} onChange={(event) => updateField('fIld', event.target.value)} disabled={isSaving} required>
                    <option value="">Chọn freelancer</option>
                    {freelancerOptions.map((freelancer) => <option key={freelancer.id} value={freelancer.id}>{freelancer.id} — {freelancer.name}</option>)}
                  </select>
                ) : <input id="deadline-registration-flid" className="form-input" value={editingRegistration.fIld} readOnly disabled={isSaving} />}
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="deadline-registration-name">Họ và tên</label>
                <input id="deadline-registration-name" className="form-input" value={editingRegistration.name} readOnly disabled={isSaving} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="deadline-registration-week">Số chap 1 tuần nhận được</label>
                <input id="deadline-registration-week" className="form-input" type="number" min="0" step="1" value={editingRegistration.chaptersPerWeek} onChange={(event) => updateField('chaptersPerWeek', event.target.value)} disabled={isSaving} required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="deadline-registration-month">Số chap 1 tháng</label>
                <input id="deadline-registration-month" className="form-input" type="number" min="0" step="1" value={editingRegistration.chaptersPerMonth} onChange={(event) => updateField('chaptersPerMonth', event.target.value)} disabled={isSaving} required />
              </div>
              <div className="form-group form-group-full">
                <label className="form-label" htmlFor="deadline-registration-stability">Độ ổn định</label>
                <select
                  id="deadline-registration-stability"
                  className={`form-select deadline-stability-select ${getStabilityOption(editingRegistration.stability)?.className || ''}`}
                  value={editingRegistration.stability}
                  onChange={(event) => updateField('stability', event.target.value)}
                  disabled={isSaving}
                  required
                >
                  <option value="">Chọn độ ổn định</option>
                  {STABILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} style={{ backgroundColor: option.backgroundColor, color: option.color }}>
                      {option.value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group form-group-full">
                <label className="form-label" htmlFor="deadline-registration-note">Note</label>
                <textarea id="deadline-registration-note" className="form-textarea" value={editingRegistration.note} onChange={(event) => updateField('note', event.target.value)} disabled={isSaving} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closeEditor} disabled={isSaving}>Hủy</button>
              <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Đang lưu...' : 'Lưu đăng ký'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
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
