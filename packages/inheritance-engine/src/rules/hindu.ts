/**
 * Hindu (Mitakshara) with the Hindu Women's Rights to Property Act 1937. Guided mode: a custom
 * may apply, so every result is flagged "verify" and the UI allows a manual override.
 *  Separate property: sons, sons' sons and great-grandsons (male line, per stirpes); the widow
 *  takes a son's share (1937 Act, limited estate), and a predeceased son's widow takes a share in
 *  his branch. No male issue: widow takes the whole (limited estate); then daughters
 *  (Benares: in order unmarried → married; Bombay: equally), daughter's sons, mother, father,
 *  brothers, brothers' sons, father's mother, father's father. Beyond that: manual / escheat.
 *  Coparcenary: survivorship; the widow takes the deceased's interest under the 1937 Act.
 */
import { add, frac, mul, ONE, share, sum, sub, ZERO, type Fraction } from '../fraction.ts';
import type { Graph, Relation } from '../relations.ts';
import type { Case, ExplainEntry } from '../types.ts';
import type { RuleOutput } from './sunni.ts';

const HWRP = 'hindu-women-1937';
const MIT = 'mitakshara';

export function hinduShares(heirs: Relation[], c: Case, g: Graph): RuleOutput {
  const shares = new Map<string, Fraction>();
  const reasons = new Map<string, ExplainEntry[]>();
  const excluded = new Map<string, ExplainEntry[]>();
  const notes: ExplainEntry[] = [{ ruleId: 'hindu.custom-may-apply', i18nKey: 'hindu.custom-may-apply', citationKey: MIT }];
  const D = c.deceasedId;
  const eligible = new Set(heirs.map((r) => r.personId));
  const gender = (id: string) => g.byId.get(id)!.gender;
  const why = (id: string, ruleId: string, cite = MIT) => reasons.set(id, [...(reasons.get(id) ?? []), { ruleId, i18nKey: ruleId, citationKey: cite }]);
  const credit = (id: string, f: Fraction) => shares.set(id, add(shares.get(id) ?? ZERO, f));
  const widows = heirs.filter((r) => r.kind === 'spouse' && r.gender === 'F').map((r) => r.personId);
  const spouseOf = (id: string) => c.unions.filter((u) => u.partners.includes(id)).map((u) => u.partners.find((p) => p !== id)!).filter((p) => eligible.has(p) || g.byId.get(p)?.alive);

  if (c.policy.hinduProperty === 'coparcenary') {
    notes.push({ ruleId: 'hindu.coparcenary', i18nKey: 'hindu.coparcenary', citationKey: HWRP });
    if (widows.length) { for (const w of widows) { credit(w, share(ONE, BigInt(widows.length))); why(w, 'hindu.widow.coparcenary-interest', HWRP); } }
    else notes.push({ ruleId: 'hindu.survivorship', i18nKey: 'hindu.survivorship', citationKey: MIT });
    return finish(shares.size ? ZERO : ONE);
  }

  // Male issue up to the great-grandson, per stirpes through predeceased sons (with their widows).
  type Unit = { ids: Map<string, Fraction> };
  const sonBranch = (id: string, depth: number): Unit | null => {
    if (eligible.has(id)) return { ids: new Map([[id, ONE]]) };
    if (depth >= 3) return null;
    const sub = g.children(id).filter((k) => gender(k) === 'M').map((k) => sonBranch(k, depth + 1)).filter(Boolean) as Unit[];
    const sonWidow = spouseOf(id).filter((w) => eligible.has(w) && gender(w) === 'F');
    const parts = [...sub, ...sonWidow.map((w) => ({ ids: new Map([[w, ONE]]) }))];
    if (!sub.length) return null;
    const ids = new Map<string, Fraction>();
    for (const u of parts) for (const [k, f] of u.ids) ids.set(k, add(ids.get(k) ?? ZERO, mul(f, frac(1n, BigInt(parts.length)))));
    return { ids };
  };
  const branches = g.children(D).filter((k) => gender(k) === 'M').map((k) => sonBranch(k, 1)).filter(Boolean) as Unit[];
  if (branches.length) {
    const units = [...branches, ...widows.map((w) => ({ ids: new Map([[w, ONE]]) }))];
    for (const u of units) for (const [id, f] of u.ids) { credit(id, mul(f, frac(1n, BigInt(units.length)))); why(id, widows.includes(id) ? 'hindu.widow.sons-share' : 'hindu.male-issue', widows.includes(id) ? HWRP : MIT); }
    return finish(ZERO);
  }
  if (widows.length) { for (const w of widows) { credit(w, share(ONE, BigInt(widows.length))); why(w, 'hindu.widow.limited-estate', HWRP); } return finish(ZERO); }

  const order: [string, (r: Relation) => boolean][] = [
    ['hindu.daughters', (r) => r.kind === 'agnatic-descendant' && r.level === 1 && r.gender === 'F'],
    ['hindu.daughters-sons', (r) => r.kind === 'distant-kindred' && r.dk?.cls === 1 && r.gender === 'M' && r.level === 2],
    ['hindu.mother', (r) => r.kind === 'mother'],
    ['hindu.father', (r) => r.kind === 'father'],
    ['hindu.full-brothers', (r) => r.kind === 'sibling' && r.blood === 'full' && r.gender === 'M'],
    ['hindu.half-brothers', (r) => r.kind === 'sibling' && r.blood === 'consanguine' && r.gender === 'M'],
    ['hindu.brothers-sons', (r) => r.kind === 'agnatic-collateral' && r.agnatic?.cls === 1 && r.agnatic.dist === 2],
    ['hindu.fathers-mother', (r) => r.kind === 'true-grandmother' && !!r.gm?.paternal && r.gm.level === 2],
    ['hindu.fathers-father', (r) => r.kind === 'agnatic-ancestor' && r.level === 2],
  ];
  for (const [rule, test] of order) {
    const win = heirs.filter(test).map((r) => r.personId);
    if (!win.length) continue;
    if (rule === 'hindu.daughters' && c.policy.hinduDaughterOrder === 'benares') notes.push({ ruleId: 'hindu.benares-daughter-order', i18nKey: 'hindu.benares-daughter-order', citationKey: MIT });
    for (const id of win) { credit(id, share(ONE, BigInt(win.length))); why(id, rule); }
    return finish(ZERO);
  }
  notes.push({ ruleId: 'hindu.remote-heirs-manual', i18nKey: 'hindu.remote-heirs-manual', citationKey: MIT });
  return finish(ONE);

  function finish(escheat: Fraction): RuleOutput {
    for (const r of heirs) if (!shares.has(r.personId)) excluded.set(r.personId, [{ ruleId: 'hindu.excluded-by-nearer', i18nKey: 'hindu.excluded-by-nearer', citationKey: MIT }]);
    const total = sum([...shares.values()]);
    return { shares, reasons, excluded, notes, escheat: shares.size ? sub(ONE, total) : escheat, needsVerification: true };
  }
}
