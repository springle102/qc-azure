const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
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
  getDashboard: () => request('/dashboard/summary'),
  getTasks: () => request('/tasks'),
  getFreelancers: () => request('/freelancers'),
  getDeadlines: () => request('/deadlines'),
  getCompanyDeadlines: () => request('/company-deadlines'),
  getQRCodes: () => request('/qrcodes'),
  getErrors: () => request('/errors'),
  updateProfile: (profile) => request('/profile', {
    method: 'PATCH',
    body: JSON.stringify(profile)
  })
};
