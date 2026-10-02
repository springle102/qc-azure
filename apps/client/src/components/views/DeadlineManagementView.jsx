import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconEdit, IconFilter, IconPlus, IconRefresh, IconSearch, IconTasks, IconTrash, IconX } from '../common/Icons';
import { showToast } from '../common/ToastContainer';
import { api } from '../../services/api';

const columns = [
  ['endTask', 'Hạn DL'],
  ['submittedAt', 'Ngày nộp'],
  ['fIld', 'Freelancer'],
  ['seriesId', 'ID bộ truyện'],
  ['type', 'Mảng'],
  ['seriesName', 'Tên bộ truyện'],
  ['chapterNumber', 'Chapter'],
  ['statusRaw', 'File'],
  ['urlSeries', 'URL bộ truyện'],
  ['status', 'Status', 'status-select'],
  ['qcId', 'QC'],
  ['difficulty', 'Độ khó'],
  ['completionPercent', '% hoàn thành'],
  ['price', 'Giá'],
  ['receivePrice', 'Tiền nhận'],
  ['feedback', 'Feedback'],
  ['late', 'Late'],
  ['paymentApproved', 'Thanh toán'],
  ['edit', 'Thao tác']
];

const EDIT_FIELDS = [
  ['seriesId', 'ID bộ truyện', 'number', true],
  ['chapterNumber', 'Chapter', 'text', true],
  ['endTask', 'Hạn DL', 'date'],
  ['seriesName', 'Tên bộ truyện', 'text'],
  ['type', 'Mảng', 'field-select'],
  ['statusRaw', 'File', 'checkbox'],
  ['urlSeries', 'URL bộ truyện', 'url'],
  ['fIld', 'Freelancer', 'freelancer-select'],
  ['status', 'Status', 'status-select'],
  ['difficulty', 'Độ khó', 'select'],
  ['qcId', 'QC', 'qc-select'],
  ['completionPercent', '% hoàn thành', 'number'],
  ['price', 'Giá', 'number', true],
  ['receivePrice', 'Tiền nhận', 'number', true],
  ['feedback', 'Feedback', 'textarea'],
  ['late', 'Late', 'late-select']
];

const ASSIGNMENT_FIELD = 'assignedAdminId';
const EDITABLE_FIELDS = [...EDIT_FIELDS.filter(([, , , readOnly]) => !readOnly).map(([key]) => key), ASSIGNMENT_FIELD];
const CREATE_FIELDS = [...EDIT_FIELDS.filter(([key]) => !['price', 'receivePrice'].includes(key)).map(([key]) => key), ASSIGNMENT_FIELD];
const NUMERIC_FIELDS = new Set(['fIld', 'assignedAdminId', 'qcId', 'price', 'receivePrice', 'completionPercent']);
const DATE_FIELDS = new Set(['endTask']);
const MONTH_FILTER_COLUMNS = new Set(['endTask', 'submittedAt']);
const STRING_SORT_COLUMNS = new Set(['seriesName', 'chapterNumber', 'type', 'urlSeries', 'difficulty', 'feedback', 'late']);
const NUMBER_SORT_COLUMNS = new Set(['seriesId', 'fIld', 'qcId', 'completionPercent', 'price', 'receivePrice']);
const DATE_SORT_COLUMNS = new Set(['endTask']);
const STATUS_OPTIONS = [
  { value: 'doing', label: 'Doing', className: 'task-status-doing' },
  { value: 'submitted', label: 'Submitted', className: 'task-status-submitted' },
  { value: 'checking', label: 'Checking', className: 'task-status-checking' },
  { value: 'fixing', label: 'Fixing', className: 'task-status-fixing' },
  { value: 'done', label: 'Done', className: 'task-status-done' }
];

