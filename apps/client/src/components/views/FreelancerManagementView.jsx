import React, { useMemo, useState } from 'react';
import { IconEdit, IconRefresh, IconSearch, IconUsers, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';
import { AccountManagementView } from './AccountManagementView';

const FIELD_OPTIONS = ['Japan', 'Latin', 'QC'];
const EMPTY_ROWS = [];

export function FreelancerManagementView({ freelancers = [], accounts = [], fields = [], isLoading, onRefresh, canManageAccounts = false, canEdit = false }) {
  const freelancerRows = Array.isArray(freelancers) ? freelancers : EMPTY_ROWS;
  const accountRows = Array.isArray(accounts) ? accounts : EMPTY_ROWS;
  const fieldRows = Array.isArray(fields) ? fields : EMPTY_ROWS;
  const fieldOptions = useMemo(() => fieldRows.length > 0 ? fieldRows.map((field) => field.name || field).filter(Boolean) : FIELD_OPTIONS, [fieldRows]);
  const [field, setField] = useState('');
  const [search, setSearch] = useState('');
  const [editingFreelancer, setEditingFreelancer] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', field: '', note: '' });
  const [isSaving, setIsSaving] = useState(false);

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
    return matchesField && matchesSearch;
  }), [field, search, freelancerRows]);

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
          <p className="page-subtitle">Quản lý hồ sơ Freelancer và account liên kết trên cùng một tab.</p>
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
                <th>fId</th>
                <th>Họ và tên</th>
                <th>Email</th>
                <th>Mảng</th>
                <th>Note</th>
                <th>Account</th>
                <th>Trạng thái account</th>
                {canEdit && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {filteredFreelancers.length === 0 ? (
                <tr><td colSpan={canEdit ? 8 : 7}><EmptyTable icon={<IconUsers size={24} />} text={isLoading ? 'Đang tải dữ liệu...' : 'Chưa có freelancer trong hệ thống.'} /></td></tr>
              ) : filteredFreelancers.map((freelancer) => (
                <tr key={freelancer.fIld || freelancer.fId || freelancer.id}>
                  <td className="mono-cell">{freelancer.fId || freelancer.fIld || '—'}</td>
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

      {editingFreelancer && (
        <div className="modal-overlay" onClick={() => !isSaving && setEditingFreelancer(null)}>
          <form className="modal-content freelancer-edit-modal" onSubmit={saveFreelancer} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="qc-kicker">FREELANCER</span>
                <div className="modal-title">Chỉnh sửa freelancer</div>
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
        </div>
      )}
    </div>
  );
}

function EmptyTable({ icon, text }) {
  return <div className="empty-state table-empty">{icon}<strong>{text}</strong></div>;
}

function getMemberFields(member = {}) {
  if (!member || typeof member !== 'object') return [];
  if (Array.isArray(member.fields) && member.fields.length > 0) return member.fields;
  return member.field ? [member.field] : [];
}
