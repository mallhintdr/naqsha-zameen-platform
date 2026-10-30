/**
 * Relations are DERIVED from the graph (parents + unions), never stored as labels.
 * deriveRelations() classifies every person relative to the deceased.
 */
import type { Case, Gender, Person } from './types.ts';

export type Blood = 'full' | 'consanguine' | 'uterine';

export interface Relation {
  personId: string;
  gender: Gender;
  /** Stable key used for labels (EN/UR) and the share table. */
  key: string;
  kind:
    | 'deceased' | 'spouse' | 'father' | 'mother' | 'agnatic-ancestor' | 'true-grandmother'
    | 'agnatic-descendant' | 'sibling' | 'agnatic-collateral' | 'distant-kindred' | 'unrelated';
  /** agnatic-descendant: generation (1 = child). agnatic-ancestor: generation (2 = grandfather). */
  level: number;
  blood?: Blood;
  /**
   * Agnatic collateral (descendant through males of the deceased's agnatic ancestor A[cls]):
   * cls 1 = father's line (brothers, their sons), 2 = grandfather's line (uncles, cousins)...
   * dist = generations below that ancestor. `full` = branch shares the mother too.
   */
  agnatic?: { cls: number; dist: number; full: boolean };
  /** Spouse marital state at death. */
  spouseState?: 'married' | 'divorced-revocable' | 'divorced';
  /** Distant kindred: class 1..4 and generations from the common ancestor. */
  dk?: { cls: number; degree: number };
  /** Grandmother: generations up from the deceased and side. */
  gm?: { level: number; paternal: boolean };
}

export interface Graph {
  byId: Map<string, Person>;
  father: (id: string) => string | undefined;
  mother: (id: string) => string | undefined;
  children: (id: string) => string[];
}

export function buildGraph(c: Case): Graph {
  const byId = new Map(c.persons.map((p) => [p.id, p]));
  const fatherOf = new Map<string, string>();
  const motherOf = new Map<string, string>();
  const kids = new Map<string, string[]>();
  for (const l of c.parents) {
    if (l.fatherId) { fatherOf.set(l.childId, l.fatherId); kids.set(l.fatherId, [...(kids.get(l.fatherId) ?? []), l.childId]); }
    if (l.motherId) { motherOf.set(l.childId, l.motherId); kids.set(l.motherId, [...(kids.get(l.motherId) ?? []), l.childId]); }
  }
  return {
    byId,
    father: (id) => fatherOf.get(id),
    mother: (id) => motherOf.get(id),
    children: (id) => [...new Set(kids.get(id) ?? [])],
  };
}

/** P, father(P), father(father(P)), ... */
function agnaticLine(g: Graph, id: string): string[] {
  const out = [id];
  const seen = new Set(out);
  for (let f = g.father(id); f && !seen.has(f); f = g.father(f)) { out.push(f); seen.add(f); }
  return out;
}

/** All ancestors with the gender path from `id` upward (excluding `id`). */
function ancestors(g: Graph, id: string): Map<string, Gender[]> {
  const out = new Map<string, Gender[]>();
  const walk = (cur: string, path: Gender[]) => {
    for (const [pid, gen] of [[g.father(cur), 'M'], [g.mother(cur), 'F']] as [string | undefined, Gender][]) {
      if (!pid || out.has(pid)) continue;
      const p = [...path, gen];
      out.set(pid, p);
      walk(pid, p);
    }
  };
  walk(id, []);
  return out;
}

const ord = (n: number) => (n <= 1 ? '' : `${'great-'.repeat(n - 2)}grand`);

