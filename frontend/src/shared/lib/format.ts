/** Display formatting (decision D6: dates dd-mm-yyyy, money Rs en-PK). Pure helpers. */
const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (v: any): Date | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** 23-10-2026 */
export const fmtDate = (v: any, fallback = '—') => {
  const d = toDate(v);
  return d ? `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}` : fallback;
};
/** 23-10-2026 14:05 */
export const fmtDateTime = (v: any, fallback = '—') => {
  const d = toDate(v);
  return d ? `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : fallback;
};
/** 14:05 */
export const fmtTime = (v: any, fallback = '—') => {
  const d = toDate(v);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : fallback;
};
/** 'YYYY-MM-DD' -> 'DD-MM-YYYY' without timezone shifts; passes through 'permanent' strings. */
export const ymdToDmy = (s: any) => {
  if (!s) return '';
  const str = String(s);
  if (/permanent/i.test(str)) return str;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : fmtDate(str, str);
};
export const fmtNumber = (n: any) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-PK') : '0');
/** Rs 1,000 */
export const rs = (n: any) => `Rs ${fmtNumber(Math.round(Number(n) || 0))}`;
/** Today's date in Pakistan time (GMT+5) as YYYY-MM-DD. */
export const todayPk = () => {
  const d = new Date(Date.now() + 5 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};
