// Shajra Nasab: build the family of a deceased person and get the inheritance shares.
// Runs fully in the browser; the case is autosaved in this browser only (localStorage).
import { useEffect, useMemo, useRef, useState } from 'react';
import { combine, compute, eq, ONE, parse, percent, sum, ZERO, toString, type ChainLink, type Case, type ComputeResult, type LawSystem, type Person, type ShareResult } from 'inheritance-engine';
import Tree, { Legend } from './Tree.tsx';

type Root = Case & { subcases?: Case[] };
type Place = { mauza: string; tehsil: string };
const place = (c: Case): Place => ({ mauza: '', tehsil: '', ...((c as Case & { place?: Place }).place ?? {}) });

const FIQH_UR: Record<string, string> = {
  'sunni-hanafi': 'فقہ حنفی', 'sunni-shafii': 'فقہ شافعی', 'sunni-maliki': 'فقہ مالکی', 'sunni-hanbali': 'فقہ حنبلی',
  'shia-ithna': 'فقہ جعفریہ', christian: 'قانون وراثت 1925 (مسیحی)', parsi: 'قانون وراثت 1925 (پارسی)', other: 'قانون وراثت 1925',
  'hindu-mitakshara-benares': 'متاکشرا (ہندو)', 'hindu-mitakshara-bombay': 'متاکشرا (ہندو)',
};

/** Urdu heading as on a patwari's shajra: deceased, "as stated by the heirs", fiqh, mouza, tehsil. */
/** The deceased's father's name: the father on the tree, else the name typed for the deceased. */
export const deceasedFatherName = (c: Case) => {
  const d = c.persons.find((p) => p.id === c.deceasedId)!;
  const fid = c.parents.find((l) => l.childId === d.id)?.fatherId;
  return c.persons.find((p) => p.id === fid)?.name || d.fatherName || '';
};

function ShajraTitle({ c }: { c: Case }) {
  const d = c.persons.find((p) => p.id === c.deceasedId)!;
  const fn = deceasedFatherName(c);
  const pl = place(c);
  const blank = '__________';
  return (
    <h2 className="shajra-title urdu mb-2 border-b-2 border-slate-800 pb-1 text-center font-bold text-slate-900" lang="ur" dir="rtl" style={{ fontSize: '0.75em', lineHeight: 2.1 }}>
      شجرہ نسب متوفی {d.name || blank}{fn ? ` ${d.gender === 'F' ? 'دختر' : 'ولد'} ${fn}` : ''}، حسب گفتہ وارثان، {FIQH_UR[c.lawSystem] ?? ''}، موضع {pl.mauza || blank} تحصیل {pl.tehsil || blank}
    </h2>
  );
}

const MM = 25.4 / 96; // one CSS pixel in mm
/** Site address for the line at the foot of every printed page. */
const SITE_HOST = (() => { try { return new URL(SITE.url).host.replace(/^www\./, ''); } catch { return 'naqsha-zameen.com'; } })();

/** How the sheet is laid out: page orientation, tree size (mm) and where the share table goes.
 *  The tree is centred on the page right under the title, at its natural size when it fits,
 *  smaller when it does not; the share table sits at the side when there is room, else below. */
export function sheetPlan(c: Case, hasTable: boolean, tableRows: number) {
  const { width, height } = layout(c);
  const treeW = (width + 56) * MM, treeH = (height + 34) * MM; // the tree's drawing size
  const props = c.estate.immovable.length;
  const tableW = hasTable ? 70 + 20 * props : 0;
  const tableH = hasTable ? (tableRows + 2) * 5.8 + 5 : 0;
  // Title, declaration (more lines on a narrow page), heir and witnesses with CNIC boxes.
  const fixedH = (landscape: boolean) => 10 + (landscape ? 22 : 30) + 50;
  const fit = (landscape: boolean) => {
    const W = landscape ? 279 : 192, H = (landscape ? 192 : 279) - fixedH(landscape);
    const side = Math.min(1.2, (W - tableW - 4) / treeW, H / treeH); // table at the side
    const below = Math.min(1.2, W / treeW, (H - tableH - 4) / treeH); // table under the tree
    const useSide = !hasTable || side >= below * 0.85;
    const scale = Math.max(0.1, useSide ? side : below);
    // Truly centred on the page when there is room for an equal margin on the other side too.
    const centred = !hasTable || treeW * scale + 2 * (tableW + 4) <= W;
    return { landscape, side: useSide, centred, scale, tableW };
  };
  const o = orientationOf(c);
  const p = fit(false), l = fit(true);
  const plan = o === 'portrait' ? p : o === 'landscape' ? l : l.scale > p.scale * 1.1 ? l : p;
  return { ...plan, w: treeW * plan.scale, h: treeH * plan.scale };
}

/** What is printed / turned into the PDF: title, the chart centred under it, a small Urdu share
 *  table at the side (or below when the tree is wide), and the heir's statement with two witnesses. */
