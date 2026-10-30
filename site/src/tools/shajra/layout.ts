// Deterministic layered layout: generations as rows (ancestors above, deceased row, descendants
// below). Within a row, people are ordered by their parents' position; spouses sit next to each other.
import type { Case } from 'inheritance-engine';
import { childrenOf, fatherOf, motherOf, spousesOf } from './model.ts';

// Spacing: 127.5 px from one person to the next in a row, 124 px from one generation to the next.
export const NODE_W = 112;
export const NODE_H = 92;
export const GAP_X = 15.5;
export const ROW_H = 124;

export interface Placed { id: string; x: number; y: number; gen: number }

/** Manual left / right order set by the user (person id -> position in the row). Saved with the case. */
export type WithLayout = Case & { layoutRank?: Record<string, number> };

export function layout(c: Case): { nodes: Map<string, Placed>; width: number; height: number } {
  // 1. generation of each person (BFS from the deceased).
  const gen = new Map<string, number>([[c.deceasedId, 0]]);
  const queue = [c.deceasedId];
  while (queue.length) {
    const id = queue.shift()!;
    const g = gen.get(id)!;
    const next: [string | undefined, number][] = [
      [fatherOf(c, id), g - 1], [motherOf(c, id), g - 1],
      ...childrenOf(c, id).map((k) => [k, g + 1] as [string, number]),
      ...spousesOf(c, id).map((s) => [s, g] as [string, number]),
    ];
    for (const [n, ng] of next) if (n && !gen.has(n)) { gen.set(n, ng); queue.push(n); }
  }
  for (const p of c.persons) if (!gen.has(p.id)) gen.set(p.id, 0);

  const rows = [...new Set(gen.values())].sort((a, b) => a - b);
  const nodes = new Map<string, Placed>();
  const order = (id: string) => c.persons.findIndex((p) => p.id === id);
  // Sons before daughters among brothers and sisters.
  const gRank = (id: string) => (c.persons.find((p) => p.id === id)?.gender === 'F' ? 1 : 0);

  for (const r of rows) {
    const inRow = c.persons.map((p) => p.id).filter((id) => gen.get(id) === r);
    // Sort by parents' x (people without placed parents keep insertion order; the deceased's
    // paternal side first on ancestor rows).
    const key = (id: string) => {
      const ps = [fatherOf(c, id), motherOf(c, id)].map((p) => (p ? nodes.get(p) : undefined)).filter(Boolean) as Placed[];
      if (ps.length) return ps.reduce((a, p) => a + p.x, 0) / ps.length;
      // Ancestor rows: place by the child below that is already known later; use insertion order.
      return 1e6 + order(id);
    };
    inRow.sort((a, b) => key(a) - key(b) || gRank(a) - gRank(b) || order(a) - order(b));
    // The deceased first among the brothers and sisters, so a spouse can sit outside them.
    const sibOf = (a: string, b: string) => {
      const fa = fatherOf(c, a), ma = motherOf(c, a);
      return a !== b && ((!!fa && fa === fatherOf(c, b)) || (!!ma && ma === motherOf(c, b)));
    };
    // A spouse sits beside her / his partner, unless she / he has own brothers and sisters in this row
    // (a marriage within the family keeps the spouse with her / his own siblings).
    const besidePartner = (s: string) => !(fatherOf(c, s) || motherOf(c, s)) || !inRow.some((x) => sibOf(x, s));
    const di = inRow.indexOf(c.deceasedId);
    if (di > 0) {
      const first = inRow.findIndex((id) => sibOf(id, c.deceasedId));
      if (first >= 0 && first < di) { inRow.splice(di, 1); inRow.splice(first, 0, c.deceasedId); }
    }
    const placed: string[] = [];
    const push = (id: string) => {
      if (placed.includes(id)) return;
      placed.push(id);
      const sp = spousesOf(c, id).filter((s) => gen.get(s) === r && !placed.includes(s) && besidePartner(s));
      if (!sp.length) return;
      const female = c.persons.find((p) => p.id === id)?.gender === 'F';
      const sibsInRow = inRow.filter((x) => sibOf(x, id));
      if (sibsInRow.length) {
        // Brothers / sisters in this row: every spouse goes on the outer side, never between them.
        // First of the siblings: spouses on the left; otherwise on the right.
        const firstOfSibs = !placed.some((x) => x !== id && sibOf(x, id));
        const at = placed.indexOf(id);
        if (firstOfSibs) placed.splice(at, 0, ...sp.reverse()); else placed.splice(at + 1, 0, ...sp);
        return;
      }
      // Patwari style: first wife on the left of her husband, second on the right, alternating.
      // A woman's husband goes after her.
      sp.forEach((s, i) => {
        const at = placed.indexOf(id);
        if (!female && i % 2 === 0) placed.splice(at, 0, s); else placed.splice(at + 1 + (female ? i : Math.floor(i / 2)), 0, s);
      });
    };
    // A spouse who goes beside a partner waits for that partner (who is placed with her / his siblings).
    const waits = (id: string) => besidePartner(id) && spousesOf(c, id).some((s) => inRow.includes(s) && !besidePartner(s));
    for (const id of inRow) if (!waits(id)) push(id);
    for (const id of inRow) push(id); // anyone still left
    // Manual order (Move left / right): people the user moved keep their saved position.
    const rank = (c as WithLayout).layoutRank;
    if (rank && placed.some((id) => id in rank)) {
      const pos = new Map(placed.map((id, i) => [id, id in rank ? rank[id] : i]));
      placed.sort((a, b) => pos.get(a)! - pos.get(b)! || placed.indexOf(a) - placed.indexOf(b));
    }
    // Spouses that have their own parents may be far apart; keep them in sorted position.
    placed.forEach((id, i) => nodes.set(id, { id, x: i * (NODE_W + GAP_X), y: 0, gen: r }));
  }

  // 2. Ancestor rows, bottom-up: a father stands straight above his children (above the middle of
  //    them when there are several) with his wife / wives beside him on whichever side is free, so
  //    every stem is a straight line. When a family must move right to make room, the rows below it
  //    move with it, so its stem stays straight.
  const step = NODE_W + GAP_X;
  const female = (id: string) => c.persons.find((p) => p.id === id)?.gender === 'F';
  const kidsBelow = (id: string, r: number) =>
    childrenOf(c, id).map((k) => nodes.get(k)).filter((k): k is Placed => !!k && k.gen === r + 1);
  for (const r of [...rows].reverse()) {
    if (r >= 0) continue;
    const inRow = [...nodes.values()].filter((n) => n.gen === r).sort((a, b) => a.x - b.x);
    const inRowIds = new Set(inRow.map((n) => n.id));
    // Group = a man (or a woman without a husband in this row) + the spouses beside him.
    const used = new Set<string>();
    const groups: { anchor: Placed; left: Placed[]; right: Placed[]; sortX: number }[] = [];
    for (const n of inRow) {
      if (used.has(n.id)) continue;
      const partners = spousesOf(c, n.id).filter((s) => inRowIds.has(s) && !used.has(s)).map((s) => nodes.get(s)!);
      if (female(n.id) && partners.some((p) => !female(p.id))) continue; // her husband takes her
      used.add(n.id);
      partners.forEach((p) => used.add(p.id));
      groups.push({ anchor: n, left: partners.filter((p) => p.x < n.x), right: partners.filter((p) => p.x >= n.x), sortX: n.x });
    }
    const kidsOf = (g: (typeof groups)[number]) => [...new Set([g.anchor, ...g.left, ...g.right].flatMap((p) => kidsBelow(p.id, r)))];
    for (const g of groups) {
      const k = kidsOf(g);
      if (k.length) g.sortX = (Math.min(...k.map((x) => x.x)) + Math.max(...k.map((x) => x.x))) / 2;
    }
    groups.sort((a, b) => a.sortX - b.sortX);
    let free = -Infinity;
    for (const g of groups) {
      const kids = kidsOf(g);
      const own = kidsBelow(g.anchor.id, r);
      const ref = own.length ? own : kids;
      const want = ref.length ? (Math.min(...ref.map((x) => x.x)) + Math.max(...ref.map((x) => x.x))) / 2 : Math.max(free, g.anchor.x);
      const wives = [...g.left, ...g.right];
      // Wives on the left as before if there is room; else as many as fit on the left, the rest on the right.
      let L = g.left.length;
      if (free > want - L * step) {
        L = 0;
        for (let t = wives.length; t > 0; t--) if (free <= want - t * step) { L = t; break; }
      }
      const ax = Math.max(want, free + L * step);
      const delta = ax - want;
      wives.slice(0, L).forEach((w, i) => { w.x = ax - (L - i) * step; });
      g.anchor.x = ax;
      wives.slice(L).forEach((w, i) => { w.x = ax + (i + 1) * step; });
      free = ax + (wives.length - L + 1) * step;
      if (delta > 0.5 && kids.length) {
        const from = Math.min(...kids.map((x) => x.x)) - 1;
        for (const m of nodes.values()) if (m.gen > r && m.gen <= 0 && m.x >= from) m.x += delta;
      }
    }
  }

  // 2b. Descendant rows: centre each family (children of one couple) under its parents,
  //     left to right, never overlapping. A child's spouse stays next to the child.
  for (const r of rows) {
    if (r <= 0) continue;
    const inRow = [...nodes.values()].filter((n) => n.gen === r).sort((a, b) => a.x - b.x);
    const groups: { key: string; items: Placed[] }[] = [];
    for (const n of inRow) {
      const f = fatherOf(c, n.id), m = motherOf(c, n.id);
      if (f || m) {
        const key = `${f ?? ''}|${m ?? ''}`;
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.items.push(n); else groups.push({ key, items: [n] });
      } else if (groups.length) groups[groups.length - 1].items.push(n);
      else groups.push({ key: `solo-${n.id}`, items: [n] });
    }
    const step = NODE_W + GAP_X;
    let end = -Infinity;
    for (const g of groups) {
      const [f, m] = g.key.split('|');
      const wivesOfF = f ? c.unions.filter((u) => u.partners.includes(f)).length : 0;
      // A man with more than one wife: each wife's children sit under her (their line comes from her).
      const ps = (f && (wivesOfF <= 1 || !m) ? [f] : [m]).map((id) => (id ? nodes.get(id) : undefined)).filter((p) => p && p.gen === r - 1) as Placed[];
      const want = ps.length ? ps.reduce((a, p) => a + p.x, 0) / ps.length - ((g.items.length - 1) * step) / 2 : g.items[0].x;
      let x = Math.max(want, end + step);
      for (const n of g.items) { n.x = x; x += step; }
      end = x - step;
    }
  }

  // 3. Normalise: rows to y, shift so the left-most node is at 0.
  const minGen = Math.min(...rows);
  const minX = Math.min(...[...nodes.values()].map((n) => n.x));
  let width = 0;
  for (const n of nodes.values()) {
    n.x -= minX;
    n.y = (n.gen - minGen) * ROW_H;
    width = Math.max(width, n.x + NODE_W);
  }
  const height = (Math.max(...rows) - minGen) * ROW_H + NODE_H;
  return { nodes, width, height };
}
