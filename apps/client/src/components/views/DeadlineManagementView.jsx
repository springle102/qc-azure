import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconEdit, IconPlus, IconRefresh, IconSearch, IconTasks, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';

const columns = [
  ['endTask', 'Hạn DL'],
  ['submittedAt', 'Ngày nộp'],
  ['seriesId', 'ID bộ truyện'],
  ['seriesName', 'Tên bộ truyện'],
  ['chapterNumber', 'Chapter'],
  ['type', 'Mảng'],
  ['statusRaw', 'Trạng thái raw'],
  ['urlSeries', 'URL bộ truyện'],
  ['fIld', 'Freelancer'],
  ['status', 'Status', 'status-select'],
  ['difficulty', 'Độ khó'],
  ['qcId', 'QC'],
  ['completionPercent', '% hoàn thành'],
  ['price', 'Giá'],
  ['receivePrice', 'Tiền nhận'],
  ['feedback', 'Feedback'],
  ['edit', 'Thao tác']
];

const EDIT_FIELDS = [
  ['seriesId', 'ID bộ truyện', 'number', true],
  ['chapterNumber', 'Chapter', 'number', true],
  ['endTask', 'Hạn DL', 'datetime-local'],
  ['seriesName', 'Tên bộ truyện', 'text'],
  ['type', 'Mảng', 'field-select'],
  ['statusRaw', 'Trạng thái raw', 'checkbox'],
  ['urlSeries', 'URL bộ truyện', 'url'],
  ['fIld', 'Freelancer', 'freelancer-select'],
  ['status', 'Status', 'status-select'],
  ['difficulty', 'Độ khó', 'select'],
  ['qcId', 'QC', 'qc-select'],
  ['completionPercent', '% hoàn thành', 'number'],
  ['price', 'Giá', 'number', true],
  ['receivePrice', 'Tiền nhận', 'number', true],
  ['feedback', 'Feedback', 'textarea']
];

const EDITABLE_FIELDS = EDIT_FIELDS.filter(([, , , readOnly]) => !readOnly).map(([key]) => key);
const CREATE_FIELDS = EDIT_FIELDS.filter(([key]) => !['price', 'receivePrice'].includes(key)).map(([key]) => key);
const NUMERIC_FIELDS = new Set(['fIld', 'qcId', 'price', 'receivePrice', 'completionPercent']);
const DATE_TIME_FIELDS = new Set(['endTask']);
const FIELD_OPTIONS = ['Latin', 'Japan', 'QC'];
const STATUS_OPTIONS = [
  { value: 'doing', label: 'Doing', className: 'task-status-doing' },
  { value: 'submitted', label: 'Submitted', className: 'task-status-submitted' },
  { value: 'checking', label: 'Checking', className: 'task-status-checking' },
  { value: 'fixing', label: 'Fixing', className: 'task-status-fixing' },
  { value: 'done', label: 'Done', className: 'task-status-done' }
];

