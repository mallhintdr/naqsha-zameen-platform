// Per sub-admin detail dialog (legacy AdminSubAdminConsole.js DetailModal) — 6 sub-tabs.
import { useCallback, useEffect, useState } from 'react';
import { Banknote, ChartLine, Check, History, Inbox, Lock, LockOpen, Pencil, Save, Settings, Users } from 'lucide-react';
import { Alert, Badge, Button, Modal, Spinner, cn, useDialog } from '@/shared/ui';
import { PerformancePanel, SubAdminRenewalsPanel } from '@/features/subadmin/SubAdminDashboardPage';
import { PaymentProofInput, ProofViewButton, uploadPaymentProof, useProofs, hasProof, EMPTY_PROOF } from '@/shared/components/PaymentProof';
import { api, errText, rs, fmtDate, fmtDateTime } from '@/features/subadmin/subAdminApi';
import { DETAIL_FIELD_LABEL as FL, DetailInfo as Info, DetailSection as Section, RequestsTable, StatusBadge, TXT, TerritoryPicker } from './shared';

const EV_BLANK = { type: '', customer: '', actorRole: '', from: '', to: '', billable: false };
const METHODS = (
  <>
    <option value="jazzcash">JazzCash</option>
    <option value="easypaisa">EasyPaisa</option>
    <option value="bank">Bank transfer</option>
    <option value="cash">Cash</option>
  </>
);
const TBL = 'table table-striped table-hover sticky-list whitespace-nowrap';

