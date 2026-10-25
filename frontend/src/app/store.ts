/**
 * App-wide UI + map selection state (replaces the prop drilling in legacy App.js).
 * Every field and action name mirrors the legacy App.js state so ported components map 1:1.
 */
import { create } from 'zustand';
import { api } from '@/shared/api/client';
import { apiUrl } from '@/shared/api/base';
import { vectorFetch } from '@/shared/lib/vectorFetch';

export type AdminMapMode = 'auto' | 'geojson' | 'pmtiles';
export type TourType =
  | '' | 'welcome' | 'navigation' | 'killa' | 'baseLayers' | 'location' | 'goto' | 'compass' | 'drawing' | 'savedLayers'
  | 'notifications' | 'account' | 'changeMouza' | 'shift' | 'clearCache' | 'multiUse' | 'changePassword' | 'login';

export interface MurabbaOption { value: string; label: string; centroid?: [number, number] }
export interface GoToMarker { id: number; coords: [number, number] }

const readMode = (): AdminMapMode => {
  try {
    return (localStorage.getItem('admin_map_mode') as AdminMapMode) || 'auto';
  } catch {
    return 'auto';
  }
};

interface AppState {
  // ---- chrome / modals ----
  showMenu: boolean;
  showProfileModal: boolean;
  showChangePassword: boolean;
  showGoToForm: boolean;
  showShiftForm: boolean;
  showForgotPasswordModal: boolean;
  showSaveLayerModal: boolean;
  showSavedLayersModal: boolean;
  showWarningModal: boolean;
  /** Locked feature the limited user tapped (opens the Subscribe message). */
  subscribeFeature: string | null;

  // ---- "All Mouzas" browsing (docs/PUBLIC-BROWSE-PLAN.md) ----
  browseMode: 'mine' | 'all';
  /** Tehsil shown on the map in All Mouzas mode (the account's activeTehsil is unchanged). */
  browseTehsil: string | null;
  /** The open mouza is not in the subscription: preview (tiles, street map, locked features). */
  previewActive: boolean;
  /** Preview mouzas left today (from /api/me/browse/mouzas), null = unknown. */
  previewLeft: number | null;
  previewLimit: number | null;
  warningDismissed: boolean;
  showIPWarningModal: boolean;
  ipWarningDismissed: boolean;
  tourType: TourType;
  runTour: boolean;

  // ---- map selection ----
  selectedMauza: string;
  murabbaOptions: (string | MurabbaOption)[];
  selectedMurabba: string | null;
  shajraEnabled: boolean;
  shajraVisible: boolean;
  shiftResult: any;
  pmtilesOffset: { lat: number; lng: number } | null;
  goToMarkers: GoToMarker[];
  baseLayer: string;
  mouzaLoading: boolean;
  murabbaLoading: boolean;

  // ---- admin map toggles ----
  testMode: boolean;
  killaMeasurement: boolean;
  forceMobileMode: boolean;
  adminMapMode: AdminMapMode;

  // ---- drawing / saved layers ----
  drawnLayerData: any;
  userLayerToLoad: any;
  saveLayerName: string;

  set: (p: Partial<AppState>) => void;
  toggleMenu: () => void;
  setAdminMapMode: (m: AdminMapMode) => void;
  toggleMobileMode: () => void;
  resetMapSelection: () => void;
  /** Legacy handleMauzaChange: select a mouza, fetch its metadata into shiftResult. */
  selectMauza: (tehsil: string, mouza: string) => Promise<void>;
  /** Legacy offset fetch effect. */
  fetchOffset: (tehsil: string, mouza: string) => Promise<void>;
  addGoToMarker: (lat: number, lng: number) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  showMenu: false,
  showProfileModal: false,
  showChangePassword: false,
  showGoToForm: false,
  showShiftForm: false,
  showForgotPasswordModal: false,
  showSaveLayerModal: false,
  showSavedLayersModal: false,
  subscribeFeature: null,
  browseMode: 'mine',
  browseTehsil: null,
  previewActive: false,
  previewLeft: null,
  previewLimit: null,
  showWarningModal: false,
  warningDismissed: false,
  showIPWarningModal: false,
  ipWarningDismissed: false,
  tourType: '',
  runTour: false,

  selectedMauza: '',
  murabbaOptions: [],
  selectedMurabba: null,
  shajraEnabled: false,
  shajraVisible: false,
  shiftResult: null,
  pmtilesOffset: null,
  goToMarkers: [],
  baseLayer: 'Google Hybrid Satellite',
  mouzaLoading: false,
  murabbaLoading: false,

  testMode: false,
  killaMeasurement: false,
  forceMobileMode: false,
  adminMapMode: readMode(),

  drawnLayerData: null,
  userLayerToLoad: null,
  saveLayerName: '',

  set: (p) => set(p),
  toggleMenu: () => set((s) => ({ showMenu: !s.showMenu })),
  setAdminMapMode: (m) => {
    try {
      localStorage.setItem('admin_map_mode', m);
    } catch {}
    set({ adminMapMode: m });
  },
  toggleMobileMode: () => {
    const turningOn = !get().forceMobileMode;
    set({ forceMobileMode: turningOn });
    if (turningOn) get().setAdminMapMode('geojson');
  },
  resetMapSelection: () =>
    set({ selectedMauza: '', selectedMurabba: null, murabbaOptions: [], shajraEnabled: false, shajraVisible: false, shiftResult: null, previewActive: false }),

  selectMauza: async (tehsil, mouza) => {
    set({ selectedMauza: mouza, selectedMurabba: null, murabbaOptions: [], shajraEnabled: false, shajraVisible: false, murabbaLoading: true, userLayerToLoad: null });
    try {
      const res = await vectorFetch(apiUrl(`/Metadata/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}.json`));
      if (!res.ok) throw new Error(`metadata ${res.status}`);
      const data = await res.json();
      set({ shiftResult: { mouza, tehsil, geojson: `${tehsil}/${mouza}.json`, murabbaSummary: data?.murabbas || null, timestamp: Date.now() } });
    } catch {
      /* metadata optional */
    } finally {
      set({ murabbaLoading: false });
    }
  },

  fetchOffset: async (tehsil, mouza) => {
    if (!tehsil || !mouza) {
      set({ pmtilesOffset: { lat: 0, lng: 0 } });
      return;
    }
    try {
      const { data } = await api.get(`/api/geo/adjustment/${encodeURIComponent(tehsil)}/${encodeURIComponent(mouza)}`);
      set({ pmtilesOffset: { lat: data?.latOffset || 0, lng: data?.lngOffset || 0 } });
    } catch {
      set({ pmtilesOffset: { lat: 0, lng: 0 } });
    }
  },

  addGoToMarker: (lat, lng) => set((s) => ({ goToMarkers: [...s.goToMarkers, { id: Date.now(), coords: [lat, lng] }] })),
}));
