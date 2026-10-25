// Property tests on random families (deterministic seed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseBuilder, compute, cmp, eq, sum, ZERO, ONE, add, type Case } from '../src/index.ts';

function rng(seed: number) {
  return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
}

function randomCase(seed: number): Case {
  const r = rng(seed);
  const pick = (p: number) => r() < p;
  const n = (k: number) => Math.floor(r() * (k + 1));
  const b = new CaseBuilder('sunni-hanafi', { gender: pick(0.5) ? 'M' : 'F' });
  if (pick(0.6)) b.spouse();
  if (b.c.persons[0].gender === 'M' && pick(0.2)) b.spouse();
  if (pick(0.5)) b.father(); else if (pick(0.4)) b.paternalGrandfather();
  if (pick(0.5)) b.mother(); else if (pick(0.4)) b.maternalGrandmother();
  for (let i = n(3); i > 0; i--) b.child(pick(0.5) ? 'M' : 'F');
  if (pick(0.4)) {
    const s = b.child('M', { alive: false, dateOfDeath: '2010-01-01' });
    for (let i = n(2); i > 0; i--) b.childOf(s, pick(0.5) ? 'M' : 'F');
  }
  for (let i = n(3); i > 0; i--) b.sibling(pick(0.5) ? 'M' : 'F', (['full', 'consanguine', 'uterine'] as const)[n(2)]);
  if (pick(0.3)) b.c.policy.applyMFLOs4 = false;
  return b.build();
}

test('random families: shares sum to exactly 1, none negative, deterministic', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const c = randomCase(seed);
    const r = compute(c);
    const total = add(add(sum(r.shares.map((s) => s.fraction)), r.reserved), r.escheat);
    assert.ok(eq(total, ONE), `seed ${seed}: total ${total.n}/${total.d}`);
    assert.ok(r.shares.every((s) => cmp(s.fraction, ZERO) >= 0), `seed ${seed}: negative`);
    const again = compute(randomCase(seed));
    assert.deepEqual(again.shares.map((s) => `${s.personId}:${s.fraction.n}/${s.fraction.d}`), r.shares.map((s) => `${s.personId}:${s.fraction.n}/${s.fraction.d}`));
    for (const s of r.shares) assert.equal(s.sihaam * s.fraction.d, s.fraction.n * r.base, `seed ${seed}: sihaam`);
  }
});

test('random families: a son always gets twice a daughter', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const c = randomCase(seed);
    const r = compute(c);
    const sons = r.shares.filter((s) => s.relationKey === 'son' && s.status === 'heir');
    const daughters = r.shares.filter((s) => s.relationKey === 'daughter' && s.status === 'heir');
    if (!sons.length || !daughters.length) continue;
    for (const s of sons) for (const d of daughters) assert.ok(eq(s.fraction, add(d.fraction, d.fraction)), `seed ${seed}`);
  }
});

test('random families: removing an excluded heir does not change the result', () => {
  // Siblings are skipped: an excluded sibling still reduces the mother to 1/6 (hajb al-nuqsan).
  for (let seed = 1; seed <= 200; seed++) {
    const c = randomCase(seed);
    const r = compute(c);
    const removable = r.shares.filter((s) => s.status === 'excluded' && /^(son|daughter|sons-|true-)/.test(s.relationKey)
      && !c.parents.some((l) => l.fatherId === s.personId || l.motherId === s.personId));
    for (const x of removable) {
      const c2: Case = { ...c, persons: c.persons.filter((p) => p.id !== x.personId), parents: c.parents.filter((l) => l.childId !== x.personId) };
      const r2 = compute(c2);
      for (const s of r2.shares) {
        const before = r.shares.find((y) => y.personId === s.personId)!;
        assert.ok(eq(before.fraction, s.fraction), `seed ${seed}: removing ${x.personId} changed ${s.personId}`);
      }
    }
  }
});
