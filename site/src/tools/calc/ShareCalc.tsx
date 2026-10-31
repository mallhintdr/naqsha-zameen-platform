// Quick inheritance share calculator: no family tree, just how many of each relative survived the
// deceased (e.g. 2 sons, 1 wife, mother, father). Same engine and the same default rules as the
// Shajra Nasab tool: the counts are turned into a family and passed to the same compute().
import { Fragment, useMemo, useState } from 'react';
import { CaseBuilder, compute, sum, toString, percent, type LawSystem, type ShareResult, type Fraction } from 'inheritance-engine';
import { ruleText } from '../shajra/labels.ts';
import { kmfText } from '../shajra/Estate.tsx';

type Key =
  | 'spouse' | 'sons' | 'daughters' | 'father' | 'mother'
  | 'pgf' | 'pgm' | 'mgm'
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
  { key: 'fullB', en: 'Full brothers', ur: 'حقیقی بھائی', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'fullS', en: 'Full sisters', ur: 'حقیقی بہنیں', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'consB', en: 'Brothers by father only', ur: 'علاتی بھائی', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'consS', en: 'Sisters by father only', ur: 'علاتی بہنیں', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'uteB', en: 'Brothers by mother only', ur: 'اخیافی بھائی', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'uteS', en: 'Sisters by mother only', ur: 'اخیافی بہنیں', max: 20, group: 'Brothers, sisters and uncles' },
  { key: 'uncles', en: 'Paternal uncles**', ur: 'چچا', max: 20, group: 'Brothers, sisters and uncles' },
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
const cell = 'px-1.5 py-1 sm:p-2';
const icell = 'px-1.5 py-0.5 sm:px-2 sm:py-1';
const stepBtn = 'h-6 w-6 sm:h-7 sm:w-7 shrink-0 rounded-lg border border-slate-300 bg-white text-base font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40';

type Group = { key: string; en: string; ur: string; ids: string[]; shares: ShareResult[] };
/** A son or daughter of the deceased who died before the deceased, with the children they left. */
type Line = { id: number; parent: 'M' | 'F'; sons: number; daughters: number };
const GRAND = 'Grandchildren*';
const SECTIONS = ['Spouse and children', 'Parents and grandparents', GRAND, 'Brothers, sisters and uncles'];

