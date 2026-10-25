// Golden Hanafi cases (classical worked examples). Run: npm test -w packages/inheritance-engine
import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseBuilder, compute, toString, type ComputeResult } from '../src/index.ts';

const share = (r: ComputeResult, id: string) => toString(r.shares.find((s) => s.personId === id)!.fraction);
const status = (r: ComputeResult, id: string) => r.shares.find((s) => s.personId === id)!.status;

test('son and daughter: 2 : 1', () => {
  const b = new CaseBuilder();
  const s = b.child('M'), d = b.child('F');
  const r = compute(b.build());
  assert.equal(share(r, s), '2/3');
  assert.equal(share(r, d), '1/3');
});

test('wife, son, daughter', () => {
  const b = new CaseBuilder();
  const w = b.spouse(), s = b.child('M'), d = b.child('F');
  const r = compute(b.build());
  assert.equal(share(r, w), '1/8');
  assert.equal(share(r, s), '7/12');
  assert.equal(share(r, d), '7/24');
  assert.equal(r.base, 24n);
});

test('Umariyyatan (husband): mother takes 1/3 of the remainder', () => {
  const b = new CaseBuilder('sunni-hanafi', { gender: 'F' });
  const h = b.spouse(), f = b.father(), m = b.mother();
  const r = compute(b.build());
  assert.deepEqual([share(r, h), share(r, m), share(r, f)], ['1/2', '1/6', '1/3']);
});

test('Umariyyatan (wife)', () => {
  const b = new CaseBuilder();
  const w = b.spouse(), f = b.father(), m = b.mother();
  const r = compute(b.build());
  assert.deepEqual([share(r, w), share(r, m), share(r, f)], ['1/4', '1/4', '1/2']);
});

test('Minbariyya: aul 24 -> 27', () => {
  const b = new CaseBuilder();
  const w = b.spouse(), d1 = b.child('F'), d2 = b.child('F'), f = b.father(), m = b.mother();
  const r = compute(b.build());
  assert.deepEqual([share(r, w), share(r, d1), share(r, d2), share(r, f), share(r, m)], ['1/9', '8/27', '8/27', '4/27', '4/27']);
  assert.equal(r.base, 27n);
  assert.ok(r.notes.some((n) => n.ruleId === 'sunni.aul'));
});

test('aul 6 -> 7, 8, 9, 10', () => {
  const run = (setup: (b: CaseBuilder) => void) => { const b = new CaseBuilder('sunni-hanafi', { gender: 'F' }); setup(b); return compute(b.build()).base; };
  assert.equal(run((b) => { b.spouse(); b.sibling('F'); b.sibling('F'); }), 7n);
  assert.equal(run((b) => { b.spouse(); b.mother(); b.sibling('F'); b.sibling('F'); }), 8n);
  assert.equal(run((b) => { b.spouse(); b.sibling('F'); b.sibling('F'); b.sibling('M', 'uterine'); b.sibling('F', 'uterine'); }), 9n);
  assert.equal(run((b) => { b.spouse(); b.mother(); b.sibling('F'); b.sibling('F'); b.sibling('M', 'uterine'); b.sibling('F', 'uterine'); }), 10n);
});

test('aul 12 -> 13, 15, 17', () => {
  const run = (setup: (b: CaseBuilder) => void) => { const b = new CaseBuilder(); setup(b); return compute(b.build()).base; };
  assert.equal(run((b) => { b.spouse(); b.mother(); b.sibling('F'); b.sibling('F'); }), 13n);
  assert.equal(run((b) => { b.spouse(); b.sibling('F'); b.sibling('F'); b.sibling('M', 'uterine'); b.sibling('F', 'uterine'); }), 15n);
  assert.equal(run((b) => { b.spouse(); b.mother(); b.sibling('F'); b.sibling('F'); b.sibling('M', 'uterine'); b.sibling('F', 'uterine'); }), 17n);
});

