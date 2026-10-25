/**
 * Website links open a mouza in "All Mouzas" mode:
 *   https://dashboard.naqsha-zameen.com/?browse=all&t=<tehsil>&m=<mouza>
 * (site/src/pages/maps/...). The request is kept in sessionStorage across the login /
 * registration step, then applied once the user is logged in.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppStore } from '@/app/store';
import { api } from '@/shared/api/client';

const KEY = 'nz_pending_browse';

export function useBrowseDeepLink() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // 1. Capture ?browse=all&t=&m= and clean the address bar.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('browse') !== 'all' || !q.get('t')) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ t: q.get('t'), m: q.get('m') || '' })); } catch { /* private mode */ }
    navigate(location.pathname, { replace: true });
  }, [location.search, location.pathname, navigate]);

  // 2. Apply it once logged in.
  useEffect(() => {
    if (!user) return;
    let pending: { t: string; m: string } | null;
    try { pending = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { pending = null; }
    if (!pending?.t) return;
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
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
  }, [user]);
}
