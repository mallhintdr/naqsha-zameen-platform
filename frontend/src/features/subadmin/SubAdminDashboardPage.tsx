// Sub-admin dashboard "My Business" (legacy SubAdminDashboard.js). Route /subadmin.
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Line, PieChart, Pie, Cell, ComposedChart } from 'recharts';
import { LineChart as LineIcon, Receipt, RefreshCw, Globe, Inbox, Wallet, Home } from 'lucide-react';
import { Alert, Badge, PageSpinner, StatTile, Tabs, type Tone } from '@/shared/ui';
import RenewalsTab from '@/features/admin/insights/tabs/RenewalsTab';
import {
  COLORS, DarkHeader, NumberPager, Panel, bucketRenewalsByGranularity, getRenewalViewConfig, useIsSmallScreen,
} from '@/features/admin/insights/statsUtils';
import { api, errText, rs, fmtDate, fmtDateTime } from './subAdminApi';
import { WriteBlockedBanner } from './SubAdminUsersPage';
import CopyMouzaListButton from './CopyMouzaListButton';

// ── Performance over time ───────────────────────────────────────────────
const PERF_VIEWS = [
  { key: '7d', label: '7 Days', days: 7, unit: 'day' },
  { key: '30d', label: '30 Days', days: 30, unit: 'day' },
  { key: '90d', label: '90 Days', days: 90, unit: 'week' },
  { key: '180d', label: '6 Months', days: 180, unit: 'month' },
  { key: '365d', label: '12 Months', days: 365, unit: 'month' },
];
const pkDate = (d: any) => new Date(new Date(d).getTime() + 5 * 3600e3); // Pakistan calendar
function bucketKey(d: any, unit: string) {
  const p = pkDate(d);
  if (unit === 'month') return p.toISOString().slice(0, 7);
  if (unit === 'week') {
    const m = new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()));
    m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
    return m.toISOString().slice(0, 10);
  }
  return p.toISOString().slice(0, 10);
}
function bucketLabel(key: string, unit: string) {
  if (unit === 'month') return new Date(key + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const d = new Date(key + 'T00:00:00Z');
  return (unit === 'week' ? 'Wk ' : '') + d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

/** Renewal Activity & Revenue (admin Renewals tab) for one sub-admin.
 *  revenueField: 'fee' (sub-admin's view) | 'platformPrice' (what the platform billed). */
export function SubAdminRenewalsPanel({ stats, revenueField = 'fee' }: { stats: any; revenueField?: string }) {
  const [view, setView] = useState('30d');
  const [visibility, setVisibility] = useState({ count: true, revenue: true });
  const analysis = useMemo(() => {
    const now = Date.now();
    const rows = (stats.recentRenewals || []).map((r: any) => ({
      userId: r.userId, userName: r.userName || r.userId, subscriptionType: r.subscriptionType, date: r.date, fee: Number(r[revenueField]) || 0,
    }));
    const within = (days: number) => rows.filter((r: any) => new Date(r.date).getTime() >= now - days * 86400e3);
    const prior = (days: number) => rows.filter((r: any) => { const x = new Date(r.date).getTime(); return x >= now - 2 * days * 86400e3 && x < now - days * 86400e3; });
    const sum = (l: any[]) => l.reduce((n, r) => n + (r.fee || 0), 0);
    const pct = (a: number, b: number) => (!b ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 100));
    const { rangeDays, granularity } = getRenewalViewConfig(view);
    const out: any = { dailyRenewals: bucketRenewalsByGranularity(within(rangeDays), granularity) };
    [7, 30, 90, 180].forEach((d) => {
      out[`last${d}Days`] = within(d);
      out[`revenue${d}d`] = sum(within(d));
      out[`growthPct${d}d`] = pct(sum(within(d)), sum(prior(d)));
    });
    return out;
  }, [stats, view, revenueField]);
  const o = stats.overview || {};
  const processedStats = { subscriptionHealth: { active: o.active || 0, expired: o.expired || 0, expiringSoon: o.expiring || 0, pending: o.awaiting || 0 } };
  return (
    <RenewalsTab processedStats={processedStats} renewalAnalysis={analysis} renewalsVisibility={visibility}
      setRenewalsVisibility={setVisibility} renewalView={view} setRenewalView={setView} />
  );
}

/** Checkbox chips that switch chart series on/off, each with its total. */
function SeriesChecks({ items, visible, setVisible }: { items: { key: string; label: string; value?: ReactNode; color: string }[]; visible: Record<string, boolean>; setVisible: (fn: (v: any) => any) => void }) {
  return (
    <div className="mb-2 flex flex-wrap justify-center gap-2">
      {items.map((it) => (
        <label key={it.key} className="flex items-center gap-1 rounded-full border px-2 py-1"
          style={{ cursor: 'pointer', userSelect: 'none', fontSize: '0.78rem', fontWeight: 600, background: visible[it.key] ? '#f8fafc' : '#fff', opacity: visible[it.key] ? 1 : 0.55, borderColor: it.color }}>
          <input type="checkbox" checked={!!visible[it.key]} onChange={() => setVisible((v) => ({ ...v, [it.key]: !v[it.key] }))} style={{ accentColor: it.color, cursor: 'pointer' }} />
          <span style={{ color: '#334155' }}>{it.label}</span>
          {it.value !== undefined && <span style={{ color: it.color }}>{it.value}</span>}
        </label>
      ))}
    </div>
  );
}

function BtnGroup({ options, value, onChange }: { options: { key: any; label: string }[]; value: any; onChange: (k: any) => void }) {
  return (
    <div className="btn-group renewal-view-buttons">
      {options.map((o) => (
        <button key={o.key} className={`btn btn-sm ${value === o.key ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

export function PerformancePanel({ stats }: { stats: any }) {
  const [view, setView] = useState('30d');
  const [show, setShow] = useState<Record<string, boolean>>({ created: true, renewals: true, billed: true });
  const small = useIsSmallScreen();
  const v = PERF_VIEWS.find((x) => x.key === view)!;
  const now = Date.now();
  const from = now - v.days * 86400e3;
  const buckets = new Map<string, any>();
  for (let d = from; d <= now; d += 86400e3) {
    const k = bucketKey(d, v.unit);
    if (!buckets.has(k)) buckets.set(k, { key: k, label: bucketLabel(k, v.unit), created: 0, renewals: 0, billed: 0 });
  }
  (stats.registrationsDaily || []).forEach((r: any) => {
    const t0 = new Date(r.date + 'T00:00:00+05:00').getTime();
    if (t0 < from - 86400e3) return;
    const b = buckets.get(bucketKey(t0, v.unit)); if (b) b.created += r.count;
  });
  (stats.recentRenewals || []).forEach((r: any) => {
    const t0 = new Date(r.date).getTime(); if (t0 < from) return;
    const b = buckets.get(bucketKey(t0, v.unit)); if (!b) return;
    b.renewals += 1; b.billed += r.platformPrice || 0;
  });
  const data = [...buckets.values()];
  const sum = (k: string) => data.reduce((n, b) => n + b[k], 0);
  const axisTick: any = { fontSize: small ? 9 : 10, fill: '#000', fontWeight: 600, angle: -45, textAnchor: 'end' };
  const every = data.length > 8 ? Math.ceil(data.length / 8) - 1 : 0;
  return (
    <div className="card-plain h-full">
      <div className="p-3 max-sm:p-2">
        <div className="mb-2 text-center text-base font-semibold text-[#033748]">Performance — {v.label}</div>
        <div className="mb-3 flex justify-center"><BtnGroup options={PERF_VIEWS} value={view} onChange={setView} /></div>
        <SeriesChecks visible={show} setVisible={setShow} items={[
          { key: 'created', label: 'Created', value: sum('created'), color: '#8884d8' },
          { key: 'renewals', label: 'Renewals', value: sum('renewals'), color: '#10b981' },
          { key: 'billed', label: 'Admin Rs', value: sum('billed').toLocaleString('en-PK'), color: '#ff7300' },
        ]} />
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={data} margin={{ top: 10, right: 5, left: -15, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
            <XAxis dataKey="label" tick={axisTick} interval={every} height={60} />
            <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} hide={!show.created && !show.renewals} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} hide={!show.billed} />
            <Tooltip formatter={(val: any, name: any) => (String(name).includes('Rs') ? rs(val) : val)} />
            {show.created && <Bar yAxisId="left" dataKey="created" name="Created" fill="#8884d8" radius={[4, 4, 0, 0]} />}
            {show.renewals && <Bar yAxisId="left" dataKey="renewals" name="Renewals" fill="#10b981" radius={[4, 4, 0, 0]} />}
            {show.billed && <Line yAxisId="right" type="monotone" dataKey="billed" name="Admin Rs" stroke="#ff7300" strokeWidth={2.5} dot={data.length <= 31} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const tabTitle = (Icon: any, color: string, text: ReactNode) => <><Icon size={17} style={{ color }} />{text}</>;
const C = { primary: '#0d6efd', success: '#198754', warning: '#ffc107', danger: '#dc3545', info: '#0dcaf0', secondary: '#6c757d' };

function PaymentDetailsForm({ me, onSaved }: { me: any; onSaved: () => void }) {
  const pd = me.subAdmin.paymentDetails || {};
  const [f, setF] = useState({
    jcTitle: pd.jazzcash?.title || '', jc: pd.jazzcash?.number || '',
    epTitle: pd.easypaisa?.title || '', ep: pd.easypaisa?.number || '',
    phone: pd.phone || '', whatsapp: pd.whatsapp ? '0' + String(pd.whatsapp).slice(2) : '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = pd.lockedByAdmin;
  const set = (k: string) => (e: any) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null); setError(null);
    try {
      const r = await api.put('/api/subadmin/me/payment-details', { jazzcash: { title: f.jcTitle, number: f.jc }, easypaisa: { title: f.epTitle, number: f.ep }, phone: f.phone, whatsapp: f.whatsapp || f.phone });
      setMsg(r.message); onSaved();
    } catch (err) { setError(errText(err)); }
  };
  const field = (label: string, k: keyof typeof f) => (
    <div><label className="mb-1 block text-sm">{label}</label><input className="input" value={f[k]} onChange={set(k)} disabled={locked} /></div>
  );
  return (
    <form onSubmit={save}>
      <p className="mb-3 text-sm text-ink-2">Your customers see these numbers for renewals (in their expiry reminders, emails and profile). The admin is told whenever they change.</p>
      {locked && <Alert variant="info" className="mb-3">These details are locked by the admin. Contact the admin to change them.</Alert>}
      {error && <Alert variant="danger" className="mb-3">{error}</Alert>}
      {msg && <Alert variant="success" className="mb-3">{msg}</Alert>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" style={{ maxWidth: 700 }}>
        {field('JazzCash title', 'jcTitle')}{field('JazzCash number', 'jc')}
        {field('EasyPaisa title', 'epTitle')}{field('EasyPaisa number', 'ep')}
        {field('Contact phone', 'phone')}{field('WhatsApp', 'whatsapp')}
      </div>
      <button type="submit" className="btn btn-primary mt-3" disabled={locked}>Save</button>
    </form>
  );
}

const axisTick = { fontSize: 11, fill: '#000000', fontWeight: 700 };
const CardBox = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`card-plain overflow-hidden ${className}`}>{children}</div>;
const CardTitle = ({ children }: { children: ReactNode }) => <div className="mb-3 text-center text-base font-semibold text-[#033748]">{children}</div>;

export default function SubAdminDashboardPage() {
  const navigate = useNavigate();
  const small = useIsSmallScreen();
  const [me, setMe] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [bills, setBills] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [today, setToday] = useState<any>(null);
  const [openBill, setOpenBill] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('business');
  const [moneyAt, setMoneyAt] = useState<Date | null>(null);
  const [onlinePage, setOnlinePage] = useState(1);
  const [regMonths, setRegMonths] = useState(6);
  const [regShow, setRegShow] = useState<Record<string, boolean>>({ created: true, trials: true });

  const load = useCallback(async () => {
    try {
      const [m, s, b, p, r, t] = await Promise.all([
        api.get('/api/subadmin/me'), api.get('/api/subadmin/stats'), api.get('/api/subadmin/bills'),
        api.get('/api/subadmin/payments'), api.get('/api/subadmin/requests'), api.get('/api/subadmin/today'),
      ]);
      setMe(m); setStats(s); setBills(b); setPayments(p.payments); setRequests(r.requests); setToday(t); setMoneyAt(new Date());
    } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Bills & Payments: refresh on open, every 30 s, and on window focus.
  const loadMoney = useCallback(async () => {
    try {
      const [m, b, p, t] = await Promise.all([
        api.get('/api/subadmin/me'), api.get('/api/subadmin/bills'), api.get('/api/subadmin/payments'), api.get('/api/subadmin/today'),
      ]);
      setMe(m); setBills(b); setPayments(p.payments); setToday(t); setMoneyAt(new Date());
    } catch { /* keep the last figures */ }
  }, []);
  useEffect(() => {
    if (tab !== 'bills') return undefined;
    loadMoney();
    const id = setInterval(loadMoney, 30000);
    const onFocus = () => loadMoney();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [tab, loadMoney]);
  // Online customers: refresh stats every minute while that tab is open.
  useEffect(() => {
    if (tab !== 'online') return undefined;
    const refresh = () => { api.get('/api/subadmin/stats').then(setStats).catch(() => {}); };
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [tab]);

  if (error) return <div className="page stats-page"><Alert variant="danger">{error}</Alert></div>;
  if (!me || !stats) return <PageSpinner />;

  const o = stats.overview;
  const regAcc = (stats.registrationsDaily || []).reduce((acc: any, r: any) => {
    const k = r.date.slice(0, 7); acc[k] = acc[k] || { created: 0, trials: 0 }; acc[k].created += r.count; acc[k].trials += r.trials || 0; return acc;
  }, {});
  const regData: any[] = [];
  {
    const p = pkDate(Date.now());
    for (let i = regMonths - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth() - i, 1));
      const k = d.toISOString().slice(0, 7);
      regData.push({ month: k, label: bucketLabel(k, 'month'), created: regAcc[k]?.created || 0, trials: regAcc[k]?.trials || 0 });
    }
  }
  const online: any[] = stats.online || [];
  const onlinePages = Math.ceil(online.length / 20);
  const recent: any[] = stats.recentRenewals || [];
  const tick = small ? { ...axisTick, fontSize: 9 } : axisTick;
  const tile = (label: string, value: ReactNode, tone: Tone, onClick?: () => void) => (
    <div className="min-w-0 grow basis-[calc(33.333%-0.5rem)] lg:basis-[calc(25%-0.75rem)]"><StatTile tone={tone} value={value} label={label} onClick={onClick} /></div>
  );
  const lineType = (t: string) => t.replace(/_/g, ' ').toLowerCase();

  const business = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {tile('Customers', o.total, 'primary', () => navigate('/subadmin/users'))}
        {tile('Active', o.active, 'success', () => navigate('/subadmin/users?tab=active'))}
        {tile('Expiring in 7 days', o.expiring, 'warning', () => navigate('/subadmin/users?tab=expiring'))}
        {tile('Awaiting activation', o.awaiting, 'info', () => navigate('/subadmin/users?tab=awaiting'))}
        {tile('Total mouzas', o.mouzas || 0, 'primary')}
        {tile('Mouzas (active users)', o.activeMouzas || 0, 'success')}
        {tile('Sales (30 days)', o.salesThisMonth || 0, 'info')}
        {tile('Tehsils covered', (stats.byTehsil || []).length, 'secondary')}
      </div>
      <SubAdminRenewalsPanel stats={stats} revenueField="platformPrice" />
      <PerformancePanel stats={stats} />
      <Panel title="Revenue by Month">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={stats.business?.months || []} margin={{ top: 15, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
            <XAxis dataKey="month" tick={tick} /><YAxis tick={tick} />
            <Tooltip formatter={(v: any) => rs(v)} /><Legend />
            <Bar dataKey="platformCharges" name="Payable to admin" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Panel title="Health">
          <div className="flex flex-col gap-2">
            {([['Activation rate', stats.health?.activationRate, 'info'], ['Trial → paid', stats.health?.trialConversionRate, 'warning'], ['Renewal rate', stats.health?.renewalRate, 'success']] as [string, any, Tone][]).map(([l, v, c]) => (
              <StatTile key={l} tone={c} value={<>{v ?? '—'}{v != null ? '%' : ''}</>} label={l} />
            ))}
          </div>
        </Panel>
        <div className="md:col-span-2">
          <Panel title="New Customers by Month">
            <div className="mb-2 flex justify-center"><BtnGroup options={[3, 6, 12].map((n) => ({ key: n, label: `${n} Months` }))} value={regMonths} onChange={setRegMonths} /></div>
            <SeriesChecks visible={regShow} setVisible={setRegShow} items={[
              { key: 'created', label: 'Created', value: regData.reduce((n, r) => n + r.created, 0), color: '#8884d8' },
              { key: 'trials', label: 'Trials', value: regData.reduce((n, r) => n + r.trials, 0), color: '#ff7300' },
            ]} />
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={regData} margin={{ top: 10, right: 5, left: -25, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#000', fontWeight: 600, angle: -45, textAnchor: 'end' } as any} height={50} interval={0} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip />
                {regShow.created && <Bar dataKey="created" name="Created" fill="#8884d8" radius={[4, 4, 0, 0]} maxBarSize={40} />}
                {regShow.trials && <Line type="monotone" dataKey="trials" name="Trials" stroke="#ff7300" strokeWidth={2.5} dot={{ r: 3 }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Panel title="Renewals and Activations by Month">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stats.renewalsByMonth || []} margin={{ top: 15, right: 5, left: -25, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e0e0" />
              <XAxis dataKey="month" tick={tick} /><YAxis allowDecimals={false} tick={tick} /><Tooltip />
              <Bar dataKey="count" name="Paid activations + renewals" fill="#10b981" radius={[4, 4, 0, 0]} barSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Customers by Tier">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={stats.tierMix || []} dataKey="count" nameKey="tier" outerRadius={75} label={({ payload }: any) => `${payload.tier}: ${payload.count}`}>
                {(stats.tierMix || []).map((t: any, i: number) => <Cell key={t.tier} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="text-center text-sm text-ink-2">Monthly {o.monthly} · Yearly {o.yearly}</div>
        </Panel>
      </div>
      <Panel title="Customers by Tehsil">
        <div className="table-wrap">
          <table className="table no-hover-table">
            <thead><tr><th>Tehsil</th><th className="!text-right">Customers</th></tr></thead>
            <tbody>{(stats.byTehsil || []).map((t: any) => <tr key={t.tehsil}><td>{t.tehsil}</td><td className="text-right font-bold">{t.users}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );

  const billsPane = (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
      <div className="flex flex-col gap-3 md:col-span-5">
        <CardBox>
          <DarkHeader className="!py-2" title={`Today so far${today?.day ? ` · ${today.day}` : ''}`} badge={moneyAt ? `as of ${moneyAt.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : null} />
          <div className="overflow-auto" style={{ maxHeight: 360 }}>
            <table className="table table-striped sticky-list sa-today-table" style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
              <thead><tr><th>Time</th><th>Customer</th><th>Action</th><th className="!text-right">Amount</th></tr></thead>
              <tbody>
                {today?.lines?.length ? today.lines.map((l: any, i: number) => (
                  <tr key={i}>
                    <td className="text-ink-2">{new Date(l.at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="font-semibold">{l.userId}</td>
                    <td><Badge bg={l.amount < 0 ? 'danger' : l.type === 'ACTIVATED' ? 'info' : 'success'} className="font-normal capitalize">{lineType(l.type)}</Badge></td>
                    <td className={`text-right font-semibold ${l.amount < 0 ? 'text-[#dc3545]' : ''}`}>{rs(l.amount)}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="py-3 text-center text-ink-2">Nothing billed today.</td></tr>}
              </tbody>
              <tfoot>
                <tr style={{ background: '#0f2027', color: '#fff' }}>
                  <td colSpan={3} className="px-2.5 py-1.5 font-bold">Total today</td>
                  <td className="px-2.5 py-1.5 text-right font-bold">{rs(today?.total || 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <table className="w-full text-[0.85rem]">
            <tbody>
              <tr className="border-b border-line"><td className="px-2.5 py-1">Owed</td><td className="px-2.5 py-1 text-right font-bold">{rs(me.money.balance)}</td></tr>
              <tr className="border-b border-line"><td className="px-2.5 py-1">Overdue</td><td className={`px-2.5 py-1 text-right font-bold ${me.money.overdue ? 'text-[#dc3545]' : ''}`}>{rs(me.money.overdue)}</td></tr>
              {me.money.advanceCredit > 0 && <tr className="border-b border-line"><td className="px-2.5 py-1">Advance credit</td><td className="px-2.5 py-1 text-right font-bold text-[#198754]">{rs(me.money.advanceCredit)}</td></tr>}
            </tbody>
          </table>
          <div className="p-2 text-sm text-ink-2">Each bill is payable within {me.subAdmin.paymentWindowDays} days. Overdue bills of {rs(me.subAdmin.unpaidThreshold)} or more lead to a final warning, then suspension 48 hours later if unpaid. Figures refresh automatically every 30 seconds.</div>
        </CardBox>
        <CardBox className="p-3">
          <CardTitle>Payments received</CardTitle>
          <div className="overflow-auto" style={{ maxHeight: 360 }}>
            <table className="table table-striped" style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
              <tbody>{payments.length ? payments.map((p) => (
                <tr key={p._id}><td>{fmtDate(p.receivedAt)}</td><td>{p.method}{p.reference ? ` · ${p.reference}` : ''}</td><td className={`text-right ${p.amount < 0 ? 'text-[#dc3545]' : ''}`}>{rs(p.amount)}</td></tr>
              )) : <tr><td className="text-ink-2">None yet.</td></tr>}</tbody>
            </table>
          </div>
        </CardBox>
      </div>
      <div className="md:col-span-7">
        <CardBox className="p-3">
          <CardTitle>Daily bills</CardTitle>
          <div className="table-wrap" style={{ maxHeight: 400 }}>
            <table className="table table-hover table-striped sticky-list" style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
              <thead><tr><th>Day</th><th className="!text-right">Total</th><th className="!text-right">Paid</th><th>Due</th><th /></tr></thead>
              <tbody>{(bills?.bills || []).map((b: any) => (
                <tr key={b._id} className="cursor-pointer" onClick={() => api.get(`/api/subadmin/bills/${b._id}`).then(setOpenBill).catch(() => {})}>
                  <td>{b.day}</td><td className="text-right">{rs(b.total)}</td><td className="text-right">{rs(b.paidAmount)}</td>
                  <td>{b.unpaid > 0 ? <Badge bg={b.overdue ? 'danger' : 'warning'}>{b.overdue ? 'overdue' : `by ${fmtDate(b.dueAt)}`}</Badge> : <Badge bg="success">paid</Badge>}</td>
                  <td className="text-sm text-[#0d6efd]">lines</td>
                </tr>))}
              </tbody>
            </table>
          </div>
          {openBill && (
            <div className="mt-2 rounded border border-[#dee2e6] p-2 text-sm">
              <div className="flex items-center justify-between"><strong>Bill {openBill.bill?.day}</strong><button className="btn btn-sm btn-link" onClick={() => setOpenBill(null)}>close</button></div>
              <div className="overflow-x-auto">
                <table className="w-full"><tbody>{(openBill.lines || []).map((l: any, i: number) => (
                  <tr key={i} className="border-t border-line"><td className="px-1 py-0.5">{fmtDateTime(l.at)}</td><td className="px-1">{l.userId}</td><td className="px-1">{lineType(l.type)} {l.plan || ''}</td><td className="px-1 text-right">{rs(l.amount)}</td></tr>
                ))}</tbody></table>
              </div>
            </div>
          )}
        </CardBox>
      </div>
    </div>
  );

  const renewalsPane = (
    <CardBox>
      <DarkHeader className="!py-2" title="Renewals & Activations" badge={`${recent.length} · ${rs(recent.reduce((n, r) => n + (r.platformPrice || 0), 0))} payable`} />
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
        <table className="table table-striped table-hover sticky-list" style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
          <thead><tr><th>Date</th><th>Customer</th><th>Name</th><th>Type</th><th>Plan</th><th className="!text-right">Payable to admin</th></tr></thead>
          <tbody>
            {recent.length ? recent.slice(0, 300).map((r, i) => (
              <tr key={i}>
                <td>{fmtDate(r.date)}</td><td className="font-semibold">{r.userId}</td><td className="text-ink-2">{r.userName}</td>
                <td>{r.type === 'ACTIVATED' ? 'Activation' : 'Renewal'}</td><td>{r.subscriptionType}</td>
                <td className="text-right font-semibold">{rs(r.platformPrice || 0)}</td>
              </tr>
            )) : <tr><td colSpan={6} className="py-3 text-center text-ink-2">No renewals yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </CardBox>
  );

  const openUser = (id: string) => navigate(`/subadmin/users?edit=${encodeURIComponent(id)}`);
  const onlinePane = (
    <CardBox>
      <DarkHeader title="Currently Online Details" badge={`${online.length} Users`} />
      <div className="table-wrap !rounded-none !border-0" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        <table className="table no-hover-table">
          <thead><tr><th className="freeze">User</th><th>Tehsil</th><th>Mobile</th><th>Subscription</th><th>Expires</th><th>Last Active</th><th>Actions</th></tr></thead>
          <tbody>
            {online.length ? online.slice((onlinePage - 1) * 20, onlinePage * 20).map((u) => (
              <tr key={u.userId}>
                <td className="freeze cursor-pointer" style={{ padding: '0.25rem 0.5rem' }} onClick={() => openUser(u.userId)}>
                  <strong>{u.userName || 'N/A'}</strong><br />
                  <span style={{ textDecoration: 'underline', fontSize: '0.8rem' }}>{u.userId}</span>
                </td>
                <td style={{ padding: '0.25rem 0.5rem' }}>{u.activeTehsil || 'N/A'}</td>
                <td style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>{u.mobileNumber || '—'}</td>
                <td style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>{u.subscriptionType}</td>
                <td style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>{u.endDate ? fmtDate(u.endDate) : '—'}</td>
                <td className="text-ink-2" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>{fmtDateTime(u.lastActive)}</td>
                <td className="text-center" style={{ padding: '0.25rem 0.5rem' }}>
                  <button className="btn" onClick={() => openUser(u.userId)}
                    style={{ backgroundColor: '#0f2027', color: '#fff', borderColor: '#0f2027', fontWeight: 600, padding: '0.1rem 0.5rem', fontSize: '0.7rem', borderRadius: 4 }}>Details</button>
                </td>
              </tr>
            )) : <tr><td colSpan={7} className="py-4 text-center">No customers online</td></tr>}
          </tbody>
        </table>
      </div>
      {online.length > 20 && <NumberPager page={onlinePage} pages={onlinePages} onChange={setOnlinePage} />}
    </CardBox>
  );

  const requestsPane = (
    <CardBox className="p-3">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Sent</th><th>Type</th><th>Customer</th><th>Reason</th><th>Status</th></tr></thead>
          <tbody>{requests.length ? requests.map((r) => (
            <tr key={r._id}>
              <td className="whitespace-nowrap">{fmtDate(r.createdAt)}</td><td>{r.kind.replace('_', ' ')}</td><td>{r.userId}</td>
              <td className="text-sm">{r.reason}{r.decisionNote ? <div className="text-ink-2">Admin: {r.decisionNote}</div> : null}</td>
              <td><Badge bg={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'secondary'}>{r.status}</Badge></td>
            </tr>
          )) : <tr><td colSpan={5} className="text-ink-2">No requests.</td></tr>}</tbody>
        </table>
      </div>
    </CardBox>
  );

  const overdue = me.money.overdue > 0;
  return (
    <div className="page stats-page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-2xl font-medium text-teal-ink">My Business</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-outline-primary" onClick={() => navigate('/')}><Home size={13} /> Home</button>
          <button className="btn btn-sm btn-outline-success" onClick={() => navigate('/subadmin/users')}>My customers</button>
          <CopyMouzaListButton />
        </div>
      </div>
      <WriteBlockedBanner me={me} />
      <Tabs value={tab} onChange={(k) => setTab(k || 'business')} tabs={[
        { key: 'business', title: tabTitle(LineIcon, C.primary, 'Overview'), content: business },
        { key: 'bills', title: tabTitle(Receipt, overdue ? C.danger : C.success, `Bills & Payments${overdue ? ' ⚠' : ''}`), content: billsPane },
        { key: 'renewals', title: tabTitle(RefreshCw, C.warning, 'Renewals'), content: renewalsPane },
        { key: 'online', title: tabTitle(Globe, C.success, `Online (${online.length})`), content: onlinePane },
        { key: 'requests', title: tabTitle(Inbox, C.info, 'Requests'), content: requestsPane },
        { key: 'payment', title: tabTitle(Wallet, C.secondary, 'Payment Details'), content: <CardBox className="p-3"><PaymentDetailsForm me={me} onSaved={load} /></CardBox> },
      ]} />
    </div>
  );
}
