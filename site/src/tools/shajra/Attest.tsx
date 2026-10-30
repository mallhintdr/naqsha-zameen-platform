// Heir's statement and two witnesses at the foot of the printed shajra, with CNIC and room for
// thumb impressions; plus the page orientation choice. Both are saved with the case.
import type { Case, Person } from 'inheritance-engine';
import { fatherOf } from './model.ts';

export type Link = 'walad' | 'dukhtar' | 'zoja';
export type Party = { name: string; fatherName: string; cnic: string; link?: Link };
export type Attest = { heir: Party; witnesses: [Party, Party] };
export type Orientation = 'auto' | 'portrait' | 'landscape';
export type WithPrint = Case & { attest?: Attest; print?: { orientation?: Orientation; shareTable?: boolean } };

const EMPTY: Party = { name: '', fatherName: '', cnic: '' };
export const attestOf = (c: Case): Attest => {
  const a = (c as WithPrint).attest;
  return { heir: { ...EMPTY, ...a?.heir }, witnesses: [{ ...EMPTY, ...a?.witnesses?.[0] }, { ...EMPTY, ...a?.witnesses?.[1] }] };
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
    ['گواہ نمبر 1', 'تصدیق کی کہ بیان وارث درست ہے۔', a.witnesses[0]],
    ['گواہ نمبر 2', 'تصدیق کی کہ بیان وارث درست ہے۔', a.witnesses[1]],
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

/** Entry form on the page (not printed). */
export function AttestForm({ c, setC }: { c: Case; setC: (c: Case) => void }) {
  const a = attestOf(c);
  const put = (n: Attest) => setC({ ...structuredClone(c), attest: n } as WithPrint);
  const setParty = (i: 0 | 1 | 2, p: Partial<Party>) => {
    const n = structuredClone(a);
    if (i === 0) n.heir = { ...n.heir, ...p }; else n.witnesses[i - 1] = { ...n.witnesses[i - 1], ...p };
    put(n);
  };
  const heirs = c.persons.filter((p) => p.alive && p.id !== c.deceasedId);
  const fromPerson = (p: Person): Party => ({
    name: p.name,
    fatherName: c.persons.find((x) => x.id === fatherOf(c, p.id))?.name || p.fatherName || '',
    cnic: p.cnic ?? '',
    link: p.gender === 'F' ? 'dukhtar' : 'walad',
  });
  const party = (i: 0 | 1 | 2, title: string, p: Party) => (
    <fieldset className="space-y-1.5 rounded-lg border border-slate-200 p-2">
      <legend className="px-1 text-xs font-semibold text-slate-700">{title}</legend>
      {i === 0 && heirs.length > 0 && (
        <select className={input} value="" aria-label="Fill from the family" onChange={(e) => { const p = heirs.find((x) => x.id === e.target.value); if (p) setParty(0, fromPerson(p)); }}>
          <option value="">Fill from the family…</option>
          {heirs.map((h) => <option key={h.id} value={h.id}>{h.name || h.id}</option>)}
        </select>
      )}
      <input className={input} placeholder="Name" value={p.name} onChange={(e) => setParty(i, { name: e.target.value })} />
      <div className="flex gap-1.5">
        <select className={`${input} !w-auto`} aria-label="Relation" value={p.link ?? 'walad'} onChange={(e) => setParty(i, { link: e.target.value as Link })}>
          <option value="walad">s/o ولد</option><option value="dukhtar">d/o دختر</option><option value="zoja">w/o زوجہ</option>
        </select>
        <input className={input} placeholder="Father's / husband's name" value={p.fatherName} onChange={(e) => setParty(i, { fatherName: e.target.value })} />
      </div>
      <input className={input} inputMode="numeric" placeholder="CNIC 12345-1234567-1" value={p.cnic} onChange={(e) => setParty(i, { cnic: formatCnic(e.target.value) })} />
    </fieldset>
  );
  return (
    <section className="no-print border-t border-slate-200 p-4">
      <h2 className="text-sm font-bold text-slate-800">Heir's statement and witnesses <span className="urdu font-normal text-slate-500" lang="ur">بیان وارث و گواہان</span></h2>
      <p className="mt-0.5 text-xs text-slate-500">Printed at the foot of the shajra with their declaration (in Urdu) that the statement and its verification are their sole responsibility, room for thumb impressions and the CNIC in digit boxes. Leave blank to fill in by hand.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {party(0, 'Heir (statement)', a.heir)}
        {party(1, 'Witness 1', a.witnesses[0])}
        {party(2, 'Witness 2', a.witnesses[1])}
      </div>
    </section>
  );
}
