/**
 * Single source of truth for where the backend lives.
 * Production (unified host behind nginx) and Vite dev (proxy) both use same origin,
 * so VITE_API_URL is normally empty. Set it only for a split-host deployment.
 * Replaces the legacy scattered `|| 'http://localhost:5000'` / api-host fallbacks.
 */
export const apiBase = (): string => (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** URL to the backend. `path` must start with '/'. */
export const apiUrl = (path: string): string => `${apiBase()}${path}`;

/** URL for a static data file under a folder that may contain spaces: dataUrl('JSON Murabba', tehsil, `${mouza}.geojson`). */
export const dataUrl = (folder: string, ...segments: string[]): string =>
  apiUrl('/' + [folder, ...segments].map((s) => encodeURIComponent(s)).join('/'));

/** Origin for Socket.io (undefined = same origin). */
export const socketOrigin = (): string | undefined => apiBase() || undefined;

export const CLOUDFLARE_WORKER_URL =
  import.meta.env.VITE_CLOUDFLARE_WORKER_URL || 'https://pmtiles-worker.mallhintdr.workers.dev';
