// User detail tabs (legacy components/User/UserDetailTabs/*): shell + Profile, Subscription,
// Access Control, Activity and History. Login history / map / heatmap live in UserDetailMapTabs.tsx.
// The never-used editMode branches were dropped (D8).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/shared/api/client';
import { Alert, Badge, Spinner, cn } from '@/shared/ui';
import { fmtDate, fmtDateTime } from '@/shared/lib/format';
import { ProofViewButton, useProofs } from '@/shared/components/PaymentProof';

/* ---------------- shared bits ---------------- */
export const Panel = ({ title, right, children, className, bodyClassName, headerClassName }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; headerClassName?: string }) => (
  <section className={cn('card', className)}>
    <header className={cn('card-header flex items-center justify-between gap-2', headerClassName)}><span className="min-w-0">{title}</span>{right}</header>
    <div className={bodyClassName ?? 'card-body'}>{children}</div>
  </section>
);
export const EmptyState = ({ icon, text, sub }: { icon: string; text: string; sub?: string }) => (
  <div className="tab-empty-state px-4 py-10 text-center">
    <div className="mb-2 text-[3rem] opacity-50">{icon}</div>
    <div className="mb-1 text-[1.1rem] font-semibold text-[#6c757d]">{text}</div>
    {sub && <div className="text-[0.875rem] text-[#adb5bd]">{sub}</div>}
  </div>
);
export const Row2 = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-2 border-b border-[rgba(0,0,0,0.125)] px-4 py-2 last:border-b-0">
    <span className="text-ink-2">{label}</span>
    <span className="min-w-0 truncate text-right">{children}</span>
  </div>
);
export const MetricCard = ({ value, label, sub, children, icon }: { value: ReactNode; label: ReactNode; sub?: ReactNode; children?: ReactNode; icon?: ReactNode }) => (
  <div className="metric-card relative h-full rounded-lg border border-[#e9ecef] bg-white p-5 text-center transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] max-sm:p-3">
    {icon && <div className="absolute right-3 top-3 opacity-50">{icon}</div>}
    <div className="metric-card-value text-[2rem] font-bold leading-tight text-[#00d4ff] max-sm:text-[1.5rem]">{value}</div>
    <div className="metric-card-label text-[0.875rem] uppercase tracking-[0.03em] text-[#6c757d]">{label}</div>
    {sub && <div className="metric-card-sublabel text-[0.75rem] text-[#adb5bd]">{sub}</div>}
    {children}
  </div>
);
export const H4 = ({ children }: { children: ReactNode }) => <h4 className="mb-4 text-[1.35rem] font-medium text-[#1f2937] max-sm:text-[1.15rem]">{children}</h4>;
export const tableCls = 'w-full border-collapse text-[0.875rem] [&_th]:border-b-2 [&_th]:border-[#dee2e6] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:whitespace-nowrap [&_td]:border-b [&_td]:border-[#dee2e6] [&_td]:px-2 [&_td]:py-1.5 [&_tbody_tr:hover]:bg-[rgba(0,0,0,0.04)]';

