import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconExternalLink, IconPlus, IconRefresh, IconTrash } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';

const ERROR_TYPE_OPTIONS = ['TR', 'File', 'Censor', 'Exposure', 'Logo/Credit', 'Text', 'SFX', 'Image', 'Bubble', 'Aesthetics', 'RD'];

function getFreelancerId(freelancer) {
  return freelancer?.fIld ?? freelancer?.fId ?? freelancer?.id ?? null;
}

function getFreelancerFields(freelancer) {
  const values = Array.isArray(freelancer?.fields) && freelancer.fields.length > 0
    ? freelancer.fields
    : [freelancer?.field];
  return values.map((value) => String(value ?? '').trim()).filter(Boolean);
}

function matchesField(row, fieldName) {
  return String(row?.field ?? '').trim().toLowerCase() === String(fieldName ?? '').trim().toLowerCase();
}

function getErrorTypeClass(value) {
  const slug = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? `error-type-${slug}` : 'error-type-empty';
}

function ErrorTypeBadge({ value }) {
  return <span className={`error-type-badge ${getErrorTypeClass(value)}`}>{value || 'Chưa chọn'}</span>;
}

function ErrorTypeControl({ value, disabled = false, onChange, ariaLabel = 'Chọn Error Type', id }) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selectedClassName = getErrorTypeClass(value);
  const selectedLabel = value || 'Chọn loại lỗi';

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!dropdownRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setIsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return undefined;
    }
    const updateMenuPosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = Math.max(154, rect.width);
      const menuHeight = (ERROR_TYPE_OPTIONS.length + 1) * 34 + 10;
      const shouldOpenUp = rect.bottom + 6 + menuHeight > window.innerHeight && rect.top > menuHeight + 6;
      const top = shouldOpenUp ? rect.top - menuHeight - 6 : rect.bottom + 6;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);
      setMenuPosition({ top: Math.max(8, top), left, width: menuWidth });
    };
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen]);

  const selectType = (nextValue) => {
    setIsOpen(false);
    onChange?.(nextValue || '');
  };

  return (
    <div ref={dropdownRef} id={id} className={`task-status-dropdown error-type-dropdown ${isOpen ? 'is-open' : ''}`}>
      <button type="button" ref={triggerRef} className={`task-status-trigger error-type-trigger ${selectedClassName}`} onClick={() => setIsOpen((open) => !open)} disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={isOpen}>
        <span className="task-status-trigger-label"><span className="task-status-dot" aria-hidden="true" />{selectedLabel}</span>
        <span className="task-status-chevron" aria-hidden="true">⌄</span>
      </button>
      {isOpen && menuPosition && createPortal(
        <div ref={menuRef} className="task-status-menu error-type-menu" style={menuPosition} role="listbox" aria-label={ariaLabel}>
          <button type="button" className={`task-status-option error-type-option error-type-empty ${!value ? 'is-selected' : ''}`} role="option" aria-selected={!value} onClick={() => selectType('')}>
            <span className="task-status-dot" aria-hidden="true" />Chọn loại lỗi
          </button>
          {ERROR_TYPE_OPTIONS.map((option) => (
            <button type="button" key={option} className={`task-status-option error-type-option ${getErrorTypeClass(option)} ${value === option ? 'is-selected' : ''}`} role="option" aria-selected={value === option} onClick={() => selectType(option)}>
              <span className="task-status-dot" aria-hidden="true" />{option}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export function ErrorManagementView({
  errors = [],
  fields = [],
  freelancers = [],
  generalSettings = {},
  currentUser = {},
  isLoading,
  onRefresh,
  onUpdate,
  onCreate,
  onDelete
}) {
  const canManage = ['Admin', 'QC'].includes(currentUser.role);
  const [activeField, setActiveField] = useState(fields[0]?.name || '');
  const [sortDirection, setSortDirection] = useState('asc');
  const [localErrors, setLocalErrors] = useState(errors);
  const [draftNotes, setDraftNotes] = useState({});
  const [errorSheetUrls, setErrorSheetUrls] = useState(generalSettings?.errorSheetUrls || {});
  const [newError, setNewError] = useState({ title: '', chapter: '', errorType: '', error: '', note: '', editorFreelancerId: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [savingRowId, setSavingRowId] = useState(null);

  useEffect(() => {
    setLocalErrors(errors);
  }, [errors]);

  useEffect(() => {
    const fieldStillVisible = fields.some((field) => field.name === activeField);
    if (!fieldStillVisible) setActiveField(fields[0]?.name || '');
  }, [activeField, fields]);

  useEffect(() => {
    setErrorSheetUrls(generalSettings?.errorSheetUrls || {});
  }, [generalSettings]);

  const activeSheetUrl = errorSheetUrls[activeField] || '';
  const activeErrors = useMemo(() => localErrors
    .filter((row) => matchesField(row, activeField))
    .sort((left, right) => {
      const compared = String(left.title || '').localeCompare(String(right.title || ''), 'vi', { sensitivity: 'base' });
      return sortDirection === 'asc' ? compared : -compared;
    }), [activeField, localErrors, sortDirection]);

  const editorOptions = freelancers.filter((freelancer) => (
    !activeField || getFreelancerFields(freelancer).some((field) => field.toLowerCase() === activeField.toLowerCase())
  ));

  const updateLocalRow = (updatedRow) => {
    setLocalErrors((current) => current.map((row) => row.id === updatedRow.id ? updatedRow : row));
    onUpdate?.(updatedRow);
  };

  const handleSaveSheetUrls = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await api.updateGeneralSettings({ errorSheetUrls });
      showToast('Đã lưu link sheet lỗi theo từng mảng.', 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể lưu link sheet lỗi.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSync = async () => {
    setIsSaving(true);
    try {
      const result = await api.syncErrors();
      const warning = result.warnings?.length ? ` Cảnh báo: ${result.warnings.slice(0, 2).join(' ')}` : '';
      showToast(`Đã đồng bộ lỗi: ${result.inserted || 0} mới, ${result.updated || 0} cập nhật, ${result.appended || 0} đẩy lên Sheet, ${result.deleted || 0} đã xóa.${warning}`, warning ? 'warning' : 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể đồng bộ bảng lỗi.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!activeField) {
      showToast('Chưa có mảng để nhập lỗi.', 'error');
      return;
    }
    if (!newError.errorType) {
      showToast('Hãy chọn Error Type.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      const created = await api.createError({ field: activeField, ...newError });
      setLocalErrors((current) => [created, ...current]);
      onCreate?.(created);
      setNewError({ title: '', chapter: '', errorType: '', error: '', note: '', editorFreelancerId: '' });
      showToast('Đã nhập lỗi. Bấm Đồng bộ lỗi để đẩy lên Google Sheet.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể nhập lỗi.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (row, updates) => {
    setSavingRowId(row.id);
    try {
      const updated = await api.updateError(row.id, updates);
      updateLocalRow(updated);
      if (updated.sheetSyncError) showToast(`Đã lưu trên hệ thống nhưng chưa cập nhật Sheet: ${updated.sheetSyncError}`, 'warning');
      return updated;
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật lỗi.', 'error');
      return null;
    } finally {
      setSavingRowId(null);
    }
  };

  const handleSaveNote = async (row) => {
    const note = draftNotes[row.id] ?? row.note ?? '';
    if (note === (row.note || '')) return;
    const updated = await handleUpdate(row, { note });
    if (updated) setDraftNotes((current) => ({ ...current, [row.id]: updated.note || '' }));
  };

  const handleCheck = async (row, checked) => {
    await handleUpdate(row, { fixCheck: checked });
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Xóa lỗi "${row.title}" - Chapter ${row.chapter}?`)) return;
    setSavingRowId(row.id);
    try {
      await api.deleteError(row.id);
      setLocalErrors((current) => current.filter((item) => item.id !== row.id));
      onDelete?.(row);
      showToast('Đã xóa lỗi khỏi hệ thống và Google Sheet.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể xóa lỗi.', 'error');
    } finally {
      setSavingRowId(null);
    }
  };

  return (
    <div className="fade-in error-management-page">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">QUALITY CONTROL</span>
          <h2 className="page-title">Quản lý lỗi</h2>
          <p className="page-subtitle">Theo dõi lỗi theo từng mảng. Freelancer chỉ cần xem lỗi và tick Fix/Check sau khi đã kiểm tra.</p>
        </div>
        <div className="page-header-actions">
          {canManage && <button type="button" className="btn btn-primary" onClick={handleSync} disabled={isLoading || isSaving}><IconRefresh size={16} /> Đồng bộ lỗi</button>}
          <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading || isSaving}><IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}</button>
        </div>
      </div>

      {canManage && currentUser.role === 'Admin' && (
        <section className="glass-panel error-sheet-config-panel">
          <div className="section-heading">
          <div><span className="qc-kicker">SHEET LỖI GỐC</span><h3>Cấu hình sheet lỗi theo mảng</h3><p className="form-help">Mỗi mảng dùng một Google Sheet riêng. Sheet cần có các cột Title, Chapter, Error Type, Error, Note, Editor và Fix/Check.</p></div>
          </div>
          <form className="error-sheet-config-form" onSubmit={handleSaveSheetUrls}>
            <div className="error-sheet-config-grid">
              {fields.map((field) => (
                <div className="form-group" key={field.id || field.name}>
                  <label className="form-label" htmlFor={`error-sheet-${field.id || field.name}`}>Sheet lỗi mảng {field.name}</label>
                  <input id={`error-sheet-${field.id || field.name}`} className="form-input" type="url" value={errorSheetUrls[field.name] || ''} onChange={(event) => setErrorSheetUrls((current) => ({ ...current, [field.name]: event.target.value }))} placeholder="https://docs.google.com/spreadsheets/d/..." disabled={isSaving} />
                </div>
              ))}
            </div>
            <button type="submit" className="btn btn-secondary" disabled={isSaving}><IconCheck size={16} /> Lưu link sheet lỗi</button>
          </form>
        </section>
      )}

      {fields.length === 0 ? (
        <section className="glass-panel table-empty">Chưa có mảng nào được cấu hình.</section>
      ) : (
        <>
          <section className="glass-panel error-field-panel">
            <div className="error-field-tabs" role="tablist" aria-label="Mảng lỗi">
              {fields.map((field) => {
                const count = localErrors.filter((row) => matchesField(row, field.name)).length;
                return <button type="button" role="tab" aria-selected={activeField === field.name} className={`error-field-tab ${activeField === field.name ? 'active' : ''}`} key={field.id || field.name} onClick={() => setActiveField(field.name)}>{field.name}<span>{count}</span></button>;
              })}
            </div>
            <div className="error-sheet-link-row">
              <span>Sheet lỗi gốc: </span>
              {activeSheetUrl ? <a href={activeSheetUrl} target="_blank" rel="noreferrer">Mở sheet để xem screenshot <IconExternalLink size={14} /></a> : <em>Chưa cấu hình</em>}
            </div>
          </section>

          {canManage && (
            <section className="glass-panel error-entry-panel">
              <div className="section-heading"><div><span className="qc-kicker">NHẬP LỖI</span><h3>Thêm lỗi cho mảng {activeField}</h3></div></div>
              <form className="error-entry-form" onSubmit={handleCreate}>
                <div className="form-group"><label className="form-label" htmlFor="error-title">Title</label><input id="error-title" className="form-input" value={newError.title} onChange={(event) => setNewError((current) => ({ ...current, title: event.target.value }))} disabled={isSaving} required /></div>
                <div className="form-group"><label className="form-label" htmlFor="error-chapter">Chapter</label><input id="error-chapter" className="form-input" value={newError.chapter} onChange={(event) => setNewError((current) => ({ ...current, chapter: event.target.value }))} disabled={isSaving} required /></div>
                <div className="form-group"><label className="form-label" htmlFor="error-type">Error Type</label><ErrorTypeControl id="error-type" value={newError.errorType} onChange={(value) => setNewError((current) => ({ ...current, errorType: value }))} disabled={isSaving} /></div>
                <div className="form-group error-entry-editor"><label className="form-label" htmlFor="error-editor">Editor</label><select id="error-editor" className="form-select" value={newError.editorFreelancerId} onChange={(event) => setNewError((current) => ({ ...current, editorFreelancerId: event.target.value }))} disabled={isSaving} required><option value="">Chọn freelancer</option>{editorOptions.map((freelancer) => <option value={getFreelancerId(freelancer)} key={getFreelancerId(freelancer)}>{freelancer.name || freelancer.email}</option>)}</select></div>
                <div className="form-group form-group-full"><label className="form-label" htmlFor="error-description">Error</label><textarea id="error-description" className="form-textarea" value={newError.error} onChange={(event) => setNewError((current) => ({ ...current, error: event.target.value }))} disabled={isSaving} required /></div>
                <div className="form-group form-group-full"><label className="form-label" htmlFor="error-note">Note của FL hoặc QC</label><textarea id="error-note" className="form-textarea" value={newError.note} onChange={(event) => setNewError((current) => ({ ...current, note: event.target.value }))} disabled={isSaving} /></div>
                <div className="error-entry-actions"><button type="submit" className="btn btn-primary" disabled={isSaving}><IconPlus size={16} /> Thêm lỗi</button></div>
              </form>
            </section>
          )}

          <section className="glass-panel qc-table-panel error-table-panel">
            <div className="section-heading error-table-heading"><div><span className="qc-kicker">DANH SÁCH LỖI</span><h3>Lỗi mảng {activeField}</h3></div><span className="error-count-label">{activeErrors.length} lỗi</span></div>
            <div className="table-wrapper-flat error-table-wrapper">
              <table className="custom-table error-table">
                <thead><tr><th>Title <select className="error-sort-select" value={sortDirection} onChange={(event) => setSortDirection(event.target.value)} aria-label="Sắp xếp Title"><option value="asc">A-Z</option><option value="desc">Z-A</option></select></th><th>Chapter</th><th>Error Type</th><th>Error</th><th>Note của FL hoặc QC</th><th>Editor</th><th>Fix/Check</th>{canManage && <th>Thao tác</th>}</tr></thead>
                <tbody>
                  {activeErrors.length === 0 ? <tr><td colSpan={canManage ? 8 : 7} className="table-empty">Chưa có lỗi trong mảng này.</td></tr> : activeErrors.map((row) => {
                    const rowNote = draftNotes[row.id] ?? row.note ?? '';
                    const isRowSaving = savingRowId === row.id;
                    return <tr key={row.id} className={row.fixCheck ? 'error-row-checked' : ''}>
                      <td className="error-title-cell"><strong>{row.title}</strong></td>
                      <td>{row.chapter}</td>
                      <td>
                        {canManage ? (
                          <ErrorTypeControl value={row.errorType} onChange={(value) => handleUpdate(row, { errorType: value })} disabled={isRowSaving} ariaLabel={`Error Type cho ${row.title}`} />
                        ) : <ErrorTypeBadge value={row.errorType} />}
                      </td>
                      <td className="error-description-cell">{row.error}</td>
                      <td className="error-note-cell"><textarea className="error-note-input" value={rowNote} onChange={(event) => setDraftNotes((current) => ({ ...current, [row.id]: event.target.value }))} onBlur={() => handleSaveNote(row)} disabled={isRowSaving} placeholder="Ghi chú..." /><button type="button" className="text-button error-note-save" onClick={() => handleSaveNote(row)} disabled={isRowSaving || rowNote === (row.note || '')}>Lưu note</button></td>
                      <td><span className="error-editor-badge">{row.editor || 'Chưa gán'}</span></td>
                      <td className="error-check-cell"><label className="error-check-control"><input type="checkbox" checked={Boolean(row.fixCheck)} onChange={(event) => handleCheck(row, event.target.checked)} disabled={isRowSaving} /><span>{row.fixCheck ? 'Đã xem' : 'Chưa xem'}</span></label></td>
                      {canManage && <td><button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(row)} disabled={isRowSaving}><IconTrash size={14} /> Xóa</button></td>}
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