export function DeadlineManagementView({ deadlines = [], freelancers = [], qcs = [], fields = [], difficultyLevels = [], difficultyPrices = [], currentUser = {}, isLoading, onRefresh, onUpdate, onCreate, onDelete, readOnly = false, title = 'Quản lý deadline' }) {
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
  const [statusOverrides, setStatusOverrides] = useState({});
  const [paymentUpdatingKey, setPaymentUpdatingKey] = useState('');
  const [paymentOverrides, setPaymentOverrides] = useState({});
  const [lateUpdatingKey, setLateUpdatingKey] = useState('');
  const [deletingKey, setDeletingKey] = useState('');
  const [columnFilters, setColumnFilters] = useState({});
  const [columnSort, setColumnSort] = useState(null);
  const fieldOptions = useMemo(() => fields.map((field) => field.name || field).filter(Boolean), [fields]);
  const visibleColumns = useMemo(() => readOnly ? columns.filter(([key]) => key !== 'edit') : columns, [readOnly]);

  const freelancerOptions = useMemo(() => peopleOptions(freelancers, 'fIld', 'fId'), [freelancers]);
  const qcOptions = useMemo(() => peopleOptions(qcs, 'qcId', undefined, true), [qcs]);
  const options = useMemo(() => ({
    series: unique(deadlines.map((item) => item.seriesId)),
    freelancers: freelancerOptions,
    qcs: qcOptions
  }), [deadlines, freelancerOptions, qcOptions]);

  const columnFilterOptions = useMemo(() => Object.fromEntries(
    visibleColumns
      .filter(([key]) => key !== 'edit')
      .map(([key]) => {
        const values = uniqueFilterValues(deadlines.map((item) => getColumnFilterValue(item, key, freelancerOptions, currentUser)));
        return [key, sortFilterValues(key === 'late' ? LATE_OPTIONS : values, key)];
      })
  ), [currentUser, deadlines, freelancerOptions, visibleColumns]);

  const filteredDeadlines = useMemo(() => {
    const filtered = deadlines.filter((item) => {
    const text = [
      ...Object.values(item),
      getAssignedPersonName(item, freelancerOptions, currentUser)
    ].join(' ').toLowerCase();
    const matchesColumnFilters = Object.entries(columnFilters).every(([key, selectedValues]) => (
      selectedValues.includes(getColumnFilterValue(item, key, freelancerOptions, currentUser))
    ));
    return (!field || String(item.type || '') === field)
      && (!seriesId || String(item.seriesId || '') === seriesId)
      && (!freelancer || getAssignedPersonName(item, freelancerOptions, currentUser) === freelancer)
      && (!qc || String(item.qcId ?? '') === qc)
      && (!search.trim() || text.includes(search.trim().toLowerCase()))
      && matchesColumnFilters;
    });
    const sortKey = columnSort?.key || columns[0][0];
    const sortDirection = columnSort?.direction || 'asc';
    const sortKind = getColumnSortKind(sortKey);
    if (!sortKind) return filtered;
    return [...filtered].sort((left, right) => compareColumnValues(left, right, sortKey, sortKind, sortDirection));
  }, [columnFilters, columnSort, currentUser, deadlines, field, freelancer, freelancerOptions, qc, search, seriesId]);

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
        const nextDifficulty = current.difficulty && availableLevels.some((level) => level.difficulty === current.difficulty)
          ? current.difficulty
          : '';
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
      showToast('Đã cập nhật File.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật File.', 'error');
    } finally {
      setRawStatusUpdatingKey('');
    }
  };

  const updateTaskStatus = async (deadline, status) => {
    const rowKey = String(deadline.seriesId) + '-' + String(deadline.chapterNumber);
    const previousStatus = getStatusDisplayValue(deadline, statusOverrides);
    setStatusOverrides((current) => ({ ...current, [rowKey]: status }));
    // Update the shared table immediately; the server response will fill in
    // timestamps/duration, while a failed request rolls this status back.
    onUpdate?.({ ...deadline, status });
    setTaskStatusUpdatingKey(rowKey);
    try {
      const updatedDeadline = await api.updateDeadlineStatus(deadline.seriesId, deadline.chapterNumber, status);
      onUpdate?.(updatedDeadline);
      setStatusOverrides((current) => {
        const next = { ...current };
        delete next[rowKey];
        return next;
      });
      showToast('Đã cập nhật status và thời gian làm task.', 'success');
    } catch (error) {
      onUpdate?.({ ...deadline, status: previousStatus });
      setStatusOverrides((current) => {
        const next = { ...current };
        delete next[rowKey];
        return next;
      });
      showToast(error.message || 'Không thể cập nhật status.', 'error');
    } finally {
      setTaskStatusUpdatingKey('');
    }
  };

  const togglePayment = async (deadline, checked) => {
    const rowKey = String(deadline.seriesId) + '-' + String(deadline.chapterNumber);
    // Show the new state immediately while the database/Sheet update runs.
    setPaymentOverrides((current) => ({ ...current, [rowKey]: checked }));
    setPaymentUpdatingKey(rowKey);
    try {
      const updatedDeadline = await api.updateDeadline(deadline.seriesId, deadline.chapterNumber, {
        paymentApproved: checked
      });
      onUpdate?.(updatedDeadline);
      setPaymentOverrides((current) => {
        const next = { ...current };
        delete next[rowKey];
        return next;
      });
      showToast(checked ? 'Đã đánh dấu task được tính lương.' : 'Đã bỏ đánh dấu thanh toán.', 'success');
    } catch (error) {
      // The props still contain the previous value, so removing the override
      // restores the checkbox automatically when the request fails.
      setPaymentOverrides((current) => {
        const next = { ...current };
        delete next[rowKey];
        return next;
      });
      showToast(error.message || 'Không thể cập nhật trạng thái thanh toán.', 'error');
    } finally {
      setPaymentUpdatingKey('');
    }
  };

  const updateLate = async (deadline, late) => {
    const rowKey = String(deadline.seriesId) + '-' + String(deadline.chapterNumber);
    setLateUpdatingKey(rowKey);
    try {
      const updatedDeadline = await api.updateDeadline(deadline.seriesId, deadline.chapterNumber, {
        late: normalizeLateValue(late)
      });
      onUpdate?.(updatedDeadline);
      showToast('Đã cập nhật mức Late.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật mức Late.', 'error');
    } finally {
      setLateUpdatingKey('');
    }
  };

  const updateFeedback = async (deadline, feedback) => {
    try {
      const updatedDeadline = await api.updateDeadline(deadline.seriesId, deadline.chapterNumber, { feedback });
      onUpdate?.(updatedDeadline);
      showToast('Đã cập nhật Feedback.', 'success');
      return updatedDeadline;
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật Feedback.', 'error');
      throw error;
    }
  };

  const deleteDeadline = async (deadline) => {
    if (!window.confirm(`Xóa deadline ${deadline.seriesId} - Chapter ${deadline.chapterNumber}? Dòng này cũng sẽ bị xóa trên Google Sheet.`)) return;
    const rowKey = String(deadline.seriesId) + '-' + String(deadline.chapterNumber);
    setDeletingKey(rowKey);
    try {
      const deletedDeadline = await api.deleteDeadline(deadline.seriesId, deadline.chapterNumber);
      onDelete?.(deletedDeadline);
      showToast('Đã xóa deadline trên web và Google Sheet.', 'success');
    } catch (error) {
      showToast(error.message || 'Không thể xóa deadline.', 'error');
    } finally {
      setDeletingKey('');
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">QUẢN LÝ TIẾN ĐỘ</span>
          <h2 className="page-title">{title}</h2>
        </div>
        <div className="page-header-actions">
          {!readOnly && <button type="button" className="btn btn-primary" onClick={openCreate} disabled={isSaving}>
            <IconPlus size={16} /> Thêm deadline
          </button>}
          <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
            <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}
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
              {options.freelancers.map((person) => <option key={person.id} value={person.name}>{person.name}</option>)}
            </select>
            <select className="form-select toolbar-filter" value={qc} onChange={(event) => setQc(event.target.value)}>
              <option value="">Tất cả QC</option>
              {options.qcs.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </>}
        </div>

        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table deadline-table">
            <thead>
              <tr>
                {visibleColumns.map(([key, label]) => (
                  <th key={label} className={`deadline-column deadline-column-${key}`}>
                    <div className="deadline-column-header">
                      <span>{label}</span>
                      {key !== 'edit' && <ColumnFilterButton
                        columnKey={key}
                        label={label}
                        values={columnFilterOptions[key] || []}
                        activeValues={columnFilters[key]}
                        sortKind={getColumnSortKind(key)}
                        activeSortDirection={columnSort?.key === key ? columnSort.direction : null}
                        onApply={(selectedValues) => updateColumnFilter(key, selectedValues)}
                        onSort={(direction) => updateColumnSort(key, direction)}
                      />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredDeadlines.length === 0 ? (
                <tr><td colSpan={visibleColumns.length}><div className="empty-state table-empty"><IconTasks size={24} /><strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có deadline trong hệ thống.'}</strong></div></td></tr>
              ) : filteredDeadlines.map((item, index) => {
                const overdueDoing = isDeadlineOverdue(item) && isDoingStatus(item, statusOverrides);
                return (
                <tr
                  key={`${item.seriesId || 'series'}-${item.chapterNumber || index}`}
                  className={overdueDoing ? 'deadline-row-overdue' : undefined}
                >
                  {visibleColumns.map(([key]) => (
                    <td key={key} className={`deadline-column deadline-column-${key}`}>
                      {key === 'edit' ? (
                        <div className="deadline-action-buttons">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(item)} disabled={deletingKey === String(item.seriesId) + '-' + String(item.chapterNumber)}>
                            <IconEdit size={14} /> Chỉnh sửa
                          </button>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteDeadline(item)} disabled={deletingKey === String(item.seriesId) + '-' + String(item.chapterNumber)}>
                            <IconTrash size={14} /> Xóa
                          </button>
                        </div>
                      ) : key === 'feedback' && readOnly ? (
                        <FeedbackEditor value={item.feedback} onSave={(value) => updateFeedback(item, value)} />
                      ) : key === 'statusRaw' ? (
                        <input
                          className="raw-status-checkbox"
                          type="checkbox"
                          checked={isRawChecked(item.statusRaw)}
                          onChange={(event) => toggleRawStatus(item, event.target.checked)}
                          disabled={readOnly || rawStatusUpdatingKey === String(item.seriesId) + '-' + String(item.chapterNumber)}
                          aria-label={'File: ' + (item.statusRaw || 'chưa hoàn thành')}
                        />
                      ) : key === 'status' ? (
                        <div className="task-status-cell">
                          <TaskStatusControl
                            value={getStatusDisplayValue(item, statusOverrides)}
                            options={getVisibleStatusOptions(readOnly)}
                            allowPending={!readOnly}
                            disabled={taskStatusUpdatingKey === String(item.seriesId) + '-' + String(item.chapterNumber)}
                            onChange={(status) => updateTaskStatus(item, status)}
                          />
                        </div>
                      ) : key === 'late' ? (
                        <LateControl
                          value={item.late}
                          disabled={readOnly || lateUpdatingKey === String(item.seriesId) + '-' + String(item.chapterNumber)}
                          onChange={(value) => updateLate(item, value)}
                        />
                      ) : key === 'paymentApproved' ? (
                        <input
                          className="raw-status-checkbox payment-checkbox"
                          type="checkbox"
                          checked={getPaymentDisplayValue(item, paymentOverrides)}
                          onChange={(event) => togglePayment(item, event.target.checked)}
                          disabled={readOnly || paymentUpdatingKey === String(item.seriesId) + '-' + String(item.chapterNumber)}
                          aria-label={'Thanh toán: ' + (getPaymentDisplayValue(item, paymentOverrides) ? 'đã chọn' : 'chưa chọn')}
                        />
                      ) : renderValue(key === 'fIld' ? (item.fIld ?? item.fId) : item[key], key, item.type, difficultyLevels, freelancerOptions, qcOptions, item, currentUser)}
                    </td>
                  ))}
                </tr>
                );
              })}
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
          currentUser={currentUser}
          isSaving={isSaving}
          onChange={updateEditField}
          onClose={closeEdit}
          onSubmit={saveEdit}
        />
      )}
    </div>
  );
}

