const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const SESSION_KEY = 'qc_webtoon_session';
const REQUEST_TIMEOUT_MS = 15000;

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
      throw new Error(payload?.message || `Request failed with status ${response.status}`);
    }

    return payload?.data ?? payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại sau.');
    }
    throw error;
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
  getCurrentUser: () => request('/auth/me'),
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
  updateFreelancer: (id, freelancer) => request(`/freelancers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(freelancer)
  }),
  getQCs: () => request('/qcs'),
  getDeadlines: ({ forceDriveRefresh = false } = {}) => request(`/deadlines${forceDriveRefresh ? '?refreshDrive=1' : ''}`, {
    timeoutMs: 120000,
    ...(forceDriveRefresh ? { cache: 'no-store' } : {})
  }),
  createDeadline: (deadline) => request('/deadlines', {
    method: 'POST',
    body: JSON.stringify(deadline)
  }),
  updateDeadline: (seriesId, chapterNumber, updates) => request(`/deadlines/${seriesId}/${chapterNumber}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  }),
  updateDeadlineStatus: (seriesId, chapterNumber, status) => request(`/deadlines/${seriesId}/${chapterNumber}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
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
  getSalaries: () => request('/salaries'),
  resetAllData: () => request('/reset-all', { method: 'POST' }),
  updateProfile: (profile) => request('/profile', {
    method: 'PATCH',
    body: JSON.stringify(profile)
  })
};
