/**
 * Port of legacy App/TourManager.js. Reads tourType/runTour from the app store instead of props
 * and owns the legacy App.handleTourEnd (tours that change the map end with a page reload).
 * Also starts the Quick Tour automatically once per browser for new users.
 */
import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react';
import { useLocation } from 'react-router';
import { useAppStore } from '@/app/store';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/shared/api/client';

type TourComp = LazyExoticComponent<ComponentType<{ onEnd: () => void }>>;
const tourMap: Record<string, TourComp> = {
  welcome: lazy(() => import('./WelcomeTour')),
  navigation: lazy(() => import('./MouzaMurabbaTour')),
  killa: lazy(() => import('./KillaTour')),
  baseLayers: lazy(() => import('./BaseLayerTour')),
  location: lazy(() => import('./LocationTour')),
  goto: lazy(() => import('./GoToTour')),
  compass: lazy(() => import('./CompassTour')),
  drawing: lazy(() => import('./DrawingTour')),
  savedLayers: lazy(() => import('./SavedLayersTour')),
  notifications: lazy(() => import('./NotificationsTour')),
  account: lazy(() => import('./AccountTour')),
  changeMouza: lazy(() => import('./ChangeMouzaTour')),
  shift: lazy(() => import('./ShiftMouzaTour')),
  clearCache: lazy(() => import('./CacheTour')),
  multiUse: lazy(() => import('./MultiDeviceTour')),
  changePassword: lazy(() => import('./ChangePasswordTour')),
};

/** Tours that only open and close windows; ending them needs no page reload. */
const NO_RELOAD = new Set(['welcome', 'compass', 'notifications', 'account', 'changeMouza']);

/** localStorage key: the Quick Tour has been shown in this browser. */
export const WELCOME_TOUR_KEY = 'nz_welcome_tour_done';

function useAutoWelcomeTour() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const userId = user?.userId;
  const userType = user?.userType;
  useEffect(() => {
    if (!userId || pathname !== '/' || userType === 'admin') return;
    try {
      if (localStorage.getItem(WELCOME_TOUR_KEY)) return;
    } catch {
      return;
    }
    // Give the map time to load, and never start over a warning or other window.
    const t = setTimeout(() => {
      const st = useAppStore.getState();
      const busy = st.runTour || st.showWarningModal || st.showIPWarningModal || st.showMenu || document.querySelector('[role="dialog"]');
      if (busy) return;
      try {
        localStorage.setItem(WELCOME_TOUR_KEY, '1');
      } catch {}
      st.set({ tourType: 'welcome', runTour: true });
    }, 3500);
    return () => clearTimeout(t);
  }, [userId, userType, pathname]);
}

export default function TourManager() {
  const tourType = useAppStore((s) => s.tourType);
  const runTour = useAppStore((s) => s.runTour);
  const { user } = useAuth();
  useAutoWelcomeTour();

  if (!tourType || !runTour) return null;
  const TourComponent = tourMap[tourType];
  if (!TourComponent) return null;

  const onEnd = () => {
    const st = useAppStore.getState();
    if (tourType === 'shift') {
      st.set({ pmtilesOffset: { lat: 0, lng: 0 } });
      if (user?.activeTehsil && st.selectedMauza) {
        api
          .delete(`/api/geo/adjustment/${encodeURIComponent(user.activeTehsil)}/${encodeURIComponent(st.selectedMauza)}`)
          .catch(() => {});
      }
    }
    if (tourType === 'welcome') {
      try {
        localStorage.setItem(WELCOME_TOUR_KEY, '1');
      } catch {}
    }
    st.set({ tourType: '', runTour: false });
    if (!NO_RELOAD.has(tourType)) window.location.reload();
  };

  return (
    <Suspense fallback={null}>
      <TourComponent key={tourType} onEnd={onEnd} />
    </Suspense>
  );
}
