// /admin/subadmins — legacy AdminSubAdminConsole.js ("Sub-admins").
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { Cog, House, Inbox, Tags, Trophy, UserCog } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';
import { Alert, Button, Spinner, StatTile, cn, type Tone } from '@/shared/ui';
import { api, errText, rs, SUBADMIN_STATUS } from '@/features/subadmin/subAdminApi';
import { COLORS, Panel } from '@/features/admin/insights/statsUtils';
import { RequestsTable, StatusBadge, axisTick, tabTitle } from './shared';
import AppointModal from './AppointModal';
import DetailModal from './DetailModal';
import PricingTab from './PricingTab';
import SettingsTab from './SettingsTab';

const ROW_TONE = {
  red: { bg: 'rgba(239, 68, 68, 0.12)', solid: '#f8d7da', border: '#ef4444' },
  yellow: { bg: 'rgba(245, 158, 11, 0.12)', solid: '#fff3cd', border: '#f59e0b' },
  green: { bg: 'rgba(16, 185, 129, 0.12)', solid: '#d1e7dd', border: '#10b981' },
};
const rowTone = (s: any) => ROW_TONE[s.status === 'disabled' ? 'red' : s.overdue > 0 ? 'yellow' : 'green'];
const toneVars = (s: any) => {
  const t = rowTone(s);
  return { '--row-bg': t.bg, '--row-solid': t.solid, '--row-border': t.border } as CSSProperties;
};
const STATUS_COLOR: Record<string, string> = { active: '#10b981', awaiting_activation: '#0dcaf0', final_warning: '#f59e0b', suspended_unpaid: '#dc3545', disabled: '#6c757d' };
const LIST_PAGE_SIZE = 20;
const FILTER_INPUT = '!h-9 !text-[0.9rem] !rounded-md !py-1';

