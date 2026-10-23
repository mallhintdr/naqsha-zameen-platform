// Port of StatsTabs/VisitorsTab.js — self-loading, mounted on first visit.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line, Legend } from 'recharts';
import { api, errText } from '@/shared/api/client';
import { Alert, Spinner } from '@/shared/ui';
import { legendFormatter, useIsSmallScreen } from '../statsUtils';

const n = (v: any) => Number(v || 0).toLocaleString('en-PK');
const shortDay = (d: any) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const shortMonth = (m: any) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

const WINDOWS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'd7', label: 'Last 7 days' },
  { key: 'd30', label: 'Last 30 days' },
  { key: 'd180', label: 'Last 180 days' },
  { key: 'd365', label: 'Last 365 days' },
];

export default function VisitorsTab() {
  const small = useIsSmallScreen();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: d } = await api.get('/stats/visitors', { params: { p: 'home' } });
      setData(d);
    } catch (e) {
      setError(errText(e, 'Failed to load visitors'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!data && loading) return <div className="flex items-center justify-center gap-2 py-10 text-ink-2"><Spinner size="sm" /> Loading visitors…</div>;

  const w = data?.windows || {};
  const daily = data?.daily || [];
  const monthly = data?.monthly || [];
  const avg30 = Math.round((w.d30?.visitors || 0) / 30);

  return (
    <div className="mt-4">
      {error && <Alert variant="danger" className="mb-3">{error}</Alert>}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h5 className="m-0 text-lg font-bold text-teal-ink">Website visitors</h5>
          <div className="text-sm text-ink-2">Website home page · unique visitors (page views) · avg {n(avg30)} visitors/day over 30 days</div>
        </div>
        <button className="btn btn-sm btn-outline-primary" onClick={load} disabled={loading}>
          {loading ? <Spinner size="sm" /> : <><RefreshCw size={13} />Refresh</>}
        </button>
      </div>

      <div className="tile-row-visitors mb-3">
        {WINDOWS.map((x) => (
          <div key={x.key} className="card-plain h-full px-1 py-2 text-center">
            <div className="text-[0.68rem] font-bold uppercase text-ink-2" style={{ letterSpacing: '0.4px' }}>{x.label}</div>
            <div className="text-[1.35rem] font-bold text-[#0d6efd]">{n(w[x.key]?.visitors)}</div>
            <div className="text-[0.72rem] text-ink-2">{n(w[x.key]?.views)} page views</div>
          </div>
        ))}
      </div>

      <div className="card-plain mb-3 p-4 max-md:p-2">
        <div className="mb-2 text-center"><h6 className="m-0 font-bold text-teal-ink">Daily visitors</h6><div className="text-sm text-ink-2">Last 30 days</div></div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={daily} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            {/* A date every few days only (about 5 on phones, 10 on larger screens); each bar's tooltip still shows its exact day. */}
            <XAxis dataKey="date" tickFormatter={shortDay} interval={Math.max(0, Math.ceil(daily.length / (small ? 5 : 10)) - 1)} tick={{ fontSize: 10 }} tickMargin={6} height={28} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={shortDay} />
            <Legend verticalAlign="top" height={24} formatter={legendFormatter} />
            <Bar dataKey="visitors" name="Visitors" fill="#0d6efd" radius={[3, 3, 0, 0]} />
            <Line dataKey="views" name="Page views" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="card-plain mb-3 p-4 max-md:p-2">
        <div className="mb-2 text-center"><h6 className="m-0 font-bold text-teal-ink">Monthly growth</h6><div className="text-sm text-ink-2">Last 12 months</div></div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={monthly} margin={{ top: 5, right: 10, left: -10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tickFormatter={shortMonth} angle={-45} textAnchor="end" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={shortMonth} />
            <Bar dataKey="visitors" name="Visitors" fill="#10b981" radius={[3, 3, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="table-wrap mt-2 max-h-[260px]">
          <table className="table table-hover text-[0.78rem]">
            <thead><tr><th>Month</th><th>Visitors</th><th>Page views</th></tr></thead>
            <tbody>
              {monthly.length ? (
                [...monthly].reverse().map((m: any) => (
                  <tr key={m.month}><td>{shortMonth(m.month)}</td><td className="text-center font-semibold">{n(m.visitors)}</td><td className="text-center">{n(m.views)}</td></tr>
                ))
              ) : (
                <tr><td colSpan={3} className="py-3 text-center text-ink-2">No visits recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[0.72rem] text-ink-2">All-time: {n(w.all?.visitors)} visitors, {n(w.all?.views)} page views. Bots and link previews are not counted.</div>
    </div>
  );
}
