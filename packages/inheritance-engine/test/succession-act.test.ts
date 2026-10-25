// Succession Act 1925: Christian (Part V) and Parsi (Chapter III, 1939 text).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseBuilder, compute, toString, type ComputeResult } from '../src/index.ts';

const share = (r: ComputeResult, id: string) => toString(r.shares.find((s) => s.personId === id)!.fraction);
const xian = (g: 'M' | 'F' = 'M') => new CaseBuilder('christian', { gender: g, religion: 'christian' });

test('Christian s.33/35: widow 1/3, children equally regardless of gender', () => {
  const b = xian();
  const w = b.spouse({ religion: 'christian' }), s = b.child('M', { religion: 'christian' }), d = b.child('F', { religion: 'christian' });
  const r = compute(b.build());
  assert.deepEqual([share(r, w), share(r, s), share(r, d)], ['1/3', '1/3', '1/3']);
});

test("Christian s.38-40: predeceased child's children per stirpes", () => {
  const b = xian();
  const s = b.child('M', { religion: 'christian' });
  const d = b.child('F', { religion: 'christian', alive: false, dateOfDeath: '2020-01-01' });
  const g1 = b.childOf(d, 'M', { religion: 'christian' }), g2 = b.childOf(d, 'F', { religion: 'christian' });
  const r = compute(b.build());
  assert.deepEqual([share(r, s), share(r, g1), share(r, g2)], ['1/2', '1/4', '1/4']);
});

test('Christian s.33/42: widow 1/2 and father the rest; s.43 mother and siblings equally', () => {
  const b = xian();
  const w = b.spouse({ religion: 'christian' }), f = b.father({ religion: 'christian' });
  let r = compute(b.build());
  assert.deepEqual([share(r, w), share(r, f)], ['1/2', '1/2']);
  const b2 = xian();
  const m = b2.mother({ religion: 'christian' }), s1 = b2.sibling('M', 'full', { religion: 'christian' }), s2 = b2.sibling('F', 'consanguine', { religion: 'christian' });
  r = compute(b2.build());
  assert.deepEqual([share(r, m), share(r, s1), share(r, s2)], ['1/3', '1/3', '1/3']);
});

test('Christian: no religion bar; illegitimate is not kindred; sole spouse takes all', () => {
  const b = xian();
  const s = b.child('M', { religion: 'muslim' }), d = b.child('F', { religion: 'christian', flags: { illegitimate: true } });
  let r = compute(b.build());
  assert.deepEqual([share(r, s), share(r, d)], ['1', '0']);
  const b2 = xian(); const w = b2.spouse({ religion: 'christian' });
  r = compute(b2.build());
  assert.equal(share(r, w), '1');
});

test('Parsi s.51 (1939): widow = son, daughter = half a son, father = half a son, mother = half a daughter', () => {
  const b = new CaseBuilder('parsi', { religion: 'parsi' });
  const w = b.spouse({ religion: 'parsi' }), s = b.child('M', { religion: 'parsi' }), d = b.child('F', { religion: 'parsi' }), f = b.father({ religion: 'parsi' }), m = b.mother({ religion: 'parsi' });
  const r = compute(b.build());
  // parts 4 + 4 + 2 + 2 + 1 = 13
  assert.deepEqual([share(r, w), share(r, s), share(r, d), share(r, f), share(r, m)], ['4/13', '4/13', '2/13', '2/13', '1/13']);
  assert.equal(r.needsVerification, true);
});

test('Parsi s.52: female intestate, widower and each child equal', () => {
  const b = new CaseBuilder('parsi', { religion: 'parsi', gender: 'F' });
  const h = b.spouse({ religion: 'parsi' }), s = b.child('M', { religion: 'parsi' }), d = b.child('F', { religion: 'parsi' });
  const r = compute(b.build());
  assert.deepEqual([share(r, h), share(r, s), share(r, d)], ['1/3', '1/3', '1/3']);
});
