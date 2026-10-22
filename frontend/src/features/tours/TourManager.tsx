/**
 * Port of legacy App/TourManager.js. Reads tourType/runTour from the app store instead of props
 * and owns the legacy App.handleTourEnd (tours end with a full page reload).
 */
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useAppStore } from '@/app/store';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/shared/api/client';

type TourComp = LazyExoticComponent<ComponentType<{ onEnd: () => void }>>;
const tourMap: Record<string, TourComp> = {
  baseLayers: lazy(() => import('./BaseLayerTour')),
  navigation: lazy(() => import('./MouzaMurabbaTour')),
  location: lazy(() => import('./LocationTour')),
  shift: lazy(() => import('./ShiftMouzaTour')),
  clearCache: lazy(() => import('./CacheTour')),
  multiUse: lazy(() => import('./MultiDeviceTour')),
  changePassword: lazy(() => import('./ChangePasswordTour')),
  savedLayers: lazy(() => import('./SavedLayersTour')),
  drawing: lazy(() => import('./DrawingTour')),
};

export default function TourManager() {
  const tourType = useAppStore((s) => s.tourType);
  const runTour = useAppStore((s) => s.runTour);
  const { user } = useAuth();

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
    st.set({ tourType: '', runTour: false });
    window.location.reload();
  };

  return (
    <Suspense fallback={null}>
      <TourComponent key={tourType} onEnd={onEnd} />
    </Suspense>
  );
}
