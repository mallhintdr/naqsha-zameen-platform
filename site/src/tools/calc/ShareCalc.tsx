// Quick inheritance share calculator: no family tree, just how many of each relative survived the
// deceased (e.g. 2 sons, 1 wife, mother, father). Same engine as the Shajra Nasab tool.
import { useMemo, useState } from 'react';
import { CaseBuilder, compute, sum, toString, percent, type LawSystem, type ShareResult, type Fraction } from 'inheritance-engine';
import { ruleText } from '../shajra/labels.ts';
import { kmfText } from '../shajra/Estate.tsx';

type Key =
  | 'spouse' | 'sons' | 'daughters' | 'father' | 'mother'
  | 'pgf' | 'pgm' | 'mgm' | 'gsons' | 'gdaughters'
  | 'fullB' | 'fullS' | 'consB' | 'consS' | 'uteB' | 'uteS' | 'uncles';

/** Rows of the form: key, label, Urdu, most allowed. Spouse depends on the deceased's gender. */
const ROWS: { key: Key; en: string; ur: string; max: number; group: string }[] = [
  { key: 'spouse', en: 'Wife', ur: 'بیوی', max: 4, group: 'Spouse and children' },
  { key: 'sons', en: 'Sons', ur: 'بیٹے', max: 20, group: 'Spouse and children' },
  { key: 'daughters', en: 'Daughters', ur: 'بیٹیاں', max: 20, group: 'Spouse and children' },
  { key: 'father', en: 'Father', ur: 'والد', max: 1, group: 'Parents and grandparents' },
  { key: 'mother', en: 'Mother', ur: 'والدہ', max: 1, group: 'Parents and grandparents' },
  { key: 'pgf', en: 'Paternal grandfather', ur: 'دادا', max: 1, group: 'Parents and grandparents' },
  { key: 'pgm', en: 'Paternal grandmother', ur: 'دادی', max: 1, group: 'Parents and grandparents' },
  { key: 'mgm', en: 'Maternal grandmother', ur: 'نانی', max: 1, group: 'Parents and grandparents' },
  { key: 'gsons', en: "Son's sons (their father died before)", ur: 'پوتے', max: 20, group: 'Grandchildren' },
  { key: 'gdaughters', en: "Son's daughters (their father died before)", ur: 'پوتیاں', max: 20, group: 'Grandchildren' },
  { key: 'fullB', en: 'Full brothers', ur: 'حقیقی بھائی', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'fullS', en: 'Full sisters', ur: 'حقیقی بہنیں', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'consB', en: 'Brothers by father only', ur: 'علاتی بھائی', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'consS', en: 'Sisters by father only', ur: 'علاتی بہنیں', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'uteB', en: 'Brothers by mother only', ur: 'اخیافی بھائی', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'uteS', en: 'Sisters by mother only', ur: 'اخیافی بہنیں', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'uncles', en: 'Paternal uncles (father’s full brothers)', ur: 'چچا', max: 20, group: 'Brothers, sisters and uncles' },
];

const LAWS: { value: LawSystem; label: string }[] = [
  { value: 'sunni-hanafi', label: 'Muslim: Sunni (Hanafi)' },
  { value: 'sunni-shafii', label: "Muslim: Sunni (Shafi'i)" },
  { value: 'sunni-maliki', label: 'Muslim: Sunni (Maliki)' },
  { value: 'sunni-hanbali', label: 'Muslim: Sunni (Hanbali)' },
  { value: 'shia-ithna', label: 'Muslim: Shia (Ithna Ashari)' },
  { value: 'christian', label: 'Christian (Succession Act 1925)' },
  { value: 'other', label: 'Other (Succession Act 1925)' },
];

const DEAD = { alive: false, dateOfDeath: '2000-01-01' };
const input = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none';
const stepBtn = 'h-8 w-8 shrink-0 rounded-lg border border-slate-300 bg-white text-base font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40';

type Group = { key: string; en: string; ur: string; ids: string[]; shares: ShareResult[] };

