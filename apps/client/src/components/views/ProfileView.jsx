import React, { useEffect, useState } from 'react';
import { IconCamera, IconLock, IconTrash, IconUpload, IconUser } from '../common/Icons';
import { extractQrImage, extractSavedQrImage } from '../../utils/qrImage.mjs';

export function ProfileView({ currentUser = {}, onSaveProfile }) {
  const isNameLocked = currentUser.role === 'Freelancer';
  const [name, setName] = useState(currentUser.name || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [avatar, setAvatar] = useState(currentUser.avatar || '');
  const [imageQR, setImageQR] = useState(currentUser.imageQR || '');
  const [avatarError, setAvatarError] = useState('');
  const [qrError, setQrError] = useState('');
  const [isProcessingQR, setIsProcessingQR] = useState(false);
  const [isSavingQR, setIsSavingQR] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    setName(currentUser.name || '');
    setEmail(currentUser.email || '');
    setAvatar(currentUser.avatar || '');
    setImageQR(currentUser.imageQR || '');
  }, [currentUser]);

  useEffect(() => {
    const source = String(currentUser.imageQR || '').trim();
    const freelancerKey = String(currentUser.freelancerId || '').trim();
    if (!source || !freelancerKey || source.includes('/qr-cropped-v2-')) {
      setIsProcessingQR(false);
      return undefined;
    }
    let cancelled = false;
    const migrateLegacyQr = async () => {
      setIsProcessingQR(true);
      try {
        const extractedQr = await extractSavedQrImage(source);
        if (cancelled) return;
        setImageQR(extractedQr);
        const savedUser = await onSaveProfile({ imageQR: extractedQr }, { silent: true });
        if (!savedUser && !cancelled) throw new Error('Không thể tự động lưu ảnh QR đã cắt.');
      } catch (error) {
        if (!cancelled) setQrError(error instanceof Error ? error.message : 'Không thể tự động cắt lại mã QR cũ.');
      } finally {
        if (!cancelled) setIsProcessingQR(false);
      }
    };

    migrateLegacyQr();
    return () => {
      cancelled = true;
    };
  }, [currentUser.freelancerId, currentUser.imageQR, onSaveProfile]);

  const handleAvatar = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarError('');
    if (!file.type.startsWith('image/')) {
      setAvatarError('Vui lòng chọn một file hình ảnh.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setAvatarError('Ảnh đại diện không được vượt quá 3 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result || ''));
    reader.onerror = () => setAvatarError('Không thể đọc file ảnh đại diện.');
    reader.readAsDataURL(file);
  };

  const handleQRUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setQrError('');
    if (!file.type.startsWith('image/')) {
      setQrError('Vui lòng chọn một file hình ảnh.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setQrError('Ảnh mã QR không được vượt quá 3 MB.');
      return;
    }

    setIsProcessingQR(true);
    try {
      const extractedQr = await extractQrImage(file);
      setImageQR(extractedQr);
    } catch (error) {
      setImageQR('');
      setQrError(error instanceof Error ? error.message : 'Không thể tách mã QR khỏi ảnh.');
    } finally {
      setIsProcessingQR(false);
    }
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
    onSaveProfile({ ...(!isNameLocked ? { name } : {}), email, avatar });
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
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleAvatar} hidden />
          </label>
          {avatar && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setAvatar(''); setAvatarError(''); }}>Xóa ảnh</button>}
          {avatarError && <span className="profile-qr-error" role="alert">{avatarError}</span>}
          <span className="profile-role">{currentUser.role || '—'}</span>
        </section>

        <section className="glass-panel profile-form-card">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="profile-name">Họ và tên</label>
              <input id="profile-name" className="form-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nhập họ và tên" disabled={isNameLocked} aria-describedby={isNameLocked ? 'profile-name-help' : undefined} />
              {isNameLocked && <p id="profile-name-help" className="form-help">Liên hệ Admin hoặc QC để thay đổi họ và tên.</p>}
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
                <label className={`btn btn-secondary btn-sm profile-upload-button${isProcessingQR ? ' disabled' : ''}`}>
                  <IconUpload size={15} /> {isProcessingQR ? 'Đang tách QR...' : 'Chọn ảnh QR'}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleQRUpload} disabled={isProcessingQR || isSavingQR} hidden />
                </label>
                {imageQR && <button type="button" className="btn btn-outline btn-sm" onClick={() => setImageQR('')} disabled={isProcessingQR || isSavingQR}><IconTrash size={14} /> Xóa ảnh</button>}
                <button type="button" className="btn btn-primary btn-sm" onClick={saveQR} disabled={isProcessingQR || isSavingQR}>
                  {isSavingQR ? 'Đang lưu...' : isProcessingQR ? 'Đang xử lý...' : 'Lưu mã QR'}
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