export function DeadlineManagementView({ deadlines = [], freelancers = [], qcs = [], fields = [], difficultyLevels = [], difficultyPrices = [], isLoading, onRefresh, onUpdate, onCreate, readOnly = false, title = 'Quản lý deadline' }) {
  const [field, setField] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [freelancer, setFreelancer] = useState('');
  const [qc, setQc] = useState('');
  const [search, setSearch] = useState('');
  const [editingDeadline, setEditingDeadline] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [rawStatusUpdatingKey, setRawStatusUpdatingKey] = useState('');
  const [taskStatusUpdatingKey, setTaskStatusUpdatingKey] = useState('');
  const fieldOptions = useMemo(() => fields.length > 0 ? fields.map((field) => field.name || field).filter(Boolean) : FIELD_OPTIONS, [fields]);
  const visibleColumns = useMemo(() => readOnly ? columns.filter(([key]) => key !== 'edit') : columns, [readOnly]);

  const freelancerOptions = useMemo(() => peopleOptions(freelancers, 'fIld', 'fId'), [freelancers]);
  const qcOptions = useMemo(() => peopleOptions(qcs, 'qcId'), [qcs]);
  const options = useMemo(() => ({
    series: unique(deadlines.map((item) => item.seriesId)),
    freelancers: freelancerOptions,
    qcs: qcOptions
  }), [deadlines, freelancerOptions, qcOptions]);

  const filteredDeadlines = useMemo(() => deadlines.filter((item) => {
    const text = Object.values(item).join(' ').toLowerCase();
    return (!field || String(item.type || '') === field)
      && (!seriesId || String(item.seriesId || '') === seriesId)
      && (!freelancer || String(item.fIld ?? item.fId ?? '') === freelancer)
      && (!qc || String(item.qcId ?? '') === qc)
      && (!search.trim() || text.includes(search.trim().toLowerCase()));
  }), [deadlines, field, freelancer, qc, search, seriesId]);

  const openCreate = () => {
    setIsCreating(true);
    setEditingDeadline(createNewEditState(difficultyLevels, difficultyPrices, freelancerOptions, qcOptions, fieldOptions));
  };

  const openEdit = (deadline) => {
    setIsCreating(false);
    setEditingDeadline(createEditState(deadline, difficultyPrices));
  };

  const closeEdit = () => {
    if (!isSaving) {
      setEditingDeadline(null);
      setIsCreating(false);
    }
  };

  const updateEditField = (key, value) => {
    setEditingDeadline((current) => {
      const next = { ...current, [key]: value };
      if (key === 'difficulty') {
        next.price = getConfiguredPrice(current.type, value, difficultyPrices) ?? '';
        next.receivePrice = calculateReceivePrice(next.price, next.completionPercent);
      }
      if (key === 'type') {
        const availableLevels = getDifficultyOptions(value, difficultyLevels, difficultyPrices);
        const nextDifficulty = availableLevels.some((level) => level.difficulty === current.difficulty)
          ? current.difficulty
          : availableLevels[0]?.difficulty || '';
        next.difficulty = nextDifficulty;
        next.price = getConfiguredPrice(value, nextDifficulty, difficultyPrices) ?? '';
        next.receivePrice = calculateReceivePrice(next.price, next.completionPercent);
      }
      if (key === 'completionPercent') {
        next.receivePrice = calculateReceivePrice(next.price, value);
      }
      return next;
    });
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (!editingDeadline) return;

    setIsSaving(true);
    try {
      const fields = isCreating ? CREATE_FIELDS : EDITABLE_FIELDS;
      const payload = Object.fromEntries(fields.map((key) => [key, toApiValue(key, editingDeadline[key])]));
      if (isCreating) {
        const createdDeadline = await api.createDeadline(payload);
        onCreate?.(createdDeadline);
        showToast('Đã thêm deadline.', 'success');
      } else {
        const updatedDeadline = await api.updateDeadline(editingDeadline.seriesId, editingDeadline.chapterNumber, payload);
        onUpdate?.(updatedDeadline);
        showToast('Đã cập nhật deadline.', 'success');
      }
      setEditingDeadline(null);
      setIsCreating(false);
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật deadline.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleRawStatus = async (deadline, checked) => {
    const rowKey = String(deadline.seriesId) + '-' + String(deadline.chapterNumber);
    setRawStatusUpdatingKey(rowKey);
    try {
      const updatedDeadline = await api.updateDeadline(deadline.seriesId, deadline.chapterNumber, {
        statusRaw: rawStatusFromCheckbox(checked)
      });
      onUpdate?.(updatedDeadline);
      showToast('Đã cập nhật trạng thái raw.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật trạng thái raw.', 'error');
    } finally {
      setRawStatusUpdatingKey('');
    }
  };

  const updateTaskStatus = async (deadline, status) => {
    const rowKey = String(deadline.seriesId) + '-' + String(deadline.chapterNumber);
    setTaskStatusUpdatingKey(rowKey);
    try {
      const updatedDeadline = await api.updateDeadlineStatus(deadline.seriesId, deadline.chapterNumber, status);
      onUpdate?.(updatedDeadline);
      showToast('Đã cập nhật status và thời gian làm task.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật status.', 'error');
    } finally {
      setTaskStatusUpdatingKey('');
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">TIẾN ĐỘ</span>
          <h2 className="page-title">{title}</h2>
          <p className="page-subtitle">{readOnly ? 'Chỉ xem các deadline được giao cho tài khoản của bạn.' : 'Lọc và theo dõi các trường trong bảng SeriesList.'}</p>
        </div>
        <div className="page-header-actions">
          {!readOnly && <button type="button" className="btn btn-primary" onClick={openCreate} disabled={isSaving}>
            <IconPlus size={16} /> Thêm deadline
          </button>}
          <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
            <IconRefresh size={16} /> Làm mới
          </button>
        </div>
      </div>

      <section className="glass-panel qc-table-panel">
        <div className="table-toolbar deadline-toolbar">
          <div className="toolbar-search">
            <IconSearch size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm trong deadline" />
          </div>
          <select className="form-select toolbar-filter" value={field} onChange={(event) => setField(event.target.value)}>
            <option value="">Tất cả mảng</option>
            {fieldOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="form-select toolbar-filter" value={seriesId} onChange={(event) => setSeriesId(event.target.value)}>
            <option value="">Tất cả ID bộ truyện</option>
            {options.series.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          {!readOnly && <>
            <select className="form-select toolbar-filter" value={freelancer} onChange={(event) => setFreelancer(event.target.value)}>
              <option value="">Tất cả freelancer</option>
              {options.freelancers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
            <select className="form-select toolbar-filter" value={qc} onChange={(event) => setQc(event.target.value)}>
              <option value="">Tất cả QC</option>
              {options.qcs.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </>}
        </div>

        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table deadline-table">
            <thead><tr>{visibleColumns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>
              {filteredDeadlines.length === 0 ? (
                <tr><td colSpan={visibleColumns.length}><div className="empty-state table-empty"><IconTasks size={24} /><strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có deadline trong hệ thống.'}</strong></div></td></tr>
              ) : filteredDeadlines.map((item, index) => (
                <tr key={`${item.seriesId || 'series'}-${item.chapterNumber || index}`}>
                  {visibleColumns.map(([key]) => (
                    <td key={key}>
                      {key === 'edit' ? (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(item)}>
                          <IconEdit size={14} /> Chỉnh sửa
                        </button>
                      ) : key === 'statusRaw' ? (
                        <input
                          className="raw-status-checkbox"
                          type="checkbox"
                          checked={isRawChecked(item.statusRaw)}
                          onChange={(event) => toggleRawStatus(item, event.target.checked)}
                          disabled={readOnly || rawStatusUpdatingKey === String(item.seriesId) + '-' + String(item.chapterNumber)}
                          aria-label={'Trạng thái raw: ' + (item.statusRaw || 'chưa hoàn thành')}
                        />
                      ) : key === 'status' ? (
                        <div className="task-status-cell">
                          <TaskStatusControl
                            value={item.status}
                            options={getVisibleStatusOptions(item.status, readOnly)}
                            disabled={(readOnly && !['doing', 'submitted'].includes(String(item.status || '').toLowerCase())) || taskStatusUpdatingKey === String(item.seriesId) + '-' + String(item.chapterNumber)}
                            onChange={(status) => updateTaskStatus(item, status)}
                          />
                        </div>
                      ) : renderValue(key === 'fIld' ? (item.fIld ?? item.fId) : item[key], key, item.type, difficultyLevels, freelancerOptions, qcOptions, item)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editingDeadline && (
        <DeadlineEditModal
          value={editingDeadline}
          isCreate={isCreating}
          freelancers={freelancerOptions}
          qcs={qcOptions}
          difficultyLevels={difficultyLevels}
          difficultyPrices={difficultyPrices}
          fieldOptions={fieldOptions}
          statusOptions={STATUS_OPTIONS}
          isSaving={isSaving}
          onChange={updateEditField}
          onClose={closeEdit}
          onSubmit={saveEdit}
        />
      )}
    </div>
  );
}

function peopleOptions(rows, primaryId, fallbackId) {
  return rows
    .map((row) => ({
      id: row[primaryId] ?? (fallbackId ? row[fallbackId] : undefined) ?? row.id,
      name: row.name || 'Chưa có tên'
    }))
    .filter((person) => person.id !== null && person.id !== undefined && person.id !== '')
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'vi'));
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function renderValue(value, key, field, difficultyLevels, freelancers, qcs, item = {}) {
  if (key === 'statusRaw') {
    return <input className="raw-status-checkbox" type="checkbox" checked={isRawChecked(value)} readOnly disabled aria-label={`Trạng thái raw: ${value || 'chưa hoàn thành'}`} />;
  }
  if (key === 'completionPercent' && (value === null || value === undefined || value === '')) value = 100;
  if (key === 'status') return <TaskStatusBadge value={value} />;
  if (key === 'submittedAt') {
    return (
      <div className="submitted-at-cell">
        <span>{value ? formatDateTime(value) : 'Chưa nộp'}</span>
        <span className="task-duration">Tổng: {formatDuration(item.workDurationSeconds)}</span>
      </div>
    );
  }
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'urlSeries' && String(value).startsWith('http')) return <a className="table-link" href={value} target="_blank" rel="noreferrer">Mở link</a>;
  if (key === 'endTask') return formatDateTime(value);
  if (key === 'completionPercent') return <span className="completion-badge">{value}%</span>;
  if (key === 'fIld') return findPersonName(value, freelancers);
  if (key === 'qcId') return findPersonName(value, qcs);
  if (key === 'difficulty') {
    const configuredLevel = difficultyLevels.find((level) => level.field === field && level.difficulty === String(value));
    if (configuredLevel) {
      return <span className="difficulty-badge difficulty-custom-badge" style={{ '--difficulty-color': configuredLevel.color || '#64748B' }}>{String(value)}</span>;
    }
    return <span className={`difficulty-badge ${difficultyClass(value)}`}>{String(value)}</span>;
  }
  return String(value);
}

function findPersonName(value, people) {
  return people.find((person) => String(person.id) === String(value))?.name || String(value);
}

function getStatusOption(value) {
  return STATUS_OPTIONS.find((option) => option.value === String(value || '').toLowerCase());
}

function getVisibleStatusOptions(value, readOnly) {
  if (!readOnly) return STATUS_OPTIONS;
  const allowed = STATUS_OPTIONS.filter((option) => ['doing', 'submitted'].includes(option.value));
  const current = getStatusOption(value);
  return current && !allowed.some((option) => option.value === current.value) ? [...allowed, current] : allowed;
}

function TaskStatusBadge({ value }) {
  const option = getStatusOption(value);
  return option
    ? <span className={`task-status-badge ${option.className}`}>{option.label}</span>
    : <span className="task-status-badge task-status-pending">Chưa bắt đầu</span>;
}

function TaskStatusControl({ value, options, disabled, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selectedOption = getStatusOption(value);
  const selectedClassName = selectedOption?.className || 'task-status-pending';
  const selectedLabel = selectedOption?.label || 'Chưa bắt đầu';

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
      const menuWidth = Math.max(142, rect.width);
      const menuHeight = (options.length + 1) * 34 + 10;
      const shouldOpenUp = rect.bottom + 6 + menuHeight > window.innerHeight && rect.top > menuHeight + 6;
      const top = shouldOpenUp ? rect.top - menuHeight - 6 : rect.bottom + 6;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - menuWidth - 8);

      setMenuPosition({
        top: Math.max(8, top),
        left,
        width: menuWidth
      });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen, options.length]);

  const selectStatus = (nextValue) => {
    setIsOpen(false);
    onChange(nextValue || null);
  };

  return (
    <div ref={dropdownRef} className={`task-status-dropdown ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        ref={triggerRef}
        className={`task-status-trigger ${selectedClassName}`}
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled}
        aria-label="Status task"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="task-status-trigger-label">
          <span className="task-status-dot" aria-hidden="true" />
          {selectedLabel}
        </span>
        <span className="task-status-chevron" aria-hidden="true">⌄</span>
      </button>
      {isOpen && menuPosition && createPortal(
        <div ref={menuRef} className="task-status-menu" style={menuPosition} role="listbox" aria-label="Chọn trạng thái">
          <button
            type="button"
            className={`task-status-option task-status-pending ${!selectedOption ? 'is-selected' : ''}`}
            role="option"
            aria-selected={!selectedOption}
            onClick={() => selectStatus('')}
          >
            <span className="task-status-dot" aria-hidden="true" />
            Chưa bắt đầu
          </button>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`task-status-option ${option.className} ${selectedOption?.value === option.value ? 'is-selected' : ''}`}
              role="option"
              aria-selected={selectedOption?.value === option.value}
              onClick={() => selectStatus(option.value)}
            >
              <span className="task-status-dot" aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function difficultyClass(value) {
  const difficulty = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  if (difficulty === 'training') return 'difficulty-training';
  if (difficulty === 'normal') return 'difficulty-normal';
  if (difficulty === 'medium') return 'difficulty-medium';
  if (difficulty === 'hard') return 'difficulty-hard';
  if (difficulty === 'very hard') return 'difficulty-very-hard';
  return 'difficulty-unknown';
}

function isRawChecked(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'done', 'completed', 'hoàn thành', 'đã hoàn thành', 'đã up raw'].includes(normalized);
}

function rawStatusFromCheckbox(checked) {
  return checked ? 'Hoàn thành' : 'Đang thực hiện';
}

function getConfiguredPrice(field, difficulty, difficultyPrices) {
  const priceRow = difficultyPrices.find((item) => item.field === field && item.difficulty === difficulty);
  return priceRow?.price;
}

function calculateReceivePrice(price, completionPercent) {
  const numericPrice = Number(price);
  const numericPercent = Number(completionPercent);
  if (!Number.isFinite(numericPrice) || !Number.isFinite(numericPercent)) return '';
  return (numericPrice * numericPercent / 100).toFixed(2);
}

function getDifficultyOptions(field, difficultyLevels, difficultyPrices) {
  const levels = difficultyLevels.filter((level) => level.field === field);
  if (levels.length > 0) return levels;
  return difficultyPrices
    .filter((price) => price.field === field)
    .map((price) => ({ id: 'price-' + price.id, difficulty: price.difficulty, color: '#64748B' }));
}

function createNewEditState(difficultyLevels, difficultyPrices, freelancers, qcs, fieldOptions = FIELD_OPTIONS) {
  const type = fieldOptions[0] || '';
  const difficulty = getDifficultyOptions(type, difficultyLevels, difficultyPrices)[0]?.difficulty || '';
  const price = getConfiguredPrice(type, difficulty, difficultyPrices) ?? '';
  return {
    seriesId: '',
    chapterNumber: '',
    endTask: '',
    seriesName: '',
    type,
    statusRaw: 'Đang thực hiện',
    status: '',
    urlSeries: '',
    fIld: freelancers[0]?.id ?? '',
    difficulty,
    qcId: qcs[0]?.id ?? '',
    completionPercent: 100,
    price,
    receivePrice: calculateReceivePrice(price, 100),
    feedback: ''
  };
}

function createEditState(deadline, difficultyPrices) {
  return {
    seriesId: deadline.seriesId ?? '',
    chapterNumber: deadline.chapterNumber ?? '',
    endTask: toDateTimeInput(deadline.endTask),
    seriesName: deadline.seriesName ?? '',
    type: deadline.type ?? '',
    statusRaw: deadline.statusRaw ?? '',
    status: deadline.status ?? '',
    completionPercent: deadline.completionPercent ?? 100,
    urlSeries: deadline.urlSeries ?? '',
    fIld: deadline.fIld ?? deadline.fId ?? '',
    difficulty: deadline.difficulty ?? '',
    qcId: deadline.qcId ?? '',
    price: deadline.price ?? getConfiguredPrice(deadline.type, deadline.difficulty, difficultyPrices) ?? '',
    receivePrice: calculateReceivePrice(deadline.price ?? getConfiguredPrice(deadline.type, deadline.difficulty, difficultyPrices), deadline.completionPercent ?? 100),
    feedback: deadline.feedback ?? ''
  };
}

function toApiValue(key, value) {
  if (value === '') return null;
  if (DATE_TIME_FIELDS.has(key)) return new Date(value).toISOString();
  if (NUMERIC_FIELDS.has(key)) return Number(value);
  return value;
}

function toDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN');
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Number(seconds || 0));
  if (!totalSeconds) return 'Chưa tính giờ';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function DeadlineEditModal({ value, isCreate, freelancers, qcs, difficultyLevels, difficultyPrices, fieldOptions = FIELD_OPTIONS, statusOptions, isSaving, onChange, onClose, onSubmit }) {
  const difficultyOptions = getDifficultyOptions(value.type, difficultyLevels, difficultyPrices);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-content modal-lg deadline-edit-modal" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="qc-kicker">{isCreate ? 'ADMIN CREATOR' : 'QC EDITOR'}</span>
            <div className="modal-title">{isCreate ? 'Thêm deadline' : 'Chỉnh sửa deadline'}</div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={isSaving} title="Đóng">
            <IconX size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="deadline-edit-note">
            {isCreate ? 'Chọn Freelancer và QC từ danh sách lấy trực tiếp trong database.' : 'ID bộ truyện và Chapter là khóa liên kết nên không thể chỉnh sửa.'}
          </div>
          <div className="deadline-edit-grid">
            {EDIT_FIELDS.map(([key, label, type, readOnly]) => (
              <div className={type === 'textarea' ? 'form-group form-group-full' : 'form-group'} key={key}>
                <label className="form-label" htmlFor={`deadline-${key}`}>{label}</label>
                {type === 'textarea' ? (
                  <textarea
                    id={`deadline-${key}`}
                    className="form-textarea"
                    value={value[key]}
                    onChange={(event) => onChange(key, event.target.value)}
                    disabled={isSaving}
                  />
                ) : type === 'checkbox' ? (
                  <label className="form-checkbox-control" htmlFor={`deadline-${key}`}>
                    <input
                      id={`deadline-${key}`}
                      type="checkbox"
                      checked={isRawChecked(value[key])}
                      onChange={(event) => onChange(key, rawStatusFromCheckbox(event.target.checked))}
                      disabled={isSaving}
                    />
                    <span>{isRawChecked(value[key]) ? 'Đã hoàn thành raw' : 'Chưa hoàn thành raw'}</span>
                  </label>
                ) : type === 'freelancer-select' ? (
                  <select
                    id={'deadline-' + key}
                    className="form-select"
                    value={value[key] ?? ''}
                    onChange={(event) => onChange(key, event.target.value)}
                    disabled={isSaving}
                  >
                    <option value="">Chưa phân công</option>
                    {freelancers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                  </select>
                ) : type === 'status-select' ? (
                  <select
                    id={'deadline-' + key}
                    className="form-select"
                    value={value[key] ?? ''}
                    onChange={(event) => onChange(key, event.target.value)}
                    disabled={isSaving}
                  >
                    <option value="">Chưa bắt đầu</option>
                    {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : type === 'qc-select' ? (
                  <select
                    id={'deadline-' + key}
                    className="form-select"
                    value={value[key] ?? ''}
                    onChange={(event) => onChange(key, event.target.value)}
                    disabled={isSaving}
                  >
                    <option value="">Chưa phân công</option>
                    {qcs.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                  </select>
                ) : type === 'field-select' ? (
                  <select
                    id={`deadline-${key}`}
                    className="form-select"
                    value={value[key]}
                    onChange={(event) => onChange(key, event.target.value)}
                    disabled={isSaving}
                  >
                    {fieldOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : type === 'select' ? (
                  <select
                    id={`deadline-${key}`}
                    className="form-select"
                    value={value[key]}
                    onChange={(event) => onChange(key, event.target.value)}
                    disabled={isSaving}
                  >
                    <option value="">Chưa xác định</option>
                    {difficultyOptions.length > 0
                      ? difficultyOptions.map((option) => <option key={option.id} value={option.difficulty}>{option.difficulty}</option>)
                      : value.difficulty && <option value={value.difficulty}>{value.difficulty}</option>}
                  </select>
                ) : (
                  <input
                    id={`deadline-${key}`}
                    className="form-input"
                    type={type}
                    min={key === 'completionPercent' ? 0 : undefined}
                    max={key === 'completionPercent' ? 200 : undefined}
                    step={type === 'number' && ['price', 'receivePrice'].includes(key) ? '0.01' : '1'}
                    value={value[key]}
                    onChange={(event) => onChange(key, event.target.value)}
                    disabled={isSaving || ((key === 'price' || key === 'receivePrice') ? true : (!isCreate && readOnly))}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={isSaving}>Hủy</button>
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? 'Đang lưu...' : (isCreate ? 'Thêm deadline' : 'Lưu thay đổi')}
          </button>
        </div>
      </form>
    </div>
  );
}