test('Himariyya (Hanafi): full brother gets nothing', () => {
  const b = new CaseBuilder('sunni-hanafi', { gender: 'F' });
  const h = b.spouse(), m = b.mother(), u1 = b.sibling('M', 'uterine'), u2 = b.sibling('M', 'uterine'), fb = b.sibling('M');
  const r = compute(b.build());
  assert.deepEqual([share(r, h), share(r, m), share(r, u1), share(r, u2), share(r, fb)], ['1/2', '1/6', '1/6', '1/6', '0']);
  assert.equal(status(r, fb), 'excluded');
});

test('Akdariyya (Hanafi): grandfather excludes the full sister', () => {
  const b = new CaseBuilder('sunni-hanafi', { gender: 'F' });
  const h = b.spouse(), m = b.mother(), gf = b.paternalGrandfather(), s = b.sibling('F');
  const r = compute(b.build());
  assert.deepEqual([share(r, h), share(r, m), share(r, gf), share(r, s)], ['1/2', '1/3', '1/6', '0']);
});

test('radd: mother and daughter', () => {
  const b = new CaseBuilder();
  const m = b.mother(), d = b.child('F');
  const r = compute(b.build());
  assert.deepEqual([share(r, m), share(r, d)], ['1/4', '3/4']);
});

test('radd excludes the spouse: wife and daughter', () => {
  const b = new CaseBuilder();
  const w = b.spouse(), d = b.child('F');
  const r = compute(b.build());
  assert.deepEqual([share(r, w), share(r, d)], ['1/8', '7/8']);
});

test('sole spouse: radd to spouse (Pakistani practice) or escheat', () => {
  const b = new CaseBuilder();
  const w = b.spouse();
  assert.equal(share(compute(b.build()), w), '1');
  const b2 = new CaseBuilder('sunni-hanafi', {}, '2026-01-01', { raddToSpouseWhenNoOtherHeir: false });
  const w2 = b2.spouse();
  const r2 = compute(b2.build());
  assert.equal(share(r2, w2), '1/4');
  assert.equal(toString(r2.escheat), '3/4');
});

test("daughter, son's daughter (1/6 completion), full sister (residue with daughter)", () => {
  const b = new CaseBuilder();
  const d = b.child('F');
  const s = b.child('M', { alive: false, dateOfDeath: '2020-01-01' });
  const sd = b.childOf(s, 'F');
  const fs = b.sibling('F');
  const b2 = new CaseBuilder('sunni-hanafi', {}, '2026-01-01', { applyMFLOs4: false });
  Object.assign(b2.c, b.build(), { policy: { ...b.build().policy, applyMFLOs4: false } });
  const r = compute(b2.build());
  assert.deepEqual([share(r, d), share(r, sd), share(r, fs)], ['1/2', '1/6', '1/3']);
});

test("two daughters exclude son's daughter unless a son's son makes her residuary", () => {
  const b = new CaseBuilder('sunni-hanafi', {}, '2026-01-01', { applyMFLOs4: false });
  const d1 = b.child('F'), d2 = b.child('F');
  const s = b.child('M', { alive: false, dateOfDeath: '2020-01-01' });
  const sd = b.childOf(s, 'F');
  let r = compute(b.build());
  assert.equal(share(r, sd), '0');
  const ss = b.childOf(s, 'M');
  r = compute(b.build());
  assert.deepEqual([share(r, d1), share(r, d2), share(r, ss), share(r, sd)], ['1/3', '1/3', '2/9', '1/9']);
});

test('father with a daughter: 1/6 + residue', () => {
  const b = new CaseBuilder();
  const f = b.father(), d = b.child('F');
  const r = compute(b.build());
  assert.deepEqual([share(r, d), share(r, f)], ['1/2', '1/2']);
});

test('mother reduced to 1/6 by two siblings even when they are excluded by the father', () => {
  const b = new CaseBuilder();
  const f = b.father(), m = b.mother(), s1 = b.sibling('M'), s2 = b.sibling('F');
  const r = compute(b.build());
  assert.deepEqual([share(r, m), share(r, f), share(r, s1), share(r, s2)], ['1/6', '5/6', '0', '0']);
});

test('maternal grandmother with father', () => {
  const b = new CaseBuilder();
  const f = b.father(), gm = b.maternalGrandmother();
  const r = compute(b.build());
  assert.deepEqual([share(r, gm), share(r, f)], ['1/6', '5/6']);
});

