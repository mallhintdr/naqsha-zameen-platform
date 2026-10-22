// Small building blocks shared by the sub-admin console (legacy AdminSubAdminConsole.js helpers).
import { useEffect, useState, type ReactNode } from 'react';
import { CircleCheck } from 'lucide-react';
import { Alert, Badge, cn, useDialog } from '@/shared/ui';
import { fetchConsolidatedTehsils } from '@/shared/lib/mouzaApi';
import { api, errText, rs, fmtDate, SUBADMIN_STATUS } from '@/features/subadmin/subAdminApi';

/** Bootstrap text-* colours used by the legacy tab icons. */
export const TXT: Record<string, string> = {
  primary: '#0d6efd', success: '#198754', danger: '#dc3545', warning: '#ffc107', info: '#0dcaf0', secondary: '#6c757d',
};
export const tabTitle = (Icon: any, color: string, text: ReactNode) => (
  <>
    <Icon className="shrink-0" style={{ color: TXT[color], width: '1.2em', height: '1.2em' }} />
    {text}
  </>
);
export const axisTick = { fontSize: 11, fill: '#000000', fontWeight: 700 };

export const StatusBadge = ({ s }: { s: string }) => {
  const [l, v] = SUBADMIN_STATUS[s] || [s, 'secondary'];
  return <Badge bg={v}>{l}</Badge>;
};

export const DETAIL_FIELD_LABEL = 'block text-[0.8rem] font-semibold text-[#475569] mb-0.5';

export function useTehsils() {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    fetchConsolidatedTehsils().then((l: any[]) => setList(l.map((x) => x.name))).catch(() => {});
  }, []);
  return list;
}

