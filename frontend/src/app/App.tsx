/**
 * Router + layout shell. Port of legacy App.js orchestration:
 * - map route is a fixed full-viewport flex column (safe-area aware), other routes scroll
 * - header hidden on /reset-password, warning banner/modals suppressed on auth pages
 * - IP-misuse modal (> 3 devices) has priority over the subscription warning modal
 * - map selection reset on user change or when leaving "/"
 */
import { lazy, Suspense, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from './store';
import { ProtectedRoute, SelfOrAdminRoute } from './guards';
import { PageSpinner } from '@/shared/ui';
import Header from '@/features/chrome/Header';
import NavigationMenu from '@/features/chrome/NavigationMenu';
import GlobalModals from '@/features/chrome/GlobalModals';
import SubscriptionWarningBanner from '@/features/chrome/SubscriptionWarningBanner';

const MapPage = lazy(() => import('@/features/map/MapPage'));
const MapOverlays = lazy(() => import('@/features/map/MapOverlays'));
const TourManager = lazy(() => import('@/features/tours/TourManager'));
const LoginPage = lazy(() => import('@/features/auth/pages/LoginPage'));
const PublicRegistrationPage = lazy(() => import('@/features/auth/pages/PublicRegistrationPage'));
const AdminRegistrationPage = lazy(() => import('@/features/auth/pages/AdminRegistrationPage'));
const ResetPasswordPage = lazy(() => import('@/features/auth/pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('@/features/auth/pages/VerifyEmailPage'));
const UserListPage = lazy(() => import('@/features/users/UserListPage'));
const UserDetailPage = lazy(() => import('@/features/users/UserDetailPage'));
const InsightsPage = lazy(() => import('@/features/admin/insights/InsightsPage'));
const AdminActivatePage = lazy(() => import('@/features/admin/AdminActivatePage'));
const DemoAccessPage = lazy(() => import('@/features/admin/DemoAccessPage'));
const LandAllotmentPage = lazy(() => import('@/features/admin/LandAllotmentPage'));
const OperationsReportPage = lazy(() => import('@/features/admin/OperationsReportPage'));
const AdminSubAdminConsolePage = lazy(() => import('@/features/admin/subadmins/AdminSubAdminConsolePage'));
const SubAdminDashboardPage = lazy(() => import('@/features/subadmin/SubAdminDashboardPage'));
const SubAdminUsersPage = lazy(() => import('@/features/subadmin/SubAdminUsersPage'));
const CustomerActivatePage = lazy(() => import('@/features/admin/ActivationPages').then((m) => ({ default: m.CustomerActivatePage })));
const SubAdminActivatePage = lazy(() => import('@/features/admin/ActivationPages').then((m) => ({ default: m.SubAdminActivatePage })));
const ConfirmEmailPage = lazy(() => import('@/features/admin/ActivationPages').then((m) => ({ default: m.ConfirmEmailPage })));
const AksShajraPage = lazy(() => import('@/features/aks-shajra/AksShajraPage'));

const AUTH_PAGE = /^\/(login|activate\/|subadmin\/activate\/|confirm-email\/)/;

export default function App() {
  const { user, loading, warning, ipMisuse } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const s = useAppStore();
  const isMap = location.pathname === '/';
  const isAksShajra = location.pathname === '/aks-shajra';
  const onAuthPage = AUTH_PAGE.test(location.pathname);
  const hideChrome = location.pathname === '/reset-password' || isAksShajra;

  // Reset warning dismissal when user changes (login)
  useEffect(() => {
    if (user?.userId) useAppStore.getState().set({ warningDismissed: false, ipWarningDismissed: false });
  }, [user?.userId]);

  // Reset map selection on user change or leaving the map
  const prevUser = useRef(user?.userId);
  useEffect(() => {
    if (prevUser.current !== user?.userId || location.pathname !== '/') useAppStore.getState().resetMapSelection();
    prevUser.current = user?.userId;
  }, [user?.userId, location.pathname]);

  // Mouza offset fetch (legacy effect)
  useEffect(() => {
    useAppStore.getState().fetchOffset(user?.activeTehsil || '', s.selectedMauza);
  }, [s.selectedMauza, user?.activeTehsil]);

  // Sequential warning modals: IP misuse (> 3 devices) first, then subscription
  useEffect(() => {
    const st = useAppStore.getState();
    if (ipMisuse?.warn && (ipMisuse?.count30 || 0) > 3 && !st.ipWarningDismissed) {
      if (!st.showIPWarningModal) st.set({ showIPWarningModal: true, showWarningModal: false });
    } else if (warning && !st.warningDismissed && !st.showIPWarningModal) {
      if (!st.showWarningModal) st.set({ showWarningModal: true });
    }
  }, [warning, ipMisuse, s.showWarningModal, s.showIPWarningModal, s.warningDismissed, s.ipWarningDismissed]);

  useEffect(() => {
    if (!loading && !user && location.pathname === '/') navigate('/login');
  }, [loading, user, location.pathname, navigate]);

  return (
    <div
      className={
        isMap
          ? 'fixed inset-0 flex w-full flex-col overflow-hidden'
          : 'flex min-h-dvh flex-col'
      }
    >
      {!hideChrome && (
        <>
          <Header />
          {!onAuthPage && <SubscriptionWarningBanner />}
          <NavigationMenu />
        </>
      )}

      <main className={isMap ? 'relative flex min-h-0 flex-1 flex-col overflow-hidden' : 'flex flex-1 flex-col'}>
        <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/" element={<MapPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<PublicRegistrationPage />} />
            <Route path="/admin/register" element={<ProtectedRoute role="admin"><AdminRegistrationPage /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute role="admin"><UserListPage /></ProtectedRoute>} />
            <Route path="/users/:userId" element={<SelfOrAdminRoute><UserDetailPage /></SelfOrAdminRoute>} />
            <Route path="/stats" element={<ProtectedRoute role="admin"><InsightsPage /></ProtectedRoute>} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/demo/:token" element={<DemoAccessPage />} />
            <Route path="/admin/activate/:token" element={<AdminActivatePage />} />
            <Route path="/aks-shajra" element={<ProtectedRoute role="admin"><AksShajraPage /></ProtectedRoute>} />
            <Route path="/admin/land-allotments" element={<ProtectedRoute role="admin"><LandAllotmentPage /></ProtectedRoute>} />
            <Route path="/admin/operations-report" element={<ProtectedRoute role="admin"><OperationsReportPage /></ProtectedRoute>} />
            <Route path="/admin/subadmins" element={<ProtectedRoute role="admin"><AdminSubAdminConsolePage /></ProtectedRoute>} />
            <Route path="/subadmin" element={<ProtectedRoute role="subadmin"><SubAdminDashboardPage /></ProtectedRoute>} />
            <Route path="/subadmin/users" element={<ProtectedRoute role="subadmin"><SubAdminUsersPage /></ProtectedRoute>} />
            <Route path="/activate/:token" element={<CustomerActivatePage />} />
            <Route path="/subadmin/activate/:token" element={<SubAdminActivatePage />} />
            <Route path="/confirm-email/:token" element={<ConfirmEmailPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          {/* Go-To / Shift modals and saved-layer modals live with the map feature */}
          <MapOverlays />
        </Suspense>
      </main>

      <GlobalModals onAuthPage={onAuthPage} />
      <Suspense fallback={null}>
        <TourManager />
      </Suspense>
    </div>
  );
}
