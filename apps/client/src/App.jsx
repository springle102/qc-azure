import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

async function loadResource(loader, fallback) {
  try {
    const value = await loader();
    return value ?? fallback;
  } catch {
    return fallback;
  }
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

  const loadData = useCallback(async () => {
    if (!profile) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const accountLoader = profile.role === 'Admin' ? api.getAccounts : async () => [];
    const [dashboard, tasks, freelancers, qcs, deadlines, difficultyLevels, difficultyPrices, bonusSettings, salaries, accounts, fields, generalSettings] = await Promise.all([
      loadResource(api.getDashboard, EMPTY_DATA.dashboard),
      loadResource(api.getTasks, []),
      loadResource(api.getFreelancers, []),
      loadResource(api.getQCs, []),
      loadResource(api.getDeadlines, []),
      loadResource(api.getDifficultyLevels, []),
      loadResource(api.getDifficultyPrices, []),
      loadResource(api.getBonusSettings, EMPTY_DATA.bonusSettings),
      loadResource(api.getSalaries, []),
      loadResource(accountLoader, []),
      loadResource(api.getFields, []),
      loadResource(api.getGeneralSettings, EMPTY_DATA.generalSettings)
    ]);

    const apiUnavailable = [tasks, freelancers, qcs, deadlines, difficultyLevels, difficultyPrices, salaries].every((items) => items.length === 0);
    setLoadWarning(apiUnavailable ? 'Chưa có dữ liệu từ backend hoặc Supabase.' : '');
    setData({ dashboard, tasks, freelancers, qcs, deadlines, difficultyLevels, difficultyPrices, bonusSettings, salaries, accounts, fields, generalSettings });
    setIsLoading(false);
  }, [profile]);

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
      await loadData();
      showToast('Đã lưu hồ sơ.', 'success');
    } catch {
      showToast('Không thể lưu thông tin hồ sơ.', 'error');
    }
  }, [loadData]);

  const page = useMemo(() => {
    const commonProps = {
      isLoading,
      onRefresh: loadData
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
              <button type="button" className="btn btn-outline btn-sm" onClick={loadData}>
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
