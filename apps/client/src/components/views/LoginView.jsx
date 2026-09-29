import React, { useState } from 'react';
import { IconLock, IconUser } from '../common/Icons';
import { api } from '../../services/api';

export function LoginView({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [forgotStep, setForgotStep] = useState('username');
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotChallengeId, setForgotChallengeId] = useState('');
  const [forgotResetToken, setForgotResetToken] = useState('');
  const [forgotMaskedEmail, setForgotMaskedEmail] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoginMessage('');
    setIsSubmitting(true);
    try {
      await onLogin({ username, password });
    } catch (requestError) {
      setError(requestError.message || 'Không thể đăng nhập.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestOtp = async (event) => {
    event.preventDefault();
    setForgotError('');
    setForgotMessage('');
    setIsForgotSubmitting(true);
    try {
      const result = await api.requestPasswordResetOtp(forgotUsername);
      setForgotChallengeId(result.challengeId);
      setForgotMaskedEmail(result.maskedEmail || 'email đã đăng ký');
      setForgotMessage(`Mã OTP đã được gửi tới ${result.maskedEmail || 'email đã đăng ký'}. Mã có hiệu lực trong 10 phút.`);
      setForgotStep('otp');
    } catch (requestError) {
      setForgotError(requestError.message || 'Không thể gửi mã OTP.');
    } finally {
      setIsForgotSubmitting(false);
    }
  };

  const handleVerifyOtp = async (event) => {
    event.preventDefault();
    setForgotError('');
    setForgotMessage('');
    setIsForgotSubmitting(true);
    try {
      const result = await api.verifyPasswordResetOtp({ challengeId: forgotChallengeId, otp: forgotOtp });
      setForgotResetToken(result.resetToken);
      setForgotStep('password');
      setForgotMessage('OTP chính xác. Hãy đặt mật khẩu mới cho tài khoản.');
    } catch (requestError) {
      setForgotError(requestError.message || 'Mã OTP không đúng.');
    } finally {
      setIsForgotSubmitting(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('Mật khẩu nhập lại không khớp.');
      return;
    }
    setForgotError('');
    setForgotMessage('');
    setIsForgotSubmitting(true);
    try {
      await api.resetPassword({ resetToken: forgotResetToken, password: forgotNewPassword });
      setUsername(forgotUsername);
      setPassword('');
      setLoginMessage('Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.');
      returnToLogin();
    } catch (requestError) {
      setForgotError(requestError.message || 'Không thể đặt lại mật khẩu.');
    } finally {
      setIsForgotSubmitting(false);
    }
  };

  const openForgotPassword = () => {
    setError('');
    setLoginMessage('');
    setForgotStep('username');
    setForgotUsername(username);
    setForgotOtp('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotChallengeId('');
    setForgotResetToken('');
    setForgotMaskedEmail('');
    setForgotMessage('');
    setForgotError('');
    setIsForgotPassword(true);
  };

  const returnToLogin = () => {
    setForgotMessage('');
    setForgotError('');
    setIsForgotPassword(false);
    setForgotStep('username');
    setForgotOtp('');
    setForgotNewPassword('');
    setForgotConfirmPassword('');
    setForgotChallengeId('');
    setForgotResetToken('');
    setForgotMaskedEmail('');
  };

  return (
    <div className="auth-screen">
      <div className="auth-card glass-panel">
        <div className="auth-brand">
          <div className="qc-sidebar-mark"><img src="/favicon.svg" alt="" aria-hidden="true" /></div>
          <div>
            <strong>WZ System</strong>
            <span>DEADLINE MANAGEMENT</span>
          </div>
        </div>
        {isForgotPassword ? (
          <>
            <span className="qc-kicker">KHÔI PHỤC MẬT KHẨU</span>
            <h1>Quên mật khẩu?</h1>
            {forgotStep === 'username' && (
              <>
                <p className="auth-help">Nhập username để hệ thống gửi mã OTP tới email đã đăng ký.</p>
                <form onSubmit={handleRequestOtp}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="forgot-username"><IconUser size={15} /> Username</label>
                    <input id="forgot-username" className="form-input" value={forgotUsername} onChange={(event) => setForgotUsername(event.target.value)} placeholder="Nhập username của bạn..." autoComplete="username" required disabled={isForgotSubmitting} />
                  </div>
                  {forgotError && <div className="auth-error" role="alert">{forgotError}</div>}
                  <button type="submit" className="btn btn-primary auth-submit" disabled={isForgotSubmitting}>{isForgotSubmitting ? 'Đang gửi OTP...' : 'Gửi mã OTP'}</button>
                </form>
              </>
            )}
            {forgotStep === 'otp' && (
              <>
                <p className="auth-help">Nhập mã 6 chữ số đã gửi tới {forgotMaskedEmail}.</p>
                <form onSubmit={handleVerifyOtp}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="forgot-otp">Mã OTP</label>
                    <input id="forgot-otp" className="form-input" value={forgotOtp} onChange={(event) => setForgotOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="Nhập 6 chữ số" maxLength="6" required disabled={isForgotSubmitting} />
                  </div>
                  {forgotError && <div className="auth-error" role="alert">{forgotError}</div>}
                  {forgotMessage && <div className="auth-success" role="status">{forgotMessage}</div>}
                  <button type="submit" className="btn btn-primary auth-submit" disabled={isForgotSubmitting}>{isForgotSubmitting ? 'Đang xác nhận...' : 'Xác nhận OTP'}</button>
                </form>
                <button type="button" className="auth-link" onClick={() => { setForgotStep('username'); setForgotError(''); setForgotMessage(''); }} disabled={isForgotSubmitting}>Đổi username</button>
              </>
            )}
            {forgotStep === 'password' && (
              <>
                <p className="auth-help">OTP chính xác. Nhập mật khẩu mới, tối thiểu 6 ký tự.</p>
                <form onSubmit={handleResetPassword}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="forgot-new-password"><IconLock size={15} /> Mật khẩu mới</label>
                    <input id="forgot-new-password" className="form-input" type="password" value={forgotNewPassword} onChange={(event) => setForgotNewPassword(event.target.value)} autoComplete="new-password" minLength="6" required disabled={isForgotSubmitting} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="forgot-confirm-password"><IconLock size={15} /> Nhập lại mật khẩu</label>
                    <input id="forgot-confirm-password" className="form-input" type="password" value={forgotConfirmPassword} onChange={(event) => setForgotConfirmPassword(event.target.value)} autoComplete="new-password" minLength="6" required disabled={isForgotSubmitting} />
                  </div>
                  {forgotError && <div className="auth-error" role="alert">{forgotError}</div>}
                  {forgotMessage && <div className="auth-success" role="status">{forgotMessage}</div>}
                  <button type="submit" className="btn btn-primary auth-submit" disabled={isForgotSubmitting}>{isForgotSubmitting ? 'Đang lưu...' : 'Đặt mật khẩu mới'}</button>
                </form>
              </>
            )}
            <button type="button" className="auth-link" onClick={returnToLogin} disabled={isForgotSubmitting}>Quay lại đăng nhập</button>
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
              {loginMessage && <div className="auth-success" role="status">{loginMessage}</div>}
              {error && <div className="auth-error" role="alert">{error}</div>}
              <button type="submit" className="btn btn-primary auth-submit" disabled={isSubmitting}>{isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}</button>
            </form>
            <button type="button" className="auth-link" onClick={openForgotPassword}>Quên mật khẩu?</button>
          </>
        )}
      </div>
    </div>
  );
}
