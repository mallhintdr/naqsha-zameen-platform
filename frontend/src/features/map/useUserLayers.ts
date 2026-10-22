/**
 * Port of legacy src/hooks/useUserLayers.js.
 * Shared flags (showSaveLayerModal, showSavedLayersModal, saveLayerName, userLayerToLoad,
 * drawnLayerData) live in useAppStore; the layer list + saving flag live in a small
 * feature store so every caller (NavigationMenu, MapOverlays) sees the same list.
 */
import { useCallback, useEffect, type FormEvent } from 'react';
import { create } from 'zustand';
import { useAppStore } from '@/app/store';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/shared/api/client';
import { dialogs } from '@/shared/ui';

export interface UserLayer {
  _id: string;
  name: string;
  geojson?: any;
  updatedAt?: string;
  [k: string]: any;
}

interface LayersState {
  userLayers: UserLayer[];
  savingLayer: boolean;
  loadedFor: string | null;
  set: (p: Partial<LayersState>) => void;
}

export const useUserLayersStore = create<LayersState>((set) => ({
  userLayers: [],
  savingLayer: false,
  loadedFor: null,
  set: (p) => set(p),
}));

const fetchLayers = async () => {
  try {
    const { data } = await api.get('/api/user-layers');
    useUserLayersStore.getState().set({ userLayers: Array.isArray(data) ? data : [] });
  } catch {
    // ignore (legacy behaviour)
  }
};

export function useUserLayers() {
  const { user } = useAuth();
  const userLayers = useUserLayersStore((s) => s.userLayers);
  const savingLayer = useUserLayersStore((s) => s.savingLayer);
  const loadedFor = useUserLayersStore((s) => s.loadedFor);
  const setLayersState = useUserLayersStore((s) => s.set);

  const showSaveLayerModal = useAppStore((s) => s.showSaveLayerModal);
  const showSavedLayersModal = useAppStore((s) => s.showSavedLayersModal);
  const saveLayerName = useAppStore((s) => s.saveLayerName);
  const userLayerToLoad = useAppStore((s) => s.userLayerToLoad);
  const drawnLayerData = useAppStore((s) => s.drawnLayerData);
  const setApp = useAppStore((s) => s.set);

  // Fetch once per logged-in user (legacy: on every `user` change), shared across callers.
  const userKey = user ? String(user.userId ?? user._id ?? 'user') : null;
  useEffect(() => {
    if (!userKey) {
      if (loadedFor) setLayersState({ userLayers: [], loadedFor: null });
      return;
    }
    if (loadedFor === userKey) return;
    setLayersState({ loadedFor: userKey });
    fetchLayers();
  }, [userKey, loadedFor, setLayersState]);

  const setUserLayers = useCallback((userLayers: UserLayer[]) => setLayersState({ userLayers }), [setLayersState]);
  const setSavingLayer = useCallback((savingLayer: boolean) => setLayersState({ savingLayer }), [setLayersState]);
  const setShowSaveLayerModal = useCallback((v: boolean) => setApp({ showSaveLayerModal: v }), [setApp]);
  const setShowSavedLayersModal = useCallback((v: boolean) => setApp({ showSavedLayersModal: v }), [setApp]);
  const setSaveLayerName = useCallback((v: string) => setApp({ saveLayerName: v }), [setApp]);
  const setUserLayerToLoad = useCallback((v: any) => setApp({ userLayerToLoad: v }), [setApp]);

  const handleSaveLayerClick = useCallback(() => {
    if (!drawnLayerData) return;
    setApp({ saveLayerName: `Layer ${userLayers.length + 1}`, showSaveLayerModal: true });
  }, [drawnLayerData, userLayers.length, setApp]);

  const handleSaveLayerSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const { saveLayerName: name, drawnLayerData: geojson } = useAppStore.getState();
      if (!name.trim()) return;
      const trimmedName = name.trim();
      const layers = useUserLayersStore.getState().userLayers;
      const existingLayer = layers.find((l) => l.name.toLowerCase() === trimmedName.toLowerCase());

      let isOverwrite = false;
      if (existingLayer) {
        const ok = await dialogs.confirm(`A layer named "${trimmedName}" already exists. Do you want to overwrite it?`);
        if (!ok) return;
        isOverwrite = true;
      }

      setLayersState({ savingLayer: true });
      try {
        if (isOverwrite) {
          const { data } = await api.put(`/api/user-layers/${existingLayer._id}`, { name: trimmedName, geojson });
          setLayersState({ userLayers: useUserLayersStore.getState().userLayers.map((l) => (l._id === existingLayer._id ? data : l)) });
        } else {
          const { data } = await api.post('/api/user-layers', { name: trimmedName, geojson });
          setLayersState({ userLayers: [...useUserLayersStore.getState().userLayers, data] });
        }
        setApp({ showSaveLayerModal: false });
      } catch (err: any) {
        dialogs.alert(err?.response?.data?.message || 'Failed to save layer.');
      } finally {
        setLayersState({ savingLayer: false });
      }
    },
    [setApp, setLayersState],
  );

  const handleLoadLayer = useCallback(
    (layer: UserLayer) => {
      if (layer && layer.geojson) setApp({ userLayerToLoad: layer.geojson });
    },
    [setApp],
  );

  const handleDeleteLayer = useCallback(
    async (layer: UserLayer) => {
      if (!(await dialogs.confirm(`Delete layer "${layer.name}"?`, { variant: 'danger' }))) return;
      try {
        await api.delete(`/api/user-layers/${layer._id}`);
        setLayersState({ userLayers: useUserLayersStore.getState().userLayers.filter((l) => l._id !== layer._id) });
      } catch {
        dialogs.alert('Failed to delete layer.');
      }
    },
    [setLayersState],
  );

  return {
    userLayers,
    setUserLayers,
    showSaveLayerModal,
    setShowSaveLayerModal,
    showSavedLayersModal,
    setShowSavedLayersModal,
    saveLayerName,
    setSaveLayerName,
    savingLayer,
    setSavingLayer,
    userLayerToLoad,
    setUserLayerToLoad,
    handleSaveLayerClick,
    handleSaveLayerSubmit,
    handleLoadLayer,
    handleDeleteLayer,
    /** Convenience for the navigation menu (legacy `drawnGeoJson` prop). */
    drawnGeoJson: drawnLayerData,
    savedLayers: userLayers,
    refetchLayers: fetchLayers,
  };
}

export default useUserLayers;
