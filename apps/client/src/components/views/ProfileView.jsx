import React, { useEffect, useState } from 'react';
import { IconCamera, IconLock, IconUser } from '../common/Icons';

export function ProfileView({ currentUser = {}, onSaveProfile }) {
  const [name, setName] = useState(currentUser.name || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [avatar, setAvatar] = useState(currentUser.avatar || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    setName(currentUser.name || '');
    setEmail(currentUser.email || '');
    setAvatar(currentUser.avatar || '');
  }, [currentUser]);

  const handleAvatar = (event) => {
    const file = event.target.files?.[0];
    if (file) setAvatar(URL.createObjectURL(file));
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
          <p className="page-subtitle">Cập nhật thông tin tài khoản QC.</p>
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
          <span className="profile-role">QC</span>
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
