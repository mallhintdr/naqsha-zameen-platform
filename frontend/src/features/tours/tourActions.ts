/** Store/auth replacements for the props legacy App.js passed into every tour. */
import { useAppStore } from '@/app/store';
import type { User } from '@/features/auth/AuthProvider';

export const setShowMenu = (v: boolean) => useAppStore.getState().set({ showMenu: v });

/** Legacy App.handleTehsilChange */
export async function changeTehsil(setActiveTehsil: (t: string) => Promise<void>, tehsil: string) {
  const st = useAppStore.getState();
  try {
    st.set({ mouzaLoading: true });
    await setActiveTehsil(tehsil);
    st.set({ selectedMauza: '', selectedMurabba: null, murabbaOptions: [], userLayerToLoad: null });
  } catch {
    /* ignore */
  } finally {
    useAppStore.getState().set({ mouzaLoading: false });
  }
}

/** First mouza for the active tehsil (legacy fallback chain). */
export function firstMouza(user: User | null): string | null {
  if (Array.isArray(user?.mauzaList) && user.mauzaList.length > 0) return user.mauzaList[0];
  if (user?.tehsilAccess?.length) {
    const active = user.tehsilAccess.find((t) => t.tehsil === user.activeTehsil) || user.tehsilAccess[0];
    if (active?.mouzas?.length) return active.mouzas[0];
  }
  return null;
}

export function selectMouza(user: User | null, mouza: string) {
  // legacy setSelectedMauza + handleMauzaChange
  useAppStore.getState().selectMauza(user?.activeTehsil || '', mouza);
}

/** Leaflet globals exposed by the map feature (legacy window.leafletMap / window.L). */
export const leaflet = (): { L: any; map: any } => ({ L: (window as any).L, map: (window as any).leafletMap });