export default function AdminSubAdminConsolePage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [overview, setOverview] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [rank, setRank] = useState<any>(null);
  const [rankBy, setRankBy] = useState('revenue');
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
  const [showAppoint, setShowAppoint] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('list');
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [l, o, r] = await Promise.all([api.get('/api/admin/subadmins'), api.get('/api/admin/subadmins-overview'), api.get('/api/admin/subadmin-requests', { status: 'pending' })]);
      setRows(l.subAdmins);
      setOverview(o);
      setRequests(r.requests);
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  const loadRank = useCallback(
    () => api.get('/api/admin/subadmins-rankings', { ...range, by: rankBy }).then(setRank).catch((e) => setError(errText(e))),
    [range, rankBy],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadRank();
  }, [loadRank]);

  const [lf, setLf] = useState({ status: 'all', search: '', tehsil: '', money: '' });
  const [listPage, setListPage] = useState(1);
  const setL = (k: string, v: string) => {
    setLf((p) => ({ ...p, [k]: v }));
    setListPage(1);
  };
  const statusCount = (s: string) => (rows || []).filter((r) => s === 'all' || r.status === s).length;
  const allTehsils = [...new Set((rows || []).flatMap((r) => r.territory || []))].sort() as string[];
  const shown = (rows || []).filter((s) => {
    if (lf.status !== 'all' && s.status !== lf.status) return false;
    const q = lf.search.trim().toLowerCase();
    if (q && ![s.userId, s.userName, s.mobileNumber, s.email].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    if (lf.tehsil && !(s.territory || []).includes(lf.tehsil)) return false;
    if (lf.money === 'overdue' && !(s.overdue > 0)) return false;
    if (lf.money === 'owed' && !(s.balance > 0)) return false;
    if (lf.money === 'clear' && s.balance > 0) return false;
    return true;
  });
  const lfActive = !!(lf.search || lf.tehsil || lf.money || lf.status !== 'all');
  const listPages = Math.max(1, Math.ceil(shown.length / LIST_PAGE_SIZE));
  const curPage = Math.min(listPage, listPages);
  const pageRows = shown.slice((curPage - 1) * LIST_PAGE_SIZE, curPage * LIST_PAGE_SIZE);

  const byStatus = rows
    ? Object.entries(rows.reduce((acc: any, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {})).map(([status, count]) => ({ status, name: (SUBADMIN_STATUS[status] || [status])[0], count }))
    : [];
  const money = (rows || []).map((s) => ({ name: s.userName || s.userId, billed: s.billedTotal ?? s.billedThisMonth ?? 0, paid: s.paidTotal || 0, owed: Math.max(0, s.balance || 0) }));
  const people = (rows || []).map((s) => ({ name: s.userName || s.userId, active: s.active || 0, awaiting: s.awaiting || 0, expiring: s.expiring || 0 }));

  const TABS = [
    { key: 'list', title: tabTitle(UserCog, 'primary', `All Sub-admins${rows ? ` (${rows.length})` : ''}`) },
    { key: 'requests', title: tabTitle(Inbox, requests.length ? 'danger' : 'info', `Pending Requests (${requests.length})`) },
    { key: 'ranking', title: tabTitle(Trophy, 'warning', 'Ranking') },
    { key: 'pricing', title: tabTitle(Tags, 'danger', 'Pricing') },
    { key: 'settings', title: tabTitle(Cog, 'secondary', 'Your Payment Details & Policy') },
  ];

  const tiles = () => {
    if (!rows) return <div className="py-10 text-center"><Spinner /></div>;
    const sum = (k: string) => rows.reduce((n, s) => n + (Number(s[k]) || 0), 0);
    const t = (label: string, value: any, tone: Tone, onClick?: () => void) => (
      <div><StatTile tone={tone} value={value} label={label} onClick={onClick} /></div>
    );
    return (
      <div className="tile-row mb-3">
        {t('Sub-admins', rows.length, 'primary', () => setTab('list'))}
        {t('Customers managed', sum('customers'), 'success', () => navigate('/users?owner=subadmins'))}
        {t('Pending requests', overview?.pendingRequests ?? requests.length, 'info', () => setTab('requests'))}
        {t('On warning / suspended', overview?.subAdminsInArrears ?? 0, overview?.subAdminsInArrears ? 'danger' : 'secondary')}
        {t('Billed today', rs(overview?.todayTotal), 'info')}
        {t('Billed this month', rs(sum('billedThisMonth')), 'primary')}
        {t('Total owed', rs(sum('balance')), 'warning')}
        {t('Total overdue', rs(sum('overdue')), sum('overdue') ? 'danger' : 'secondary')}
      </div>
    );
  };

  const listPane = !rows ? (
    <Spinner className="mt-3" />
  ) : (
    <>
      <div className="mb-2 flex w-full flex-wrap items-end gap-2">
        <div className="min-w-0 flex-[1_1_180px]">
          <label className="mb-0.5 block text-[0.85rem] font-medium">Status</label>
          <select className={cn('select', FILTER_INPUT)} value={lf.status} onChange={(e) => setL('status', e.target.value)}>
            {[['all', 'All statuses'], ['active', 'Active'], ['awaiting_activation', 'Awaiting activation'], ['final_warning', 'Final warning'], ['suspended_unpaid', 'Suspended (unpaid)'], ['disabled', 'Disabled']].map(([k, l]) => (
              <option key={k} value={k}>{l} ({statusCount(k)})</option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-[2_1_220px]">
          <label className="mb-0.5 block text-[0.85rem] font-medium">Search</label>
          <div className="relative">
            <input className={cn('input', FILTER_INPUT, lf.search && '!pr-8')} placeholder="ID, name, mobile or email..." value={lf.search} onChange={(e) => setL('search', e.target.value)} />
            {lf.search && <button type="button" className="input-clear-btn-red" onClick={() => setL('search', '')} aria-label="Clear search">✕</button>}
          </div>
        </div>
        <div className="min-w-0 flex-[1_1_160px]">
          <label className="mb-0.5 block text-[0.85rem] font-medium">Territory</label>
          <select className={cn('select', FILTER_INPUT)} value={lf.tehsil} onChange={(e) => setL('tehsil', e.target.value)}>
            <option value="">All tehsils</option>
            {allTehsils.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="min-w-0 flex-[1_1_160px]">
          <label className="mb-0.5 block text-[0.85rem] font-medium">Money</label>
          <select className={cn('select', FILTER_INPUT)} value={lf.money} onChange={(e) => setL('money', e.target.value)}>
            <option value="">Any</option><option value="overdue">Has overdue bills</option><option value="owed">Owes money</option><option value="clear">Fully paid</option>
          </select>
        </div>
        <Button variant="outline-secondary" size="sm" className="h-9" disabled={!lfActive} onClick={() => { setLf({ status: 'all', search: '', tehsil: '', money: '' }); setListPage(1); }}>
          Clear filters
        </Button>
      </div>

      <div className="card-plain p-3 max-sm:p-2">
        {/* Desktop / tablet: table with sticky header + first column */}
        <div className="table-wrap max-h-[calc(100dvh-260px)] max-sm:hidden">
          <table className="table table-hover text-[0.85rem] whitespace-nowrap">
            <thead>
              <tr>
                <th className="freeze !bg-[#e2e8f0] !text-[#1f2937] min-w-[180px]">Sub-admin</th>
                <th>Status</th><th>Customers</th><th>Active</th><th>Sales (30 days)</th><th className="!text-right">Money owed</th><th className="!text-right">Money paid</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length ? (
                pageRows.map((s) => (
                  <tr key={s.userId} className="tone-row cursor-pointer" style={toneVars(s)} onClick={() => setDetailId(s.userId)}>
                    <td className="freeze min-w-[180px]">{s.userName} ({s.userId})</td>
                    <td className="text-center"><StatusBadge s={s.status} /></td>
                    <td className="text-center">{s.customers}</td>
                    <td className="text-center">{s.active}</td>
                    <td className="text-center">{s.salesThisMonth || 0}</td>
                    <td className={cn('text-right', s.overdue > 0 && 'text-[#dc3545]')}>{rs(s.balance)}</td>
                    <td className="text-right text-[#198754]">{rs(s.paidTotal)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="py-3 text-center text-ink-2">{rows.length ? 'No sub-admins match the filters.' : 'No sub-admins yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Phones: card list with the same row tones */}
        <div className="flex flex-col gap-2 sm:hidden">
          {pageRows.length ? (
            pageRows.map((s) => {
              const t = rowTone(s);
              return (
                <button
                  key={s.userId}
                  type="button"
                  onClick={() => setDetailId(s.userId)}
                  className="min-h-[44px] rounded-lg p-2 text-left text-[0.85rem]"
                  style={{ background: t.bg, borderLeft: `4px solid ${t.border}` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="min-w-0 truncate text-[#002366]">{s.userName} ({s.userId})</strong>
                    <StatusBadge s={s.status} />
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1 text-[0.78rem] text-teal-ink">
                    <span>Customers: <b>{s.customers}</b></span>
                    <span>Active: <b>{s.active}</b></span>
                    <span>Sales: <b>{s.salesThisMonth || 0}</b></span>
                    <span className={cn('col-span-3 sm:col-span-1', s.overdue > 0 && 'text-[#dc3545]')}>Owed: <b>{rs(s.balance)}</b> · <span className="text-[#198754]">Paid: <b>{rs(s.paidTotal)}</b></span></span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="py-3 text-center text-ink-2">{rows.length ? 'No sub-admins match the filters.' : 'No sub-admins yet.'}</div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-ink-2">
            Showing {shown.length ? (curPage - 1) * LIST_PAGE_SIZE + 1 : 0}–{(curPage - 1) * LIST_PAGE_SIZE + pageRows.length} of {shown.length}
            {shown.length !== rows.length ? ` (filtered from ${rows.length})` : ''} sub-admin(s). Click a row to open bills, payments, settings and history.
          </div>
          {listPages > 1 && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline-primary" disabled={curPage === 1} onClick={() => setListPage(1)}>«</Button>
              <Button size="sm" variant="outline-primary" disabled={curPage === 1} onClick={() => setListPage(curPage - 1)}>‹</Button>
              <span className="px-2 text-sm">Page {curPage} of {listPages}</span>
              <Button size="sm" variant="outline-primary" disabled={curPage === listPages} onClick={() => setListPage(curPage + 1)}>›</Button>
              <Button size="sm" variant="outline-primary" disabled={curPage === listPages} onClick={() => setListPage(listPages)}>»</Button>
            </div>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <Panel title="Billing by Sub-admin">
              <ResponsiveContainer width="100%" height={Math.max(220, 70 + money.length * 70)}>
                <BarChart data={money} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e0e0e0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fontWeight: 600 }} />
                  <Tooltip formatter={(v: any) => rs(v)} />
                  <Legend />
                  <Bar dataKey="billed" name="Billed (total)" fill={COLORS[0]} radius={[0, 4, 4, 0]} maxBarSize={18} />
                  <Bar dataKey="paid" name="Paid" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={18} />
                  <Bar dataKey="owed" name="Owed" fill="#f59e0b" radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>
          <div>
            <Panel title="Sub-admins by Status">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={byStatus} dataKey="count" nameKey="name" outerRadius={80} label={({ name, count }: any) => `${name}: ${count}`}>
                    {byStatus.map((s, i) => <Cell key={s.status} fill={STATUS_COLOR[s.status] || COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Panel>
          </div>
          <div className="md:col-span-3">
            <Panel title="Customers by Sub-admin">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={people} margin={{ top: 15, right: 5, left: -25, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                  <XAxis dataKey="name" tick={axisTick} />
                  <YAxis allowDecimals={false} tick={axisTick} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="active" name="Active" stackId="c" fill="#10b981" />
                  <Bar dataKey="expiring" name="Expiring (7 days)" stackId="c" fill="#f59e0b" />
                  <Bar dataKey="awaiting" name="Awaiting activation" stackId="c" fill="#0dcaf0" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>
        </div>
      )}
    </>
  );

  const rankingPane = (
    <div className="card-plain p-3 max-sm:p-2">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <div><label className="block text-sm">From</label><input className="input input-sm" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></div>
        <div><label className="block text-sm">To</label><input className="input input-sm" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></div>
        <div>
          <label className="block text-sm">Rank by</label>
          <select className="select select-sm" value={rankBy} onChange={(e) => setRankBy(e.target.value)}>
            <option value="revenue">Platform revenue</option><option value="activeCustomers">Active customers</option><option value="newCustomers">New customers</option><option value="renewals">Renewals</option>
          </select>
        </div>
      </div>
      <div className="table-wrap mt-2">
        <table className="table sticky-list whitespace-nowrap">
          <thead>
            <tr><th>#</th><th>Sub-admin</th><th className="!text-right">Platform revenue</th><th className="!text-right">New customers</th><th className="!text-right">Activations</th><th className="!text-right">Renewals</th><th className="!text-right">Active now</th></tr>
          </thead>
          <tbody>
            {rank?.rankings?.map((r: any) => (
              <tr key={r.userId}>
                <td>{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
                <td>{r.userName} <span className="text-sm text-ink-2">{r.userId}</span></td>
                <td className="text-right font-bold">{rs(r.revenue)}</td>
                <td className="text-right">{r.newCustomers}</td>
                <td className="text-right">{r.activations}</td>
                <td className="text-right">{r.renewals}</td>
                <td className="text-right">{r.activeCustomers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rank?.rankings?.length > 0 && (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rank.rankings.map((r: any) => ({ name: r.userName || r.userId, revenue: r.revenue || 0 }))} margin={{ top: 15, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
            <XAxis dataKey="name" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip formatter={(v: any) => rs(v)} />
            <Legend />
            <Bar dataKey="revenue" name="Platform revenue" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  return (
    <div className="page stats-page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="page-title m-0">Sub-admins</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline-primary" size="sm" onClick={() => navigate('/')}><House size={14} /> Home</Button>
          <Button variant="outline-success" size="sm" onClick={() => navigate('/users?owner=subadmins')}>Their customers</Button>
          <Button size="sm" onClick={() => setShowAppoint(true)}>+ Appoint sub-admin</Button>
        </div>
      </div>
      {error && <Alert variant="danger" onClose={() => setError(null)} className="mb-3">{error}</Alert>}

      {/* Tabs first, then the info cards, then the selected tab */}
      <div className="tabs sa-page-tabs !mb-3" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" className={cn('tab', tab === t.key && 'active')} onClick={() => setTab(t.key)}>{t.title}</button>
        ))}
      </div>
      {tiles()}
      {tab === 'list' && listPane}
      {tab === 'requests' && (
        <div className="card-plain p-3 max-sm:p-2"><RequestsTable rows={requests} onChanged={load} /></div>
      )}
      {tab === 'ranking' && rankingPane}
      {tab === 'pricing' && <div className="card-plain p-3 max-sm:p-2"><PricingTab /></div>}
      {tab === 'settings' && <div className="card-plain p-3 max-sm:p-2"><SettingsTab /></div>}

      <AppointModal show={showAppoint} onHide={() => setShowAppoint(false)} onDone={load} />
      {detailId && <DetailModal userId={detailId} onHide={() => setDetailId(null)} onChanged={load} />}
    </div>
  );
}
