import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseBuilder, compute, combine, toString } from '../src/index.ts';

test('munasakha: a son who died after his father passes his share to his widow and daughter', () => {
  // Stage 1: father dies leaving widow W and sons S1, S2 (S2 dies a year later).
  const b = new CaseBuilder('sunni-hanafi', { name: 'Father' }, '2024-01-01');
  const w = b.spouse(), s1 = b.child('M'), s2 = b.child('M', { alive: false, dateOfDeath: '2025-01-01' });
  const r1 = compute(b.build());
  assert.deepEqual([w, s1, s2].map((id) => toString(r1.shares.find((s) => s.personId === id)!.fraction)), ['1/8', '7/16', '7/16']);
  // Stage 2: S2's own estate: his widow, his daughter, and his mother W (same person id).
  const b2 = new CaseBuilder('sunni-hanafi', { name: 'S2' }, '2025-01-01');
  b2.c.deceasedId = 'D';
  // Different ids from stage 1, except the mother, who is the same person (W).
  const sw = b2.spouse({ id: 'S2-widow' }), sd = b2.child('F', { id: 'S2-daughter' }), sm = b2.mother({ id: w } as never);
  const r2 = compute(b2.build());
  const all = combine(r1, [{ heirId: s2, result: r2 }]);
  const get = (id: string) => toString(all.shares.find((s) => s.personId === id)!.fraction);
  // S2's 7/16: widow 1/8, daughter 1/2, mother 1/6, residue 5/24 -> no residuary: radd to daughter+mother (3:1)
  // daughter 1/2 + 5/24*3/4 = 21/32, mother 1/6 + 5/24*1/4 = 7/32
  assert.equal(get(sw), toString({ n: 7n, d: 128n }));
  assert.equal(get(sd), toString({ n: 147n, d: 512n }));
  assert.equal(get(w), toString({ n: 113n, d: 512n })); // 1/8 + 7/16 * 7/32
  assert.equal(get(s1), '7/16');
  void sm;
});
