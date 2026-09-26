import React, { useState } from 'react';
import { IconLock, IconUser } from '../common/Icons';

export function LoginView({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await onLogin({ username, password });
    } catch (requestError) {
      setError(requestError.message || 'Không thể đăng nhập.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = (event) => {
    event.preventDefault();
    setForgotMessage('Yêu cầu đã được ghi nhận. Vui lòng liên hệ Admin để xác minh và cấp lại mật khẩu.');
  };

  const openForgotPassword = () => {
    setError('');
    setForgotMessage('');
    setIsForgotPassword(true);
  };

  const returnToLogin = () => {
    setForgotMessage('');
    setIsForgotPassword(false);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card glass-panel">
        <div className="auth-brand">
          <div className="qc-sidebar-mark">Q</div>
          <div>
            <strong>QC WEBTOON</strong>
            <span>DEADLINE MANAGEMENT</span>
          </div>
        </div>
        {isForgotPassword ? (
          <>
            <span className="qc-kicker">KHÔI PHỤC MẬT KHẨU</span>
            <h1>Quên mật khẩu?</h1>
            <p className="auth-help">Nhập username để gửi yêu cầu cấp lại mật khẩu.</p>
            <form onSubmit={handleForgotPassword}>
              <div className="form-group">
                <label className="form-label" htmlFor="forgot-username"><IconUser size={15} /> Username</label>
                <input id="forgot-username" className="form-input" value={forgotUsername} onChange={(event) => setForgotUsername(event.target.value)} placeholder="Nhập username của bạn..." autoComplete="username" required />
              </div>
              <button type="submit" className="btn btn-primary auth-submit">Gửi yêu cầu</button>
            </form>
            {forgotMessage && <div className="auth-success" role="status">{forgotMessage}</div>}
            <button type="button" className="auth-link" onClick={returnToLogin}>Quay lại đăng nhập</button>
          </>
        ) : (
          <>
            <span className="qc-kicker">ĐĂNG NHẬP</span>
            <h1>Chào mừng trở lại</h1>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="login-username"><IconUser size={15} /> Username</label>
                <input id="login-username" className="form-input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="Nhập username của bạn..." required />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="login-password"><IconLock size={15} /> Password</label>
                <input id="login-password" className="form-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Nhập mật khẩu của bạn..." required />
              </div>
              {error && <div className="auth-error" role="alert">{error}</div>}
              <button type="submit" className="btn btn-primary auth-submit" disabled={isSubmitting}>
                {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
              </button>
            </form>
            <button type="button" className="auth-link" onClick={openForgotPassword}>Quên mật khẩu?</button>
          </>
        )}
      </div>
    </div>
  );
}
