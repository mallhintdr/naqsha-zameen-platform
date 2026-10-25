/**
 * Sunni (Hanafi default) fara'id. Input: eligible heirs (alive at death, no capacity bar).
 * Output: provisional fractions after aul / radd / distant kindred / escheat.
 * Rule IDs are listed in README.md with their sources (citation keys -> law/citations.json).
 */
import { add, cmp, commonBase, div, frac, isZero, mul, ONE, share, sub, sum, ZERO, type Fraction } from '../fraction.ts';
import type { Relation } from '../relations.ts';
import type { ExplainEntry, PolicyToggles } from '../types.ts';

export interface RuleOutput {
  shares: Map<string, Fraction>;
  reasons: Map<string, ExplainEntry[]>;
  excluded: Map<string, ExplainEntry[]>;
  notes: ExplainEntry[];
  escheat: Fraction;
  needsVerification: boolean;
}

const Q = 'quran-4-11';
const Q12 = 'quran-4-12';
const Q176 = 'quran-4-176';
const SUNNAH = 'hanafi-consensus';

type Group = { ids: string[]; weights: bigint[] };

export function sunniShares(heirs: Relation[], policy: PolicyToggles): RuleOutput {
  const shares = new Map<string, Fraction>();
  const reasons = new Map<string, ExplainEntry[]>();
  const excluded = new Map<string, ExplainEntry[]>();
  const notes: ExplainEntry[] = [];
  let needsVerification = false;

  const why = (id: string, ruleId: string, citationKey: string, params?: Record<string, string>) =>
    reasons.set(id, [...(reasons.get(id) ?? []), { ruleId, i18nKey: ruleId, citationKey, params }]);
  const exclude = (ids: string[], ruleId: string, by: string, citationKey = SUNNAH) => {
    for (const id of ids) if (!shares.has(id) && !excluded.has(id)) excluded.set(id, [{ ruleId, i18nKey: ruleId, citationKey, params: { by } }]);
  };
  const give = (ids: string[], total: Fraction, ruleId: string, citationKey: string) => {
    if (!ids.length) return;
    const each = share(total, BigInt(ids.length));
    for (const id of ids) { shares.set(id, add(shares.get(id) ?? ZERO, each)); why(id, ruleId, citationKey, { total: `${total.n}/${total.d}`, count: String(ids.length) }); }
  };

  const ids = (f: (r: Relation) => boolean) => heirs.filter(f).map((r) => r.personId);
  const husband = ids((r) => r.kind === 'spouse' && r.gender === 'M');
  const wives = ids((r) => r.kind === 'spouse' && r.gender === 'F');
  const father = ids((r) => r.kind === 'father')[0];
  const mother = ids((r) => r.kind === 'mother')[0];
  const gfLevel = Math.min(...heirs.filter((r) => r.kind === 'agnatic-ancestor').map((r) => r.level));
  const gf = father ? undefined : heirs.find((r) => r.kind === 'agnatic-ancestor' && r.level === gfLevel)?.personId;
  const desc = heirs.filter((r) => r.kind === 'agnatic-descendant');
  const anyChild = desc.length > 0;
  const maleDesc = desc.some((r) => r.gender === 'M');
  const femaleDesc = desc.some((r) => r.gender === 'F');
  const sib = (blood: string, g: 'M' | 'F') => ids((r) => r.kind === 'sibling' && r.blood === blood && r.gender === g);
  const fullB = sib('full', 'M'), fullS = sib('full', 'F'), consB = sib('consanguine', 'M'), consS = sib('consanguine', 'F');
  const uter = ids((r) => r.kind === 'sibling' && r.blood === 'uterine');
  const allSiblings = fullB.length + fullS.length + consB.length + consS.length + uter.length;

  // ---- spouses
  if (husband.length) give(husband, anyChild ? frac(1, 4) : frac(1, 2), anyChild ? 'sunni.husband.quarter' : 'sunni.husband.half', Q12);
  if (wives.length) give(wives, anyChild ? frac(1, 8) : frac(1, 4), anyChild ? 'sunni.wife.eighth' : 'sunni.wife.quarter', Q12);
  const spouseShare = sum([...husband, ...wives].map((id) => shares.get(id)!));

  // ---- father / grandfather (fixed part)
  const ascendant = father ?? gf;
  if (ascendant && maleDesc) give([ascendant], frac(1, 6), father ? 'sunni.father.sixth' : 'sunni.grandfather.sixth', Q);
  if (ascendant && !maleDesc && femaleDesc) give([ascendant], frac(1, 6), father ? 'sunni.father.sixth-plus-residue' : 'sunni.grandfather.sixth-plus-residue', Q);
  if (gf && !father) why(gf, 'sunni.grandfather.replaces-father', SUNNAH);
  // ascendant with no descendants: pure residuary (below)

  // ---- mother
  if (mother) {
    if (anyChild || allSiblings >= 2) give([mother], frac(1, 6), anyChild ? 'sunni.mother.sixth-children' : 'sunni.mother.sixth-siblings', Q);
    else if (father && (husband.length || wives.length)) {
      give([mother], mul(frac(1, 3), sub(ONE, spouseShare)), 'sunni.mother.umariyyatan', 'umariyyatan');
    } else give([mother], frac(1, 3), 'sunni.mother.third', Q);
  }

  // ---- true grandmothers (1/6 shared)
  const gms = heirs.filter((r) => r.kind === 'true-grandmother');
  if (gms.length) {
    if (mother) exclude(gms.map((r) => r.personId), 'sunni.grandmother.excluded-by-mother', 'mother');
    else {
      const ok = gms.filter((r) => {
        if (!r.gm!.paternal) return true;
        if (father) { exclude([r.personId], 'sunni.grandmother.excluded-by-father', 'father'); return false; }
        // An agnatic ancestor below her on the paternal line excludes her (her own son or nearer).
        const nearerAnc = heirs.some((a) => a.kind === 'agnatic-ancestor' && a.level < r.gm!.level);
        if (nearerAnc) { exclude([r.personId], 'sunni.grandmother.excluded-by-grandfather', 'grandfather'); return false; }
        return true;
      });
      const nearest = Math.min(...ok.map((r) => r.gm!.level));
      const take = ok.filter((r) => r.gm!.level === nearest);
      exclude(ok.filter((r) => r.gm!.level !== nearest).map((r) => r.personId), 'sunni.grandmother.excluded-by-nearer', 'nearer grandmother');
      give(take.map((r) => r.personId), frac(1, 6), 'sunni.grandmother.sixth', SUNNAH);
    }
  }

  // ---- descendants (agnatic): daughters / son's daughters at every level
  const levels = [...new Set(desc.map((r) => r.level))].sort((a, b) => a - b);
  const firstMaleLevel = Math.min(...desc.filter((r) => r.gender === 'M').map((r) => r.level));
  let daughterQuota = ZERO; // what female descendants above took (max 2/3)
  const unsharedFemales: string[] = []; // excluded-by-2/3 females who may join a lower male
  let residuary: Group | null = null;
  for (const L of levels) {
    const females = desc.filter((r) => r.level === L && r.gender === 'F').map((r) => r.personId);
    const males = desc.filter((r) => r.level === L && r.gender === 'M').map((r) => r.personId);
    if (L < firstMaleLevel) {
      if (!females.length) continue;
      if (isZero(daughterQuota)) {
        const t = females.length === 1 ? frac(1, 2) : frac(2, 3);
        give(females, t, L === 1 ? (females.length === 1 ? 'sunni.daughter.half' : 'sunni.daughters.two-thirds') : (females.length === 1 ? 'sunni.sons-daughter.half' : 'sunni.sons-daughters.two-thirds'), Q);
        daughterQuota = t;
      } else if (cmp(daughterQuota, frac(1, 2)) === 0 && !residuary) {
        give(females, frac(1, 6), 'sunni.sons-daughter.sixth-completion', SUNNAH);
        daughterQuota = frac(2, 3);
      } else {
        unsharedFemales.push(...females);
      }
    } else if (L === firstMaleLevel) {
      const groupIds = [...unsharedFemales, ...females, ...males];
      residuary = { ids: groupIds, weights: groupIds.map((id) => (males.includes(id) ? 2n : 1n)) };
      for (const id of groupIds) why(id, L === 1 ? 'sunni.children.residue-2-1' : 'sunni.agnatic-descendants.residue-2-1', Q);
    } else {
      exclude([...females, ...males], 'sunni.descendant.excluded-by-nearer-male', 'nearer male descendant');
    }
  }
  exclude(unsharedFemales.filter((id) => !residuary?.ids.includes(id)), 'sunni.sons-daughter.excluded-by-daughters', 'two or more daughters');

  // ---- uterine siblings
  if (uter.length) {
    if (anyChild || father || gf) exclude(uter, 'sunni.uterine.excluded', anyChild ? 'child' : father ? 'father' : 'grandfather');
    else give(uter, uter.length === 1 ? frac(1, 6) : frac(1, 3), uter.length === 1 ? 'sunni.uterine.sixth' : 'sunni.uterine.third', Q12);
  }

  // ---- full / consanguine siblings
  const gfBlocks = !!gf && policy.grandfatherExcludesSiblings;
  const siblingBlocker = maleDesc ? 'son' : father ? 'father' : gfBlocks ? 'grandfather' : '';
  let siblingGroup: Group | null = null;
  let gfWithSiblings = false;
  if (siblingBlocker) {
    exclude([...fullB, ...fullS, ...consB, ...consS], 'sunni.siblings.excluded', siblingBlocker);
  } else if (!residuary) {
    if (fullB.length) {
      siblingGroup = { ids: [...fullB, ...fullS], weights: [...fullB.map(() => 2n), ...fullS.map(() => 1n)] };
      for (const id of siblingGroup.ids) why(id, 'sunni.full-siblings.residue-2-1', Q176);
      exclude([...consB, ...consS], 'sunni.consanguine.excluded-by-full-brother', 'full brother');
    } else if (fullS.length && femaleDesc) {
      siblingGroup = { ids: fullS, weights: fullS.map(() => 1n) };
      for (const id of fullS) why(id, 'sunni.full-sister.residue-with-daughter', SUNNAH);
      exclude([...consB, ...consS], 'sunni.consanguine.excluded-by-full-sister-residuary', 'full sister (residuary)');
    } else {
      if (fullS.length) give(fullS, fullS.length === 1 ? frac(1, 2) : frac(2, 3), fullS.length === 1 ? 'sunni.full-sister.half' : 'sunni.full-sisters.two-thirds', Q176);
      if (consB.length) {
        siblingGroup = { ids: [...consB, ...consS], weights: [...consB.map(() => 2n), ...consS.map(() => 1n)] };
        for (const id of siblingGroup.ids) why(id, 'sunni.consanguine-siblings.residue-2-1', Q176);
      } else if (consS.length) {
        if (fullS.length >= 2) exclude(consS, 'sunni.consanguine-sister.excluded-by-full-sisters', 'two or more full sisters');
        else if (fullS.length === 1) give(consS, frac(1, 6), 'sunni.consanguine-sister.sixth-completion', SUNNAH);
        else if (femaleDesc) {
          siblingGroup = { ids: consS, weights: consS.map(() => 1n) };
          for (const id of consS) why(id, 'sunni.consanguine-sister.residue-with-daughter', SUNNAH);
        } else give(consS, consS.length === 1 ? frac(1, 2) : frac(2, 3), consS.length === 1 ? 'sunni.consanguine-sister.half' : 'sunni.consanguine-sisters.two-thirds', Q176);
      }
    }
    // Grandfather sharing with siblings (Shafi'i / Maliki / Hanbali): joins as a brother.
    if (gf && !policy.grandfatherExcludesSiblings && (fullB.length + fullS.length + consB.length + consS.length) > 0) {
      gfWithSiblings = true;
      needsVerification = true;
    }
  } else {
    exclude([...fullB, ...fullS, ...consB, ...consS], 'sunni.siblings.excluded', 'son');
  }

  // ---- choose the residuary group
  const collaterals = heirs.filter((r) => r.kind === 'agnatic-collateral' && r.agnatic && !(r.agnatic.cls === 1 && r.agnatic.dist === 1));
  if (!residuary && ascendant && !maleDesc && !gfWithSiblings) {
    residuary = { ids: [ascendant], weights: [1n] };
    why(ascendant, femaleDesc ? (father ? 'sunni.father.residue' : 'sunni.grandfather.residue') : (father ? 'sunni.father.residuary' : 'sunni.grandfather.residuary'), SUNNAH);
  }
  if (!residuary && siblingGroup) {
    if (gfWithSiblings && gf) siblingGroup = { ids: [gf, ...siblingGroup.ids], weights: [2n, ...siblingGroup.weights] };
    residuary = siblingGroup;
  }
  if (!residuary && gfWithSiblings && gf) residuary = { ids: [gf], weights: [1n] };
  if (!residuary && collaterals.length) {
    collaterals.sort((a, b) => a.agnatic!.cls - b.agnatic!.cls || a.agnatic!.dist - b.agnatic!.dist || (a.agnatic!.full === b.agnatic!.full ? 0 : a.agnatic!.full ? -1 : 1));
    const top = collaterals[0].agnatic!;
    // Father and the true grandfather exclude every agnatic collateral (brothers' sons, uncles...).
    if (father || gf) {
      exclude(collaterals.map((r) => r.personId), 'sunni.collateral.excluded-by-ascendant', father ? 'father' : 'grandfather');
    } else {
      const win = collaterals.filter((r) => r.agnatic!.cls === top.cls && r.agnatic!.dist === top.dist && r.agnatic!.full === top.full);
      residuary = { ids: win.map((r) => r.personId), weights: win.map(() => 1n) };
      for (const r of win) why(r.personId, 'sunni.agnatic-residuary', SUNNAH, { relation: r.key });
      exclude(collaterals.filter((r) => !win.includes(r)).map((r) => r.personId), 'sunni.collateral.excluded-by-nearer', 'nearer agnatic heir');
    }
  } else if (collaterals.length) {
    exclude(collaterals.map((r) => r.personId), 'sunni.collateral.excluded-by-nearer', 'nearer heir');
  }

  // ---- totals: aul, residue, radd, distant kindred, escheat
  const sharerTotal = sum([...shares.values()]);
  let escheat = ZERO;
  if (cmp(sharerTotal, ONE) > 0) {
    // Aul: every share is reduced proportionally; any residuary gets nothing.
    const fromBase = commonBase([...shares.values()]);
    const toBase = (sharerTotal.n * fromBase) / sharerTotal.d;
    for (const [id, f] of shares) shares.set(id, div(f, sharerTotal));
    notes.push({ ruleId: 'sunni.aul', i18nKey: 'sunni.aul', citationKey: 'aul-umar', params: { from: `${fromBase}`, to: `${toBase}` } });
    if (residuary) exclude(residuary.ids.filter((id) => !shares.has(id)), 'sunni.residuary.nothing-left', 'aul');
  } else {
    const residue = sub(ONE, sharerTotal);
    if (residuary && !isZero(residue)) {
      if (gfWithSiblings && gf && residuary.ids.length > 1) {
        // Grandfather takes the best of: share as a brother, 1/3 of the residue... , 1/6 of the estate.
        const totalW = residuary.weights.reduce((a, b) => a + b, 0n);
        const asBrother = mul(residue, frac(2n, totalW));
        const third = isZero(sub(sharerTotal, ZERO)) ? frac(1, 3) : mul(residue, frac(1, 3));
        const sixth = frac(1, 6);
        let g = asBrother;
        if (cmp(third, g) > 0) g = third;
        if (cmp(sixth, g) > 0 && cmp(sixth, residue) <= 0) g = sixth;
        shares.set(gf, add(shares.get(gf) ?? ZERO, g));
        why(gf, 'sunni.grandfather.best-of-three', 'zayd-ibn-thabit');
        const rest = sub(residue, g);
        const others = { ids: residuary.ids.slice(1), weights: residuary.weights.slice(1) };
        distribute(others, rest);
      } else distribute(residuary, residue);
    } else if (residuary && isZero(residue)) {
      exclude(residuary.ids.filter((id) => !shares.has(id)), 'sunni.residuary.nothing-left', 'sharers');
    } else if (!residuary && cmp(residue, ZERO) > 0) {
      const spouses = new Set([...husband, ...wives]);
      const blood = [...shares.keys()].filter((id) => !spouses.has(id));
      const dk = heirs.filter((r) => r.kind === 'distant-kindred' && r.dk);
      if (blood.length) {
        // Radd: surplus to blood sharers in proportion; spouse keeps the fixed share.
        const bloodTotal = sum(blood.map((id) => shares.get(id)!));
        const pool = sub(ONE, spouseShare);
        for (const id of blood) shares.set(id, mul(pool, div(shares.get(id)!, bloodTotal)));
        notes.push({ ruleId: 'sunni.radd', i18nKey: 'sunni.radd', citationKey: SUNNAH });
        exclude(dk.map((r) => r.personId), 'sunni.distant-kindred.excluded-by-sharer', 'sharer (radd)');
      } else if (dk.length) {
        distantKindred(dk, residue);
      } else if (spouses.size && policy.raddToSpouseWhenNoOtherHeir) {
        const sp = [...spouses];
        for (const id of sp) shares.set(id, add(shares.get(id)!, share(residue, BigInt(sp.length))));
        for (const id of sp) why(id, 'sunni.radd.to-spouse', 'pk-practice-radd-spouse');
        notes.push({ ruleId: 'sunni.radd.to-spouse', i18nKey: 'sunni.radd.to-spouse', citationKey: 'pk-practice-radd-spouse' });
      } else {
        escheat = residue;
        notes.push({ ruleId: 'escheat', i18nKey: 'escheat', citationKey: 'escheat' });
      }
    }
    if (residuary) exclude(heirs.filter((r) => r.kind === 'distant-kindred').map((r) => r.personId), 'sunni.distant-kindred.excluded-by-residuary', 'residuary');
  }

  return { shares, reasons, excluded, notes, escheat, needsVerification };

  function distribute(g: Group, amount: Fraction) {
    const total = g.weights.reduce((a, b) => a + b, 0n);
    g.ids.forEach((id, i) => shares.set(id, add(shares.get(id) ?? ZERO, mul(amount, frac(g.weights[i], total)))));
  }

  // Hanafi distant kindred (simplified): nearest class, then nearest degree, male 2 : female 1.
  function distantKindred(dk: Relation[], amount: Fraction) {
    needsVerification = true;
    const cls = Math.min(...dk.map((r) => r.dk!.cls));
    const inCls = dk.filter((r) => r.dk!.cls === cls);
    const deg = Math.min(...inCls.map((r) => r.dk!.degree));
    const win = inCls.filter((r) => r.dk!.degree === deg);
    distribute({ ids: win.map((r) => r.personId), weights: win.map((r) => (r.gender === 'M' ? 2n : 1n)) }, amount);
    for (const r of win) why(r.personId, 'sunni.distant-kindred', 'hanafi-dhawil-arham', { cls: String(cls) });
    exclude(dk.filter((r) => !win.includes(r)).map((r) => r.personId), 'sunni.distant-kindred.excluded-by-nearer', 'nearer distant kindred');
    notes.push({ ruleId: 'sunni.distant-kindred', i18nKey: 'sunni.distant-kindred', citationKey: 'hanafi-dhawil-arham' });
  }
}
