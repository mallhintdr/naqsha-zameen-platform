// Run: cd backend && node --test test/signedPMTilesUrl.test.js
process.env.PUBLIC_BROWSE = 'false'; // these tests cover the owner-only rule; preview is tested in accessPolicy.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

process.env.PMTILES_SIGNING_KEY = 'unit-test-key';
process.env.CLOUDFLARE_WORKER_URL = 'https://worker.example';
delete process.env.PMTILES_URL_TTL_SECONDS;

// No database: linked tehsils = the tehsil itself, except one test group.
const aliasPath = require.resolve(path.join(__dirname, '../services/tehsilAliasService'));
require.cache[aliasPath] = {
  id: aliasPath, filename: aliasPath, loaded: true,
  exports: { getLinkedTehsils: async (t) => (String(t).toLowerCase() === 'groupx' ? ['GroupX', 'RealA'] : [t]) },
};

const signer = require('../middleware/signedPMTilesUrl');
const { createSignedUrl, normalizeSpec, signForUser, deps, URL_TTL_SECONDS } = signer._internal;
deps.resolveTehsilForMouza = async (t, m) => (t === 'GroupX' && m === 'M1' ? 'RealA' : t);

const user = { userId: 'u1', userType: 'user', tehsilAccess: [{ tehsil: 'Gujrat', mouzas: ['Bazgarh Kalan'] }, { tehsil: 'Yazman', mouzas: [] }, { tehsil: 'GroupX', mouzas: ['M1'] }] };
const admin = { userId: 'boss', userType: 'admin', tehsilAccess: [] };

const call = (fn, body, u) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  fn({ body, user: u }, res);
});

test('signature format matches the worker contract (path|exp|uid, per-segment encoding)', () => {
  const now = 1_700_000_000_000;
  const r = createSignedUrl({ tehsil: 'Gujrat', mouza: 'Bazgarh Kalan' }, 'u1', now);
  const exp = Math.floor(now / 1000) + 900;
  const token = crypto.createHmac('sha256', 'unit-test-key').update(`Gujrat/Bazgarh Kalan.pmtiles|${exp}|u1`).digest('hex');
  assert.equal(r.url, `https://worker.example/Gujrat/Bazgarh%20Kalan.pmtiles?token=${token}&exp=${exp}&uid=u1`);
  assert.equal(r.expiresAt, exp * 1000);
  assert.equal(URL_TTL_SECONDS, 900);
});

test('spec validation rejects separators, pipes, dot-segments and unknown file types', () => {
  assert.equal(normalizeSpec({ tehsil: 'A', mouza: 'B|9999999999' }).ok, false);
  assert.equal(normalizeSpec({ tehsil: 'A/..', mouza: 'B' }).ok, false);
  assert.equal(normalizeSpec({ tehsil: '..', mouza: 'B' }).ok, false);
  assert.equal(normalizeSpec({ tehsil: 'A', filename: 'B.geojson' }).ok, false);
  assert.equal(normalizeSpec({ tehsil: 'A', filename: '../B.pmtiles' }).ok, false);
  assert.deepEqual(normalizeSpec({ tehsil: 'A', mouza: 'X', filename: 'B-complete.pmtiles' }).mouza, 'B');
  assert.deepEqual(normalizeSpec({ tehsil: 'A', filename: 'B-Murabba.json' }).mouza, 'B');
  assert.deepEqual(normalizeSpec({ tehsil: 'A', mouza: 'B', murabba: '12/3' }).spec.murabba, '12-3');
});

test('mouza entitlement: listed mouza ok, other mouza denied, empty list = all, unknown tehsil denied', async () => {
  assert.equal((await signForUser(user, { tehsil: 'Gujrat', mouza: 'Bazgarh Kalan' })).status, 200);
  assert.equal((await signForUser(user, { tehsil: 'gujrat', mouza: 'bazgarh kalan' })).status, 200);
  assert.equal((await signForUser(user, { tehsil: 'Gujrat', mouza: 'Other' })).status, 403);
  // filename decides the mouza, not the mouza field
  assert.equal((await signForUser(user, { tehsil: 'Gujrat', mouza: 'Bazgarh Kalan', filename: 'Other-complete.pmtiles' })).status, 403);
  assert.equal((await signForUser(user, { tehsil: 'Yazman', mouza: 'Anything' })).status, 200);
  assert.equal((await signForUser(user, { tehsil: 'Lahore', mouza: 'X' })).status, 403);
  assert.equal((await signForUser(admin, { tehsil: 'Lahore', mouza: 'X' })).status, 200);
});

test('linked tehsil: group name is entitled, URL uses the real folder', async () => {
  const out = await signForUser(user, { tehsil: 'GroupX', mouza: 'M1' });
  assert.equal(out.status, 200);
  assert.equal(out.result.path, 'RealA/M1.pmtiles');
});

test('HTTP handlers: 403 for unentitled single, per-item errors in batch (order kept)', async () => {
  const single = await call(signer.generateSignedUrlMiddleware, { tehsil: 'Gujrat', mouza: 'Other' }, user);
  assert.equal(single.code, 403);
  const ok = await call(signer.generateSignedUrlMiddleware, { tehsil: 'Gujrat', mouza: 'Bazgarh Kalan', filename: 'Bazgarh Kalan-Murabba.json' }, user);
  assert.equal(ok.code, 200);
  assert.match(ok.body.url, /Bazgarh%20Kalan-Murabba\.json\?token=/);
  const batch = await call(signer.generateBatchSignedUrlsMiddleware, { files: [
    { tehsil: 'Gujrat', mouza: 'Other' },
    { tehsil: 'Gujrat', mouza: 'Bazgarh Kalan' },
  ] }, user);
  assert.equal(batch.code, 200);
  assert.equal(batch.body.urls[0].error, 'Access denied');
  assert.equal(batch.body.urls[1].path, 'Gujrat/Bazgarh Kalan.pmtiles');
  const tooMany = await call(signer.generateBatchSignedUrlsMiddleware, { files: Array(51).fill({ tehsil: 'Yazman', mouza: 'A' }) }, user);
  assert.equal(tooMany.code, 400);
});