export default function DetailModal({ userId, onHide, onChanged }: { userId: string; onHide: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [bills, setBills] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [pay, setPay] = useState({ amount: '', method: 'jazzcash', reference: '', note: '', receivedAt: new Date().toISOString().slice(0, 10) });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/admin/subadmins/${encodeURIComponent(userId)}`;
  const { confirm, prompt } = useDialog();
  const [dTab, setDTab] = useState('money');
  const [perf, setPerf] = useState<any>(null);
  useEffect(() => {
    if (dTab !== 'performance' || perf) return;
    api.get(`${base}/stats`).then(setPerf).catch((e) => setError(errText(e)));
  }, [dTab, perf, base]);

  // Customers of this sub-admin
  const [custs, setCusts] = useState<{ users: any[]; total: number; loaded: boolean }>({ users: [], total: 0, loaded: false });
  const [custQ, setCustQ] = useState('');
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      api.get('/api/users', { owner: userId, page: 1, limit: 100, tab: 'all', searchId: custQ.trim() })
        .then((r) => alive && setCusts({ users: r.users || [], total: r.pagination?.total ?? (r.users || []).length, loaded: true }))
        .catch(() => alive && setCusts((c) => ({ ...c, loaded: true })));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [userId, custQ]);

  const [corr, setCorr] = useState({ amount: '', reason: '' });
  const [payProof, setPayProof] = useState<any>(EMPTY_PROOF);
  const [proofsByPayment, reloadProofs] = useProofs({ kind: 'subadmin_payment', subAdminId: userId }, [userId]);
  const recordPayment = async (confirmDuplicate: boolean) => {
    const r = await api.post(`${base}/payments`, { ...pay, amount: Number(pay.amount), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) });
    if (hasProof(payProof) && r.payment?._id) {
      try {
        await uploadPaymentProof({ kind: 'subadmin_payment', refId: r.payment._id, proof: payProof });
      } catch (e) {
        r.message += ` (Payment saved, but the proof could not be attached: ${errText(e)})`;
      }
    }
    setPayProof(EMPTY_PROOF);
    setPay((p) => ({ ...p, amount: '', reference: '', note: '' }));
    reloadProofs();
    return r;
  };

  const [evFilter, setEvFilter] = useState<any>(EV_BLANK);
  const [evPage, setEvPage] = useState(1);
  const [ev, setEv] = useState<any>({ events: [], types: [], pagination: { total: 0, pages: 1 } });
  const [evLoading, setEvLoading] = useState(false);
  const [evTick, setEvTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      setEvLoading(true);
      try {
        const params: any = { page: evPage, limit: 50 };
        Object.entries(evFilter).forEach(([k, v]) => {
          if (v) params[k] = v === true ? 'true' : v;
        });
        const r = await api.get(`${base}/events`, params);
        const events = Array.isArray(r?.events) ? r.events : [];
        if (alive)
          setEv({
            events,
            types: Array.isArray(r?.types) ? r.types : [...new Set(events.map((e: any) => e.type))].sort(),
            pagination: r?.pagination || { total: events.length, pages: 1 },
          });
      } catch (e) {
        if (alive) setError(errText(e));
      } finally {
        if (alive) setEvLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [base, evFilter, evPage, evTick]);
  const setEvF = (k: string, v: any) => {
    setEvFilter((p: any) => ({ ...p, [k]: v }));
    setEvPage(1);
  };
  const evActive = Object.values(evFilter).some(Boolean);

  const [lines, setLines] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [det, b, ln] = await Promise.all([api.get(base), api.get(`${base}/bills`), api.get(`${base}/events`, { billable: 'true', limit: 200 })]);
      setD(det);
      setBills(b);
      setLines(Array.isArray(ln?.events) ? ln.events : []);
      const s = det.subAdmin;
      setSettings({
        territory: s.territory, trialQuotaPerMonth: s.trialQuotaPerMonth, unpaidThreshold: s.unpaidThreshold, paymentWindowDays: s.paymentWindowDays,
        finalWarningHours: s.finalWarningHours, billEmail: s.billEmail || '', notes: s.notes || '', allowedPlans: s.allowedPlans, priceOverride: s.priceOverride || [],
      });
    } catch (e) {
      setError(errText(e));
    }
  }, [base]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<any>, confirmText?: string): Promise<void> => {
    if (confirmText && !(await confirm(confirmText))) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(r?.message);
      await load();
      setEvTick((x) => x + 1);
      onChanged();
    } catch (e: any) {
      if (e?.response?.status === 409 && e.response.data?.duplicate) {
        setBusy(false);
        if (await confirm(e.response.data.message, { title: 'Possible duplicate payment', okLabel: 'Record anyway', variant: 'warning' })) return run(() => recordPayment(true));
      }
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const saveEdit = () =>
    run(async () => {
      const r =
        edit.kind === 'payment'
          ? await api.put(`/api/admin/subadmin-payments/${edit.item._id}`, { amount: Number(edit.amount), method: edit.method, receivedAt: edit.receivedAt, reference: edit.reference, note: edit.note, reason: edit.reason.trim() })
          : await api.put(`${base}/bill-lines/${edit.item._id}`, { amount: Number(edit.amount), reason: edit.reason.trim() });
      setEdit(null);
      return r;
    });

  const sa = d?.subAdmin;
  const pendingReq = d ? d.requests.filter((r: any) => r.status === 'pending').length : 0;
  const overdue = d?.position.overdue || 0;
  const TABS_D: any[] = [
    { id: 'money', label: 'Money', Icon: Banknote, color: overdue > 0 ? 'danger' : d?.position.balance > 0 ? 'warning' : 'success' },
    { id: 'performance', label: 'Performance', Icon: ChartLine, color: 'success' },
    { id: 'customers', label: 'Customers', Icon: Users, color: 'primary', badge: custs.total, bg: 'primary' },
    { id: 'activity', label: 'Activity', Icon: History, color: 'info', badge: ev.pagination.total, bg: evActive ? 'info' : 'secondary' },
    { id: 'requests', label: 'Requests', Icon: Inbox, color: pendingReq ? 'danger' : 'secondary', badge: pendingReq, bg: pendingReq ? 'danger' : 'success' },
    { id: 'settings', label: 'Settings', Icon: Settings, color: 'secondary' },
  ];
  const inp = 'input input-sm';

  return (
    <Modal
      show
      onHide={onHide}
      size="wide"
      scrollable={false}
      bodyClassName="!p-0 flex flex-col overflow-hidden sm:h-[calc(100dvh-150px)]"
      title={
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          Sub-admin: {d?.user?.userName || userId}
          <span className="ml-1 text-[0.85rem] font-medium text-[#7dd3fc]">({userId})</span> {sa && <StatusBadge s={sa.status} />}
        </span>
      }
      footer={<Button variant="secondary" onClick={onHide}>Close</Button>}
    >
      <div className="shrink-0 bg-white px-3 pt-2">
        <div className="tabs sa-detail-tabs !mb-0 !gap-2" role="tablist">
          {TABS_D.map(({ id, label, Icon, color, badge, bg }) => (
            <button key={id} role="tab" className={cn('tab', dTab === id && 'active')} onClick={() => setDTab(id)}>
              <Icon style={{ color: TXT[color], width: '1.2em', height: '1.2em' }} />
              {label}
              {badge !== undefined && <Badge bg={bg} className="ml-1 !text-[0.6rem]">{badge}</Badge>}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-white px-[18px] py-[14px] text-teal-ink max-sm:px-2">
        {error && <Alert variant="danger" onClose={() => setError(null)} className="mb-2 py-2">{error}</Alert>}
        {msg && <Alert variant="success" onClose={() => setMsg(null)} className="mb-2 py-2">{msg}</Alert>}
        {!d ? (
          <div className="py-10 text-center"><Spinner /></div>
        ) : (
          <>
            {dTab === 'money' && (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Info label="Owed">{rs(d.position.balance)}</Info>
                  <Info label="Overdue" color={overdue ? '#dc3545' : '#198754'}>{rs(overdue)}</Info>
                  <Info label="Due, not overdue">{rs(d.position.dueNotOverdue)}</Info>
                  <Info label="Today so far" color="#0d6efd">{rs(d.position.today.total)}</Info>
                  <Info label="Paid in total" color="#198754">{rs(d.position.paidTotal)}</Info>
                  {d.position.advanceCredit > 0 && <Info label="Advance credit" color="#6f42c1">{rs(d.position.advanceCredit)}</Info>}
                </div>
                {sa.finalWarning?.deadline && (
                  <Alert variant="danger" className="mb-2 py-2">Final warning deadline: <strong>{fmtDateTime(sa.finalWarning.deadline)}</strong></Alert>
                )}

                <Section title="Correct money owed" className="mb-3">
                  <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-12">
                    <div className="md:col-span-3">
                      <label className={FL}>Correct amount owed (Rs)</label>
                      <input className={inp} type="number" min="0" value={corr.amount} onChange={(e) => setCorr((c) => ({ ...c, amount: e.target.value }))} placeholder={String(d.position.balance)} />
                    </div>
                    <div className="md:col-span-6">
                      <label className={FL}>Reason</label>
                      <input className={inp} value={corr.reason} onChange={(e) => setCorr((c) => ({ ...c, reason: e.target.value }))} placeholder="e.g. old renewals billed at tier prices" />
                    </div>
                    <div className="md:col-span-3">
                      <Button
                        variant="warning"
                        block
                        disabled={busy || corr.amount === '' || corr.reason.trim().length < 3}
                        onClick={() =>
                          run(async () => {
                            const r = await api.post(`${base}/correct-balance`, { amount: Number(corr.amount), reason: corr.reason.trim() });
                            setCorr({ amount: '', reason: '' });
                            return r;
                          }, `Change money owed from ${rs(d.position.balance)} to ${rs(Number(corr.amount) || 0)}?`)
                        }
                      >
                        <Pencil size={14} /> Correct
                      </Button>
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-ink-2">
                    The difference ({rs((Number(corr.amount) || 0) - d.position.balance)}) is added to today's bill as an adjustment line. To fix a single renewal's amount or a payment, use the{' '}
                    <Pencil size={12} className="inline" /> buttons in the lists below instead.
                    {sa.balanceCorrection?.at && (
                      <> Last correction: {fmtDateTime(sa.balanceCorrection.at)} by {sa.balanceCorrection.by}, {rs(sa.balanceCorrection.from)} → {rs(sa.balanceCorrection.to)}.</>
                    )}
                  </div>
                </Section>

                <Section title="Record payment" className="mb-3">
                  <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-6">
                    <div><label className={FL}>Amount (Rs)</label><input className={inp} type="number" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} /></div>
                    <div><label className={FL}>Method</label><select className="select select-sm" value={pay.method} onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}>{METHODS}</select></div>
                    <div><label className={FL}>Reference</label><input className={inp} value={pay.reference} onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))} /></div>
                    <div><label className={FL}>Received on</label><input className={inp} type="date" value={pay.receivedAt} onChange={(e) => setPay((p) => ({ ...p, receivedAt: e.target.value }))} /></div>
                    <div><label className={FL}>Note</label><input className={inp} value={pay.note} onChange={(e) => setPay((p) => ({ ...p, note: e.target.value }))} /></div>
                    <div><Button variant="success" block disabled={busy || !pay.amount} onClick={() => run(() => recordPayment(false))}><Check size={14} /> Record</Button></div>
                  </div>
                  <div className="mt-2"><PaymentProofInput value={payProof} onChange={setPayProof} compact disabled={busy} /></div>
                </Section>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <Section title="Daily bills">
                    <div className="table-wrap max-h-[360px]">
                      <table className={cn(TBL, 'text-[0.88rem]')}>
                        <thead><tr><th>Day</th><th className="!text-right">Total</th><th className="!text-right">Paid</th><th className="!text-right">Unpaid</th><th>Status</th></tr></thead>
                        <tbody>
                          {bills?.bills.length ? (
                            bills.bills.map((b: any) => (
                              <tr key={b._id}>
                                <td>{b.day}</td><td className="text-right">{rs(b.total)}</td><td className="text-right">{rs(b.paidAmount)}</td><td className="text-right">{rs(b.unpaid)}</td>
                                <td>{b.unpaid > 0 ? <Badge bg={b.overdue ? 'danger' : 'warning'}>{b.overdue ? 'overdue' : `due ${fmtDate(b.dueAt)}`}</Badge> : <Badge bg="success">paid</Badge>}</td>
                              </tr>
                            ))
                          ) : (
                            <tr><td colSpan={5} className="text-center text-ink-2">No bills yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Section>
                  <Section title="Payments">
                    <div className="table-wrap max-h-[360px]">
                      <table className={cn(TBL, 'text-[0.88rem]')}>
                        <thead><tr><th>Date</th><th>Method / reference</th><th className="!text-right">Amount</th><th /></tr></thead>
                        <tbody>
                          {bills?.payments.length ? (
                            bills.payments.map((p: any) => (
                              <tr key={p._id}>
                                <td>{fmtDate(p.receivedAt)}</td>
                                <td className="whitespace-normal">
                                  {p.method}{p.reference ? ` · ${p.reference}` : ''}
                                  {p.note ? <div className="text-sm text-ink-2">{p.note}</div> : null}
                                </td>
                                <td className={cn('text-right font-bold', p.amount < 0 ? 'text-[#dc3545]' : 'text-[#198754]')}>{rs(p.amount)}</td>
                                <td>
                                  <span className="inline-flex items-center gap-2">
                                    <ProofViewButton proofs={proofsByPayment[String(p._id)]} />
                                    {p.amount > 0 && (
                                      <button
                                        className="btn btn-sm btn-link !p-0"
                                        title={p.edits?.length ? `Edited ${p.edits.length} time(s)` : 'Edit payment'}
                                        onClick={() => setEdit({ kind: 'payment', item: p, amount: String(p.amount), method: p.method, receivedAt: new Date(p.receivedAt).toISOString().slice(0, 10), reference: p.reference || '', note: p.note || '', reason: '' })}
                                      >
                                        <Pencil size={13} />
                                        {p.edits?.length ? <sup className="text-[#ffc107]">✎</sup> : null}
                                      </button>
                                    )}
                                    {p.amount > 0 && !bills.payments.some((x: any) => String(x.reversesPaymentId) === String(p._id)) && (
                                      <button
                                        className="btn btn-sm btn-link !p-0 !text-[#dc3545]"
                                        onClick={async () => {
                                          const reason = await prompt('Reason for reversing this payment?', { title: 'Reverse payment', required: true, okLabel: 'Reverse', variant: 'danger' });
                                          if (reason) run(() => api.post(`/api/admin/subadmin-payments/${p._id}/reverse`, { reason }));
                                        }}
                                      >
                                        reverse
                                      </button>
                                    )}
                                  </span>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr><td colSpan={4} className="text-center text-ink-2">No payments yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </Section>
                </div>

                <Section title="Billed items (payable to admin)" className="mt-3">
                  <div className="table-wrap max-h-[360px]">
                    <table className={cn(TBL, 'text-[0.85rem]')}>
                      <thead><tr><th>Date</th><th>Customer</th><th>Item</th><th>Plan</th><th className="!text-right">Amount</th><th /></tr></thead>
                      <tbody>
                        {lines.length ? (
                          lines.map((l) => (
                            <tr key={l._id}>
                              <td>{fmtDateTime(l.createdAt)}</td>
                              <td className="font-semibold">{l.userId}</td>
                              <td>{l.type.replace(/_/g, ' ').toLowerCase()}</td>
                              <td>{l.plan || '—'}</td>
                              <td className={cn('text-right font-bold', l.platformPrice < 0 && 'text-[#dc3545]')}>
                                {rs(l.platformPrice)}
                                {l.originalPlatformPrice !== undefined && <div className="text-[0.72rem] font-normal text-ink-2">was {rs(l.originalPlatformPrice)}</div>}
                              </td>
                              <td className="text-center">
                                {!['BALANCE_ADJUSTED', 'CORRECTION_APPROVED'].includes(l.type) && (
                                  <button className="btn btn-sm btn-link !p-0" title="Edit amount" onClick={() => setEdit({ kind: 'line', item: l, amount: String(l.platformPrice || 0), reason: '' })}>
                                    <Pencil size={13} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr><td colSpan={6} className="text-center text-ink-2">No billed items yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Section>
              </>
            )}

            {dTab === 'settings' && settings && (
              <>
                <Section title="Limits and billing" className="mb-3">
                  <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-4">
                    {[['trialQuotaPerMonth', 'Trials / month', ''], ['unpaidThreshold', 'Warning at overdue', 'Rs'], ['paymentWindowDays', 'Payment window', 'days'], ['finalWarningHours', 'Warning deadline', 'hours']].map(([k, l, unit]) => (
                      <div key={k} className="flex min-w-0 flex-col">
                        <label className={cn(FL, 'truncate')} title={l}>{l}</label>
                        <div className="flex">
                          <input className={cn(inp, unit && 'rounded-r-none')} type="number" value={settings[k] ?? ''} onChange={(e) => setSettings((s: any) => ({ ...s, [k]: e.target.value }))} />
                          {unit && <span className="flex min-w-[52px] items-center justify-center rounded-r border border-l-0 border-[#495057] bg-[#e9ecef] px-2 text-sm">{unit}</span>}
                        </div>
                      </div>
                    ))}
                    <div className="col-span-2">
                      <label className={FL}>Bill email (optional)</label>
                      <input className={inp} value={settings.billEmail} onChange={(e) => setSettings((s: any) => ({ ...s, billEmail: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <label className={FL}>Plans allowed</label>
                      <div className="flex min-h-[31px] flex-wrap items-center gap-3 rounded border border-[#dee2e6] bg-white px-2">
                        {['Trial24', 'Monthly', 'Yearly'].map((p) => (
                          <label key={p} className="inline-flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              className="check"
                              checked={settings.allowedPlans.includes(p)}
                              onChange={(e) => setSettings((s: any) => ({ ...s, allowedPlans: e.target.checked ? [...s.allowedPlans, p] : s.allowedPlans.filter((x: string) => x !== p) }))}
                            />
                            {p === 'Trial24' ? 'Trial (24h)' : p}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </Section>

                <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <Section title="Negotiated prices (optional, per tier)">
                    <div className="table-wrap">
                      <table className="table text-[0.88rem]">
                        <thead><tr><th>Tier</th><th>Standard</th><th>Monthly</th><th>Yearly</th></tr></thead>
                        <tbody>
                          {d.prices.tiers.map((t: any) => {
                            const o = settings.priceOverride.find((x: any) => x.tierKey === t.key) || {};
                            const upd = (field: string, v: string) =>
                              setSettings((s: any) => {
                                const rest = s.priceOverride.filter((x: any) => x.tierKey !== t.key);
                                const next = { tierKey: t.key, monthly: o.monthly, yearly: o.yearly, [field]: v ? Number(v) : undefined };
                                return { ...s, priceOverride: next.monthly || next.yearly ? [...rest, next] : rest };
                              });
                            return (
                              <tr key={t.key}>
                                <td className="whitespace-nowrap">{t.key} ({t.minMouzas === t.maxMouzas ? t.minMouzas : `${t.minMouzas}–${t.maxMouzas}`})</td>
                                <td className="whitespace-nowrap text-ink-2">{rs(t.monthly)} / {rs(t.yearly)}</td>
                                <td><input className={cn(inp, 'min-w-[70px]')} type="number" placeholder="—" value={o.monthly || ''} onChange={(e) => upd('monthly', e.target.value)} /></td>
                                <td><input className={cn(inp, 'min-w-[70px]')} type="number" placeholder="—" value={o.yearly || ''} onChange={(e) => upd('yearly', e.target.value)} /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Section>
                  <Section title="Territory">
                    <TerritoryPicker value={settings.territory} onChange={(t) => setSettings((s: any) => ({ ...s, territory: t }))} />
                  </Section>
                </div>

                <Section title="Notes (admin only)" className="mb-3">
                  <textarea className="textarea" rows={2} value={settings.notes} onChange={(e) => setSettings((s: any) => ({ ...s, notes: e.target.value }))} />
                </Section>
                <div className="mb-4 text-center">
                  <Button
                    className="min-w-[180px]"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        api.patch(base, {
                          ...settings,
                          trialQuotaPerMonth: Number(settings.trialQuotaPerMonth), unpaidThreshold: Number(settings.unpaidThreshold),
                          paymentWindowDays: Number(settings.paymentWindowDays), finalWarningHours: Number(settings.finalWarningHours),
                        }),
                      )
                    }
                  >
                    <Save size={14} /> Save settings
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <Section title="Payment details shown to their customers">
                    <div className="grid grid-cols-2 gap-2 text-[0.9rem]">
                      <div><span className="text-ink-2">JazzCash:</span> <strong>{sa.paymentDetails?.jazzcash?.number || '—'}</strong></div>
                      <div><span className="text-ink-2">EasyPaisa:</span> <strong>{sa.paymentDetails?.easypaisa?.number || '—'}</strong></div>
                      <div><span className="text-ink-2">Phone:</span> <strong>{sa.paymentDetails?.phone || '—'}</strong></div>
                      <div><span className="text-ink-2">WhatsApp:</span> <strong>{sa.paymentDetails?.whatsapp || '—'}</strong></div>
                    </div>
                    <Button
                      size="sm"
                      variant={sa.paymentDetails?.lockedByAdmin ? 'outline-success' : 'outline-secondary'}
                      className="mt-2"
                      disabled={busy}
                      onClick={() => run(() => api.put(`${base}/payment-details`, { locked: !sa.paymentDetails?.lockedByAdmin }))}
                    >
                      {sa.paymentDetails?.lockedByAdmin ? <LockOpen size={13} /> : <Lock size={13} />}
                      {sa.paymentDetails?.lockedByAdmin ? 'Unlock' : 'Lock'} payment details
                    </Button>
                  </Section>
                  <Section title="Account">
                    <div className="flex flex-wrap gap-2">
                      {sa.status === 'awaiting_activation' && (
                        <Button size="sm" variant="outline-primary" onClick={() => run(() => api.post(`${base}/resend-activation`, {}))}>Resend activation</Button>
                      )}
                      {['suspended_unpaid', 'final_warning'].includes(sa.status) && (
                        <Button
                          size="sm"
                          variant="outline-success"
                          onClick={async () => {
                            const reason = await prompt('Reason for restoring (recorded):', { title: 'Restore sub-admin', required: true, okLabel: 'Restore', variant: 'success' });
                            if (reason) run(() => api.post(`${base}/restore`, { reason }));
                          }}
                        >
                          Restore now
                        </Button>
                      )}
                      {sa.status === 'disabled' ? (
                        <Button size="sm" variant="success" onClick={() => run(() => api.post(`${base}/enable`, {}))}>Enable</Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={async () => {
                            const reason = await prompt('Reason for disabling (recorded). They are logged out; their customers are not affected.', { title: 'Disable sub-admin', okLabel: 'Disable', variant: 'danger' });
                            if (reason !== null) run(() => api.post(`${base}/disable`, { reason }));
                          }}
                        >
                          Disable
                        </Button>
                      )}
                    </div>
                    <div className="mt-2 text-sm text-ink-2">Policy accepted: {sa.policy?.version ? `${sa.policy.version} on ${fmtDateTime(sa.policy.acceptedAt)}` : 'not yet'}</div>
                  </Section>
                </div>
              </>
            )}

            {dTab === 'activity' && (
              <>
                <Section className="mb-3">
                  <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-12">
                    <div className="col-span-2 md:col-span-3">
                      <label className={FL}>Event</label>
                      <select className="select select-sm" value={evFilter.type} onChange={(e) => setEvF('type', e.target.value)}>
                        <option value="">All events</option>
                        {ev.types.map((x: string) => <option key={x} value={x}>{x.replace(/_/g, ' ').toLowerCase()}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2"><label className={FL}>Customer ID</label><input className={inp} placeholder="Search..." value={evFilter.customer} onChange={(e) => setEvF('customer', e.target.value)} /></div>
                    <div className="md:col-span-2">
                      <label className={FL}>Done by</label>
                      <select className="select select-sm" value={evFilter.actorRole} onChange={(e) => setEvF('actorRole', e.target.value)}>
                        <option value="">Anyone</option><option value="subadmin">Sub-admin</option><option value="admin">Admin</option>
                        <option value="user">Customer</option><option value="system">System</option>
                      </select>
                    </div>
                    <div className="md:col-span-2"><label className={FL}>From</label><input className={inp} type="date" value={evFilter.from} onChange={(e) => setEvF('from', e.target.value)} /></div>
                    <div className="md:col-span-2"><label className={FL}>To</label><input className={inp} type="date" value={evFilter.to} onChange={(e) => setEvF('to', e.target.value)} /></div>
                    <div className="flex flex-col gap-1 md:col-span-1">
                      <label className="inline-flex items-center gap-1 text-[0.8rem]"><input type="checkbox" className="check" checked={evFilter.billable} onChange={(e) => setEvF('billable', e.target.checked)} /> Billed</label>
                      <Button size="sm" variant="outline-secondary" disabled={!evActive} onClick={() => { setEvFilter(EV_BLANK); setEvPage(1); }}>Clear</Button>
                    </div>
                  </div>
                </Section>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
                  <span>{evLoading ? 'Loading…' : `${ev.pagination.total} event(s)${evActive ? ' match the filters' : ''}`}</span>
                  {ev.pagination.pages > 1 && (
                    <span className="flex items-center gap-2">
                      <Button size="sm" variant="outline-primary" disabled={evPage <= 1} onClick={() => setEvPage((p) => p - 1)}>‹ Newer</Button>
                      Page {evPage} of {ev.pagination.pages}
                      <Button size="sm" variant="outline-primary" disabled={evPage >= ev.pagination.pages} onClick={() => setEvPage((p) => p + 1)}>Older ›</Button>
                    </span>
                  )}
                </div>
                {ev.events.length === 0 ? (
                  <div className="py-6 text-center text-ink-2">{evLoading ? <Spinner size="sm" /> : 'No activity matches.'}</div>
                ) : (
                  <div className="table-wrap max-h-[calc(100dvh-260px)]">
                    <table className={cn(TBL, 'text-[0.88rem]')} style={{ opacity: evLoading ? 0.6 : 1 }}>
                      <thead><tr><th>When</th><th>Customer</th><th>Event</th><th>Details</th><th>By</th></tr></thead>
                      <tbody>
                        {ev.events.map((e: any) => (
                          <tr key={e._id}>
                            <td>{fmtDateTime(e.createdAt)}</td>
                            <td><button className="btn btn-sm btn-link !p-0" onClick={() => setEvF('customer', e.userId)}>{e.userId}</button></td>
                            <td><Badge bg={e.billable ? 'primary' : 'light'} onClick={() => setEvF('type', e.type)}>{e.type.replace(/_/g, ' ').toLowerCase()}</Badge></td>
                            <td>{e.plan || ''} {e.platformPrice ? rs(e.platformPrice) : ''} {e.note || ''}</td>
                            <td className="text-ink-2">{e.actorId} ({e.actorRole})</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {dTab === 'performance' &&
              (perf ? (
                <>
                  <SubAdminRenewalsPanel stats={perf} revenueField="platformPrice" />
                  <div className="mt-4"><PerformancePanel stats={perf} /></div>
                </>
              ) : (
                <div className="py-10 text-center"><Spinner size="sm" /></div>
              ))}

            {dTab === 'customers' && (
              <>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <input className="input input-sm max-w-[260px]" placeholder="Search customer ID..." value={custQ} onChange={(e) => setCustQ(e.target.value)} />
                  <span className="text-sm text-ink-2">{custs.total} customer(s){custs.total > custs.users.length ? `, showing first ${custs.users.length}` : ''}</span>
                </div>
                {!custs.loaded ? (
                  <div className="py-6 text-center"><Spinner size="sm" /></div>
                ) : custs.users.length === 0 ? (
                  <div className="py-6 text-center text-ink-2">No customers.</div>
                ) : (
                  <div className="table-wrap max-h-[calc(100dvh-300px)]">
                    <table className="table">
                      <thead>
                        <tr><th className="freeze">User</th><th>Status</th><th>Plan</th><th>Days Left</th><th>Mouzas</th><th>Phone</th><th>Fee</th></tr>
                      </thead>
                      <tbody>
                        {custs.users.map((c) => {
                          const m = (c.tehsilAccess || []).reduce((n: number, a: any) => n + (a.mouzas || []).length, 0);
                          const st = c.status || '';
                          const days = c.endDate ? Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000) : 0;
                          const rowCls = st === 'AwaitingActivation' ? 'row-pending' : st === 'Suspended' || days <= 0 ? 'row-expired' : days <= 7 ? 'row-expiring' : 'row-active';
                          const v = st === 'Active' ? 'success' : st === 'Trial' ? 'info' : st === 'AwaitingActivation' ? 'secondary' : st === 'Suspended' ? 'dark' : 'danger';
                          return (
                            <tr key={c.userId} className={rowCls}>
                              <td className="freeze">
                                <strong className="text-[#002366]">{c.userName}</strong>
                                <br />
                                <span className="text-[0.8rem]">{c.userId}</span>
                              </td>
                              <td className="text-center"><Badge bg={v as any}>{st === 'AwaitingActivation' ? 'Awaiting' : st}</Badge></td>
                              <td>{c.subscriptionType}</td>
                              <td>{st === 'AwaitingActivation' ? '—' : days > 0 ? `${days} days` : 'Expired'}</td>
                              <td className="text-center">{m}</td>
                              <td className="whitespace-nowrap">{c.mobileNumber || 'N/A'}</td>
                              <td className="whitespace-nowrap">{c.fee ? rs(c.fee) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {dTab === 'requests' && (
              <RequestsTable
                rows={d.requests}
                onChanged={() => {
                  load();
                  onChanged();
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Edit a payment or a billed line */}
      <Modal
        show={!!edit}
        onHide={() => setEdit(null)}
        size="compact"
        zIndex={10600}
        title={<span className="text-[1.05rem]">{edit?.kind === 'payment' ? 'Edit payment' : `Edit billed amount — ${edit?.item?.userId || ''}`}</span>}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            <Button loading={busy} disabled={busy || !edit || edit.amount === '' || (edit.reason || '').trim().length < 3} onClick={saveEdit}>Save</Button>
          </>
        }
      >
        {edit && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className={edit.kind === 'payment' ? '' : 'col-span-2'}>
                <label className={FL}>{edit.kind === 'payment' ? 'Amount paid (Rs)' : `Payable to admin (Rs) — currently ${rs(edit.item.platformPrice)}`}</label>
                <input className={inp} type="number" value={edit.amount} onChange={(e) => setEdit((x: any) => ({ ...x, amount: e.target.value }))} />
              </div>
              {edit.kind === 'payment' && (
                <>
                  <div><label className={FL}>Method</label><select className="select select-sm" value={edit.method} onChange={(e) => setEdit((x: any) => ({ ...x, method: e.target.value }))}>{METHODS}</select></div>
                  <div><label className={FL}>Received on</label><input className={inp} type="date" value={edit.receivedAt} onChange={(e) => setEdit((x: any) => ({ ...x, receivedAt: e.target.value }))} /></div>
                  <div><label className={FL}>Reference</label><input className={inp} value={edit.reference} onChange={(e) => setEdit((x: any) => ({ ...x, reference: e.target.value }))} /></div>
                  <div className="col-span-2"><label className={FL}>Note</label><input className={inp} value={edit.note} onChange={(e) => setEdit((x: any) => ({ ...x, note: e.target.value }))} /></div>
                </>
              )}
              <div className="col-span-2">
                <label className={FL}>Reason for the change *</label>
                <input className={inp} value={edit.reason} onChange={(e) => setEdit((x: any) => ({ ...x, reason: e.target.value }))} placeholder="Recorded in the history" />
              </div>
            </div>
            {edit.kind === 'payment' && edit.item.edits?.length > 0 && (
              <div className="mt-2 text-sm text-ink-2">
                Previous edits:{' '}
                {edit.item.edits.map((x: any, i: number) => (
                  <div key={i}>
                    {fmtDateTime(x.at)} by {x.by}: {Object.keys(x.after || {}).map((k) => `${k} ${x.before?.[k] ?? '—'} → ${x.after[k]}`).join(', ')} ({x.reason})
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>
    </Modal>
  );
}