test("full brother excludes consanguine brother; brother's son only without brothers", () => {
  const b = new CaseBuilder();
  const fb = b.sibling('M'), cb = b.sibling('M', 'consanguine');
  let r = compute(b.build());
  assert.deepEqual([share(r, fb), share(r, cb)], ['1', '0']);
  const b2 = new CaseBuilder();
  const deadBro = b2.sibling('M', 'full', { alive: false, dateOfDeath: '2020-01-01' });
  const nephew = b2.childOf(deadBro, 'M');
  const gfx = b2.paternalGrandfather({ alive: false, dateOfDeath: '1990-01-01' });
  const uncle = b2.childOf(gfx, 'M');
  r = compute(b2.build());
  assert.deepEqual([share(r, nephew), share(r, uncle)], ['1', '0']);
});

test('uterine siblings excluded by a daughter', () => {
  const b = new CaseBuilder();
  const d = b.child('F'), u = b.sibling('M', 'uterine');
  const r = compute(b.build());
  assert.equal(share(r, u), '0');
  assert.equal(share(r, d), '1');
});

test("distant kindred: daughter's son alone (flagged for verification)", () => {
  const b = new CaseBuilder('sunni-hanafi', {}, '2026-01-01', { applyMFLOs4: false });
  const d = b.child('F', { alive: false, dateOfDeath: '2020-01-01' });
  const ds = b.childOf(d, 'M');
  const r = compute(b.build());
  assert.equal(share(r, ds), '1');
  assert.equal(r.needsVerification, true);
});

test('MFLO s.4: children of a predeceased son with a living uncle', () => {
  const b = new CaseBuilder();
  const s1 = b.child('M');
  const s2 = b.child('M', { alive: false, dateOfDeath: '2020-01-01' });
  const gs = b.childOf(s2, 'M'), gd = b.childOf(s2, 'F');
  const r = compute(b.build());
  assert.deepEqual([share(r, s1), share(r, gs), share(r, gd)], ['1/2', '1/3', '1/6']);
  assert.equal(status(r, gs), 'substituted-s4');
});

test("MFLO s.4: predeceased daughter's son", () => {
  const b = new CaseBuilder();
  const s = b.child('M');
  const d = b.child('F', { alive: false, dateOfDeath: '2020-01-01' });
  const ds = b.childOf(d, 'M');
  const r = compute(b.build());
  assert.deepEqual([share(r, s), share(r, ds)], ['2/3', '1/3']);
});

test('pregnant widow: reserve the larger of a son or a daughter share', () => {
  const b = new CaseBuilder();
  const w = b.spouse({ flags: { pregnant: true } }), f = b.father();
  const r = compute(b.build());
  assert.deepEqual([share(r, w), share(r, f)], ['1/8', '1/6']);
  assert.equal(toString(r.reserved), '17/24');
});

test('capacity bars: killer and different religion inherit nothing', () => {
  const b = new CaseBuilder();
  const s1 = b.child('M', { flags: { killedDeceased: 'intentional' } }), s2 = b.child('M', { religion: 'christian' }), d = b.child('F');
  const r = compute(b.build());
  assert.deepEqual([share(r, s1), share(r, s2), share(r, d)], ['0', '0', '1']);
  assert.equal(r.shares.find((s) => s.personId === s1)!.reasons[0].ruleId, 'bar.homicide');
});

test('will: limited to one third and not to an heir', () => {
  const b = new CaseBuilder();
  const s = b.child('M');
  b.c.estate.wills.push({ external: 'Mosque', fraction: { n: 1n, d: 2n } }, { beneficiaryId: s, fraction: { n: 1n, d: 10n } });
  const r = compute(b.build());
  assert.equal(share(r, s), '2/3');
  assert.equal(share(r, 'will-1'), '1/3');
  assert.ok(r.notes.some((n) => n.ruleId === 'will.clipped-to-third'));
  assert.ok(r.notes.some((n) => n.ruleId === 'will.to-heir-needs-consent'));
});
