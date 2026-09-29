import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconEdit, IconFilter, IconRefresh, IconSearch, IconUsers, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';
import { AccountManagementView } from './AccountManagementView';

const EMPTY_ROWS = [];
const FREELANCER_FILTER_COLUMNS = [
  { key: 'fId', label: 'fId', sortKind: 'string' },
  { key: 'name', label: 'Họ và tên', sortKind: 'string' },
  { key: 'email', label: 'Email', sortKind: 'string' },
  { key: 'fields', label: 'Mảng', sortKind: 'string' },
  { key: 'note', label: 'Note', sortKind: 'string' },
  { key: 'accountUsername', label: 'Account', sortKind: 'string' },
  { key: 'accountStatus', label: 'Trạng thái account', sortKind: 'string' }
];

export function FreelancerManagementView({ freelancers = [], accounts = [], fields = [], isLoading, onRefresh, canManageAccounts = false, canEdit = false }) {
  const freelancerRows = Array.isArray(freelancers) ? freelancers : EMPTY_ROWS;
  const accountRows = Array.isArray(accounts) ? accounts : EMPTY_ROWS;
  const fieldRows = Array.isArray(fields) ? fields : EMPTY_ROWS;
  const fieldOptions = useMemo(() => fieldRows.map((field) => field.name || field).filter(Boolean), [fieldRows]);
  const [field, setField] = useState('');
  const [search, setSearch] = useState('');
  const [editingFreelancer, setEditingFreelancer] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', field: '', note: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [columnFilters, setColumnFilters] = useState({});
  const [columnSort, setColumnSort] = useState(null);

  useEffect(() => {
    if (!onRefresh) return undefined;
    const refreshPresence = window.setInterval(() => onRefresh(), 30_000);
    return () => window.clearInterval(refreshPresence);
  }, [onRefresh]);

  const columnFilterOptions = useMemo(() => Object.fromEntries(
    FREELANCER_FILTER_COLUMNS.map(({ key }) => {
      const values = key === 'fields'
        ? [...fieldOptions, ...freelancerRows.flatMap((freelancer) => getMemberFields(freelancer))]
        : freelancerRows.map((freelancer) => getFreelancerFilterValue(freelancer, key));
      return [key, [...new Set(values.map((value) => String(value ?? '')))]
        .sort((left, right) => left.localeCompare(right, 'vi', { numeric: true, sensitivity: 'base' }))];
    })
  ), [fieldOptions, freelancerRows]);

  const filteredFreelancers = useMemo(() => freelancerRows.filter((freelancer) => {
    const memberFields = getMemberFields(freelancer);
    const matchesField = !field || memberFields.some((value) => value.toLowerCase() === field.toLowerCase());
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [
      freelancer.fId || freelancer.fIld,
      freelancer.name,
      freelancer.email,
      memberFields.join(', '),
      freelancer.note || freelancer.notes,
      freelancer.accountUsername
    ].some((value) => String(value || '').toLowerCase().includes(query));
    const matchesColumnFilters = Object.entries(columnFilters).every(([key, selectedValues]) => {
      if (key === 'fields') {
        return selectedValues.some((value) => memberFields.some((memberField) => String(memberField).toLowerCase() === String(value).toLowerCase()));
      }
      return selectedValues.includes(getFreelancerFilterValue(freelancer, key));
    });
    return matchesField && matchesSearch && matchesColumnFilters;
  }), [columnFilters, field, search, freelancerRows]);

  const sortedFreelancers = useMemo(() => {
    const sortKey = columnSort?.key || FREELANCER_FILTER_COLUMNS[0].key;
    const sortDirection = columnSort?.direction || 'asc';
    return [...filteredFreelancers].sort((left, right) => {
      const comparison = getFreelancerFilterValue(left, sortKey).localeCompare(
        getFreelancerFilterValue(right, sortKey),
        'vi',
        { numeric: true, sensitivity: 'base' }
      );
      return sortDirection === 'desc' ? -comparison : comparison;
    });
  }, [columnSort, filteredFreelancers]);

  const updateColumnFilter = (key, selectedValues) => {
    setColumnFilters((current) => {
      const next = { ...current };
      if (selectedValues === null) delete next[key];
      else next[key] = selectedValues;
      return next;
    });
  };

  const updateColumnSort = (key, direction) => {
    setColumnSort(direction ? { key, direction } : null);
  };

  const openEdit = (freelancer) => {
    setEditingFreelancer(freelancer);
    setForm({
      name: freelancer.name || '',
      email: freelancer.email || '',
      field: freelancer.field || '',
      note: freelancer.note || freelancer.notes || ''
    });
  };

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveFreelancer = async (event) => {
    event.preventDefault();
    if (!editingFreelancer) return;
    setIsSaving(true);
    try {
      const id = editingFreelancer.fIld ?? editingFreelancer.fId ?? editingFreelancer.id;
      await api.updateFreelancer(id, form);
      setEditingFreelancer(null);
      showToast('Đã cập nhật freelancer và account liên kết.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật freelancer.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">NHÂN SỰ</span>
          <h2 className="page-title">Quản lý freelancer</h2>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading || isSaving}>
          <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      {canManageAccounts && (
        <AccountManagementView
          embedded
          accounts={accountRows}
          freelancers={freelancerRows}
          fields={fieldRows}
          isLoading={isLoading}
          onRefresh={onRefresh}
        />
      )}

      <section className="glass-panel qc-table-panel">
        <div className="section-heading">
          <div><span className="qc-kicker">DANH SÁCH FREELANCER</span><h3><IconUsers size={18} /> Hồ sơ freelancer</h3></div>
        </div>
        <div className="table-toolbar">
          <div className="toolbar-search">
            <IconSearch size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo ID, họ tên, email hoặc account" />
          </div>
          <select className="form-select toolbar-filter" value={field} onChange={(event) => setField(event.target.value)}>
            <option value="">Tất cả mảng</option>
            {fieldOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>

        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table freelancer-table">
            <thead>
              <tr>
                {FREELANCER_FILTER_COLUMNS.map(({ key, label, sortKind }, index) => (
                  <React.Fragment key={key}>
                    {index === 1 && <th className="freelancer-avatar-cell">Avatar</th>}
                    <th>
                      <div className="deadline-column-header">
                        <span>{label}</span>
                        <ColumnFilterButton
                          label={label}
                          values={columnFilterOptions[key] || []}
                          activeValues={columnFilters[key]}
                          sortKind={sortKind}
                          activeSortDirection={columnSort?.key === key ? columnSort.direction : null}
                          onApply={(selectedValues) => updateColumnFilter(key, selectedValues)}
                          onSort={(direction) => updateColumnSort(key, direction)}
                        />
                      </div>
                    </th>
                  </React.Fragment>
                ))}
                {canEdit && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {filteredFreelancers.length === 0 ? (
                <tr><td colSpan={canEdit ? 9 : 8}><EmptyTable icon={<IconUsers size={24} />} text={isLoading ? 'Đang tải dữ liệu...' : 'Chưa có freelancer trong hệ thống.'} /></td></tr>
              ) : sortedFreelancers.map((freelancer) => (
                <tr key={freelancer.fIld || freelancer.fId || freelancer.id}>
                  <td className="mono-cell">{freelancer.fId || freelancer.fIld || '—'}</td>
                  <td className="freelancer-avatar-cell">
                    <FreelancerAvatar freelancer={freelancer} />
                  </td>
                  <td className="strong-cell">{freelancer.name || '—'}</td>
                  <td>{freelancer.email || '—'}</td>
                  <td><span className="field-badge">{getMemberFields(freelancer).join(', ') || '—'}</span></td>
                  <td>{freelancer.note || freelancer.notes || '—'}</td>
                  <td className="mono-cell">{freelancer.accountUsername || 'Chưa cấp'}</td>
                  <td>{freelancer.accountUsername ? <span className={'data-status ' + (freelancer.accountIsActive ? 'completed' : 'pending')}>{freelancer.accountIsActive ? 'Đang hoạt động' : 'Đã khóa'}</span> : '—'}</td>
                  {canEdit && <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(freelancer)}><IconEdit size={14} /> Chỉnh sửa</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingFreelancer && createPortal(
        <div className="modal-overlay" onClick={() => !isSaving && setEditingFreelancer(null)} role="presentation">
          <form className="modal-content freelancer-edit-modal" onSubmit={saveFreelancer} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="freelancer-edit-modal-title">
            <div className="modal-header">
              <div>
                <span className="qc-kicker">FREELANCER</span>
                <div className="modal-title" id="freelancer-edit-modal-title">Chỉnh sửa freelancer</div>
              </div>
              <button type="button" className="icon-button" onClick={() => setEditingFreelancer(null)} disabled={isSaving} title="Đóng"><IconX size={18} /></button>
            </div>
            <div className="modal-body freelancer-edit-form">
              <div className="form-group">
                <label className="form-label" htmlFor="freelancer-edit-name">Họ và tên</label>
                <input id="freelancer-edit-name" className="form-input" value={form.name} onChange={(event) => updateField('name', event.target.value)} required disabled={isSaving} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="freelancer-edit-email">Email</label>
                <input id="freelancer-edit-email" className="form-input" type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} disabled={isSaving} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="freelancer-edit-field">Mảng</label>
                <select id="freelancer-edit-field" className="form-select" value={form.field} onChange={(event) => updateField('field', event.target.value)} required disabled={isSaving}>
                  <option value="">Chọn mảng</option>
                  {fieldOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div className="form-group form-group-full">
                <label className="form-label" htmlFor="freelancer-edit-note">Note</label>
                <textarea id="freelancer-edit-note" className="form-textarea" value={form.note} onChange={(event) => updateField('note', event.target.value)} disabled={isSaving} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setEditingFreelancer(null)} disabled={isSaving}>Hủy</button>
              <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Đang lưu...' : 'Lưu thay đổi'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}

function EmptyTable({ icon, text }) {
  return <div className="empty-state table-empty">{icon}<strong>{text}</strong></div>;
}

function FreelancerAvatar({ freelancer = {} }) {
  const [hasError, setHasError] = useState(false);
  const avatar = freelancer.avatar || freelancer.accountAvatar || '';
  const name = String(freelancer.name || freelancer.email || '?').trim();
  const initial = name.charAt(0).toUpperCase() || '?';

  if (avatar && !hasError) {
    return (
      <span className="freelancer-avatar-wrap">
        <img
          className="freelancer-avatar"
          src={avatar}
          alt={`Avatar của ${freelancer.name || 'freelancer'}`}
          onError={() => setHasError(true)}
        />
        {freelancer.isOnline && <span className="freelancer-online-dot" title="Đang hoạt động" aria-label="Đang hoạt động" />}
      </span>
    );
  }

  return (
    <span className="freelancer-avatar-wrap">
      <span className="freelancer-avatar freelancer-avatar-placeholder" title={freelancer.name || 'Chưa có avatar'}>{initial}</span>
      {freelancer.isOnline && <span className="freelancer-online-dot" title="Đang hoạt động" aria-label="Đang hoạt động" />}
    </span>
  );
}

function getFreelancerFilterValue(freelancer = {}, key) {
  if (key === 'fId') return String(freelancer.fId ?? freelancer.fIld ?? freelancer.id ?? '');
  if (key === 'fields') return getMemberFields(freelancer).join(', ');
  if (key === 'note') return String(freelancer.note ?? freelancer.notes ?? '');
  if (key === 'accountStatus') {
    return freelancer.accountUsername
      ? (freelancer.accountIsActive ? 'Đang hoạt động' : 'Đã khóa')
      : 'Chưa cấp';
  }
  return String(freelancer[key] ?? '');
}

function formatFilterValue(value) {
  return value === '' ? '(Trống)' : value;
}

function ColumnFilterButton({ label, values, activeValues, sortKind, activeSortDirection, onApply, onSort }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [draftValues, setDraftValues] = useState([]);
  const [menuPosition, setMenuPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const isActive = Array.isArray(activeValues) || Boolean(activeSortDirection);

  useEffect(() => {
    if (!isOpen) return undefined;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 280;
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

  const openFilter = (event) => {
    event.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    setSearchValue('');
    setDraftValues(Array.isArray(activeValues) ? [...activeValues] : [...values]);
    setIsOpen(true);
  };

  const visibleValues = values.filter((value) => formatFilterValue(value).toLowerCase().includes(searchValue.trim().toLowerCase()));
  const allSelected = values.length > 0 && draftValues.length === values.length;
  const toggleValue = (value) => {
    setDraftValues((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={'column-filter-button' + (isActive ? ' active' : '')}
        onClick={openFilter}
        aria-label={`Lọc cột ${label}`}
        aria-expanded={isOpen}
        title={`Lọc cột ${label}`}
      >
        <IconFilter size={14} />
      </button>
      {isOpen && menuPosition && createPortal(
        <div ref={menuRef} className="column-filter-menu" style={menuPosition} onClick={(event) => event.stopPropagation()}>
          <div className="column-filter-menu-title">Lọc {label}</div>
          {sortKind && (
            <div className="column-filter-sort">
              <div className="column-filter-section-label">Sắp xếp</div>
              <button type="button" className={'column-filter-sort-button' + (activeSortDirection === 'asc' ? ' active' : '')} onClick={() => { onSort(activeSortDirection === 'asc' ? null : 'asc'); setIsOpen(false); }}>A → Z</button>
              <button type="button" className={'column-filter-sort-button' + (activeSortDirection === 'desc' ? ' active' : '')} onClick={() => { onSort(activeSortDirection === 'desc' ? null : 'desc'); setIsOpen(false); }}>Z → A</button>
            </div>
          )}
          <input className="form-input column-filter-search" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Tìm giá trị..." autoFocus />
          <label className="column-filter-option column-filter-select-all">
            <input type="checkbox" checked={allSelected} onChange={() => setDraftValues(allSelected ? [] : [...values])} />
            <span>Chọn tất cả</span>
          </label>
          <div className="column-filter-options">
            {visibleValues.length > 0 ? visibleValues.map((value) => (
              <label className="column-filter-option" key={value || '__empty__'}>
                <input type="checkbox" checked={draftValues.includes(value)} onChange={() => toggleValue(value)} />
                <span title={formatFilterValue(value)}>{formatFilterValue(value)}</span>
              </label>
            )) : <span className="column-filter-empty">Không có giá trị phù hợp.</span>}
          </div>
          <div className="column-filter-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { onApply(null); setIsOpen(false); }}>Xóa lọc</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { onApply(draftValues.length === values.length ? null : draftValues); setIsOpen(false); }}>Áp dụng</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function getMemberFields(member = {}) {
  if (!member || typeof member !== 'object') return [];
  if (Array.isArray(member.fields) && member.fields.length > 0) return member.fields;
  return member.field ? [member.field] : [];
}
