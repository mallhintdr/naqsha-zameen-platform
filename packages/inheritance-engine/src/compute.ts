/**
 * Pipeline (same for every law; rule-sets plug into step 5):
 *  1 net estate  2 will  3 candidates  4 capacity bars  5 rule-set  6 aul/radd/kindred/escheat (in rule-set)
 *  7 MFLO 1961 s.4 overlay  8 reservations (pregnancy, missing heir)  9 munasakha (parentCaseId)  10 output + invariants
 */
import { add, cmp, commonBase, div, eq, frac, isZero, max, min, mul, ONE, percent, sub, sum, ZERO, type Fraction } from './fraction.ts';
import { buildGraph, deriveRelations, type Relation } from './relations.ts';
import { sunniShares, type RuleOutput } from './rules/sunni.ts';
import type { Case, ComputeResult, ExplainEntry, Person, ShareResult } from './types.ts';

const MUSLIM = new Set(['sunni-hanafi', 'sunni-shafii', 'sunni-maliki', 'sunni-hanbali', 'shia-ithna']);
const note = (ruleId: string, citationKey: string, params?: Record<string, string>): ExplainEntry => ({ ruleId, i18nKey: ruleId, citationKey, params });

/** Survived the deceased (strictly later death; same date = simultaneous death, no mutual inheritance). */
export function survived(p: Person, dateOfDeath: string): boolean {
  if (p.alive) return true;
  return !!p.dateOfDeath && p.dateOfDeath > dateOfDeath;
}

function ruleSet(c: Case) {
  switch (c.lawSystem) {
    case 'sunni-hanafi':
    case 'sunni-shafii':
    case 'sunni-maliki':
    case 'sunni-hanbali':
      return (heirs: Relation[]) => sunniShares(heirs, { ...c.policy, grandfatherExcludesSiblings: c.lawSystem === 'sunni-hanafi' ? c.policy.grandfatherExcludesSiblings : false });
    default:
      throw new Error(`Law system "${c.lawSystem}" is not available yet`);
  }
}

/** Capacity bars (step 4). Returns the reason, or null if the person may inherit. */
function capacityBar(c: Case, p: Person, r: Relation, deceased: Person): ExplainEntry | null {
  const muslim = MUSLIM.has(c.lawSystem);
  if (p.flags.killedDeceased) {
    if (c.lawSystem === 'shia-ithna' ? p.flags.killedDeceased === 'intentional' : true) return note('bar.homicide', 'bar-homicide', { type: p.flags.killedDeceased });
  }
  if (muslim && (p.religion || '').toLowerCase() !== (deceased.religion || '').toLowerCase()) return note('bar.religion', 'bar-religion');
  if (p.flags.adopted && (r.kind === 'agnatic-descendant' || r.kind === 'distant-kindred')) return note('bar.adopted', 'bar-adopted');
  if (p.flags.illegitimate && muslim) {
    const viaMother = deceased.gender === 'F' && r.kind === 'agnatic-descendant' && r.level === 1;
    const uterine = r.kind === 'sibling' && r.blood === 'uterine';
    if (c.lawSystem === 'shia-ithna' || !(viaMother || uterine)) return note('bar.illegitimate', 'bar-illegitimate');
  }
  if (r.kind === 'spouse' && r.spouseState === 'divorced') return note('bar.divorced', 'bar-divorced');
  return null;
}

interface Run { out: RuleOutput; rel: Map<string, Relation>; eligible: Relation[]; bars: Map<string, ExplainEntry> }

function runOnce(c: Case, opts: { extraAlive?: Set<string>; forceDead?: Set<string> } = {}): Run {
  const rel = deriveRelations(c);
  const deceased = c.persons.find((p) => p.id === c.deceasedId)!;
  const bars = new Map<string, ExplainEntry>();
  const eligible: Relation[] = [];
  for (const p of c.persons) {
    const r = rel.get(p.id)!;
    if (p.id === c.deceasedId || r.kind === 'unrelated') continue;
    const alive = (opts.extraAlive?.has(p.id) || survived(p, c.dateOfDeath)) && !opts.forceDead?.has(p.id);
    if (!alive) { bars.set(p.id, note(p.dateOfDeath === c.dateOfDeath ? 'bar.simultaneous-death' : 'bar.predeceased', 'bar-predeceased')); continue; }
    const bar = capacityBar(c, p, r, deceased);
    if (bar) { bars.set(p.id, bar); continue; }
    eligible.push(r);
  }
  return { out: ruleSet(c)(eligible), rel, eligible, bars };
}

