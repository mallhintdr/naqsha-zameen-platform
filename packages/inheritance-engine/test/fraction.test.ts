import test from 'node:test';
import assert from 'node:assert/strict';
import { frac, add, sub, mul, div, cmp, toString, parse, percent, commonBase } from '../src/index.ts';

test('fraction arithmetic and reduction', () => {
  assert.equal(toString(add(frac(1, 6), frac(1, 3))), '1/2');
  assert.equal(toString(sub(frac(1, 2), frac(1, 3))), '1/6');
  assert.equal(toString(mul(frac(2, 3), frac(3, 4))), '1/2');
  assert.equal(toString(div(frac(1, 8), frac(27, 24))), '1/9');
  assert.equal(toString(frac(-4, -8)), '1/2');
  assert.equal(cmp(frac(1, 3), frac(2, 6)), 0);
  assert.equal(toString(parse(' 6 / 8 ')), '3/4');
  assert.throws(() => frac(1, 0));
});

test('percent formatting is exact half-up', () => {
  assert.equal(percent(frac(1, 3)), '33.3333');
  assert.equal(percent(frac(2, 3)), '66.6667');
  assert.equal(percent(frac(1, 8), 2), '12.50');
  assert.equal(percent(frac(1, 1), 0), '100');
});

test('common base', () => {
  assert.equal(commonBase([frac(1, 8), frac(2, 3), frac(1, 6)]), 24n);
});
