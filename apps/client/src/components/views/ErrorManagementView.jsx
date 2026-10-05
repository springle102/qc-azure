import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck, IconExternalLink, IconFilter, IconPlus, IconRefresh, IconTrash, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api, getUserFacingErrorMessage } from '../../services/api';

const ERROR_TYPE_OPTIONS = ['TR', 'File', 'Censor', 'Exposure', 'Logo/Credit', 'Text', 'SFX', 'Image', 'Bubble', 'Aesthetics', 'RD'];
const EMPTY_ERROR_ROW = { title: '', chapter: '', errorType: '', screenshot: '', error: '', note: '', editorFreelancerId: '' };

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

function getErrorEditorLabel(row) {
  return String(row?.editor ?? '').trim() || 'Chưa gán';
}

function getErrorTypeClass(value) {
  const slug = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? `error-type-${slug}` : 'error-type-empty';
}

function ErrorTypeBadge({ value }) {
  return <span className={`error-type-badge ${getErrorTypeClass(value)}`}>{value || 'Chưa chọn'}</span>;
}

function isImageValue(value) {
  const text = String(value ?? '').trim();
  return /^data:image\//i.test(text) || /^https?:\/\//i.test(text);
}

function getScreenshotImages(value) {
  if (Array.isArray(value)) return value.filter(isImageValue).slice(0, 3);
  const text = String(value ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(isImageValue).slice(0, 3);
  } catch {
    // Legacy rows store a single image URL directly.
  }
  return isImageValue(text) ? [text] : [];
}

function serializeScreenshotImages(images) {
  const normalized = images.filter(isImageValue).slice(0, 3);
  if (normalized.length === 0) return '';
  return normalized.length === 1 ? normalized[0] : JSON.stringify(normalized);
}

const MAX_SCREENSHOT_FILE_SIZE = 3 * 1024 * 1024;

function ScreenshotUpload({ value, onChange, onPreview, disabled = false, compact = false, maxImages = 3, imageLabel = 'screenshot' }) {
  const [error, setError] = useState('');
  const images = getScreenshotImages(value).slice(0, maxImages);

  const readImageFile = (file) => new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Vui lòng dán một hình ảnh.'));
      return;
    }
    if (file.size > MAX_SCREENSHOT_FILE_SIZE) {
      reject(new Error('Ảnh không được vượt quá 3 MB.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc file ảnh.'));
    reader.readAsDataURL(file);
  });

  const handlePaste = async (event) => {
    const imageItems = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    event.preventDefault();
    setError('');

    const availableSlots = maxImages - images.length;
    if (availableSlots <= 0) {
      setError(`Tối đa ${maxImages} ảnh trong một ô.`);
      return;
    }

    const files = imageItems.slice(0, availableSlots).map((item) => item.getAsFile()).filter(Boolean);
    const results = await Promise.allSettled(files.map(readImageFile));
    const pastedImages = results
      .filter((result) => result.status === 'fulfilled' && isImageValue(result.value))
      .map((result) => result.value);
    if (pastedImages.length > 0) onChange?.(serializeScreenshotImages([...images, ...pastedImages]));

    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected) setError(rejected.reason?.message || 'Không thể đọc file ảnh.');
    else if (imageItems.length > availableSlots) setError(`Tối đa ${maxImages} ảnh trong một ô.`);
  };

  const removeImage = (index) => {
    onChange?.(serializeScreenshotImages(images.filter((_, imageIndex) => imageIndex !== index)));
    setError('');
  };

  return (
    <div
      className={`error-screenshot-upload${compact ? ' compact' : ''}`}
      tabIndex={disabled ? -1 : 0}
      onPasteCapture={disabled ? undefined : handlePaste}
      role="group"
      aria-label={`Dán ${imageLabel} bằng Ctrl + V, tối đa ${maxImages} ảnh`}
      title="Nhấn Ctrl + V để dán ảnh trực tiếp"
    >
      <div
        className={`error-screenshot-dropzone${images.length > 0 ? ' has-image' : ''}`}
      >
        {images.length > 0 ? (
          <>
            <div className="error-screenshot-upload-previews">
              {images.map((image, index) => (
                <div className="error-screenshot-upload-preview-item" key={`${image.slice(0, 32)}-${index}`}>
                  {onPreview ? (
                    <button type="button" className="error-screenshot-upload-preview-trigger" onClick={() => onPreview(images)} title={`Xem chi tiết ${imageLabel}`}>
                      <img className="error-screenshot-upload-preview" src={image} alt={`Xem chi tiết ${imageLabel} lỗi ${index + 1}`} />
                    </button>
                  ) : <img className="error-screenshot-upload-preview" src={image} alt={`Screenshot lỗi ${index + 1}`} />}
                  <button type="button" className="error-screenshot-remove-one" onClick={() => removeImage(index)} disabled={disabled} aria-label={`Xóa screenshot ${index + 1}`} title="Xóa ảnh">×</button>
                </div>
              ))}
            </div>
            <span className="error-screenshot-upload-caption">{images.length}/{maxImages} ảnh · Ctrl + V để thêm</span>
          </>
        ) : (
          <>
            <strong>Nhấn Ctrl + V để dán ảnh</strong>
            <span>Dán trực tiếp vào ô này · tối đa {maxImages} ảnh</span>
          </>
        )}
      </div>
      {images.length > 0 && <button type="button" className="text-button error-screenshot-remove" onClick={() => { setError(''); onChange?.(''); }} disabled={disabled}>Xóa tất cả ảnh</button>}
      {error && <span className="error-screenshot-error" role="alert">{error}</span>}
    </div>
  );
}

