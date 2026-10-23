/**
 * Vector data codec: quantize → (optional per-user watermark) → delta + zigzag
 * varint → (optional) AES-256-GCM envelope.
 *
 * The browser-side decoder lives in frontend/src/shared/lib/vectorEnvelope.js and
 * must stay byte-compatible with this file (see docs/security/GEOJSON.md).
 *
 * Plain payload layout (inside the envelope):
 *   u8  version (1)
 *   u8  kind    (0 = UTF-8 JSON text follows, 1 = geo: skeleton + coordinate stream)
 *   kind 0: rest = JSON text
 *   kind 1: u32 LE skeleton byte length, skeleton JSON (UTF-8), varint stream
 * Envelope: "NZV1" | iv (12) | AES-GCM ciphertext || tag (16)
 *
 * Skeleton: the original JSON with every supported geometry's `coordinates`
 * replaced by `__n` (ring/part counts, nesting depends on the type) and `__d`
 * (dimensions per position, 2 or 3). Positions are streamed in document order;
 * x/y quantized at 1e-7° (~1 cm), z at 1e-3. Each dimension is delta-encoded
 * against the previous position across the whole stream.
 */
const crypto = require('crypto');

const XY_SCALE = 1e7;
const Z_SCALE = 1e3;
const MAGIC = Buffer.from('NZV1', 'ascii');
const DEPTH = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };

// ─── Prepare (once per file; cacheable, user independent) ─────────────────────

function isPosition(p, d) {
    if (!Array.isArray(p) || p.length !== d) return false;
    for (let i = 0; i < d; i++) if (typeof p[i] !== 'number' || !Number.isFinite(p[i])) return false;
    return true;
}

/**
 * Turns parsed JSON into { kind, skeleton, vals, dims, nPos }.
 * Geometries that cannot be encoded exactly (mixed dims, odd shapes) are left
 * untouched in the skeleton.
 */
function prepare(obj) {
    if (!obj || typeof obj !== 'object' || !looksGeo(obj)) {
        return { kind: 0, text: JSON.stringify(obj) };
    }
    const valsList = [];
    const dimsList = [];

    const encodeGeometry = (g) => {
        if (!g || typeof g !== 'object') return g;
        if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
            return { ...g, geometries: g.geometries.map(encodeGeometry) };
        }
        const depth = DEPTH[g.type];
        if (depth === undefined || !Array.isArray(g.coordinates)) return g;
        // Determine dims from the first position.
        let first = g.coordinates;
        for (let i = 0; i < depth; i++) first = Array.isArray(first) ? first[0] : undefined;
        const d = Array.isArray(first) ? first.length : 0;
        if (d !== 2 && d !== 3) return g;

        const startLen = valsList.length;
        const startDims = dimsList.length;
        let ok = true;
        const pushPos = (p) => {
            if (!isPosition(p, d)) { ok = false; return; }
            valsList.push(Math.round(p[0] * XY_SCALE), Math.round(p[1] * XY_SCALE));
            if (d === 3) valsList.push(Math.round(p[2] * Z_SCALE));
            dimsList.push(d);
        };
        const walk = (node, lvl) => {
            if (!ok) return 0;
            if (lvl === 0) { pushPos(node); return 0; }
            if (!Array.isArray(node)) { ok = false; return 0; }
            if (lvl === 1) { for (const p of node) pushPos(p); return node.length; }
            return node.map(child => walk(child, lvl - 1));
        };
        const n = walk(g.coordinates, depth);
        if (!ok) { valsList.length = startLen; dimsList.length = startDims; return g; }
        const { coordinates, ...rest } = g; // eslint-disable-line no-unused-vars
        return { ...rest, __n: n, __d: d };
    };

    const encodeNode = (node) => {
        if (!node || typeof node !== 'object') return node;
        if (node.type === 'FeatureCollection' && Array.isArray(node.features)) {
            return { ...node, features: node.features.map(encodeNode) };
        }
        if (node.type === 'Feature') return { ...node, geometry: encodeGeometry(node.geometry) };
        return encodeGeometry(node);
    };

    const skeletonObj = encodeNode(obj);
    for (const v of valsList) {
        if (v > 2147483647 || v < -2147483648) return { kind: 0, text: JSON.stringify(obj) };
    }
    return {
        kind: 1,
        skeleton: JSON.stringify(skeletonObj),
        vals: Int32Array.from(valsList),
        dims: Uint8Array.from(dimsList),
        nPos: dimsList.length,
    };
}

