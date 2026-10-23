// Sections of the user edit modal (legacy UserEditSections/*).
import { memo, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { Clock, Infinity as InfinityIcon, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Badge, Spinner, cn, useDialog } from '@/shared/ui';
import { fmtDate } from '@/shared/lib/format';
import { formatEndDateToDMY } from '@/shared/lib/formUtils';
import CustomDatePicker from './CustomDatePicker';

const LBL = 'mb-0 block text-[0.92rem] font-bold text-[#1f2937] max-sm:text-[0.85rem]';
const INP = 'input !px-2 !py-1 !text-[0.98rem] max-sm:!text-base';
const SEL = 'select !py-1 !pl-2 !text-[0.9rem] max-sm:!text-base';

function PencilBtn({ onClick, active }: { onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} title="Edit"
      className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#0096c7] text-[#0096c7] hover:bg-[rgba(0,150,199,0.12)] max-sm:h-8 max-sm:w-8', active && 'bg-[rgba(0,150,199,0.12)]')}>
      <Pencil size={11} />
    </button>
  );
}

function LockedInput({ label, value, onChange, unlocked, toggle, type = 'text', required, extra }: { label: string; value: string; onChange: (v: string) => void; unlocked: boolean; toggle: () => void; type?: string; required?: boolean; extra?: ReactNode }) {
  return (
    <div>
      <label className={LBL}>{label}</label>
      <div className="flex items-center gap-1.5">
        <input className={cn(INP, 'flex-1')} type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={!unlocked} required={required} autoComplete="off" />
        <PencilBtn onClick={toggle} active={unlocked} />
      </div>
      {extra}
    </div>
  );
}

/* ---------------- Profile ---------------- */
export const ProfileSection = memo(function ProfileSection({ form, handleChange, editableFields, setEditableFields, handlePasswordChange, passwordIsHashed, userType }: any) {
  const tog = (k: string) => () => setEditableFields((p: any) => ({ ...p, [k]: !p[k] }));
  return (
    <div className="grid grid-cols-1 gap-2 p-2 md:grid-cols-2">
      <div>
        <label className={LBL}>User ID</label>
        <input className={INP} value={form.userId || ''} disabled />
      </div>
      <LockedInput label="User Name" value={form.userName} onChange={(v) => handleChange('userName', v)} unlocked={editableFields.userName} toggle={tog('userName')} required />
      <LockedInput label="Email" type="email" value={form.email} onChange={(v) => handleChange('email', v)} unlocked={editableFields.email} toggle={tog('email')} />
      <LockedInput label="Password" type={userType === 'admin' ? 'text' : 'password'} value={form.password} onChange={handlePasswordChange} unlocked={editableFields.password} toggle={tog('password')}
        extra={passwordIsHashed && <div className="text-[0.7rem] text-[#f59e0b]">Hashed</div>} />
      <LockedInput label="Mobile" value={form.mobile} onChange={(v) => handleChange('mobile', v)} unlocked={editableFields.mobile} toggle={tog('mobile')} />
    </div>
  );
});

