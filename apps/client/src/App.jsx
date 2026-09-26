import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { Footer } from './components/layout/Footer';
import { ToastContainer, showToast } from './components/common/ToastContainer';
import { DashboardView } from './components/views/DashboardView';
import { FreelancerManagementView } from './components/views/FreelancerManagementView';
import { DeadlineManagementView } from './components/views/DeadlineManagementView';
import { CompanyDeadlineManagementView } from './components/views/CompanyDeadlineManagementView';
import { QRManagementView } from './components/views/QRManagementView';
import { ErrorManagementView } from './components/views/ErrorManagementView';
import { ProfileView } from './components/views/ProfileView';
import { api } from './services/api';
import './App.css';

const EMPTY_DATA = {
  dashboard: { guideUrl: '', resourceUrl: '' },
  tasks: [],
  freelancers: [],
  deadlines: [],
  companyDeadlines: [],
  qrcodes: [],
  errors: []
};

const QC_SESSION = {
  role: 'QC',
  name: '',
  email: '',
  avatar: ''
};

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
  const [profile, setProfile] = useState(QC_SESSION);
  const [loadWarning, setLoadWarning] = useState('');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [dashboard, tasks, freelancers, deadlines, companyDeadlines, qrcodes, errors] = await Promise.all([
      loadResource(api.getDashboard, EMPTY_DATA.dashboard),
      loadResource(api.getTasks, []),
      loadResource(api.getFreelancers, []),
      loadResource(api.getDeadlines, []),
      loadResource(api.getCompanyDeadlines, []),
      loadResource(api.getQRCodes, []),
      loadResource(api.getErrors, [])
    ]);

    const apiUnavailable = [tasks, freelancers, deadlines, companyDeadlines, qrcodes, errors].every((items) => items.length === 0);
    setLoadWarning(apiUnavailable ? 'Chưa có dữ liệu từ backend hoặc Supabase.' : '');
    setData({ dashboard, tasks, freelancers, deadlines, companyDeadlines, qrcodes, errors });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleNavigate = (view) => {
    setCurrentView(view);
    setIsSidebarOpen(false);
  };

  const handleSaveProfile = async (updates) => {
    setProfile((current) => ({ ...current, ...updates }));
    try {
      await api.updateProfile(updates);
      showToast('Đã lưu hồ sơ.', 'success');
    } catch {
      showToast('Hồ sơ đã cập nhật trên giao diện. Backend chưa sẵn sàng để lưu.', 'error');
    }
  };

  const page = useMemo(() => {
    const commonProps = {
      isLoading,
      onRefresh: loadData
    };

    switch (currentView) {
      case 'freelancers':
        return <FreelancerManagementView {...commonProps} freelancers={data.freelancers} />;
      case 'company-deadlines':
        return <CompanyDeadlineManagementView {...commonProps} companyDeadlines={data.companyDeadlines} />;
      case 'deadlines':
        return <DeadlineManagementView {...commonProps} deadlines={data.deadlines} />;
      case 'qrcodes':
        return <QRManagementView {...commonProps} qrcodes={data.qrcodes} />;
      case 'errors':
        return <ErrorManagementView {...commonProps} errors={data.errors} />;
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
            onNavigate={handleNavigate}
          />
        );
    }
  }, [currentView, data, isLoading, loadData, profile]);

  return (
    <div className="app-container qc-app-shell">
      <Sidebar
        currentView={currentView}
        onNavigate={handleNavigate}
        currentUser={profile}
        isOpen={isSidebarOpen}
      />

      <div className="main-wrapper">
        <Header
          currentUser={profile}
          onOpenProfile={() => handleNavigate('profile')}
          onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
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
