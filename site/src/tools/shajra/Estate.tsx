// Estate (optional): deductions, wills and immovable properties with area in local units.
import { frac, fromParts, parse, toMixed, formatMixed, toString, ZERO, type AreaUnit, type Case, type Fraction } from 'inheritance-engine';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none';
const btn = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50';

/** Whole rupees from a text field ("1,250,000" -> 1250000). */
const rupees = (s: string): Fraction => {
  const d = s.replace(/[^\d]/g, '');
  return d ? frac(BigInt(d)) : ZERO;
};
const showRs = (f: Fraction | undefined) => (f && f.n ? (f.n / f.d).toString() : '');
const int = (s: string): bigint => BigInt(s.replace(/[^\d]/g, '') || '0');

export const UNIT_SYSTEMS: { value: string; label: string; units: AreaUnit[] }[] = [
  { value: 'kmf', label: 'Kanal – Marla – Feet (1 marla = 272 sq ft)', units: ['gkanal', 'gmarla', 'sqft'] },
  { value: 'kms', label: 'Kanal – Marla – Sarsai (1 marla = 272.25 sq ft)', units: ['kanal', 'marla', 'sarsai'] },
  { value: 'akms', label: 'Acre – Kanal – Marla', units: ['acre', 'kanal', 'marla', 'sarsai'] },
  { value: 'mur', label: 'Murabba – Acre – Kanal', units: ['murabba', 'acre', 'kanal', 'marla'] },
  { value: 'sindh', label: 'Acre – Ghunta (Sindh)', units: ['acre', 'ghunta'] },
  { value: 'sqft', label: 'Square feet', units: ['sqft'] },
  { value: 'sqyd', label: 'Square yards', units: ['sqyd'] },
];
export const systemFor = (unit: string) => UNIT_SYSTEMS.find((s) => s.units[0] === unit) ?? UNIT_SYSTEMS[0];

/** Whole square feet shown in the property's units (Kanal – Marla – Feet for the government standard). */
export function feetText(sqft: bigint, unit: string) {
  const sys = systemFor(unit);
  const units = sys.units.includes('sqft') ? sys.units : (['gkanal', 'gmarla', 'sqft'] as AreaUnit[]);
  return formatMixed(toMixed(frac(sqft), 'sqft', units));
}

export function feetTextUr(sqft: bigint, unit: string) {
  const sys = systemFor(unit);
  const units = sys.units.includes('sqft') ? sys.units : (['gkanal', 'gmarla', 'sqft'] as AreaUnit[]);
  return formatMixed(toMixed(frac(sqft), 'sqft', units), 1);
}
export function areaTextUr(value: Fraction, unit: string) {
  return formatMixed(toMixed(value, unit as AreaUnit, systemFor(unit).units), 1);
}

export function areaText(value: Fraction, unit: string) {
  const sys = systemFor(unit);
  return formatMixed(toMixed(value, unit as AreaUnit, sys.units));
}

/** Compact patwari style "K-M-F" (government standard: 1 kanal = 20 marla, 1 marla = 272 sq ft). */
export function kmfText(sqft: bigint) {
  const k = sqft / 5440n, rest = sqft % 5440n;
  return `${k}-${rest / 272n}-${rest % 272n}`;
}

/** An heir's land in property k: compact K-M-F for the default units, otherwise the property's own units. */
export function heirLandText(s: { areaSqftRounded?: (bigint | null)[]; area?: { value: Fraction }[] }, unit: string, k: number) {
  const whole = s.areaSqftRounded?.[k];
  if (unit === 'gkanal' && whole != null) return whole ? kmfText(whole) : '—';
  if (systemFor(unit).units.includes('sqft') && whole != null) return whole ? feetText(whole, unit) : '—';
  const v = s.area?.[k]?.value;
  return v && v.n ? areaText(v, unit) : '—';
}

/** Quick "total land" entry for the first property (created as "Land" in Kanal – Marla – Feet). */
export function LandQuick({ c, setC }: { c: Case; setC: (c: Case) => void }) {
  const p = c.estate.immovable[0];
  const unit = p?.area.unit ?? 'gkanal';
  const sys = systemFor(unit);
  const m = toMixed(p?.area.value ?? ZERO, unit as AreaUnit, sys.units);
  const label = (u: string) => ({ gkanal: 'Kanal', gmarla: 'Marla', sqft: 'Feet', kanal: 'Kanal', marla: 'Marla', sarsai: 'Sarsai', acre: 'Acre', murabba: 'Murabba', ghunta: 'Ghunta', sqyd: 'Sq yd' } as Record<string, string>)[u] ?? u;
  const set = (u: AreaUnit, v: string) => {
    const parts: Partial<Record<AreaUnit, Fraction>> = {};
    for (const x of m.parts) parts[x.unit] = frac(x.whole);
    parts[u] = frac(int(v));
    const area = { unit: sys.units[0], value: fromParts(parts, sys.units[0]) };
    const rest = c.estate.immovable.slice(1);
    setC({ ...structuredClone(c), estate: { ...structuredClone(c.estate), immovable: [{ ...(p ?? { title: 'Land' }), area }, ...rest] } });
  };
  return (
    <div className="flex flex-wrap items-end gap-1.5">
      <span className="w-full text-[11px] font-semibold text-slate-600">Total land{p && p.title !== 'Land' ? ` (${p.title})` : ''} <span className="urdu font-normal" lang="ur">کل رقبہ</span></span>
      {m.parts.map((x) => (
        <label key={x.unit} className="w-[4.2rem] text-[10px] text-slate-500">{label(x.unit)}
          <input className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-right text-xs text-slate-900 focus:border-sky-500 focus:outline-none"
            inputMode="numeric" value={x.whole ? String(x.whole) : ''} placeholder="0" onChange={(e) => set(x.unit, e.target.value)} />
        </label>
      ))}
    </div>
  );
}