/* ---------------- Subscription ---------------- */
export const SubscriptionSection = memo(function SubscriptionSection({ form, handleChange, subscriptionOptions }: any) {
  const statusCls = form.status === 'Active' ? '!text-[#10b981] !font-bold' : form.status === 'Pending' ? '!text-[#f59e0b] !font-bold' : '!text-[#ef4444] !font-bold';
  return (
    <div className="dark-gray-borders min-h-[350px] px-2.5 py-1.5 text-[0.92rem]">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <label className={LBL}>Start Date</label>
          <CustomDatePicker size="sm" value={form.startDate} onChange={(d) => handleChange('startDate', d)} />
        </div>
        <div>
          <label className={LBL}>Type</label>
          <select className={SEL} value={form.subscriptionType} onChange={(e) => handleChange('subscriptionType', e.target.value)}>
            <option value="">Select</option>
            {subscriptionOptions.map((opt: any) => (
              <option key={opt.value} value={opt.value}>{opt.value} {opt.days === -1 ? '(Perm)' : `(${opt.days}d)`}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={LBL}>End Date</label>
          <input className={INP} value={formatEndDateToDMY(form.endDate)} disabled />
        </div>
        <div>
          <label className={LBL}>Status</label>
          <input className={cn(INP, statusCls)} value={form.status || ''} disabled />
        </div>
        <div>
          <label className={LBL}>Fee (₨)</label>
          <input className={INP} type="number" min={0} value={form.fee || ''} onChange={(e) => handleChange('fee', e.target.value)} required />
        </div>
      </div>

      {form.renewalHistory && form.renewalHistory.length > 0 && (
        <div className="mt-2 rounded border border-[#dee2e6] bg-[#f8f9fa] p-2">
          <div className="mb-1 text-[0.86rem] font-bold text-ink-2">Recent History</div>
          <table className="w-full border-collapse text-[0.8rem]">
            <thead>
              <tr className="bg-[#212529] text-white">
                <th className="border border-[#373b3e] px-1 py-0.5 text-left">Date</th>
                <th className="border border-[#373b3e] px-1 py-0.5 text-left">Type</th>
                <th className="border border-[#373b3e] px-1 py-0.5 text-left">Fee</th>
              </tr>
            </thead>
            <tbody>
              {[...form.renewalHistory].reverse().slice(0, 3).map((r: any, i: number) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-[#f2f2f2]' : 'bg-white'}>
                  <td className="border border-[#dee2e6] px-1 py-0.5">{fmtDate(r.date)}</td>
                  <td className="border border-[#dee2e6] px-1 py-0.5">{r.type}</td>
                  <td className="border border-[#dee2e6] px-1 py-0.5 font-bold text-[#10b981]">₨{r.paymentAmount || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

/* ---------------- Access ---------------- */
function TempDaysInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Math.min(30, Math.max(1, parseInt(text, 10) || 1));
    setText(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <span className="inline-flex items-center gap-0.5" title="Temporary access: 1-30 days">
      <input type="number" min={1} max={30} step={1} value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        onClick={(e) => e.stopPropagation()}
        className="h-5 w-[38px] rounded-[3px] border border-[#f59e0b] bg-[#fef3c7] px-0.5 text-center text-[0.68rem] font-semibold text-[#d97706]" />
      <span className="text-[0.65rem] font-semibold text-[#d97706]">d</span>
    </span>
  );
}

export const AccessSection = memo(function AccessSection({
  tehsilAssignments, selectedTehsil, selectedMauzas, mauzaOptions, tehsilOptions, tehsilFilter, setTehsilFilter,
  mauzaFilter, setMauzaFilter, mouzaLoading, handleTehsilSelect, handleMauzaToggle, selectAllMauzas, clearAllMauzas,
  handleRemoveAssignment, handleEditAssignment, handleTempGrant, mauzaFilterRef, allowTemp = true,
}: any & { mauzaFilterRef: RefObject<HTMLInputElement> }) {
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const filtered = mauzaOptions.filter((m: string) => m.toLowerCase().includes(mauzaFilter.toLowerCase()));
  const sortedOptions = [...filtered.filter((m: string) => selectedMauzas.includes(m)).sort(cmp), ...filtered.filter((m: string) => !selectedMauzas.includes(m)).sort(cmp)];
  const tempGrants = tehsilAssignments.find((t: any) => t.tehsil === selectedTehsil)?.tempGrants || [];

  return (
    <div className="dark-gray-borders px-2.5 py-1.5 text-[0.92rem]">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[5fr_7fr]">
        <div className="min-w-0">
          <label className={LBL}>Tehsil</label>
          <input className={cn(INP, 'mb-1')} placeholder="Filter..." value={tehsilFilter} onChange={(e) => setTehsilFilter(e.target.value)} />
          <div className="h-[120px] overflow-y-auto rounded border border-[#495057] bg-white p-1 text-[0.8rem]">
            {tehsilOptions
              .filter((t: any) => (typeof t === 'string' ? t : t.name).toLowerCase().includes(tehsilFilter.toLowerCase()))
              .map((item: any) => {
                const tName = typeof item === 'string' ? item : item.name;
                const isGroup = Boolean(item.isGroup);
                return (
                  <label key={tName} htmlFor={`tehsil-opt-${tName}`} className="flex min-h-6 cursor-pointer items-center gap-1.5 max-sm:min-h-8">
                    <input type="radio" className="check" id={`tehsil-opt-${tName}`} name="tehsilSelection" checked={selectedTehsil === tName} onChange={() => handleTehsilSelect(tName)} />
                    <span className="flex w-full items-center justify-between gap-1">
                      <span className={isGroup ? 'font-bold text-[#052c65]' : ''}>{isGroup && <span className="mr-1">🔗</span>}{tName}</span>
                      {isGroup && <Badge bg="info" className="!px-1 !py-px !text-[0.6rem]">Merged Group</Badge>}
                    </span>
                  </label>
                );
              })}
          </div>

          <div className="mt-2">
            <span className="text-[0.86rem] font-bold text-ink-2">Assigned ({tehsilAssignments.length})</span>
            <div className="mt-1 max-h-[100px] overflow-y-auto rounded border border-[#dee2e6] bg-white">
              {[...tehsilAssignments].sort((a: any, b: any) => a.tehsil.localeCompare(b.tehsil)).map((entry: any) => {
                const active = (entry.tempGrants || []).filter((g: any) => new Date(g.expiresAt).getTime() > Date.now());
                const isTemp = active.length > 0;
                let label: ReactNode = null;
                if (isTemp) {
                  const diff = Math.min(...active.map((g: any) => new Date(g.expiresAt).getTime())) - Date.now();
                  const hours = Math.floor(diff / 3600000);
                  const days = Math.floor(hours / 24);
                  label = diff <= 0
                    ? <span className="text-[0.65rem] text-[#dc3545]">(expired)</span>
                    : <span className="cursor-pointer text-[0.75rem] text-[#f59e0b]" title={`${days > 0 ? `${days}d ` : ''}${hours % 24}h left`}>⏱</span>;
                }
                return (
                  <div key={entry.tehsil} className="flex items-center justify-between border-b border-[#dee2e6] px-2 py-1 text-[0.92rem] last:border-b-0"
                    style={{ borderLeft: isTemp ? '3px solid #f59e0b' : undefined, background: isTemp ? '#fffbeb' : undefined }}>
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="truncate" style={{ fontWeight: isTemp ? 600 : 400 }}>{entry.tehsil}</span>
                      {label}
                    </div>
                    <div className="tehsil-action-buttons flex shrink-0 gap-1">
                      <button type="button" className="action-btn primary !scale-[0.828] max-sm:!scale-100" title="Edit" onClick={() => handleEditAssignment(entry.tehsil)}><Pencil /></button>
                      <button type="button" className="action-btn danger !scale-[0.828] max-sm:!scale-100" title="Remove" onClick={() => handleRemoveAssignment(entry.tehsil)}><Trash2 /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between">
            <label className={LBL}>Mouzas</label>
            <div className="mouza-action-buttons mb-0.5 flex gap-1">
              <button type="button" className="btn btn-outline-success h-[26px] min-w-[55px] rounded !px-2.5 !py-0.5 !text-[0.78rem] max-sm:h-8" onClick={selectAllMauzas} disabled={!selectedTehsil}>All</button>
              <button type="button" className="btn btn-outline-secondary h-[26px] min-w-[65px] rounded !px-2.5 !py-0.5 !text-[0.78rem] max-sm:h-8" onClick={clearAllMauzas} disabled={!selectedTehsil}>None</button>
            </div>
          </div>
          <input ref={mauzaFilterRef} className={cn(INP, 'mb-1')} placeholder="Filter..." value={mauzaFilter} onChange={(e) => setMauzaFilter(e.target.value)} disabled={!selectedTehsil} />
          <div className="h-[260px] overflow-y-auto rounded border border-[#495057] bg-white p-1">
            {!selectedTehsil ? (
              <div className="mt-4 text-center text-[0.86rem] text-ink-2">Select tehsil</div>
            ) : mouzaLoading ? (
              <div className="mt-4 text-center"><Spinner size="sm" /></div>
            ) : (
              <div className="grid grid-cols-1 gap-0.5">
                {sortedOptions.map((mauza: string) => {
                  const tempGrant = tempGrants.find((g: any) => g.mouza === mauza);
                  const isTemp = !!tempGrant;
                  const isChecked = selectedMauzas.includes(mauza);
                  return (
                    <div key={mauza} className="flex items-center justify-between gap-1.5 rounded-[3px] px-2 py-1 text-[0.78rem] max-sm:min-h-9 max-sm:text-[0.85rem]"
                      style={{ background: isChecked ? (isTemp ? '#fffbeb' : '#e7f3ff') : 'transparent', borderLeft: isTemp ? '2px solid #f59e0b' : 'none' }}>
                      <div className="flex flex-1 cursor-pointer items-center gap-1.5" onClick={() => handleMauzaToggle(mauza)}>
                        <input type="checkbox" className="check pointer-events-none" checked={isChecked} readOnly />
                        <span style={{ fontWeight: isTemp ? 600 : 400 }}>{mauza}</span>
                      </div>
                      {allowTemp && isChecked && (
                        <button type="button" onClick={() => handleTempGrant(mauza, isTemp ? null : 3)}
                          className="inline-flex h-[22px] w-[22px] items-center justify-center p-0.5"
                          style={{ color: isTemp ? '#d97706' : '#9ca3af' }}
                          title={isTemp ? 'Temporary Access (Click to make Permanent)' : 'Permanent Access (Click to make Temporary)'}>
                          {isTemp ? <Clock size={14} /> : <InfinityIcon size={14} />}
                        </button>
                      )}
                      {allowTemp && isTemp && (
                        <TempDaysInput
                          value={tempGrant?.expiresAt ? Math.max(1, Math.round((new Date(tempGrant.expiresAt).getTime() - Date.now()) / 86400000)) : 3}
                          onCommit={(d) => handleTempGrant(mauza, d)} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ---------------- Multi-use ---------------- */
const fmtDM = (d: any) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');

export const MultiUseSection = memo(function MultiUseSection({ form, ipPeriod, setIpPeriod, userId }: any) {
  const dialog = useDialog();
  const usage = form.ipMisuse || {};
  const [forgotten, setForgotten] = useState<string[]>([]);
  const since = (days: any) => Date.now() - Number(days) * 86400e3;
  const all = (usage.devices30 || []).filter((d: any) => !forgotten.includes(d.id));
  const devices = all.filter((d: any) => new Date(d.lastSeen).getTime() >= since(ipPeriod || 30));
  const count = all.length;
  const sameTime = all.filter((d: any) => d.sameTime).length;

  const forget = async (d: any) => {
    if (!(await dialog.confirm(`Forget "${d.label}"? It will no longer count towards this account's devices.`, { variant: 'danger', okLabel: 'Forget' }))) return;
    try {
      await api.post(`/api/users/${encodeURIComponent(userId || form.userId)}/devices/${d.id}/forget`, {});
      setForgotten((f) => [...f, d.id]);
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message || 'Could not forget the device.');
    }
  };

  const th = 'sticky top-0 z-[3] bg-[#203a43] px-1.5 py-1 text-center font-semibold uppercase tracking-[0.05em] text-[#00ffff] whitespace-nowrap border-b-2 border-[rgba(0,255,255,0.4)]';
  const td = 'px-1.5 py-1 border-b border-[rgba(0,212,255,0.1)] whitespace-nowrap';
  return (
    <div className="dark-gray-borders px-2.5 py-1.5">
      <div className="mb-2 rounded border border-[#dee2e6] bg-[#f8f9fa] p-2 text-[0.8rem]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
          <span className="font-bold text-ink-2">Devices used (current activation, 30 days)</span>
          <span>
            <Badge bg={count > 3 ? 'danger' : count >= 3 ? 'warning' : 'success'}>{count} device(s)</Badge>
            {sameTime > 0 && <Badge bg="danger" className="ml-1">Used at the same time</Badge>}
          </span>
        </div>
        <div className="mb-2 text-[0.75rem] text-ink-2">Monitoring since: {usage.activationStart ? fmtDate(usage.activationStart) : 'N/A'}</div>

        <div className="max-h-[45vh] overflow-auto rounded-md">
          <table className="m-0 w-full border-separate border-spacing-0 bg-white text-[0.75rem] text-teal-ink">
            <thead>
              <tr>
                <th className={cn(th, 'w-[30px]')}>#</th>
                <th className={th}>Device</th>
                <th className={th}>IP addresses (sessions)</th>
                <th className={th}>First seen</th>
                <th className={th}>Last seen</th>
                <th className={th}>Logins</th>
                <th className={th}>Sessions</th>
                <th className={cn(th, 'w-[110px]')}>
                  <select value={ipPeriod} onChange={(e) => setIpPeriod(e.target.value)}
                    className="h-5 w-[85px] rounded border border-[#ccc] bg-white px-0.5 py-px text-[0.7rem] font-bold normal-case text-[#007bff]">
                    <option value="7">7 Days</option>
                    <option value="14">14 Days</option>
                    <option value="30">30 Days</option>
                  </select>
                </th>
              </tr>
            </thead>
            <tbody>
              {devices.length > 0 ? devices.map((d: any, idx: number) => (
                <tr key={d.id} className="hover:bg-[rgba(0,212,255,0.05)]">
                  <td className={td}>{idx + 1}</td>
                  <td className={cn(td, 'font-semibold')}>{d.label || 'Device'}{d.sameTime && <Badge bg="danger" className="ml-1 !text-[0.6rem]">same time</Badge>}</td>
                  <td className={td} title="Networks / IP addresses (information only)">
                    {d.ips && d.ips.length
                      ? d.ips.length === 1
                        ? <><code className="text-[0.7rem] text-[#d63384]">{d.ips[0].ip}</code> <span className="text-ink-2">({d.ips[0].sessions})</span></>
                        : (
                          /* Collapsed by default so every row keeps the same height; click to see all addresses. */
                          <details className="group">
                            <summary className="cursor-pointer list-none whitespace-nowrap">
                              <code className="text-[0.7rem] text-[#d63384]">{d.ips[0].ip}</code> <span className="text-ink-2">({d.ips[0].sessions})</span>{' '}
                              <span className="rounded bg-[#e9ecef] px-1 text-[0.65rem] font-semibold text-[#41464b] group-open:hidden">+{d.ips.length - 1} more</span>
                            </summary>
                            {d.ips.slice(1).map((x: any) => <div key={x.ip}><code className="text-[0.7rem] text-[#d63384]">{x.ip}</code> <span className="text-ink-2">({x.sessions})</span></div>)}
                          </details>
                        )
                      : <span className="text-ink-2">{d.networks || 0} network(s)</span>}
                  </td>
                  <td className={td}>{fmtDM(d.firstSeen)}</td>
                  <td className={td}>{fmtDM(d.lastSeen)}</td>
                  <td className={cn(td, 'text-center')}>{d.logins || 0}</td>
                  <td className={cn(td, 'text-center')}>{d.sessions ?? '—'}</td>
                  <td className={cn(td, 'text-center')}>
                    <button type="button" className="btn btn-outline-danger !px-1.5 !py-0 !text-[0.68rem] max-sm:min-h-8" onClick={() => forget(d)}>Forget</button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="py-3 text-center text-ink-2">No devices recorded for the selected period.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 rounded border border-[#dee2e6] bg-white p-2 text-[0.7rem] text-[#666]">
          <strong>Note:</strong> Counted by device (phone / computer), not by IP address, so network changes, flight mode or a new SIM don&apos;t add devices. More than 3 devices in 30 days, or two devices used at the same time, usually means the account is shared. Use <em>Forget</em> when the customer replaces their phone.
        </div>
      </div>
    </div>
  );
});
