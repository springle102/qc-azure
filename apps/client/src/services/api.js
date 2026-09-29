const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const SESSION_KEY = 'qc_webtoon_session';
const REQUEST_TIMEOUT_MS = 15000;

export function getUserFacingErrorMessage(message, fallback = 'Không thể hoàn tất yêu cầu.') {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  if (/exportSizeLimitExceeded|too large to be exported|file is too large/i.test(text)) {
    return 'File Google Sheet quá lớn nên không thể đọc ảnh trực tiếp.';
  }
  if (/permission|not have access|does not have permission|insufficient permissions/i.test(text)) {
    return 'Service Account chưa được cấp quyền truy cập Google Sheet.';
  }
  if (/SERVICE_DISABLED|has not been used in project|API .* disabled/i.test(text)) {
    return 'Google API cần thiết chưa được bật.';
  }
  if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(text)) {
    return 'Không thể kết nối máy chủ. Vui lòng kiểm tra backend hoặc thử lại sau.';
  }
  if (/^\s*[{[]/.test(text) || /"(?:error|errors|code|message)"\s*:/i.test(text) || /API trả về lỗi \d+/i.test(text)) {
    return fallback;
  }
  return text.length > 260 ? `${text.slice(0, 257)}...` : text;
}

function getStoredSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...(getStoredSession()?.token ? { Authorization: 'Bearer ' + getStoredSession().token } : {}),
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(getUserFacingErrorMessage(payload?.message, `Không thể thực hiện yêu cầu (mã lỗi ${response.status}).`));
    }

    return payload?.data ?? payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại sau.');
    }
    throw new Error(getUserFacingErrorMessage(error.message, 'Không thể kết nối máy chủ. Vui lòng thử lại sau.'));
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const api = {
  hasSession: () => Boolean(getStoredSession()?.token),
  setSession: (session) => window.localStorage.setItem(SESSION_KEY, JSON.stringify(session)),
  clearSession: () => window.localStorage.removeItem(SESSION_KEY),
  login: (credentials) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials)
  }),
  requestPasswordResetOtp: (username) => request('/auth/forgot-password/request-otp', {
    method: 'POST',
    body: JSON.stringify({ username })
  }),
  verifyPasswordResetOtp: ({ challengeId, otp }) => request('/auth/forgot-password/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ challengeId, otp })
  }),
  resetPassword: ({ resetToken, password }) => request('/auth/forgot-password/reset', {
    method: 'POST',
    body: JSON.stringify({ resetToken, password })
  }),
  getCurrentUser: () => request('/auth/me'),
  heartbeat: () => request('/auth/heartbeat', { method: 'POST' }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getAccounts: () => request('/accounts'),
  createAccount: (account) => request('/accounts', {
    method: 'POST',
    body: JSON.stringify(account)
  }),
  updateAccount: (id, account) => request(`/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(account)
  }),
  deleteAccount: (id) => request(`/accounts/${id}`, {
    method: 'DELETE'
  }),
  getDashboard: () => request('/dashboard/summary'),
  getTasks: () => request('/tasks'),
  getFreelancers: () => request('/freelancers'),
  getDeadlineRegistrations: () => request('/deadline-registrations'),
  createDeadlineRegistration: (registration) => request('/deadline-registrations', {
    method: 'POST',
    body: JSON.stringify(registration)
  }),
  updateDeadlineRegistration: (id, registration) => request(`/deadline-registrations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(registration)
  }),
  deleteDeadlineRegistration: (id) => request(`/deadline-registrations/${id}`, {
    method: 'DELETE'
  }),
  updateFreelancer: (id, freelancer) => request(`/freelancers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(freelancer)
  }),
  getQCs: () => request('/qcs'),
  getDeadlines: ({ forceDriveRefresh = false } = {}) => request(`/deadlines${forceDriveRefresh ? '?refreshDrive=1' : ''}`, {
    timeoutMs: 120000,
    cache: 'no-store'
  }),
  createDeadline: (deadline) => request('/deadlines', {
    method: 'POST',
    body: JSON.stringify(deadline)
  }),
  updateDeadline: (seriesId, chapterNumber, updates) => request(`/deadlines/${encodeURIComponent(seriesId)}/${encodeURIComponent(chapterNumber)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  }),
  updateDeadlineStatus: (seriesId, chapterNumber, status) => request(`/deadlines/${encodeURIComponent(seriesId)}/${encodeURIComponent(chapterNumber)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  }),
  deleteDeadline: (seriesId, chapterNumber) => request(`/deadlines/${encodeURIComponent(seriesId)}/${encodeURIComponent(chapterNumber)}`, {
    method: 'DELETE'
  }),
  getFields: () => request('/fields'),
  createField: (field) => request('/fields', {
    method: 'POST',
    body: JSON.stringify(field)
  }),
  updateField: (id, field) => request(`/fields/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(field)
  }),
  deleteField: (id) => request(`/fields/${id}`, { method: 'DELETE' }),
  getGeneralSettings: () => request('/general-settings'),
  updateGeneralSettings: (settings) => request('/general-settings', {
    method: 'PATCH',
    body: JSON.stringify(settings)
  }),
  syncGoogleSheet: () => request('/google-sheet/sync', { method: 'POST', timeoutMs: 120000 }),
  getErrors: () => request('/errors'),
  getErrorFixChecks: () => request('/errors/fix-check', { cache: 'no-store', timeoutMs: 120000 }),
  migrateErrorScreenshots: () => request('/errors/migrate-screenshots', { method: 'POST', timeoutMs: 120000 }),
  createError: (error) => request('/errors', {
    method: 'POST',
    body: JSON.stringify(error)
  }),
  updateError: (id, error) => request(`/errors/${id}`, {
    method: 'PATCH',
    timeoutMs: 120000,
    body: JSON.stringify(error)
  }),
  deleteError: (id) => request(`/errors/${id}`, { method: 'DELETE' }),
  syncErrors: () => request('/errors/sync', { method: 'POST', timeoutMs: 120000 }),
  getDifficultyLevels: () => request('/difficulty-levels'),
  createDifficultyLevel: (level) => request('/difficulty-levels', {
    method: 'POST',
    body: JSON.stringify(level)
  }),
  updateDifficultyLevel: (id, level) => request(`/difficulty-levels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(level)
  }),
  deleteDifficultyLevel: (id) => request(`/difficulty-levels/${id}`, {
    method: 'DELETE'
  }),
  getDifficultyPrices: () => request('/difficulty-prices'),
  createDifficultyPrice: (price) => request('/difficulty-prices', {
    method: 'POST',
    body: JSON.stringify(price)
  }),
  updateDifficultyPrice: (id, price) => request(`/difficulty-prices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(price)
  }),
  deleteDifficultyPrice: (id) => request(`/difficulty-prices/${id}`, {
    method: 'DELETE'
  }),
  getBonusSettings: () => request('/bonus-settings'),
  updateBonusSettings: (settings) => request('/bonus-settings', {
    method: 'PATCH',
    body: JSON.stringify(settings)
  }),
  getSalaries: ({ month } = {}) => request(`/salaries${month ? `?month=${encodeURIComponent(month)}` : ''}`, { cache: 'no-store' }),
  resetAllData: () => request('/reset-all', { method: 'POST' }),
  updateProfile: (profile) => request('/profile', {
    method: 'PATCH',
    body: JSON.stringify(profile)
  })
};
