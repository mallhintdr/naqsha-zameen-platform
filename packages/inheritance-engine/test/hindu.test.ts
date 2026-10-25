// Hindu (Mitakshara + 1937 Act), guided mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseBuilder, compute, toString, type ComputeResult } from '../src/index.ts';

const share = (r: ComputeResult, id: string) => toString(r.shares.find((s) => s.personId === id)!.fraction);
const hindu = (policy = {}) => new CaseBuilder('hindu-mitakshara-benares', { religion: 'hindu' }, '2026-01-01', policy);

test('Hindu separate property: widow takes a son share (1937 Act)', () => {
  const b = hindu();
  const w = b.spouse({ religion: 'hindu' }), s1 = b.child('M', { religion: 'hindu' }), s2 = b.child('M', { religion: 'hindu' }), d = b.child('F', { religion: 'hindu' });
  const r = compute(b.build());
  assert.deepEqual([share(r, w), share(r, s1), share(r, s2), share(r, d)], ['1/3', '1/3', '1/3', '0']);
  assert.equal(r.needsVerification, true);
});

test("Hindu: predeceased son's sons and widow take his share", () => {
  const b = hindu();
  const s1 = b.child('M', { religion: 'hindu' });
  const s2 = b.child('M', { religion: 'hindu', alive: false, dateOfDeath: '2020-01-01' });
  const sw = b.person('F', { religion: 'hindu', name: "son's widow" }); b.marry(s2, sw);
  const gs = b.childOf(s2, 'M', { religion: 'hindu' });
  const r = compute(b.build());
  assert.deepEqual([share(r, s1), share(r, gs), share(r, sw)], ['1/2', '1/4', '1/4']);
});

test('Hindu: no male issue -> widow takes the whole (limited estate), then daughters', () => {
  const b = hindu();
  const w = b.spouse({ religion: 'hindu' }), d = b.child('F', { religion: 'hindu' });
  assert.deepEqual([share(compute(b.build()), w), share(compute(b.build()), d)], ['1', '0']);
  const b2 = hindu();
  const d1 = b2.child('F', { religion: 'hindu' }), d2 = b2.child('F', { religion: 'hindu' }), m = b2.mother({ religion: 'hindu' });
  const r = compute(b2.build());
  assert.deepEqual([share(r, d1), share(r, d2), share(r, m)], ['1/2', '1/2', '0']);
});

test('Hindu coparcenary: widow takes the deceased interest', () => {
  const b = hindu({ hinduProperty: 'coparcenary' });
  const w = b.spouse({ religion: 'hindu' }); b.child('M', { religion: 'hindu' });
  const r = compute(b.build());
  assert.equal(share(r, w), '1');
  assert.ok(r.notes.some((n) => n.ruleId === 'hindu.coparcenary'));
});
