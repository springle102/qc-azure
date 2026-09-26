import React, { useEffect, useState } from 'react';
import { IconBook, IconEdit, IconFolder, IconPlus, IconRefresh, IconTrash, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';

export function GeneralSettingsView({ fields = [], generalSettings, isLoading, onRefresh }) {
  const [googleSheetUrl, setGoogleSheetUrl] = useState(generalSettings?.googleSheetUrl || '');
  const [googleSheetTabs, setGoogleSheetTabs] = useState(generalSettings?.googleSheetTabs || {});
  const [googleSheetAutoSync, setGoogleSheetAutoSync] = useState(generalSettings?.googleSheetAutoSync === true);
  const [newField, setNewField] = useState('');
  const [editingField, setEditingField] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [editingGuideUrl, setEditingGuideUrl] = useState('');
  const [editingResourceUrl, setEditingResourceUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setGoogleSheetUrl(generalSettings?.googleSheetUrl || '');
    const configuredTabs = generalSettings?.googleSheetTabs || {};
    const defaultTabs = Object.fromEntries(fields.map((field) => [field.name, field.name]));
    setGoogleSheetTabs({ ...defaultTabs, ...configuredTabs });
    setGoogleSheetAutoSync(generalSettings?.googleSheetAutoSync === true);
  }, [generalSettings, fields]);

  const addField = async (event) => {
    event.preventDefault();
    if (!newField.trim()) return;
    setIsSaving(true);
    try {
      await api.createField({ name: newField.trim() });
      setNewField('');
      showToast('Đã thêm mảng.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể thêm mảng.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const saveGoogleSheet = async (event) => {
    event.preventDefault();
    if (!googleSheetUrl.trim()) {
      showToast('Vui lòng nhập link Google Sheet.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      await api.updateGeneralSettings({
        googleSheetUrl: googleSheetUrl.trim(),
        googleSheetTabs,
        googleSheetAutoSync
      });
      showToast('Đã lưu kết nối Google Sheet.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể lưu kết nối Google Sheet.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateGoogleSheetTab = (fieldName, value) => {
    setGoogleSheetTabs((current) => ({ ...current, [fieldName]: value }));
  };

  const syncGoogleSheet = async () => {
    if (!googleSheetUrl.trim()) {
      showToast('Vui lòng nhập link Google Sheet.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      await api.updateGeneralSettings({
        googleSheetUrl: googleSheetUrl.trim(),
        googleSheetTabs,
        googleSheetAutoSync
      });
      const result = await api.syncGoogleSheet();
      const skippedMessage = result.skipped ? ' Bỏ qua ' + result.skipped + ' dòng thiếu dữ liệu bắt buộc.' : '';
      const duplicateMessage = result.duplicates ? ' Có ' + result.duplicates + ' dòng trùng, đã ưu tiên bản ghi cuối.' : '';
      showToast('Đã đồng bộ ' + result.total + ' dòng (' + result.inserted + ' mới, ' + result.updated + ' cập nhật).' + skippedMessage + duplicateMessage, 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể đồng bộ Google Sheet.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const startEditField = (field) => {
    setEditingField(field);
    setEditingName(field.name);
    setEditingGuideUrl(field.guideUrl || '');
    setEditingResourceUrl(field.resourceUrl || '');
  };

  const saveField = async (event) => {
    event.preventDefault();
    if (!editingField || !editingName.trim()) return;
    setIsSaving(true);
    try {
      await api.updateField(editingField.id, {
        name: editingName.trim(),
        guideUrl: editingGuideUrl.trim(),
        resourceUrl: editingResourceUrl.trim()
      });
      setEditingField(null);
      showToast('Đã cập nhật mảng và link Guide/Tài nguyên.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật mảng.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const removeField = async (field) => {
    if (!window.confirm(`Xóa mảng ${field.name}? Mảng đang được sử dụng sẽ không thể xóa.`)) return;
    setIsSaving(true);
    try {
      await api.deleteField(field.id);
      showToast('Đã xóa mảng.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể xóa mảng.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">HỆ THỐNG</span>
          <h2 className="page-title">Cấu hình chung</h2>
          <p className="page-subtitle">Thiết lập kết nối Google Sheet và danh sách mảng dùng chung.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading || isSaving}>
          <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      <section className="glass-panel general-settings-panel">
        <div className="section-heading">
          <div><span className="qc-kicker">GOOGLE SHEET</span><h3>Đồng bộ bảng quản lý deadline</h3><p className="form-help">Service Account chỉ cần quyền Viewer trên file. Dòng đầu tiên của tab phải là tên cột.</p></div>
        </div>
        <form className="general-settings-form google-sheet-settings-form" onSubmit={saveGoogleSheet}>
          <div className="form-group form-group-full">
            <label className="form-label" htmlFor="google-sheet-url">Link Google Sheet</label>
            <input id="google-sheet-url" className="form-input" type="url" value={googleSheetUrl} onChange={(event) => setGoogleSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." disabled={isSaving} required />
          </div>
          <div className="general-settings-tab-grid">
            {fields.map((field) => (
              <div className="form-group" key={field.id || field.name}>
                <label className="form-label" htmlFor={`google-sheet-tab-${field.id || field.name}`}>Tab của mảng {field.name}</label>
                <input id={`google-sheet-tab-${field.id || field.name}`} className="form-input" value={googleSheetTabs[field.name] ?? field.name} onChange={(event) => updateGoogleSheetTab(field.name, event.target.value)} placeholder={field.name} disabled={isSaving} />
                <span className="form-help">Nhập tên tab hoặc phạm vi, ví dụ {field.name}!A:Q</span>
              </div>
            ))}
          </div>
          <label className="general-settings-checkbox">
            <input type="checkbox" checked={googleSheetAutoSync} onChange={(event) => setGoogleSheetAutoSync(event.target.checked)} disabled={isSaving} />
            <span>Tự động đồng bộ tối đa mỗi 5 phút khi tải dữ liệu deadline</span>
          </label>
          <div className="general-settings-actions">
            <button type="submit" className="btn btn-primary" disabled={isSaving}>{isSaving ? 'Đang lưu...' : 'Lưu kết nối'}</button>
            <button type="button" className="btn btn-secondary" onClick={syncGoogleSheet} disabled={isSaving || !googleSheetUrl.trim()}><IconRefresh size={16} /> Đồng bộ ngay</button>
          </div>
        </form>
        {generalSettings?.googleSheetLastSyncedAt && <p className="form-help general-settings-sync-status">Lần đồng bộ gần nhất: {new Date(generalSettings.googleSheetLastSyncedAt).toLocaleString('vi-VN')} · {generalSettings.googleSheetLastSyncCount ?? 0} dòng</p>}
        {generalSettings?.googleSheetLastSyncError && <p className="form-help general-settings-sync-error">Lỗi gần nhất: {generalSettings.googleSheetLastSyncError}</p>}
      </section>

      <section className="glass-panel qc-table-panel">
        <div className="section-heading">
          <div><span className="qc-kicker">DANH SÁCH MẢNG</span><h3>Thêm, sửa, xóa mảng</h3><p className="form-help">Mỗi mảng có một Guide và một link Tài nguyên riêng. Freelancer chỉ nhìn thấy link của mảng được cấp.</p></div>
        </div>
        <form className="general-field-create-form" onSubmit={addField}>
          <input className="form-input" value={newField} onChange={(event) => setNewField(event.target.value)} placeholder="Tên mảng mới" maxLength="50" disabled={isSaving} required />
          <button type="submit" className="btn btn-primary" disabled={isSaving}><IconPlus size={16} /> Thêm mảng</button>
        </form>
        <div className="general-field-list">
          {fields.map((field) => (
            <div className="general-field-row" key={field.id}>
              {editingField?.id === field.id ? (
                <form className="general-field-edit-form" onSubmit={saveField}>
                  <div className="general-field-edit-fields">
                    <div className="form-group">
                      <label className="form-label" htmlFor={`field-name-${field.id}`}>Tên mảng</label>
                      <input id={`field-name-${field.id}`} className="form-input" value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength="50" disabled={isSaving} required autoFocus />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor={`field-guide-${field.id}`}>Guide URL</label>
                      <input id={`field-guide-${field.id}`} className="form-input" type="url" value={editingGuideUrl} onChange={(event) => setEditingGuideUrl(event.target.value)} placeholder="https://..." disabled={isSaving} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor={`field-resource-${field.id}`}>Tài nguyên URL</label>
                      <input id={`field-resource-${field.id}`} className="form-input" type="url" value={editingResourceUrl} onChange={(event) => setEditingResourceUrl(event.target.value)} placeholder="https://..." disabled={isSaving} />
                    </div>
                  </div>
                  <div className="table-actions">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={isSaving}>Lưu</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingField(null)} disabled={isSaving}><IconX size={14} /> Hủy</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="general-field-summary">
                    <span className="field-badge">{field.name}</span>
                    <div className="general-field-links">
                      <span><IconBook size={13} /> Guide: {field.guideUrl ? <a href={field.guideUrl} target="_blank" rel="noreferrer">Đã cấu hình</a> : <em>Chưa cấu hình</em>}</span>
                      <span><IconFolder size={13} /> Tài nguyên: {field.resourceUrl ? <a href={field.resourceUrl} target="_blank" rel="noreferrer">Đã cấu hình</a> : <em>Chưa cấu hình</em>}</span>
                    </div>
                  </div>
                  <div className="table-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEditField(field)} disabled={isSaving}><IconEdit size={14} /> Sửa</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeField(field)} disabled={isSaving}><IconTrash size={14} /> Xóa</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
