// Run: cd cloudflare-worker && node --test test/worker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import worker from '../pmtiles-worker.js';

const KEY = 'test-signing-key';
const WORKER = 'https://pmtiles-worker.example.workers.dev';
const ORIGIN = 'https://dashboard.naqsha-zameen.pk';
const PATH = 'Gujrat/Bazgarh Kalan.pmtiles';

// Old production backend signer (old-repo/backend/middleware/signedPMTilesUrl.js), loaded as-is.
const require = createRequire(import.meta.url);
process.env.PMTILES_SIGNING_KEY = KEY;
process.env.CLOUDFLARE_WORKER_URL = WORKER;
const oldSigner = require('../../old-repo/backend/middleware/signedPMTilesUrl.js');

function makeBucket(objects) {
  const mk = (key, data, range) => ({
    key, size: data.length, httpEtag: '"etag-1"', range,
    arrayBuffer: async () => {
      const s = range ? range.offset : 0; const l = range ? range.length : data.length;
      return data.buffer.slice(data.byteOffset + s, data.byteOffset + s + l);
    },
  });
  return {
    async get(key, opts = {}) {
      const data = objects[key]; if (!data) return null;
      if (opts.range) {
        const { offset, length } = opts.range;
        if (offset >= data.length) throw new Error('InvalidRange');
        return mk(key, data, { offset, length: Math.min(length, data.length - offset) });
      }
      return mk(key, data);
    },
    async head(key) { const d = objects[key]; return d ? { size: d.length } : null; },
    async list() { return { delimitedPrefixes: ['Gujrat/', 'Yazman/'], truncated: false }; },
  };
}

const file = new Uint8Array(100000).map((_, i) => i % 251);
const env = () => ({
  PMTILES_SIGNING_KEY: KEY,
  PMTILES_BUCKET: makeBucket({ [PATH]: file }),
  MAX_RANGE_BYTES: '65536',
});

function sign(path, { exp = Math.floor(Date.now() / 1000) + 900, uid = 'user1', key = KEY } = {}) {
  const token = createHmac('sha256', key).update(`${path}|${exp}|${uid}`).digest('hex');
  const enc = path.split('/').map(encodeURIComponent).join('/');
  return `${WORKER}/${enc}?token=${token}&exp=${exp}&uid=${encodeURIComponent(uid)}`;
}
const req = (url, headers = {}, method = 'GET') => new Request(url, { method, headers: { Origin: ORIGIN, ...headers } });
const call = (r, e = env()) => worker.fetch(r, e, { waitUntil() {} });
const callOld = (fn, body) => new Promise((resolve) => {
  fn({ body, user: { userId: 'Old.User_1' } }, { json: resolve, status() { return this; } });
});

test('valid token + closed range -> 206 with Content-Range and CORS', async () => {
  const res = await call(req(sign(PATH), { Range: 'bytes=0-16383' }));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Range'), `bytes 0-16383/${file.length}`);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(res.headers.get('Access-Control-Expose-Headers'), /Content-Range/);
  assert.equal((await res.arrayBuffer()).byteLength, 16384);
});

test('range past EOF is clamped; start past EOF -> 416 bytes */size (pmtiles retry path)', async () => {
  const a = await call(req(sign(PATH), { Range: 'bytes=99000-99999' }));
  assert.equal(a.status, 206);
  const b = await call(req(sign(PATH), { Range: 'bytes=200000-200010' }));
  assert.equal(b.status, 416);
  assert.equal(b.headers.get('Content-Range'), `bytes */${file.length}`);
});

test('missing token -> 401', async () => {
  const res = await call(req(`${WORKER}/Gujrat/Bazgarh%20Kalan.pmtiles`, { Range: 'bytes=0-10' }));
  assert.equal(res.status, 401);
});

test('expired token -> 403', async () => {
  const res = await call(req(sign(PATH, { exp: Math.floor(Date.now() / 1000) - 5 }), { Range: 'bytes=0-10' }));
  assert.equal(res.status, 403);
});

test('tampered token / wrong key / changed uid -> 403', async () => {
  const good = sign(PATH);
  const flipped = good.replace(/token=([0-9a-f])/, (m, c) => `token=${c === 'a' ? 'b' : 'a'}`);
  assert.equal((await call(req(flipped, { Range: 'bytes=0-10' }))).status, 403);
  assert.equal((await call(req(sign(PATH, { key: 'other' }), { Range: 'bytes=0-10' }))).status, 403);
  assert.equal((await call(req(good.replace('uid=user1', 'uid=user2'), { Range: 'bytes=0-10' }))).status, 403);
});

test('far-future exp and uid containing | are rejected', async () => {
  const far = sign(PATH, { exp: Math.floor(Date.now() / 1000) + 30 * 86400 });
  assert.equal((await call(req(far, { Range: 'bytes=0-10' }))).status, 403);
  const pipe = sign(PATH, { uid: 'a|b' });
  assert.equal((await call(req(pipe, { Range: 'bytes=0-10' }))).status, 403);
});

test('token for another path -> 403 (also case changes)', async () => {
  const url = sign('Gujrat/Other.pmtiles').replace('/Gujrat/Other.pmtiles', '/Gujrat/Bazgarh%20Kalan.pmtiles');
  assert.equal((await call(req(url, { Range: 'bytes=0-10' }))).status, 403);
  const lower = sign(PATH).replace('/Gujrat/', '/gujrat/');
  assert.equal((await call(req(lower, { Range: 'bytes=0-10' }))).status, 403);
});

