// Sub-admin: their own customers (legacy SubAdminUsers.js). Route /subadmin/users (?tab, ?new=1, ?edit=<id>).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Users, CheckCircle2, TriangleAlert, XCircle, Hourglass, Gift, Ban, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Home,
  UserCircle, Receipt, MapPinned, MessageCircle,
} from 'lucide-react';
import { Alert, Badge, Modal, Spinner } from '@/shared/ui';
import UserEditForm from '@/features/users/UserEditForm';
import { fetchConsolidatedTehsils } from '@/shared/lib/mouzaApi';
import { withoutAkar } from '@/shared/lib/akar';
import SubAdminMouzaPicker, { countMouzas } from './SubAdminMouzaPicker';
import { api, errText, newRequestKey, rs, fmtDate, fmtDateTime, STATUS_VARIANT, STATUS_LABEL, PLAN_LABEL, type BadgeBg } from './subAdminApi';
import '@/features/admin/insights/stats.css';

const TABS: [string, string][] = [['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring (7 days)'], ['expired', 'Expired'], ['awaiting', 'Awaiting activation'], ['trial', 'Trials'], ['suspended', 'Suspended']];
const TAB_ICONS: Record<string, [any, string, string]> = {
  all: [Users, 'secondary', '#6c757d'], active: [CheckCircle2, 'success', '#198754'], expiring: [TriangleAlert, 'warning', '#ffc107'],
  expired: [XCircle, 'danger', '#dc3545'], awaiting: [Hourglass, 'info', '#0dcaf0'], trial: [Gift, 'primary', '#0d6efd'], suspended: [Ban, 'dark', '#212529'],
};

const useMe = (): [any, () => void] => {
  const [me, setMe] = useState<any>(null);
  const load = useCallback(() => { api.get('/api/subadmin/me').then(setMe).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  return [me, load];
};

export function WriteBlockedBanner({ me }: { me: any }) {
  if (!me) return null;
  const s = me.subAdmin.status;
  if (s === 'suspended_unpaid') return <Alert variant="danger" className="mb-3">Your account is suspended for unpaid bills. You can view users and bills; creating, renewing and editing resume as soon as your payment is recorded. Owed: <strong>{rs(me.money.balance)}</strong>.</Alert>;
  if (s === 'final_warning') return <Alert variant="danger" className="mb-3">Final warning: overdue bills of <strong>{rs(me.money.overdue)}</strong>. Please pay by <strong>{fmtDateTime(me.subAdmin.finalWarning?.deadline)}</strong> to avoid suspension.</Alert>;
  if (me.money.overdue > 0) return <Alert variant="warning" className="mb-3">You have overdue bills: <strong>{rs(me.money.overdue)}</strong>.</Alert>;
  return null;
}

const SUBMIT_BG = 'radial-gradient(circle at 20% 20%, rgba(45, 152, 255, 0.45), transparent 60%), linear-gradient(135deg, rgba(11, 14, 40, 1), rgba(18, 26, 54, 1))';
const INPUT = 'input border-[#64748b] focus:border-[#1e293b] focus:shadow-[0_0_0_0.15rem_rgba(30,41,59,0.2)]';

function Section({ title, icon: Icon, border, head, body, children }: any) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg" style={{ border: `1px solid ${border}` }}>
      <div className="flex items-center gap-2 px-4 py-2.5 font-semibold text-white" style={{ background: head }}><Icon size={16} /> {title}</div>
      <div className="p-5 max-sm:p-3" style={{ background: body }}>{children}</div>
    </div>
  );
}