export function TerritoryPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const tehsils = useTehsils();
  const [q, setQ] = useState('');
  return (
    <div>
      <input className="input input-sm mb-1" placeholder="Search tehsil..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-[160px] overflow-y-auto rounded-md border border-[#e2e8f0] p-1.5">
        {tehsils.filter((t) => !q || t.toLowerCase().includes(q.toLowerCase())).map((t) => (
          <button
            key={t}
            type="button"
            className={cn('btn btn-sm mr-1 mb-1', value.includes(t) ? 'btn-success' : 'btn-outline-secondary')}
            onClick={() => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-1 text-sm">Selected: {value.join(', ') || 'none'}</div>
    </div>
  );
}

/** Searchable list of existing customers for "promote" (users API capped at 100 rows; one match auto-selects). */
export function ExistingUserPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await api.get('/api/users', { limit: 100, page: 1, tab: 'all', searchId: q.trim(), sortKey: 'userId', sortDir: 'asc' });
        const list = (d?.users || []).filter((u: any) => u.userType === 'user');
        if (alive) {
          setRows(list);
          if (list.length === 1 && value !== list[0].userId) onChange(list[0].userId);
        }
      } catch {
        if (alive) setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <div>
      <input className="input input-sm mb-1" placeholder="Search by user ID..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="table-wrap max-h-[260px]">
        <table className="table">
          <thead>
            <tr>
              <th className="freeze">Name</th>
              <th>ID</th>
              <th>Tehsil</th>
              <th>Plan</th>
              <th>Managed by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((u) => {
                const sel = u.userId === value;
                const cell = cn('!px-2 !py-[0.3rem] text-[0.82rem] cursor-pointer', sel && '!bg-[#cfe2ff]');
                return (
                  <tr key={u.userId} onClick={() => onChange(u.userId)} title="Click to select">
                    <td className={cn('freeze', cell)}>
                      {sel && <CircleCheck size={14} className="mr-1 inline text-[#0d6efd]" />}
                      <strong>{u.userName || '—'}</strong>
                    </td>
                    <td className={cell}>{u.userId}</td>
                    <td className={cell}>{u.activeTehsil || u.tehsilAccess?.[0]?.tehsil || '—'}</td>
                    <td className={cell}>{u.subscriptionType || '—'}</td>
                    <td className={cell}>{u.subAdminName || u.managedBy || 'Admin'}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="py-3 text-center text-ink-2">{loading ? 'Loading…' : 'No users match.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-sm text-ink-2">
        {loading ? 'Loading…' : rows.length === 100 ? 'Showing first 100 matches, type to narrow.' : `${rows.length} user(s)`}
        {value && (
          <>
            {' '}· Selected: <strong>{value}</strong>
          </>
        )}
      </div>
    </div>
  );
}

const TONE_BY_COLOR: Record<string, string> = { '#dc3545': 'danger', '#198754': 'success', '#0d6efd': 'primary', '#6f42c1': 'purple' };
const TONE_BY_LABEL: Record<string, string> = { Owed: 'warning', 'Due, not overdue': 'info' };
export const DetailInfo = ({ label, children, color, tone }: { label: string; children: ReactNode; color?: string; tone?: string }) => (
  <div className="min-w-[calc(33.333%-0.5rem)] flex-1 lg:min-w-[calc(16.666%-0.5rem)]">
    <div className={`stat-tile h-full tone-${tone || TONE_BY_COLOR[color || ''] || TONE_BY_LABEL[label] || 'secondary'}`}>
      <div className="stat-value" style={{ color: color || '#0f172a' }}>{children}</div>
      <div className="stat-label">{label}</div>
    </div>
  </div>
);

export const DetailSection = ({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) => (
  <div className={`dark-gray-borders rounded-lg border border-[#e2e8f0] p-3 ${className}`}>
    {title && <div className="mb-2 text-[0.9rem] font-bold text-[#1e293b]">{title}</div>}
    {children}
  </div>
);

export function RequestsTable({ rows, onChanged }: { rows: any[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const { prompt } = useDialog();
  const decide = async (r: any, approve: boolean) => {
    setError(null);
    try {
      if (approve) {
        const body: any = { note: '' };
        if (r.kind === 'more_mouzas') {
          const limit = await prompt('Allow up to how many mouzas for this customer?', { title: 'Approve more mouzas', type: 'number', required: true, okLabel: 'Next' });
          if (!limit) return;
          body.mouzaLimit = Number(limit);
          const monthly = await prompt('Monthly platform price for this customer (Rs)? Leave empty to use the price table.', { title: 'Approve more mouzas', type: 'number', okLabel: 'Approve', variant: 'success' });
          if (monthly === null) return;
          if (monthly) body.monthlyPrice = Number(monthly);
        }
        await api.post(`/api/admin/subadmin-requests/${r._id}/approve`, body);
      } else {
        const note = await prompt('Reason for rejecting (sent to the sub-admin):', { title: 'Reject request', multiline: true, okLabel: 'Reject', variant: 'danger' });
        if (note === null) return;
        await api.post(`/api/admin/subadmin-requests/${r._id}/reject`, { note });
      }
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <>
      {error && <Alert variant="danger" className="mb-2">{error}</Alert>}
      <div className="table-wrap mt-2">
        <table className="table">
          <thead>
            <tr>
              <th>Sent</th><th>Sub-admin</th><th>Type</th><th>Customer</th><th>Details</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r) => (
                <tr key={r._id}>
                  <td className="whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                  <td>{r.subAdminId}</td>
                  <td>{r.kind.replace('_', ' ')}</td>
                  <td>{r.userId}</td>
                  <td className="text-sm">
                    {r.reason}
                    {r.event && <div className="text-ink-2">{r.event.type.toLowerCase()} {r.event.plan} {rs(r.event.platformPrice)} on {fmtDate(r.event.createdAt)}</div>}
                    {r.requestedAssignment?.length > 0 && (
                      <div className="text-ink-2">{r.requestedAssignment.map((a: any) => `${a.tehsil}: ${a.mouzas.join(', ')}`).join('; ')}</div>
                    )}
                  </td>
                  <td><Badge bg={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'secondary'}>{r.status}</Badge></td>
                  <td className="whitespace-nowrap">
                    {r.status === 'pending' && (
                      <>
                        <button className="btn btn-sm btn-success mr-1" onClick={() => decide(r, true)}>Approve</button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => decide(r, false)}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={7} className="text-ink-2">No requests.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
