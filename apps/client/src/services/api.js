const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const SESSION_KEY = 'qc_webtoon_session';

function getStoredSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(getStoredSession()?.token ? { Authorization: 'Bearer ' + getStoredSession().token } : {}),
      ...(options.headers || {})
    },
    ...options
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
  getDashboard: () => request('/dashboard/summary'),
  getTasks: () => request('/tasks'),
  getFreelancers: () => request('/freelancers'),
  updateFreelancer: (id, freelancer) => request(`/freelancers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(freelancer)
  }),
  getQCs: () => request('/qcs'),
  getDeadlines: () => request('/deadlines'),
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
  syncGoogleSheet: () => request('/google-sheet/sync', { method: 'POST' }),
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
  updateProfile: (profile) => request('/profile', {
    method: 'PATCH',
    body: JSON.stringify(profile)
  })
};