/* ---------------- Shell ---------------- */
export interface TabDef { id: string; label: string; icon: string; content: ReactNode }
export function UserDetailTabs({ tabs, defaultTab = 'profile', onBack, title, subtitle }: { tabs: TabDef[]; defaultTab?: string; onBack?: () => void; title?: ReactNode; subtitle?: ReactNode }) {
  const [active, setActive] = useState(defaultTab);
  const current = tabs.find((t) => t.id === active) || tabs[0];
  return (
    <div className="mx-auto mt-3 w-full px-3 pb-6 max-sm:px-2">
      {onBack && <button type="button" className="btn btn-secondary mb-3 min-h-9" onClick={onBack}>&larr; Back</button>}
      {title && (
        <div className="mb-3 min-w-0">
          <h3 className="mb-1 break-words text-[1.75rem] font-medium text-[#1f2937] max-sm:text-[1.3rem]">{title}</h3>
          {subtitle && <p className="mb-0 text-ink-2">{subtitle}</p>}
        </div>
      )}
      <div className="user-detail-tabs-container overflow-hidden rounded-lg bg-white shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
        <div className="tab-navigation flex gap-1 border-b border-[#e2e8f0] bg-[linear-gradient(to_bottom,#f8fafc,#f1f5f9)] px-2 pt-1.5 max-md:flex-wrap max-md:gap-1.5 max-md:pb-1.5 max-[575px]:hidden">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setActive(t.id)}
              className={cn(
                'tab-nav-item group relative flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-t-md border border-transparent px-1.5 py-[0.32rem] text-[0.8rem] font-semibold text-[#64748b] transition-all hover:bg-[rgba(14,165,233,0.05)] hover:text-[#0ea5e9]',
                'after:absolute after:inset-x-0 after:-bottom-px after:mx-auto after:h-[3px] after:w-0 after:bg-[linear-gradient(90deg,#0ea5e9,#06b6d4)] after:shadow-[0_-1px_4px_rgba(14,165,233,0.4)] after:transition-all hover:after:w-1/2',
                'max-md:min-w-[100px] max-md:flex-[1_1_calc(50%-3px)] max-md:rounded max-md:border-[#e2e8f0] max-md:text-[0.72rem] max-md:after:hidden max-[480px]:text-[0.68rem]',
                t.id === current.id && 'active border-[#e2e8f0] border-b-white bg-white font-bold !text-[#0ea5e9] shadow-[0_-2px_8px_rgba(0,0,0,0.04)] after:!w-full max-md:!border-[#0ea5e9] max-md:!bg-[#0ea5e9] max-md:!text-white',
              )}>
              <span className="tab-icon text-base max-md:text-[0.85rem]">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="tab-navigation-mobile hidden p-2 max-[575px]:block">
          <select className="select !rounded-md !border-2 !border-[#00d4ff] !p-3 !pr-9 !font-semibold !text-[#00d4ff]" value={current.id} onChange={(e) => setActive(e.target.value)}>
            {tabs.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="tab-content-wrapper">
          <div key={current.id} className="tab-content-panel active">{current.content}</div>
        </div>
      </div>
    </div>
  );
}

const pad = 'responsive-padding p-8 max-lg:p-6 max-md:p-4 max-sm:p-3';
const statusVariant = (s?: string): any => {
  if (!s) return 'secondary';
  const x = s.toLowerCase();
  return x === 'active' ? 'success' : x === 'expired' ? 'danger' : x === 'expiring soon' ? 'warning' : 'secondary';
};

/* ---------------- Profile ---------------- */
export function ProfileTab({ user }: { user: any }) {
  return (
    <div className={pad}>
      <H4>Profile Information</H4>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Personal Information" bodyClassName="">
          <Row2 label="User Name"><strong>{user?.userName || 'N/A'}</strong></Row2>
          <Row2 label="User ID"><strong>{user?.userId || 'N/A'}</strong></Row2>
          <Row2 label="Mobile Number"><strong>{user?.mobileNumber || 'N/A'}</strong></Row2>
          <Row2 label="Email Address"><strong>{user?.email || 'N/A'}</strong></Row2>
          <Row2 label="Registration Date"><strong>{fmtDate(user?.startDate, 'N/A')}</strong></Row2>
        </Panel>
        <Panel title="Account Status" bodyClassName="">
          <Row2 label="Status"><Badge bg={statusVariant(user?.status)} className="status-badge">{user?.status || 'Unknown'}</Badge></Row2>
          <Row2 label="Subscription Type"><strong>{user?.subscriptionType || 'N/A'}</strong></Row2>
          <Row2 label="Days Remaining">
            <strong className={user?.subscriptionType === 'Permanent' ? 'text-[#10b981]' : user?.daysRemaining < 7 ? 'text-[#ef4444]' : ''}>
              {user?.subscriptionType === 'Permanent' ? 'Permanent' : `${user?.daysRemaining ?? 'N/A'} days`}
            </strong>
          </Row2>
          <Row2 label="Fee"><strong>₨ {user?.fee || 'N/A'}</strong></Row2>
        </Panel>
      </div>
    </div>
  );
}