function PrintSheet({ c, result: computed, results }: { c: Case; result: ComputeResult | null; results: Map<string, ShareResult> }) {
  const result = printTableOf(c) ? computed : null; // the share table can be left off the paper
  const rows = (result?.shares ?? []).filter((s) => s.fraction.n > 0n || s.status === 'reserved');
  const plan = sheetPlan(c, !!result, rows.length);
  const nm = (id: string) => c.persons.find((p) => p.id === id)?.name || (id === '__unborn__' ? 'حمل' : id);
  return (
    // Margin 0 on the page (no browser date / title / address lines); the 9 mm margin is inside the
    // sheet, which is exactly one A4 page, so nothing spills onto a second page.
    <div className="print-sheet" lang="ur" style={{ width: plan.landscape ? '297mm' : '210mm', height: plan.landscape ? '209.5mm' : '296.5mm' }}>
      <style>{`@page { size: A4 ${plan.landscape ? 'landscape' : 'portrait'}; margin: 0; }`}</style>
      <ShajraTitle c={c} />
      <div className={`print-body ${plan.side ? 'side' : 'below'}`} style={plan.side && result ? { gridTemplateColumns: plan.centred ? `${plan.tableW}mm minmax(0,1fr) ${plan.tableW}mm` : `minmax(0,1fr) ${plan.tableW}mm` } : undefined}
        data-cols={plan.side && result ? (plan.centred ? 3 : 2) : 1}>
      <div className="print-tree"><Tree c={c} results={results} selected={null} onSelect={() => {}} printMode printSize={{ w: plan.w, h: plan.h }} /></div>
      {result && (
        <div className="print-share-wrap">
          <table className="print-share urdu" dir="rtl">
            <thead><tr><th>نمبر</th><th>نام وارث</th><th>رشتہ</th><th>حصہ</th><th>سہام / {String(result.base)}</th>{c.estate.immovable.map((p, i) => <th key={i}>رقبہ{c.estate.immovable.length > 1 ? ` ${p.title}` : ''}{p.area.unit === 'gkanal' ? ' (ک-م-ف)' : ''}</th>)}</tr></thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.personId}>
                  <td>{i + 1}</td><td>{nm(s.personId)}</td><td>{relLabel(s.relationKey)[1] || relLabel(s.relationKey)[0]}</td>
                  <td dir="ltr">{toString(s.fraction)}</td><td dir="ltr">{String(s.sihaam)}</td>
                  {c.estate.immovable.map((p, k) => {
                    const whole = s.areaSqftRounded?.[k];
                    if (p.area.unit === 'gkanal' && whole != null) return <td key={k} dir="ltr">{heirLandText(s, p.area.unit, k)}</td>;
                    return <td key={k}>{whole != null ? feetTextUr(whole, p.area.unit) : s.area?.[k] ? areaTextUr(s.area[k].value, p.area.unit) : ''}</td>;
                  })}
                </tr>
              ))}
              <tr className="total"><td colSpan={3}>میزان</td><td dir="ltr">1</td><td dir="ltr">{String(result.base)}</td>{c.estate.immovable.map((p, i) => {
                const t = p.area.value.n * 5440n;
                return <td key={i} dir={p.area.unit === 'gkanal' ? 'ltr' : undefined}>{p.area.unit === 'gkanal' && t % p.area.value.d === 0n ? kmfText(t / p.area.value.d) : areaTextUr(p.area.value, p.area.unit)}</td>;
              })}</tr>
            </tbody>
          </table>
          {c.estate.immovable.some((p) => p.area.unit === 'gkanal') && <p className="print-kmf-note">رقبہ: کنال-مرلہ-فٹ</p>}
        </div>
      )}
      </div>
      <AttestPrint c={c} />
      <p className="print-footer" dir="ltr">Created and downloaded from {SITE_HOST}/tools/shajra-nasab/</p>
    </div>
  );
}
/** Manual override of the share table (Hindu guided mode): person id -> fraction text. */
type WithOverride = Case & { manualShares?: Record<string, string> };
import { addRelative, fromJSON, load, newCase, removePerson, save, setParentOf, toJSON, updatePerson, type AddKind } from './model.ts';
import { DISCLAIMER, DISCLAIMER_UR, relLabel, ruleText as ruleTextL, type Lang } from './labels.ts';
import Estate, { areaText, areaTextUr, feetText, feetTextUr, heirLandText, kmfText, systemFor } from './Estate.tsx';
import SideShares from './SideShares.tsx';
import PersonBar from './PersonBar.tsx';
import { AttestForm, AttestPrint, orientationOf, printTableOf, type Orientation, type WithPrint } from './Attest.tsx';
import { layout, type WithLayout } from './layout.ts';
import qrcode from 'qrcode-generator';
import { SITE } from '../../site';

const API = `${SITE.dashboardUrl}/api/public/shajra`;

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); }, [text]);
  return <div className="h-20 w-20" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Hindu rules stay hidden until legal review: open the tool with ?beta=hindu to try them.
const HINDU_BETA = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('beta') === 'hindu';

