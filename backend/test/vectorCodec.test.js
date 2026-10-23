require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const codec = require('../services/vectorCodec');
const { identify } = require('../scripts/identify_leak');
const { syntheticMouza } = require('./helpers');

const frontendDecoder = () => import(pathToFileURL(path.join(__dirname, '../../frontend/src/shared/lib/vectorEnvelope.js')).href);
const q = (v) => Math.round(v * 1e7) / 1e7;
const quantized = (obj) => JSON.parse(JSON.stringify(obj), (k, v) => (typeof v === 'number' && k !== 'Area_K' ? q(v) : v));
const SECRET = 'wm-test-secret';

test('envelope round-trip: Node seal → browser decoder (WebCrypto) gives the quantized GeoJSON', async () => {
    const fe = await frontendDecoder();
    const src = syntheticMouza({ murabbas: 4 });
    src.features.push({ type: 'Feature', properties: { kind: '3d' }, geometry: { type: 'LineString', coordinates: [[71.1, 30.1, 123.4567], [71.2, 30.2, -5.25]] } });
    src.features.push({ type: 'Feature', properties: { kind: 'multi' }, geometry: { type: 'MultiPolygon', coordinates: [[[[71, 30], [71.001, 30], [71.001, 30.001], [71, 30]]], [[[72, 31], [72.001, 31], [72, 31.001], [72, 31]]]] } });
    src.features.push({ type: 'Feature', properties: { kind: 'point' }, geometry: { type: 'Point', coordinates: [-179.9999999, -89.123] } });
    src.features.push({ type: 'Feature', properties: { kind: 'null' }, geometry: null });
    src.features.push({ type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2] }] } });

    const key = require('crypto').randomBytes(32);
    const env = codec.seal(codec.buildPlain(codec.prepare(src)), key);
    const cryptoKey = await fe.importEnvelopeKey(key.toString('base64'));
    const out = fe.decodePlain(await fe.openEnvelope(env, cryptoKey));
    const expected = quantized(src);
    expected.features[expected.features.length - 5].geometry.coordinates = [[71.1, 30.1, 123.457], [71.2, 30.2, -5.25]]; // z at 1e-3
    assert.deepEqual(out, expected);
    // Node decoder agrees too.
    assert.deepEqual(codec.decodePlain(codec.open(env, key)), expected);
});

test('non-geo JSON (metadata) round-trips unchanged', async () => {
    const fe = await frontendDecoder();
    const meta = { murabba_list: ['1', '2', '10/1'], murabba_centroids: { 1: [71.123456789123, 30.5] }, note: 'اکس' };
    const plain = codec.buildPlain(codec.prepare(meta));
    assert.deepEqual(fe.decodePlain(new Uint8Array(plain)), meta);
});

test('wrong key fails (AES-GCM authenticates)', async () => {
    const fe = await frontendDecoder();
    const env = codec.seal(codec.buildPlain(codec.prepare({ a: 1 })), Buffer.alloc(32, 1));
    const bad = await fe.importEnvelopeKey(Buffer.alloc(32, 2).toString('base64'));
    await assert.rejects(fe.openEnvelope(env, bad));
});

test('watermark: deterministic, ≤ k units, shared vertices move together, users differ', () => {
    const src = syntheticMouza({ murabbas: 9 });
    const p = codec.prepare(src);
    const k = 3;
    const a1 = codec.applyWatermark(p, codec.watermarkSeeds(SECRET, 'alice'), k);
    const a2 = codec.applyWatermark(p, codec.watermarkSeeds(SECRET, 'ALICE '), k);
    const b = codec.applyWatermark(p, codec.watermarkSeeds(SECRET, 'bob'), k);
    assert.deepEqual(a1, a2, 'same user → same output (userId case/space-insensitive)');
    let diff = 0, moved = 0;
    for (let i = 0; i < p.vals.length; i++) {
        const d = a1[i] - p.vals[i];
        assert.ok(Math.abs(d) <= k);
        if (d) moved++;
        if (a1[i] !== b[i]) diff++;
    }
    assert.ok(moved / p.vals.length > 0.8, 'most coordinates are marked');
    assert.ok(diff / p.vals.length > 0.8, 'different users get different marks');
    // Topology: identical input vertices stay identical in the output.
    const out = codec.rebuild(p, a1);
    const seen = new Map();
    src.features.forEach((f, fi) => f.geometry.coordinates[0].forEach((c, ci) => {
        const key = `${c[0]},${c[1]}`;
        const o = out.features[fi].geometry.coordinates[0][ci];
        if (seen.has(key)) assert.deepEqual(o, seen.get(key)); else seen.set(key, o);
    }));
    // Max displacement in metres at this latitude (≤ 5 cm).
    const mPerDegLat = 110574, mPerDegLng = 111320 * Math.cos(31 * Math.PI / 180);
    const maxM = Math.hypot(k * 1e-7 * mPerDegLng, k * 1e-7 * mPerDegLat);
    assert.ok(maxM < 0.05, `max shift ${maxM.toFixed(3)} m`);
});

