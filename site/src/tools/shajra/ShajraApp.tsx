// Shajra Nasab: build the family of a deceased person and get the inheritance shares.
// Runs fully in the browser; the case is autosaved in this browser only (localStorage).
import { useEffect, useMemo, useRef, useState } from 'react';
import { compute, toString, type Case, type ComputeResult, type LawSystem, type Person, type ShareResult } from 'inheritance-engine';
import Tree, { Legend } from './Tree.tsx';
import { addRelative, fromJSON, load, newCase, removePerson, save, setParentOf, toJSON, updatePerson, type AddKind } from './model.ts';
import { DISCLAIMER, DISCLAIMER_UR, relLabel, ruleText } from './labels.ts';

const LAWS: { value: LawSystem; label: string; ready: boolean }[] = [
  { value: 'sunni-hanafi', label: 'Muslim: Sunni (Hanafi)', ready: true },
  { value: 'sunni-shafii', label: "Muslim: Sunni (Shafi'i)", ready: true },
  { value: 'sunni-maliki', label: 'Muslim: Sunni (Maliki)', ready: true },
  { value: 'sunni-hanbali', label: 'Muslim: Sunni (Hanbali)', ready: true },
  { value: 'shia-ithna', label: 'Muslim: Shia (Ithna Ashari): coming soon', ready: false },
  { value: 'christian', label: 'Christian (Succession Act 1925): coming soon', ready: false },
  { value: 'parsi', label: 'Parsi: coming soon', ready: false },
  { value: 'hindu-mitakshara-benares', label: 'Hindu / Sikh (Mitakshara): coming soon', ready: false },
];

const ADD: { kind: AddKind; label: string }[] = [
  { kind: 'father', label: '+ Father' }, { kind: 'mother', label: '+ Mother' }, { kind: 'spouse', label: '+ Spouse' },
  { kind: 'son', label: '+ Son' }, { kind: 'daughter', label: '+ Daughter' }, { kind: 'brother', label: '+ Brother' }, { kind: 'sister', label: '+ Sister' },
];

const input = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none';
const btn = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50';

