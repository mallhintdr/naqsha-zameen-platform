// Deterministic layered layout: generations as rows (ancestors above, deceased row, descendants
// below). Within a row, people are ordered by their parents' position; spouses sit next to each other.
import type { Case } from 'inheritance-engine';
import { childrenOf, fatherOf, motherOf, spousesOf } from './model.ts';

export const NODE_W = 132;
export const NODE_H = 92;
export const GAP_X = 18;
export const ROW_H = 165;

export interface Placed { id: string; x: number; y: number; gen: number }

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
    inRow.sort((a, b) => key(a) - key(b) || order(a) - order(b));
    // Put the deceased's row with the deceased after its siblings, spouses right after partners.
    const placed: string[] = [];
    const push = (id: string) => {
      if (placed.includes(id)) return;
      placed.push(id);
      // Patwari style: first wife on the left of her husband, second on the right, alternating.
      const sp = spousesOf(c, id).filter((s) => gen.get(s) === r && !placed.includes(s) && !(fatherOf(c, s) || motherOf(c, s)));
      sp.forEach((s, i) => {
        const at = placed.indexOf(id);
        if (i % 2 === 0) placed.splice(at, 0, s); else placed.splice(at + 1 + Math.floor(i / 2), 0, s);
      });
    };
    for (const id of inRow) push(id);
    // Spouses that have their own parents may be far apart; keep them in sorted position.
    placed.forEach((id, i) => nodes.set(id, { id, x: i * (NODE_W + GAP_X), y: 0, gen: r }));
  }

  // 2. Ancestor rows: centre each parent couple above their children (bottom-up), then
  //    shift rows so nothing overlaps.
  for (const r of [...rows].reverse()) {
    if (r >= 0) continue;
    const inRow = [...nodes.values()].filter((n) => n.gen === r).sort((a, b) => a.x - b.x);
    for (const n of inRow) {
      const kids = childrenOf(c, n.id).map((k) => nodes.get(k)).filter((k) => k && k.gen === r + 1) as Placed[];
      if (kids.length) {
        const mid = kids.reduce((a, k) => a + k.x, 0) / kids.length;
        const partner = spousesOf(c, n.id).map((s) => nodes.get(s)).find((s) => s && s.gen === r);
        n.x = partner ? mid - (n.x < partner.x ? (NODE_W + GAP_X) / 2 : -(NODE_W + GAP_X) / 2) : mid;
      }
    }
    inRow.sort((a, b) => a.x - b.x);
    for (let i = 1; i < inRow.length; i++) {
      const min = inRow[i - 1].x + NODE_W + GAP_X;
      if (inRow[i].x < min) inRow[i].x = min;
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
      const ps = [f, m].map((id) => (id ? nodes.get(id) : undefined)).filter((p) => p && p.gen === r - 1) as Placed[];
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
