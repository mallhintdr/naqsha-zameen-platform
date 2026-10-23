/**
 * Sends vector data (GeoJSON / metadata JSON) with no-store headers and,
 * when enabled, a per-user forensic watermark and/or the obfuscated envelope.
 *
 *  - Envelope: only when VECTOR_ENVELOPE is on AND the request opts in
 *    (?enc=1 or Accept: application/x-nz-vector). Otherwise plain JSON, so old
 *    clients and tooling keep working.
 *  - Watermark: when VECTOR_WATERMARK is on, applied to plain JSON and envelope
 *    responses alike (admins exempt unless VECTOR_WATERMARK_ADMINS).
 *  - Neither: the file is streamed as-is (fast path, identical to before).
 */
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../utils/logger');
const codec = require('./vectorCodec');
const { vectorConfig } = require('./vectorConfig');

const ENVELOPE_TYPE = 'application/x-nz-vector';

// ─── Caches ──────────────────────────────────────────────────────────────────
class ByteLru {
    constructor(maxBytesFn) { this.map = new Map(); this.bytes = 0; this.maxBytesFn = maxBytesFn; }
    get(k) { const v = this.map.get(k); if (v) { this.map.delete(k); this.map.set(k, v); } return v?.value; }
    set(k, value, size) {
        const old = this.map.get(k); if (old) { this.bytes -= old.size; this.map.delete(k); }
        this.map.set(k, { value, size }); this.bytes += size;
        const max = this.maxBytesFn();
        while (this.bytes > max && this.map.size > 1) {
            const [ok, ov] = this.map.entries().next().value; this.map.delete(ok); this.bytes -= ov.size;
        }
    }
    clear() { this.map.clear(); this.bytes = 0; }
}
const preparedCache = new ByteLru(() => vectorConfig().cacheMb * 0.75 * 1048576);
const userCache = new ByteLru(() => vectorConfig().cacheMb * 0.25 * 1048576);
const inflight = new Map();

const preparedSize = (p) => (p.kind === 0 ? p.text.length * 2 : p.skeleton.length * 2 + p.vals.byteLength + p.dims.byteLength);

async function preparedForFile(file) {
    const st = await fs.promises.stat(file);
    const key = `${file}|${st.mtimeMs}|${st.size}`;
    const hit = preparedCache.get(key);
    if (hit) return { key, prepared: hit };
    if (!inflight.has(key)) {
        inflight.set(key, (async () => {
            const text = await fs.promises.readFile(file, 'utf8');
            const p = codec.prepare(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
            preparedCache.set(key, p, preparedSize(p));
            return p;
        })().finally(() => inflight.delete(key)));
    }
    return { key, prepared: await inflight.get(key) };
}

// ─── Keys ────────────────────────────────────────────────────────────────────
const bucketMs = () => vectorConfig().envelopeKeyTtlMin * 60e3;
const currentBucket = (now = Date.now()) => Math.floor(now / bucketMs());

/** Per-session key: HMAC(secret, user | tokenVersion | session iat | time bucket). */
function sessionKey(req, bucket) {
    const u = req.user || {};
    const iat = req.authSession?.iat ?? 0;
    return crypto.createHmac('sha256', vectorConfig().envelopeSecret)
        .update(`nzv1|${String(u.userId || '').toLowerCase()}|${u.tokenVersion || 0}|${iat}|${bucket}`)
        .digest();
}

/** GET /api/vector-key[?kid=] — the key for the current (or previous) bucket. */
function vectorKeyHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    const cfg = vectorConfig();
    if (!cfg.envelope) return res.json({ enabled: false });
    const cur = currentBucket();
    let bucket = cur;
    if (req.query.kid !== undefined) {
        const k = parseInt(req.query.kid, 10);
        if (k === cur || k === cur - 1) bucket = k;
        else return res.status(410).json({ message: 'Key expired', kid: cur });
    }
    res.json({ enabled: true, kid: String(bucket), key: sessionKey(req, bucket).toString('base64'), expiresAt: new Date((bucket + 1) * bucketMs()).toISOString() });
}

// ─── Sending ─────────────────────────────────────────────────────────────────
function setVectorHeaders(res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Cookie, Accept, X-NZ-Client');
}

const wantsEnvelope = (req) => req.query?.enc === '1' || String(req.headers.accept || '').includes(ENVELOPE_TYPE);

function watermarkFor(req) {
    const cfg = vectorConfig();
    if (!cfg.watermark || !req.user?.userId) return null;
    if (req.user.userType === 'admin' && !cfg.watermarkAdmins) return null;
    return { seeds: codec.watermarkSeeds(cfg.watermarkSecret, req.user.userId), k: cfg.watermarkUnits };
}

/** Core: send a prepared payload according to flags. `cacheKey` enables per-user caching. */
function sendPrepared(req, res, prepared, cacheKey) {
    const cfg = vectorConfig();
    const wm = prepared.kind === 1 ? watermarkFor(req) : null;
    const envelope = cfg.envelope && wantsEnvelope(req);
    const userKey = wm && cacheKey ? `${cacheKey}|${String(req.user.userId).toLowerCase()}|${envelope ? 'p' : 'j'}` : null;

    let body = userKey ? userCache.get(userKey) : undefined;
    if (!body) {
        const vals = wm ? codec.applyWatermark(prepared, wm.seeds, wm.k) : prepared.vals;
        body = envelope ? codec.buildPlain(prepared, vals) : Buffer.from(JSON.stringify(codec.rebuild(prepared, vals)), 'utf8');
        if (userKey) userCache.set(userKey, body, body.length);
    }
    if (envelope) {
        const bucket = currentBucket();
        res.setHeader('Content-Type', ENVELOPE_TYPE);
        res.setHeader('X-NZ-Kid', String(bucket));
        res.setHeader('Access-Control-Expose-Headers', 'X-NZ-Kid, X-Request-ID');
        return res.end(codec.seal(body, sessionKey(req, bucket)));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(body);
}

/** Static file under a data root (already entitlement-checked). */
async function sendVectorFile(req, res, file) {
    setVectorHeaders(res);
    const cfg = vectorConfig();
    const needsProcessing = (cfg.envelope && wantsEnvelope(req)) || watermarkFor(req);
    if (!needsProcessing) return res.sendFile(file, { headers: { 'Cache-Control': 'private, no-store' }, cacheControl: false, etag: false, lastModified: false });
    let prepared, key;
    try {
        ({ prepared, key } = await preparedForFile(file));
    } catch (err) {
        logger.warn(`[vector] could not prepare ${file}: ${err.message}; sending as-is`);
        return res.sendFile(file, { cacheControl: false, etag: false, lastModified: false });
    }
    return sendPrepared(req, res, prepared, key);
}

/** In-memory object (e.g. /api/geojson from Mongo/Redis). */
function sendVectorObject(req, res, obj) {
    setVectorHeaders(res);
    const cfg = vectorConfig();
    if (!((cfg.envelope && wantsEnvelope(req)) || watermarkFor(req))) return res.json(obj);
    return sendPrepared(req, res, codec.prepare(obj), null);
}

const _clearCaches = () => { preparedCache.clear(); userCache.clear(); };

module.exports = { sendVectorFile, sendVectorObject, vectorKeyHandler, sessionKey, currentBucket, setVectorHeaders, ENVELOPE_TYPE, _clearCaches };