function NoteEditor({ value, onChange, onPreview, disabled = false }) {
  const [mode, setMode] = useState(isImageValue(value) ? 'image' : 'text');
  const imageValue = isImageValue(value) ? value : '';

  const changeMode = (nextMode) => {
    setMode(nextMode);
    if (nextMode === 'text' && imageValue) onChange?.('');
    if (nextMode === 'image' && !imageValue) onChange?.('');
  };

  return (
    <div className="error-note-editor">
      <div className="error-note-format-toggle" role="group" aria-label="Định dạng Note">
        <button type="button" className={`error-note-format-button${mode === 'text' ? ' active' : ''}`} onClick={() => changeMode('text')} disabled={disabled}>Text</button>
        <button type="button" className={`error-note-format-button${mode === 'image' ? ' active' : ''}`} onClick={() => changeMode('image')} disabled={disabled}>Ảnh</button>
      </div>
      {mode === 'image' ? (
        <ScreenshotUpload compact value={imageValue} onChange={onChange} onPreview={onPreview} disabled={disabled} maxImages={1} imageLabel="Note" />
      ) : (
        <textarea className="error-note-inline-textarea" value={isImageValue(value) ? '' : (value || '')} onChange={(event) => onChange?.(event.target.value)} disabled={disabled} placeholder="Ghi chú..." />
      )}
    </div>
  );
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

function ErrorColumnFilterButton({ label, values = [], activeValues, activeSortDirection, onApply, onSort }) {
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
    onSort?.(null);
    onApply?.(null);
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
          {onSort && (
            <div className="column-filter-sort">
              <div className="column-filter-section-label">Sắp xếp</div>
              <button type="button" className={`column-filter-sort-button${activeSortDirection === 'asc' ? ' active' : ''}`} onClick={() => applySort('asc')}>A → Z</button>
              <button type="button" className={`column-filter-sort-button${activeSortDirection === 'desc' ? ' active' : ''}`} onClick={() => applySort('desc')}>Z → A</button>
            </div>
          )}
          {values.length > 0 && (
            <>
              <input className="form-input column-filter-search" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder={`Tìm ${label}...`} aria-label={`Tìm ${label}`} autoFocus />
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
  const [sort, setSort] = useState({ column: 'title', direction: null });
  const [errorTypeFilter, setErrorTypeFilter] = useState(null);
  const [editorFilter, setEditorFilter] = useState(null);
  const [localErrors, setLocalErrors] = useState(errors);
  const [errorSheetUrls, setErrorSheetUrls] = useState(generalSettings?.errorSheetUrls || {});
  const [newError, setNewError] = useState(EMPTY_ERROR_ROW);
  const [inlineErrorRow, setInlineErrorRow] = useState(null);
  const [draftRows, setDraftRows] = useState({});
  const [isCreatingError, setIsCreatingError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isMigratingScreenshots, setIsMigratingScreenshots] = useState(false);
  const [savingRowId, setSavingRowId] = useState(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);
  const [fixCheckSyncWarning, setFixCheckSyncWarning] = useState('');
  const [fixCheckOverrides, setFixCheckOverrides] = useState({});
  const pendingFixChecks = useRef(new Set());
  const errorMutationVersion = useRef(0);
  const hasPendingFixChecks = Object.keys(fixCheckOverrides).length > 0;

  const handlePreviewNote = (row) => {
    setSelectedScreenshot({ ...row, screenshot: row.note, imageLabel: 'Note' });
  };

  useEffect(() => {
    setLocalErrors(errors);
  }, [errors]);

  useEffect(() => {
    if (isLoading || isSaving || savingRowId !== null) return undefined;
    let cancelled = false;
    let timer;
    const refreshChecks = async () => {
      const version = errorMutationVersion.current;
      try {
        if (document.visibilityState !== 'hidden' && pendingFixChecks.current.size === 0) {
          const result = await api.getErrorFixChecks();
          if (cancelled || version !== errorMutationVersion.current) return;
          const checks = new Map(result.rows.map((row) => [String(row.id), row.fixCheck]));
          setLocalErrors((current) => current.map((row) => checks.has(String(row.id))
            ? { ...row, fixCheck: checks.get(String(row.id)) } : row));
          setFixCheckSyncWarning(result.warnings?.[0] || '');
        }
      } catch (error) {
        if (!cancelled && version === errorMutationVersion.current) setFixCheckSyncWarning(error.message || 'Không thể đồng bộ Fix/Check từ Sheet.');
      } finally {
        if (!cancelled) timer = window.setTimeout(refreshChecks, 15000);
      }
    };
    refreshChecks();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isLoading, isSaving, savingRowId, errors]);

  useEffect(() => {
    const fieldStillVisible = fields.some((field) => field.name === activeField);
    if (!fieldStillVisible) setActiveField(fields[0]?.name || '');
  }, [activeField, fields]);

  useEffect(() => {
    setErrorSheetUrls(generalSettings?.errorSheetUrls || {});
  }, [generalSettings]);

  const activeSheetUrl = errorSheetUrls[activeField] || '';
  const updateSort = (column, direction) => {
    setSort((current) => direction || current.column === column ? { column, direction } : current);
  };
  const editorFilterOptions = useMemo(() => [...new Set([
    ...localErrors.filter((row) => matchesField(row, activeField)).map(getErrorEditorLabel),
    ...(editorFilter || [])
  ])].sort((left, right) => left.localeCompare(right, 'vi', { sensitivity: 'base' })), [activeField, editorFilter, localErrors]);
  const activeErrors = useMemo(() => {
    const filtered = localErrors
      .filter((row) => matchesField(row, activeField))
      .filter((row) => !Array.isArray(errorTypeFilter) || errorTypeFilter.includes(String(row.errorType ?? '')))
      .filter((row) => !Array.isArray(editorFilter) || editorFilter.includes(getErrorEditorLabel(row)));
    const sortDirection = sort.direction || 'asc';
    return [...filtered].sort((left, right) => {
      if (sort.column === 'editor' && sort.direction) {
        const comparedEditors = getErrorEditorLabel(left).localeCompare(getErrorEditorLabel(right), 'vi', { numeric: true, sensitivity: 'base' });
        if (comparedEditors !== 0) return sortDirection === 'asc' ? comparedEditors : -comparedEditors;
      }
      const compared = String(left.title || '').localeCompare(String(right.title || ''), 'vi', { numeric: true, sensitivity: 'base' });
      return sort.column === 'title' && sortDirection === 'desc' ? -compared : compared;
    });
  }, [activeField, editorFilter, errorTypeFilter, localErrors, sort]);

  const editorOptions = freelancers.filter((freelancer) => (
    !activeField || getFreelancerFields(freelancer).some((field) => field.toLowerCase() === activeField.toLowerCase())
  ));

  const updateLocalRow = (updatedRow) => {
    setLocalErrors((current) => current.map((row) => row.id === updatedRow.id ? updatedRow : row));
    onUpdate?.(updatedRow);
  };

  const getRowDraft = (row) => draftRows[row.id] || row;

  const updateRowDraft = (row, key, value) => {
    setDraftRows((current) => ({
      ...current,
      [row.id]: { ...(current[row.id] || row), [key]: value }
    }));
  };

  const hasRowDraftChanges = (row, draft) => ['title', 'chapter', 'errorType', 'screenshot', 'error', 'note', 'editorFreelancerId']
    .some((key) => String(draft[key] ?? '') !== String(row[key] ?? ''));

  const handleStartInlineRow = () => {
    if (!activeField) {
      showToast('Chưa có mảng để nhập lỗi.', 'error');
      return;
    }
    setIsCreatingError(false);
    setInlineErrorRow({ ...EMPTY_ERROR_ROW });
  };

  const handleSelectField = (fieldName) => {
    setActiveField(fieldName);
    setEditorFilter(null);
    setInlineErrorRow(null);
    setDraftRows({});
  };

  const handleSaveInlineRow = async () => {
    if (!inlineErrorRow) return;
    if (!inlineErrorRow.title.trim() || !inlineErrorRow.chapter.trim() || !inlineErrorRow.error.trim()) {
      showToast('Hãy nhập Title, Chapter và Error.', 'error');
      return;
    }
    if (!inlineErrorRow.errorType) {
      showToast('Hãy chọn Error Type.', 'error');
      return;
    }
    if (!inlineErrorRow.editorFreelancerId) {
      showToast('Hãy chọn Editor.', 'error');
      return;
    }
    setSavingRowId('inline-new');
    try {
      const created = await api.createError({ field: activeField, ...inlineErrorRow });
      setLocalErrors((current) => [created, ...current]);
      onCreate?.(created);
      setInlineErrorRow(null);
      showToast('Đã thêm hàng lỗi.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể thêm hàng lỗi.', 'error');
    } finally {
      setSavingRowId(null);
    }
  };

  const handleSaveRowDraft = async (row) => {
    const draft = draftRows[row.id];
    if (!draft || !hasRowDraftChanges(row, draft)) return;
    const updates = {};
    ['title', 'chapter', 'errorType', 'screenshot', 'error', 'note', 'editorFreelancerId'].forEach((key) => {
      if (String(draft[key] ?? '') !== String(row[key] ?? '')) updates[key] = draft[key];
    });
    const updated = await handleUpdate(row, updates);
    if (updated) {
      setDraftRows((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    }
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
    setIsSyncing(true);
    setIsSaving(true);
    try {
      const result = await api.syncErrors();
      const warning = result.warnings?.length
        ? ` Cảnh báo: ${result.warnings.slice(0, 2).map((item) => getUserFacingErrorMessage(item, 'Không thể xử lý một số dữ liệu từ Google Sheet.')).join(' ')}`
        : '';
      showToast(`Đã đồng bộ từ Sheet lỗi: ${result.inserted || 0} mới, ${result.updated || 0} cập nhật, ${result.deleted || 0} đã xóa trên web.${warning}`, warning ? 'warning' : 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể đồng bộ bảng lỗi.', 'error');
    } finally {
      setIsSaving(false);
      setIsSyncing(false);
    }
  };

  const handleMigrateScreenshots = async () => {
    setIsMigratingScreenshots(true);
    setIsSaving(true);
    try {
      const result = await api.migrateErrorScreenshots();
      showToast(`Đã chuyển ${result.migrated || 0}/${result.candidates || 0} screenshot lên Storage.`, result.failed ? 'warning' : 'success');
      await onRefresh?.();
    } catch (error) {
      showToast(error.message || 'Không thể chuyển screenshot lên Storage.', 'error');
    } finally {
      setIsSaving(false);
      setIsMigratingScreenshots(false);
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
      setNewError(EMPTY_ERROR_ROW);
      setIsCreatingError(false);
      showToast('Đã nhập lỗi trên hệ thống. Dữ liệu không được ghi vào Sheet lỗi gốc.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể nhập lỗi.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (row, updates) => {
    errorMutationVersion.current += 1;
    setSavingRowId(row.id);
    try {
      const updated = await api.updateError(row.id, updates);
      updateLocalRow(updated);
      if (Object.prototype.hasOwnProperty.call(updates, 'fixCheck')) setFixCheckSyncWarning('');
      return updated;
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật lỗi.', 'error');
      return null;
    } finally {
      setSavingRowId(null);
    }
  };

  const handleCheck = async (row, checked) => {
    const rowId = String(row.id);
    if (pendingFixChecks.current.has(rowId)) return;
    pendingFixChecks.current.add(rowId);
    errorMutationVersion.current += 1;
    setFixCheckOverrides((current) => ({ ...current, [rowId]: checked }));
    try {
      const updated = await api.updateError(row.id, { fixCheck: checked });
      updateLocalRow(updated);
      setFixCheckSyncWarning('');
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật Fix/Check.', 'error');
    } finally {
      errorMutationVersion.current += 1;
      pendingFixChecks.current.delete(rowId);
      setFixCheckOverrides((current) => {
        const next = { ...current };
        delete next[rowId];
        return next;
      });
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Xóa lỗi "${row.title}" - Chapter ${row.chapter}?`)) return;
    setSavingRowId(row.id);
    try {
      await api.deleteError(row.id);
      setLocalErrors((current) => current.filter((item) => item.id !== row.id));
      onDelete?.(row);
      showToast('Đã xóa lỗi khỏi hệ thống. Sheet lỗi gốc không bị thay đổi.', 'success');
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
          {currentUser.role === 'Admin' && <button type="button" className="btn btn-outline" onClick={handleMigrateScreenshots} disabled={isLoading || isSaving || hasPendingFixChecks}><IconRefresh size={16} /> {isMigratingScreenshots ? 'Đang chuyển ảnh...' : 'Chuyển ảnh lên Storage'}</button>}
          {canManage && <button type="button" className="btn btn-primary" onClick={handleSync} disabled={isLoading || isSaving || hasPendingFixChecks}><IconRefresh size={16} /> {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ từ Sheet'}</button>}
          <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading || isSaving || hasPendingFixChecks}><IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}</button>
        </div>
      </div>

      {fixCheckSyncWarning && <p role="status">Fix/Check: {fixCheckSyncWarning}</p>}

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
                  <input id={`error-sheet-${field.id || field.name}`} className="form-input" type="url" value={errorSheetUrls[field.name] || ''} onChange={(event) => setErrorSheetUrls((current) => ({ ...current, [field.name]: event.target.value }))} placeholder="https://docs.google.com/spreadsheets/d/..." disabled={isSaving || hasPendingFixChecks} />
                </div>
              ))}
            </div>
            <button type="submit" className="btn btn-secondary" disabled={isSaving || hasPendingFixChecks}><IconCheck size={16} /> Lưu</button>
          </form>
        </section>
      )}

      {fields.length === 0 ? (
        <section className="glass-panel table-empty">{isLoading
          ? 'Đang tải danh sách mảng...'
          : currentUser.role === 'Admin'
            ? 'Chưa có mảng nào được cấu hình.'
            : 'Không có mảng được cấp cho tài khoản. Vui lòng nhờ Admin kiểm tra mục Mảng trong tài khoản của bạn.'}</section>
      ) : (
        <>
          <section className="glass-panel error-field-panel">
            <div className="error-field-content">
              <div className="error-field-tabs" role="tablist" aria-label="Mảng lỗi">
                {fields.map((field) => {
                  const count = localErrors.filter((row) => matchesField(row, field.name)).length;
                  return <button type="button" role="tab" aria-selected={activeField === field.name} className={`error-field-tab ${activeField === field.name ? 'active' : ''}`} key={field.id || field.name} onClick={() => handleSelectField(field.name)}>{field.name}<span>{count}</span></button>;
                })}
              </div>
              {currentUser.role !== 'Freelancer' && (
                <div className="error-sheet-link-row">
                  <span>Sheet lỗi gốc: </span>
                  {activeSheetUrl ? <a href={activeSheetUrl} target="_blank" rel="noreferrer">Mở sheet để xem screenshot <IconExternalLink size={14} /></a> : <em>Chưa cấu hình</em>}
                </div>
              )}
            </div>
            {canManage && (
              <div className="error-entry-launcher">
                <button type="button" className="btn btn-outline" onClick={handleStartInlineRow} disabled={isSaving || Boolean(inlineErrorRow)}>
                  <IconPlus size={16} /> Thêm hàng
                </button>
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
                  <div className="form-group error-entry-screenshot-group"><label className="form-label">Screenshot</label><ScreenshotUpload value={newError.screenshot} onChange={(value) => setNewError((current) => ({ ...current, screenshot: value }))} disabled={isSaving} /></div>
                  <div className="form-group error-entry-editor"><label className="form-label" htmlFor="error-editor">Editor</label><select id="error-editor" className="form-select" value={newError.editorFreelancerId} onChange={(event) => setNewError((current) => ({ ...current, editorFreelancerId: event.target.value }))} disabled={isSaving} required><option value="">Chọn freelancer</option>{editorOptions.map((freelancer) => <option value={getFreelancerId(freelancer)} key={getFreelancerId(freelancer)}>{freelancer.name || freelancer.email}</option>)}</select></div>
                  <div className="form-group form-group-full"><label className="form-label" htmlFor="error-description">Error</label><textarea id="error-description" className="form-textarea" value={newError.error} onChange={(event) => setNewError((current) => ({ ...current, error: event.target.value }))} disabled={isSaving} required /></div>
                  <div className="form-group form-group-full"><label className="form-label">Note của FL hoặc QC</label><NoteEditor value={newError.note} onChange={(value) => setNewError((current) => ({ ...current, note: value }))} onPreview={() => handlePreviewNote(newError)} disabled={isSaving} /></div>
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
                    <th><div className="error-column-header"><span>Title</span><ErrorColumnFilterButton label="Title" activeSortDirection={sort.column === 'title' ? sort.direction : null} onSort={(direction) => updateSort('title', direction)} /></div></th>
                    <th><div className="error-column-header"><span>Chapter</span></div></th>
                    <th><div className="error-column-header"><span>Error Type</span><ErrorColumnFilterButton label="Error Type" values={ERROR_TYPE_OPTIONS} activeValues={errorTypeFilter} onApply={setErrorTypeFilter} /></div></th>
                    <th><div className="error-column-header"><span>Screenshot</span></div></th>
                    <th><div className="error-column-header"><span>Error</span></div></th>
                    <th><div className="error-column-header"><span>Note của FL hoặc QC</span></div></th>
                    <th><div className="error-column-header"><span>Editor</span><ErrorColumnFilterButton label="Editor" values={editorFilterOptions} activeValues={editorFilter} activeSortDirection={sort.column === 'editor' ? sort.direction : null} onApply={setEditorFilter} onSort={(direction) => updateSort('editor', direction)} /></div></th>
                    <th><div className="error-column-header"><span>Fix/Check</span></div></th>
                    {canManage && <th><div className="error-column-header"><span>Thao tác</span></div></th>}
                  </tr>
                </thead>
                <tbody>
                  {canManage && inlineErrorRow && (
                    <tr className="error-inline-new-row">
                      <td><input className="error-inline-input" value={inlineErrorRow.title} onChange={(event) => setInlineErrorRow((current) => ({ ...current, title: event.target.value }))} placeholder="Nhập Title" autoFocus /></td>
                      <td><input className="error-inline-input" value={inlineErrorRow.chapter} onChange={(event) => setInlineErrorRow((current) => ({ ...current, chapter: event.target.value }))} placeholder="Chapter" /></td>
                      <td><ErrorTypeControl value={inlineErrorRow.errorType} onChange={(value) => setInlineErrorRow((current) => ({ ...current, errorType: value }))} disabled={savingRowId === 'inline-new'} ariaLabel="Error Type cho hàng mới" /></td>
                      <td className="error-screenshot-cell"><ScreenshotUpload compact value={inlineErrorRow.screenshot} onChange={(value) => setInlineErrorRow((current) => ({ ...current, screenshot: value }))} onPreview={() => setSelectedScreenshot({ ...inlineErrorRow, field: activeField, title: inlineErrorRow.title || 'Lỗi mới' })} disabled={savingRowId === 'inline-new'} /></td>
                      <td><textarea className="error-inline-textarea" value={inlineErrorRow.error} onChange={(event) => setInlineErrorRow((current) => ({ ...current, error: event.target.value }))} placeholder="Nhập nội dung lỗi" /></td>
                      <td className="error-note-cell"><NoteEditor value={inlineErrorRow.note} onChange={(value) => setInlineErrorRow((current) => ({ ...current, note: value }))} onPreview={() => handlePreviewNote(inlineErrorRow)} disabled={savingRowId === 'inline-new'} /></td>
                      <td><select className="error-inline-select" value={inlineErrorRow.editorFreelancerId} onChange={(event) => setInlineErrorRow((current) => ({ ...current, editorFreelancerId: event.target.value }))} disabled={savingRowId === 'inline-new'}><option value="">Chọn freelancer</option>{editorOptions.map((freelancer) => <option value={getFreelancerId(freelancer)} key={getFreelancerId(freelancer)}>{freelancer.name || freelancer.email}</option>)}</select></td>
                      <td className="error-check-cell"><span className="error-inline-muted">Sau khi lưu</span></td>
                      <td><div className="error-row-actions"><button type="button" className="btn btn-primary btn-sm" onClick={handleSaveInlineRow} disabled={savingRowId === 'inline-new'}><IconCheck size={14} /> Lưu</button><button type="button" className="btn btn-outline btn-sm" onClick={() => setInlineErrorRow(null)} disabled={savingRowId === 'inline-new'}>Hủy</button></div></td>
                    </tr>
                  )}
                  {activeErrors.length === 0 && !inlineErrorRow ? <tr><td colSpan={canManage ? 9 : 8} className="table-empty">{Array.isArray(editorFilter) || Array.isArray(errorTypeFilter) ? 'Không có lỗi phù hợp với bộ lọc.' : 'Chưa có lỗi trong mảng này.'}</td></tr> : activeErrors.map((row) => {
                    const rowDraft = getRowDraft(row);
                    const isCheckPending = Object.prototype.hasOwnProperty.call(fixCheckOverrides, String(row.id));
                    const fixCheck = isCheckPending ? fixCheckOverrides[String(row.id)] : Boolean(row.fixCheck);
                    const isRowSaving = savingRowId === row.id || isCheckPending;
                    const isRowDirty = canManage && hasRowDraftChanges(row, rowDraft);
                    return <tr key={row.id} className={fixCheck ? 'error-row-checked' : ''}>
                      <td className="error-title-cell">{canManage ? <input className="error-inline-input" value={rowDraft.title || ''} onChange={(event) => updateRowDraft(row, 'title', event.target.value)} disabled={isRowSaving} /> : <strong>{row.title}</strong>}</td>
                      <td>{canManage ? <input className="error-inline-input" value={rowDraft.chapter || ''} onChange={(event) => updateRowDraft(row, 'chapter', event.target.value)} disabled={isRowSaving} /> : row.chapter}</td>
                      <td>
                        {canManage ? (
                          <ErrorTypeControl value={rowDraft.errorType} onChange={(value) => updateRowDraft(row, 'errorType', value)} disabled={isRowSaving} ariaLabel={`Error Type cho ${row.title}`} />
                        ) : <ErrorTypeBadge value={row.errorType} />}
                      </td>
                      <td className="error-screenshot-cell">{canManage ? <ScreenshotUpload compact value={rowDraft.screenshot} onChange={(value) => updateRowDraft(row, 'screenshot', value)} onPreview={() => setSelectedScreenshot({ ...row, ...rowDraft })} disabled={isRowSaving} /> : getScreenshotImages(row.screenshot).length > 0 ? <button type="button" className="error-screenshot-preview-button" onClick={() => setSelectedScreenshot(row)} title="Xem chi tiết screenshot"><span className="error-screenshot-preview-grid">{getScreenshotImages(row.screenshot).map((image, index) => <img src={image} alt={`Screenshot ${index + 1} cho ${row.title}`} key={`${image.slice(0, 32)}-${index}`} />)}</span></button> : <span className="error-screenshot-empty">—</span>}</td>
                      <td className="error-description-cell">{canManage ? <textarea className="error-inline-textarea" value={rowDraft.error || ''} onChange={(event) => updateRowDraft(row, 'error', event.target.value)} disabled={isRowSaving} /> : row.error}</td>
                      <td className="error-note-cell">{canManage ? <NoteEditor value={rowDraft.note || ''} onChange={(value) => updateRowDraft(row, 'note', value)} onPreview={() => handlePreviewNote({ ...row, ...rowDraft })} disabled={isRowSaving} /> : <div className="error-note-readonly">{isImageValue(row.note) ? <button type="button" className="error-screenshot-upload-preview-trigger" onClick={() => handlePreviewNote(row)} title="Xem chi tiết Note"><img className="error-note-readonly-image" src={row.note} alt={`Note cho ${row.title}`} /></button> : (row.note || '—')}</div>}</td>
                      <td>{canManage ? <select className="error-inline-select" value={rowDraft.editorFreelancerId || ''} onChange={(event) => updateRowDraft(row, 'editorFreelancerId', event.target.value)} disabled={isRowSaving}><option value="">Chọn freelancer</option>{editorOptions.map((freelancer) => <option value={getFreelancerId(freelancer)} key={getFreelancerId(freelancer)}>{freelancer.name || freelancer.email}</option>)}</select> : <span className="error-editor-badge">{row.editor || 'Chưa gán'}</span>}</td>
                      <td className="error-check-cell"><label className="error-check-control"><input type="checkbox" checked={fixCheck} onChange={(event) => handleCheck(row, event.target.checked)} disabled={isLoading || isSaving || isRowSaving} aria-busy={isCheckPending} /><span>{isCheckPending ? 'Đang lưu...' : fixCheck ? 'Đã xem' : 'Chưa xem'}</span></label></td>
                      {canManage && <td><div className="error-row-actions"><button type="button" className="btn btn-primary btn-sm" onClick={() => handleSaveRowDraft(row)} disabled={isRowSaving || !isRowDirty}><IconCheck size={14} /> Lưu</button><button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(row)} disabled={isRowSaving}><IconTrash size={14} /> Xóa</button></div></td>}
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {selectedScreenshot && createPortal(
        <div className="modal-overlay" onClick={() => setSelectedScreenshot(null)} role="presentation">
          <div className="modal-content error-screenshot-preview-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="error-screenshot-preview-title">
            <div className="modal-header">
              <div>
                <span className="qc-kicker">{selectedScreenshot.imageLabel === 'Note' ? 'NOTE CỦA FL HOẶC QC' : 'CHI TIẾT LỖI'}</span>
                <div className="modal-title" id="error-screenshot-preview-title">{selectedScreenshot.title || `${selectedScreenshot.imageLabel || 'Screenshot'} lỗi`}</div>
              </div>
              <button type="button" className="icon-button" onClick={() => setSelectedScreenshot(null)} title="Đóng">
                <IconX size={18} />
              </button>
            </div>
            <div className="modal-body error-screenshot-preview-body">
              <div className="error-screenshot-preview-images">
                {getScreenshotImages(selectedScreenshot.screenshot).map((image, index) => (
                  <img src={image} alt={`${selectedScreenshot.imageLabel || 'Screenshot'} chi tiết ${index + 1} cho ${selectedScreenshot.title || 'lỗi'}`} key={`${image.slice(0, 32)}-${index}`} />
                ))}
              </div>
              <div className="error-screenshot-preview-meta">
                <strong>Chapter {selectedScreenshot.chapter || '—'}</strong>
                <span>{selectedScreenshot.field || activeField} · {selectedScreenshot.errorType || 'Chưa chọn Error Type'}</span>
                {selectedScreenshot.error && <p>{selectedScreenshot.error}</p>}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
