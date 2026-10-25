/**
 * Map page (route "/"). Port of the legacy App.js → <MapComponent> wiring:
 * every former App.js prop now comes from useAppStore()/useAuth().
 */
import { useCallback } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from '@/app/store';
import { fetchMauzas } from '@/shared/lib/mouzaApi';
import MapComponentJs from './core/MapComponent';
import { useMapUser } from './useMapTehsil';

// Legacy JS forwardRef component (loosely typed props).
const MapComponent = MapComponentJs as any;

export default function MapPage() {
  const { user: authUser } = useAuth();
  // In All Mouzas mode the map shows the browsed tehsil; preview mouzas are marked.
  const user = useMapUser();
  void authUser;
  const selectedMauza = useAppStore((s) => s.selectedMauza);
  const goToMarkers = useAppStore((s) => s.goToMarkers);
  const murabbaOptions = useAppStore((s) => s.murabbaOptions);
  const selectedMurabba = useAppStore((s) => s.selectedMurabba);
  const shajraEnabled = useAppStore((s) => s.shajraEnabled);
  const shajraVisible = useAppStore((s) => s.shajraVisible);
  const userLayerToLoad = useAppStore((s) => s.userLayerToLoad);
  const shiftResult = useAppStore((s) => s.shiftResult);
  const pmtilesOffset = useAppStore((s) => s.pmtilesOffset);
  const testMode = useAppStore((s) => s.testMode);
  const killaMeasurement = useAppStore((s) => s.killaMeasurement);
  const adminMapMode = useAppStore((s) => s.adminMapMode);
  const forceMobileMode = useAppStore((s) => s.forceMobileMode);
  const mouzaLoading = useAppStore((s) => s.mouzaLoading);
  const murabbaLoading = useAppStore((s) => s.murabbaLoading);
  const baseLayer = useAppStore((s) => s.baseLayer);
  const set = useAppStore((s) => s.set);

  const setMurabbaOptions = useCallback((murabbaOptions: any[]) => set({ murabbaOptions }), [set]);
  const handleMurabbaSelection = useCallback((selectedMurabba: string | null) => set({ selectedMurabba }), [set]);
  const onDrawnChange = useCallback((drawnLayerData: any) => set({ drawnLayerData }), [set]);
  const onShiftResultApplied = useCallback(() => set({ shiftResult: null }), [set]);
  const onPMTilesOffsetFetched = useCallback((pmtilesOffset: any) => set({ pmtilesOffset }), [set]);
  const onClearMarkers = useCallback(() => set({ goToMarkers: [] }), [set]);
  const onGoToClick = useCallback(() => set({ showGoToForm: true }), [set]);
  const setBaseLayer = useCallback((baseLayer: string) => set({ baseLayer }), [set]);

  // Legacy handleNavigateMauza (test mode Prev/Next, admin only)
  const handleNavigateMauza = useCallback(
    async (direction: 'next' | 'prev') => {
      if (!user || user.userType !== 'admin' || !user.activeTehsil) return;
      const list: string[] = await fetchMauzas(user.activeTehsil);
      if (!list || list.length === 0) return;
      const current = useAppStore.getState().selectedMauza;
      const idx = list.indexOf(current);
      let next: string | null = null;
      if (direction === 'next') {
        if (idx < list.length - 1) next = list[idx + 1];
      } else if (idx > 0) {
        next = list[idx - 1];
      }
      if (next) useAppStore.getState().selectMauza(user.activeTehsil, next);
    },
    [user],
  );
  const onNextMauza = useCallback(() => handleNavigateMauza('next'), [handleNavigateMauza]);
  const onPrevMauza = useCallback(() => handleNavigateMauza('prev'), [handleNavigateMauza]);

  return (
    <div className="absolute inset-0">
    <MapComponent
      user={user}
      selectedMauza={selectedMauza}
      goToMarkers={goToMarkers}
      onClearMarkers={onClearMarkers}
      onGoToClick={onGoToClick}
      setMurabbaOptions={setMurabbaOptions}
      selectedMurabba={selectedMurabba}
      handleMurabbaSelection={handleMurabbaSelection}
      murabbaOptions={murabbaOptions}
      shajraEnabled={shajraEnabled}
      shajraVisible={shajraVisible}
      onDrawnChange={onDrawnChange}
      userLayerToLoad={userLayerToLoad}
      shiftResult={shiftResult}
      onShiftResultApplied={onShiftResultApplied}
      pmtilesOffset={pmtilesOffset}
      onPMTilesOffsetFetched={onPMTilesOffsetFetched}
      testMode={testMode}
      killaMeasurement={killaMeasurement}
      adminMapMode={adminMapMode}
      forceMobileMode={forceMobileMode}
      onNextMauza={onNextMauza}
      onPrevMauza={onPrevMauza}
      isLoading={mouzaLoading || murabbaLoading}
      loadingMessage={mouzaLoading ? `Loading mouzas for ${user?.activeTehsil}...` : `Loading murabbas for ${selectedMauza}...`}
      baseLayer={baseLayer}
      setBaseLayer={setBaseLayer}
    />
    </div>
  );
}
