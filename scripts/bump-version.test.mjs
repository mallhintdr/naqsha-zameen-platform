import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion } from './bump-version.mjs';

test('patch steps by one', () => {
  assert.equal(nextVersion('5.0.0'), '5.0.1');
  assert.equal(nextVersion('5.1.8'), '5.1.9');
});
test('patch 9 rolls into minor', () => {
  assert.equal(nextVersion('5.1.9'), '5.2.0');
});
test('minor 9 and patch 9 roll into major', () => {
  assert.equal(nextVersion('5.9.9'), '6.0.0');
});
test('rejects malformed versions', () => {
  assert.throws(() => nextVersion('5.1'));
});