// ── Create customer ─────────────────────────────────────────────────────
function CreateCustomerModal({ show, onHide, me, onCreated }: { show: boolean; onHide: () => void; me: any; onCreated: () => void }) {
  const blank = { userId: '', userName: '', mobileNumber: '', email: '', plan: 'Monthly', customerFee: '', assignment: [] as any[] };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [allTehsils, setAllTehsils] = useState<string[]>([]);
  const isTrial = f.plan === 'Trial24';
  const n = countMouzas(f.assignment);

  useEffect(() => { if (show) { setF(blank); setResult(null); setError(null); } }, [show]);
  useEffect(() => {
    fetchConsolidatedTehsils().then((l: any[]) => setAllTehsils(withoutAkar(l.map((x) => x.name)))).catch(() => {}); // AKAR: admin only
  }, []);

  const set = (k: string) => (e: any) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const body: any = { userId: f.userId.trim(), userName: f.userName.trim(), mobileNumber: f.mobileNumber.trim(), email: f.email.trim(), plan: f.plan, assignment: f.assignment, requestKey: newRequestKey() };
      if (!isTrial) body.customerFee = Number(f.customerFee);
      const r = await api.post('/api/subadmin/users', body);
      // WhatsApp message for the customer — byte-identical to legacy.
      const origin = window.location.origin || 'https://dashboard.naqsha-zameen.pk';
      const lines = [
        `Dear *${body.userName}*,`, '',
        'Your Naqsha Zameen account has been created.',
        `User ID: *${body.userId}*`,
        ...(r.password ? [`Password: *${r.password}*`] : []),
        `Plan: *${PLAN_LABEL[body.plan] || body.plan}*`,
        `Mouzas: *${body.assignment.reduce((k: number, a: any) => k + (a.mouzas || []).length, 0)}*`, '',
        `Please open the activation link sent to *${body.email}* to activate your account, then log in at ${origin}/login`, '',
        'Thanks,', `*${me?.profile?.userName || 'Your provider'}*`, ...(me?.profile?.mobileNumber ? [me.profile.mobileNumber] : []),
      ];
      r.whatsapp = lines.join('\n');
      try { await navigator.clipboard.writeText(r.whatsapp); r.copied = true; } catch { r.copied = false; }
      setResult(r);
      onCreated();
    } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  };

  if (!me) return null;
  const max = isTrial ? me.subAdmin.trialMaxMouzas : undefined;
  const footBtn = { padding: '10px 30px', borderRadius: 8, fontWeight: 600 };
  return (
    <Modal show={show} onHide={onHide} size="salg" title="New Customer Registration"
      footerClassName="justify-center gap-3"
      footer={<>
        <button className="btn btn-secondary" onClick={onHide} style={footBtn}>{result ? 'Close' : 'Cancel'}</button>
        {!result && (
          <button type="submit" form="create-customer-form" className="btn text-white" disabled={busy || !n}
            style={{ ...footBtn, background: SUBMIT_BG, border: '1px solid rgba(0, 255, 255, 0.4)' }}>
            {busy ? <Spinner size="sm" className="text-white" /> : null}Register Customer &amp; Send Email
          </button>
        )}
      </>}>
      {result ? (
        <Alert variant={result.emailSent ? 'success' : 'warning'}>
          {result.message}
          {result.password && <div className="mt-2">Password: <code>{result.password}</code> (share it with the customer)</div>}
          {result.whatsapp && (
            <div className="mt-2">
              <div className="text-sm font-bold">{result.copied ? 'WhatsApp message copied to clipboard:' : 'WhatsApp message:'}</div>
              <textarea className="textarea mt-1" rows={8} readOnly value={result.whatsapp} style={{ fontSize: '0.8rem' }} />
              <button className="btn btn-sm btn-outline-success mt-1" onClick={() => navigator.clipboard?.writeText(result.whatsapp)}>
                <MessageCircle size={13} />Copy again
              </button>
            </div>
          )}
        </Alert>
      ) : (
        <form onSubmit={submit} id="create-customer-form" className="sa-newcust-form">
          {error && <Alert variant="danger" className="mb-3">{error}</Alert>}
          <Section title="Basic Information" icon={UserCircle} border="#cbd5e1" head="#1e293b" body="#f8fafc">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div><label className="field-label font-semibold">User Name *</label><input className={INPUT} value={f.userName} onChange={set('userName')} required placeholder="Full name" /></div>
              <div><label className="field-label font-semibold">Email Address *</label><input className={INPUT} type="email" value={f.email} onChange={set('email')} required placeholder="Activation link is sent here" /></div>
              <div><label className="field-label font-semibold">Mobile Number</label><input className={INPUT} value={f.mobileNumber} onChange={set('mobileNumber')} placeholder="03xxxxxxxxx" /></div>
              <div><label className="field-label font-semibold">User ID *</label><input className={INPUT} value={f.userId} onChange={set('userId')} required placeholder="e.g. arif.alipur" /></div>
            </div>
          </Section>
          <Section title="Subscription Details" icon={Receipt} border="#a7f3d0" head="#0f766e" body="#f0fdf4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="field-label font-semibold">Subscription Type</label>
                <select className="select border-[#64748b]" value={f.plan} onChange={(e) => { const v = e.target.value; setF((p) => ({ ...p, plan: v, assignment: v === 'Trial24' ? p.assignment.slice(0, 1) : p.assignment })); }}>
                  {(me.subAdmin.allowedPlans || []).map((p: string) => <option key={p} value={p}>{PLAN_LABEL[p] || p}</option>)}
                </select>
              </div>
              {!isTrial && <div><label className="field-label font-semibold">Price (PKR) *</label><input className={INPUT} type="number" min="0" value={f.customerFee} onChange={set('customerFee')} required placeholder="Amount payable to admin" /></div>}
            </div>
            <div className="mt-3 text-sm" style={{ color: '#0f766e' }}>
              {isTrial ? <>Free 24-hour trial (up to {me.subAdmin.trialMaxMouzas} mouzas). Not billed.</>
                : f.customerFee !== '' ? <>You'll be billed <strong>{rs(Number(f.customerFee) || 0)}</strong> ({f.plan}, {n} mouza{n === 1 ? '' : 's'}) when the customer activates.</>
                : 'Enter the price; it is billed to you when the customer activates.'}
            </div>
          </Section>
          <Section title="Tehsil & Mouza Access" icon={MapPinned} border="#fde68a" head="#b45309" body="#fffbeb">
            <SubAdminMouzaPicker tehsils={allTehsils} value={f.assignment} onChange={(a) => setF((p) => ({ ...p, assignment: a }))} maxMouzas={max} />
          </Section>
        </form>
      )}
    </Modal>
  );
}

