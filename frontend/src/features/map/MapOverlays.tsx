/**
 * Map-feature modals mounted on every route by App.tsx (legacy App.js rendered these
 * outside the map DOM): GoToLocationForm, ShiftMouzaForm, SaveLayerModal, SavedLayersModal.
 * Renders nothing unless one of the store flags is on.
 */
import { useCallback } from 'react';
import { useAppStore } from '@/app/store';
import { useAuth } from '@/features/auth/AuthProvider';
import GoToLocationForm from './modals/GoToLocationForm';
import ShiftMouzaForm from './modals/ShiftMouzaForm';
import SaveLayerModal from './modals/SaveLayerModal';
import SavedLayersModal from './modals/SavedLayersModal';
import { useUserLayers } from './useUserLayers';

function LayerModals() {
  const tourType = useAppStore((s) => s.tourType);
  const {
    userLayers,
    showSaveLayerModal,
    setShowSaveLayerModal,
    showSavedLayersModal,
    setShowSavedLayersModal,
    saveLayerName,
    setSaveLayerName,
    savingLayer,
    handleSaveLayerSubmit,
    handleLoadLayer,
    handleDeleteLayer,
  } = useUserLayers();
  return (
    <>
      {showSaveLayerModal && (
        <SaveLayerModal
          show={showSaveLayerModal}
          onHide={() => setShowSaveLayerModal(false)}
          onSubmit={handleSaveLayerSubmit}
          saveLayerName={saveLayerName}
          setSaveLayerName={setSaveLayerName}
          savingLayer={savingLayer}
        />
      )}
      {showSavedLayersModal && (
        <SavedLayersModal
          show={showSavedLayersModal}
          onHide={() => setShowSavedLayersModal(false)}
          userLayers={userLayers}
          tourType={tourType}
          onLoad={handleLoadLayer}
          onDelete={handleDeleteLayer}
        />
      )}
    </>
  );
}

export default function MapOverlays() {
  const { user } = useAuth();
  const showGoToForm = useAppStore((s) => s.showGoToForm);
  const showShiftForm = useAppStore((s) => s.showShiftForm);
  const showSaveLayerModal = useAppStore((s) => s.showSaveLayerModal);
  const showSavedLayersModal = useAppStore((s) => s.showSavedLayersModal);
  const selectedMauza = useAppStore((s) => s.selectedMauza);
  const set = useAppStore((s) => s.set);

  const onShift = useCallback(
    (offset: { latOffset: number; lngOffset: number }) => set({ pmtilesOffset: { lat: offset.latOffset, lng: offset.lngOffset } }),
    [set],
  );

  if (!showGoToForm && !showShiftForm && !showSaveLayerModal && !showSavedLayersModal) return null;

  return (
    <>
      {showShiftForm && (
        <ShiftMouzaForm
          show={showShiftForm}
          onHide={() => set({ showShiftForm: false })}
          onShift={onShift}
          tehsil={user?.activeTehsil}
          mauza={selectedMauza}
        />
      )}
      {showGoToForm && (
        <GoToLocationForm
          onClose={() => set({ showGoToForm: false })}
          onGoToLocation={({ lat, lng }) => useAppStore.getState().addGoToMarker(lat, lng)}
          onClearMarkers={() => set({ goToMarkers: [] })}
        />
      )}
      {(showSaveLayerModal || showSavedLayersModal) && <LayerModals />}
    </>
  );
}