function looksGeo(o) {
    return o.type === 'FeatureCollection' || o.type === 'Feature' || o.type === 'GeometryCollection' || DEPTH[o.type] !== undefined;
}

// ─── Watermark ───────────────────────────────────────────────────────────────

/** Two 32-bit seeds for a user, from HMAC(secret, userId). */
function watermarkSeeds(secret, userId) {
    const h = crypto.createHmac('sha256', String(secret)).update('nz-wm-v1|' + String(userId || '').trim().toLowerCase()).digest();
    return [h.readInt32LE(0), h.readInt32LE(4)];
}

/**
 * Deterministic offset for one quantized vertex. Depends only on the vertex's
 * own (rounded) coordinate and the user's seeds, so a vertex shared by two
 * polygons moves identically in both. Returns [dx, dy] in quantum units, each in
 * [-k, k]. `out` avoids allocations in hot loops.
 */
function watermarkOffset(x, y, s0, s1, k, out) {
    let h = Math.imul(x ^ s0, 0x9E3779B1);
    h = Math.imul(h ^ (h >>> 15) ^ y, 0x85EBCA77);
    h ^= Math.imul(y ^ s1, 0xC2B2AE3D);
    h = Math.imul(h ^ (h >>> 13), 0x27D4EB2F);
    h ^= h >>> 16;
    let h2 = Math.imul(h ^ s1, 0x165667B1);
    h2 = Math.imul(h2 ^ (h2 >>> 15), 0x85EBCA77);
    h2 ^= h2 >>> 13;
    const m = 2 * k + 1;
    out[0] = ((h >>> 0) % m) - k;
    out[1] = ((h2 >>> 0) % m) - k;
    return out;
}

/** Copy of prepared.vals with every x/y moved by the user's watermark. */
function applyWatermark(prepared, seeds, k) {
    const src = prepared.vals;
    if (!seeds || !k) return src;
    const out = new Int32Array(src.length);
    const off = [0, 0];
    const [s0, s1] = seeds;
    const dims = prepared.dims;
    let i = 0;
    for (let p = 0; p < prepared.nPos; p++) {
        const x = src[i], y = src[i + 1];
        watermarkOffset(x, y, s0, s1, k, off);
        out[i] = x + off[0];
        out[i + 1] = y + off[1];
        if (dims[p] === 3) { out[i + 2] = src[i + 2]; i += 3; } else i += 2;
    }
    return out;
}

// ─── Plain payload ───────────────────────────────────────────────────────────

/** Encodes values as delta + zigzag varints (per dimension, across positions). */
function encodeStream(vals, dims, nPos) {
    const buf = Buffer.allocUnsafe(vals.length * 5 + 16);
    let o = 0;
    let px = 0, py = 0, pz = 0;
    let i = 0;
    const put = (delta) => {
        let z = (delta << 1) ^ (delta >> 31); // zigzag (deltas fit in int32 for real data)
        z >>>= 0;
        while (z > 0x7f) { buf[o++] = (z & 0x7f) | 0x80; z >>>= 7; }
        buf[o++] = z;
    };
    for (let p = 0; p < nPos; p++) {
        const x = vals[i], y = vals[i + 1];
        put((x - px) | 0); px = x;
        put((y - py) | 0); py = y;
        if (dims[p] === 3) { const z = vals[i + 2]; put((z - pz) | 0); pz = z; i += 3; } else i += 2;
    }
    return buf.subarray(0, o);
}