test('no range / open range / suffix / multi / oversized -> 416', async () => {
  for (const h of [{}, { Range: 'bytes=0-' }, { Range: 'bytes=-500' }, { Range: 'bytes=0-1,5-9' }, { Range: 'bytes=0-65536' }]) {
    const res = await call(req(sign(PATH), h));
    assert.equal(res.status, 416, JSON.stringify(h));
  }
  assert.equal((await call(req(sign(PATH), { Range: 'bytes=0-65535' }))).status, 206);
});

test('disallowed origin gets no ACAO and no data; preflight correct', async () => {
  const bad = await call(new Request(sign(PATH), { headers: { Origin: 'https://evil-localhost.com', Range: 'bytes=0-10' } }));
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  const none = await call(new Request(sign(PATH), { headers: { Range: 'bytes=0-10' } }));
  assert.equal(none.status, 403);

  const pre = await call(new Request(sign(PATH), { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Headers': 'range' } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  assert.equal(pre.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Range/);
  const preBad = await call(new Request(sign(PATH), { method: 'OPTIONS', headers: { Origin: 'https://example.com' } }));
  assert.equal(preBad.headers.get('Access-Control-Allow-Origin'), null);
  for (const o of ['https://dashboard.naqsha-zameen.com', 'http://localhost:3000', 'http://localhost:5000']) {
    const r = await call(new Request(sign(PATH), { headers: { Origin: o, Range: 'bytes=0-10' } }));
    assert.equal(r.status, 206, o);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), o);
  }
});

test('old-repo backend signed URLs are accepted (mouza, -complete, -Murabba.json)', async () => {
  const objects = {
    'Gujrat/Bazgarh Kalan.pmtiles': file,
    'Gujrat/Bazgarh Kalan-complete.pmtiles': file,
    'Gujrat/Bazgarh Kalan-Murabba.json': new TextEncoder().encode('{"murabba_list":[1]}'),
  };
  const e = { ...env(), PMTILES_BUCKET: makeBucket(objects) };
  const batch = await callOld(oldSigner.generateBatchSignedUrlsMiddleware, { files: [
    { tehsil: 'Gujrat', mouza: 'Bazgarh Kalan' },
    { tehsil: 'Gujrat', mouza: 'Bazgarh Kalan', filename: 'Bazgarh Kalan-complete.pmtiles' },
  ] });
  for (const u of batch.urls) {
    const res = await call(req(u.url, { Range: 'bytes=0-16383' }), e);
    assert.equal(res.status, 206, u.url);
  }
  const single = await callOld(oldSigner.generateSignedUrlMiddleware, { tehsil: 'Gujrat', mouza: 'Bazgarh Kalan' });
  assert.equal((await call(req(single.url, { Range: 'bytes=0-16383' }), e)).status, 206);
  const json = await callOld(oldSigner.generateSignedUrlMiddleware, { tehsil: 'Gujrat', mouza: 'Bazgarh Kalan', filename: 'Bazgarh Kalan-Murabba.json' });
  const res = await call(req(json.url), e); // old tileDecoder does a plain fetch(): no Range for JSON
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { murabba_list: [1] });
});

test('/list-tehsils stays public (names only); /list-mouzas is gone; metadata json needs a token', async () => {
  const res = await call(new Request(`${WORKER}/list-tehsils`, { headers: { Origin: ORIGIN } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), ['Gujrat', 'Yazman']);
  assert.match(res.headers.get('Cache-Control'), /max-age/);
  assert.equal((await call(req(`${WORKER}/list-mouzas/Gujrat`))).status, 404);
  assert.equal((await call(req(`${WORKER}/Gujrat/Bazgarh%20Kalan-Metadata.json`))).status, 401);
});

test('edge cache keyed by path+range without token; only after validation', async () => {
  const store = new Map();
  globalThis.caches = { default: {
    async match(r) { const v = store.get(r.url); return v ? v.clone() : undefined; },
    async put(r, res) { assert.ok(!r.url.includes('token')); store.set(r.url, res); },
  } };
  try {
    const first = await call(req(sign(PATH), { Range: 'bytes=0-99' }));
    assert.equal(first.headers.get('X-Cache'), 'MISS');
    const second = await call(req(sign(PATH, { uid: 'user9' }), { Range: 'bytes=0-99' }));
    assert.equal(second.status, 206);
    assert.equal(second.headers.get('X-Cache'), 'HIT');
    assert.equal(second.headers.get('Content-Range'), `bytes 0-99/${file.length}`);
    assert.equal(second.headers.get('ETag'), '"etag-1"');
    const unauth = await call(req(`${WORKER}/Gujrat/Bazgarh%20Kalan.pmtiles`, { Range: 'bytes=0-99' }));
    assert.equal(unauth.status, 401);
  } finally { delete globalThis.caches; }
});

test('rate limit binding is used and keyed by uid', async () => {
  const keys = [];
  const e = { ...env(), PMTILES_RATE_LIMITER: { async limit({ key }) { keys.push(key); return { success: false }; } } };
  const res = await call(req(sign(PATH), { Range: 'bytes=0-10' }), e);
  assert.equal(res.status, 429);
  assert.deepEqual(keys, ['uid:user1']);
});