export default function ShareCalc() {
  const [gender, setGender] = useState<'M' | 'F'>('M');
  const [law, setLaw] = useState<LawSystem>('sunni-hanafi');
  const [s4, setS4] = useState(true);
  const [n, setN] = useState<Record<Key, number>>(() => Object.fromEntries(ROWS.map((r) => [r.key, 0])) as Record<Key, number>);
  const [land, setLand] = useState({ k: '', m: '', f: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const setLine = (id: number, x: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...x } : l)));
  /** "late son 2" when there are several late sons, else "late son". */
  const lineName = (l: Line) => {
    const same = lines.filter((x) => x.parent === l.parent);
    return `late ${l.parent === 'M' ? 'son' : 'daughter'}${same.length > 1 ? ` ${same.indexOf(l) + 1}` : ''}`;
  };
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
    // Each late son / daughter separately, so each one's children share only that parent's portion.
    const lineGroups: Omit<Group, 'shares'>[] = [];
    for (const l of lines) {
      if (!l.sons && !l.daughters) continue;
      const who = lineName(l);
      const dead = b.child(l.parent, { ...DEAD, name: who }, other);
      const sons = Array.from({ length: l.sons }, () => b.childOf(dead, 'M'));
      const daughters = Array.from({ length: l.daughters }, () => b.childOf(dead, 'F'));
      if (sons.length) lineGroups.push({ key: `L${l.id}s`, en: `Sons of ${who}`, ur: l.parent === 'M' ? 'پوتے' : 'نواسے', ids: sons });
      if (daughters.length) lineGroups.push({ key: `L${l.id}d`, en: `Daughters of ${who}`, ur: l.parent === 'M' ? 'پوتیاں' : 'نواسیاں', ids: daughters });
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
    if (![...made.values()].some((x) => x.length) && !lineGroups.length) return null;
    try {
      const r = compute(c);
      const byId = new Map(r.shares.map((s) => [s.personId, s]));
      const groups: Group[] = [];
      const sharesOf = (ids: string[]) => ids.map((id) => byId.get(id)!).filter(Boolean);
      for (const row of ROWS) {
        const ids = made.get(row.key) ?? [];
        if (ids.length) {
          const en = row.key === 'spouse' ? (gender === 'M' ? (ids.length > 1 ? 'Wives' : 'Wife') : 'Husband') : row.en;
          const ur = row.key === 'spouse' ? (gender === 'M' ? 'بیوی' : 'شوہر') : row.ur;
          groups.push({ key: row.key, en, ur, ids, shares: sharesOf(ids) });
        }
        // Grandchildren come after the parents and grandparents.
        if (row.key === 'mgm') for (const lg of lineGroups) groups.push({ ...lg, shares: sharesOf(lg.ids) });
      }
      return { r, groups, error: null as string | null };
    } catch (e) { return { r: null, groups: [], error: (e as Error).message }; }
  }, [n, gender, law, s4, lines]);

  const sqft = BigInt(Math.max(0, Math.round((+land.k || 0) * 5440 + (+land.m || 0) * 272 + (+land.f || 0))));
  const landOf = (f: Fraction) => (sqft > 0n ? kmfText((f.n * sqft * 2n + f.d) / (2n * f.d)) : '');
  // Footnotes: each distinct explanation once, numbered; a heir row carries its number.
  const notes: string[] = [];
  const noteNo = new Map<string, number>();
  const addNote = (t: string) => { let i = notes.indexOf(t); if (i < 0) { notes.push(t); i = notes.length - 1; } return i + 1; };
  if (out?.r) {
    for (const g of out.groups) {
      const each = g.shares[0];
      const t = each ? each.reasons.map((x) => ruleText(x.ruleId)).join(' ') || (each.fraction.n === 0n ? 'No share.' : '') : '';
      if (t) noteNo.set(g.key, addNote(t));
    }
    for (const x of out.r.notes) addNote(ruleText(x.ruleId));
    if (out.r.needsVerification) addNote('Complex case (distant kindred or grandfather with siblings): verify with a lawyer.');
  }

  /** One relation row: name, Urdu name, − count +. */
  const countRow = (key: string, label: string, ur: string, value: number, max: number, onSet: (v: number) => void) => (
    <tr key={key} className={`border-b border-slate-100 ${value ? 'bg-sky-50/60' : ''}`}>
      <td className={`${icell} text-xs leading-tight text-slate-800`}>{label}</td>
      <td className={`${icell} text-center`}><span className="urdu text-[11px] text-slate-600 sm:text-xs" lang="ur" dir="rtl">{ur}</span></td>
      <td className={icell}>
        <div className="flex items-center justify-center gap-0.5 sm:gap-1">
          <button className={stepBtn} aria-label={`Fewer: ${label}`} disabled={!value} onClick={() => onSet(Math.max(0, value - 1))}>−</button>
          <input className="h-6 w-7 rounded-md border border-slate-300 text-center text-xs font-semibold sm:h-8 sm:w-9 sm:rounded-lg sm:text-sm" inputMode="numeric" aria-label={label} value={value}
            onChange={(e) => onSet(Math.min(max, +e.target.value.replace(/\D/g, '') || 0))} />
          <button className={stepBtn} aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onSet(Math.min(max, value + 1))}>+</button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="rounded-2xl bg-white text-slate-900 shadow-2xl">
      <div className="grid gap-0 lg:grid-cols-[1fr_1.1fr]">
        {/* Who survived */}
        <div className="border-b border-slate-200 p-3 sm:p-4 lg:border-b-0 lg:border-r">
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
          {/* Total land right after the deceased's details */}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <span className="w-full text-xs font-semibold text-slate-600">Total land (optional) <span className="urdu font-normal" lang="ur">کل رقبہ</span></span>
            {(['k', 'm', 'f'] as const).map((u) => (
              <label key={u} className="w-20 text-[11px] text-slate-500">{{ k: 'Kanal', m: 'Marla', f: 'Feet' }[u]}
                <input className={`${input} text-right`} inputMode="numeric" value={land[u]} placeholder="0" onChange={(e) => setLand({ ...land, [u]: e.target.value.replace(/[^\d.]/g, '') })} />
              </label>
            ))}
            <button className="ml-auto rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => { setN(Object.fromEntries(ROWS.map((r) => [r.key, 0])) as Record<Key, number>); setLand({ k: '', m: '', f: '' }); setLines([]); }}>Clear</button>
          </div>
          <p className="mt-3 text-xs text-slate-500">Count the relatives <b>alive</b> at the death.</p>
          {/* Relatives as one grouped table: relation, Urdu, count */}
          <table className="mt-2 w-full border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-slate-800 text-left text-xs text-white">
                <th className={`${icell} font-semibold`}>Relation</th>
                <th className={`${icell} text-center font-normal`}><span className="urdu" lang="ur">رشتہ</span></th>
                <th className={`${icell} w-[5.75rem] text-center font-semibold sm:w-[7.5rem]`}>Number</th>
              </tr>
            </thead>
            {SECTIONS.map((sec) => (
              <tbody key={sec}>
                <tr className="bg-slate-100">
                  <th colSpan={3} className={`${icell} text-left text-xs font-bold text-slate-700`}>
                    {sec}
                    {sec === GRAND && (
                      <label className="float-right flex items-center gap-1 font-normal text-slate-600">
                        <input type="checkbox" checked={s4} onChange={(e) => setS4(e.target.checked)} /> MFLO 1961 s.4
                      </label>
                    )}
                  </th>
                </tr>
                {sec !== GRAND && ROWS.filter((r) => r.group === sec).map((r) => {
                  const label = r.key === 'spouse' ? (gender === 'M' ? 'Wives' : 'Husband') : r.en;
                  const ur = r.key === 'spouse' ? (gender === 'M' ? 'بیوی' : 'شوہر') : r.ur;
                  return countRow(r.key, label, ur, n[r.key], rowMax(r), (v) => set(r.key, v));
                })}
                {sec === GRAND && lines.map((l) => (
                  <Fragment key={l.id}>
                    <tr className="border-b border-slate-100">
                      <td colSpan={3} className={`${icell} text-[11px] font-semibold text-slate-600`}>
                        <span className="capitalize">{lineName(l)}</span> <span className="urdu font-normal" lang="ur">{l.parent === 'M' ? 'مرحوم بیٹا' : 'مرحومہ بیٹی'}</span>
                        <button className="float-right rounded px-1.5 text-sm leading-none text-slate-500 hover:bg-slate-100" aria-label={`Remove ${lineName(l)}`}
                          onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>×</button>
                      </td>
                    </tr>
                    {countRow(`L${l.id}s`, `${l.parent === 'M' ? 'His' : 'Her'} sons`, l.parent === 'M' ? 'پوتے' : 'نواسے', l.sons, 20, (v) => setLine(l.id, { sons: v }))}
                    {countRow(`L${l.id}d`, `${l.parent === 'M' ? 'His' : 'Her'} daughters`, l.parent === 'M' ? 'پوتیاں' : 'نواسیاں', l.daughters, 20, (v) => setLine(l.id, { daughters: v }))}
                  </Fragment>
                ))}
                {sec === GRAND && (
                  <tr>
                    <td colSpan={3} className={`${icell} py-1.5`}>
                      <div className="flex flex-wrap gap-1.5">
                        {(['M', 'F'] as const).map((g) => (
                          <button key={g} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            onClick={() => setLines((ls) => [...ls, { id: Date.now(), parent: g, sons: 0, daughters: 0 }])}>
                            + {g === 'M' ? 'Son' : 'Daughter'} who died before <span className="urdu font-normal text-slate-500" lang="ur">{g === 'M' ? 'مرحوم بیٹا' : 'مرحومہ بیٹی'}</span>
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </table>
        </div>

        {/* Shares: figures only; every explanation is a numbered note at the foot */}
        <div className="p-3 sm:p-4" aria-live="polite">
          <h2 className="text-lg font-bold">Shares <span className="urdu font-normal" lang="ur">حصص</span></h2>
          {!out ? <p className="mt-2 text-sm text-slate-500">Add the relatives on the left, e.g. 2 sons, 1 wife, mother and father.</p>
            : out.error ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{out.error}</p>
            : out.r && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-slate-800 text-left text-white">
                      <th className={cell}>Heir</th><th className={`${cell} text-center`}>No.</th><th className={`${cell} text-right`}>Each</th>
                      <th className={`${cell} hidden text-right sm:table-cell`}>Together</th>
                      <th className={`${cell} hidden text-right sm:table-cell`}>Sihaam</th>
                      <th className={`${cell} text-right`}>% each</th>
                      {sqft > 0n && <th className={`${cell} text-right`}>Land each†</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {out.groups.map((g) => {
                      const each = g.shares[0];
                      const t = sum(g.shares.map((x) => x.fraction));
                      const none = !each || each.fraction.n === 0n;
                      return (
                        <tr key={g.key} className={`border-b border-slate-200 ${none ? 'text-slate-400' : ''}`}>
                          <td className={cell}>
                            <span className="font-semibold">{g.en}</span>
                            {noteNo.get(g.key) && <sup className="ml-0.5 text-[10px] font-semibold text-sky-700">({noteNo.get(g.key)})</sup>}
                            <span className="urdu block text-[11px] leading-tight text-slate-500 sm:ml-1 sm:inline" lang="ur">{g.ur}</span>
                          </td>
                          <td className={`${cell} text-center font-mono`}>{g.ids.length}</td>
                          <td className={`${cell} text-right font-mono`}>{none ? '—' : toString(each.fraction)}</td>
                          <td className={`${cell} hidden text-right font-mono sm:table-cell`}>{none ? '—' : toString(t)}</td>
                          <td className={`${cell} hidden text-right font-mono sm:table-cell`}>{none ? '—' : String(g.shares.reduce((a, x) => a + x.sihaam, 0n))}</td>
                          <td className={`${cell} text-right font-mono`}>{none ? '—' : percent(each.fraction, 2)}</td>
                          {sqft > 0n && <td className={`${cell} whitespace-nowrap text-right font-mono`}>{none ? '—' : landOf(each.fraction)}</td>}
                        </tr>
                      );
                    })}
                    {out.r.escheat.n > 0n && (
                      <tr className="border-b border-slate-200"><td className={cell}>Government (no heir)</td><td /><td className={`${cell} text-right font-mono`}>{toString(out.r.escheat)}</td>
                        <td className="hidden sm:table-cell" /><td className="hidden sm:table-cell" /><td className={`${cell} text-right font-mono`}>{percent(out.r.escheat, 2)}</td>{sqft > 0n && <td />}</tr>
                    )}
                    <tr className="bg-slate-100 font-bold">
                      <td className={cell}>Total</td><td className={`${cell} text-center font-mono`}>{out.groups.reduce((a, g) => a + g.ids.length, 0)}</td><td />
                      <td className={`${cell} hidden text-right font-mono sm:table-cell`}>1</td>
                      <td className={`${cell} hidden text-right font-mono sm:table-cell`}>{String(out.r.base)}</td>
                      <td />
                      {sqft > 0n && <td className={`${cell} whitespace-nowrap text-right font-mono`}>{kmfText(sqft)}</td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>

      {/* Notes at the foot */}
      <footer className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-600 rounded-b-2xl">
        {notes.length > 0 && (
          <ol className="space-y-0.5">
            {notes.map((t, i) => <li key={i}><b className="text-sky-700">({i + 1})</b> {t}</li>)}
          </ol>
        )}
        <ul className="mt-1 space-y-0.5">
          <li>* Children of a son or daughter who died before the deceased. Add each late son / daughter separately: with MFLO 1961 s.4 each one's children take only the share that parent would have taken (sons twice daughters; only daughters take 1/2 or 2/3 of it).</li>
          <li>** The father's full brothers.</li>
          {sqft > 0n && <li>† Kanal-Marla-Feet (1 kanal = 20 marla, 1 marla = 272 sq ft); feet rounded.</li>}
          <li>For the family tree, the heirs' statement for the revenue officer, or an heir who died after the deceased, use the <a className="font-semibold text-sky-700 underline" href="/tools/shajra-nasab/">Shajra Nasab tool</a>.</li>
          <li>Computational aid, not legal advice. Verify with a lawyer / revenue officer.</li>
        </ul>
      </footer>
    </div>
  );
}
