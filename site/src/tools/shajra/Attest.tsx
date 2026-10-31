// Heir's statement and two witnesses at the foot of the printed shajra, with CNIC and room for
// thumb impressions; plus the page orientation choice. Both are saved with the case.
import type { Case, Person } from 'inheritance-engine';
import { fatherOf, updatePerson } from './model.ts';

export type Link = 'walad' | 'dukhtar' | 'zoja';
export type Party = { name: string; fatherName: string; cnic: string; link?: Link };
/** heirId: the declaring heir is a person on the tree (name, father's name and CNIC come from there). */
export type Attest = { heir: Party; heirId?: string; heirTyped?: boolean; witnesses: [Party, Party] };
export type Orientation = 'auto' | 'portrait' | 'landscape';
export type WithPrint = Case & { attest?: Attest; print?: { orientation?: Orientation; shareTable?: boolean } };

const EMPTY: Party = { name: '', fatherName: '', cnic: '' };
/** A person on the tree as a party: s/o or d/o the father on the tree; a widow (no father on the
 *  tree) as w/o the deceased. */
export const partyFromPerson = (c: Case, p: Person): Party => {
  const father = c.persons.find((x) => x.id === fatherOf(c, p.id))?.name || p.fatherName || '';
  const widow = !father && c.unions.some((u) => u.partners.includes(p.id) && u.partners.includes(c.deceasedId));
  const d = c.persons.find((x) => x.id === c.deceasedId);
  return widow
    ? { name: p.name, fatherName: d?.name ?? '', cnic: p.cnic ?? '', link: 'zoja' }
    : { name: p.name, fatherName: father, cnic: p.cnic ?? '', link: p.gender === 'F' ? 'dukhtar' : 'walad' };
};

export const attestOf = (c: Case): Attest => {
  const a = (c as WithPrint).attest;
  const hp = a?.heirId ? c.persons.find((x) => x.id === a.heirId) : undefined;
  return {
    heir: hp ? partyFromPerson(c, hp) : { ...EMPTY, ...a?.heir },
    heirId: hp ? hp.id : undefined,
    witnesses: [{ ...EMPTY, ...a?.witnesses?.[0] }, { ...EMPTY, ...a?.witnesses?.[1] }],
  };
};
export const orientationOf = (c: Case): Orientation => (c as WithPrint).print?.orientation ?? 'auto';
/** Whether the share table is printed with the shajra (yes unless switched off). */
export const printTableOf = (c: Case): boolean => (c as WithPrint).print?.shareTable !== false;

const LINK_UR: Record<Link, string> = { walad: 'ولد', dukhtar: 'دختر', zoja: 'زوجہ' };

/** 12345-1234567-1 as the digits are typed. */
export const formatCnic = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 13);
  return [d.slice(0, 5), d.slice(5, 12), d.slice(12)].filter(Boolean).join('-');
};

/** The heir's and witnesses' declaration printed above their thumb impressions: the statement and
 *  its verification are their responsibility alone, not the officials'. */
export const DECLARATION_UR =
  'ہم مسمیان وارث اور گواہان، جن کے نام، ولدیت اور شناختی کارڈ نمبر ذیل میں درج ہیں، ریونیو آفیسر کے روبرو حلفاً بیان کرتے ہیں کہ اوپر درج ' +
  'شجرہ نسب اور وارثان کی تفصیل ہمارے علم و یقین کے مطابق درست اور مکمل ہے؛ نہ کوئی وارث چھوڑا گیا ہے اور نہ کوئی حقیقت یا دستاویز چھپائی گئی ہے۔ ' +
  'اس شجرہ نسب کی تصدیق ہم بیان حلفی / اسٹامپ پیپر کی صورت میں بھی کرتے ہیں جو کہ لف ہیں۔ ' +
  'اس شجرہ نسب کا بیان اور اس کی تصدیق مکمل طور پر ہماری ذاتی ذمہ داری ہے۔ ' +
  'اگر کسی وارث، دستاویز یا حقیقت کا اخفا، غلط بیانی یا کوئی کمی ثابت ہو تو اس کی تمام تر فوجداری اور دیوانی ذمہ داری ہم پر ہو گی ' +
  'اور ہمارے خلاف قانون کے مطابق کارروائی عمل میں لائی جا سکے گی۔ ریونیو آفیسر یا دیگر متعلقہ سرکاری اہلکار اس کے کسی طور ذمہ دار نہ ہوں گے۔ ' +
  'یہ بیان ہم نے اپنی رضامندی سے، بغیر کسی دباؤ یا لالچ کے، پڑھ کر اور سمجھ کر دیا ہے اور اس پر اپنے انگوٹھے ثبت کیے ہیں۔';

