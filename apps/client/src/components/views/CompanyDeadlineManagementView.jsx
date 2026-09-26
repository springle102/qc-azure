import React, { useMemo, useState } from 'react';
import { IconRefresh, IconSearch, IconTasks } from '../common/Icons';

const columns = [
  ['seriesId', 'seriesId'],
  ['chapterNumber', 'chapterNumber'],
  ['endTaskReal', 'endTaskReal'],
  ['statusRaw', 'statusRaw'],
  ['dateUpRaw', 'dateUpRaw'],
  ['statusCheckRaw', 'statusCheckRaw'],
  ['deadlineSubmitted', 'deadlineSubmitted']
];

export function CompanyDeadlineManagementView({ companyDeadlines = [], isLoading, onRefresh }) {
  const [seriesId, setSeriesId] = useState('');
  const [status, setStatus] = useState('');
  const [checkStatus, setCheckStatus] = useState('');
  const [search, setSearch] = useState('');

  const options = useMemo(() => ({
    series: unique(companyDeadlines.map((item) => item.seriesId)),
    statuses: unique(companyDeadlines.map((item) => item.statusRaw))
  }), [companyDeadlines]);

  const filteredDeadlines = useMemo(() => companyDeadlines.filter((item) => {
    const text = Object.values(item).join(' ').toLowerCase();
    const itemSeriesId = String(item.seriesId ?? '');
    const itemStatus = String(item.statusRaw ?? '');
    const itemCheckStatus = normalizeCheckStatus(item.statusCheckRaw);

    return (!seriesId || itemSeriesId === seriesId)
      && (!status || itemStatus === status)
      && (!checkStatus || itemCheckStatus === checkStatus)
      && (!search.trim() || text.includes(search.trim().toLowerCase()));
  }), [checkStatus, companyDeadlines, search, seriesId, status]);

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">CÔNG TY</span>
          <h2 className="page-title">Deadline công ty</h2>
          <p className="page-subtitle">Bảng dữ liệu Companies — hiển thị đúng các trường trong database diagram.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
          <IconRefresh size={16} /> {isLoading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      <section className="glass-panel qc-table-panel">
        <div className="table-toolbar deadline-toolbar">
          <div className="toolbar-search">
            <IconSearch size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm trong deadline công ty"
            />
          </div>

          <select className="form-select toolbar-filter" value={seriesId} onChange={(event) => setSeriesId(event.target.value)}>
            <option value="">Tất cả ID bộ truyện</option>
            {options.series.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>

          <select className="form-select toolbar-filter" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Tất cả trạng thái raw</option>
            {options.statuses.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>

          <select className="form-select toolbar-filter" value={checkStatus} onChange={(event) => setCheckStatus(event.target.value)}>
            <option value="">Tất cả trạng thái kiểm tra</option>
            <option value="true">Đã kiểm tra</option>
            <option value="false">Chưa kiểm tra</option>
          </select>
        </div>

        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table deadline-table company-deadline-table">
            <thead>
              <tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {filteredDeadlines.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <div className="empty-state table-empty">
                      <IconTasks size={24} />
                      <strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có deadline công ty trong hệ thống.'}</strong>
                    </div>
                  </td>
                </tr>
              ) : filteredDeadlines.map((item, index) => (
                <tr key={`${item.seriesId ?? 'series'}-${item.chapterNumber ?? index}`}>
                  {columns.map(([key]) => <td key={key}>{renderValue(item[key], key)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== '').map(String))];
}

function normalizeCheckStatus(value) {
  if (value === true || ['true', '1', 'yes', 'checked', 'đã kiểm tra'].includes(String(value).trim().toLowerCase())) return 'true';
  if (value === false || ['false', '0', 'no', 'unchecked', 'chưa kiểm tra'].includes(String(value).trim().toLowerCase())) return 'false';
  return '';
}

function renderValue(value, key) {
  if (value === null || value === undefined || value === '') return '—';
  if (['endTaskReal', 'deadlineSubmitted', 'dateUpRaw'].includes(key)) return formatDate(value, key === 'endTaskReal');
  return String(value);
}

function formatDate(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('vi-VN', includeTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' });
}