function buildPlain(prepared, vals) {
    if (prepared.kind === 0) {
        return Buffer.concat([Buffer.from([1, 0]), Buffer.from(prepared.text, 'utf8')]);
    }
    const skel = Buffer.from(prepared.skeleton, 'utf8');
    const head = Buffer.alloc(6);
    head[0] = 1; head[1] = 1; head.writeUInt32LE(skel.length, 2);
    return Buffer.concat([head, skel, encodeStream(vals || prepared.vals, prepared.dims, prepared.nPos)]);
}

// ─── Decode (Node; mirrors the browser decoder, used by tests / tooling) ─────

function decodeStream(bytes, start, skeletonObj) {
    let o = start;
    let px = 0, py = 0, pz = 0;
    const get = () => {
        let r = 0, s = 0, b;
        do { b = bytes[o++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
        r >>>= 0;
        return (r >>> 1) ^ -(r & 1);
    };
    const pos = (d) => {
        px = (px + get()) | 0; py = (py + get()) | 0;
        if (d === 3) { pz = (pz + get()) | 0; return [px / XY_SCALE, py / XY_SCALE, pz / Z_SCALE]; }
        return [px / XY_SCALE, py / XY_SCALE];
    };
    const build = (n, lvl, d) => {
        if (lvl === 0) return pos(d);
        if (lvl === 1) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = pos(d); return a; }
        return n.map(c => build(c, lvl - 1, d));
    };
    const geom = (g) => {
        if (!g || typeof g !== 'object') return g;
        if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) { g.geometries = g.geometries.map(geom); return g; }
        if (g.__n === undefined) return g;
        const { __n, __d, ...rest } = g;
        rest.coordinates = build(__n, DEPTH[g.type], __d);
        return rest;
    };
    const node = (n) => {
        if (!n || typeof n !== 'object') return n;
        if (n.type === 'FeatureCollection' && Array.isArray(n.features)) { n.features = n.features.map(node); return n; }
        if (n.type === 'Feature') { n.geometry = geom(n.geometry); return n; }
        return geom(n);
    };
    return node(skeletonObj);
}

function decodePlain(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (bytes[0] !== 1) throw new Error('Unsupported vector payload version');
    if (bytes[1] === 0) return JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + 2, bytes.length - 2).toString('utf8'));
    const len = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).readUInt32LE(2);
    const skel = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + 6, len).toString('utf8'));
    return decodeStream(bytes, 6 + len, skel);
}

/** Rebuilds a plain GeoJSON object from a prepared file (optionally watermarked vals). */
function rebuild(prepared, vals) {
    if (prepared.kind === 0) return JSON.parse(prepared.text);
    return decodePlain(buildPlain(prepared, vals));
}

// ─── Envelope (AES-256-GCM) ──────────────────────────────────────────────────

function seal(plain, key) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([MAGIC, iv, body, c.getAuthTag()]);
}

function open(envelope, key) {
    const b = Buffer.from(envelope);
    if (!b.subarray(0, 4).equals(MAGIC)) throw new Error('Not a vector envelope');
    const iv = b.subarray(4, 16);
    const tag = b.subarray(b.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(b.subarray(16, b.length - 16)), d.final()]);
}

// ─── Iteration helper (identify_leak, tests) ─────────────────────────────────

/** Calls fn(x, y) with every x/y position (in degrees) of a GeoJSON object. */
function forEachPosition(obj, fn) {
    const walk = (c) => {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === 'number') { fn(c[0], c[1]); return; }
        for (const x of c) walk(x);
    };
    const geom = (g) => {
        if (!g) return;
        if (g.type === 'GeometryCollection') return (g.geometries || []).forEach(geom);
        walk(g.coordinates);
    };
    const node = (n) => {
        if (!n || typeof n !== 'object') return;
        if (n.type === 'FeatureCollection') return (n.features || []).forEach(node);
        if (n.type === 'Feature') return geom(n.geometry);
        geom(n);
    };
    node(obj);
}

module.exports = {
    XY_SCALE, Z_SCALE, MAGIC,
    prepare, watermarkSeeds, watermarkOffset, applyWatermark,
    buildPlain, decodePlain, rebuild, seal, open, forEachPosition,
};
