import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { showToast } from '../common/ToastContainer';

const MILESTONES = { '24h': 'Trước 1 ngày', '6h': 'Trước 6 tiếng', '3h': 'Trước 3 tiếng', overdue: 'Quá hạn' };
const STATUSES = { pending: 'Chờ gửi', processing: 'Đang xử lý', retry: 'Chờ thử lại', sent: 'Đã tiếp nhận', failed: 'Gửi thất bại', skipped: 'Bỏ qua', cancelled: 'Đã hủy', needs_review: 'Cần kiểm tra' };
const dateLabel = (value) => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '—';

export function TaskRemindersPanel({ generalSettings, onRefresh }) {
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState({ items: [], total: 0 });
  const [error, setError] = useState('');
  const [loadedPage, setLoadedPage] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const enabled = generalSettings?.taskRemindersEnabled === true;
  const configuration = generalSettings?.taskReminderConfiguration;
  const pageKey = `${offset}:${revision}`;
  const loading = loadedPage !== pageKey;

  useEffect(() => {
    let active = true;
    api.getTaskReminders({ limit: 50, offset }).then((result) => {
      if (active) { setHistory(result); setError(''); }
    }).catch((failure) => {
      if (active) setError(failure.message);
    }).finally(() => { if (active) setLoadedPage(`${offset}:${revision}`); });
    return () => { active = false; };
  }, [offset, revision]);

  const toggle = async () => {
    setSaving(true);
    try {
      await api.updateGeneralSettings({ taskRemindersEnabled: !enabled });
      showToast(enabled ? 'Đã tắt nhắc task qua mail.' : 'Đã bật nhắc task qua mail.', 'success');
      await onRefresh?.();
      setRevision((current) => current + 1);
    } catch (failure) { showToast(failure.message, 'error'); } finally { setSaving(false); }
  };

  return (
    <section className="glass-panel qc-table-panel task-reminders-panel">
      <div className="section-heading">
        <div><span className="qc-kicker">NHẮC DEADLINE</span><h3>Nhắc freelancer nộp task qua mail</h3></div>
        <div className="task-reminder-toggle">
          <button type="button" className="task-reminder-switch" role="switch" aria-label="Nhắc task qua mail" aria-checked={enabled} aria-busy={saving} disabled={saving || !generalSettings || (!enabled && !configuration?.ready)} onClick={toggle}>
            <span className="task-reminder-switch-track" aria-hidden="true"><span className="task-reminder-switch-thumb" /></span>
          </button>
          <span className="task-reminder-toggle-state" aria-live="polite">{saving ? 'Đang lưu...' : enabled ? 'ON' : 'OFF'}</span>
        </div>
      </div>
      {configuration?.message && <p role="alert" className="task-reminder-error">{configuration.message}</p>}
      <div className="section-heading">
        <h4>Lịch sử nhắc mail</h4>
        <button type="button" className="btn btn-outline btn-sm" disabled={loading} onClick={() => setRevision((current) => current + 1)}>Làm mới lịch sử</button>
      </div>
      {!loading && error ? <p role="alert" className="task-reminder-error">{error}</p> : (
        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table task-reminder-table">
            <thead><tr><th>Task</th><th>Email nhận</th><th>Hạn nộp</th><th>Mốc nhắc</th><th>Trạng thái</th><th>Lần thử</th><th>Gửi lúc</th><th>Chi tiết</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={8}>Đang tải lịch sử...</td></tr> : history.items.length === 0 ? <tr><td colSpan={8}>Chưa có lịch sử nhắc mail.</td></tr> : history.items.map((item) => (
                <tr key={item.deliveryKey}>
                  <td>{item.seriesId} — Chapter {item.chapterNumber}</td><td>{item.email || 'Chưa có email'}</td><td>{dateLabel(item.dueAt)}</td>
                  <td>{MILESTONES[item.milestone]}</td><td>{item.status === 'sent' ? `${item.provider === 'gmail' ? 'Gmail' : 'Resend'} đã tiếp nhận` : STATUSES[item.status] || item.status}</td><td>{item.attemptCount}</td><td>{dateLabel(item.sentAt)}</td>
                  <td className="task-reminder-details">{item.lastError || '—'}{item.providerMessageId && <small className="form-help task-reminder-message-id">Mã mail: {item.providerMessageId}</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="task-reminder-pagination">
        <span>{history.total} bản ghi · Trang {Math.floor(offset / 50) + 1}</span>
        <button type="button" className="btn btn-outline btn-sm" disabled={loading || offset === 0} onClick={() => setOffset((current) => Math.max(0, current - 50))}>Trước</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={loading || offset + 50 >= history.total} onClick={() => setOffset((current) => current + 50)}>Sau</button>
      </div>
    </section>
  );
}
