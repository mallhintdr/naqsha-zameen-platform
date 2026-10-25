import test from 'node:test';
import assert from 'node:assert/strict';
import { frac, eq, toString, fromParts, toMixed, formatMixed, toSqft, fromSqft, toRupeeAnnaPie, CaseBuilder, compute, sum, MIXED } from '../src/index.ts';

test('punjab units: 1 acre = 8 kanal = 160 marla = 1440 sarsai', () => {
  assert.equal(toString(fromParts({ acre: 1 }, 'kanal')), '8');
  assert.equal(toString(fromParts({ kanal: 1 }, 'marla')), '20');
  assert.equal(toString(fromParts({ marla: 1 }, 'sarsai')), '9');
  assert.equal(toString(fromParts({ murabba: 1 }, 'acre')), '25');
  assert.equal(toString(fromParts({ acre: 1 }, 'ghunta')), '40');
  assert.equal(toString(toSqft(frac(1), 'marla')), '1089/4');
});

test('mixed units round trip and exact remainder', () => {
  const v = fromParts({ kanal: 3, marla: 5, sarsai: 2 }, 'kanal');
  const m = toMixed(v, 'kanal');
  assert.deepEqual(m.parts.map((p) => p.whole), [3n, 5n, 2n]);
  assert.equal(m.remainder.n, 0n);
  assert.equal(formatMixed(toMixed(frac(1, 3), 'kanal')), '6 Marla 6 Sarsai');
  // 1 kanal shared by 7: 2 marla 7 sarsai + 5/7 sarsai
  assert.equal(formatMixed(toMixed(frac(1, 7), 'kanal')), '2 Marla 7 Sarsai (+5/7 Sarsai)');
  assert.ok(eq(fromParts({ marla: 2, sarsai: frac(54, 7) }, 'kanal'), frac(1, 7)));
  assert.ok(eq(fromSqft(toSqft(frac(7, 9), 'acre'), 'acre'), frac(7, 9)));
  assert.equal(formatMixed(toMixed(frac(3, 2), 'acre', MIXED.sindh)), '1 Acre 20 Ghunta');
});

test('rupee-anna-pie', () => {
  assert.deepEqual(toRupeeAnnaPie(frac(1, 8)), { rupee: 0n, anna: 2n, pie: 0n, remainder: frac(0) });
  assert.equal(toRupeeAnnaPie(frac(7, 24)).anna, 4n);
});

test('area per heir sums to the property area', () => {
  const b = new CaseBuilder();
  b.spouse(); b.child('M'); b.child('F');
  b.c.estate.immovable.push({ title: 'Khewat 12', area: { unit: 'kanal', value: fromParts({ kanal: 16, marla: 4 }, 'kanal') } });
  const r = compute(b.build());
  const total = sum(r.shares.map((s) => s.area![0].value));
  assert.ok(eq(total, fromParts({ kanal: 16, marla: 4 }, 'kanal')));
});

test('government standard: 1 marla = 272 sq ft, 1 kanal = 5440 sq ft', () => {
  assert.equal(toString(fromParts({ gkanal: 1 }, 'sqft')), '5440');
  assert.equal(formatMixed(toMixed(fromParts({ sqft: 5440 + 272 * 3 + 50 }, 'gkanal'), 'gkanal', MIXED.kmf)), '1 Kanal 3 Marla 50 Sq ft');
});

test('whole feet: rounded so the heirs add up exactly to the property', async () => {
  const { allocateWholeSqft } = await import('../src/units.ts');
  // 1000 sq ft among 1/3, 1/3, 1/3 -> 334, 333, 333
  assert.deepEqual(allocateWholeSqft(frac(1000), [frac(1, 3), frac(1, 3), frac(1, 3)]), [334n, 333n, 333n]);
  // widow 1/8, son 7/12, daughter 7/24 of 1 kanal (5440): 680 + 3173.33 + 1586.67 -> 680, 3173, 1587
  assert.deepEqual(allocateWholeSqft(frac(5440), [frac(1, 8), frac(7, 12), frac(7, 24)]), [680n, 3173n, 1587n]);
  const b = new CaseBuilder();
  b.spouse(); b.child('M'); b.child('F'); b.child('F');
  b.c.estate.immovable.push({ title: 'Plot', area: { unit: 'gkanal', value: fromParts({ gkanal: 1, gmarla: 1 }, 'gkanal') } });
  const r = compute(b.build());
  const feet = r.shares.map((s) => s.areaSqftRounded![0]!);
  assert.equal(feet.reduce((a, x) => a + x, 0n), 5712n);
  assert.ok(r.notes.some((n) => n.ruleId === 'area.rounded-feet'));
});
