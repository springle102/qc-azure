import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { Footer } from './components/layout/Footer';
import { ToastContainer, showToast } from './components/common/ToastContainer';
import { DashboardView } from './components/views/DashboardView';
import { FreelancerManagementView } from './components/views/FreelancerManagementView';
import { SalaryManagementView } from './components/views/SalaryManagementView';
import { DeadlineManagementView } from './components/views/DeadlineManagementView';
import { PriceManagementView } from './components/views/PriceManagementView';
import { GeneralSettingsView } from './components/views/GeneralSettingsView';
import { ProfileView } from './components/views/ProfileView';
import { LoginView } from './components/views/LoginView';
import { api } from './services/api';
import './App.css';

const EMPTY_DATA = {
  dashboard: { guideUrl: '', resourceUrl: '', fieldResources: [] },
  tasks: [],
  freelancers: [],
  qcs: [],
  deadlines: [],
  difficultyLevels: [],
  difficultyPrices: [],
  bonusSettings: { id: 1, taskThreshold: 20, bonusPerTask: 10000 },
  salaries: [],
  accounts: [],
  fields: [],
  generalSettings: { id: 1 },
};

const ROLE_VIEWS = {
  Admin: ['dashboard', 'freelancers', 'deadlines', 'pricing', 'settings', 'salary', 'profile'],
  QC: ['dashboard', 'profile', 'salary', 'deadlines'],
  Freelancer: ['dashboard', 'profile', 'salary', 'deadlines']
};

const VIEW_RESOURCES = {
  dashboard: ['dashboard', 'tasks', 'deadlines'],
  freelancers: ['freelancers', 'accounts', 'fields'],
  deadlines: ['deadlines', 'freelancers', 'qcs', 'fields', 'difficultyLevels', 'difficultyPrices'],
  pricing: ['difficultyLevels', 'difficultyPrices', 'fields', 'bonusSettings'],
  settings: ['fields', 'generalSettings'],
  salary: ['freelancers', 'salaries', 'fields', 'bonusSettings'],
  profile: []
};

const THEME_STORAGE_KEY = 'qc-webtoon-theme';

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    ...user,
    name: user.name || user.displayName || user.username || '',
    displayName: user.displayName || user.name || user.username || ''
  };
}

function canAccessView(role, view) {
  return (ROLE_VIEWS[role] || ROLE_VIEWS.Freelancer).includes(view);
}

function getResourcesForView(view) {
  return VIEW_RESOURCES[view] || VIEW_RESOURCES.dashboard;
}