export default function Estate({ c, setC }: { c: Case; setC: (c: Case) => void }) {
  const e = c.estate;
  const upd = (patch: Partial<Case['estate']>) => setC({ ...structuredClone(c), estate: { ...structuredClone(e), ...patch } });
  const props = e.immovable;

  const setProp = (i: number, p: Partial<(typeof props)[number]>) => upd({ immovable: props.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const partsOf = (i: number) => {
    const p = props[i];
    const sys = systemFor(p.area.unit);
    const m = toMixed(p.area.value, p.area.unit as AreaUnit, sys.units);
    return { sys, m };
  };
  const setPart = (i: number, unit: AreaUnit, v: string) => {
    const { sys, m } = partsOf(i);
    const parts: Partial<Record<AreaUnit, Fraction>> = {};
    for (const x of m.parts) parts[x.unit] = frac(x.whole);
    parts[unit] = frac(int(v));
    setProp(i, { area: { unit: sys.units[0], value: fromParts(parts, sys.units[0]) } });
  };

  return (
    <details className="no-print border-b border-slate-200 p-4" open={props.length > 0 || e.wills.length > 0}>
      <summary className="cursor-pointer text-sm font-bold">Estate (optional): deductions, will, land</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([['movableValue', 'Value of the estate (Rs)'], ['funeral', 'Funeral expenses (Rs)'], ['debts', 'Debts (Rs)'], ['dower', 'Unpaid dower / haq mehr (Rs)']] as const).map(([k, label]) => (
          <label key={k} className="text-xs font-semibold text-slate-600">{label}
            <input className={input} inputMode="numeric" value={showRs(e[k])} onChange={(ev) => upd({ [k]: rupees(ev.target.value) } as Partial<Case['estate']>)} />
          </label>
        ))}
        <p className="self-end text-[11px] text-slate-500">Pension, family pension and benevolent fund are not part of the estate.</p>
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold">Will (wasiyyat)</h3>
          <button className={btn} onClick={() => upd({ wills: [...e.wills, { external: '', fraction: frac(1, 3) }] })}>+ Bequest</button>
        </div>
        {e.wills.map((w, i) => (
          <div key={i} className="mt-2 grid grid-cols-[1fr_120px_auto] items-end gap-2">
            <label className="text-xs text-slate-600">Beneficiary (not an heir)
              <input className={input} value={w.external ?? ''} onChange={(ev) => upd({ wills: e.wills.map((x, j) => (j === i ? { ...x, external: ev.target.value } : x)) })} />
            </label>
            <label className="text-xs text-slate-600">Share (e.g. 1/4)
              <input className={input} defaultValue={w.fraction ? toString(w.fraction) : ''} onBlur={(ev) => { try { upd({ wills: e.wills.map((x, j) => (j === i ? { ...x, fraction: parse(ev.target.value) } : x)) }); } catch { ev.target.value = w.fraction ? toString(w.fraction) : ''; } }} />
            </label>
            <button className={btn} onClick={() => upd({ wills: e.wills.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <p className="mt-1 text-[11px] text-slate-500">Muslim law: a will takes at most one third, and cannot favour an heir without the other heirs' consent.</p>
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold">Land and property</h3>
          <button className={btn} onClick={() => upd({ immovable: [...props, { title: `Property ${props.length + 1}`, area: { unit: 'gkanal', value: ZERO } }] })}>+ Property</button>
        </div>
        {props.map((p, i) => {
          const { sys, m } = partsOf(i);
          return (
            <div key={i} className="mt-2 rounded-xl border border-slate-200 p-2">
              <div className="grid gap-2 sm:grid-cols-4">
                <label className="text-xs text-slate-600">Title<input className={input} value={p.title} onChange={(ev) => setProp(i, { title: ev.target.value })} /></label>
                <label className="text-xs text-slate-600">Mouza<input className={input} value={p.mauza ?? ''} onChange={(ev) => setProp(i, { mauza: ev.target.value })} /></label>
                <label className="text-xs text-slate-600">Khewat / Khatooni<input className={input} value={p.khewat ?? ''} onChange={(ev) => setProp(i, { khewat: ev.target.value })} /></label>
                <label className="text-xs text-slate-600">Units
                  <select className={input} value={sys.value} onChange={(ev) => {
                    const ns = UNIT_SYSTEMS.find((s) => s.value === ev.target.value)!;
                    // keep the same area, expressed in the new first unit
                    setProp(i, { area: { unit: ns.units[0], value: fromParts({ [p.area.unit]: p.area.value } as Partial<Record<AreaUnit, Fraction>>, ns.units[0]) } });
                  }}>
                    {UNIT_SYSTEMS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                {m.parts.map((x) => (
                  <label key={x.unit} className="w-24 text-xs text-slate-600">{({ gkanal: 'Kanal', gmarla: 'Marla', sqft: 'Feet (sq ft)', sqyd: 'Sq yd' } as Record<string, string>)[x.unit] ?? x.unit[0].toUpperCase() + x.unit.slice(1)}
                    <input className={input} inputMode="numeric" value={x.whole ? String(x.whole) : ''} onChange={(ev) => setPart(i, x.unit, ev.target.value)} />
                  </label>
                ))}
                <span className="pb-2 text-xs text-slate-500">= {areaText(p.area.value, p.area.unit)}</span>
                <button className={`${btn} ml-auto`} onClick={() => upd({ immovable: props.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