/** CNIC as 13 boxes, one digit each, grouped 5-7-1. */
function CnicBoxes({ cnic }: { cnic: string }) {
  const d = cnic.replace(/\D/g, '').slice(0, 13).padEnd(13, ' ');
  const box = (i: number) => <span key={i} className="cnic-box">{d[i].trim()}</span>;
  return (
    <span className="cnic-boxes" dir="ltr">
      {[0, 1, 2, 3, 4].map(box)}<span className="cnic-dash">-</span>
      {[5, 6, 7, 8, 9, 10, 11].map(box)}<span className="cnic-dash">-</span>
      {box(12)}
    </span>
  );
}

/** Printed block: the declaration, then per person: role, room for the thumb impression,
 *  name / father's name and, right under it, the CNIC in boxes. */
export function AttestPrint({ c }: { c: Case }) {
  const a = attestOf(c);
  const blank = '________________';
  const cols: [string, string, Party][] = [
    ['یکے از وارثان', 'بیان کیا کہ شجرہ نسب و تفصیل وارثان بالا درست ہے۔', a.heir],
    ['گواہ نمبر 1', 'تصدیق کی کہ بیان وارث اور شجرہ نسب درست ہیں۔', a.witnesses[0]],
    ['گواہ نمبر 2', 'تصدیق کی کہ بیان وارث اور شجرہ نسب درست ہیں۔', a.witnesses[1]],
  ];
  return (
    <div className="print-attest-wrap">
      <p className="print-declaration urdu" dir="rtl">{DECLARATION_UR}</p>
      <table className="print-attest urdu" dir="rtl">
        <tbody>
          <tr>{cols.map(([role, note]) => <td key={role}><b>{role}</b><div className="att-note">{note}</div></td>)}</tr>
          <tr>{cols.map(([role]) => <td key={role}><div className="att-thumb">نشان انگوٹھا</div></td>)}</tr>
          <tr className="att-name">{cols.map(([role, , p]) => <td key={role}>نام: {p.name || blank} {LINK_UR[p.link ?? 'walad']} {p.fatherName || blank}</td>)}</tr>
          <tr className="att-cnic">{cols.map(([role, , p]) => <td key={role}><div className="att-cnic-label">شناختی کارڈ نمبر</div><CnicBoxes cnic={p.cnic} /></td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

const input = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-sky-500 focus:outline-none';

/** Entry form on the page (not printed): the declaring heir is picked from the family (their CNIC
 *  is the one on the tree); the two witnesses are typed. Folded away until needed. */
export function AttestForm({ c, setC }: { c: Case; setC: (c: Case) => void }) {
  const a = attestOf(c);
  const raw = (c as WithPrint).attest;
  const put = (n: Partial<Attest>) => setC({ ...structuredClone(c), attest: { ...a, ...raw, ...n } } as WithPrint);
  const setWitness = (i: 0 | 1, p: Partial<Party>) => {
    const w = structuredClone(a.witnesses);
    w[i] = { ...w[i], ...p };
    put({ witnesses: w });
  };
  const living = c.persons.filter((p) => p.alive && p.id !== c.deceasedId);
  const hp = a.heirId ? c.persons.find((x) => x.id === a.heirId) : undefined;
  // Typed heir (not on the tree); older saved cases with a typed name count as typed.
  const other = !a.heirId && (raw?.heirTyped ?? !!raw?.heir?.name);
  const setOther = (v: boolean) => put({ heirTyped: v, heirId: undefined, heir: v ? { ...EMPTY, ...raw?.heir } : EMPTY });
  const linkSel = (v: Link | undefined, on: (l: Link) => void) => (
    <select className={`${input} !w-auto`} aria-label="Relation" value={v ?? 'walad'} onChange={(e) => on(e.target.value as Link)}>
      <option value="walad">s/o</option><option value="dukhtar">d/o</option><option value="zoja">w/o</option>
    </select>
  );
  const filled = !!(a.heirId || other || a.witnesses.some((w) => w.name || w.cnic));
  return (
    <details className="no-print border-t border-slate-200 p-4" open={filled}>
      <summary className="cursor-pointer text-sm font-bold text-slate-800">Heir's statement and witnesses (printed at the foot) <span className="urdu font-normal text-slate-500" lang="ur">یکے از وارثان و گواہان</span></summary>
      <p className="mt-1 text-xs text-slate-500">Printed with their declaration in Urdu, room for thumb impressions and the CNIC in digit boxes. Leave blank to fill in by hand.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <fieldset className="space-y-1.5 rounded-lg border border-slate-200 p-2">
          <legend className="px-1 text-xs font-semibold text-slate-700">Heir making the statement</legend>
          <select className={input} aria-label="Heir making the statement" value={other ? '__other__' : a.heirId ?? ''}
            onChange={(e) => { const v = e.target.value; if (v === '__other__') setOther(true); else if (!v) setOther(false); else put({ heirId: v, heirTyped: false, heir: EMPTY }); }}>
            <option value="">Choose from the family…</option>
            {living.map((h) => <option key={h.id} value={h.id}>{h.name || h.id}</option>)}
            <option value="__other__">Someone else (type)</option>
          </select>
          {hp && (
            <>
              <p className="text-xs text-slate-600">{a.heir.name} {a.heir.link === 'zoja' ? 'w/o' : a.heir.link === 'dukhtar' ? 'd/o' : 's/o'} {a.heir.fatherName || '—'}</p>
              <input className={input} inputMode="numeric" aria-label="Heir's CNIC" placeholder="CNIC 12345-1234567-1" value={hp.cnic ?? ''}
                onChange={(e) => setC(updatePerson(c, hp.id, { cnic: formatCnic(e.target.value) }))} />
            </>
          )}
          {other && (
            <>
              <input className={input} placeholder="Name" value={a.heir.name} onChange={(e) => put({ heir: { ...a.heir, name: e.target.value } })} />
              <div className="flex gap-1.5">{linkSel(a.heir.link, (l) => put({ heir: { ...a.heir, link: l } }))}
                <input className={input} placeholder="Father's / husband's name" value={a.heir.fatherName} onChange={(e) => put({ heir: { ...a.heir, fatherName: e.target.value } })} /></div>
              <input className={input} inputMode="numeric" placeholder="CNIC 12345-1234567-1" value={a.heir.cnic} onChange={(e) => put({ heir: { ...a.heir, cnic: formatCnic(e.target.value) } })} />
            </>
          )}
        </fieldset>
        {([0, 1] as const).map((i) => (
          <fieldset key={i} className="space-y-1.5 rounded-lg border border-slate-200 p-2">
            <legend className="px-1 text-xs font-semibold text-slate-700">Witness {i + 1}</legend>
            <input className={input} placeholder="Name" value={a.witnesses[i].name} onChange={(e) => setWitness(i, { name: e.target.value })} />
            <div className="flex gap-1.5">{linkSel(a.witnesses[i].link, (l) => setWitness(i, { link: l }))}
              <input className={input} placeholder="Father's / husband's name" value={a.witnesses[i].fatherName} onChange={(e) => setWitness(i, { fatherName: e.target.value })} /></div>
            <input className={input} inputMode="numeric" placeholder="CNIC 12345-1234567-1" value={a.witnesses[i].cnic} onChange={(e) => setWitness(i, { cnic: formatCnic(e.target.value) })} />
          </fieldset>
        ))}
      </div>
    </details>
  );
}