export default function ShareCalc() {
  const [gender, setGender] = useState<'M' | 'F'>('M');
  const [law, setLaw] = useState<LawSystem>('sunni-hanafi');
  const [s4, setS4] = useState(true);
  const [n, setN] = useState<Record<Key, number>>(() => Object.fromEntries(ROWS.map((r) => [r.key, 0])) as Record<Key, number>);
  const [land, setLand] = useState({ k: '', m: '', f: '' });
  const set = (k: Key, v: number) => setN((o) => ({ ...o, [k]: Math.max(0, Math.min(ROWS.find((r) => r.key === k)!.max, v)) }));
  const rowMax = (r: (typeof ROWS)[number]) => (r.key === 'spouse' && gender === 'F' ? 1 : r.max);

  // Build a case from the counts and run the engine. `made` remembers which ids belong to which row.
  const out = useMemo(() => {
    const b = new CaseBuilder(law, { name: 'Deceased', gender, religion: law.startsWith('sunni') || law === 'shia-ithna' ? 'muslim' : 'christian' }, '2026-01-01',
      { applyMFLOs4: s4, raddToSpouseWhenNoOtherHeir: true });
    const made = new Map<Key, string[]>();
    const many = (k: Key, f: () => string) => { const ids: string[] = []; for (let i = 0; i < n[k]; i++) ids.push(f()); made.set(k, ids); };
    // Parents first (siblings and grandparents hang from them), then grandparents, then the rest.
    many('father', () => b.father());
    many('mother', () => b.mother());
    many('pgf', () => b.paternalGrandfather());
    many('pgm', () => b.paternalGrandmother());
    many('mgm', () => b.maternalGrandmother());
    const spouses: string[] = [];
    many('spouse', () => { const id = b.spouse(); spouses.push(id); return id; });
    const other = spouses.length === 1 ? spouses[0] : undefined;
    many('sons', () => b.child('M', {}, other));
    many('daughters', () => b.child('F', {}, other));
    if (n.gsons || n.gdaughters) {
      const dead = b.child('M', { ...DEAD, name: 'Son (died before)' }, other);
      many('gsons', () => b.childOf(dead, 'M'));
      many('gdaughters', () => b.childOf(dead, 'F'));
    }
    many('fullB', () => b.sibling('M', 'full'));
    many('fullS', () => b.sibling('F', 'full'));
    many('consB', () => b.sibling('M', 'consanguine'));
    many('consS', () => b.sibling('F', 'consanguine'));
    many('uteB', () => b.sibling('M', 'uterine'));
    many('uteS', () => b.sibling('F', 'uterine'));
    if (n.uncles) {
      const gf = b.paternalGrandfather(DEAD), gm = b.paternalGrandmother(DEAD);
      many('uncles', () => { const id = b.person('M', { name: 'Paternal uncle' }); b.parents(id, gf, gm); return id; });
    }
    const c = b.build();
    if (![...made.values()].some((x) => x.length)) return null;
    try {
      const r = compute(c);
      const byId = new Map(r.shares.map((s) => [s.personId, s]));
      const groups: Group[] = [];
      for (const row of ROWS) {
        const ids = made.get(row.key) ?? [];
        if (!ids.length) continue;
        const en = row.key === 'spouse' ? (gender === 'M' ? (ids.length > 1 ? 'Wives' : 'Wife') : 'Husband') : row.en;
        const ur = row.key === 'spouse' ? (gender === 'M' ? 'بیوی' : 'شوہر') : row.ur;
        groups.push({ key: row.key, en, ur, ids, shares: ids.map((id) => byId.get(id)!).filter(Boolean) });
      }
      return { r, groups, error: null as string | null };
    } catch (e) { return { r: null, groups: [], error: (e as Error).message }; }
  }, [n, gender, law, s4]);

  const sqft = BigInt(Math.max(0, Math.round((+land.k || 0) * 5440 + (+land.m || 0) * 272 + (+land.f || 0))));
  const landOf = (f: Fraction) => (sqft > 0n ? kmfText((f.n * sqft * 2n + f.d) / (2n * f.d)) : '');
  const sections = [...new Set(ROWS.map((r) => r.group))];

  return (
    <div className="rounded-2xl bg-white text-slate-900 shadow-2xl">
      <div className="grid gap-0 lg:grid-cols-[1fr_1.1fr]">
        {/* Who survived */}
        <div className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">Law
              <select className={input} value={law} onChange={(e) => setLaw(e.target.value as LawSystem)}>
                {LAWS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </label>
            <div className="text-xs font-semibold text-slate-600">The deceased was
              <div className="mt-0.5 inline-flex w-full overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="Gender of the deceased">
                {(['M', 'F'] as const).map((g) => (
                  <button key={g} className={`flex-1 px-3 py-1.5 text-sm font-semibold ${gender === g ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`} aria-pressed={gender === g}
                    onClick={() => { setGender(g); if (g === 'F') set('spouse', Math.min(n.spouse, 1)); }}>{g === 'M' ? 'Man' : 'Woman'}</button>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">How many of each relative were <b>alive</b> when the deceased died? Leave the rest at 0.</p>
          {sections.map((sec) => (
            <fieldset key={sec} className="mt-3 rounded-xl border border-slate-200 p-2">
              <legend className="px-1 text-xs font-bold text-slate-800">{sec}</legend>
              <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
                {ROWS.filter((r) => r.group === sec).map((r) => {
                  const label = r.key === 'spouse' ? (gender === 'M' ? 'Wives' : 'Husband') : r.en;
                  const ur = r.key === 'spouse' ? (gender === 'M' ? 'بیوی' : 'شوہر') : r.ur;
                  const max = rowMax(r);
                  return (
                    <div key={r.key} className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 text-xs leading-tight text-slate-700">{label} <span className="urdu text-slate-500" lang="ur">{ur}</span></span>
                      <button className={stepBtn} aria-label={`Fewer: ${label}`} disabled={!n[r.key]} onClick={() => set(r.key, n[r.key] - 1)}>−</button>
                      <input className="h-8 w-10 rounded-lg border border-slate-300 text-center text-sm font-semibold" inputMode="numeric" aria-label={label} value={n[r.key]}
                        onChange={(e) => set(r.key, Math.min(max, +e.target.value.replace(/\D/g, '') || 0))} />
                      <button className={stepBtn} aria-label={`More: ${label}`} disabled={n[r.key] >= max} onClick={() => set(r.key, n[r.key] + 1)}>+</button>
                    </div>
                  );
                })}
              </div>
              {sec === 'Grandchildren' && (
                <label className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-600">
                  <input type="checkbox" checked={s4} onChange={(e) => setS4(e.target.checked)} /> Apply MFLO 1961 s.4 (they take their late father's share)
                </label>
              )}
            </fieldset>
          ))}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <span className="w-full text-xs font-semibold text-slate-600">Total land (optional) <span className="urdu font-normal" lang="ur">کل رقبہ</span></span>
            {(['k', 'm', 'f'] as const).map((u) => (
              <label key={u} className="w-20 text-[11px] text-slate-500">{{ k: 'Kanal', m: 'Marla', f: 'Feet' }[u]}
                <input className={`${input} text-right`} inputMode="numeric" value={land[u]} placeholder="0" onChange={(e) => setLand({ ...land, [u]: e.target.value.replace(/[^\d.]/g, '') })} />
              </label>
            ))}
            <button className="ml-auto rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => { setN(Object.fromEntries(ROWS.map((r) => [r.key, 0])) as Record<Key, number>); setLand({ k: '', m: '', f: '' }); }}>Clear</button>
          </div>
        </div>

        {/* Shares */}
        <div className="p-4" aria-live="polite">
          <h2 className="text-lg font-bold">Shares <span className="urdu font-normal" lang="ur">حصص</span></h2>
          {!out ? <p className="mt-2 text-sm text-slate-500">Add the relatives on the left (for example 2 sons, 1 wife, mother and father) to see each share.</p>
            : out.error ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{out.error}</p>
            : out.r && (
              <>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-800 text-left text-white">
                        <th className="p-2">Heir</th><th className="p-2 text-right">Each</th><th className="p-2 text-right">Together</th><th className="p-2 text-right">%</th>
                        {sqft > 0n && <th className="p-2 text-right">Land each (K-M-F)</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {out.groups.map((g) => {
                        const each = g.shares[0];
                        const t = sum(g.shares.map((s) => s.fraction));
                        const none = !each || each.fraction.n === 0n;
                        return (
                          <tr key={g.key} className={`border-b border-slate-200 align-top ${none ? 'text-slate-400' : ''}`}>
                            <td className="p-2">
                              <span className="font-semibold">{g.ids.length > 1 ? `${g.ids.length} × ` : ''}{g.en}</span> <span className="urdu text-slate-500" lang="ur">{g.ur}</span>
                              <span className="block text-[11px] text-slate-500">{none ? (each?.reasons[0] ? ruleText(each.reasons[0].ruleId) : 'No share') : each.reasons.map((x) => ruleText(x.ruleId)).join(' ')}</span>
                            </td>
                            <td className="p-2 text-right font-mono">{none ? '—' : toString(each.fraction)}</td>
                            <td className="p-2 text-right font-mono">{none ? '—' : toString(t)}</td>
                            <td className="p-2 text-right font-mono">{none ? '—' : percent(t, 2)}</td>
                            {sqft > 0n && <td className="p-2 text-right font-mono">{none ? '—' : landOf(each.fraction)}</td>}
                          </tr>
                        );
                      })}
                      {out.r.escheat.n > 0n && <tr className="border-b border-slate-200"><td className="p-2">Government (no heir) / residue</td><td /><td className="p-2 text-right font-mono">{toString(out.r.escheat)}</td><td className="p-2 text-right font-mono">{percent(out.r.escheat, 2)}</td>{sqft > 0n && <td />}</tr>}
                      <tr className="bg-slate-100 font-bold"><td className="p-2">Total</td><td /><td className="p-2 text-right font-mono">1</td><td className="p-2 text-right font-mono">100</td>{sqft > 0n && <td className="p-2 text-right font-mono">{kmfText(sqft)}</td>}</tr>
                    </tbody>
                  </table>
                </div>
                {sqft > 0n && <p className="mt-1 text-[11px] text-slate-500">K-M-F = Kanal-Marla-Feet (1 kanal = 20 marla, 1 marla = 272 sq ft); feet rounded.</p>}
                {out.r.needsVerification && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Complex case (distant kindred or grandfather with siblings): verify with a lawyer.</p>}
                {out.r.notes.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                    {out.r.notes.map((x, i) => <li key={i}>{ruleText(x.ruleId)}</li>)}
                  </ul>
                )}
                <p className="mt-3 text-xs text-slate-500">Common share base: {String(out.r.base)} sihaam. Each group's members share equally (son twice a daughter is already applied).</p>
              </>
            )}
          <p className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
            Need the family tree drawing, the heirs' statement for the revenue officer, or a relative who died after the deceased? Use the <a className="font-semibold underline" href="/tools/shajra-nasab/">Shajra Nasab tool</a>.
          </p>
          <p className="mt-2 text-[11px] text-slate-500">Computational aid, not legal advice. Verify with a lawyer / revenue officer.</p>
        </div>
      </div>
    </div>
  );
}
