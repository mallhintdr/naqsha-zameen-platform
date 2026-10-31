// Quick inheritance share calculator: no family tree, just how many of each relative survived the
// deceased (e.g. 2 sons, 1 wife, mother, father). Same engine and the same default rules as the
// Shajra Nasab tool: the counts are turned into a family and passed to the same compute().
import { Fragment, useMemo, useState } from 'react';
import { CaseBuilder, compute, frac, sum, toString, percent, type Case, type LawSystem, type ShareResult, type Fraction } from 'inheritance-engine';
import { ruleText } from '../shajra/labels.ts';
import { kmfText } from '../shajra/Estate.tsx';
import { load as loadShajra, save as saveShajra } from '../shajra/model.ts';
import { SITE } from '../../site';

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
const cell = 'border border-slate-300 px-1.5 py-0.5 leading-tight sm:px-2 sm:py-1'; // shares table: every column outlined
const icell = 'px-1.5 py-0.5 sm:px-2 sm:py-1';
const stepBtn = 'h-6 w-6 sm:h-7 sm:w-7 shrink-0 rounded-lg border border-slate-300 bg-white text-base font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40';

type Group = { key: string; en: string; ur: string; ids: string[]; shares: ShareResult[] };
/** A son or daughter of the deceased who died before the deceased, with the children they left. */
type Line = { id: number; parent: 'M' | 'F'; sons: number; daughters: number };
const GRAND = 'Grandchildren*';
const SECTIONS = ['Spouse and children', 'Parents and grandparents', GRAND, 'Brothers, sisters and uncles'];
const SECTION_UR: Record<string, string> = {
  'Spouse and children': 'زوج اور اولاد', 'Parents and grandparents': 'والدین، دادا دادی، نانی',
  [GRAND]: 'پوتے پوتیاں، نواسے نواسیاں', 'Brothers, sisters and uncles': 'بہن بھائی اور چچا',
};

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
      const whoUr = `${l.parent === 'M' ? 'مرحوم بیٹا' : 'مرحومہ بیٹی'}${who.replace(/^late (son|daughter)/, '')}`;
      if (sons.length) lineGroups.push({ key: `L${l.id}s`, en: `Sons of ${who}`, ur: `${l.parent === 'M' ? 'پوتے' : 'نواسے'} (${whoUr})`, ids: sons });
      if (daughters.length) lineGroups.push({ key: `L${l.id}d`, en: `Daughters of ${who}`, ur: `${l.parent === 'M' ? 'پوتیاں' : 'نواسیاں'} (${whoUr})`, ids: daughters });
    }
    many('fullB', () => b.sibling('M', 'full'));
    many('fullS', () => b.sibling('F', 'full'));
    // Half brothers / sisters share one step-mother (by father) or one step-father (by mother).
    let stepMother: string | undefined, stepFather: string | undefined;
    const half = (g: 'M' | 'F', by: 'father' | 'mother') => {
      const id = b.person(g, { name: g === 'M' ? 'Brother' : 'Sister' });
      if (by === 'father') { stepMother ??= b.person('F', { ...DEAD, name: 'Step-mother' }); b.parents(id, b.father(DEAD), stepMother); }
      else { stepFather ??= b.person('M', { ...DEAD, name: 'Step-father' }); b.parents(id, stepFather, b.mother(DEAD)); }
      return id;
    };
    many('consB', () => half('M', 'father'));
    many('consS', () => half('F', 'father'));
    many('uteB', () => half('M', 'mother'));
    many('uteS', () => half('F', 'mother'));
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
          const ur = row.key === 'spouse' ? (gender === 'M' ? (ids.length > 1 ? 'بیویاں' : 'بیوی') : 'شوہر') : row.ur;
          groups.push({ key: row.key, en, ur, ids, shares: sharesOf(ids) });
        }
        // Grandchildren come after the parents and grandparents.
        if (row.key === 'mgm') for (const lg of lineGroups) groups.push({ ...lg, shares: sharesOf(lg.ids) });
      }
      return { r, groups, c, error: null as string | null };
    } catch (e) { return { r: null, groups: [], c, error: (e as Error).message }; }
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

  const lawLabel = LAWS.find((l) => l.value === law)?.label ?? law;
  const host = (() => { try { return new URL(SITE.url).host.replace(/^www\./, ''); } catch { return 'naqsha-zameen.com'; } })();

  /** Download: the shares table (with the rules) drawn on a canvas and saved as a JPG. */
  const downloadJpg = async () => {
    if (!out?.r) return;
    try { await document.fonts.load("16px 'Noto Nastaliq Urdu'"); } catch { /* falls back to a system font */ }
    const r = out.r;
    const S = 2; // sharp on phones and in print
    type Col = { head: string; w: number; ur?: boolean; get: (g: Group) => string };
    const rowOf = (g: Group) => { const e = g.shares[0]; const none = !e || e.fraction.n === 0n; return { e, none, t: sum(g.shares.map((x) => x.fraction)) }; };
    const cols: Col[] = [
      { head: 'Heir', w: 250, get: (g) => g.en },
      { head: 'وارث', w: 190, ur: true, get: (g) => g.ur },
      { head: 'No.', w: 60, get: (g) => String(g.ids.length) },
      { head: 'Each', w: 110, get: (g) => { const x = rowOf(g); return x.none ? '—' : toString(x.e.fraction); } },
      { head: 'Together', w: 110, get: (g) => { const x = rowOf(g); return x.none ? '—' : toString(x.t); } },
      { head: 'Sihaam', w: 90, get: (g) => { const x = rowOf(g); return x.none ? '—' : String(g.shares.reduce((a, y) => a + y.sihaam, 0n)); } },
      { head: '%', w: 80, get: (g) => { const x = rowOf(g); return x.none ? '—' : percent(x.e.fraction, 2); } },
      ...(sqft > 0n ? [{ head: 'Land (K-M-F)', w: 130, get: (g: Group) => { const x = rowOf(g); return x.none ? '—' : landOf(x.e.fraction); } }] : []),
    ];
    const pad = 24, rowH = 36, W = cols.reduce((a, c) => a + c.w, 0) + pad * 2;
    const ctx0 = document.createElement('canvas').getContext('2d')!;
    // Rules under the table, wrapped to the table width.
    const ruleLines: string[] = [];
    ctx0.font = '13px Arial, sans-serif';
    const wrap = (text: string) => {
      let line = '';
      for (const word of text.split(' ')) {
        const tryLine = line ? `${line} ${word}` : word;
        if (ctx0.measureText(tryLine).width > W - pad * 2 && line) { ruleLines.push(line); line = `   ${word}`; } else line = tryLine;
      }
      if (line) ruleLines.push(line);
    };
    notes.forEach((t, i) => {
      const who = out.groups.filter((g) => noteNo.get(g.key) === i + 1).map((g) => g.en);
      wrap(`${who.length ? `${who.join(', ')}: ` : '• '}${t}`);
    });
    const rows = out.groups.length + 2 + (r.escheat.n > 0n ? 1 : 0);
    const H = 78 + rows * rowH + 18 + ruleLines.length * 19 + 16 + 40;
    const cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext('2d')!;
    ctx.scale(S, S);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    // Title
    ctx.fillStyle = '#0f172a'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = 'bold 20px Arial, sans-serif'; ctx.fillText('Inheritance shares', pad, 28);
    ctx.font = "20px 'Noto Nastaliq Urdu', serif"; ctx.textAlign = 'right'; ctx.direction = 'rtl'; ctx.fillText('وراثتی حصص', W - pad, 26); ctx.direction = 'ltr';
    ctx.textAlign = 'left'; ctx.font = '13px Arial, sans-serif'; ctx.fillStyle = '#475569';
    ctx.fillText(`${lawLabel} · The deceased was a ${gender === 'M' ? 'man' : 'woman'}${sqft > 0n ? ` · Total land ${kmfText(sqft)} (K-M-F)` : ''}`, pad, 56);
    // Table
    let y = 72;
    const drawRow = (cells: string[], opts: { head?: boolean; total?: boolean; grey?: boolean }) => {
      ctx.fillStyle = opts.head ? '#1e293b' : opts.total ? '#f1f5f9' : '#fff';
      ctx.fillRect(pad, y, W - pad * 2, rowH);
      let x = pad;
      cells.forEach((text, i) => {
        const c = cols[i];
        ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, c.w, rowH);
        const urdu = /[\u0600-\u06FF]/.test(text);
        ctx.fillStyle = opts.head ? '#fff' : opts.grey ? '#94a3b8' : '#0f172a';
        ctx.font = urdu ? "15px 'Noto Nastaliq Urdu', serif" : `${opts.head || opts.total || i === 0 ? 'bold ' : ''}14px ${i >= 2 && !opts.head ? 'Consolas, monospace' : 'Arial, sans-serif'}`;
        ctx.direction = urdu ? 'rtl' : 'ltr';
        const left = i === 0 && !opts.head;
        ctx.textAlign = left ? 'left' : 'center';
        ctx.fillText(text, left ? x + 8 : x + c.w / 2, y + rowH / 2 + (urdu ? -2 : 1));
        x += c.w;
      });
      ctx.direction = 'ltr';
      y += rowH;
    };
    drawRow(cols.map((c) => c.head), { head: true });
    for (const g of out.groups) drawRow(cols.map((c) => c.get(g)), { grey: rowOf(g).none });
    if (r.escheat.n > 0n) drawRow(cols.map((c, i) => (i === 0 ? 'Government (no heir)' : i === 1 ? 'حکومت' : c.head === 'Together' ? toString(r.escheat) : '')), {});
    drawRow(cols.map((c, i) => (i === 0 ? 'Total' : i === 1 ? 'میزان' : c.head === 'No.' ? String(out.groups.reduce((a, g) => a + g.ids.length, 0)) : c.head === 'Together' ? '1' : c.head === 'Sihaam' ? String(r.base) : c.head.startsWith('Land') ? kmfText(sqft) : '')), { total: true });
    // Rules
    y += 18; ctx.textAlign = 'left'; ctx.fillStyle = '#334155'; ctx.font = '13px Arial, sans-serif';
    for (const l of ruleLines) { ctx.fillText(l, pad, y); y += 19; }
    // Footer band
    ctx.fillStyle = '#0b2545'; ctx.fillRect(0, H - 40, W, 40);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`Created and downloaded from ${host}/tools/share-calculator/`, W / 2, H - 20);
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'inheritance-shares.jpg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/jpeg', 0.92);
  };

  /** Draw shajra nasab: the same family goes to the Shajra tool (saved in this browser), named so it is easy to edit. */
  const drawShajra = () => {
    if (!out?.c) return;
    const existing = loadShajra();
    if (existing && existing.persons.length > 1 && !confirm('The Shajra Nasab tool already has a family saved in this browser. Replace it with this one?')) return;
    const c: Case = structuredClone(out.c);
    const today = new Date().toISOString().slice(0, 10);
    c.id = `SN-${Date.now().toString(36).toUpperCase()}`;
    c.dateOfDeath = today;
    const d = c.persons.find((x) => x.id === c.deceasedId)!;
    d.name = ''; d.dateOfDeath = undefined; // optional: the user adds it on the shajra
    // Stand-in dates (people who died before) are not real dates: leave them blank to fill in.
    for (const p of c.persons) if (!p.alive && p.id !== c.deceasedId) p.dateOfDeath = undefined;
    // Easy names to type over: "Son 1", "Son 2", "Wife", "Brother"...
    const single: Record<string, string> = {
      spouse: gender === 'M' ? 'Wife' : 'Husband', sons: 'Son', daughters: 'Daughter', father: 'Father', mother: 'Mother',
      pgf: 'Paternal grandfather', pgm: 'Paternal grandmother', mgm: 'Maternal grandmother',
      fullB: 'Brother', fullS: 'Sister', consB: 'Half-brother', consS: 'Half-sister', uteB: 'Half-brother', uteS: 'Half-sister', uncles: 'Uncle',
    };
    for (const g of out.groups) {
      const base = single[g.key] ?? (g.key.endsWith('s') ? 'Grandson' : 'Granddaughter');
      g.ids.forEach((id, i) => { const p = c.persons.find((x) => x.id === id); if (p) p.name = g.ids.length > 1 ? `${base} ${i + 1}` : base; });
    }
    // A late son / daughter reads "Late son 2"; the deceased's father and mother are drawn as a couple.
    for (const p of c.persons) if (/^late (son|daughter)/.test(p.name)) p.name = p.name.replace(/^late/, 'Late');
    const link = c.parents.find((l) => l.childId === c.deceasedId);
    if (link?.fatherId && link.motherId && !c.unions.some((u) => u.partners.includes(link.fatherId!) && u.partners.includes(link.motherId!))) {
      c.unions.push({ id: 'u-parents', partners: [link.fatherId, link.motherId], type: 'marriage' });
    }
    if (sqft > 0n) c.estate = { ...c.estate, immovable: [{ title: 'Land', area: { unit: 'gkanal', value: frac(sqft, 5440n) } }] };
    saveShajra(c);
    window.location.href = '/tools/shajra-nasab/?from=calculator';
  };

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
                <input className={`${input} text-right`} inputMode="numeric" value={land[u]} placeholder="0" onChange={(e) => {
                  // Kanal may have decimals; marla stops at 19 and feet at 271 (the next would make a kanal / marla).
                  let v = e.target.value.replace(u === 'k' ? /[^\d.]/g : /\D/g, '');
                  const max = u === 'm' ? 19 : u === 'f' ? 271 : Infinity;
                  if (v && +v > max) v = String(max);
                  setLand({ ...land, [u]: v });
                }} />
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
                    {sec} <span className="urdu ms-1 font-normal text-slate-500" lang="ur">{SECTION_UR[sec]}</span>
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
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">Shares <span className="urdu font-normal" lang="ur">حصص</span></h2>
            {out?.r && (
              <div className="ml-auto flex gap-1.5">
                <button className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={downloadJpg}>⬇ Download</button>
                <button className="rounded-lg border border-sky-700 bg-sky-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-800" onClick={drawShajra}>✏️ Draw shajra nasab</button>
              </div>
            )}
          </div>
          {!out ? <p className="mt-2 text-sm text-slate-500">Add the relatives on the left, e.g. 2 sons, 1 wife, mother and father.</p>
            : out.error ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{out.error}</p>
            : out.r && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse border border-slate-300 text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-slate-800 text-center text-white">
                      <th className={`${cell} text-center`}>Heir</th><th className={`${cell} text-center font-normal`}><span className="urdu" lang="ur">وارث</span></th><th className={`${cell} text-center`}>No.</th><th className={`${cell} text-center`}>Each</th>
                      <th className={`${cell} hidden text-center sm:table-cell`}>Together</th>
                      <th className={`${cell} hidden text-center sm:table-cell`}>Sihaam</th>
                      <th className={`${cell} text-center`}>%</th>
                      {sqft > 0n && <th className={`${cell} text-center`}>Land</th>}
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
                            {noteNo.get(g.key)
                              // The heir's name links to the rule that gives this share (in the notes below).
                              ? <a href={`#calc-rule-${noteNo.get(g.key)}`} title={notes[noteNo.get(g.key)! - 1]}
                                  className="font-semibold text-sky-800 underline decoration-sky-400 decoration-dotted underline-offset-2 hover:text-sky-600">{g.en}</a>
                              : <span className="font-semibold">{g.en}</span>}
                          </td>
                          <td className={`${cell} text-center`} lang="ur" dir="rtl">{(() => {
                            // "پوتے (مرحوم بیٹا 2)": the relation on one line, which late son / daughter in small type under it.
                            const [main, sub] = g.ur.split(' (');
                            const no = noteNo.get(g.key);
                            const name = no
                              ? <a href={`#calc-rule-${no}`} title={notes[no - 1]} className="urdu whitespace-nowrap text-[12px] leading-[1.5] text-sky-800 underline decoration-sky-400 decoration-dotted underline-offset-4">{main}</a>
                              : <span className="urdu whitespace-nowrap text-[12px] leading-[1.5] text-slate-700">{main}</span>;
                            return <>{name}{sub && <span className="urdu block whitespace-nowrap text-[10px] leading-tight text-slate-500">({sub}</span>}</>;
                          })()}</td>
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
                      <tr className="border-b border-slate-200"><td className={cell}>Government (no heir)</td><td className={`${cell} text-center`}><span className="urdu text-[12px]" lang="ur">حکومت</span></td><td className={cell} /><td className={`${cell} text-right font-mono`}>{toString(out.r.escheat)}</td>
                        <td className={`${cell} hidden sm:table-cell`} /><td className={`${cell} hidden sm:table-cell`} /><td className={`${cell} text-right font-mono`}>{percent(out.r.escheat, 2)}</td>{sqft > 0n && <td className={cell} />}</tr>
                    )}
                    <tr className="bg-slate-100 font-bold">
                      <td className={cell}>Total</td><td className={`${cell} text-center`}><span className="urdu text-[12px]" lang="ur">میزان</span></td><td className={`${cell} text-center font-mono`}>{out.groups.reduce((a, g) => a + g.ids.length, 0)}</td><td className={cell} />
                      <td className={`${cell} hidden text-right font-mono sm:table-cell`}>1</td>
                      <td className={`${cell} hidden text-right font-mono sm:table-cell`}>{String(out.r.base)}</td>
                      <td className={cell} />
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
            {notes.map((t, i) => {
              // Each rule names the heirs it applies to; the heir links in the table land here.
              const who = out?.groups.filter((g) => noteNo.get(g.key) === i + 1).map((g) => g.en) ?? [];
              return (
                <li key={i} id={`calc-rule-${i + 1}`} className="scroll-mt-24 rounded px-1 target:bg-amber-100">
                  {who.length > 0 && <b className="text-slate-800">{who.join(', ')}: </b>}{t}
                </li>
              );
            })}
          </ol>
        )}
        <ul className="mt-1 space-y-0.5">
          <li>* Children of a son or daughter who died before the deceased. Add each late son / daughter separately: with MFLO 1961 s.4 each one's children take only the share that parent would have taken (sons twice daughters; only daughters take 1/2 or 2/3 of it).</li>
          <li>** The father's full brothers.</li>
          {sqft > 0n && <li>Land: each heir's land in Kanal-Marla-Feet (1 kanal = 20 marla, 1 marla = 272 sq ft); feet rounded.</li>}
          <li>For the family tree, the heirs' statement for the revenue officer, or an heir who died after the deceased, use the <a className="font-semibold text-sky-700 underline" href="/tools/shajra-nasab/">Shajra Nasab tool</a>.</li>
          <li>Computational aid, not legal advice. Verify with a lawyer / revenue officer.</li>
        </ul>
      </footer>
    </div>
  );
}