/** Adds an unborn child (posthumous) of the deceased and the pregnant widow. */
function withUnborn(c: Case, gender: 'M' | 'F'): Case {
  const widow = c.persons.find((p) => p.flags.pregnant && c.unions.some((u) => u.partners.includes(p.id) && u.partners.includes(c.deceasedId)));
  const deceased = c.persons.find((p) => p.id === c.deceasedId)!;
  const unborn: Person = { id: '__unborn__', name: 'Unborn child', gender, alive: true, religion: deceased.religion, flags: {} };
  const fatherId = deceased.gender === 'M' ? deceased.id : widow?.id;
  const motherId = deceased.gender === 'M' ? widow?.id : deceased.id;
  return { ...c, persons: [...c.persons, unborn], parents: [...c.parents, { childId: '__unborn__', fatherId, motherId }] };
}

export function compute(c: Case): ComputeResult {
  const notes: ExplainEntry[] = [];
  const g = buildGraph(c);
  const deceased = g.byId.get(c.deceasedId);
  if (!deceased) throw new Error('deceased not found');

  // ---- 1. net estate (value only when movables are given) and warnings
  const gross = c.estate.movableValue;
  if (gross) {
    const net = sub(sub(sub(gross, c.estate.funeral), c.estate.debts), c.estate.dower);
    notes.push(note('estate.net', 'estate-deductions', { net: `${net.n}/${net.d}` }));
    if (cmp(net, ZERO) < 0) notes.push(note('estate.insolvent', 'estate-deductions'));
  }
  notes.push(note('estate.not-included', 'estate-exclusions'));

  // ---- 2. will (fraction of the net estate)
  const muslim = MUSLIM.has(c.lawSystem);
  const rel0 = deriveRelations(c);
  let willTotal = ZERO;
  const legacies: { id: string; f: Fraction; name: string }[] = [];
  c.estate.wills.forEach((w, i) => {
    let f = w.fraction ?? (w.amount && gross ? div(w.amount, gross) : ZERO);
    if (isZero(f)) return;
    if (muslim && c.lawSystem !== 'shia-ithna' && w.beneficiaryId && rel0.get(w.beneficiaryId)?.kind !== 'unrelated') {
      notes.push(note('will.to-heir-needs-consent', 'will-heir-consent', { beneficiary: w.beneficiaryId }));
      return;
    }
    legacies.push({ id: w.beneficiaryId ?? `will-${i + 1}`, f, name: w.external ?? w.beneficiaryId ?? `Legatee ${i + 1}` });
    willTotal = add(willTotal, f);
    void f;
  });
  if (muslim && cmp(willTotal, frac(1, 3)) > 0) {
    const k = div(frac(1, 3), willTotal);
    for (const l of legacies) l.f = mul(l.f, k);
    notes.push(note('will.clipped-to-third', 'will-one-third', { from: `${willTotal.n}/${willTotal.d}` }));
    willTotal = frac(1, 3);
  }
  const heirsPortion = sub(ONE, willTotal);

  // ---- 3-6 + 8: run the rule-set (with reservation scenarios when needed)
  const pregnant = c.persons.some((p) => p.flags.pregnant && c.unions.some((u) => u.partners.includes(p.id) && u.partners.includes(c.deceasedId)));
  const missing = c.persons.filter((p) => p.flags.missing && p.id !== c.deceasedId).map((p) => p.id);

  // ---- 7 MFLO s.4: predeceased son/daughter with living children counts as alive
  const s4 = new Map<string, string[]>(); // predeceased child -> recipients
  if (muslim && c.policy.applyMFLOs4) {
    for (const p of c.persons) {
      const r = rel0.get(p.id);
      const isChild = (r?.kind === 'agnatic-descendant' && r.level === 1) || (r?.kind === 'distant-kindred' && false);
      const isDeceasedChild = g.father(p.id) === c.deceasedId || g.mother(p.id) === c.deceasedId;
      if (!isChild && !isDeceasedChild) continue;
      if (survived(p, c.dateOfDeath)) continue;
      const kids = g.children(p.id).map((id) => g.byId.get(id)!).filter((k) => k && survived(k, c.dateOfDeath) && !k.flags.killedDeceased);
      if (kids.length) s4.set(p.id, kids.map((k) => k.id));
    }
  }
  const extraAlive = new Set(s4.keys());

  type Scenario = { run: Run; shares: Map<string, Fraction> };
  const scenario = (cc: Case, forceDead?: Set<string>): Scenario => {
    const run = runOnce(cc, { extraAlive, forceDead });
    return { run, shares: new Map(run.out.shares) };
  };
  let scenarios: Scenario[] = [];
  if (pregnant) scenarios = [scenario(withUnborn(c, 'M')), scenario(withUnborn(c, 'F'))];
  else scenarios = [scenario(c)];
  if (missing.length) scenarios = scenarios.flatMap(() => [scenario(pregnant ? withUnborn(c, 'M') : c), scenario(pregnant ? withUnborn(c, 'M') : c, new Set(missing))]);
  const main = scenarios[0].run;

  // Each heir gets the minimum across scenarios; the difference is reserved.
  const final = new Map<string, Fraction>();
  const ids = new Set(scenarios.flatMap((s) => [...s.shares.keys()]));
  const reservedIds = new Set<string>([...(pregnant ? ['__unborn__'] : []), ...missing]);
  for (const id of ids) {
    if (reservedIds.has(id)) continue;
    const vals = scenarios.map((s) => s.shares.get(id) ?? ZERO);
    final.set(id, vals.reduce(min));
  }
  const escheatRaw = scenarios.map((s) => s.run.out.escheat).reduce(min);
  let reserved = ZERO;
  if (reservedIds.size) {
    reserved = sub(sub(ONE, sum([...final.values()])), escheatRaw);
    const best = scenarios.map((s) => sum([...reservedIds].map((id) => s.shares.get(id) ?? ZERO))).reduce(max);
    notes.push(note(pregnant ? 'reserve.pregnancy' : 'reserve.missing', pregnant ? 'reserve-pregnancy' : 'reserve-missing', { largest: `${best.n}/${best.d}` }));
  }

  // MFLO s.4: pass each predeceased child's share to their children (2:1 male:female).
  const s4Recipients = new Map<string, Fraction>();
  for (const [childId, kids] of s4) {
    const f = final.get(childId) ?? ZERO;
    final.delete(childId);
    if (isZero(f)) continue;
    const people = kids.map((id) => g.byId.get(id)!);
    const w = people.reduce((a, p) => a + (p.gender === 'M' ? 2n : 1n), 0n);
    for (const p of people) {
      const part = mul(f, frac(p.gender === 'M' ? 2n : 1n, w));
      s4Recipients.set(p.id, add(s4Recipients.get(p.id) ?? ZERO, part));
      final.set(p.id, add(final.get(p.id) ?? ZERO, part));
    }
    notes.push(note('mflo.s4', 'mflo-1961-s4', { child: childId }));
  }

  // ---- will scaling
  for (const [id, f] of final) final.set(id, mul(f, heirsPortion));
  reserved = mul(reserved, heirsPortion);
  const escheat = mul(escheatRaw, heirsPortion);
  for (const l of legacies) final.set(l.id, add(final.get(l.id) ?? ZERO, l.f));

  // ---- 10 output
  const allF = [...final.values(), reserved, escheat].filter((f) => !isZero(f));
  const base = commonBase(allF);
  const shares: ShareResult[] = [];
  const make = (personId: string, relationKey: string, f: Fraction, status: ShareResult['status'], reasons: ExplainEntry[]): ShareResult => ({
    personId, relationKey, fraction: f, sihaam: (f.n * base) / f.d, base, percent: percent(f, 4), status, reasons,
  });
  for (const p of c.persons) {
    if (p.id === c.deceasedId) continue;
    const r = main.rel.get(p.id)!;
    const f = final.get(p.id) ?? ZERO;
    if (s4.has(p.id)) { shares.push(make(p.id, r.key, ZERO, 'excluded', [note('mflo.s4.passed-down', 'mflo-1961-s4')])); continue; }
    if (missing.includes(p.id)) { shares.push(make(p.id, r.key, ZERO, 'reserved', [note('reserve.missing', 'reserve-missing')])); continue; }
    if (s4Recipients.has(p.id)) { shares.push(make(p.id, r.key, f, 'substituted-s4', [note('mflo.s4.recipient', 'mflo-1961-s4'), ...(main.out.reasons.get(p.id) ?? [])])); continue; }
    if (!isZero(f)) { shares.push(make(p.id, r.key, f, 'heir', [...(main.out.reasons.get(p.id) ?? [])])); continue; }
    const why = main.bars.get(p.id) ?? main.out.excluded.get(p.id)?.[0] ?? note(r.kind === 'unrelated' ? 'not-related' : 'not-an-heir', 'general');
    shares.push(make(p.id, r.key, ZERO, 'excluded', [why]));
  }
  for (const l of legacies) if (!c.persons.some((p) => p.id === l.id)) shares.push(make(l.id, 'legatee', l.f, 'heir', [note('will.legacy', 'will-one-third')]));
  if (pregnant) shares.push(make('__unborn__', 'unborn-child', ZERO, 'reserved', [note('reserve.pregnancy', 'reserve-pregnancy')]));

  // Invariants
  const total = add(add(sum(shares.map((s) => s.fraction)), reserved), escheat);
  if (!eq(total, ONE)) throw new Error(`invariant failed: shares sum to ${total.n}/${total.d}`);
  if (shares.some((s) => cmp(s.fraction, ZERO) < 0)) throw new Error('invariant failed: negative share');

  return {
    caseId: c.id,
    lawSystem: c.lawSystem,
    policyVersion: c.policy.policyVersion,
    base,
    shares,
    reserved,
    escheat,
    notes: [...notes, ...main.out.notes],
    needsVerification: scenarios.some((s) => s.run.out.needsVerification),
  };
}
