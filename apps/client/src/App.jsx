import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { Footer } from './components/layout/Footer';
import { ToastContainer, showToast } from './components/common/ToastContainer';
import { DashboardView } from './components/views/DashboardView';
import { FreelancerManagementView } from './components/views/FreelancerManagementView';
import { DeadlineRegistrationView } from './components/views/DeadlineRegistrationView';
import { SalaryManagementView } from './components/views/SalaryManagementView';
import { DeadlineManagementView } from './components/views/DeadlineManagementView';
import { PriceManagementView } from './components/views/PriceManagementView';
import { GeneralSettingsView } from './components/views/GeneralSettingsView';
import { ErrorManagementView } from './components/views/ErrorManagementView';
import { ProfileView } from './components/views/ProfileView';
import { LoginView } from './components/views/LoginView';
import { api } from './services/api';
import { getSalaryMonth } from './utils/bonus.mjs';
import './App.css';

const EMPTY_DATA = {
  dashboard: { guideUrl: '', resourceUrl: '', fieldResources: [] },
  tasks: [],
  freelancers: [],
  deadlineRegistrations: [],
  qcs: [],
  deadlines: [],
  difficultyLevels: [],
  difficultyPrices: [],
  bonusSettings: { default: { id: 1, taskThreshold: 20, bonusPerTask: 10000, qcDefaultPrice: 0 }, byField: {} },
  salaries: [],
  accounts: [],
  fields: [],
  generalSettings: { id: 1 },
  errors: [],
};

const ROLE_VIEWS = {
  Admin: ['dashboard', 'freelancers', 'deadlineRegistrations', 'deadlines', 'errors', 'pricing', 'settings', 'salary', 'profile'],
  QC: ['dashboard', 'profile', 'salary', 'deadlineRegistrations', 'deadlines', 'errors'],
  Freelancer: ['dashboard', 'profile', 'salary', 'deadlineRegistrations', 'deadlines', 'errors']
};

const ROLE_ORDER = ['Admin', 'QC', 'Freelancer'];

