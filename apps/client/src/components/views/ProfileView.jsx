import React, { useEffect, useState } from 'react';
import { IconCamera, IconLock, IconTrash, IconUpload, IconUser } from '../common/Icons';

export function ProfileView({ currentUser = {}, onSaveProfile }) {
  const [name, setName] = useState(currentUser.name || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [avatar, setAvatar] = useState(currentUser.avatar || '');
  const [imageQR, setImageQR] = useState(currentUser.imageQR || '');
  const [qrError, setQrError] = useState('');
  const [isSavingQR, setIsSavingQR] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    setName(currentUser.name || '');
    setEmail(currentUser.email || '');
    setAvatar(currentUser.avatar || '');
    setImageQR(currentUser.imageQR || '');
  }, [currentUser]);

  const handleAvatar = (event) => {
    const file = event.target.files?.[0];
    if (file) setAvatar(URL.createObjectURL(file));
  };

  const handleQRUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setQrError('');
    if (!file.type.startsWith('image/')) {
      setQrError('Vui lòng chọn một file hình ảnh.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setQrError('Ảnh mã QR không được vượt quá 3 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setImageQR(String(reader.result || ''));
    reader.onerror = () => setQrError('Không thể đọc file mã QR.');
    reader.readAsDataURL(file);
  };

  const saveQR = async () => {
    setIsSavingQR(true);
    try {
      await onSaveProfile({ imageQR });
      setQrError('');
    } finally {
      setIsSavingQR(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSaveProfile({ name, email, avatar });
  };

  const handlePassword = (event) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) return;
    onSaveProfile({ password: newPassword });
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="fade-in profile-page">
      <div className="page-header-row qc-page-heading">
        <div>
          <span className="qc-kicker">TÀI KHOẢN</span>
          <h2 className="page-title">Hồ sơ cá nhân</h2>
          <p className="page-subtitle">Cập nhật thông tin tài khoản {currentUser.role || ''}.</p>
        </div>
      </div>

      <div className="profile-grid">
        <section className="glass-panel profile-avatar-card">
          <div className="profile-avatar-large">
            {avatar ? <img src={avatar} alt="Ảnh đại diện" /> : <IconUser size={38} />}
          </div>
          <label className="btn btn-secondary btn-sm profile-upload-button">
            <IconCamera size={16} /> Tải ảnh đại diện
            <input type="file" accept="image/*" onChange={handleAvatar} hidden />
          </label>
          <span className="profile-role">{currentUser.role || '—'}</span>
        </section>

        <section className="glass-panel profile-form-card">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Họ và tên</label>
              <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nhập họ và tên" />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Nhập email" />
            </div>
            <button type="submit" className="btn btn-primary">Lưu thông tin</button>
          </form>
        </section>

        {currentUser.freelancerId && (
          <section className="glass-panel profile-qr-card">
            <div className="section-heading">
              <div><span className="qc-kicker">THANH TOÁN</span><h3><IconUpload size={18} /> Mã QR nhận lương</h3></div>
            </div>
            <div className="profile-qr-layout">
              <div className="profile-qr-preview">
                {imageQR ? <img src={imageQR} alt="Mã QR nhận lương" /> : <IconCamera size={32} />}
              </div>
              <div className="profile-qr-actions">
                <p className="form-help">Mã QR này sẽ hiển thị trong bảng Lương của freelancer.</p>
                <label className="btn btn-secondary btn-sm profile-upload-button">
                  <IconUpload size={15} /> Chọn ảnh QR
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleQRUpload} hidden />
                </label>
                {imageQR && <button type="button" className="btn btn-outline btn-sm" onClick={() => setImageQR('')} disabled={isSavingQR}><IconTrash size={14} /> Xóa ảnh</button>}
                <button type="button" className="btn btn-primary btn-sm" onClick={saveQR} disabled={isSavingQR}>
                  {isSavingQR ? 'Đang lưu...' : 'Lưu mã QR'}
                </button>
                {qrError && <span className="profile-qr-error" role="alert">{qrError}</span>}
              </div>
            </div>
          </section>
        )}

        <section className="glass-panel profile-password-card">
          <div className="section-heading">
            <div><span className="qc-kicker">BẢO MẬT</span><h3><IconLock size={18} /> Đổi mật khẩu</h3></div>
          </div>
          <form onSubmit={handlePassword}>
            <div className="form-group">
              <label className="form-label">Mật khẩu mới</label>
              <input className="form-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nhập mật khẩu mới" />
            </div>
            <div className="form-group">
              <label className="form-label">Xác nhận mật khẩu mới</label>
              <input className="form-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Nhập lại mật khẩu mới" />
            </div>
            <button type="submit" className="btn btn-secondary">Cập nhật mật khẩu</button>
          </form>
        </section>
      </div>
    </div>
  );
}