export function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState(EMPTY_DATA);
  const [profile, setProfile] = useState(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loadWarning, setLoadWarning] = useState('');
  const [theme, setTheme] = useState(getInitialTheme);
  const loadRequestId = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme preference still applies for the current session when storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    if (!api.hasSession()) {
      setIsAuthChecking(false);
      return;
    }

    api.getCurrentUser()
      .then((user) => setProfile(normalizeUser(user)))
      .catch(() => api.clearSession())
      .finally(() => setIsAuthChecking(false));
  }, []);

  const role = profile?.role;

  const loadData = useCallback(async ({ forceDriveRefresh = false } = {}) => {
    if (!role) {
      setIsLoading(false);
      return;
    }

    const resources = getResourcesForView(currentView);
    const requestId = ++loadRequestId.current;
    if (resources.length === 0) {
      setIsLoading(false);
      setLoadWarning('');
      return;
    }

    setIsLoading(true);
    const loaders = {
      dashboard: api.getDashboard,
      tasks: api.getTasks,
      freelancers: api.getFreelancers,
      qcs: api.getQCs,
      deadlines: () => api.getDeadlines({ forceDriveRefresh }),
      difficultyLevels: api.getDifficultyLevels,
      difficultyPrices: api.getDifficultyPrices,
      bonusSettings: api.getBonusSettings,
      salaries: api.getSalaries,
      accounts: role === 'Admin' ? api.getAccounts : async () => [],
      fields: api.getFields,
      generalSettings: api.getGeneralSettings
    };
    const fallbacks = {
      dashboard: EMPTY_DATA.dashboard,
      tasks: EMPTY_DATA.tasks,
      freelancers: EMPTY_DATA.freelancers,
      qcs: EMPTY_DATA.qcs,
      deadlines: EMPTY_DATA.deadlines,
      difficultyLevels: EMPTY_DATA.difficultyLevels,
      difficultyPrices: EMPTY_DATA.difficultyPrices,
      bonusSettings: EMPTY_DATA.bonusSettings,
      salaries: EMPTY_DATA.salaries,
      accounts: EMPTY_DATA.accounts,
      fields: EMPTY_DATA.fields,
      generalSettings: EMPTY_DATA.generalSettings
    };
    const results = await Promise.all(resources.map(async (resource) => {
      try {
        const value = await loaders[resource]();
        return { resource, value: value ?? fallbacks[resource], failed: false };
      } catch {
        return { resource, value: fallbacks[resource], failed: true };
      }
    }));

    if (requestId !== loadRequestId.current) return;

    setLoadWarning(results.some((result) => result.failed) ? 'Một số dữ liệu chưa tải được. Vui lòng thử lại.' : '');
    setData((current) => ({
      ...current,
      ...Object.fromEntries(results.map(({ resource, value }) => [resource, value]))
    }));
    setIsLoading(false);
  }, [currentView, role]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpdateDeadline = useCallback((updatedDeadline) => {
    setData((current) => ({
      ...current,
      deadlines: current.deadlines.map((deadline) => (
        String(deadline.seriesId) === String(updatedDeadline.seriesId)
          && String(deadline.chapterNumber) === String(updatedDeadline.chapterNumber)
          ? updatedDeadline
          : deadline
      ))
    }));
  }, []);

  const handleCreateDeadline = useCallback((createdDeadline) => {
    setData((current) => ({
      ...current,
      deadlines: [createdDeadline, ...current.deadlines]
    }));
  }, []);

  const handleNavigate = useCallback((view) => {
    if (!canAccessView(profile?.role, view)) {
      showToast('Bạn không có quyền truy cập mục này.', 'error');
      return;
    }
    setCurrentView(view);
    setIsSidebarOpen(false);
  }, [profile?.role]);

  const handleLogin = async (credentials) => {
    const session = await api.login(credentials);
    api.setSession(session);
    setProfile(normalizeUser(session.user));
    setCurrentView('dashboard');
    setData(EMPTY_DATA);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // The local session is still cleared when the API is unavailable.
    }
    api.clearSession();
    setProfile(null);
    setData(EMPTY_DATA);
    setCurrentView('dashboard');
    setIsSidebarOpen(false);
  };

  const handleSaveProfile = useCallback(async (updates) => {
    try {
      const savedUser = await api.updateProfile(updates);
      setProfile((current) => normalizeUser({
        ...current,
        ...savedUser,
        ...(Object.prototype.hasOwnProperty.call(updates, 'avatar') ? { avatar: updates.avatar } : {})
      }));
      showToast('Đã lưu hồ sơ.', 'success');
    } catch {
      showToast('Không thể lưu thông tin hồ sơ.', 'error');
    }
  }, []);

  const page = useMemo(() => {
    const commonProps = {
      isLoading,
      onRefresh: () => loadData({ forceDriveRefresh: true })
    };

    switch (currentView) {
      case 'freelancers':
        return <FreelancerManagementView {...commonProps} freelancers={data.freelancers} accounts={data.accounts} fields={data.fields} canManageAccounts={profile.role === 'Admin'} canEdit={profile.role !== 'Freelancer'} />;
      case 'salary':
        return <SalaryManagementView {...commonProps} freelancers={data.freelancers} salaries={data.salaries} fields={data.fields} bonusConfig={data.bonusSettings} restrictToSalaryRows={profile.role === 'QC'} />;
      case 'pricing':
        return <PriceManagementView {...commonProps} difficultyLevels={data.difficultyLevels} difficultyPrices={data.difficultyPrices} fields={data.fields} bonusConfig={data.bonusSettings} />;
      case 'settings':
        return <GeneralSettingsView {...commonProps} fields={data.fields} generalSettings={data.generalSettings} />;
      case 'deadlines':
        return <DeadlineManagementView {...commonProps} deadlines={data.deadlines} freelancers={data.freelancers} qcs={data.qcs} fields={data.fields} difficultyLevels={data.difficultyLevels} difficultyPrices={data.difficultyPrices} onUpdate={handleUpdateDeadline} onCreate={handleCreateDeadline} readOnly={profile.role === 'Freelancer'} title={profile.role === 'Freelancer' ? 'Deadline của tôi' : 'Quản lý deadline'} />;
      case 'profile':
        return <ProfileView currentUser={profile} onSaveProfile={handleSaveProfile} />;
      case 'dashboard':
      default:
        return (
          <DashboardView
            {...commonProps}
            dashboard={data.dashboard}
            tasks={data.tasks}
            deadlines={data.deadlines}
            currentUser={profile}
            onNavigate={handleNavigate}
          />
        );
    }
  }, [currentView, data, handleCreateDeadline, handleNavigate, handleSaveProfile, handleUpdateDeadline, isLoading, loadData, profile]);

  if (isAuthChecking) {
    return (
      <div className="auth-screen">
        <div className="auth-card glass-panel">
          <div className="auth-brand"><div className="qc-sidebar-mark">Q</div><div><strong>QC WEBTOON</strong><span>DEADLINE MANAGEMENT</span></div></div>
          <p className="page-subtitle">Đang kiểm tra phiên đăng nhập...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <>
        <LoginView onLogin={handleLogin} />
        <ToastContainer />
      </>
    );
  }

  return (
    <div className="app-container qc-app-shell">
      <Sidebar
        currentView={currentView}
        onNavigate={handleNavigate}
        currentUser={profile}
        role={profile.role}
        onOpenLogout={handleLogout}
        isOpen={isSidebarOpen}
      />

      <div className="main-wrapper">
        <Header
          currentUser={profile}
          deadlines={data.deadlines}
          onNavigate={handleNavigate}
          onOpenProfile={() => handleNavigate('profile')}
          onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
          isDarkMode={theme === 'dark'}
          onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
        />

        <main className="content-area">
          {loadWarning && (
            <div className="data-connection-banner" role="status">
              <span>{loadWarning}</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => loadData({ forceDriveRefresh: true })}>
                Thử lại
              </button>
            </div>
          )}
          {page}
        </main>

        <Footer />
      </div>

      <ToastContainer />
    </div>
  );
}

export default App;
