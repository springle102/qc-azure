import React, { useState } from 'react';
import { IconEye, IconQRCode, IconRefresh } from '../common/Icons';

export function QRManagementView({ qrcodes = [], isLoading, onRefresh }) {
  const [selectedQR, setSelectedQR] = useState(null);

  return (
    <div className="fade-in">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">MÃ QR</span>
          <h2 className="page-title">Quản lý QR</h2>
          <p className="page-subtitle">Danh sách mã QR do QC và freelancer cập nhật.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={isLoading}>
          <IconRefresh size={16} /> Làm mới
        </button>
      </div>

      <section className="glass-panel qc-table-panel">
        <div className="table-wrapper table-wrapper-flat">
          <table className="custom-table">
            <thead>
              <tr><th>ID QC / Freelancer</th><th>Họ và tên</th><th>Mã QR</th></tr>
            </thead>
            <tbody>
              {qrcodes.length === 0 ? (
                <tr><td colSpan="3"><div className="empty-state table-empty"><IconQRCode size={24} /><strong>{isLoading ? 'Đang tải dữ liệu...' : 'Chưa có mã QR được tải lên.'}</strong></div></td></tr>
              ) : qrcodes.map((qr, index) => (
                <tr key={qr.id || `${qr.qcId}-${qr.fId}-${index}`}>
                  <td className="mono-cell">{qr.qcId || qr.qcld || '—'} / {qr.fId || qr.fIld || qr.freelancerId || '—'}</td>
                  <td className="strong-cell">{qr.name || qr.freelancerName || qr.qcName || '—'}</td>
                  <td>
                    {qr.imageQR || qr.qrUrl || qr.url ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedQR(qr)}>
                        <IconEye size={15} /> Hiển thị QR
                      </button>
                    ) : 'Chưa có mã QR'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedQR && (
        <div className="modal-overlay" onClick={() => setSelectedQR(null)}>
          <div className="modal-content qr-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">Mã QR</span><button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedQR(null)}>Đóng</button></div>
            <div className="modal-body qr-preview-body">
              <img src={selectedQR.imageQR || selectedQR.qrUrl || selectedQR.url} alt="Mã QR" />
              <span>{selectedQR.name || selectedQR.freelancerName || selectedQR.qcName || 'Chưa có tên'}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