export default function ShajraApp() {
  const [c, setC] = useState<Case>(() => newCase());
  const [selected, setSelected] = useState<string | null>('D');
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const s = load(); if (s) setC(s); setLoaded(true); }, []);
  useEffect(() => { if (loaded) save(c); }, [c, loaded]);

  const { result, error } = useMemo((): { result: ComputeResult | null; error: string | null } => {
    try { return { result: compute(c), error: null }; } catch (e) { return { result: null, error: (e as Error).message }; }
  }, [c]);
  const byId = useMemo(() => new Map((result?.shares ?? []).map((s) => [s.personId, s] as [string, ShareResult])), [result]);
  const deceased = c.persons.find((p) => p.id === c.deceasedId)!;
  const sel = c.persons.find((p) => p.id === selected) ?? null;

  const add = (kind: AddKind) => { if (!sel) return; const [n, id] = addRelative(c, sel.id, kind); setC(n); setSelected(id); };
  const patch = (id: string, p: Partial<Person>) => setC(updatePerson(c, id, p));

  const exportJson = () => {
    const blob = new Blob([toJSON(c)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shajra-${c.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (f: File) => { try { setC(fromJSON(await f.text())); setSelected('D'); } catch { alert('This file is not a Shajra Nasab case.'); } };

  const heirs = (result?.shares ?? []).filter((s) => s.status !== 'excluded' || s.reasons.some((r) => r.ruleId.startsWith('mflo')));
  const excluded = (result?.shares ?? []).filter((s) => s.status === 'excluded' && s.relationKey !== 'unrelated' && !s.reasons.some((r) => r.ruleId.startsWith('mflo')));
  const name = (id: string) => c.persons.find((p) => p.id === id)?.name || (id === '__unborn__' ? 'Unborn child' : id);

  return (
    <div className="shajra rounded-2xl bg-white text-slate-900 shadow-2xl">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <button className={btn} onClick={() => { if (confirm('Start a new case? The current one will be cleared.')) { setC(newCase()); setSelected('D'); } }}>New case</button>
        <button className={btn} onClick={exportJson}>Export JSON</button>
        <button className={btn} onClick={() => fileRef.current?.click()}>Import JSON</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        <button className={`${btn} !border-sky-600 !bg-sky-600 !text-white`} onClick={() => window.print()}>Print / Save PDF</button>
        <span className="ml-auto text-[11px] text-slate-500">Case {c.id} · saved in this browser only</span>
      </div>

      {/* Step 1: deceased and law */}
      <section className="no-print grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-semibold text-slate-600">Law (religion of the deceased)
          <select className={input} value={c.lawSystem} onChange={(e) => setC({ ...structuredClone(c), lawSystem: e.target.value as LawSystem })}>
            {LAWS.map((l) => <option key={l.value} value={l.value} disabled={!l.ready}>{l.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">Deceased name
          <input className={input} value={deceased.name} placeholder="e.g. Muhammad Aslam" onChange={(e) => patch('D', { name: e.target.value })} />
        </label>
        <label className="text-xs font-semibold text-slate-600">Father's name (walad)
          <input className={input} value={deceased.fatherName ?? ''} onChange={(e) => patch('D', { fatherName: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-slate-600">Gender
            <select className={input} value={deceased.gender} onChange={(e) => {
              // Changing the deceased's gender flips existing spouses.
              let n = updatePerson(c, 'D', { gender: e.target.value as 'M' | 'F' });
              for (const u of n.unions.filter((u) => u.partners.includes('D'))) n = updatePerson(n, u.partners.find((x) => x !== 'D')!, { gender: e.target.value === 'M' ? 'F' : 'M' });
              setC(n);
            }}>
              <option value="M">Male</option><option value="F">Female</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Date of death
            <input type="date" className={input} value={c.dateOfDeath} onChange={(e) => patch('D', { dateOfDeath: e.target.value })} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
          <input type="checkbox" checked={c.policy.applyMFLOs4} onChange={(e) => setC({ ...structuredClone(c), policy: { ...c.policy, applyMFLOs4: e.target.checked } })} />
          Apply MFLO 1961 s.4 (children of a predeceased son / daughter)
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
          <input type="checkbox" checked={c.policy.raddToSpouseWhenNoOtherHeir} onChange={(e) => setC({ ...structuredClone(c), policy: { ...c.policy, raddToSpouseWhenNoOtherHeir: e.target.checked } })} />
          Sole spouse takes the surplus (Pakistani practice)
        </label>
      </section>

      {/* Step 2: family tree + editor */}
      <div id="shajra-print" className="grid gap-0 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 border-slate-200 p-3 lg:border-r">
          <div className="print-only mb-2 hidden">
            <h2 className="text-lg font-bold">Shajra Nasab: {deceased.name || 'Deceased'}{deceased.fatherName ? ` s/o ${deceased.fatherName}` : ''}</h2>
            <p className="text-xs">Date of death {c.dateOfDeath} · Law: {LAWS.find((l) => l.value === c.lawSystem)?.label} · Case {c.id} · Policy {c.policy.policyVersion}</p>
          </div>
          <p className="no-print mb-2 text-xs text-slate-500">Click a person to edit them or add relatives. Start with the deceased (double border).</p>
          <div className="overflow-auto rounded-xl border border-slate-200 bg-slate-50" style={{ maxHeight: '70vh' }}>
            <Tree c={c} results={byId} selected={selected} onSelect={setSelected} />
          </div>
          <div className="mt-2"><Legend /></div>
        </div>

        {/* Person editor */}
        <aside className="no-print border-t border-slate-200 p-4 lg:border-t-0">
          {sel ? <Editor c={c} p={sel} share={byId.get(sel.id)} onPatch={(p) => patch(sel.id, p)} onAdd={add}
            onParent={(role, id) => setC(setParentOf(c, sel.id, role, id))}
            onRemove={() => { setC(removePerson(c, sel.id)); setSelected('D'); }} /> : <p className="text-sm text-slate-500">Select a person.</p>}
        </aside>
      </div>

      {/* Step 3: results */}
      <section className="border-t border-slate-200 p-4" id="shajra-results">
        <h2 className="text-lg font-bold">Shares (حصص)</h2>
        {error && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
        {result && (
          <>
            {result.needsVerification && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Complex case (distant kindred or grandfather with siblings): verify with a lawyer.</p>}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-800 text-left text-white">
                    <th className="p-2">Name</th><th className="p-2">Relation</th><th className="p-2">CNIC</th>
                    <th className="p-2 text-right">Share</th><th className="p-2 text-right">Sihaam / {String(result.base)}</th><th className="p-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {heirs.map((s) => {
                    const [en, ur] = relLabel(s.relationKey);
                    const p = c.persons.find((x) => x.id === s.personId);
                    return (
                      <tr key={s.personId} className="border-b border-slate-200">
                        <td className="p-2 font-semibold">{name(s.personId)}{s.status === 'reserved' && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">reserved</span>}{s.status === 'substituted-s4' && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-800">s.4</span>}</td>
                        <td className="p-2">{en} <span className="urdu text-slate-500" lang="ur">{ur}</span></td>
                        <td className="p-2 text-slate-500">{p?.cnic ?? ''}</td>
                        <td className="p-2 text-right font-mono">{toString(s.fraction)}</td>
                        <td className="p-2 text-right font-mono">{String(s.sihaam)}</td>
                        <td className="p-2 text-right font-mono">{s.percent}</td>
                      </tr>
                    );
                  })}
                  {result.reserved.n > 0n && <tr className="border-b border-slate-200 bg-amber-50"><td className="p-2" colSpan={3}>Reserved (pregnancy / missing heir)</td><td className="p-2 text-right font-mono">{toString(result.reserved)}</td><td /><td /></tr>}
                  {result.escheat.n > 0n && <tr className="border-b border-slate-200"><td className="p-2" colSpan={3}>Government (no heir)</td><td className="p-2 text-right font-mono">{toString(result.escheat)}</td><td /><td /></tr>}
                  <tr className="bg-slate-100 font-bold"><td className="p-2" colSpan={3}>Total</td><td className="p-2 text-right font-mono">1</td><td className="p-2 text-right font-mono">{String(result.base)}</td><td className="p-2 text-right font-mono">100.0000</td></tr>
                </tbody>
              </table>
            </div>

            {excluded.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-bold">Not inheriting</h3>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                  {excluded.map((s) => <li key={s.personId}><b>{name(s.personId)}</b> ({relLabel(s.relationKey)[0]}): {ruleText(s.reasons[0]?.ruleId ?? '')}{s.reasons[0]?.params?.by ? ` (by ${s.reasons[0].params.by})` : ''}</li>)}
                </ul>
              </div>
            )}

            <div className="mt-4">
              <h3 className="text-sm font-bold">Computation notes</h3>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-slate-700">
                {heirs.filter((s) => s.reasons.length).map((s) => (
                  <li key={`n-${s.personId}`}><b>{name(s.personId)}:</b> {s.reasons.map((r) => ruleText(r.ruleId)).join(' ')} <span className="text-[11px] text-slate-400">[{s.reasons.map((r) => r.citationKey).join(', ')}]</span></li>
                ))}
                {result.notes.map((n, i) => <li key={`c-${i}`}>{ruleText(n.ruleId)}{n.params?.from && n.ruleId === 'sunni.aul' ? ` (${n.params.from} → ${n.params.to})` : ''} <span className="text-[11px] text-slate-400">[{n.citationKey}]</span></li>)}
              </ol>
              <p className="mt-2 text-[11px] text-slate-500">Law: {result.lawSystem} · policy {result.policyVersion} · MFLO s.4 {c.policy.applyMFLOs4 ? 'on' : 'off'} · radd to sole spouse {c.policy.raddToSpouseWhenNoOtherHeir ? 'on' : 'off'} · case {c.id}. Legal references are under review.</p>
            </div>
          </>
        )}
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-2 text-sm font-semibold text-red-800">{DISCLAIMER} <span className="urdu font-normal" lang="ur" dir="rtl">{DISCLAIMER_UR}</span></p>
      </section>
    </div>
  );
}

function Editor({ c, p, share, onPatch, onAdd, onParent, onRemove }: {
  c: Case; p: Person; share?: ShareResult; onPatch: (p: Partial<Person>) => void; onAdd: (k: AddKind) => void;
  onParent: (role: 'fatherId' | 'motherId', id: string | undefined) => void; onRemove: () => void;
}) {
  const isD = p.id === c.deceasedId;
  const link = c.parents.find((l) => l.childId === p.id);
  const others = c.persons.filter((x) => x.id !== p.id);
  const flags = p.flags;
  const flag = (k: keyof Person['flags'], v: unknown) => onPatch({ flags: { ...flags, [k]: v || undefined } });
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{isD ? 'Deceased' : relLabel(share?.relationKey ?? '')[0]}</div>
        <input className={`${input} mt-1 font-semibold`} value={p.name} placeholder="Name" onChange={(e) => onPatch({ name: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ADD.filter((a) => !(isD && false)).map((a) => <button key={a.kind} className={btn} onClick={() => onAdd(a.kind)}>{a.label}</button>)}
      </div>
      {!isD && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-600">Gender
              <select className={input} value={p.gender} onChange={(e) => onPatch({ gender: e.target.value as 'M' | 'F' })}><option value="M">Male</option><option value="F">Female</option></select>
            </label>
            <label className="text-xs text-slate-600">Alive?
              <select className={input} value={p.alive ? 'yes' : 'no'} onChange={(e) => onPatch({ alive: e.target.value === 'yes' })}><option value="yes">Alive</option><option value="no">Died</option></select>
            </label>
          </div>
          {!p.alive && (
            <label className="block text-xs text-slate-600">Date of death (before or after the deceased matters)
              <input type="date" className={input} value={p.dateOfDeath ?? ''} onChange={(e) => onPatch({ dateOfDeath: e.target.value })} />
            </label>
          )}
          <label className="block text-xs text-slate-600">Religion
            <select className={input} value={p.religion} onChange={(e) => onPatch({ religion: e.target.value })}>
              {['muslim', 'christian', 'hindu', 'sikh', 'parsi', 'other'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-600">CNIC (optional)
            <input className={input} value={p.cnic ?? ''} placeholder="12345-1234567-1" onChange={(e) => onPatch({ cnic: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-600">Father
              <select className={input} value={link?.fatherId ?? ''} onChange={(e) => onParent('fatherId', e.target.value || undefined)}>
                <option value="">—</option>{others.filter((x) => x.gender === 'M').map((x) => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">Mother
              <select className={input} value={link?.motherId ?? ''} onChange={(e) => onParent('motherId', e.target.value || undefined)}>
                <option value="">—</option>{others.filter((x) => x.gender === 'F').map((x) => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="space-y-1 rounded-lg border border-slate-200 p-2 text-xs text-slate-700">
            <legend className="px-1 font-semibold">Special facts</legend>
            {p.gender === 'F' && c.unions.some((u) => u.partners.includes(p.id) && u.partners.includes(c.deceasedId)) && (
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!flags.pregnant} onChange={(e) => flag('pregnant', e.target.checked)} /> Pregnant at the date of death</label>
            )}
            {c.unions.some((u) => u.partners.includes(p.id) && u.partners.includes(c.deceasedId)) && (
              <label className="block">Divorce
                <select className={input} value={flags.divorced ?? ''} onChange={(e) => flag('divorced', e.target.value)}>
                  <option value="">Not divorced</option><option value="revocable-in-iddat">Revocable talaq, still in iddat</option><option value="irrevocable">Irrevocable talaq</option><option value="khula">Khula</option>
                </select>
              </label>
            )}
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!flags.missing} onChange={(e) => flag('missing', e.target.checked)} /> Missing (mafqud)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!flags.adopted} onChange={(e) => flag('adopted', e.target.checked)} /> Adopted</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!flags.illegitimate} onChange={(e) => flag('illegitimate', e.target.checked)} /> Born outside marriage</label>
            <label className="block">Caused the death
              <select className={input} value={flags.killedDeceased ?? ''} onChange={(e) => flag('killedDeceased', e.target.value)}>
                <option value="">No</option><option value="intentional">Yes, intentionally</option><option value="negligent">Yes, by negligence</option>
              </select>
            </label>
          </fieldset>
          {share && (
            <div className="rounded-lg bg-slate-50 p-2 text-xs">
              <b>{toString(share.fraction)}</b> ({share.percent}%) · {share.reasons.map((r) => ruleText(r.ruleId)).join(' ')}
            </div>
          )}
          <button className={`${btn} !border-red-300 !text-red-700`} onClick={() => { if (confirm(`Remove ${p.name || 'this person'}?`)) onRemove(); }}>Remove person</button>
        </>
      )}
    </div>
  );
}
