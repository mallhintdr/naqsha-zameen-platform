// Shia (Ithna Ashari) golden cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseBuilder, compute, toString, type ComputeResult } from '../src/index.ts';

const share = (r: ComputeResult, id: string) => toString(r.shares.find((s) => s.personId === id)!.fraction);
const shia = (g: 'M' | 'F' = 'M', policy = {}) => new CaseBuilder('shia-ithna', { gender: g }, '2026-01-01', policy);

test('Shia: son and daughter 2 : 1, parents 1/6 each, wife 1/8', () => {
  const b = shia();
  const w = b.spouse(), f = b.father(), m = b.mother(), s = b.child('M'), d = b.child('F');
  const r = compute(b.build());
  assert.deepEqual([share(r, w), share(r, f), share(r, m), share(r, s), share(r, d)], ['1/8', '1/6', '1/6', '13/36', '13/72']);
});

test('Shia: no aul, the deficit falls on the daughters', () => {
  const b = shia('F');
  const h = b.spouse(), f = b.father(), m = b.mother(), d1 = b.child('F'), d2 = b.child('F');
  const r = compute(b.build());
  // husband 1/4, parents 1/6 + 1/6, daughters take the rest 5/12 (not 2/3)
  assert.deepEqual([share(r, h), share(r, f), share(r, m), share(r, d1), share(r, d2)], ['1/4', '1/6', '1/6', '5/24', '5/24']);
  assert.ok(r.notes.some((n) => n.ruleId === 'shia.no-aul'));
});

test('Shia: radd to daughter and parents, mother excluded when reduced by brothers', () => {
  const b = shia();
  const f = b.father(), m = b.mother(), d = b.child('F');
  let r = compute(b.build());
  // 1/2 + 1/6 + 1/6 = 5/6, surplus 1/6 shared 3:1:1 -> d 3/5, f 1/5, m 1/5
  assert.deepEqual([share(r, d), share(r, f), share(r, m)], ['3/5', '1/5', '1/5']);
  b.sibling('M'); b.sibling('M');
  r = compute(b.build());
  // mother keeps 1/6, surplus 1/6 to d and f 3:1 -> d 1/2 + 1/8 = 5/8, f 1/6 + 1/24 = 5/24
  assert.deepEqual([share(r, d), share(r, f), share(r, m)], ['5/8', '5/24', '1/6']);
});

test('Shia: no Umariyyatan, mother 1/3 of the whole', () => {
  const b = shia('F');
  const h = b.spouse(), f = b.father(), m = b.mother();
  const r = compute(b.build());
  assert.deepEqual([share(r, h), share(r, m), share(r, f)], ['1/2', '1/3', '1/6']);
});

test("Shia: representation, daughter's son with a living son of the deceased", () => {
  const b = shia('M', { applyMFLOs4: false });
  const s = b.child('M');
  const d = b.child('F', { alive: false, dateOfDeath: '2020-01-01' });
  const ds = b.childOf(d, 'M');
  const r = compute(b.build());
  assert.deepEqual([share(r, s), share(r, ds)], ['2/3', '1/3']);
});

test('Shia: class II, full brother and sister 2 : 1, uterine sister 1/6', () => {
  const b = shia();
  const fb = b.sibling('M'), fs = b.sibling('F'), us = b.sibling('F', 'uterine');
  const r = compute(b.build());
  assert.deepEqual([share(r, us), share(r, fb), share(r, fs)], ['1/6', '5/9', '5/18']);
});

test('Shia: sole husband takes all; sole widow per policy', () => {
  const b = shia('F'); const h = b.spouse();
  assert.equal(share(compute(b.build()), h), '1');
  const b2 = shia('M', { raddToSpouseWhenNoOtherHeir: false }); const w = b2.spouse();
  const r2 = compute(b2.build());
  assert.equal(share(r2, w), '1/4');
  assert.equal(toString(r2.escheat), '3/4');
});

test('Shia: only intentional killing bars', () => {
  const b = shia();
  const s1 = b.child('M', { flags: { killedDeceased: 'negligent' } }), s2 = b.child('M', { flags: { killedDeceased: 'intentional' } });
  const r = compute(b.build());
  assert.deepEqual([share(r, s1), share(r, s2)], ['1', '0']);
});
