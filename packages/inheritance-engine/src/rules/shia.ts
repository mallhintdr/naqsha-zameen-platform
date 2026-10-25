/**
 * Shia (Ithna Ashari / Ja'fari) rules: a separate module, not a toggle on the Hanafi rules.
 *  Classes by blood: I parents + descendants; II grandparents + siblings (+ their descendants);
 *  III uncles / aunts (+ their descendants). A nearer class excludes the remoter ones.
 *  Spouse inherits with every class. Descendants represent a predeceased ancestor per stirpes
 *  (2 : 1). No agnatic preference. No aul: a deficit falls on daughters / sisters. Radd to blood
 *  heirs only (mother excluded when reduced by siblings; uterine excluded with a full sister).
 */
import { add, cmp, div, frac, isZero, mul, ONE, share, sub, sum, ZERO, type Fraction } from '../fraction.ts';
import type { Graph, Relation } from '../relations.ts';
import type { Case, ExplainEntry } from '../types.ts';
import type { RuleOutput } from './sunni.ts';

const Q = 'quran-4-11';
const Q12 = 'quran-4-12';
const JAFARI = 'jafari-fiqh';

/** A line of descent from `root`: the surviving heirs reached through it, with their part of the line. */
interface Line { root: string; gender: 'M' | 'F'; members: Map<string, Fraction> }

