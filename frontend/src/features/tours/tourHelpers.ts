/** Small helpers shared by the newer tours. */
import { useAppStore } from '@/app/store';
import type { User } from '@/features/auth/AuthProvider';
import { firstMouza, leaflet, selectMouza } from './tourActions';

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until `test()` returns truthy (or the timeout passes). */
export async function waitFor<T>(test: () => T, timeout = 8000, every = 200): Promise<T | null> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = test();
    if (v) return v;
    await wait(every);
  }
  return null;
}

/** Set a React-controlled input's value so its onChange fires. */
export function typeInto(el: Element | null, value: string) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}

export const click = (el: Element | null) => (el as HTMLElement | null)?.click();

export const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

/** Make sure a chak is selected (first one the user can access); returns its name. */
export async function ensureMouza(user: User | null): Promise<string | null> {
  const st = useAppStore.getState();
  if (st.selectedMauza) return st.selectedMauza;
  const m = firstMouza(user);
  if (!m) return null;
  selectMouza(user, m);
  await wait(500);
  return m;
}

/** Make sure a murabba is selected once the list has loaded; returns its value. */
export async function ensureMurabba(): Promise<string | null> {
  const st = useAppStore.getState();
  if (st.selectedMurabba) return st.selectedMurabba;
  const opts = await waitFor(() => {
    const o = useAppStore.getState().murabbaOptions;
    return Array.isArray(o) && o.length ? o : null;
  }, 15000);
  if (!opts) return null;
  const item: any = opts[Math.min(Math.floor(opts.length / 3), opts.length - 1)];
  const value = String(typeof item === 'object' ? item.value || item.label : item);
  useAppStore.getState().set({ selectedMurabba: value });
  return value;
}

/**
 * Tap the map until a killa opens: retries while the killa layer is still loading and tries
 * points around the centre in case the centre falls on a road. Returns true when the area box shows.
 */
export async function openKillaNearCentre(timeout = 12000): Promise<boolean> {
  const { map } = leaflet();
  if (!map) return false;
  const size = map.getSize();
  const offsets = [[0, 0], [0.12, 0.08], [-0.12, -0.08], [0.1, -0.12], [-0.1, 0.12], [0.2, 0], [-0.2, 0], [0, 0.18], [0, -0.18]];
  const end = Date.now() + timeout;
  let i = 0;
  while (Date.now() < end) {
    if (document.querySelector('.killa-area-info-box')) return true;
    const [fx, fy] = offsets[i++ % offsets.length];
    const containerPoint = { x: size.x * (0.5 + fx), y: size.y * (0.5 + fy) };
    const pt = (window as any).L?.point ? (window as any).L.point(containerPoint.x, containerPoint.y) : containerPoint;
    const latlng = map.containerPointToLatLng(pt);
    map.fire('click', { latlng, containerPoint: pt, layerPoint: map.containerPointToLayerPoint(pt), originalEvent: {} });
    await wait(900);
  }
  return Boolean(document.querySelector('.killa-area-info-box'));
}

/** Simulate a tap on the map at its centre (used to open killa details). */
export function tapMapCentre() {
  const { map } = leaflet();
  if (!map) return false;
  const latlng = map.getCenter();
  const containerPoint = map.latLngToContainerPoint(latlng);
  map.fire('click', { latlng, containerPoint, layerPoint: map.containerPointToLayerPoint(containerPoint), originalEvent: {} });
  return true;
}
