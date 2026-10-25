/**
 * Website links open a mouza in "All Mouzas" preview:
 *   https://dashboard.naqsha-zameen.com/?browse=all&t=<tehsil>&m=<mouza>
 * (site/src/pages/maps/...). The request is kept in localStorage for an hour so it
 * survives the login page and registration / email activation, then applied once the
 * user is logged in.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from '@/app/store';
import { api } from '@/shared/api/client';

const KEY = 'nz_pending_browse';
const TTL_MS = 60 * 60e3;

/** The pending preview from a website link, if any (shown on the login page). */
export function pendingBrowse(): { t: string; m: string } | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!p?.t || Date.now() - (p.at || 0) > TTL_MS) return null;
    return { t: p.t, m: p.m || '' };
  } catch {
    return null;
  }
}

// Capture at load, before any route redirect (e.g. to /login) drops the query string.
(() => {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('browse') !== 'all' || !q.get('t')) return;
    localStorage.setItem(KEY, JSON.stringify({ t: q.get('t'), m: q.get('m') || '', at: Date.now() }));
    q.delete('browse'); q.delete('t'); q.delete('m');
    const rest = q.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  } catch { /* private mode */ }
})();

export function useBrowseDeepLink() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!user || location.pathname !== '/') return;
    const pending = pendingBrowse();
    if (!pending) return;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    const { t, m } = pending;
    const st = useAppStore.getState();
    st.resetMapSelection();
    st.set({ browseMode: 'all', browseTehsil: t });
    if (!m) return;
    api.get(`/api/me/browse/mouzas/${encodeURIComponent(t)}`)
      .then(({ data }) => {
        const row = (data?.mouzas || []).find((r: any) => String(r.name).toLowerCase() === m.toLowerCase());
        if (!row) return;
        if (data?.preview) st.set({ previewLeft: data.preview.left, previewLimit: data.preview.limit });
        st.set({ previewActive: !(row.own || user.userType === 'admin') });
        useAppStore.getState().selectMauza(t, row.name);
      })
      .catch(() => {});
  }, [user, location.pathname]);
}
