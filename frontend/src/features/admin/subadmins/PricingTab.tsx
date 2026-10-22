import { useCallback, useEffect, useState } from 'react';
import { Alert, Spinner, useDialog } from '@/shared/ui';
import { api, errText, rs, fmtDateTime } from '@/features/subadmin/subAdminApi';

export default function PricingTab() {
  const [data, setData] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const { confirm } = useDialog();
  const load = useCallback(async () => {
    const [p, v] = await Promise.all([api.get('/api/admin/pricing'), api.get('/api/admin/pricing/versions')]);
    setData(p);
    setVersions(v.versions);
    const t = p.table;
    setDraft({
      tiers: t.tiers.map((x: any) => ({ ...x, yearlyPinned: x.yearlyPinned ?? '' })),
      yearlyDiscountPct: t.yearlyDiscountPct, roundTo: t.roundTo, roundMode: t.roundMode, maxMouzas: t.maxMouzas,
      trialMaxMouzas: t.trialMaxMouzas, minUpgradeCharge: t.minUpgradeCharge, note: '',
    });
  }, []);
  useEffect(() => {
    load().catch((e) => setProblems([errText(e)]));
  }, [load]);
  if (!draft) return problems.length ? <Alert variant="danger">{problems[0]}</Alert> : <Spinner />;
  const round = (v: number) => {
    const s = Number(draft.roundTo) || 1;
    const f = draft.roundMode === 'up' ? Math.ceil : draft.roundMode === 'down' ? Math.floor : Math.round;
    return f(v / s) * s;
  };
  const setTier = (i: number, k: string, v: any) => setDraft((d: any) => ({ ...d, tiers: d.tiers.map((t: any, j: number) => (j === i ? { ...t, [k]: v } : t)) }));
  const save = async () => {
    setMsg(null);
    setProblems([]);
    try {
      const r = await api.put('/api/admin/pricing', {
        ...draft,
        tiers: draft.tiers.map((t: any) => ({ ...t, minMouzas: Number(t.minMouzas), maxMouzas: Number(t.maxMouzas), monthly: Number(t.monthly), yearlyPinned: t.yearlyPinned === '' ? null : Number(t.yearlyPinned) })),
        yearlyDiscountPct: Number(draft.yearlyDiscountPct), roundTo: Number(draft.roundTo), maxMouzas: Number(draft.maxMouzas),
        trialMaxMouzas: Number(draft.trialMaxMouzas), minUpgradeCharge: Number(draft.minUpgradeCharge),
      });
      setMsg(r.message);
      load();
    } catch (e: any) {
      setProblems(e?.response?.data?.problems || [errText(e)]);
    }
  };
  const inp = 'input input-sm min-w-[70px]';
  return (
    <div className="mt-2">
      <p className="mb-2 text-sm text-ink-2">
        What sub-admins are billed. Changes apply to new activations, renewals and upgrades only; past bills never change. Version {data.table.version}.
      </p>
      {msg && <Alert variant="success" className="mb-2">{msg}</Alert>}
      {problems.length > 0 && (
        <Alert variant="danger" className="mb-2">
          <ul className="mb-0 list-disc pl-4">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </Alert>
      )}
      <div className="table-wrap max-w-[820px]">
        <table className="table">
          <thead>
            <tr><th>Tier</th><th>From mouzas</th><th>To mouzas</th><th>Monthly (Rs)</th><th>Yearly pinned (optional)</th><th>Yearly</th><th /></tr>
          </thead>
          <tbody>
            {draft.tiers.map((t: any, i: number) => (
              <tr key={i}>
                <td><input className={inp} value={t.key} onChange={(e) => setTier(i, 'key', e.target.value)} /></td>
                <td><input className={inp} type="number" value={t.minMouzas} onChange={(e) => setTier(i, 'minMouzas', e.target.value)} /></td>
                <td><input className={inp} type="number" value={t.maxMouzas} onChange={(e) => setTier(i, 'maxMouzas', e.target.value)} /></td>
                <td><input className={inp} type="number" value={t.monthly} onChange={(e) => setTier(i, 'monthly', e.target.value)} /></td>
                <td><input className={inp} type="number" value={t.yearlyPinned} onChange={(e) => setTier(i, 'yearlyPinned', e.target.value)} /></td>
                <td className="whitespace-nowrap text-sm">{rs(t.yearlyPinned !== '' ? t.yearlyPinned : round(Number(t.monthly) * 12 * (1 - Number(draft.yearlyDiscountPct) / 100)))}</td>
                <td>
                  <button className="btn btn-sm btn-link !p-0 !text-[#dc3545]" onClick={() => setDraft((d: any) => ({ ...d, tiers: d.tiers.filter((_: any, j: number) => j !== i) }))}>remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="btn btn-sm btn-outline-secondary mt-2"
        onClick={() => setDraft((d: any) => ({ ...d, tiers: [...d.tiers, { key: `T${d.tiers.length + 1}`, minMouzas: '', maxMouzas: '', monthly: '', yearlyPinned: '' }] }))}
      >
        + Add tier
      </button>
      <div className="mt-2 grid max-w-[820px] grid-cols-2 gap-2 sm:grid-cols-6">
        {[['yearlyDiscountPct', 'Yearly discount %'], ['roundTo', 'Round to (Rs)'], ['maxMouzas', 'Mouza limit'], ['trialMaxMouzas', 'Trial mouza limit'], ['minUpgradeCharge', 'Minimum upgrade charge']].map(([k, l]) => (
          <div key={k}>
            <label className="block text-sm">{l}</label>
            <input className="input input-sm" type="number" value={draft[k]} onChange={(e) => setDraft((d: any) => ({ ...d, [k]: e.target.value }))} />
          </div>
        ))}
        <div>
          <label className="block text-sm">Rounding</label>
          <select className="select select-sm" value={draft.roundMode} onChange={(e) => setDraft((d: any) => ({ ...d, roundMode: e.target.value }))}>
            <option value="nearest">Nearest</option><option value="up">Up</option><option value="down">Down</option>
          </select>
        </div>
        <div className="col-span-2 sm:col-span-6">
          <label className="block text-sm">Note for this version</label>
          <input className="input input-sm" value={draft.note} onChange={(e) => setDraft((d: any) => ({ ...d, note: e.target.value }))} />
        </div>
      </div>
      <button className="btn btn-primary mt-2" onClick={save}>Save as new version</button>
      <h6 className="mt-4 mb-1 font-semibold">History</h6>
      <div className="table-wrap max-w-[820px]">
        <table className="table">
          <tbody>
            {versions.map((v) => (
              <tr key={v.version}>
                <td>v{v.version}</td>
                <td className="whitespace-nowrap">{fmtDateTime(v.createdAt)}</td>
                <td>{v.createdBy}</td>
                <td className="text-sm">{v.tiers.map((t: any) => `${t.minMouzas}${t.maxMouzas !== t.minMouzas ? '–' + t.maxMouzas : ''}: ${t.monthly}`).join(' · ')}</td>
                <td className="text-sm">{v.note}</td>
                <td>
                  {v.version !== data.table.version && (
                    <button
                      className="btn btn-sm btn-link !p-0"
                      onClick={async () => {
                        if (await confirm(`Restore version ${v.version}? It becomes the current price table.`, { title: 'Restore prices', okLabel: 'Restore' })) {
                          try {
                            setMsg((await api.post(`/api/admin/pricing/versions/${v.version}/restore`, {})).message);
                            load();
                          } catch (e) {
                            setProblems([errText(e)]);
                          }
                        }
                      }}
                    >
                      restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
