import React, { useMemo, useState } from 'react';
import { IconEdit, IconPlus, IconRefresh, IconTrash, IconUsers, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';

const ROLE_OPTIONS = ['Admin', 'QC', 'Freelancer'];
const FIELD_OPTIONS = ['Japan', 'Latin', 'QC'];

const INITIAL_FORM = {
  username: '',
  password: '',
  displayName: '',
  email: '',
  role: 'QC',
  field: '',
  fields: [],
  freelancerId: ''
};

export function AccountManagementView({ accounts = [], freelancers = [], fields = [], isLoading, onRefresh, embedded = false }) {
  const fieldOptions = useMemo(() => fields.length > 0 ? fields.map((field) => field.name || field).filter(Boolean) : FIELD_OPTIONS, [fields]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editForm, setEditForm] = useState(INITIAL_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const createAccount = async (event) => {
    event.preventDefault();
    if (form.role === 'QC' && form.fields.length === 0) {
      showToast('Hãy chọn ít nhất một mảng cho account QC.', 'error');
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
    if (editForm.role === 'QC' && editForm.fields.length === 0) {
      showToast('Hãy chọn ít nhất một mảng cho account QC.', 'error');
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
    if (!window.confirm(`Bạn có chắc muốn xóa account "${accountLabel}"? Hành động này không thể hoàn tác.`)) return;

    setIsSaving(true);
    try {
      await api.deleteAccount(account.id);
      showToast('Đã xóa account.', 'success');
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
            <select id="account-role" className="form-select" value={form.role} onChange={(event) => updateField('role', event.target.value)}>
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="account-field">Mảng</label>
            {form.role === 'QC' ? (
              <FieldCheckboxes options={fieldOptions} value={form.fields} onChange={(fields) => updateField('fields', fields)} />
            ) : (
              <select id="account-field" className="form-select" value={form.field} onChange={(event) => updateField('field', event.target.value)} required={form.role === 'Freelancer'}>
                <option value="">Chọn mảng</option>
                {fieldOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            )}
            {form.role === 'QC' && <span className="form-help account-create-link-help">Có thể chọn nhiều mảng.</span>}
          </div>
          <div className="account-create-actions">
            <span className="form-help">Password được lưu dạng hash trong database và không hiển thị lại.</span>
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
              <tr><th>Username</th><th>Họ và tên</th><th>Email</th><th>Role</th><th>Mảng</th><th>Freelancer liên kết</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr><td colSpan="9"><div className="empty-state table-empty"><IconUsers size={24} /><strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có account.'}</strong></div></td></tr>
              ) : accounts.map((account) => (
                <tr key={account.id || account.username}>
                  <td className="mono-cell">{account.username}</td>
                  <td className="strong-cell">{account.displayName || '—'}</td>
                  <td>{account.email || '—'}</td>
                  <td><span className={'role-badge role-' + String(account.role || '').toLowerCase()}>{account.role}</span></td>
                  <td>{formatFields(account.fields, account.field)}</td>
                  <td>{account.freelancerName || getFreelancerName(account.freelancerId, freelancers)}</td>
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

      {editingAccount && (
        <div className="modal-overlay" onClick={() => !isSaving && setEditingAccount(null)}>
          <form className="modal-content account-edit-modal" onSubmit={saveEdit} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="qc-kicker">ACCOUNT</span>
                <div className="modal-title">Chỉnh sửa account</div>
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
                <label className="form-label" htmlFor="edit-account-role">Role</label>
                <select id="edit-account-role" className="form-select" value={editForm.role} onChange={(event) => updateEditField('role', event.target.value)} disabled={isSaving}>
                  {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="edit-account-field">Mảng</label>
                {editForm.role === 'QC' ? (
                  <FieldCheckboxes options={fieldOptions} value={editForm.fields} onChange={(fields) => updateEditField('fields', fields)} disabled={isSaving} />
                ) : (
                  <select id="edit-account-field" className="form-select" value={editForm.field} onChange={(event) => updateEditField('field', event.target.value)} required={editForm.role === 'Freelancer'} disabled={isSaving}>
                    <option value="">Chọn mảng</option>
                    {fieldOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                )}
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
        </div>
      )}
    </div>
  );
}

function toApiAccount(form, includePassword) {
  const payload = {
    username: form.username,
    displayName: form.displayName,
    email: form.email,
    role: form.role,
    field: form.role === 'QC' ? (form.fields[0] || null) : (form.field || null),
    fields: form.role === 'QC' ? form.fields : (form.field ? [form.field] : [])
  };
  if (includePassword || form.password) payload.password = form.password;
  if (Object.prototype.hasOwnProperty.call(form, 'isActive')) payload.isActive = form.isActive;
  return payload;
}

function getFreelancerName(id, freelancers) {
  if (id === null || id === undefined || id === '') return '—';
  return freelancers.find((freelancer) => String(getFreelancerId(freelancer)) === String(id))?.name || String(id);
}

function formatFields(fields, fallback) {
  const values = Array.isArray(fields) && fields.length > 0 ? fields : (fallback ? [fallback] : []);
  return values.length > 0 ? values.join(', ') : '—';
}

function FieldCheckboxes({ options = FIELD_OPTIONS, value = [], onChange, disabled = false }) {
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

function getFreelancerId(freelancer) {
  return freelancer.fIld ?? freelancer.fId ?? freelancer.id;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN');
}