test('identify_leak finds the leaker, also after re-rounding to 6 decimals', () => {
    const original = syntheticMouza({ murabbas: 16 });
    const p = codec.prepare(original);
    const candidates = ['alice', 'bob', 'carol', 'dave', 'mallory', 'trent'];
    const leaked = codec.rebuild(p, codec.applyWatermark(p, codec.watermarkSeeds(SECRET, 'mallory'), 3));
    const r1 = identify(leaked, original, candidates, { secret: SECRET, units: 3 });
    assert.equal(r1.results[0].userId, 'mallory');
    assert.ok(r1.results[0].exact > 0.99 && r1.results[0].score > 0.95);
    assert.ok(r1.results[1].score < 0.2);

    const rounded = JSON.parse(JSON.stringify(leaked), (k, v) => (typeof v === 'number' && k !== 'Area_K' ? Math.round(v * 1e6) / 1e6 : v));
    const r2 = identify(rounded, original, candidates, { secret: SECRET, units: 3 });
    assert.equal(r2.results[0].userId, 'mallory');
    assert.ok(r2.results[0].score - r2.results[1].score > 0.3, JSON.stringify(r2.results.slice(0, 2)));

    const clean = identify(quantized(original), original, candidates, { secret: SECRET, units: 3 });
    assert.ok(clean.results[0].score < 0.2, 'unmarked file matches nobody');
});

test('performance: ~8 MB mouza GeoJSON (logged, generous bounds)', async () => {
    const fe = await frontendDecoder();
    const src = syntheticMouza({ murabbas: 400 });
    const text = JSON.stringify(src);
    const t = (fn) => { const s = process.hrtime.bigint(); const r = fn(); return [r, Number(process.hrtime.bigint() - s) / 1e6]; };
    const [, tParse] = t(() => JSON.parse(text));
    const [p, tPrep] = t(() => codec.prepare(JSON.parse(text)));
    const key = require('crypto').randomBytes(32);
    const seeds = codec.watermarkSeeds(SECRET, 'alice');
    const [env, tEnc] = t(() => codec.seal(codec.buildPlain(p, codec.applyWatermark(p, seeds, 3)), key));
    const [json, tJson] = t(() => JSON.stringify(codec.rebuild(p, codec.applyWatermark(p, seeds, 3))));
    const ck = await fe.importEnvelopeKey(key.toString('base64'));
    let s = process.hrtime.bigint();
    const plain = await fe.openEnvelope(env, ck);
    const tDecrypt = Number(process.hrtime.bigint() - s) / 1e6;
    s = process.hrtime.bigint();
    const out = fe.decodePlain(plain);
    const tDecode = Number(process.hrtime.bigint() - s) / 1e6;
    s = process.hrtime.bigint();
    fe.decodePlain(plain);
    const tDecodeWarm = Number(process.hrtime.bigint() - s) / 1e6;
    assert.equal(out.features.length, src.features.length);
    const mb = (n) => (n / 1048576).toFixed(2);
    console.log(`[perf] GeoJSON ${mb(text.length)} MB, ${p.nPos} vertices, ${src.features.length} features`);
    console.log(`[perf] JSON.parse ${tParse.toFixed(0)} ms | server prepare (once per file, cached) ${tPrep.toFixed(0)} ms`);
    console.log(`[perf] server per-request watermark+encode+AES ${tEnc.toFixed(0)} ms → envelope ${mb(env.length)} MB | watermarked plain JSON ${tJson.toFixed(0)} ms (${mb(json.length)} MB)`);
    console.log(`[perf] client AES-GCM decrypt ${tDecrypt.toFixed(0)} ms + decode ${tDecode.toFixed(0)} ms cold / ${tDecodeWarm.toFixed(0)} ms warm (vs JSON.parse ${tParse.toFixed(0)} ms)`);
    assert.ok(env.length < text.length / 2, 'envelope is smaller than the raw GeoJSON');
});
