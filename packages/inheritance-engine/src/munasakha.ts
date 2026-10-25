/**
 * Munasakha (chained estates): an heir who died AFTER the deceased has their share passed on to
 * their own heirs through a sub-case (its own law, family and date). combine() gives every final
 * person's share of the ORIGINAL estate. Sub-cases may chain further (sub-case of a sub-case).
 */
import { add, mul, ONE, sub, sum, ZERO, eq, type Fraction } from './fraction.ts';
import type { ComputeResult } from './types.ts';

export interface ChainLink { heirId: string; result: ComputeResult; links?: ChainLink[] }
export interface CombinedShare { personId: string; fraction: Fraction; via: string[] }

/** Final shares of the original estate (sums to 1 together with reserved + escheat). */
export function combine(root: ComputeResult, links: ChainLink[] = []): { shares: CombinedShare[]; reserved: Fraction; escheat: Fraction } {
  const out = new Map<string, CombinedShare>();
  let reserved = root.reserved, escheat = root.escheat;
  const byHeir = new Map(links.map((l) => [l.heirId, l]));
  for (const s of root.shares) {
    if (!s.fraction.n) continue;
    const link = byHeir.get(s.personId);
    if (!link) {
      const prev = out.get(s.personId);
      out.set(s.personId, { personId: s.personId, fraction: add(prev?.fraction ?? ZERO, s.fraction), via: prev?.via ?? [] });
      continue;
    }
    const inner = combine(link.result, link.links ?? []);
    for (const x of inner.shares) {
      const prev = out.get(x.personId);
      out.set(x.personId, { personId: x.personId, fraction: add(prev?.fraction ?? ZERO, mul(s.fraction, x.fraction)), via: [s.personId, ...x.via] });
    }
    reserved = add(reserved, mul(s.fraction, inner.reserved));
    escheat = add(escheat, mul(s.fraction, inner.escheat));
  }
  const shares = [...out.values()];
  const total = add(add(sum(shares.map((s) => s.fraction)), reserved), escheat);
  if (!eq(total, ONE)) throw new Error(`munasakha invariant failed: ${total.n}/${total.d}`);
  void sub;
  return { shares, reserved, escheat };
}
