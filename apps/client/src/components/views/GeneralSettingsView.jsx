import React, { useEffect, useState } from 'react';
import { IconBook, IconEdit, IconFolder, IconPlus, IconRefresh, IconTrash, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api, getUserFacingErrorMessage } from '../../services/api';

const createChecklistId = () => `checklist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function GeneralSettingsView({ fields = [], generalSettings, isLoading, onRefresh }) {
  const [googleSheetUrl, setGoogleSheetUrl] = useState(generalSettings?.googleSheetUrl || '');
  const [googleSheetTabs, setGoogleSheetTabs] = useState(generalSettings?.googleSheetTabs || {});
  const [googleDriveFolders, setGoogleDriveFolders] = useState(generalSettings?.googleDriveFolders || {});
  const [checklists, setChecklists] = useState(generalSettings?.checklists || {});
  const [googleSheetAutoSync, setGoogleSheetAutoSync] = useState(generalSettings?.googleSheetAutoSync === true);
  const [newField, setNewField] = useState('');
  const [editingField, setEditingField] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [editingGuideUrl, setEditingGuideUrl] = useState('');
  const [editingResourceUrl, setEditingResourceUrl] = useState('');
  const [checklistDrafts, setChecklistDrafts] = useState({});
  const [editingChecklist, setEditingChecklist] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setGoogleSheetUrl(generalSettings?.googleSheetUrl || '');
    const configuredTabs = generalSettings?.googleSheetTabs || {};
    const defaultTabs = Object.fromEntries(fields.map((field) => [field.name, field.name]));
    setGoogleSheetTabs({ ...defaultTabs, ...configuredTabs });
    const configuredDriveFolders = generalSettings?.googleDriveFolders || {};
    const defaultDriveFolders = Object.fromEntries(fields.map((field) => [field.name, '']));
    setGoogleDriveFolders({ ...defaultDriveFolders, ...configuredDriveFolders });
    const configuredChecklists = generalSettings?.checklists && typeof generalSettings.checklists === 'object' ? generalSettings.checklists : {};
    const defaultChecklists = Object.fromEntries(fields.map((field) => [field.name, Array.isArray(configuredChecklists[field.name]) ? configuredChecklists[field.name] : []]));
    setChecklists({ ...configuredChecklists, ...defaultChecklists });
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
        googleDriveFolders,
        checklists,
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

  const updateGoogleDriveFolder = (fieldName, value) => {
    setGoogleDriveFolders((current) => ({ ...current, [fieldName]: value }));
  };

  const updateChecklistDraft = (fieldName, key, value) => {
    setChecklistDrafts((current) => ({
      ...current,
      [fieldName]: {
        ...(current[fieldName] || { name: '', url: '' }),
        [key]: value
      }
    }));
  };

  const persistChecklists = async (nextChecklists, successMessage) => {
    setIsSaving(true);
    try {
      await api.updateGeneralSettings({ checklists: nextChecklists });
      showToast(successMessage, 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể lưu checklist.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const addChecklist = async (event, fieldName) => {
    event.preventDefault();
    const draft = checklistDrafts[fieldName] || { name: '', url: '' };
    const url = draft.url.trim();
    if (!url) {
      showToast('Vui lòng nhập link Google Sheet checklist.', 'error');
      return;
    }
    const currentItems = Array.isArray(checklists[fieldName]) ? checklists[fieldName] : [];
    const item = {
      id: createChecklistId(),
      name: draft.name.trim() || `Checklist ${currentItems.length + 1}`,
      url
    };
    await persistChecklists({ ...checklists, [fieldName]: [...currentItems, item] }, 'Đã thêm checklist.');
    setChecklistDrafts((current) => ({ ...current, [fieldName]: { name: '', url: '' } }));
  };

  const startEditChecklist = (fieldName, item) => {
    setEditingChecklist({
      fieldName,
      id: item.id,
      name: item.name || '',
      url: item.url || ''
    });
  };

  const saveChecklist = async (event) => {
    event.preventDefault();
    if (!editingChecklist) return;
    const url = editingChecklist.url.trim();
    if (!url) {
      showToast('Vui lòng nhập link Google Sheet checklist.', 'error');
      return;
    }
    const { fieldName, id, name } = editingChecklist;
    const nextItems = (checklists[fieldName] || []).map((item) => (
      item.id === id
        ? { ...item, name: name.trim() || 'Checklist', url }
        : item
    ));
    await persistChecklists({ ...checklists, [fieldName]: nextItems }, 'Đã cập nhật checklist.');
    setEditingChecklist(null);
  };

  const removeChecklist = async (fieldName, item) => {
    if (!window.confirm(`Xóa checklist "${item.name || 'Checklist'}" của mảng ${fieldName}?`)) return;
    const nextItems = (checklists[fieldName] || []).filter((candidate) => candidate.id !== item.id);
    await persistChecklists({ ...checklists, [fieldName]: nextItems }, 'Đã xóa checklist.');
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
        googleDriveFolders,
        checklists,
        googleSheetAutoSync
      });
      const result = await api.syncGoogleSheet();
      const deletedMessage = result.deleted ? ' Đã xóa ' + result.deleted + ' dòng không còn trên Sheet.' : '';
      const repairedStatusMessage = result.repairedStatuses ? ' Đã tự sửa ' + result.repairedStatuses + ' ô Status về đúng dropdown.' : '';
      const hiddenMessage = result.hidden ? ' Bỏ qua ' + result.hidden + ' dòng đang ẩn.' : '';
      const driveLinkedMessage = result.driveLinked ? ' Đã tự gắn ' + result.driveLinked + ' link folder Google Drive.' : '';
      const driveMissingMessage = result.driveMissing ? ' Không tìm thấy folder cho ' + result.driveMissing + ' ID bộ truyện.' : '';
      const driveErrorMessage = result.driveError
        ? ' Lỗi gắn link Drive: ' + getUserFacingErrorMessage(result.driveError, 'Không thể tự gắn link Google Drive.')
        : '';
      showToast('Đã đồng bộ ' + (result.sheetRows ?? result.total) + ' dòng từ Sheet (' + result.inserted + ' mới, ' + result.updated + ' cập nhật).' + repairedStatusMessage + deletedMessage + hiddenMessage + driveLinkedMessage + driveMissingMessage + driveErrorMessage, 'success');
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
          <div><span className="qc-kicker">GOOGLE SHEET</span><h3>Đồng bộ hai chiều bảng quản lý deadline</h3><p className="form-help">Service Account cần quyền Editor trên file. Dòng đầu tiên của mỗi tab phải là tên cột.</p></div>
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
          <div className="general-settings-drive-grid">
            <div className="general-settings-subheading">
              <span className="qc-kicker">GOOGLE DRIVE</span>
              <h3>Folder gốc theo mảng</h3>
              <p className="form-help">Hệ thống ưu tiên folder con có tên seriesId, sau đó đối chiếu tên truyện; hỗ trợ tên tiếng Anh, Hàn, Trung và các ký tự đặc biệt.</p>
            </div>
            <div className="general-settings-tab-grid">
              {fields.map((field) => (
                <div className="form-group" key={`drive-${field.id || field.name}`}>
                  <label className="form-label" htmlFor={`google-drive-folder-${field.id || field.name}`}>Folder Drive của mảng {field.name}</label>
                  <input id={`google-drive-folder-${field.id || field.name}`} className="form-input" value={googleDriveFolders[field.name] ?? ''} onChange={(event) => updateGoogleDriveFolder(field.name, event.target.value)} placeholder={field.name} disabled={isSaving} />
                  <span className="form-help">Ví dụ: {field.name}/&lt;seriesId&gt;</span>
                </div>
              ))}
            </div>
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
        {generalSettings?.googleSheetLastSyncedAt && <p className="form-help general-settings-sync-status">Lần đồng bộ gần nhất: {new Date(generalSettings.googleSheetLastSyncedAt).toLocaleString('vi-VN')} · {generalSettings.googleSheetLastSyncCount ?? 0} dòng hợp lệ</p>}
        {generalSettings?.googleSheetLastSyncError && <p className="form-help general-settings-sync-error">Cảnh báo/lỗi gần nhất: {getUserFacingErrorMessage(generalSettings.googleSheetLastSyncError, 'Google Sheet chưa đồng bộ thành công.')}</p>}
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

      <section className="glass-panel qc-table-panel general-checklists-panel">
        <div className="section-heading">
          <div>
            <span className="qc-kicker">CHECKLIST</span>
            <h3>Checklist theo mảng</h3>
            <p className="form-help">Một mảng có thể có nhiều checklist. Chỉ chấp nhận link Google Sheet và checklist sẽ hiển thị trên dashboard của Admin và Freelancer thuộc mảng tương ứng.</p>
          </div>
        </div>
        <div className="general-checklist-list">
          {fields.map((field) => {
            const items = Array.isArray(checklists[field.name]) ? checklists[field.name] : [];
            const draft = checklistDrafts[field.name] || { name: '', url: '' };
            return (
              <div className="general-checklist-field" key={field.id || field.name}>
                <div className="general-checklist-heading">
                  <span className="field-badge">{field.name}</span>
                  <span className="form-help">{items.length} checklist</span>
                </div>
                <div className="general-checklist-items">
                  {items.map((item, index) => (
                    editingChecklist?.fieldName === field.name && editingChecklist.id === item.id ? (
                      <form className="general-checklist-edit-form" onSubmit={saveChecklist} key={item.id || index}>
                        <input className="form-input" value={editingChecklist.name} onChange={(event) => setEditingChecklist((current) => ({ ...current, name: event.target.value }))} placeholder="Tên checklist" maxLength="150" disabled={isSaving} />
                        <input className="form-input" type="url" value={editingChecklist.url} onChange={(event) => setEditingChecklist((current) => ({ ...current, url: event.target.value }))} placeholder="https://docs.google.com/spreadsheets/d/..." disabled={isSaving} required />
                        <div className="table-actions">
                          <button type="submit" className="btn btn-primary btn-sm" disabled={isSaving}>Lưu</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingChecklist(null)} disabled={isSaving}><IconX size={14} /> Hủy</button>
                        </div>
                      </form>
                    ) : (
                      <div className="general-checklist-row" key={item.id || `${field.name}-${index}`}>
                        <div>
                          <strong>{item.name || `Checklist ${index + 1}`}</strong>
                          <a href={item.url} target="_blank" rel="noreferrer">Mở Google Sheet</a>
                        </div>
                        <div className="table-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEditChecklist(field.name, item)} disabled={isSaving}><IconEdit size={14} /> Sửa</button>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => removeChecklist(field.name, item)} disabled={isSaving}><IconTrash size={14} /> Xóa</button>
                        </div>
                      </div>
                    )
                  ))}
                </div>
                <form className="general-checklist-add-form" onSubmit={(event) => addChecklist(event, field.name)}>
                  <input className="form-input" value={draft.name} onChange={(event) => updateChecklistDraft(field.name, 'name', event.target.value)} placeholder="Tên checklist (không bắt buộc)" maxLength="150" disabled={isSaving} />
                  <input className="form-input" type="url" value={draft.url} onChange={(event) => updateChecklistDraft(field.name, 'url', event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." disabled={isSaving} required />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={isSaving}><IconPlus size={14} /> Thêm checklist</button>
                </form>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
