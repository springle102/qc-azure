import React, { useMemo, useState } from 'react';
import { IconRefresh, IconSearch, IconTasks } from '../common/Icons';

const columns = [
  ['seriesId', 'ID bộ truyện'],
  ['chapterNumber', 'Chapter'],
  ['seriesName', 'Tên bộ truyện'],
  ['type', 'Mảng'],
  ['statusRaw', 'Trạng thái raw'],
  ['urlSeries', 'URL bộ truyện'],
  ['fIld', 'Freelancer ID'],
  ['qcId', 'QC ID'],
  ['difficulty', 'Độ khó'],
  ['price', 'Giá'],
  ['receivePrice', 'Tiền nhận'],
  ['feedback', 'Feedback'],
  ['task', 'Task'],
  ['startTask', 'Bắt đầu'],
  ['endTask', 'Kết thúc']
];

export function DeadlineManagementView({ deadlines = [], isLoading, onRefresh }) {
  const [seriesId, setSeriesId] = useState('');
  const [freelancer, setFreelancer] = useState('');
  const [qc, setQc] = useState('');
  const [search, setSearch] = useState('');

  const options = useMemo(() => ({
    series: unique(deadlines.map((item) => item.seriesId)),
    freelancers: unique(deadlines.map((item) => item.freelancerName || item.fId || item.fIld)),
    qcs: unique(deadlines.map((item) => item.qcName || item.qcId))
  }), [deadlines]);

  const filteredDeadlines = useMemo(() => deadlines.filter((item) => {
    const text = Object.values(item).join(' ').toLowerCase();
    return (!seriesId || String(item.seriesId || '') === seriesId)
      && (!freelancer || String(item.freelancerName || item.fId || item.fIld || '') === freelancer)
      && (!qc || String(item.qcName || item.qcId || '') === qc)
      && (!search.trim() || text.includes(search.trim().toLowerCase()));
  }), [deadlines, freelancer, qc, search, seriesId]);

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">TIẾN ĐỘ</span>
          <h2 className="page-title">Quản lý deadline</h2>
          <p className="page-subtitle">Lọc và theo dõi các trường trong bảng SeriesList.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
          <IconRefresh size={16} /> Làm mới
        </button>
      </div>

      <section className="glass-panel qc-table-panel">
        <div className="table-toolbar deadline-toolbar">
          <div className="toolbar-search">
            <IconSearch size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm trong deadline" />
          </div>
          <select className="form-select toolbar-filter" value={seriesId} onChange={(event) => setSeriesId(event.target.value)}>
            <option value="">Tất cả ID bộ truyện</option>
            {options.series.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="form-select toolbar-filter" value={freelancer} onChange={(event) => setFreelancer(event.target.value)}>
            <option value="">Tất cả freelancer</option>
            {options.freelancers.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="form-select toolbar-filter" value={qc} onChange={(event) => setQc(event.target.value)}>
            <option value="">Tất cả QC</option>
            {options.qcs.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>

        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table deadline-table">
            <thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>
              {filteredDeadlines.length === 0 ? (
                <tr><td colSpan={columns.length}><div className="empty-state table-empty"><IconTasks size={24} /><strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có deadline trong hệ thống.'}</strong></div></td></tr>
              ) : filteredDeadlines.map((item, index) => (
                <tr key={`${item.seriesId || 'series'}-${item.chapterNumber || index}`}>
                  {columns.map(([key]) => <td key={key}>{renderValue(key === 'fIld' ? (item.fIld || item.fId) : item[key], key)}</td>)}
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
  return [...new Set(values.filter(Boolean).map(String))];
}

function renderValue(value, key) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'urlSeries' && String(value).startsWith('http')) return <a className="table-link" href={value} target="_blank" rel="noreferrer">Mở link</a>;
  if (['startTask', 'endTask'].includes(key)) return formatDateTime(value);
  return String(value);
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN');
}
