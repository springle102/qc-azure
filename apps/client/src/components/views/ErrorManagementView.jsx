import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconExternalLink, IconFilter, IconPlus, IconRefresh, IconTrash, IconX } from '../common/Icons';
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

function ErrorColumnFilterButton({ columnKey, label, values = [], activeValues, activeSortDirection, onApply, onSort }) {
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
      const width = 250;
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

  const visibleValues = values.filter((value) => value.toLowerCase().includes(searchValue.trim().toLowerCase()));
  const allSelected = values.length > 0 && draftValues.length === values.length;

  const toggleValue = (value) => {
    setDraftValues((current) => current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]);
  };

  const applyFilter = () => {
    onApply?.(draftValues.length === values.length ? null : draftValues);
    setIsOpen(false);
  };

  const clearFilter = () => {
    if (columnKey === 'title') onSort?.(null);
    else onApply?.(null);
    setIsOpen(false);
  };

  const applySort = (direction) => {
    onSort?.(activeSortDirection === direction ? null : direction);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`column-filter-button${isActive ? ' active' : ''}`}
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
          {columnKey === 'title' && (
            <div className="column-filter-sort">
              <div className="column-filter-section-label">Sắp xếp</div>
              <button type="button" className={`column-filter-sort-button${activeSortDirection === 'asc' ? ' active' : ''}`} onClick={() => applySort('asc')}>A → Z</button>
              <button type="button" className={`column-filter-sort-button${activeSortDirection === 'desc' ? ' active' : ''}`} onClick={() => applySort('desc')}>Z → A</button>
            </div>
          )}
          {values.length > 0 && (
            <>
              <input className="form-input column-filter-search" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="Tìm Error Type..." autoFocus />
              <label className="column-filter-option column-filter-select-all">
                <input type="checkbox" checked={allSelected} onChange={() => setDraftValues(allSelected ? [] : [...values])} />
                <span>Chọn tất cả</span>
              </label>
              <div className="column-filter-options">
                {visibleValues.length > 0 ? visibleValues.map((value) => (
                  <label className="column-filter-option" key={value}>
                    <input type="checkbox" checked={draftValues.includes(value)} onChange={() => toggleValue(value)} />
                    <span>{value}</span>
                  </label>
                )) : <span className="column-filter-empty">Không có option phù hợp.</span>}
              </div>
              <div className="column-filter-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={clearFilter}>Xóa lọc</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={applyFilter}>Áp dụng</button>
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </>
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
  const [titleSortDirection, setTitleSortDirection] = useState(null);
  const [errorTypeFilter, setErrorTypeFilter] = useState(null);
  const [localErrors, setLocalErrors] = useState(errors);
  const [draftNotes, setDraftNotes] = useState({});
  const [errorSheetUrls, setErrorSheetUrls] = useState(generalSettings?.errorSheetUrls || {});
  const [newError, setNewError] = useState({ title: '', chapter: '', errorType: '', error: '', note: '', editorFreelancerId: '' });
  const [isCreatingError, setIsCreatingError] = useState(false);
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
  const activeErrors = useMemo(() => {
    const filtered = localErrors
      .filter((row) => matchesField(row, activeField))
      .filter((row) => !Array.isArray(errorTypeFilter) || errorTypeFilter.includes(String(row.errorType ?? '')));
    if (!titleSortDirection) return filtered;
    return filtered.sort((left, right) => {
      const compared = String(left.title || '').localeCompare(String(right.title || ''), 'vi', { sensitivity: 'base' });
      return titleSortDirection === 'asc' ? compared : -compared;
    });
  }, [activeField, errorTypeFilter, localErrors, titleSortDirection]);

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
      setIsCreatingError(false);
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
        </div>
        <div className="page-header-actions">
          {canManage && <button type="button" className="btn btn-primary" onClick={handleSync} disabled={isLoading || isSaving}><IconRefresh size={16} /> Đồng bộ lỗi</button>}
          <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading || isSaving}><IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}</button>
        </div>
      </div>

      {canManage && currentUser.role === 'Admin' && (
        <section className="glass-panel error-sheet-config-panel">
          <div className="section-heading">
          <div><span className="qc-kicker">SHEET LỖI GỐC</span><h3>Cấu hình sheet lỗi theo mảng</h3></div>
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
            <button type="submit" className="btn btn-secondary" disabled={isSaving}><IconCheck size={16} /> Lưu</button>
          </form>
        </section>
      )}

      {fields.length === 0 ? (
        <section className="glass-panel table-empty">Chưa có mảng nào được cấu hình.</section>
      ) : (
        <>
          <section className="glass-panel error-field-panel">
            <div className="error-field-content">
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
            </div>
            {canManage && (
              <div className="error-entry-launcher">
                <button type="button" className="btn btn-primary" onClick={() => setIsCreatingError(true)} disabled={isSaving}>
                  <IconPlus size={16} /> Thêm lỗi
                </button>
              </div>
            )}
          </section>

          {canManage && isCreatingError && createPortal(
            <div className="modal-overlay" onClick={() => !isSaving && setIsCreatingError(false)} role="presentation">
              <form className="modal-content modal-xl error-entry-modal" onSubmit={handleCreate} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="error-entry-modal-title">
                <div className="modal-header">
                  <div>
                    <span className="qc-kicker">NHẬP LỖI</span>
                    <div className="modal-title" id="error-entry-modal-title">Thêm lỗi cho mảng {activeField}</div>
                  </div>
                  <button type="button" className="icon-button" onClick={() => setIsCreatingError(false)} disabled={isSaving} title="Đóng">
                    <IconX size={18} />
                  </button>
                </div>
                <div className="error-entry-form">
                  <div className="form-group"><label className="form-label" htmlFor="error-title">Title</label><input id="error-title" className="form-input" value={newError.title} onChange={(event) => setNewError((current) => ({ ...current, title: event.target.value }))} disabled={isSaving} required /></div>
                  <div className="form-group"><label className="form-label" htmlFor="error-chapter">Chapter</label><input id="error-chapter" className="form-input" value={newError.chapter} onChange={(event) => setNewError((current) => ({ ...current, chapter: event.target.value }))} disabled={isSaving} required /></div>
                  <div className="form-group"><label className="form-label" htmlFor="error-type">Error Type</label><ErrorTypeControl id="error-type" value={newError.errorType} onChange={(value) => setNewError((current) => ({ ...current, errorType: value }))} disabled={isSaving} /></div>
                  <div className="form-group error-entry-editor"><label className="form-label" htmlFor="error-editor">Editor</label><select id="error-editor" className="form-select" value={newError.editorFreelancerId} onChange={(event) => setNewError((current) => ({ ...current, editorFreelancerId: event.target.value }))} disabled={isSaving} required><option value="">Chọn freelancer</option>{editorOptions.map((freelancer) => <option value={getFreelancerId(freelancer)} key={getFreelancerId(freelancer)}>{freelancer.name || freelancer.email}</option>)}</select></div>
                  <div className="form-group form-group-full"><label className="form-label" htmlFor="error-description">Error</label><textarea id="error-description" className="form-textarea" value={newError.error} onChange={(event) => setNewError((current) => ({ ...current, error: event.target.value }))} disabled={isSaving} required /></div>
                  <div className="form-group form-group-full"><label className="form-label" htmlFor="error-note">Note của FL hoặc QC</label><textarea id="error-note" className="form-textarea" value={newError.note} onChange={(event) => setNewError((current) => ({ ...current, note: event.target.value }))} disabled={isSaving} /></div>
                  <div className="error-entry-actions"><button type="submit" className="btn btn-primary" disabled={isSaving}><IconPlus size={16} /> Thêm lỗi</button></div>
                </div>
              </form>
            </div>,
            document.body
          )}

          <section className="glass-panel qc-table-panel error-table-panel">
            <div className="section-heading error-table-heading"><div><span className="qc-kicker">DANH SÁCH LỖI</span><h3>Lỗi mảng {activeField}</h3></div><span className="error-count-label">{activeErrors.length} lỗi</span></div>
            <div className="table-wrapper-flat error-table-wrapper">
              <table className="custom-table error-table">
                <thead>
                  <tr>
                    <th><div className="error-column-header"><span>Title</span><ErrorColumnFilterButton columnKey="title" label="Title" activeSortDirection={titleSortDirection} onSort={setTitleSortDirection} /></div></th>
                    <th><div className="error-column-header"><span>Chapter</span></div></th>
                    <th><div className="error-column-header"><span>Error Type</span><ErrorColumnFilterButton columnKey="errorType" label="Error Type" values={ERROR_TYPE_OPTIONS} activeValues={errorTypeFilter} onApply={setErrorTypeFilter} /></div></th>
                    <th><div className="error-column-header"><span>Error</span></div></th>
                    <th><div className="error-column-header"><span>Note của FL hoặc QC</span></div></th>
                    <th><div className="error-column-header"><span>Editor</span></div></th>
                    <th><div className="error-column-header"><span>Fix/Check</span></div></th>
                    {canManage && <th><div className="error-column-header"><span>Thao tác</span></div></th>}
                  </tr>
                </thead>
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
