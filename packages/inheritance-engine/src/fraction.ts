/**
 * Exact rational arithmetic on BigInt. Every Fraction is reduced with d > 0.
 * No floating point anywhere: the only number output is `percent()`, a formatted string.
 */
export type Fraction = { readonly n: bigint; readonly d: bigint };

const abs = (a: bigint): bigint => (a < 0n ? -a : a);

export function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return abs(a / gcd(a, b) * b);
}

export function frac(n: bigint | number | string, d: bigint | number | string = 1n): Fraction {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new RangeError('denominator is zero');
  if (dd < 0n) { nn = -nn; dd = -dd; }
  const g = gcd(nn, dd) || 1n;
  return { n: nn / g, d: dd / g };
}

export const ZERO = frac(0n);
export const ONE = frac(1n);

export const add = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.n, a.d * b.d);
export function div(a: Fraction, b: Fraction): Fraction {
  if (b.n === 0n) throw new RangeError('division by zero');
  return frac(a.n * b.d, a.d * b.n);
}
export const cmp = (a: Fraction, b: Fraction): number => {
  const x = a.n * b.d - b.n * a.d;
  return x === 0n ? 0 : x > 0n ? 1 : -1;
};
export const eq = (a: Fraction, b: Fraction): boolean => a.n === b.n && a.d === b.d;
export const isZero = (a: Fraction): boolean => a.n === 0n;
export const sum = (xs: Fraction[]): Fraction => xs.reduce(add, ZERO);
export const max = (a: Fraction, b: Fraction): Fraction => (cmp(a, b) >= 0 ? a : b);
export const min = (a: Fraction, b: Fraction): Fraction => (cmp(a, b) <= 0 ? a : b);
export const scale = (a: Fraction, k: bigint): Fraction => frac(a.n * k, a.d);
export const share = (a: Fraction, parts: bigint): Fraction => frac(a.n, a.d * parts);

export const toString = (a: Fraction): string => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);

/** Parses "3/8", "1", "-2/4". */
export function parse(s: string): Fraction {
  const m = /^\s*(-?\d+)\s*(?:\/\s*(\d+))?\s*$/.exec(s);
  if (!m) throw new SyntaxError(`not a fraction: ${s}`);
  return frac(BigInt(m[1]), BigInt(m[2] ?? '1'));
}

/** Percentage string rounded half-up to `dp` decimals (the only formatted number output). */
export function percent(a: Fraction, dp = 4): string {
  const scaleBy = 10n ** BigInt(dp);
  let x = a.n * 100n * scaleBy * 2n + a.d; // half-up
  x = x / (2n * a.d);
  const neg = x < 0n;
  const s = abs(x).toString().padStart(dp + 1, '0');
  const int = s.slice(0, s.length - dp);
  const dec = dp ? `.${s.slice(-dp)}` : '';
  return `${neg ? '-' : ''}${int}${dec}`;
}

/** Common base (LCD) of a set of fractions. */
export const commonBase = (xs: Fraction[]): bigint => xs.reduce((acc, f) => lcm(acc, f.d), 1n);
