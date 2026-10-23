// Customer: ask the provider (admin / sub-admin) to add or remove mouzas.
// Nothing changes until the provider approves it and sets the fee. On sending,
// WhatsApp opens with a summary + approval link.
import { useEffect, useMemo, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeftRight, CheckCircle2, Info, Lock, MessageCircle, Plus, Send, X } from 'lucide-react';
import { api, errText as apiErrText } from '@/shared/api/client';
import { Alert, Badge, Modal, Spinner, cn } from '@/shared/ui';
import { fetchConsolidatedTehsils, fetchMauzas } from '@/shared/lib/mouzaApi';
import { calculateDaysRemaining } from '@/shared/lib/userUtils';
import { isAkarTehsil, withoutAkar, AKAR_MESSAGE } from '@/shared/lib/akar';
import { fmtDate, fmtNumber } from '@/shared/lib/format';

const lc = (s: any) => String(s || '').toLowerCase();
const errText = (e: any) => apiErrText(e, 'Something went wrong.');
const BORDER = '1px solid #64748b';
const selectStyle: CSSProperties = { fontSize: '0.78rem', borderRadius: 4, border: BORDER, padding: '2px 28px 2px 8px', height: 28, backgroundPosition: 'right 0.5rem center' };

export const PROFILE_HEADER_STYLE: CSSProperties = {
  background: 'radial-gradient(circle at 20% 20%, rgba(45, 152, 255, 0.35), transparent 60%), linear-gradient(135deg, rgba(11, 14, 40, 0.9), rgba(18, 26, 54, 0.92))',
  color: 'white',
  border: 'none',
  padding: '6px 12px',
};
const ROW = 'flex items-center justify-between border-b border-[#f1f3f5] py-0.5';
const LABEL = 'font-medium text-[#6c757d]';

const TONE: Record<string, string> = {
  primary: 'radial-gradient(circle at 20% 20%, rgba(45, 152, 255, 0.45), transparent 60%), linear-gradient(135deg, rgba(11, 14, 40, 1), rgba(18, 26, 54, 1))',
  grey: '#6c757d',
  danger: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  success: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
};
/** Footer button in the Profile modal style. */
function CompactButton({ tone = 'primary', href, className, style, ...props }: { tone?: string; href?: string } & ComponentProps<'button'> & { target?: string; rel?: string }) {
  const cls = cn('inline-flex min-h-9 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md border-0 px-1 py-2 text-[0.8rem] font-semibold text-white disabled:opacity-65', className);
  const st = { background: TONE[tone], ...style };
  if (href) return <a href={href} target={(props as any).target} rel={(props as any).rel} className={cls} style={st}>{props.children}</a>;
  return <button type="button" {...props} className={cls} style={st} />;
}

function CompactModal({ show, onHide, icon, title, children, footer }: { show: boolean; onHide: () => void; icon: ReactNode; title: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <Modal id="change-mouzas-modal" show={show} onHide={onHide} size="sm" headerVariant="custom" headerStyle={PROFILE_HEADER_STYLE} headerClassName="text-white"
      title={<span className="flex items-center gap-2 text-[0.95rem] font-semibold">{icon}{title}</span>}
      bodyClassName="!px-3 !py-2.5 !text-[0.8rem]" footerClassName="!flex-nowrap !px-3 !py-2 !border-[#e9ecef]" footer={footer}>
      {children}
    </Modal>
  );
}

function InfoRows({ user, daysLeft }: { user: any; daysLeft: any }) {
  const cell = (k: string, v: any) => (
    <div className="min-w-0">
      <div className={cn(LABEL, 'text-[0.68rem] leading-[1.1]')}>{k}</div>
      <strong className="block truncate text-[#212529]" title={String(v ?? '')}>{v ?? '—'}</strong>
    </div>
  );
  const row = 'grid grid-cols-2 gap-2 border-b border-[#f1f3f5] py-0.5';
  return (
    <>
      <div className={row}>{cell('Name', user?.userName || '—')}{cell('User ID', user?.userId)}</div>
      <div className={row}>{cell('Plan', user?.subscriptionType || '—')}{cell('Days left', daysLeft)}</div>
    </>
  );
}

