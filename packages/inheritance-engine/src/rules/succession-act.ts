/**
 * Succession Act 1925 (Pakistan text).
 *  Christian / other: Part V (ss.31–49).  Parsi: Chapter III (ss.50–56, as amended in 1939,
 *  before Indian partition; Pakistan did not adopt India's 1991 amendment). Parsi rules beyond
 *  spouse / children / parents are marked "verify text".
 * No religion bar, no gender difference among Christian kindred, full and half blood equal.
 */
import { add, frac, mul, ONE, share, sub, sum, ZERO, type Fraction } from '../fraction.ts';
import type { Graph, Relation } from '../relations.ts';
import type { Case, ExplainEntry } from '../types.ts';
import type { RuleOutput } from './sunni.ts';

const SA = 'succession-act-1925';

interface Line { root: string; members: Map<string, Fraction> }

export function successionActShares(heirs: Relation[], c: Case, g: Graph, variant: 'christian' | 'parsi'): RuleOutput {
  const shares = new Map<string, Fraction>();
  const reasons = new Map<string, ExplainEntry[]>();
  const excluded = new Map<string, ExplainEntry[]>();
  const notes: ExplainEntry[] = [];
  let needsVerification = variant === 'parsi';
  const D = c.deceasedId;
  const eligible = new Set(heirs.map((r) => r.personId));
  const gender = (id: string) => g.byId.get(id)!.gender;
  const why = (id: string, ruleId: string, params?: Record<string, string>) => reasons.set(id, [...(reasons.get(id) ?? []), { ruleId, i18nKey: ruleId, citationKey: SA, params }]);
  const credit = (id: string, f: Fraction) => shares.set(id, add(shares.get(id) ?? ZERO, f));

  // Per stirpes, equal between the children of a person (s.38-40).
  const line = (root: string, seen = new Set<string>()): Line | null => {
    if (seen.has(root)) return null;
    seen.add(root);
    if (eligible.has(root)) return { root, members: new Map([[root, ONE]]) };
    const sub = g.children(root).map((k) => line(k, seen)).filter(Boolean) as Line[];
    if (!sub.length) return null;
    const members = new Map<string, Fraction>();
    for (const l of sub) for (const [id, f] of l.members) members.set(id, add(members.get(id) ?? ZERO, mul(f, frac(1n, BigInt(sub.length)))));
    return { root, members };
  };
  const linesOf = (roots: string[]) => roots.map((r) => line(r)).filter(Boolean) as Line[];
  const pay = (l: Line, amount: Fraction, ruleId: string) => { for (const [id, f] of l.members) { credit(id, mul(amount, f)); why(id, ruleId); if (id !== l.root) why(id, 'sa.per-stirpes'); } };
  const payEqual = (ls: Line[], amount: Fraction, ruleId: string) => { for (const l of ls) pay(l, share(amount, BigInt(ls.length)), ruleId); };
  const ids = (ls: Line[]) => ls.flatMap((l) => [...l.members.keys()]);

  const spouse = heirs.filter((r) => r.kind === 'spouse').map((r) => r.personId);
  const fatherId = g.father(D), motherId = g.mother(D);
  const father = fatherId && eligible.has(fatherId) ? fatherId : undefined;
  const mother = motherId && eligible.has(motherId) ? motherId : undefined;
  const children = linesOf(g.children(D));
  const siblingIds = [...new Set([...(fatherId ? g.children(fatherId) : []), ...(motherId ? g.children(motherId) : [])])].filter((x) => x !== D);
  const siblings = linesOf(siblingIds);
  const others = heirs.filter((r) => r.kind !== 'spouse');
  const kindred = others.length > 0;

  if (variant === 'parsi') return parsi();

  // ---- Christian / other: Part V
  let rest = ONE;
  if (spouse.length) {
    const s = children.length ? frac(1, 3) : kindred ? frac(1, 2) : ONE;
    for (const id of spouse) { credit(id, share(s, BigInt(spouse.length))); why(id, children.length ? 'sa.spouse.third' : kindred ? 'sa.spouse.half' : 'sa.spouse.all'); }
    rest = sub(ONE, s);
    notes.push({ ruleId: 'sa.s33a-note', i18nKey: 'sa.s33a-note', citationKey: SA });
  }
  const takers = new Set<string>();
  if (children.length) { payEqual(children, rest, 'sa.descendants.equal'); ids(children).forEach((x) => takers.add(x)); }
  else if (father) { credit(father, rest); why(father, 'sa.father.all'); takers.add(father); }
  else if (mother || siblings.length) {
    const ls: Line[] = [...(mother ? [{ root: mother, members: new Map([[mother, ONE]]) }] : []), ...siblings];
    payEqual(ls, rest, mother ? (siblings.length ? 'sa.mother-and-siblings.equal' : 'sa.mother.all') : 'sa.siblings.equal');
    ids(ls).forEach((x) => takers.add(x));
  } else if (kindred) {
    // Nearest degree of kindred (civil law counting) take equally.
    needsVerification = true;
    const deg = (r: Relation) => r.dk?.degree ?? r.level + (r.agnatic ? r.agnatic.cls : 0) + (r.kind === 'true-grandmother' || r.kind === 'agnatic-ancestor' ? 0 : 1);
    const best = Math.min(...others.map(deg));
    const win = others.filter((r) => deg(r) === best);
    for (const r of win) { credit(r.personId, share(rest, BigInt(win.length))); why(r.personId, 'sa.nearest-kindred'); takers.add(r.personId); }
  }
  for (const r of others) if (!takers.has(r.personId)) excluded.set(r.personId, [{ ruleId: 'sa.excluded-by-nearer', i18nKey: 'sa.excluded-by-nearer', citationKey: SA }]);
  const total = sum([...shares.values()]);
  const escheat = total.n === total.d ? ZERO : sub(ONE, total);
  if (escheat.n) notes.push({ ruleId: 'escheat', i18nKey: 'escheat', citationKey: 'escheat' });
  return { shares, reasons, excluded, notes, escheat, needsVerification };

  // ---- Parsi: Chapter III (1939 text)
  function parsi(): RuleOutput {
    notes.push({ ruleId: 'sa.parsi.verify-text', i18nKey: 'sa.parsi.verify-text', citationKey: SA });
    const male = gender(D) === 'M';
    const takers = new Set<string>();
    if (children.length) {
      // s.51 (male): widow and each son 2 parts, each daughter 1 part; father = half a son,
      // mother = half a daughter.  s.52 (female): widower and each child equal.
      const parts: [string | Line, bigint, string][] = [];
      for (const l of children) parts.push([l, male ? (gender(l.root) === 'M' ? 4n : 2n) : 2n, 'sa.parsi.child']);
      for (const s of spouse) parts.push([s, male ? 4n : 2n, 'sa.parsi.spouse']);
      if (male && father) parts.push([father, 2n, 'sa.parsi.father']);
      if (male && mother) parts.push([mother, 1n, 'sa.parsi.mother']);
      const W = parts.reduce((a, [, w]) => a + w, 0n);
      for (const [who, w, rule] of parts) {
        const f = frac(w, W);
        if (typeof who === 'string') { credit(who, f); why(who, rule); takers.add(who); } else { pay(who, f, rule); ids([who]).forEach((x) => takers.add(x)); }
      }
    } else {
      // s.54 / Schedule II: spouse half, the rest to the next class (parents, then siblings) equally.
      needsVerification = true;
      let rest = ONE;
      if (spouse.length) { for (const s of spouse) { credit(s, share(kindred ? frac(1, 2) : ONE, BigInt(spouse.length))); why(s, kindred ? 'sa.parsi.spouse-half' : 'sa.spouse.all'); } rest = kindred ? frac(1, 2) : ZERO; }
      const parents = [father, mother].filter(Boolean) as string[];
      const ls: Line[] = parents.length ? parents.map((p) => ({ root: p, members: new Map([[p, ONE]]) })) : siblings;
      if (ls.length && rest.n) { payEqual(ls, rest, parents.length ? 'sa.parsi.parents' : 'sa.parsi.siblings'); ids(ls).forEach((x) => takers.add(x)); }
      else if (rest.n && kindred) {
        const win = others;
        for (const r of win) { credit(r.personId, share(rest, BigInt(win.length))); why(r.personId, 'sa.nearest-kindred'); takers.add(r.personId); }
      }
    }
    for (const r of others) if (!takers.has(r.personId)) excluded.set(r.personId, [{ ruleId: 'sa.excluded-by-nearer', i18nKey: 'sa.excluded-by-nearer', citationKey: SA }]);
    const total = sum([...shares.values()]);
    const escheat = total.n === total.d ? ZERO : sub(ONE, total);
    return { shares, reasons, excluded, notes, escheat, needsVerification };
  }
}
