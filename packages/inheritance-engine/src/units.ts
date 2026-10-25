/**
 * Land units, exact. Everything converts through square feet as an exact Fraction.
 *   Punjab / KP: 1 acre = 8 kanal, 1 kanal = 20 marla, 1 marla = 9 sarsai (1 marla = 272.25 sq ft)
 *   Sindh: 1 acre = 40 ghunta.  Urban: sq ft, sq yd.  1 murabba (square) = 25 acres.
 *   Legacy money: 1 rupee = 16 anna, 1 anna = 12 pie.
 */
import { add, frac, mul, div, sub, ZERO, type Fraction } from './fraction.ts';

export type AreaUnit = 'murabba' | 'acre' | 'kanal' | 'marla' | 'sarsai' | 'ghunta' | 'sqft' | 'sqyd';

export const UNIT_SQFT: Record<AreaUnit, Fraction> = {
  murabba: frac(25n * 43560n),
  acre: frac(43560n),
  kanal: frac(5445n),
  marla: frac(1089n, 4n),
  sarsai: frac(121n, 4n),
  ghunta: frac(1089n),
  sqft: frac(1n),
  sqyd: frac(9n),
};

export const UNIT_LABEL: Record<AreaUnit, [string, string]> = {
  murabba: ['Murabba', 'مربع'], acre: ['Acre', 'ایکڑ'], kanal: ['Kanal', 'کنال'], marla: ['Marla', 'مرلہ'],
  sarsai: ['Sarsai', 'سرسائی'], ghunta: ['Ghunta', 'گھنٹہ'], sqft: ['Sq ft', 'مربع فٹ'], sqyd: ['Sq yd', 'مربع گز'],
};

/** Unit sets used to show an area in mixed units (largest first). */
export const MIXED: Record<string, AreaUnit[]> = {
  punjab: ['kanal', 'marla', 'sarsai'],
  'punjab-acre': ['acre', 'kanal', 'marla', 'sarsai'],
  kp: ['kanal', 'marla', 'sarsai'],
  sindh: ['acre', 'ghunta'],
  urban: ['sqft'],
  'urban-yd': ['sqyd'],
  murabba: ['murabba', 'acre', 'kanal', 'marla', 'sarsai'],
};

export const toSqft = (value: Fraction, unit: AreaUnit): Fraction => mul(value, UNIT_SQFT[unit]);
export const fromSqft = (sqft: Fraction, unit: AreaUnit): Fraction => div(sqft, UNIT_SQFT[unit]);

/** Builds an area from mixed parts, e.g. { kanal: 3, marla: 5, sarsai: 2 } -> value in `unit`. */
export function fromParts(parts: Partial<Record<AreaUnit, Fraction | bigint | number>>, unit: AreaUnit): Fraction {
  let sq = ZERO;
  for (const [u, v] of Object.entries(parts) as [AreaUnit, Fraction | bigint | number][]) {
    if (v === undefined || v === null) continue;
    const f = typeof v === 'object' ? v : frac(BigInt(v));
    sq = add(sq, toSqft(f, u));
  }
  return fromSqft(sq, unit);
}

export interface MixedArea { parts: { unit: AreaUnit; whole: bigint }[]; remainder: Fraction; remainderUnit: AreaUnit }

/** Splits an area into whole units (largest first); what is left is an exact fraction of the last unit. */
export function toMixed(value: Fraction, unit: AreaUnit, system: AreaUnit[] = MIXED.punjab): MixedArea {
  let rest = toSqft(value, unit);
  const parts: { unit: AreaUnit; whole: bigint }[] = [];
  system.forEach((u, i) => {
    const inU = fromSqft(rest, u);
    const whole = inU.n / inU.d; // floor for non-negative values
    if (i < system.length - 1) {
      parts.push({ unit: u, whole });
      rest = sub(rest, mul(frac(whole), UNIT_SQFT[u]));
    } else {
      parts.push({ unit: u, whole });
      rest = frac(inU.n - whole * inU.d, inU.d);
    }
  });
  return { parts, remainder: rest, remainderUnit: system[system.length - 1] };
}

/** "3 Kanal 5 Marla 2 Sarsai (+1/3 Sarsai)". */
export function formatMixed(m: MixedArea, lang: 0 | 1 = 0): string {
  const any = m.parts.some((p) => p.whole > 0n);
  const s = m.parts.filter((p, i) => p.whole > 0n || (!any && i === m.parts.length - 1)).map((p) => `${p.whole} ${UNIT_LABEL[p.unit][lang]}`).join(' ');
  return m.remainder.n ? `${s} (+${m.remainder.n}/${m.remainder.d} ${UNIT_LABEL[m.remainderUnit][lang]})` : s;
}

/** Legacy rupee–anna–pie: a share of 1 rupee (16 anna, 12 pie each). */
export function toRupeeAnnaPie(share: Fraction): { rupee: bigint; anna: bigint; pie: bigint; remainder: Fraction } {
  const pies = mul(share, frac(192n));
  const whole = pies.n / pies.d;
  return { rupee: whole / 192n, anna: (whole % 192n) / 12n, pie: whole % 12n, remainder: frac(pies.n - whole * pies.d, pies.d) };
}
