import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconEdit, IconFilter, IconPlus, IconRefresh, IconTrash, IconUsers, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';

const ROLE_OPTIONS = ['Admin', 'QC', 'Freelancer'];
const EMPTY_ROWS = [];
const ACCOUNT_FILTER_COLUMNS = [
  { key: 'username', label: 'Username', sortKind: 'string' },
  { key: 'displayName', label: 'Họ và tên', sortKind: 'string' },
  { key: 'email', label: 'Email', sortKind: 'string' },
  { key: 'role', label: 'Role', sortKind: 'string' },
  { key: 'fields', label: 'Mảng', sortKind: 'string' },
  { key: 'freelancerName', label: 'Freelancer liên kết', sortKind: 'string' },
  { key: 'status', label: 'Trạng thái', sortKind: 'string' },
  { key: 'createdAt', label: 'Ngày tạo', filterKind: 'month', sortKind: 'string' }
];

const INITIAL_FORM = {
  username: '',
  password: '',
  displayName: '',
  email: '',
  role: 'QC',
  roles: ['QC'],
  field: '',
  fields: [],
  freelancerId: ''
};

export function AccountManagementView({ accounts = [], freelancers = [], fields = [], isLoading, onRefresh, embedded = false }) {
  const accountRows = Array.isArray(accounts) ? accounts : EMPTY_ROWS;
  const freelancerRows = Array.isArray(freelancers) ? freelancers : EMPTY_ROWS;
  const fieldRows = Array.isArray(fields) ? fields : EMPTY_ROWS;
  const fieldOptions = useMemo(() => fieldRows.map((field) => field.name || field).filter(Boolean), [fieldRows]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editForm, setEditForm] = useState(INITIAL_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [columnFilters, setColumnFilters] = useState({});
  const [columnSort, setColumnSort] = useState(null);

  const accountFilterOptions = useMemo(() => Object.fromEntries(
    ACCOUNT_FILTER_COLUMNS.map(({ key }) => {
      const values = key === 'fields'
        ? [...fieldOptions, ...accountRows.flatMap((account) => getMemberFields(account))]
        : accountRows.map((account) => getAccountFilterValue(account, key, freelancerRows));
      return [key, [...new Set(values.map((value) => String(value ?? '')))].sort((left, right) => left.localeCompare(right, 'vi', { numeric: true, sensitivity: 'base' }))];
    })
  ), [accountRows, fieldOptions, freelancerRows]);

  const filteredAccounts = useMemo(() => {
    const filtered = accountRows.filter((account) => Object.entries(columnFilters).every(([key, selectedValues]) => {
      if (key === 'fields') {
        const memberFields = getMemberFields(account).map((value) => String(value).toLowerCase());
        return selectedValues.some((value) => memberFields.includes(String(value).toLowerCase()));
      }
      return selectedValues.includes(getAccountFilterValue(account, key, freelancerRows));
    }));
    const sortKey = columnSort?.key || ACCOUNT_FILTER_COLUMNS[0].key;
    const sortDirection = columnSort?.direction || 'asc';
    const sortColumn = ACCOUNT_FILTER_COLUMNS.find(({ key }) => key === sortKey);
    if (!sortColumn?.sortKind) return filtered;
    return [...filtered].sort((left, right) => {
      const comparison = getAccountFilterValue(left, sortKey, freelancerRows).localeCompare(
        getAccountFilterValue(right, sortKey, freelancerRows),
        'vi',
        { numeric: true, sensitivity: 'base' }
      );
      return sortDirection === 'desc' ? -comparison : comparison;
    });
  }, [accountRows, columnFilters, columnSort, freelancerRows]);

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

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const createAccount = async (event) => {
    event.preventDefault();
    if (hasRole(form.roles, ['QC', 'Freelancer']) && form.fields.length === 0) {
      showToast('Account Freelancer/QC cần chọn ít nhất một mảng.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      await api.createAccount(toApiAccount(form, true));
      setForm(INITIAL_FORM);
      showToast('Đã cấp account thành công.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể cấp account.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const openEdit = (account) => {
    setEditingAccount(account);
    setEditForm({
      username: account.username || '',
      password: '',
      displayName: account.displayName || '',
      email: account.email || '',
      role: account.role || 'QC',
      roles: getAccountRoles(account),
      field: account.field || '',
      fields: Array.isArray(account.fields) ? account.fields : (account.field ? [account.field] : []),
      freelancerId: account.freelancerId ?? '',
      isActive: account.isActive !== false
    });
  };

  const updateEditField = (key, value) => {
    setEditForm((current) => ({ ...current, [key]: value }));
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editingAccount) return;
    if (hasRole(editForm.roles, ['QC', 'Freelancer']) && editForm.fields.length === 0) {
      showToast('Account Freelancer/QC cần chọn ít nhất một mảng.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      await api.updateAccount(editingAccount.id, toApiAccount(editForm, false));
      setEditingAccount(null);
      showToast('Đã cập nhật account.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật account.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteAccount = async (account) => {
    const accountLabel = account.displayName || account.username || 'này';
    const linkedProfileText = account.freelancerId !== null && account.freelancerId !== undefined && account.freelancerId !== ''
      ? ' và hồ sơ freelancer liên kết'
      : '';
    if (!window.confirm(`Bạn có chắc muốn xóa account "${accountLabel}"${linkedProfileText}? Hành động này không thể hoàn tác.`)) return;

    setIsSaving(true);
    try {
      await api.deleteAccount(account.id);
      showToast(linkedProfileText ? 'Đã xóa account và hồ sơ freelancer liên kết.' : 'Đã xóa account.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể xóa account.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={embedded ? 'account-management-embedded' : 'fade-in'}>
      {!embedded && <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">PHÂN QUYỀN</span>
          <h2 className="page-title">Quản lý account</h2>
          <p className="page-subtitle">Admin cấp username, password và role cho người dùng trong hệ thống.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading || isSaving}>
          <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>}

      <section className="glass-panel account-create-panel">
        <div className="section-heading">
          <div><span className="qc-kicker">CẤP ACCOUNT</span><h3><IconPlus size={18} /> Tạo account mới</h3></div>
        </div>
        <form className="account-create-form" onSubmit={createAccount}>
          <div className="form-group">
            <label className="form-label" htmlFor="account-username">Username</label>
            <input id="account-username" className="form-input" value={form.username} onChange={(event) => updateField('username', event.target.value)} minLength="3" maxLength="50" required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="account-password">Password</label>
            <input id="account-password" className="form-input" type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} minLength="6" required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="account-name">Họ và tên</label>
            <input id="account-name" className="form-input" value={form.displayName} onChange={(event) => updateField('displayName', event.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="account-email">Email</label>
            <input id="account-email" className="form-input" type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="account-role">Role</label>
            <select id="account-role" className="form-select" value={form.role} onChange={(event) => {
              const role = event.target.value;
              setForm((current) => ({ ...current, role, roles: [role] }));
            }}>
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>
          <div className="form-group">
            <span className="form-label">Mảng</span>
            <FieldCheckboxes options={fieldOptions} value={form.fields} onChange={(fields) => updateField('fields', fields)} />
          </div>
          <div className="account-create-actions">
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              <IconPlus size={16} /> {isSaving ? 'Đang tạo...' : 'Cấp account'}
            </button>
          </div>
        </form>
      </section>

      <section className="glass-panel qc-table-panel">
        <div className="section-heading">
          <div><span className="qc-kicker">DANH SÁCH</span><h3><IconUsers size={18} /> Các account đã cấp</h3></div>
        </div>
        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table account-table">
            <thead>
              <tr>
                {ACCOUNT_FILTER_COLUMNS.map(({ key, label, filterKind, sortKind }) => (
                  <th key={key}>
                    <div className="deadline-column-header">
                      <span>{label}</span>
                      <ColumnFilterButton
                        label={label}
                        values={accountFilterOptions[key] || []}
                        activeValues={columnFilters[key]}
                        filterKind={filterKind}
                        sortKind={sortKind}
                        activeSortDirection={columnSort?.key === key ? columnSort.direction : null}
                        onApply={(selectedValues) => updateColumnFilter(key, selectedValues)}
                        onSort={(direction) => updateColumnSort(key, direction)}
                      />
                    </div>
                  </th>
                ))}
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.length === 0 ? (
                <tr><td colSpan="9"><div className="empty-state table-empty"><IconUsers size={24} /><strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có account.'}</strong></div></td></tr>
              ) : filteredAccounts.map((account) => (
                <tr key={account.id || account.username}>
                  <td className="mono-cell">{account.username}</td>
                  <td className="strong-cell">{account.displayName || '—'}</td>
                  <td>{account.email || '—'}</td>
                  <td className="account-role-cell">{renderRoleBadges(account)}</td>
                  <td>{formatFields(account.fields, account.field)}</td>
                  <td>{account.freelancerName || getFreelancerName(account.freelancerId, freelancerRows)}</td>
                  <td><span className={'data-status ' + (account.isActive ? 'completed' : 'pending')}>{account.isActive ? 'Đang hoạt động' : 'Đã khóa'}</span></td>
                  <td>{formatDate(account.createdAt)}</td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(account)} disabled={isSaving}><IconEdit size={14} /> Chỉnh sửa</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteAccount(account)} disabled={isSaving}><IconTrash size={14} /> Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingAccount && createPortal(
        <div className="modal-overlay" onClick={() => !isSaving && setEditingAccount(null)} role="presentation">
          <form className="modal-content account-edit-modal" onSubmit={saveEdit} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="edit-account-modal-title">
            <div className="modal-header">
              <div>
                <span className="qc-kicker">ACCOUNT</span>
                <div className="modal-title" id="edit-account-modal-title">Chỉnh sửa account</div>
              </div>
              <button type="button" className="icon-button" onClick={() => setEditingAccount(null)} disabled={isSaving} title="Đóng"><IconX size={18} /></button>
            </div>
            <div className="modal-body account-edit-form">
              <div className="form-group">
                <label className="form-label" htmlFor="edit-account-username">Username</label>
                <input id="edit-account-username" className="form-input" value={editForm.username} onChange={(event) => updateEditField('username', event.target.value)} minLength="3" maxLength="50" required disabled={isSaving} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-account-password">Password mới</label>
                <input id="edit-account-password" className="form-input" type="password" value={editForm.password} onChange={(event) => updateEditField('password', event.target.value)} minLength="6" placeholder="Để trống nếu không đổi" disabled={isSaving} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-account-name">Họ và tên</label>
                <input id="edit-account-name" className="form-input" value={editForm.displayName} onChange={(event) => updateEditField('displayName', event.target.value)} required disabled={isSaving} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-account-email">Email</label>
                <input id="edit-account-email" className="form-input" type="email" value={editForm.email} onChange={(event) => updateEditField('email', event.target.value)} disabled={isSaving} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-account-role">Role hiệu lực</label>
                <select id="edit-account-role" className="form-select" value={editForm.role} onChange={(event) => {
                  const role = event.target.value;
                  setEditForm((current) => ({ ...current, role, roles: role === current.role ? current.roles : [role] }));
                }} disabled={isSaving}>
                  {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
              <div className="form-group">
                <span className="form-label">Mảng</span>
                <FieldCheckboxes options={fieldOptions} value={editForm.fields} onChange={(fields) => updateEditField('fields', fields)} disabled={isSaving} />
                <span className="form-help account-create-link-help">QC chỉ xem và nhận deadline trong các mảng được chọn.</span>
              </div>
              <label className="form-checkbox-control">
                <input type="checkbox" checked={editForm.isActive} onChange={(event) => updateEditField('isActive', event.target.checked)} disabled={isSaving} />
                <span>Account đang hoạt động</span>
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setEditingAccount(null)} disabled={isSaving}>Hủy</button>
              <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Đang lưu...' : 'Lưu thay đổi'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}

function toApiAccount(form, includePassword) {
  const roles = getAccountRoles(form);
  const payload = {
    username: form.username,
    displayName: form.displayName,
    email: form.email,
    role: getEffectiveRole(roles),
    roles,
    field: form.fields[0] || null,
    fields: form.fields
  };
  if (includePassword || form.password) payload.password = form.password;
  if (Object.prototype.hasOwnProperty.call(form, 'isActive')) payload.isActive = form.isActive;
  return payload;
}

function getAccountFilterValue(account, key, freelancers) {
  if (key === 'role') return formatRoles(account);
  if (key === 'fields') return getMemberFields(account).join(', ');
  if (key === 'freelancerName') return account.freelancerName || getFreelancerName(account.freelancerId, freelancers);
  if (key === 'status') return account.isActive ? 'Đang hoạt động' : 'Đã khóa';
  if (key === 'createdAt') return getMonthFilterValue(account.createdAt);
  return String(account[key] ?? '');
}

function getMonthFilterValue(value) {
  const text = String(value ?? '').trim();
  const isoMonth = text.match(/^(\d{4})-(\d{2})/);
  if (isoMonth) return `${isoMonth[1]}-${isoMonth[2]}`;
  if (!text) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatAccountFilterValue(value, filterKind) {
  if (value === '') return '(Trống)';
  if (filterKind === 'month') {
    const [year, month] = value.split('-');
    return year && month ? `Tháng ${Number(month)}/${year}` : value;
  }
  return value;
}

function getFreelancerName(id, freelancers = EMPTY_ROWS) {
  if (id === null || id === undefined || id === '') return '—';
  const freelancerRows = Array.isArray(freelancers) ? freelancers : EMPTY_ROWS;
  return freelancerRows.find((freelancer) => String(getFreelancerId(freelancer)) === String(id))?.name || String(id);
}

function formatFields(fields, fallback) {
  const values = Array.isArray(fields) && fields.length > 0 ? fields : (fallback ? [fallback] : []);
  return values.length > 0 ? values.join(', ') : '—';
}

function getMemberFields(member = {}) {
  if (!member || typeof member !== 'object') return [];
  if (Array.isArray(member.fields) && member.fields.length > 0) return member.fields;
  return member.field ? [member.field] : [];
}

function getAccountRoles(account = {}) {
  const values = Array.isArray(account.roles) && account.roles.length > 0 ? account.roles : [account.role || 'QC'];
  return [...new Set(values.filter((role) => ROLE_OPTIONS.includes(role)))];
}

function hasRole(roles, expected) {
  return expected.some((role) => (Array.isArray(roles) ? roles : []).includes(role));
}

function getEffectiveRole(roles) {
  const values = Array.isArray(roles) ? roles : [];
  return values.includes('Admin') ? 'Admin' : values.includes('QC') ? 'QC' : 'Freelancer';
}

function formatRoles(account) {
  return getAccountRoles(account).join(' + ');
}

function renderRoleBadges(account) {
  return (
    <span className="role-badges" aria-label={`Role: ${formatRoles(account)}`}>
      {getAccountRoles(account).map((role) => (
        <span className={'role-badge role-' + role.toLowerCase()} key={role}>{role}</span>
      ))}
    </span>
  );
}

function FieldCheckboxes({ options = [], value = [], onChange, disabled = false }) {
  const selectedFields = Array.isArray(value) ? value : [];
  return (
    <div className="account-field-checkboxes" role="group" aria-label="Mảng">
      {options.map((option) => (
        <label className="account-field-checkbox" key={option}>
          <input
            type="checkbox"
            checked={selectedFields.includes(option)}
            onChange={(event) => {
              const nextFields = event.target.checked
                ? [...selectedFields, option]
                : selectedFields.filter((field) => field !== option);
              onChange(nextFields);
            }}
            disabled={disabled}
          />
          <span>{option}</span>
        </label>
      ))}
    </div>
  );
}

function ColumnFilterButton({ label, values, activeValues, filterKind, sortKind, activeSortDirection, onApply, onSort }) {
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

  const visibleValues = values.filter((value) => formatAccountFilterValue(value, filterKind).toLowerCase().includes(searchValue.trim().toLowerCase()));
  const allSelected = values.length > 0 && draftValues.length === values.length;

  const toggleValue = (value) => {
    setDraftValues((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  const applyFilter = () => {
    onApply(draftValues.length === values.length ? null : draftValues);
    setIsOpen(false);
  };

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
              <button type="button" className={'column-filter-sort-button' + (activeSortDirection === 'asc' ? ' active' : '')} onClick={() => applySort('asc')}>A → Z</button>
              <button type="button" className={'column-filter-sort-button' + (activeSortDirection === 'desc' ? ' active' : '')} onClick={() => applySort('desc')}>Z → A</button>
            </div>
          )}
          <input
            className="form-input column-filter-search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Tìm giá trị..."
            autoFocus
          />
          <label className="column-filter-option column-filter-select-all">
            <input type="checkbox" checked={allSelected} onChange={() => setDraftValues(allSelected ? [] : [...values])} />
            <span>Chọn tất cả</span>
          </label>
          <div className="column-filter-options">
            {visibleValues.length > 0 ? visibleValues.map((value) => (
              <label className="column-filter-option" key={value || '__empty__'}>
                <input type="checkbox" checked={draftValues.includes(value)} onChange={() => toggleValue(value)} />
                <span title={formatAccountFilterValue(value, filterKind)}>{formatAccountFilterValue(value, filterKind)}</span>
              </label>
            )) : <span className="column-filter-empty">Không có giá trị phù hợp.</span>}
          </div>
          <div className="column-filter-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => { onApply(null); setIsOpen(false); }}>Xóa lọc</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={applyFilter}>Áp dụng</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function getFreelancerId(freelancer = {}) {
  return freelancer.fIld ?? freelancer.fId ?? freelancer.id;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN');
}