// RenewModal (legacy) was unreachable — renewals go through UserEditForm — not ported (D8).

const rowClass = (u: any) => {
  const days = u.endDate ? (new Date(u.endDate).getTime() - Date.now()) / 86400000 : -1;
  if (u.status === 'AwaitingActivation') return 'pending';
  if (u.status === 'Suspended' || days <= 0) return 'expired';
  return days <= 7 ? 'expiring' : 'active';
};
const CARD_TONE: Record<string, string> = {
  active: 'border-l-[#10b981] bg-[rgba(16,185,129,0.12)]', expiring: 'border-l-[#f59e0b] bg-[rgba(245,158,11,0.12)]',
  expired: 'border-l-[#ef4444] bg-[rgba(239,68,68,0.12)]', pending: 'border-l-[#ffc107] bg-[rgba(255,193,7,0.15)]',
};

// ── Page ────────────────────────────────────────────────────────────────
export default function SubAdminUsersPage() {
  const [me, reloadMe] = useMe();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'all';
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('tehsil');
  const [filterValue, setFilterValue] = useState('');
  const [tehsilOptions, setTehsilOptions] = useState<string[]>([]);
  const [showTehsilList, setShowTehsilList] = useState(false);
  useEffect(() => {
    fetchConsolidatedTehsils().then((l: any[]) => setTehsilOptions(withoutAkar(l.map((x) => x.name)))).catch(() => {});
  }, []);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>({ users: [], pagination: { pages: 1, total: 0 } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(() => params.get('new') === '1');
  const [editId, setEditId] = useState<string | null>(() => params.get('edit') || null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoading(true);
    const extra = filterValue.trim() ? { [filterType === 'tehsil' ? 'searchTehsil' : filterType === 'phone' ? 'searchPhone' : 'searchEmail']: filterValue.trim() } : {};
    api.get('/api/subadmin/users', { tab, searchId: search.trim(), ...extra, page, limit: 50 })
      .then(setData).catch((e) => setError(errText(e))).finally(() => setLoading(false));
  }, [tab, search, filterType, filterValue, page]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const refresh = () => { load(); reloadMe(); };
  const writable = me && !['suspended_unpaid'].includes(me.subAdmin.status);
  const pages = data.pagination.pages || 1;
  const ctl = { fontSize: '0.9rem', height: 36, borderRadius: 6 };
  const clearBtn = (onClick: () => void, label: string) => (
    <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 border-0 bg-transparent font-bold text-[#dc3545]" onClick={onClick} aria-label={label}>✕</button>
  );

  return (
    <div className="page stats-page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#dee2e6] pb-2">
        <h3 className="m-0 text-2xl font-bold" style={{ color: '#0A2540' }}>My Customers</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm btn-outline-primary" onClick={() => navigate('/')}><Home size={13} /> Home</button>
          <button className="btn btn-sm btn-outline-success" onClick={() => navigate('/subadmin')}>Dashboard</button>
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)} disabled={!writable}>+ New customer</button>
        </div>
      </div>
      <WriteBlockedBanner me={me} />
      {error && <Alert variant="danger" className="mb-3" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert variant="success" className="mb-3" onClose={() => setNotice(null)}>{notice}</Alert>}

      <div className="tabs !mb-3 !gap-2">
        {TABS.map(([k, l]) => {
          const [I, c, hex] = TAB_ICONS[k];
          return (
            <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => { setParams({ tab: k }); setPage(1); }}>
              <I size={14} style={{ color: hex }} /> {l}
              {tab === k && <Badge bg={(c === 'dark' ? 'secondary' : c) as BadgeBg}>{data.pagination.total}</Badge>}
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex w-full items-end gap-2 max-sm:flex-wrap">
        <div className="min-w-0 max-sm:basis-[60%]" style={{ flex: '1 1 30%' }}>
          <label className="field-label" style={{ fontSize: '0.85rem' }}>User ID</label>
          <div className="relative">
            <input className="input input-sm" placeholder="ID..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={ctl} />
            {Boolean(search) && clearBtn(() => { setSearch(''); setPage(1); }, 'Clear User ID')}
          </div>
        </div>
        <div className="min-w-0" style={{ flex: '0 0 110px' }}>
          <label className="field-label" style={{ fontSize: '0.85rem' }}>Filter By</label>
          <select className="select select-sm" value={filterType} onChange={(e) => { setFilterType(e.target.value); setFilterValue(''); setPage(1); }} style={ctl}>
            <option value="tehsil">Tehsil</option><option value="phone">Phone</option><option value="email">Email</option>
          </select>
        </div>
        <div className="min-w-0 max-sm:basis-full" style={{ flex: '1 1 45%' }}>
          <label className="field-label" style={{ fontSize: '0.85rem' }}>{filterType === 'tehsil' ? 'Select Tehsil' : 'Search Term'}</label>
          <div className="relative">
            <input className="input input-sm" style={ctl}
              placeholder={filterType === 'tehsil' ? 'Type to filter tehsils...' : 'Search...'}
              value={filterValue}
              onChange={(e) => { setFilterValue(e.target.value); setPage(1); if (filterType === 'tehsil') setShowTehsilList(true); }}
              onFocus={() => filterType === 'tehsil' && setShowTehsilList(true)}
              onBlur={() => setTimeout(() => setShowTehsilList(false), 200)} />
            {Boolean(filterValue) && clearBtn(() => { setFilterValue(''); setPage(1); }, 'Clear filter')}
            {filterType === 'tehsil' && showTehsilList && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, background: 'white', border: '1px solid #ccc', borderRadius: 4, maxHeight: 200, overflowY: 'auto' }}>
                <div style={{ padding: 8, cursor: 'pointer' }} onMouseDown={() => { setFilterValue(''); setPage(1); }}>-- All --</div>
                {tehsilOptions.filter((x) => x.toLowerCase().includes(filterValue.toLowerCase())).map((x) => (
                  <div key={x} className="hover:bg-subtle-bg" style={{ padding: 8, cursor: 'pointer' }} onMouseDown={() => { setFilterValue(x); setPage(1); setShowTehsilList(false); }}>{x}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading && data.users.length === 0 ? (
        <div className="py-12 text-center"><Spinner /></div>
      ) : data.users.length === 0 ? (
        <div className="py-12 text-center text-ink-2">
          <Users size={48} className="mx-auto mb-2 opacity-50" />
          <div className="text-lg font-semibold text-ink">No Customers Found</div>
          <div className="text-sm">Try another tab or search</div>
        </div>
      ) : (
        <>
          {/* Phones: card list with the same row status colours */}
          <div className="flex flex-col gap-2 sm:hidden">
            {data.users.map((u: any) => (
              <div key={u.userId} onClick={() => setEditId(u.userId)} className={`cursor-pointer rounded-lg border-l-4 p-2.5 text-sm ${CARD_TONE[rowClass(u)]}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><strong style={{ color: '#002366' }}>{u.userName}</strong><div className="text-[0.8rem] underline">{u.userId}</div></div>
                  <Badge bg={STATUS_VARIANT[u.status] || 'secondary'}>{STATUS_LABEL[u.status] || u.status}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.8rem] text-teal-ink">
                  <span>{PLAN_LABEL[u.subscriptionType] || u.subscriptionType}</span>
                  <span>Until {u.status === 'AwaitingActivation' ? '—' : fmtDate(u.endDate)}</span>
                  <span>{countMouzas(u.tehsilAccess)} mouzas</span>
                  <span>{u.fee ? rs(u.fee) : '—'}</span>
                  {u.allowance?.available ? <Badge bg="success">available</Badge> : <Badge bg="light">used</Badge>}
                </div>
              </div>
            ))}
          </div>
          <div className="table-wrap max-h-[calc(100vh-260px)] max-sm:hidden">
            <table className="table">
              <thead><tr><th className="freeze">User</th><th>Status</th><th>Plan</th><th>Until</th><th>Mouzas</th><th>Fee</th><th>Change</th></tr></thead>
              <tbody>
                {data.users.map((u: any) => (
                  <tr key={u.userId} className={`row-${rowClass(u)} cursor-pointer`} onClick={() => setEditId(u.userId)}>
                    <td className="freeze" title="Click to edit">
                      <strong style={{ color: '#002366' }}>{u.userName}</strong><br />
                      <span style={{ textDecoration: 'underline', fontSize: '0.8rem' }}>{u.userId}</span>
                    </td>
                    <td className="text-center"><Badge bg={STATUS_VARIANT[u.status] || 'secondary'}>{STATUS_LABEL[u.status] || u.status}</Badge></td>
                    <td className="text-center">{PLAN_LABEL[u.subscriptionType] || u.subscriptionType}</td>
                    <td className="text-center">{u.status === 'AwaitingActivation' ? '—' : fmtDate(u.endDate)}</td>
                    <td className="text-center">{countMouzas(u.tehsilAccess)}</td>
                    <td className="text-center">{u.fee ? rs(u.fee) : '—'}</td>
                    <td className="text-center">{u.allowance?.available ? <Badge bg="success">available</Badge> : <Badge bg="light">used</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data.users.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-ink-2">Showing {data.users.length} of {data.pagination.total} customers</div>
          <div className="flex items-center gap-1">
            <button className="btn btn-outline-primary min-h-9" disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft size={15} /></button>
            <button className="btn btn-outline-primary min-h-9" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} /></button>
            <span className="px-2 text-sm">Page {page} of {pages}</span>
            <button className="btn btn-outline-primary min-h-9" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={15} /></button>
            <button className="btn btn-outline-primary min-h-9" disabled={page >= pages} onClick={() => setPage(pages)}><ChevronsRight size={15} /></button>
          </div>
        </div>
      )}

      <CreateCustomerModal show={showCreate} onHide={() => setShowCreate(false)} me={me} onCreated={refresh} />
      {editId && <UserEditForm userId={editId} handleClose={() => { setEditId(null); refresh(); }} refreshUsers={refresh} initialTab="profile" />}
    </div>
  );
}