const LAWS: { value: LawSystem; label: string; ready: boolean }[] = [
  { value: 'sunni-hanafi', label: 'Muslim: Sunni (Hanafi)', ready: true },
  { value: 'sunni-shafii', label: "Muslim: Sunni (Shafi'i)", ready: true },
  { value: 'sunni-maliki', label: 'Muslim: Sunni (Maliki)', ready: true },
  { value: 'sunni-hanbali', label: 'Muslim: Sunni (Hanbali)', ready: true },
  { value: 'shia-ithna', label: 'Muslim: Shia (Ithna Ashari)', ready: true },
  { value: 'christian', label: 'Christian (Succession Act 1925, Part V)', ready: true },
  { value: 'parsi', label: 'Parsi (Succession Act 1925, Ch. III): verify', ready: true },
  { value: 'other', label: 'Other / unknown (Succession Act 1925, Part V)', ready: true },
  { value: 'hindu-mitakshara-benares', label: 'Hindu / Sikh: Mitakshara, Benares (beta)', ready: HINDU_BETA },
  { value: 'hindu-mitakshara-bombay', label: 'Hindu / Sikh: Mitakshara, Bombay (beta)', ready: HINDU_BETA },
];

const input = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none';
const btn = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50';

export default function ShajraApp() {
  const [rootC, setRootC] = useState<Root>(() => newCase());
  const [activeId, setActiveId] = useState<string | null>(null); // null = main case
  const subs = rootC.subcases ?? [];
  const c: Case = (activeId && subs.find((x) => x.id === activeId)) || rootC;
  /** The whole saved case with the open estate replaced by `n`. */
  const nextRoot = (n: Case): Root => (activeId && subs.some((x) => x.id === activeId)
    ? { ...rootC, subcases: subs.map((x) => (x.id === activeId ? n : x)) }
    : { ...(n as Root), subcases: subs });
  const setC = (n: Case) => setRootC(nextRoot(n));
  // Print / Download PDF first ask whether the share table goes on the paper.
  const [askTable, setAskTable] = useState<'print' | 'pdf' | null>(null);
  const [selected, setSelected] = useState<string | null>('D');
  const [lang, setLang] = useState<Lang>('en');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const ruleText = (id: string) => ruleTextL(id, lang);
  const [editShares, setEditShares] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const pdfMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('pdf') === '1';

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('case');
    if (id) {
      fetch(`${API}/cases/${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? 'This shared link has expired.' : 'Could not open the shared case.'))))
        .then((t) => { setRootC(fromJSON(t)); setShareUrl(`${SITE.url}/tools/shajra-nasab/?case=${id}`); })
        .catch((e) => { setMsg(e.message); const s = load(); if (s) setRootC(s); })
        .finally(() => setLoaded(true));
    } else {
      const s = load(); if (s) setRootC(s); setLoaded(true);
      // Arrived from the share calculator with the family already drawn.
      if (new URLSearchParams(window.location.search).get('from') === 'calculator') {
        setMsg('Drawn from the share calculator. Tap anyone to type the real name, CNIC or dates; tap the deceased first.');
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);
  useEffect(() => { if (loaded && !pdfMode) save(rootC); }, [rootC, loaded, pdfMode]);

  const post = async (path: string, root: Root = rootC) => fetch(`${API}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ case: toJSON(root) }) });
  const saveLink = async () => {
    setBusy('link'); setMsg(null);
    try {
      const r = await post('cases');
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || 'Could not save.');
      setShareUrl(j.shareUrl);
      try { await navigator.clipboard.writeText(j.shareUrl); setMsg('Link copied. It works for 30 days.'); } catch { setMsg('Link ready. It works for 30 days.'); }
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };
  const downloadPdf = async (root: Root = rootC) => {
    setBusy('pdf'); setMsg(null);
    try {
      const r = await post('pdf', root);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || 'Could not create the PDF.');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `shajra-${c.id}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
      const id = r.headers.get('X-Shajra-Case');
      if (id) setShareUrl(`${SITE.url}/tools/shajra-nasab/?case=${id}`);
    } catch (e) { setMsg(`${(e as Error).message} You can also use Print / Save PDF.`); } finally { setBusy(null); }
  };

  /** Yes / No from the share-table question, then print or make the PDF. */
  const printWith = (includeTable: boolean) => {
    const kind = askTable;
    setAskTable(null);
    const root = nextRoot({ ...structuredClone(c), print: { ...(c as WithPrint).print, shareTable: includeTable } } as WithPrint);
    setRootC(root);
    if (kind === 'print') setTimeout(() => window.print(), 120); // after the sheet re-renders
    else if (kind === 'pdf') downloadPdf(root);
  };

  const { result, error } = useMemo((): { result: ComputeResult | null; error: string | null } => {
    try { return { result: compute(c), error: null }; } catch (e) { return { result: null, error: (e as Error).message }; }
  }, [c]);
  const combined = useMemo(() => {
    if (!subs.length) return null;
    try {
      const linksFor = (caseId: string): ChainLink[] => subs.filter((x) => x.parentCaseId === caseId && x.parentHeirId).map((x) => ({ heirId: x.parentHeirId!, result: compute(x), links: linksFor(x.id) }));
      return combine(compute(rootC), linksFor(rootC.id));
    } catch (e) { return { error: (e as Error).message }; }
  }, [rootC]);
  const allPersons = useMemo(() => new Map([rootC, ...subs].flatMap((x) => x.persons).map((p) => [p.id, p] as [string, Person])), [rootC]);
  const distributeOnward = (heirId: string) => {
    const heir = c.persons.find((p) => p.id === heirId)!;
    const existing = subs.find((x) => x.parentCaseId === c.id && x.parentHeirId === heirId);
    if (existing) { setActiveId(existing.id); setSelected(heirId); return; }
    const sc: Case = { ...structuredClone(c), id: `${c.id}-${subs.length + 1}`, deceasedId: heirId, dateOfDeath: heir.dateOfDeath!, parentCaseId: c.id, parentHeirId: heirId,
      estate: { immovable: [], debts: { n: 0n, d: 1n }, funeral: { n: 0n, d: 1n }, dower: { n: 0n, d: 1n }, wills: [] } };
    delete (sc as Root).subcases;
    setRootC({ ...rootC, subcases: [...subs, sc] });
    setActiveId(sc.id);
    setSelected(heirId);
  };
  const svgExport = () => {
    const el = document.querySelector('svg.shajra-tree');
    if (!el) return;
    const src = `<?xml version="1.0" encoding="UTF-8"?>\n${el.outerHTML.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
    a.download = `shajra-${c.id}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const byId = useMemo(() => new Map((result?.shares ?? []).map((s) => [s.personId, s] as [string, ShareResult])), [result]);
  const deceased = c.persons.find((p) => p.id === c.deceasedId)!;
  const sel = c.persons.find((p) => p.id === selected) ?? null;

  const setPlace = (pt: Partial<Place>) => setC({ ...structuredClone(c), place: { ...place(c), ...pt } } as Case);
  // A new relative opens its own quick bar with the name ready to type.
  const add = (kind: AddKind) => { if (!sel) return; const [n, id] = addRelative(c, sel.id, kind); setC(n); setSelected(id); setMenuFor(id); setAddOpen(false); };
  /** Gender; for the deceased the spouses flip too (a man has wives, a woman a husband). */
  const setGender = (id: string, g: 'M' | 'F') => {
    let n = updatePerson(c, id, { gender: g });
    if (id === c.deceasedId) for (const u of n.unions.filter((u) => u.partners.includes(id))) n = updatePerson(n, u.partners.find((x) => x !== id)!, { gender: g === 'M' ? 'F' : 'M' });
    setC(n);
  };
  const patch = (id: string, p: Partial<Person>) => setC(updatePerson(c, id, p));
  /** Swaps a person with the neighbour on the left (-1) or right (+1) in the same row; the order is saved. */
  const move = (id: string, dir: -1 | 1) => {
    const { nodes } = layout(c);
    const me = nodes.get(id);
    if (!me) return;
    const row = [...nodes.values()].filter((n) => n.gen === me.gen).sort((a, b) => a.x - b.x).map((n) => n.id);
    const i = row.indexOf(id), j = i + dir;
    if (j < 0 || j >= row.length) return;
    [row[i], row[j]] = [row[j], row[i]];
    const rank = { ...((c as WithLayout).layoutRank ?? {}) };
    row.forEach((x, k) => { rank[x] = k; });
    setC({ ...structuredClone(c), layoutRank: rank } as WithLayout);
  };

  const exportJson = () => {
    const blob = new Blob([toJSON(rootC)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shajra-${c.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (f: File) => { try { setRootC(fromJSON(await f.text())); setActiveId(null); setSelected('D'); } catch { alert('This file is not a Shajra Nasab case.'); } };

  // Manual override (Hindu guided mode): valid only when the entered shares add up to exactly 1.
  const manual = (c as WithOverride).manualShares;
  const canOverride = c.lawSystem.startsWith('hindu');
  const overrideState = useMemo(() => {
    if (!canOverride || !manual || !Object.keys(manual).length) return null;
    try {
      const f = Object.fromEntries(Object.entries(manual).filter(([, v]) => v.trim()).map(([k, v]) => [k, parse(v)]));
      const total = sum(Object.values(f));
      return { f, total, valid: eq(total, ONE) };
    } catch { return { f: {}, total: ZERO, valid: false }; }
  }, [manual, canOverride]);
  const setManual = (id: string, v: string) => setC({ ...structuredClone(c), manualShares: { ...(manual ?? {}), [id]: v } } as WithOverride);
  const shownFraction = (s: ShareResult) => (overrideState?.valid && s.personId in overrideState.f ? overrideState.f[s.personId] : overrideState?.valid ? ZERO : s.fraction);

  const heirs = (result?.shares ?? []).filter((s) => s.status !== 'excluded' || s.reasons.some((r) => r.ruleId.startsWith('mflo')));
  const excluded = (result?.shares ?? []).filter((s) => s.status === 'excluded' && s.relationKey !== 'unrelated' && !s.reasons.some((r) => r.ruleId.startsWith('mflo')));
  const name = (id: string) => c.persons.find((p) => p.id === id)?.name || (id === '__unborn__' ? 'Unborn child' : id);

  return (
    <div className="shajra rounded-2xl bg-white text-slate-900 shadow-2xl" data-shajra-ready={loaded && (result || error) ? '1' : '0'}>
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 p-3">
        {/* Case: new, save / open a file, share */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Case">
          <button className={btn} onClick={() => { if (confirm('Start a new case? The current one will be cleared.')) { setRootC(newCase()); setActiveId(null); setSelected('D'); } }}>New case</button>
          <button className={btn} onClick={exportJson}>Export JSON</button>
          <button className={btn} onClick={() => fileRef.current?.click()}>Import JSON</button>
          <button className={btn} onClick={svgExport}>Export SVG</button>
          <button className={btn} onClick={saveLink} disabled={!!busy}>{busy === 'link' ? 'Saving…' : 'Save & get link'}</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>
        {/* Print: page settings next to the print buttons */}
        <div className="flex flex-wrap items-center gap-1.5 sm:border-l sm:border-slate-200 sm:pl-3" role="group" aria-label="Print">
<label className="flex items-center gap-1 text-xs font-semibold text-slate-600">Page
          <select className="rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-xs text-slate-800" value={orientationOf(c)}
            onChange={(e) => setC({ ...structuredClone(c), print: { ...(c as WithPrint).print, orientation: e.target.value as Orientation } } as WithPrint)}>
            <option value="auto">Auto</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option>
          </select>
        </label>
          <button className={`${btn} !border-sky-700 !bg-sky-700 !text-white`} onClick={() => setAskTable('print')}>Print / Save PDF</button>
          <button className={btn} onClick={() => setAskTable('pdf')} disabled={!!busy}>{busy === 'pdf' ? 'Creating PDF…' : 'Download PDF'}</button>
        </div>
        <span className="ml-auto text-[11px] text-slate-500">Case {c.id} · saved in this browser only</span>
      </div>

      {askTable && (
        <div className="no-print fixed inset-0 z-[3000] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="ask-table-title"
          onClick={() => setAskTable(null)} onKeyDown={(e) => { if (e.key === 'Escape') setAskTable(null); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 text-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 id="ask-table-title" className="text-base font-bold">Print the share table too?</h2>
            <p className="urdu mt-1 text-right text-slate-600" lang="ur" dir="rtl">کیا حصص کا جدول بھی ساتھ پرنٹ کیا جائے؟</p>
            <p className="mt-1 text-xs text-slate-500">{askTable === 'pdf' ? 'For the downloaded PDF.' : 'For this print or saved PDF.'} The shajra nasab and the heir / witness statement are always included.</p>
            <div className="mt-3 flex gap-2">
              <button autoFocus className={`${btn} flex-1 !border-sky-700 !bg-sky-700 !py-2 !text-sm !text-white`} onClick={() => printWith(true)}>Yes <span className="urdu font-normal" lang="ur">ہاں</span></button>
              <button className={`${btn} flex-1 !py-2 !text-sm`} onClick={() => printWith(false)}>No <span className="urdu font-normal" lang="ur">نہیں</span></button>
            </div>
            <button className="mt-2 w-full text-xs text-slate-500 underline" onClick={() => setAskTable(null)}>Cancel</button>
          </div>
        </div>
      )}
      {subs.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <span className="font-semibold text-slate-600">Estates (munasakha):</span>
          {[rootC, ...subs].map((x) => {
            const d = x.persons.find((p) => p.id === x.deceasedId);
            const on = (x.id === rootC.id && !activeId) || x.id === activeId;
            return (
              <button key={x.id} className={`${btn} ${on ? '!border-sky-700 !bg-sky-700 !text-white' : ''}`} onClick={() => { setActiveId(x.id === rootC.id ? null : x.id); setSelected(x.deceasedId); }}>
                {x.id === rootC.id ? 'Main' : 'Onward'}: {d?.name || 'deceased'} ({x.dateOfDeath})
              </button>
            );
          })}
          {activeId && <button className={`${btn} !border-red-300 !text-red-700`} onClick={() => { if (confirm('Remove this onward estate (and any below it)?')) { const drop = new Set([activeId]); let grew = true; while (grew) { grew = false; for (const x of subs) if (x.parentCaseId && drop.has(x.parentCaseId) && !drop.has(x.id)) { drop.add(x.id); grew = true; } } setRootC({ ...rootC, subcases: subs.filter((x) => !drop.has(x.id)) }); setActiveId(null); } }}>Remove this estate</button>}
        </div>
      )}
      {(msg || shareUrl) && (
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          {msg && <span>{msg}</span>}
          {shareUrl && <a className="font-semibold underline" href={shareUrl}>{shareUrl}</a>}
        </div>
      )}
      {/* Step 1: deceased and law */}
      <section className="no-print grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[0.8fr_1.6fr]">
        {/* Place: mouza and tehsil (printed in the heading) */}
        <fieldset className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 grid content-start grid-cols-2 gap-2">
          <legend className="px-1 text-xs font-bold text-slate-800">Place <span className="urdu font-normal text-slate-500" lang="ur">مقام</span></legend>
          <label className="text-xs font-semibold text-slate-600">Mouza (موضع)
          <input className={input} value={place(c).mauza} onChange={(e) => setPlace({ mauza: e.target.value })} />
        </label>
          <label className="text-xs font-semibold text-slate-600">Tehsil (تحصیل)
          <input className={input} value={place(c).tehsil} onChange={(e) => setPlace({ tehsil: e.target.value })} />
        </label>
        </fieldset>
        {/* Law and how the shares are worked out */}
        <fieldset className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 grid content-start gap-2">
          <legend className="px-1 text-xs font-bold text-slate-800">Law and options <span className="urdu font-normal text-slate-500" lang="ur">قانون</span></legend>
          <label className="text-xs font-semibold text-slate-600">Law (religion of the deceased)
          <select className={input} value={c.lawSystem} onChange={(e) => setC({ ...structuredClone(c), lawSystem: e.target.value as LawSystem })}>
            {LAWS.map((l) => <option key={l.value} value={l.value} disabled={!l.ready}>{l.label}</option>)}
          </select>
        </label>
          {c.lawSystem.startsWith('hindu') && (
          <label className="text-xs font-semibold text-slate-600">Property type (Hindu)
            <select className={input} value={c.policy.hinduProperty ?? 'separate'} onChange={(e) => setC({ ...structuredClone(c), policy: { ...c.policy, hinduProperty: e.target.value as 'separate' | 'coparcenary' } })}>
              <option value="separate">Separate / self-acquired property</option><option value="coparcenary">Coparcenary (joint family) interest</option>
            </select>
            <span className="mt-1 block rounded bg-amber-50 p-1 text-amber-800">Custom may apply. Beta: verify every result; you may override the table manually.</span>
          </label>
        )}
        {c.lawSystem === 'shia-ithna' && (
          <label className="text-xs font-semibold text-slate-600">Childless widow and land
            <select className={input} value={c.policy.shiaChildlessWidowLandRule} onChange={(e) => setC({ ...structuredClone(c), policy: { ...c.policy, shiaChildlessWidowLandRule: e.target.value as 'classical' | 'equal' } })}>
              <option value="classical">Classical: no share in the land itself (share in buildings / trees value)</option><option value="equal">Equal: share in land too</option>
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={c.policy.applyMFLOs4} onChange={(e) => setC({ ...structuredClone(c), policy: { ...c.policy, applyMFLOs4: e.target.checked } })} />
          Apply MFLO 1961 s.4 (children of a predeceased son / daughter)
        </label>
        {c.policy.applyMFLOs4 && ['sunni-hanafi', 'sunni-shafii', 'sunni-maliki', 'sunni-hanbali', 'shia-ithna'].includes(c.lawSystem) && (
          <label className="text-xs font-semibold text-slate-600">s.4 when the predeceased child left only daughters
            <select className={input} value={c.policy.mfloS4OnlyDaughters ?? 'daughters-share'} onChange={(e) => setC({ ...structuredClone(c), policy: { ...c.policy, mfloS4OnlyDaughters: e.target.value as 'daughters-share' | 'whole' } })}>
              <option value="daughters-share">Daughters take 1/2 (one) or 2/3 (two or more) of the parent's share; the rest to the parent's brothers / sisters or next heirs</option>
              <option value="whole">Daughters take the parent's whole share</option>
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={c.policy.raddToSpouseWhenNoOtherHeir} onChange={(e) => setC({ ...structuredClone(c), policy: { ...c.policy, raddToSpouseWhenNoOtherHeir: e.target.checked } })} />
          Sole spouse takes the surplus (Pakistani practice)
        </label>
        </fieldset>
      </section>

      <Estate c={c} setC={setC} />

      {/* Print / PDF: title, chart and a compact Urdu share table only */}
      <PrintSheet c={c} result={result} results={byId} />

      {/* Step 2: family tree + editor */}
      <div id="shajra-print" className="grid gap-0 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 border-slate-200 p-3 lg:border-r">
          <div className={`print-only mb-2 ${pdfMode ? '' : 'hidden'} flex items-start justify-between gap-3`}>
            <div>
              <h2 className="text-lg font-bold">Shajra Nasab: {deceased.name || 'Deceased'}{deceasedFatherName(c) ? ` ${deceased.gender === 'F' ? 'd/o' : 's/o'} ${deceasedFatherName(c)}` : ''}</h2>
              <p className="text-xs">Date of death {c.dateOfDeath} · Law: {LAWS.find((l) => l.value === c.lawSystem)?.label} · Case {c.id} · Policy {c.policy.policyVersion}</p>
              {shareUrl && <p className="text-[10px] text-slate-500">{shareUrl}</p>}
            </div>
            {shareUrl && <Qr text={shareUrl} />}
          </div>
          <ShajraTitle c={c} />
          <p className="no-print mb-2 text-xs text-slate-500">Tap a person to type their details right there. Start with the deceased (متوفی): name, father's name and date of death.</p>
          <div className="overflow-auto rounded-xl border border-slate-200 bg-slate-50" style={{ maxHeight: '81vh' }}>
            <Tree c={c} results={byId} selected={selected} onSelect={(id) => { setSelected(id); setMenuFor(id); setAddOpen(false); }}
              menu={menuFor && sel && sel.id === menuFor ? (
                <PersonBar c={c} p={sel} share={byId.get(sel.id)} addOpen={addOpen} setAddOpen={setAddOpen}
                  onPatch={(x) => patch(sel.id, x)} onGender={(g) => setGender(sel.id, g)}
                  onParent={(role, id) => setC(setParentOf(c, sel.id, role, id))}
                  onAdd={(k) => add(k)}
                  onDelete={() => { if (confirm(`Delete ${sel.name || 'this person'} from the tree?`)) { setC(removePerson(c, sel.id)); setSelected('D'); setMenuFor(null); } }}
                  onMove={(d) => move(sel.id, d)}
                  onClose={() => setMenuFor(null)} />
              ) : null} />
          </div>
          <div className="mt-2"><Legend /></div>
        </div>

        {/* Hint and the share table */}
        <aside id="shajra-editor" className="no-print flex flex-col gap-3 border-t border-slate-200 p-3 lg:border-t-0">
          <p className="text-xs text-slate-600"><b className="text-slate-800">Tap a person</b> on the shajra to type the name, CNIC and dates right there, and to add relatives. Enter or Esc closes it.</p>
          <SideShares c={c} setC={setC} result={result} name={name}
            onward={(id) => { const p = c.persons.find((x) => x.id === id); return !!p && !p.alive && !!p.dateOfDeath && p.dateOfDeath > c.dateOfDeath; }}
            onOnward={distributeOnward} />
        </aside>
      </div>

      <AttestForm c={c} setC={setC} />

      {/* Step 3: results */}
      <section className="border-t border-slate-200 p-4" id="shajra-results">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{canOverride ? <>Shares <span className="urdu font-normal" lang="ur">(حصص)</span></> : <>How the shares are worked out <span className="urdu font-normal" lang="ur">(تفصیل)</span></>}</h2>
          <div className="no-print ml-auto flex items-center gap-1" role="group" aria-label="Language of the notes">
            <button className={`${btn} ${lang === 'en' ? '!bg-slate-800 !text-white' : ''}`} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
            <button className={`${btn} urdu ${lang === 'ur' ? '!bg-slate-800 !text-white' : ''}`} aria-pressed={lang === 'ur'} onClick={() => setLang('ur')} lang="ur">اردو</button>
          </div>
          {canOverride && (
            <button className={`${btn} no-print`} aria-pressed={editShares} onClick={() => setEditShares((v) => !v)}>{editShares ? 'Done editing' : 'Edit shares manually'}</button>
          )}
        </div>
        {canOverride && overrideState && (
          <p className={`mt-2 rounded-lg p-2 text-sm ${overrideState.valid ? 'bg-sky-50 text-sky-900' : 'bg-red-50 text-red-800'}`} role="status">
            {overrideState.valid ? `${ruleText('manual.override')} ` : `Manual shares add up to ${toString(overrideState.total)}, not 1: the computed shares are shown until they do. `}
            <button className="underline" onClick={() => setC({ ...structuredClone(c), manualShares: {} } as WithOverride)}>Clear manual shares</button>
          </p>
        )}
        {error && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
        {result && (
          <>
            {result.needsVerification && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">Complex case (distant kindred or grandfather with siblings): verify with a lawyer.</p>}
            {/* The share table is the one beside the shajra; this full table only for manual shares (Hindu beta). */}
            {canOverride && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-800 text-left text-white">
                    <th className="p-2">Name <span className="urdu font-normal" lang="ur">نام</span></th><th className="p-2">Relation <span className="urdu font-normal" lang="ur">رشتہ</span></th><th className="p-2">CNIC</th>
                    <th className="p-2 text-right">Share</th><th className="p-2 text-right">Sihaam / {String(result.base)}</th><th className="p-2 text-right">%</th>
                    {c.estate.immovable.map((p, i) => <th key={i} className="p-2 text-right">{p.title}{p.mauza ? ` (${p.mauza})` : ''}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {heirs.map((s) => {
                    const [en, ur] = relLabel(s.relationKey);
                    const p = c.persons.find((x) => x.id === s.personId);
                    return (
                      <tr key={s.personId} className="border-b border-slate-200">
                        <td className="p-2 font-semibold">{name(s.personId)}{p && !p.alive && p.dateOfDeath && p.dateOfDeath > c.dateOfDeath && s.fraction.n > 0n && <button className="no-print ml-1 rounded border border-sky-300 px-1 text-[10px] font-semibold text-sky-700" onClick={() => distributeOnward(s.personId)} title="This heir died after the deceased: distribute their share to their own heirs">Distribute onward →</button>}{s.status === 'reserved' && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">reserved</span>}{s.status === 'substituted-s4' && <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-800">s.4</span>}</td>
                        <td className="p-2">{en} <span className="urdu text-slate-500" lang="ur">{ur}</span></td>
                        <td className="p-2 text-slate-500">{p?.cnic ?? ''}</td>
                        <td className="p-2 text-right font-mono">
                          {editShares && canOverride && s.personId !== '__unborn__'
                            ? <input aria-label={`Manual share for ${name(s.personId)}`} className="w-20 rounded border border-slate-300 px-1 text-right" placeholder={toString(s.fraction)} value={manual?.[s.personId] ?? ''} onChange={(e) => setManual(s.personId, e.target.value)} />
                            : <>{toString(shownFraction(s))}{overrideState?.valid && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">manual</span>}</>}
                        </td>
                        <td className="p-2 text-right font-mono">{overrideState?.valid ? "—" : String(s.sihaam)}</td>
                        <td className="p-2 text-right font-mono">{overrideState?.valid ? percent(shownFraction(s)) : s.percent}</td>
                        {c.estate.immovable.map((p, i) => {
                          const whole = s.areaSqftRounded?.[i];
                          const feet = systemFor(p.area.unit).units.includes('sqft') && whole != null;
                          return <td key={i} className="p-2 text-right text-xs">{feet ? (whole ? feetText(whole, p.area.unit) : '—') : s.area?.[i] && s.area[i].value.n ? areaText(s.area[i].value, p.area.unit) : '—'}</td>;
                        })}
                      </tr>
                    );
                  })}
                  {result.reserved.n > 0n && <tr className="border-b border-slate-200 bg-amber-50"><td className="p-2" colSpan={3}>Reserved (pregnancy / missing heir)</td><td className="p-2 text-right font-mono">{toString(result.reserved)}</td><td /><td /></tr>}
                  {result.escheat.n > 0n && <tr className="border-b border-slate-200"><td className="p-2" colSpan={3}>Government (no heir)</td><td className="p-2 text-right font-mono">{toString(result.escheat)}</td><td /><td /></tr>}
                  <tr className="bg-slate-100 font-bold"><td className="p-2" colSpan={3}>Total</td><td className="p-2 text-right font-mono">1</td><td className="p-2 text-right font-mono">{String(result.base)}</td><td className="p-2 text-right font-mono">100.0000</td>{c.estate.immovable.map((p, i) => <td key={i} className="p-2 text-right text-xs">{areaText(p.area.value, p.area.unit)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            )}

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
              <ol className={`mt-1 list-decimal text-sm text-slate-700 ${lang === 'ur' ? 'urdu space-y-2 pr-6 leading-[2.2]' : 'space-y-0.5 pl-5'}`} lang={lang === 'ur' ? 'ur' : undefined} dir={lang === 'ur' ? 'rtl' : undefined}>
                {heirs.filter((s) => s.reasons.length).map((s) => (
                  <li key={`n-${s.personId}`}><b>{name(s.personId)}:</b> {s.reasons.map((r) => ruleText(r.ruleId)).join(' ')} <span className="text-[11px] text-slate-500">[{s.reasons.map((r) => r.citationKey).join(', ')}]</span></li>
                ))}
                {result.notes.map((n, i) => <li key={`c-${i}`}>{ruleText(n.ruleId)}{n.params?.from && n.ruleId === 'sunni.aul' ? ` (${n.params.from} → ${n.params.to})` : ''} <span className="text-[11px] text-slate-500">[{n.citationKey}]</span></li>)}
              </ol>
              <p className="mt-2 text-[11px] text-slate-500">Law: {result.lawSystem} · policy {result.policyVersion} · MFLO s.4 {c.policy.applyMFLOs4 ? 'on' : 'off'} · radd to sole spouse {c.policy.raddToSpouseWhenNoOtherHeir ? 'on' : 'off'} · case {c.id}. Legal references are under review.</p>
            </div>
          </>
        )}
        {combined && (
          <div className="mt-6">
            <h3 className="text-base font-bold">Final shares of the original estate (munasakha) <span className="urdu font-normal text-slate-500" lang="ur">مناسخہ</span></h3>
            {'error' in combined ? <p className="text-sm text-red-700">{combined.error}</p> : (
              <table className="mt-2 w-full min-w-[480px] border-collapse text-sm">
                <thead><tr className="bg-slate-700 text-left text-white"><th className="p-2">Name</th><th className="p-2">Through</th><th className="p-2 text-right">Share</th><th className="p-2 text-right">%</th></tr></thead>
                <tbody>
                  {combined.shares.map((x) => (
                    <tr key={x.personId} className="border-b border-slate-200">
                      <td className="p-2 font-semibold">{allPersons.get(x.personId)?.name || x.personId}</td>
                      <td className="p-2 text-xs text-slate-500">{x.via.length ? x.via.map((v) => allPersons.get(v)?.name || v).join(' → ') : 'direct'}</td>
                      <td className="p-2 text-right font-mono">{toString(x.fraction)}</td>
                      <td className="p-2 text-right font-mono">{percent(x.fraction)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-2 text-sm font-semibold text-red-800">{DISCLAIMER} <span className="urdu font-normal" lang="ur" dir="rtl">{DISCLAIMER_UR}</span></p>
      </section>
    </div>
  );
}