export function deriveRelations(c: Case): Map<string, Relation> {
  const g = buildGraph(c);
  const D = c.deceasedId;
  const out = new Map<string, Relation>();
  const A = agnaticLine(g, D); // A[0] = D, A[1] = father, A[2] = grandfather...
  const dAnc = ancestors(g, D);

  for (const p of c.persons) {
    const base = { personId: p.id, gender: p.gender };
    if (p.id === D) { out.set(p.id, { ...base, key: 'deceased', kind: 'deceased', level: 0 }); continue; }

    // Spouse
    const union = c.unions.find((u) => u.partners.includes(D) && u.partners.includes(p.id));
    if (union) {
      const wife = p.gender === 'F';
      const revocable = (wife ? p.flags.divorced : c.persons.find((x) => x.id === D)?.flags.divorced) === 'revocable-in-iddat'
        || p.flags.divorced === 'revocable-in-iddat';
      const state = union.type === 'marriage' && !p.flags.divorced ? 'married'
        : revocable ? 'divorced-revocable' : 'divorced';
      out.set(p.id, { ...base, key: wife ? 'wife' : 'husband', kind: 'spouse', level: 0, spouseState: state });
      continue;
    }

    // Ancestors
    if (p.id === A[1]) { out.set(p.id, { ...base, key: 'father', kind: 'father', level: 1 }); continue; }
    if (p.id === g.mother(D)) { out.set(p.id, { ...base, key: 'mother', kind: 'mother', level: 1 }); continue; }
    const ai = A.indexOf(p.id);
    if (ai >= 2) { out.set(p.id, { ...base, key: `true-${ord(ai)}father`, kind: 'agnatic-ancestor', level: ai }); continue; }
    const up = dAnc.get(p.id);
    if (up) {
      // True grandmother: no male above a female on the path (mother's father breaks it).
      const falseLink = up.slice(0, -1).some((x, i) => x === 'F' && up[i + 1] === 'M');
      if (p.gender === 'F' && !falseLink) {
        out.set(p.id, { ...base, key: `true-${ord(up.length)}mother-${up[0] === 'M' ? 'paternal' : 'maternal'}`, kind: 'true-grandmother', level: up.length, gm: { level: up.length, paternal: up[0] === 'M' } });
      } else {
        out.set(p.id, { ...base, key: 'false-ancestor', kind: 'distant-kindred', level: up.length, dk: { cls: 2, degree: up.length } });
      }
      continue;
    }

    // Agnatic descendants and agnatic collaterals (through males only). The deceased's own child is
    // a son / daughter whether the deceased is the father or the mother; below that the line runs
    // through males (son's son, son's daughter...).
    const line = agnaticLine(g, p.id);
    let k = line.indexOf(D);
    if (k < 0) { const j = line.findIndex((x) => g.mother(x) === D); if (j >= 0) k = j + 1; }
    if (k >= 1) {
      const key = k === 1 ? (p.gender === 'M' ? 'son' : 'daughter') : `${'sons-'.repeat(k - 1)}${p.gender === 'M' ? 'son' : 'daughter'}`;
      out.set(p.id, { ...base, key, kind: 'agnatic-descendant', level: k });
      continue;
    }

    // Siblings (father and/or mother shared)
    const sameF = !!g.father(D) && g.father(D) === g.father(p.id);
    const sameM = !!g.mother(D) && g.mother(D) === g.mother(p.id);
    if (sameF || sameM) {
      const blood: Blood = sameF && sameM ? 'full' : sameF ? 'consanguine' : 'uterine';
      out.set(p.id, { ...base, key: `${blood}-${p.gender === 'M' ? 'brother' : 'sister'}`, kind: 'sibling', level: 1, blood, agnatic: blood === 'uterine' ? undefined : { cls: 1, dist: 1, full: blood === 'full' } });
      continue;
    }

    // Agnatic collaterals: p descends through males from A[j] (j >= 1), not via A[j-1].
    let placed = false;
    for (let j = 1; j < A.length && !placed; j++) {
      const kk = line.indexOf(A[j]);
      if (kk >= 1 && line[kk - 1] !== A[j - 1]) {
        const branch = line[kk - 1];
        const full = !!g.mother(branch) && g.mother(branch) === g.mother(A[j - 1]);
        const isMale = p.gender === 'M';
        const key = j === 1
          ? `${full ? 'full' : 'consanguine'}-brothers-${'sons-'.repeat(Math.max(0, kk - 2))}${isMale ? 'son' : 'daughter'}`
          : `${full ? 'full' : 'consanguine'}-paternal-${ord(j - 1)}${kk === 1 ? (isMale ? 'uncle' : 'aunt') : `uncles-${'sons-'.repeat(kk - 2)}${isMale ? 'son' : 'daughter'}`}`;
        if (isMale) out.set(p.id, { ...base, key, kind: 'agnatic-collateral', level: kk, agnatic: { cls: j, dist: kk, full } });
        // Females of the agnatic line beyond sisters are distant kindred (brother's daughter, paternal aunt...).
        else out.set(p.id, { ...base, key, kind: 'distant-kindred', level: kk, dk: { cls: j === 1 ? 3 : 4, degree: kk + j } });
        placed = true;
      }
    }
    if (placed) continue;

    // Everyone else: classify by lowest common ancestor (distant kindred) or unrelated.
    const pAnc = ancestors(g, p.id);
    if (pAnc.has(D)) {
      out.set(p.id, { ...base, key: 'cognatic-descendant', kind: 'distant-kindred', level: pAnc.get(D)!.length, dk: { cls: 1, degree: pAnc.get(D)!.length } });
      continue;
    }
    let best: { up: number; down: number } | null = null;
    for (const [aid, path] of dAnc) {
      const down = pAnc.get(aid);
      if (down && (!best || path.length + down.length < best.up + best.down)) best = { up: path.length, down: down.length };
    }
    if (best) {
      out.set(p.id, { ...base, key: best.up === 1 ? 'sibling-descendant' : 'uncle-aunt-line', kind: 'distant-kindred', level: best.down, dk: { cls: best.up === 1 ? 3 : 4, degree: best.up + best.down } });
    } else {
      out.set(p.id, { ...base, key: 'unrelated', kind: 'unrelated', level: 0 });
    }
  }
  return out;
}