const VIEW_RESOURCES = {
  dashboard: ['dashboard', 'tasks', 'deadlines', 'errors'],
  freelancers: ['freelancers', 'accounts', 'fields', 'errors'],
  deadlineRegistrations: ['deadlineRegistrations', 'freelancers'],
  deadlines: ['deadlines', 'freelancers', 'qcs', 'fields', 'difficultyLevels', 'difficultyPrices', 'errors'],
  errors: ['errors', 'fields', 'freelancers', 'generalSettings'],
  pricing: ['difficultyLevels', 'difficultyPrices', 'fields', 'bonusSettings', 'errors'],
  settings: ['fields', 'generalSettings', 'deadlines', 'errors'],
  salary: ['freelancers', 'salaries', 'fields', 'bonusSettings', 'errors'],
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

function getAvailableRoles(user) {
  const roles = Array.isArray(user?.roles) && user.roles.length > 0 ? user.roles : [user?.role];
  return ROLE_ORDER.filter((role) => roles.includes(role));
}

function canAccessView(role, view) {
  return (ROLE_VIEWS[role] || ROLE_VIEWS.Freelancer).includes(view);
}

function getResourcesForView(view) {
  return VIEW_RESOURCES[view] || VIEW_RESOURCES.dashboard;
}

export function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [salaryMonth, setSalaryMonth] = useState(getSalaryMonth);
  const [activeRole, setActiveRole] = useState('');
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
      .then((user) => {
        const normalizedUser = normalizeUser(user);
        setProfile(normalizedUser);
        setActiveRole(normalizedUser.role);
        api.setActiveRole(normalizedUser.role);
      })
      .catch(() => api.clearSession())
      .finally(() => setIsAuthChecking(false));
  }, []);

  useEffect(() => {
    if (!profile) return undefined;

    const sendHeartbeat = () => {
      api.heartbeat().catch(() => {
        // Presence is best-effort; the normal data requests still handle auth failures.
      });
    };

    sendHeartbeat();
    const heartbeatId = window.setInterval(sendHeartbeat, 30_000);
    return () => window.clearInterval(heartbeatId);
  }, [profile?.id]);

  const availableRoles = useMemo(() => getAvailableRoles(profile), [profile]);
  const role = availableRoles.includes(activeRole) ? activeRole : profile?.role;
  const activeProfile = useMemo(() => profile ? { ...profile, role } : null, [profile, role]);

  const loadData = useCallback(async ({ forceDriveRefresh = false } = {}) => {
    if (!role) {
      setIsLoading(false);
      return;
    }

    api.setActiveRole(role);

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
      deadlineRegistrations: api.getDeadlineRegistrations,
      qcs: api.getQCs,
      deadlines: () => api.getDeadlines({ forceDriveRefresh }),
      difficultyLevels: api.getDifficultyLevels,
      difficultyPrices: api.getDifficultyPrices,
      bonusSettings: api.getBonusSettings,
      salaries: () => api.getSalaries({ month: salaryMonth }),
      accounts: role === 'Admin' ? api.getAccounts : async () => [],
      fields: api.getFields,
      generalSettings: api.getGeneralSettings,
      errors: api.getErrors
    };
    const fallbacks = {
      dashboard: EMPTY_DATA.dashboard,
      tasks: EMPTY_DATA.tasks,
      freelancers: EMPTY_DATA.freelancers,
      deadlineRegistrations: EMPTY_DATA.deadlineRegistrations,
      qcs: EMPTY_DATA.qcs,
      deadlines: EMPTY_DATA.deadlines,
      difficultyLevels: EMPTY_DATA.difficultyLevels,
      difficultyPrices: EMPTY_DATA.difficultyPrices,
      bonusSettings: EMPTY_DATA.bonusSettings,
      salaries: EMPTY_DATA.salaries,
      accounts: EMPTY_DATA.accounts,
      fields: EMPTY_DATA.fields,
      generalSettings: EMPTY_DATA.generalSettings,
      errors: EMPTY_DATA.errors
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
  }, [currentView, role, salaryMonth]);

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

  const handleDeleteDeadline = useCallback((deletedDeadline) => {
    setData((current) => ({
      ...current,
      deadlines: current.deadlines.filter((deadline) => (
        String(deadline.seriesId) !== String(deletedDeadline.seriesId)
        || String(deadline.chapterNumber) !== String(deletedDeadline.chapterNumber)
      ))
    }));
  }, []);

  const handleUpdateDeadlineRegistration = useCallback((updatedRegistration) => {
    setData((current) => ({
      ...current,
      deadlineRegistrations: current.deadlineRegistrations.map((registration) => (
        String(registration.id) === String(updatedRegistration.id) ? updatedRegistration : registration
      ))
    }));
  }, []);

  const handleCreateDeadlineRegistration = useCallback((createdRegistration) => {
    setData((current) => ({
      ...current,
      deadlineRegistrations: [createdRegistration, ...current.deadlineRegistrations]
    }));
  }, []);

  const handleDeleteDeadlineRegistration = useCallback((deletedRegistration) => {
    setData((current) => ({
      ...current,
      deadlineRegistrations: current.deadlineRegistrations.filter((registration) => String(registration.id) !== String(deletedRegistration.id))
    }));
  }, []);

  const handleUpdateError = useCallback((updatedError) => {
    setData((current) => ({
      ...current,
      errors: current.errors.map((error) => error.id === updatedError.id ? updatedError : error)
    }));
  }, []);

  const handleCreateError = useCallback((createdError) => {
    setData((current) => ({
      ...current,
      errors: [createdError, ...current.errors]
    }));
  }, []);

  const handleDeleteError = useCallback((deletedError) => {
    setData((current) => ({
      ...current,
      errors: current.errors.filter((error) => error.id !== deletedError.id)
    }));
  }, []);

  const handleResetAll = useCallback(async () => {
    await api.resetAllData();
    setData((current) => ({
      ...current,
      dashboard: {
        ...current.dashboard,
        waitingTasks: 0,
        assignedTasks: 0,
        reviewTasks: 0,
        completedTasks: 0,
        inProgressTasks: 0,
        upcomingTasks: []
      },
      tasks: [],
      deadlines: [],
      salaries: []
    }));
  }, []);

  const handleNavigate = useCallback((view) => {
    if (!canAccessView(role, view)) {
      showToast('Bạn không có quyền truy cập mục này.', 'error');
      return;
    }
    setCurrentView(view);
    setIsSidebarOpen(false);
  }, [role]);

  const handleRoleChange = useCallback((nextRole) => {
    if (!availableRoles.includes(nextRole) || nextRole === role) return;
    api.setActiveRole(nextRole);
    setActiveRole(nextRole);
    setCurrentView('dashboard');
    setData(EMPTY_DATA);
    setIsSidebarOpen(false);
  }, [availableRoles, role]);

  const handleLogin = async (credentials) => {
    const session = await api.login(credentials);
    api.setSession(session);
    const normalizedUser = normalizeUser(session.user);
    const nextRole = getAvailableRoles(normalizedUser)[0] || normalizedUser.role;
    api.setActiveRole(nextRole);
    setActiveRole(nextRole);
    setProfile(normalizedUser);
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
    setActiveRole('');
    setProfile(null);
    setData(EMPTY_DATA);
    setCurrentView('dashboard');
    setIsSidebarOpen(false);
  };

  const handleSaveProfile = useCallback(async (updates, { silent = false } = {}) => {
    try {
      const savedUser = await api.updateProfile(updates);
      setProfile((current) => normalizeUser({
        ...current,
        ...savedUser,
        ...(Object.prototype.hasOwnProperty.call(updates, 'avatar') ? { avatar: updates.avatar } : {})
      }));
      if (!silent) showToast('Đã lưu hồ sơ.', 'success');
      return savedUser;
    } catch {
      showToast('Không thể lưu thông tin hồ sơ.', 'error');
      return null;
    }
  }, []);

  const page = useMemo(() => {
    const commonProps = {
      isLoading,
      onRefresh: () => loadData()
    };

    switch (currentView) {
      case 'freelancers':
        return <FreelancerManagementView {...commonProps} freelancers={data.freelancers} accounts={data.accounts} fields={data.fields} canManageAccounts={activeProfile.role === 'Admin'} canEdit={activeProfile.role !== 'Freelancer'} />;
      case 'deadlineRegistrations':
        return <DeadlineRegistrationView {...commonProps} registrations={data.deadlineRegistrations} freelancers={data.freelancers} currentUser={activeProfile} onCreate={handleCreateDeadlineRegistration} onUpdate={handleUpdateDeadlineRegistration} onDelete={handleDeleteDeadlineRegistration} />;
      case 'salary':
        return <SalaryManagementView {...commonProps} currentUser={activeProfile} salaries={data.salaries} fields={data.fields} month={salaryMonth} onMonthChange={setSalaryMonth} />;
      case 'pricing':
        return <PriceManagementView {...commonProps} difficultyLevels={data.difficultyLevels} difficultyPrices={data.difficultyPrices} fields={data.fields} bonusSettings={data.bonusSettings} />;
      case 'settings':
        return <GeneralSettingsView {...commonProps} fields={data.fields} generalSettings={data.generalSettings} />;
      case 'errors':
        return <ErrorManagementView {...commonProps} errors={data.errors} fields={data.fields} freelancers={data.freelancers} generalSettings={data.generalSettings} currentUser={activeProfile} onUpdate={handleUpdateError} onCreate={handleCreateError} onDelete={handleDeleteError} />;
      case 'deadlines':
        return <DeadlineManagementView {...commonProps} deadlines={data.deadlines} freelancers={data.freelancers} qcs={data.qcs} fields={data.fields} difficultyLevels={data.difficultyLevels} difficultyPrices={data.difficultyPrices} currentUser={activeProfile} onUpdate={handleUpdateDeadline} onCreate={handleCreateDeadline} onDelete={handleDeleteDeadline} readOnly={activeProfile.role === 'Freelancer'} title={activeProfile.role === 'Freelancer' ? 'Deadline của tôi' : 'Quản lý deadline'} />;
      case 'profile':
        return <ProfileView currentUser={activeProfile} onSaveProfile={handleSaveProfile} />;
      case 'dashboard':
      default:
        return (
          <DashboardView
            {...commonProps}
            dashboard={data.dashboard}
            tasks={data.tasks}
            deadlines={data.deadlines}
            currentUser={activeProfile}
            onNavigate={handleNavigate}
            onResetAll={handleResetAll}
          />
        );
    }
  }, [activeProfile, currentView, data, handleCreateDeadline, handleCreateDeadlineRegistration, handleCreateError, handleDeleteDeadline, handleDeleteDeadlineRegistration, handleDeleteError, handleNavigate, handleResetAll, handleSaveProfile, handleUpdateDeadline, handleUpdateDeadlineRegistration, handleUpdateError, isLoading, loadData, salaryMonth]);

  if (isAuthChecking) {
    return (
      <div className="auth-screen">
        <div className="auth-card glass-panel">
          <div className="auth-brand"><div className="qc-sidebar-mark"><img src="/favicon.svg" alt="" aria-hidden="true" /></div><div><strong>WZ System</strong><span>DEADLINE MANAGEMENT</span></div></div>
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
        currentUser={activeProfile}
        role={role}
        availableRoles={availableRoles}
        onRoleChange={handleRoleChange}
        onOpenLogout={handleLogout}
        isOpen={isSidebarOpen}
      />

      <div className="main-wrapper">
        <Header
          currentUser={activeProfile}
          deadlines={data.deadlines}
          errors={data.errors}
          onNavigate={handleNavigate}
          onOpenProfile={() => handleNavigate('profile')}
          onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
          onOpenNotifications={() => setIsSidebarOpen(false)}
          isDarkMode={theme === 'dark'}
          onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
        />

        <main className={`content-area${currentView === 'deadlines' || currentView === 'errors' ? ' content-area-deadlines' : ''}`}>
          {loadWarning && (
            <div className="data-connection-banner" role="status">
              <span>{loadWarning}</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => loadData()}>
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
