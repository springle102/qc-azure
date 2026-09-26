import React from 'react';
import { IconAlertTriangle, IconRefresh } from '../common/Icons';

const columns = [
  ['errorId', 'errorId'],
  ['seriesId', 'seriesId'],
  ['chapterNumber', 'chapterNumber'],
  ['imageError', 'imageError'],
  ['detailError', 'detailError'],
  ['noteQC', 'noteQC'],
  ['fIld', 'fIld'],
  ['qcId', 'qcId'],
  ['statusCheck', 'statusCheck']
];

export function ErrorManagementView({ errors = [], isLoading, onRefresh }) {
  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">CHẤT LƯỢNG</span>
          <h2 className="page-title">Quản lý lỗi</h2>
          <p className="page-subtitle">Theo dõi lỗi theo cấu trúc bảng Error trong database diagram.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
          <IconRefresh size={16} /> Làm mới
        </button>
      </div>

      <section className="glass-panel qc-table-panel">
        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table error-table">
            <thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>
              {errors.length === 0 ? (
                <tr><td colSpan={columns.length}><div className="empty-state table-empty"><IconAlertTriangle size={24} /><strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có lỗi QC trong hệ thống.'}</strong></div></td></tr>
              ) : errors.map((error, index) => (
                <tr key={error.errorId || error.id || index}>
                  {columns.map(([key]) => <td key={key}>{renderErrorValue(key === 'fIld' ? (error.fIld || error.fId) : error[key], key)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function renderErrorValue(value, key) {
  if (!value) return '—';
  if (key === 'imageError' && String(value).startsWith('http')) return <a className="table-link" href={value} target="_blank" rel="noreferrer">Xem ảnh</a>;
  return String(value);
}