// Customers can ask for mouza changes only while their plan is running.
export function canChangeMouzas(user: any) {
  if (!user || user.userType !== 'user') return false;
  if (['Expired', 'AwaitingActivation', 'Suspended', 'Pending', 'PendingVerification', 'Inactive'].includes(user.status)) return false;
  const left = user.endDate ? (new Date(user.endDate).getTime() - Date.now()) : (user.startDate ? calculateDaysRemaining(user.startDate, user.subscriptionType) * 86400e3 : 0);
  return left > 0;
}

type Pick = { tehsil: string; mouza: string };

export default function ChangeMouzasModal({ show, onHide, user }: { show: boolean; onHide: () => void; user: any }) {
  const [tehsils, setTehsils] = useState<string[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [addTehsil, setAddTehsil] = useState('');
  const [addOptions, setAddOptions] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [toAdd, setToAdd] = useState<Pick[]>([]);
  const [toRemove, setToRemove] = useState<Pick[]>([]);
  const [note, setNote] = useState('');
  const [current, setCurrent] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<any>(null);

  const assigned = useMemo(() => (user?.tehsilAccess || []).filter((e: any) => (e.mouzas || []).length), [user]);
  const daysLeft = user?.endDate
    ? Math.max(0, Math.ceil((new Date(user.endDate).getTime() - Date.now()) / 86400e3))
    : (user?.startDate ? calculateDaysRemaining(user.startDate, user.subscriptionType) : null);

  useEffect(() => {
    if (!show) return;
    setToAdd([]); setToRemove([]); setNote(''); setError(null); setSent(null); setFilter('');
    fetchConsolidatedTehsils().then((l: any[]) => { setGroups(l); setTehsils(withoutAkar(l.map((x) => x.name))); }).catch(() => {});
    api.get('/api/me/assignment-requests/current').then((r) => setCurrent(r.data?.request || null)).catch(() => setCurrent(null));
    const firstNonAkar = [user?.activeTehsil, ...assigned.map((a: any) => a.tehsil)].find((t) => t && !isAkarTehsil(t));
    setAddTehsil(firstNonAkar || '');
  }, [show]);  

  const sameTehsil = (a: string, b: string) => {
    if (lc(a) === lc(b)) return true;
    const g = groups.find((x) => lc(x.name) === lc(a) || (x.rawAliases || []).some((n: string) => lc(n) === lc(a)));
    return !!g && (lc(g.name) === lc(b) || (g.rawAliases || []).some((n: string) => lc(n) === lc(b)));
  };
  useEffect(() => {
    if (!addTehsil || !groups.length || tehsils.some((x) => lc(x) === lc(addTehsil))) return;
    const g = groups.find((x) => (x.rawAliases || []).some((n: string) => lc(n) === lc(addTehsil)));
    if (g) setAddTehsil(g.name);
  }, [groups, tehsils, addTehsil]);

  useEffect(() => {
    if (!addTehsil) { setAddOptions([]); return; }
    let alive = true;
    fetchMauzas(addTehsil).then((list: any) => { if (alive) setAddOptions(Array.isArray(list) ? list : []); }).catch(() => alive && setAddOptions([]));
    return () => { alive = false; };
  }, [addTehsil]);

  const have = (tehsil: string, mouza: string) => assigned.some((e: any) => sameTehsil(e.tehsil, tehsil) && (e.mouzas || []).some((m: string) => lc(m) === lc(mouza)));
  const inList = (list: Pick[], tehsil: string, mouza: string) => list.some((x) => lc(x.tehsil) === lc(tehsil) && lc(x.mouza) === lc(mouza));
  const without = (list: Pick[], tehsil: string, mouza: string) => list.filter((x) => !(lc(x.tehsil) === lc(tehsil) && lc(x.mouza) === lc(mouza)));
  const isSelected = (tehsil: string, mouza: string) => (have(tehsil, mouza) ? !inList(toRemove, tehsil, mouza) : inList(toAdd, tehsil, mouza));
  const toggle = (tehsil: string, mouza: string) => {
    if (have(tehsil, mouza)) setToRemove((p) => (inList(p, tehsil, mouza) ? without(p, tehsil, mouza) : [...p, { tehsil, mouza }]));
    else setToAdd((p) => (inList(p, tehsil, mouza) ? without(p, tehsil, mouza) : [...p, { tehsil, mouza }]));
  };
  const listed = useMemo(() => {
    const names = [...addOptions];
    assigned.filter((e: any) => sameTehsil(e.tehsil, addTehsil)).forEach((e: any) => (e.mouzas || []).forEach((m: string) => { if (!names.some((n) => lc(n) === lc(m))) names.push(m); }));
    const q = lc(filter).trim();
    const sorted = names.filter((m) => !q || lc(m).includes(q)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const rank = (m: string) => {
      const mine = have(addTehsil, m);
      if (mine && !inList(toRemove, addTehsil, m)) return 0;
      if (!mine && inList(toAdd, addTehsil, m)) return 1;
      if (mine) return 2;
      return 3;
    };
    return [0, 1, 2, 3].flatMap((r) => sorted.filter((m) => rank(m) === r));
  }, [addOptions, assigned, addTehsil, filter, toAdd, toRemove, groups]);  
  const group = (list: Pick[]) => Object.values(list.reduce((acc: Record<string, { tehsil: string; mouzas: string[] }>, { tehsil, mouza }) => { (acc[tehsil] = acc[tehsil] || { tehsil, mouzas: [] }).mouzas.push(mouza); return acc; }, {}));
  const pending = current?.status === 'pending' ? current : null;

  const send = async () => {
    setBusy(true); setError(null);
    const waTab = window.open('', '_blank');
    try {
      const { data } = await api.post('/api/me/assignment-requests', { add: group(toAdd), remove: group(toRemove), note });
      const number = String(data.whatsappNumber || import.meta.env.VITE_WHATSAPP_NUMBER || '923048840264').replace(/\D/g, '');
      const waUrl = `https://wa.me/${number}?text=${encodeURIComponent(data.whatsappText)}`;
      if (waTab) waTab.location.href = waUrl;
      setSent({ ...data, waUrl });
      setCurrent(data.request);
    } catch (e) {
      if (waTab) waTab.close();
      setError(errText(e));
    } finally { setBusy(false); }
  };

  const cancelPending = async () => {
    setBusy(true); setError(null);
    try { await api.delete('/api/me/assignment-requests/current'); setCurrent(null); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <CompactModal show={show} onHide={onHide} icon={<Send size={15} />} title="Request Sent"
        footer={<>
          <CompactButton tone="success" href={sent.waUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} />Open WhatsApp</CompactButton>
          <CompactButton tone="grey" onClick={onHide}>OK</CompactButton>
        </>}>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-center text-[#28a745]"><CheckCircle2 size={32} /></div>
          <div className="text-center font-semibold">Your request was sent to {sent.providerName || 'your provider'}.</div>
          <InfoRows user={user} daysLeft={sent.daysLeft} />
          <Alert variant="warning" className="!p-2 !text-[0.78rem]">
            <Info size={13} className="mr-1 inline" />
            Changing mouzas may cost a <strong>small fee</strong>, depending on the number of mouzas and the <strong>{sent.daysLeft} day(s)</strong> left in your plan. Your provider will tell you the amount. The change is made once they approve it.
          </Alert>
          <div className="text-[0.72rem] text-ink-2">If WhatsApp didn&apos;t open, tap <strong>Open WhatsApp</strong> to send the request message.</div>
        </div>
      </CompactModal>
    );
  }

  return (
    <CompactModal show={show} onHide={onHide} icon={<ArrowLeftRight size={15} />} title="Change My Mouzas"
      footer={<>
        <CompactButton tone="grey" onClick={onHide}>Close</CompactButton>
        <CompactButton tone="primary" disabled={busy || (!toAdd.length && !toRemove.length)} onClick={send}>
          {busy ? <Spinner size="sm" className="text-white" /> : <><MessageCircle size={14} />Send Request</>}
        </CompactButton>
      </>}>
      <div className="flex flex-col gap-1">
        {error && <Alert variant="danger" className="mb-1 !px-2 !py-1 !text-[0.75rem]" onClose={() => setError(null)}>{error}</Alert>}
        {assigned.some((a: any) => isAkarTehsil(a.tehsil)) && (
          <Alert variant="warning" className="mb-1 !px-2 !py-1 !text-[0.72rem]"><Lock size={12} className="mr-1 inline" />{AKAR_MESSAGE} Your AKAR chaks stay as they are.</Alert>
        )}
        {pending && (
          <Alert variant="info" className="mb-1 !px-2 !py-1 !text-[0.75rem]">
            You already have a request waiting for approval (sent {fmtDate(pending.createdAt)}). Sending a new one replaces it.
            <div><button type="button" className="text-[0.75rem] text-[#0d6efd] hover:underline" disabled={busy} onClick={cancelPending}>Cancel that request</button></div>
          </Alert>
        )}
        {current?.status === 'invoiced' && current.invoice && (
          <Alert variant="warning" className="mb-2 !px-2 !py-1 !text-[0.78rem]">
            <strong>Invoice {current.invoice.number}: Rs {fmtNumber(current.invoice.amount || 0)}</strong>, pay by {fmtDate(current.invoice.dueAt)}.
            {' '}The mouzas are added after your payment is confirmed. Please send the payment screenshot to your provider.
          </Alert>
        )}
        {current && !['pending', 'invoiced'].includes(current.status) && current.decidedAt && (Date.now() - new Date(current.decidedAt).getTime()) < 7 * 86400e3 && (
          <div className={ROW}><span className={LABEL}>Last request</span>
            <Badge bg={current.status === 'approved' ? 'success' : current.status === 'rejected' ? 'danger' : 'secondary'}>{current.status}{current.status === 'approved' && current.fee ? ` · Rs ${current.fee}` : ''}</Badge></div>
        )}

        <InfoRows user={user} daysLeft={daysLeft} />

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Tehsil</span>
          <select className="select" value={addTehsil} onChange={(e) => { setAddTehsil(e.target.value); setFilter(''); }} style={selectStyle}>
            <option value="">-- Select Tehsil --</option>
            {tehsils.map((t) => <option key={t} value={t}>{t}{assigned.some((a: any) => sameTehsil(a.tehsil, t)) ? ' ✓' : ''}</option>)}
          </select>
          <div className="overflow-hidden rounded" style={{ border: BORDER }}>
            <div className="bg-[#f1f5f9] p-[3px]" style={{ borderBottom: BORDER }}>
              <input className="input input-sm !text-[0.76rem]" style={{ height: 26, border: BORDER }} placeholder={addTehsil ? `Filter mouzas (${listed.length})...` : 'Select a tehsil first'} value={filter} onChange={(e) => setFilter(e.target.value)} disabled={!addTehsil} />
            </div>
            <div className="max-h-[190px] overflow-y-auto">
              {addTehsil && listed.length === 0 && <div className="py-2 text-center text-ink-2">{addOptions.length ? 'No mouza matches.' : 'Loading mouzas...'}</div>}
              {listed.map((m) => {
                const sel = isSelected(addTehsil, m);
                const changed = have(addTehsil, m) ? inList(toRemove, addTehsil, m) : inList(toAdd, addTehsil, m);
                return (
                  <div key={m} onClick={() => toggle(addTehsil, m)} className="flex min-h-8 cursor-pointer items-center justify-between border-b border-[#e2e8f0] px-1.5 py-0.5 sm:min-h-0"
                    style={{ background: changed ? (sel ? '#dcfce7' : '#fee2e2') : '#fff' }}>
                    <span style={{ color: sel ? '#166534' : '#334155', fontWeight: sel ? 600 : 400 }}>
                      {m}
                      {changed && <span className="ml-1.5 text-[0.65rem]" style={{ color: sel ? '#16a34a' : '#dc2626' }}>{sel ? 'to add' : 'to remove'}</span>}
                    </span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggle(addTehsil, m); }} title={sel ? 'Unselect' : 'Select'}
                      className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-0 p-0 text-white"
                      style={{ background: sel ? '#dc3545' : '#28a745' }}>
                      {sel ? <X size={12} strokeWidth={3} /> : <Plus size={12} strokeWidth={3} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <textarea className="textarea !text-[0.76rem] !py-1" rows={1} placeholder="Message for your provider (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ border: BORDER, resize: 'vertical' }} />

        <div className="flex items-center justify-between py-0.5">
          <span className={LABEL}>Summary</span>
          <span><Badge bg="success" className="mr-1">+{toAdd.length}</Badge><Badge bg="danger">−{toRemove.length}</Badge></span>
        </div>
        <div className="text-[0.72rem] text-ink-2"><Info size={12} className="mr-1 inline" />A small fee may apply.</div>
      </div>
    </CompactModal>
  );
}