export function shiaShares(heirs: Relation[], c: Case, g: Graph): RuleOutput {
  const shares = new Map<string, Fraction>();
  const reasons = new Map<string, ExplainEntry[]>();
  const excluded = new Map<string, ExplainEntry[]>();
  const notes: ExplainEntry[] = [];
  let needsVerification = false;
  const D = c.deceasedId;
  const eligible = new Set(heirs.map((r) => r.personId));
  const relOf = new Map(heirs.map((r) => [r.personId, r]));
  const gender = (id: string) => g.byId.get(id)!.gender;

  const why = (id: string, ruleId: string, citationKey = JAFARI, params?: Record<string, string>) =>
    reasons.set(id, [...(reasons.get(id) ?? []), { ruleId, i18nKey: ruleId, citationKey, params }]);
  const exclude = (ids: string[], ruleId: string, by: string) => {
    for (const id of ids) if (!shares.has(id) && !excluded.has(id)) excluded.set(id, [{ ruleId, i18nKey: ruleId, citationKey: JAFARI, params: { by } }]);
  };
  const credit = (id: string, f: Fraction) => shares.set(id, add(shares.get(id) ?? ZERO, f));

  // ---- per-stirpes lines
  const line = (root: string, seen = new Set<string>()): Line | null => {
    if (seen.has(root)) return null;
    seen.add(root);
    if (eligible.has(root)) return { root, gender: gender(root), members: new Map([[root, ONE]]) };
    const sub = g.children(root).map((k) => line(k, seen)).filter(Boolean) as Line[];
    if (!sub.length) return null;
    const members = new Map<string, Fraction>();
    const w = sub.reduce((a, l) => a + (l.gender === 'M' ? 2n : 1n), 0n);
    for (const l of sub) for (const [id, f] of l.members) members.set(id, add(members.get(id) ?? ZERO, mul(f, frac(l.gender === 'M' ? 2n : 1n, w))));
    return { root, gender: gender(root), members };
  };
  const linesOf = (roots: string[]) => roots.map((r) => line(r)).filter(Boolean) as Line[];
  const payLine = (l: Line, amount: Fraction, ruleId: string, cite = JAFARI) => {
    for (const [id, f] of l.members) { credit(id, mul(amount, f)); why(id, l.members.size > 1 || l.root !== id ? `${ruleId}` : ruleId, cite); if (l.root !== id) why(id, 'shia.representation', JAFARI); }
  };
  const payLines = (ls: Line[], amount: Fraction, ruleId: string, cite = JAFARI, equal = false) => {
    const w = ls.reduce((a, l) => a + (equal ? 1n : l.gender === 'M' ? 2n : 1n), 0n);
    for (const l of ls) payLine(l, mul(amount, frac(equal ? 1n : l.gender === 'M' ? 2n : 1n, w)), ruleId, cite);
  };
  const lineIds = (ls: Line[]) => ls.flatMap((l) => [...l.members.keys()]);

  // ---- who is there
  const spouses = heirs.filter((r) => r.kind === 'spouse').map((r) => r.personId);
  const husband = spouses.filter((id) => gender(id) === 'M');
  const wives = spouses.filter((id) => gender(id) === 'F');
  const fatherId = g.father(D), motherId = g.mother(D);
  const father = fatherId && eligible.has(fatherId) ? fatherId : undefined;
  const mother = motherId && eligible.has(motherId) ? motherId : undefined;
  const childLines = linesOf(g.children(D));
  const hasDesc = childLines.length > 0;

  // Siblings of D (by blood) as lines, so nephews / nieces represent a predeceased sibling.
  const siblingIds = [...new Set([...(fatherId ? g.children(fatherId) : []), ...(motherId ? g.children(motherId) : [])])].filter((id) => id !== D);
  const blood = (id: string) => (g.father(id) === fatherId && fatherId && g.mother(id) === motherId && motherId ? 'full' : g.father(id) === fatherId && fatherId ? 'consanguine' : 'uterine');
  const sibLines = { full: linesOf(siblingIds.filter((s) => blood(s) === 'full')), consanguine: linesOf(siblingIds.filter((s) => blood(s) === 'consanguine')), uterine: linesOf(siblingIds.filter((s) => blood(s) === 'uterine')) };
  // Living siblings themselves (for the mother's reduction): full / consanguine, Muslim and eligible.
  const liveBro = siblingIds.filter((s) => eligible.has(s) && blood(s) !== 'uterine' && gender(s) === 'M').length;
  const liveSis = siblingIds.filter((s) => eligible.has(s) && blood(s) !== 'uterine' && gender(s) === 'F').length;
  const motherReduced = !!father && (liveBro >= 2 || (liveBro === 1 && liveSis >= 2) || liveSis >= 4);

  // ---- spouse (with every class)
  const anyBloodHeir = heirs.some((r) => r.kind !== 'spouse');
  if (husband.length) { credit(husband[0], hasDesc ? frac(1, 4) : frac(1, 2)); why(husband[0], hasDesc ? 'shia.husband.quarter' : 'shia.husband.half', Q12); }
  if (wives.length) for (const w of wives) { credit(w, share(hasDesc ? frac(1, 8) : frac(1, 4), BigInt(wives.length))); why(w, hasDesc ? 'shia.wife.eighth' : 'shia.wife.quarter', Q12); }
  const spouseTotal = sum(spouses.map((id) => shares.get(id)!));
  const remainder = sub(ONE, spouseTotal);

  // ---------------- Class I
  if (father || mother || hasDesc) {
    const cls = [...(father ? [father] : []), ...(mother ? [mother] : []), ...lineIds(childLines)];
    exclude(heirs.filter((r) => r.kind !== 'spouse' && !cls.includes(r.personId)).map((r) => r.personId), 'shia.excluded-by-class-1', 'parents / descendants');
    const sons = childLines.filter((l) => l.gender === 'M');
    const daughters = childLines.filter((l) => l.gender === 'F');
    if (hasDesc) {
      if (father) { credit(father, frac(1, 6)); why(father, 'shia.father.sixth', Q); }
      if (mother) { credit(mother, frac(1, 6)); why(mother, 'shia.mother.sixth', Q); }
      const parentsTotal = add(father ? frac(1, 6) : ZERO, mother ? frac(1, 6) : ZERO);
      if (sons.length) {
        payLines(childLines, sub(remainder, parentsTotal), 'shia.children.residue-2-1', Q);
      } else {
        const dShare = daughters.length === 1 ? frac(1, 2) : frac(2, 3);
        const avail = sub(remainder, parentsTotal);
        if (cmp(dShare, avail) >= 0) {
          payLines(daughters, avail, 'shia.daughters.deficit', JAFARI, true);
          notes.push({ ruleId: 'shia.no-aul', i18nKey: 'shia.no-aul', citationKey: JAFARI });
        } else {
          // Radd: surplus to daughters and parents in proportion (mother out if reduced by siblings).
          const surplus = sub(avail, dShare);
          const pool: [string | Line, Fraction][] = [...daughters.map((l) => [l, share(dShare, BigInt(daughters.length))] as [Line, Fraction])];
          if (father) pool.push([father, frac(1, 6)]);
          if (mother && !motherReduced) pool.push([mother, frac(1, 6)]);
          const poolTotal = sum(pool.map(([, f]) => f));
          for (const l of daughters) payLine(l, share(dShare, BigInt(daughters.length)), daughters.length === 1 ? 'shia.daughter.half' : 'shia.daughters.two-thirds', Q);
          for (const [who, f] of pool) {
            const extra = mul(surplus, div(f, poolTotal));
            if (typeof who === 'string') { credit(who, extra); why(who, 'shia.radd', JAFARI); } else payLine(who, extra, 'shia.radd');
          }
          notes.push({ ruleId: 'shia.radd', i18nKey: 'shia.radd', citationKey: JAFARI });
        }
      }
      const eldest = sons.find((l) => l.members.has(l.root));
      if (eldest) notes.push({ ruleId: 'shia.habwa', i18nKey: 'shia.habwa', citationKey: JAFARI, params: { son: eldest.root } });
    } else if (father && mother) {
      const m = motherReduced ? frac(1, 6) : frac(1, 3);
      credit(mother, m); why(mother, motherReduced ? 'shia.mother.sixth-hajib' : 'shia.mother.third', Q);
      credit(father, sub(remainder, m)); why(father, 'shia.father.residue', Q);
    } else if (father) { credit(father, remainder); why(father, 'shia.father.all', Q); }
    else if (mother) { credit(mother, remainder); why(mother, 'shia.mother.third-plus-radd', Q); }
  }
  // ---------------- Class II: grandparents + siblings (and their descendants)
  else if (anyBloodHeir && (Object.values(sibLines).some((l) => l.length) || heirs.some((r) => r.kind === 'agnatic-ancestor' || r.kind === 'true-grandmother' || (r.kind === 'distant-kindred' && r.dk?.cls === 2)))) {
    needsVerification = true;
    const gps = heirs.filter((r) => r.kind === 'agnatic-ancestor' || r.kind === 'true-grandmother' || (r.kind === 'distant-kindred' && r.dk?.cls === 2));
    // Paternal grandparents: father's parents; maternal: mother's parents (nearest level only).
    const pg = gps.filter((r) => fatherId && (g.father(fatherId) === r.personId || g.mother(fatherId) === r.personId));
    const mg = gps.filter((r) => motherId && (g.father(motherId) === r.personId || g.mother(motherId) === r.personId));
    const paternalSide: Line[] = [...(sibLines.full.length ? sibLines.full : sibLines.consanguine), ...pg.map((r) => ({ root: r.personId, gender: r.gender, members: new Map([[r.personId, ONE]]) }))];
    if (sibLines.full.length) exclude(lineIds(sibLines.consanguine), 'shia.consanguine.excluded-by-full', 'full sibling');
    const maternalSide: Line[] = [...sibLines.uterine, ...mg.map((r) => ({ root: r.personId, gender: r.gender, members: new Map([[r.personId, ONE]]) }))];
    const cls2 = new Set([...lineIds(paternalSide), ...lineIds(maternalSide)]);
    exclude(heirs.filter((r) => r.kind !== 'spouse' && !cls2.has(r.personId)).map((r) => r.personId), 'shia.excluded-by-class-2', 'grandparents / siblings');

    const onlyGrandparents = !sibLines.full.length && !sibLines.consanguine.length && !sibLines.uterine.length;
    let matShare = ZERO;
    if (maternalSide.length) {
      matShare = onlyGrandparents || maternalSide.length > 1 ? frac(1, 3) : frac(1, 6);
      if (!paternalSide.length) matShare = remainder; // maternal side alone takes all (radd)
      else payLines(maternalSide, matShare, 'shia.maternal-side', Q12, true);
      if (!paternalSide.length) payLines(maternalSide, matShare, 'shia.maternal-side.all', Q12, true);
    }
    if (paternalSide.length) {
      const avail = sub(remainder, maternalSide.length ? matShare : ZERO);
      const males = paternalSide.some((l) => l.gender === 'M');
      if (males) payLines(paternalSide, avail, 'shia.paternal-side.residue-2-1', 'quran-4-176');
      else {
        const sis = paternalSide.length === 1 ? frac(1, 2) : frac(2, 3);
        if (cmp(sis, avail) >= 0) { payLines(paternalSide, avail, 'shia.sisters.deficit', JAFARI, true); notes.push({ ruleId: 'shia.no-aul', i18nKey: 'shia.no-aul', citationKey: JAFARI }); }
        else {
          // Radd to the paternal side (uterine kin take no radd when a full sister is present).
          payLines(paternalSide, avail, 'shia.sisters.share-plus-radd', 'quran-4-176', true);
          notes.push({ ruleId: 'shia.radd', i18nKey: 'shia.radd', citationKey: JAFARI });
        }
      }
    }
    notes.push({ ruleId: 'shia.class-2', i18nKey: 'shia.class-2', citationKey: JAFARI });
  }
  // ---------------- Class III: uncles / aunts (and their descendants)
  else if (anyBloodHeir) {
    const auntsPat = fatherId ? [...new Set([...(g.father(fatherId) ? g.children(g.father(fatherId)!) : []), ...(g.mother(fatherId) ? g.children(g.mother(fatherId)!) : [])])].filter((x) => x !== fatherId) : [];
    const auntsMat = motherId ? [...new Set([...(g.father(motherId) ? g.children(g.father(motherId)!) : []), ...(g.mother(motherId) ? g.children(g.mother(motherId)!) : [])])].filter((x) => x !== motherId) : [];
    const pat = linesOf(auntsPat), mat = linesOf(auntsMat);
    if (pat.length || mat.length) {
      needsVerification = true;
      const ids = new Set([...lineIds(pat), ...lineIds(mat)]);
      exclude(heirs.filter((r) => r.kind !== 'spouse' && !ids.has(r.personId)).map((r) => r.personId), 'shia.excluded-by-class-3', 'uncles / aunts');
      const matPart = pat.length && mat.length ? mul(remainder, frac(1, 3)) : mat.length ? remainder : ZERO;
      if (mat.length) payLines(mat, matPart, 'shia.maternal-uncles', JAFARI, true);
      if (pat.length) payLines(pat, sub(remainder, matPart), 'shia.paternal-uncles.2-1', JAFARI);
      notes.push({ ruleId: 'shia.class-3', i18nKey: 'shia.class-3', citationKey: JAFARI });
    }
  }

  // ---- only a spouse, or nobody
  let escheat = ZERO;
  const distributed = sum([...shares.values()]);
  if (cmp(distributed, ONE) < 0) {
    const left = sub(ONE, distributed);
    if (husband.length && !heirs.some((r) => r.kind !== 'spouse' && shares.has(r.personId))) {
      credit(husband[0], left); why(husband[0], 'shia.husband.sole-heir-radd');
    } else if (wives.length && !heirs.some((r) => r.kind !== 'spouse' && shares.has(r.personId)) && c.policy.raddToSpouseWhenNoOtherHeir) {
      for (const w of wives) { credit(w, share(left, BigInt(wives.length))); why(w, 'shia.widow.sole-heir-radd', 'pk-practice-radd-spouse'); }
    } else if (!isZero(left)) { escheat = left; notes.push({ ruleId: 'escheat', i18nKey: 'escheat', citationKey: 'escheat' }); }
  }

  // Childless widow and land (always noted).
  if (wives.length && !hasDesc) {
    notes.push({ ruleId: c.policy.shiaChildlessWidowLandRule === 'classical' ? 'shia.childless-widow-land.classical' : 'shia.childless-widow-land.equal', i18nKey: 'shia.childless-widow-land', citationKey: JAFARI });
  }
  void relOf;
  return { shares, reasons, excluded, notes, escheat, needsVerification };
}