function peopleOptions(rows, primaryId, fallbackId, dedupeByName = false) {
  const seenIds = new Set();
  const seenNames = new Set();
  return rows
    .map((row) => ({
      id: row[primaryId] ?? (fallbackId ? row[fallbackId] : undefined) ?? row.id,
      name: row.name || 'Chưa có tên'
    }))
    .filter((person) => person.id !== null && person.id !== undefined && person.id !== '')
    .filter((person) => {
      const idKey = String(person.id);
      const nameKey = String(person.name).trim().toLocaleLowerCase('vi-VN');
      if (seenIds.has(idKey) || (dedupeByName && seenNames.has(nameKey))) return false;
      seenIds.add(idKey);
      seenNames.add(nameKey);
      return true;
    })
    .sort((left, right) => String(left.name).localeCompare(String(right.name), 'vi'));
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function uniqueFilterValues(values) {
  return [...new Set(values.map((value) => String(value ?? '')))];
}

function sortFilterValues(values, key) {
  if (key === 'late') {
    return [...values].sort((left, right) => {
      const leftIndex = LATE_OPTIONS.indexOf(left);
      const rightIndex = LATE_OPTIONS.indexOf(right);
      return (leftIndex === -1 ? LATE_OPTIONS.length : leftIndex) - (rightIndex === -1 ? LATE_OPTIONS.length : rightIndex);
    });
  }
  return [...values].sort((left, right) => left.localeCompare(right, 'vi', { numeric: true }));
}

function getColumnFilterValue(item, key, freelancers = [], currentUser = {}) {
  if (key === 'paymentApproved') return isPaymentApproved(item.paymentApproved) ? 'true' : 'false';
  if (key === 'late') return normalizeLateValue(item.late);
  const value = key === 'fIld' ? getAssignedPersonName(item, freelancers, currentUser) : item[key];
  if (MONTH_FILTER_COLUMNS.has(key)) return getMonthFilterValue(value);
  return value === null || value === undefined ? '' : String(value);
}

function isPaymentApproved(value) {
  return value === true || value === 1 || ['true', '1', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function getPaymentDisplayValue(item, overrides = {}) {
  const rowKey = String(item?.seriesId) + '-' + String(item?.chapterNumber);
  return Object.prototype.hasOwnProperty.call(overrides, rowKey)
    ? overrides[rowKey]
    : isPaymentApproved(item?.paymentApproved);
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

function formatFilterValue(value, key) {
  if (value === '') return '(Trống)';
  if (key === 'paymentApproved') return value === 'true' ? 'Đã thanh toán' : 'Chưa thanh toán';
  if (MONTH_FILTER_COLUMNS.has(key)) {
    const [year, month] = value.split('-');
    return year && month ? `Tháng ${Number(month)}/${year}` : value;
  }
  return value;
}

function getColumnSortKind(key) {
  if (STRING_SORT_COLUMNS.has(key)) return 'string';
  if (NUMBER_SORT_COLUMNS.has(key)) return 'number';
  if (DATE_SORT_COLUMNS.has(key)) return 'date';
  return null;
}

function compareColumnValues(left, right, key, sortKind, direction) {
  const leftValue = key === 'fIld' ? (left.fIld ?? left.fId) : left[key];
  const rightValue = key === 'fIld' ? (right.fIld ?? right.fId) : right[key];
  let comparison = 0;
  if (sortKind === 'number') {
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    const leftMissing = leftValue === null || leftValue === undefined || String(leftValue).trim() === '' || !Number.isFinite(leftNumber);
    const rightMissing = rightValue === null || rightValue === undefined || String(rightValue).trim() === '' || !Number.isFinite(rightNumber);
    if (leftMissing && !rightMissing) comparison = 1;
    else if (!leftMissing && rightMissing) comparison = -1;
    else comparison = (leftNumber || 0) - (rightNumber || 0);
  } else if (sortKind === 'date') {
    const leftDate = new Date(leftValue).getTime();
    const rightDate = new Date(rightValue).getTime();
    const leftMissing = leftValue === null || leftValue === undefined || String(leftValue).trim() === '' || !Number.isFinite(leftDate);
    const rightMissing = rightValue === null || rightValue === undefined || String(rightValue).trim() === '' || !Number.isFinite(rightDate);
    if (leftMissing && !rightMissing) comparison = 1;
    else if (!leftMissing && rightMissing) comparison = -1;
    else comparison = (leftDate || 0) - (rightDate || 0);
  } else {
    comparison = String(leftValue ?? '').localeCompare(String(rightValue ?? ''), 'vi', { numeric: true, sensitivity: 'base' });
  }
  return direction === 'desc' ? -comparison : comparison;
}

function ColumnFilterButton({ columnKey, label, values, activeValues, sortKind, activeSortDirection, onApply, onSort }) {
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

  const visibleValues = values.filter((value) => formatFilterValue(value, columnKey).toLowerCase().includes(searchValue.trim().toLowerCase()));
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

  const clearFilter = () => {
    onApply(null);
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
              <button type="button" className={'column-filter-sort-button' + (activeSortDirection === 'asc' ? ' active' : '')} onClick={() => applySort('asc')}>
                {sortKind === 'string' || sortKind === 'date' ? 'A → Z' : 'Nhỏ → lớn'}
              </button>
              <button type="button" className={'column-filter-sort-button' + (activeSortDirection === 'desc' ? ' active' : '')} onClick={() => applySort('desc')}>
                {sortKind === 'string' || sortKind === 'date' ? 'Z → A' : 'Lớn → nhỏ'}
              </button>
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
                <span title={formatFilterValue(value, columnKey)}>{formatFilterValue(value, columnKey)}</span>
              </label>
            )) : <span className="column-filter-empty">Không có giá trị phù hợp.</span>}
          </div>
          <div className="column-filter-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={clearFilter}>Xóa lọc</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={applyFilter}>Áp dụng</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function renderValue(value, key, field, difficultyLevels, freelancers, qcs, item = {}, currentUser = {}) {
  if (key === 'statusRaw') {
    return <input className="raw-status-checkbox" type="checkbox" checked={isRawChecked(value)} readOnly disabled aria-label={`File: ${value || 'chưa hoàn thành'}`} />;
  }
  if (key === 'completionPercent' && (value === null || value === undefined || value === '')) value = 100;
  if (key === 'status') return <TaskStatusBadge value={value} />;
  if (key === 'late') return <LateControl value={value} disabled />;
  if (key === 'submittedAt') {
    return (
      <div className="submitted-at-cell">
        <span>{value ? formatDateTime(value) : 'Chưa nộp'}</span>
        <span className="task-duration">Tổng: {formatDuration(item.workDurationSeconds)}</span>
      </div>
    );
  }
  if (key === 'fIld' && item.assignedAdminId !== null && item.assignedAdminId !== undefined && item.assignedAdminId !== '') {
    return getAdminAssignmentLabel(item.assignedAdminId, currentUser);
  }
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'seriesId') return <span className="series-id-badge">{value}</span>;
  if (key === 'chapterNumber') return <span className="chapter-badge">{value}</span>;
  if (key === 'urlSeries') return /^https?:\/\//i.test(String(value))
    ? <a className="table-link" href={value} target="_blank" rel="noreferrer">Mở link</a>
    : '—';
  if (key === 'endTask') return formatDateOnly(value);
  if (key === 'price' || key === 'receivePrice') return formatMoney(value);
  if (key === 'completionPercent') {
    const num = Math.max(0, Math.min(100, Number(value) || 0));
    return (
      <div className="completion-cell-wrap">
        <span className="completion-badge">{value}%</span>
        <div className="mini-progress-track">
          <div className="mini-progress-fill" style={{ width: `${num}%` }} />
        </div>
      </div>
    );
  }
  if (key === 'fIld') return findPersonName(value, freelancers);
  if (key === 'qcId') return findPersonName(value, qcs);
  if (key === 'difficulty') {
    const configuredLevel = difficultyLevels.find((level) => level.field === field && level.difficulty === String(value));
    if (configuredLevel) {
      return <span className="difficulty-badge difficulty-custom-badge" style={{ '--difficulty-color': configuredLevel.color || '#64748B', '--difficulty-text-color': configuredLevel.textColor || '#FFFFFF' }}>{String(value)}</span>;
    }
    return <span className="difficulty-badge">{String(value)}</span>;
  }
  return String(value);
}

function findPersonName(value, people) {
  return people.find((person) => String(person.id) === String(value))?.name || String(value);
}

function getAssignedPersonName(item, freelancers, currentUser = {}) {
  if (item?.assignedAdminId !== null && item?.assignedAdminId !== undefined && item?.assignedAdminId !== '') {
    return getAdminAssignmentLabel(item.assignedAdminId, currentUser);
  }
  const freelancerId = item?.fIld ?? item?.fId;
  return freelancerId === null || freelancerId === undefined || freelancerId === ''
    ? ''
    : findPersonName(freelancerId, freelancers);
}

function getAdminAssignmentLabel(adminId, currentUser = {}) {
  const currentAdminName = currentUser?.displayName || currentUser?.name;
  return String(adminId) === String(currentUser?.id) && currentAdminName
    ? `Admin — ${currentAdminName}`
    : `Admin #${adminId}`;
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ₫` : '—';
}

function getStatusOption(value) {
  return STATUS_OPTIONS.find((option) => option.value === String(value || '').toLowerCase());
}

function getStatusDisplayValue(item, overrides = {}) {
  const rowKey = String(item?.seriesId) + '-' + String(item?.chapterNumber);
  return Object.prototype.hasOwnProperty.call(overrides, rowKey)
    ? overrides[rowKey]
    : item?.status;
}

function isDeadlineOverdue(item) {
  const dueDate = String(item?.endTask ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dueDate) return false;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dueDateKey = `${dueDate[1]}-${dueDate[2]}-${dueDate[3]}`;
  return dueDateKey < todayKey;
}

function isDoingStatus(item, statusOverrides = {}) {
  return String(getStatusDisplayValue(item, statusOverrides) ?? '').trim().toLowerCase() === 'doing';
}

function getVisibleStatusOptions(readOnly) {
  if (!readOnly) return STATUS_OPTIONS;
  return STATUS_OPTIONS.filter((option) => ['doing', 'submitted'].includes(option.value));
}

function TaskStatusBadge({ value }) {
  const option = getStatusOption(value);
  return option
    ? <span className={`task-status-badge ${option.className}`}>{option.label}</span>
    : <span className="task-status-badge task-status-pending">Chưa bắt đầu</span>;
}

function TaskStatusControl({ value, options, allowPending = true, disabled, onChange }) {
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
          {allowPending && (
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
          )}
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

function FeedbackEditor({ value, onSave }) {
  const [draft, setDraft] = useState(value ?? '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isSaving) setDraft(value ?? '');
  }, [isSaving, value]);

  const save = async () => {
    if (isSaving || String(draft ?? '') === String(value ?? '')) return;
    setIsSaving(true);
    try {
      await onSave(draft);
    } catch {
      setDraft(value ?? '');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <textarea
      className="feedback-inline-editor"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      disabled={isSaving}
      placeholder="Nhập feedback..."
      aria-label="Feedback"
    />
  );
}

function isRawChecked(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'done', 'completed', 'hoàn thành', 'đã hoàn thành', 'đã up raw'].includes(normalized);
}

const LATE_OPTIONS = ['≤0h', '1~3h', '3~6h', '6~10h', '>10h'];

function normalizeLateValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return LATE_OPTIONS[0];
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  const aliases = {
    '≤0h': '≤0h',
    '<=0h': '≤0h',
    '0h': '≤0h',
    '1-3h': '1~3h',
    '1~3h': '1~3h',
    '3-6h': '3~6h',
    '3~6h': '3~6h',
    '6-10h': '6~10h',
    '6~10h': '6~10h',
    '>10h': '>10h'
  };
  return aliases[normalized] || (LATE_OPTIONS.includes(text) ? text : LATE_OPTIONS[0]);
}

function getLateClass(value) {
  return {
    '≤0h': 'late-within',
    '1~3h': 'late-1-3',
    '3~6h': 'late-3-6',
    '6~10h': 'late-6-10',
    '>10h': 'late-over-10'
  }[normalizeLateValue(value)] || 'late-within';
}

function LateControl({ value, disabled = false, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const normalizedValue = normalizeLateValue(value);
  const selectedClassName = getLateClass(normalizedValue);

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
      const menuHeight = LATE_OPTIONS.length * 34 + 10;
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

  const selectLate = (nextValue) => {
    setIsOpen(false);
    onChange?.(nextValue);
  };

  return (
    <div ref={dropdownRef} className={`task-status-dropdown late-dropdown ${isOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        ref={triggerRef}
        className={`task-status-trigger late-trigger ${selectedClassName}`}
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled}
        aria-label="Late"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="task-status-trigger-label">
          <span className="task-status-dot" aria-hidden="true" />
          {normalizedValue}
        </span>
        <span className="task-status-chevron" aria-hidden="true">⌄</span>
      </button>
      {isOpen && menuPosition && createPortal(
        <div ref={menuRef} className="task-status-menu late-menu" style={menuPosition} role="listbox" aria-label="Chọn Late">
          {LATE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option}
              className={`task-status-option late-option ${getLateClass(option)} ${normalizedValue === option ? 'is-selected' : ''}`}
              role="option"
              aria-selected={normalizedValue === option}
              onClick={() => selectLate(option)}
            >
              <span className="task-status-dot" aria-hidden="true" />
              {option}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
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
    .map((price) => ({ id: 'price-' + price.id, difficulty: price.difficulty, color: '#64748B', textColor: '#FFFFFF' }));
}

function createNewEditState(difficultyLevels, difficultyPrices, freelancers, qcs, fieldOptions = []) {
  const type = fieldOptions[0] || '';
  const difficulty = '';
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
    assignedAdminId: '',
    difficulty,
    qcId: qcs[0]?.id ?? '',
    completionPercent: 100,
    price,
    receivePrice: calculateReceivePrice(price, 100),
    feedback: '',
    late: '≤0h'
  };
}

function createEditState(deadline, difficultyPrices) {
  return {
    seriesId: deadline.seriesId ?? '',
    chapterNumber: deadline.chapterNumber ?? '',
    endTask: toDateInput(deadline.endTask),
    seriesName: deadline.seriesName ?? '',
    type: deadline.type ?? '',
    statusRaw: deadline.statusRaw ?? '',
    status: deadline.status ?? '',
    completionPercent: deadline.completionPercent ?? 100,
    urlSeries: deadline.urlSeries ?? '',
    fIld: deadline.fIld ?? deadline.fId ?? '',
    assignedAdminId: deadline.assignedAdminId ?? '',
    difficulty: deadline.difficulty ?? '',
    qcId: deadline.qcId ?? '',
    price: deadline.price ?? getConfiguredPrice(deadline.type, deadline.difficulty, difficultyPrices) ?? '',
    receivePrice: calculateReceivePrice(deadline.price ?? getConfiguredPrice(deadline.type, deadline.difficulty, difficultyPrices), deadline.completionPercent ?? 100),
    feedback: deadline.feedback ?? '',
    late: normalizeLateValue(deadline.late)
  };
}

function toApiValue(key, value) {
  if (value === '') return null;
  if (DATE_FIELDS.has(key)) return value;
  if (NUMERIC_FIELDS.has(key)) return Number(value);
  return value;
}

function toDateInput(value) {
  if (!value) return '';
  const text = String(value).trim();
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateOnly(value) {
  const text = String(value ?? '').trim();
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('vi-VN');
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

function DeadlineEditModal({ value, isCreate, freelancers, qcs, difficultyLevels, difficultyPrices, fieldOptions = [], statusOptions, currentUser = {}, isSaving, onChange, onClose, onSubmit }) {
  const difficultyOptions = getDifficultyOptions(value.type, difficultyLevels, difficultyPrices);
  const assignmentValue = value.assignedAdminId ? `admin:${value.assignedAdminId}` : (value.fIld ?? '');
  return createPortal(
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <form className="modal-content modal-lg deadline-edit-modal" onSubmit={onSubmit} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="deadline-edit-modal-title">
        <div className="modal-header">
          <div>
            <span className="qc-kicker">{isCreate ? 'ADMIN CREATOR' : 'QC EDITOR'}</span>
            <div className="modal-title" id="deadline-edit-modal-title">{isCreate ? 'Thêm deadline' : 'Chỉnh sửa deadline'}</div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={isSaving} title="Đóng">
            <IconX size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="deadline-edit-note">
            {isCreate ? 'Chọn Freelancer, Admin hoặc QC từ danh sách lấy trực tiếp trong database.' : 'ID bộ truyện và Chapter là khóa liên kết nên không thể chỉnh sửa.'}
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
                    value={assignmentValue}
                    onChange={(event) => {
                      const selectedValue = event.target.value;
                      if (selectedValue.startsWith('admin:')) {
                        onChange(key, '');
                        onChange(ASSIGNMENT_FIELD, selectedValue.slice('admin:'.length));
                      } else {
                        onChange(ASSIGNMENT_FIELD, '');
                        onChange(key, selectedValue);
                      }
                    }}
                    disabled={isSaving}
                  >
                    <option value="">Chưa phân công</option>
                    {freelancers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                    {currentUser.role === 'Admin' && currentUser.id !== null && currentUser.id !== undefined && currentUser.id !== '' && (
                      <option value={`admin:${currentUser.id}`}>Tôi — {currentUser.displayName || currentUser.name || 'Admin'}</option>
                    )}
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
                ) : type === 'late-select' ? (
                  <LateControl
                    value={value[key]}
                    onChange={(nextValue) => onChange(key, nextValue)}
                    disabled={isSaving}
                  />
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
    </div>,
    document.body
  );
}