/* ---------------- Subscription ---------------- */
export function SubscriptionTab({ user }: { user: any }) {
  const progress = (() => {
    if (!user?.startDate || !user?.endDate) return 0;
    const start = new Date(user.startDate).getTime();
    const total = new Date(user.endDate).getTime() - start;
    return Math.round(Math.max(0, Math.min(100, ((Date.now() - start) / total) * 100)));
  })();
  const barColor = progress >= 90 ? 'bg-[#ef4444]' : progress >= 70 ? 'bg-[#f59e0b]' : 'bg-[linear-gradient(90deg,#00d4ff,#0099cc)]';
  const st = user?.status;
  const history = user?.renewalHistory || [];
  const daysCls = user?.subscriptionType === 'Permanent' ? 'font-bold text-[#10b981]' : user?.daysRemaining < 7 ? 'font-bold text-[#ef4444]' : 'text-[#10b981]';
  return (
    <div className={pad}>
      <H4>Subscription Information</H4>
      <Panel className="mb-4" title="Current Subscription"
        right={<Badge bg={st === 'Active' ? 'success' : st === 'Expired' ? 'danger' : 'warning'}>{st || 'Unknown'}</Badge>}>
        <div className="mb-3 grid grid-cols-1 gap-x-4 md:grid-cols-2">
          <div>
            <div className="mb-2"><strong>Subscription Type:</strong> <span className="text-[#0096c7]">{user?.subscriptionType || 'N/A'}</span></div>
            <div className="mb-2"><strong>Start Date:</strong> {fmtDate(user?.startDate, 'N/A')}</div>
            <div className="mb-2"><strong>End Date:</strong> {fmtDate(user?.endDate, 'N/A')}</div>
          </div>
          <div>
            <div className="mb-2"><strong>Days Remaining:</strong> <span className={daysCls}>{user?.subscriptionType === 'Permanent' ? 'Permanent' : `${user?.daysRemaining ?? 'N/A'} days`}</span></div>
            <div className="mb-2"><strong>Fee:</strong> <span className="font-bold text-[#10b981]">₨ {user?.fee || 'N/A'}</span></div>
            <div className="mb-2"><strong>Renewals:</strong> {user?.renewalCount || 0}</div>
          </div>
        </div>
        <div className="progress-container">
          <div className="mb-1 flex justify-between text-[0.875rem] text-[#6c757d]"><span>Subscription Period</span><span>{progress}% elapsed</span></div>
          <div className="h-3 overflow-hidden rounded-md bg-[#e9ecef]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn('h-full rounded-md bg-[length:1rem_1rem] transition-all', barColor)}
              style={{ width: `${progress}%`, backgroundImage: progress < 70 ? 'linear-gradient(45deg,rgba(255,255,255,.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.15) 50%,rgba(255,255,255,.15) 75%,transparent 75%,transparent),linear-gradient(90deg,#00d4ff,#0099cc)' : undefined }} />
          </div>
        </div>
      </Panel>

      <Panel title="Renewal History" bodyClassName="p-0">
        {history.length > 0 ? (
          <>
            <div className={cn('timeline relative ml-2 border-l-2 border-[#e9ecef]', pad)}>
              {history.slice(0, 5).map((r: any, i: number) => (
                <div key={i} className="timeline-item relative mb-4 pl-4 last:mb-0">
                  <span className="absolute -left-[calc(1rem+6px)] top-1.5 size-2.5 rounded-full border-2 border-white bg-[#00d4ff] shadow-[0_0_0_2px_#00d4ff] max-sm:-left-[calc(0.75rem+6px)]" />
                  <div className="timeline-date text-[0.8rem] text-[#6c757d]">{fmtDate(r.date)}</div>
                  <div className="timeline-content flex flex-wrap items-center gap-2">
                    <strong>{r.type}</strong>
                    <span className="timeline-badge rounded-full bg-[rgba(0,212,255,0.1)] px-2 py-0.5 text-[0.75rem] font-semibold text-[#0099cc]">₨ {user?.fee || 'N/A'}</span>
                  </div>
                </div>
              ))}
            </div>
            {history.length > 5 && (
              <div className="responsive-table-wrapper overflow-x-auto">
                <table className={tableCls}>
                  <thead><tr><th>#</th><th>Date</th><th>Type</th><th>Fee</th></tr></thead>
                  <tbody>
                    {history.map((r: any, i: number) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-[rgba(0,0,0,0.03)]' : ''}>
                        <td>{i + 1}</td><td className="whitespace-nowrap">{fmtDateTime(r.date, 'N/A')}</td><td>{r.type}</td><td>₨ {user?.fee || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <EmptyState icon="📋" text="No Renewal History" sub="This user hasn't renewed their subscription yet" />
        )}
      </Panel>
    </div>
  );
}

/* ---------------- Access control ---------------- */
const leftLabel = (expiresAt: any, withRemaining: boolean) => {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return ' (Expired)';
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  return ` (${days > 0 ? `${days}d ` : ''}${hours % 24}h${withRemaining ? ' remaining' : ''})`;
};
export function AccessControlTab({ user }: { user: any; isAdmin?: boolean }) {
  const tehsilAccess = useMemo(() => (Array.isArray(user?.tehsilAccess) ? user.tehsilAccess : []), [user]);
  const [viewTehsil, setViewTehsil] = useState('');
  const [viewMouza, setViewMouza] = useState('');
  const mouzas: string[] = useMemo(() => {
    const e = tehsilAccess.find(({ tehsil }: any) => tehsil === viewTehsil);
    return Array.isArray(e?.mouzas) ? e.mouzas : [];
  }, [viewTehsil, tehsilAccess]);
  useEffect(() => {
    if (tehsilAccess.length) setViewTehsil(user?.activeTehsil && tehsilAccess.some(({ tehsil }: any) => tehsil === user.activeTehsil) ? user.activeTehsil : tehsilAccess[0].tehsil);
  }, [user, tehsilAccess]);
  useEffect(() => {
    if (mouzas.length && !mouzas.includes(viewMouza)) setViewMouza(mouzas[0]);
  }, [mouzas, viewMouza]);
  const tempGrants = tehsilAccess.find((t: any) => t.tehsil === viewTehsil)?.tempGrants || [];

  return (
    <div className={pad}>
      <H4>Access Control Information</H4>
      {tehsilAccess.length === 0 ? (
        <EmptyState icon="🔐" text="No Access Assigned" sub="This user hasn't been assigned any tehsil or mouza access yet" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Tehsil Access" bodyClassName="">
              <div className="border-b border-[rgba(0,0,0,0.125)] px-4 py-2">
                <strong>Active Tehsil:</strong> <Badge bg="success" className="ml-2">{viewTehsil || user?.activeTehsil || 'N/A'}</Badge>
              </div>
              <div className="px-4 py-2">
                <strong>Select Tehsil:</strong>
                <select className="select select-sm mt-2" value={viewTehsil} onChange={(e) => setViewTehsil(e.target.value)} disabled={tehsilAccess.length <= 1}>
                  {tehsilAccess.map((e: any) => (
                    <option key={e.tehsil} value={e.tehsil}>{e.tehsil}{e.tehsil === user?.activeTehsil ? ' (Primary)' : ''}{e.isTemp || e.tempExpiresAt ? ' (Temporary)' : ''}</option>
                  ))}
                </select>
              </div>
            </Panel>
            <Panel title="All Assigned Tehsils" bodyClassName="">
              {tehsilAccess.map((e: any) => {
                const isTemp = e.isTemp || !!e.tempExpiresAt;
                const active = (e.tempGrants || []).filter((g: any) => new Date(g.expiresAt).getTime() > Date.now());
                const shortest = active.length ? Math.min(...active.map((g: any) => new Date(g.expiresAt).getTime())) : null;
                return (
                  <div key={e.tehsil} className="border-b border-[rgba(0,0,0,0.125)] px-4 py-2 last:border-b-0" style={{ borderLeft: isTemp ? '4px solid #f59e0b' : undefined, background: isTemp ? '#fffbeb' : undefined }}>
                    <strong>{e.tehsil}</strong>
                    {e.tehsil === user?.activeTehsil && <Badge bg="success" className="ml-2">Primary</Badge>}
                    {shortest && <Badge bg="warning" className="ml-2 whitespace-normal">Partial Temp Access{leftLabel(shortest, true)}</Badge>}
                    <div className="text-[0.875rem] text-ink-2">{e.mouzas?.length || 0} mouzas</div>
                  </div>
                );
              })}
            </Panel>
          </div>
          <Panel title={`Mouza Access for ${viewTehsil || 'Selected Tehsil'}`} className="min-w-0 self-start">
            {mouzas.length ? (
              <>
                <div className="mb-3">
                  <label className="field-label">Select Mouza:</label>
                  <select className="select select-sm" value={viewMouza} onChange={(e) => setViewMouza(e.target.value)} disabled={mouzas.length <= 1}>
                    {mouzas.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="info-card rounded-md border border-[#e9ecef] bg-[#f8f9fa] p-5 max-sm:p-3">
                  <div className="info-card-title text-[0.875rem] uppercase text-[#6c757d]">Total Mouzas</div>
                  <div className="info-card-value text-[1.1rem] font-semibold">{mouzas.length}</div>
                </div>
                <div className="mt-3">
                  <strong className="mb-2 block">All Mouzas:</strong>
                  <div className="max-h-[300px] overflow-y-auto rounded border border-[#dee2e6] bg-[#f8f9fa] p-2">
                    {mouzas.map((m, i) => {
                      const g = tempGrants.find((x: any) => x.mouza === m);
                      return (
                        <div key={m} className="flex items-center justify-between gap-2 border-b border-[#dee2e6] px-2 py-1" style={{ background: g ? '#fffbeb' : undefined }}>
                          <small className="text-[0.875rem]" style={{ fontWeight: g ? 600 : 400 }}>{i + 1}. {m}</small>
                          {g && <Badge bg="warning" className="!text-[0.65rem]">Temp Access{leftLabel(g.expiresAt, false)}</Badge>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="py-4 text-center text-ink-2">No mouzas for this tehsil</div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

/* ---------------- Activity ---------------- */
const toHMS = (secs: number) => `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ${secs % 60}s`;
export function ActivityTab({ user }: { user: any }) {
  const sessions: any[] = user?.sessions || [];
  const now = Date.now();
  const sod = new Date();
  sod.setHours(0, 0, 0, 0);
  const metrics = (from: Date) => {
    const arr = sessions.filter((s) => new Date(s.start) >= from);
    const total = arr.reduce((sum, s) => sum + (s.duration || 0), 0);
    return {
      count: arr.length,
      total,
      max: arr.length ? Math.max(...arr.map((s) => s.duration || 0)) : 0,
      avg: arr.length ? Math.round(total / arr.length) : 0,
      ipCount: new Set(arr.map((s) => s.ipAddress)).size,
    };
  };
  const cards: [string, ReturnType<typeof metrics>][] = [
    ['Today', metrics(sod)],
    ['Last 7 Days', metrics(new Date(now - 7 * 86400000))],
    ['Last 30 Days', metrics(new Date(now - 30 * 86400000))],
  ];
  return (
    <div className={pad}>
      <H4>Activity &amp; Analytics</H4>
      <Panel className="mb-4" title="Usage Overview">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {cards.map(([label, m]) => (
            <MetricCard key={label} value={m.count} label={label} sub="Sessions">
              <hr className="my-2 border-[#dee2e6]" />
              <div className="text-[0.875rem]">
                <div className="mb-1"><strong>Total Time:</strong> {toHMS(m.total)}</div>
                <div className="mb-1"><strong>Max:</strong> {toHMS(m.max)}</div>
                <div className="mb-1"><strong>Avg:</strong> {toHMS(m.avg)}</div>
                <div><strong>IPs:</strong> {m.ipCount}</div>
              </div>
            </MetricCard>
          ))}
        </div>
      </Panel>
      <Panel title="Session Timeline" right={<Badge bg="primary">{sessions.length} Total Sessions</Badge>} bodyClassName="max-h-[500px] overflow-y-auto">
        {sessions.length > 0 ? (
          <div className="responsive-table-wrapper overflow-x-auto">
            <table className={tableCls}>
              <thead className="sticky top-0 z-[1] bg-[#f8f9fa]"><tr><th>#</th><th>Start Time</th><th>End Time</th><th>Duration</th><th>IP Address</th></tr></thead>
              <tbody>
                {sessions.map((s, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-[rgba(0,0,0,0.03)]' : ''}>
                    <td>{i + 1}</td>
                    <td className="whitespace-nowrap">{fmtDateTime(s.start, 'N/A')}</td>
                    <td className="whitespace-nowrap">{fmtDateTime(s.end, 'N/A')}</td>
                    <td className="whitespace-nowrap">{s.duration ? toHMS(s.duration) : '—'}</td>
                    <td><code className="text-[0.875rem] text-[#d63384]">{s.ipAddress}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="📊" text="No Session Data" sub="No sessions have been recorded for this user yet" />
        )}
      </Panel>
    </div>
  );
}

/* ---------------- History (admin) ---------------- */
const TYPE_LABELS: Record<string, [string, any]> = {
  USER_CREATED: ['Created', 'primary'],
  ACTIVATION_SENT: ['Activation sent', 'secondary'],
  ACTIVATION_RESENT: ['Activation resent', 'secondary'],
  ACTIVATED: ['Activated', 'success'],
  RENEWED: ['Renewed', 'success'],
  TIER_UPGRADED: ['Upgraded', 'success'],
  PLAN_CHANGED: ['Plan changed', 'info'],
  ASSIGNMENT_CHANGED: ['Access changed', 'info'],
  PROFILE_EDITED: ['Profile edited', 'secondary'],
  EMAIL_CHANGE_REQUESTED: ['Email change requested', 'secondary'],
  EMAIL_CHANGED: ['Email changed', 'secondary'],
  SUSPENDED: ['Suspended', 'danger'],
  REACTIVATED: ['Reactivated', 'success'],
  TRANSFERRED: ['Transferred', 'warning'],
  DELETED: ['Deleted', 'danger'],
  CORRECTION_APPROVED: ['Correction', 'warning'],
  MOUZA_REQUEST_APPROVED: ['Extra mouzas approved', 'warning'],
};
const money = (n: any) => `Rs ${Number(n).toLocaleString('en-PK')}`;
function describe(e: any) {
  switch (e.type) {
    case 'RENEWED':
    case 'PLAN_CHANGED':
    case 'ACTIVATED':
    case 'USER_CREATED': {
      const parts: string[] = [];
      if (e.previousPlan && e.previousPlan !== e.plan) parts.push(`${e.previousPlan} → ${e.plan}`);
      else if (e.plan) parts.push(e.plan);
      if (e.periodEnd) parts.push(`until ${fmtDate(e.periodEnd)}`);
      if (e.type === 'RENEWED') {
        if (typeof e.paymentAmount === 'number') parts.push(money(e.paymentAmount));
        else if (typeof e.estimatedAmount === 'number') parts.push(`${money(e.estimatedAmount)} (not recorded; user's fee)`);
      }
      if (e.note) parts.push(e.note);
      return parts.join(' · ');
    }
    case 'ASSIGNMENT_CHANGED': {
      const a = e.after || {};
      const out: string[] = [];
      if (a.added?.length) out.push(`Added: ${a.added.join(', ')}`);
      if (a.removed?.length) out.push(`Removed: ${a.removed.join(', ')}`);
      return out.join(' · ') || 'Access updated';
    }
    case 'PROFILE_EDITED':
      return `Changed: ${(e.after?.changedFields || []).join(', ')}`;
    case 'TRANSFERRED':
      return `${e.before?.managedBy || 'Admin'} → ${e.after?.managedBy || 'Admin'}`;
    default:
      return e.note || '';
  }
}

export function HistoryTab({ user }: { user: any }) {
  const [events, setEvents] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proofs] = useProofs({ kind: 'renewal', userId: user.userId }, [user.userId]);
  const unlinked = proofs[`user:${user.userId}`];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/api/users/${encodeURIComponent(user.userId)}/history`, { params: { page, limit: 50 } });
      setEvents(data.events || []);
      setPages(data.pagination?.pages || 1);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load history.');
    } finally {
      setLoading(false);
    }
  }, [user.userId, page]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-3">
      <section className="card"><div className="card-body">
        <div className="mb-2 text-base font-semibold">Account History</div>
        <p className="text-[0.85rem] text-ink-2">Every change to this account, kept permanently. Entries marked &quot;migrated&quot; come from the old renewal list.</p>
        {error && <Alert variant="warning" className="mb-2">{error}</Alert>}
        {unlinked && <div className="mb-2 text-sm">Payment proof not matched to a renewal: <ProofViewButton proofs={unlinked} /></div>}
        {loading ? (
          <div className="py-4 text-center"><Spinner size="sm" /></div>
        ) : events.length === 0 ? (
          <div className="py-3 text-ink-2">No history recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><th>When</th><th>Event</th><th>Details</th><th>By</th></tr></thead>
              <tbody>
                {events.map((e) => {
                  const [label, variant] = TYPE_LABELS[e.type] || [e.type, 'secondary'];
                  return (
                    <tr key={e._id}>
                      <td className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
                      <td className="whitespace-nowrap"><Badge bg={variant}>{label}</Badge> <ProofViewButton proofs={proofs[String(e._id)]} /></td>
                      <td className="min-w-[180px] text-[0.85rem]">{describe(e)}</td>
                      <td className="whitespace-nowrap text-[0.8rem]">{e.source === 'migrated' ? <span className="text-ink-2">migrated</span> : `${e.actorId || 'system'} (${e.actorRole})`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between">
            <button type="button" className="btn btn-sm btn-outline-secondary min-h-9" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</button>
            <span className="text-[0.8rem] text-ink-2">Page {page} of {pages}</span>
            <button type="button" className="btn btn-sm btn-outline-secondary min-h-9" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Older</button>
          </div>
        )}
      </div></section>
    </div>
  );
}
