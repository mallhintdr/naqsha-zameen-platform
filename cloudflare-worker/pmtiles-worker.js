/**
 * Cloudflare Worker: secure PMTiles / metadata gateway in front of R2.
 *
 * Every data object (.pmtiles, .json) needs a URL signed by the backend
 * (backend/middleware/signedPMTilesUrl.js, identical in old-repo/backend):
 *
 *   /<encodeURIComponent(seg)/...>?token=<hex HMAC-SHA256>&exp=<unix s>&uid=<userId>
 *   token = HMAC_SHA256(PMTILES_SIGNING_KEY, `${decodedPath}|${exp}|${uid}`)
 *
 * decodedPath is decodeURIComponent(pathname without the leading "/"), exactly
 * as the backend builds it before encoding each segment. Any change to the
 * path, exp or uid breaks the signature (so a token for one mouza cannot be
 * reused for another).
 *
 * .pmtiles are served ONLY as closed byte ranges (`Range: bytes=a-b`) no larger
 * than MAX_RANGE_BYTES, so a single request can never pull a whole archive.
 * The edge cache is keyed by object path + range (never by token) and is only
 * consulted after the token has been validated.
 *
 * Public endpoint (old production frontend calls it without a token):
 *   GET /list-tehsils  -> JSON array of top-level folder names only.
 *
 * Environment:
 *   PMTILES_SIGNING_KEY  (secret)  same value as backend .env
 *   PMTILES_BUCKET       (R2 binding)
 *   PMTILES_RATE_LIMITER (optional Rate Limiting binding, keyed by uid)
 *   MAX_RANGE_BYTES      (optional var, default 2 MiB)
 *   ENFORCE_ORIGIN       (optional var, "false" allows requests without an allowed Origin)
 *   EXPIRY_GRACE_SECONDS (optional var, default 0, max 3600) accept tokens this long after exp
 */

export const ALLOWED_ORIGINS = new Set([
  'https://dashboard.naqsha-zameen.pk',
  'https://dashboard.naqsha-zameen.com',
  'http://localhost:3000',
  'http://localhost:5000',
]);
const LOCALHOST_RE = /^http:\/\/localhost(:\d{1,5})?$/;

export const DEFAULT_MAX_RANGE_BYTES = 2 * 1024 * 1024; // pmtiles header fetch is 16 KiB; dirs/tiles are far smaller
const MAX_TOKEN_LIFETIME_S = 2 * 3600; // backend signs 15 min (new) / 1 h (old); anything longer is rejected
const CLOCK_SKEW_S = 60;
const FALLBACK_RATE_LIMIT = 1200; // per uid per minute, per isolate (only when no binding)
const CACHE_ORIGIN = 'https://pmtiles-cache.internal';

const rateLimitMap = new Map();

export function isAllowedOrigin(origin) {
  return !!origin && (ALLOWED_ORIGINS.has(origin) || LOCALHOST_RE.test(origin));
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (isAllowedOrigin(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Credentials'] = 'true';
    h['Access-Control-Expose-Headers'] = 'Content-Range, Content-Length, Accept-Ranges, ETag';
  }
  return h;
}

function reply(request, status, body, extra = {}) {
  const headers = new Headers(corsHeaders(request));
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

function log(event) {
  try { console.log(JSON.stringify({ t: new Date().toISOString(), ...event })); } catch { /* ignore */ }
}

export default {
  async fetch(request, env, ctx) {
    const started = Date.now();
    const url = new URL(request.url);
    const meta = {
      method: request.method,
      path: url.pathname,
      uid: url.searchParams.get('uid') || null,
      range: request.headers.get('Range') || null,
      origin: request.headers.get('Origin') || null,
      ip: request.headers.get('CF-Connecting-IP') || null,
    };
    let response;
    try {
      response = await handle(request, env, ctx, url, meta);
    } catch (error) {
      log({ evt: 'error', ...meta, error: String(error && error.message || error) });
      response = reply(request, 500, 'Internal server error');
    }
    log({ evt: 'req', ...meta, status: response.status, cache: response.headers.get('X-Cache') || null, ms: Date.now() - started });
    return response;
  },
};

async function handle(request, env, ctx, url, meta) {
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin');
    if (!isAllowedOrigin(origin)) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(request),
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, If-Match, If-None-Match, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return reply(request, 405, 'Method not allowed', { Allow: 'GET, HEAD, OPTIONS' });
  }

  const pathname = url.pathname;

  // Public (old production frontend fetches it with credentials: 'omit' and no token).
  if (pathname === '/list-tehsils') return handleListTehsils(request, env, ctx);

  // Was public and returned every mouza of a tehsil; no frontend (old or new) calls it.
  if (pathname.startsWith('/list-mouzas/')) return reply(request, 404, 'Not found');

  let filePath;
  try { filePath = decodeURIComponent(pathname.substring(1)); } catch { return reply(request, 400, 'Bad path'); }
  if (!filePath || filePath.includes('\\') || filePath.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    return reply(request, 400, 'Bad path');
  }
  const isPmtiles = filePath.endsWith('.pmtiles');
  const isJson = filePath.endsWith('.json');
  if (!isPmtiles && !isJson) return reply(request, 404, 'Not found');

  if (String(env.ENFORCE_ORIGIN ?? 'true').toLowerCase() !== 'false' && !isAllowedOrigin(request.headers.get('Origin'))) {
    return reply(request, 403, 'Origin not allowed');
  }

  const auth = await validateToken(url, env, filePath);
  if (!auth.valid) {
    log({ evt: 'auth_fail', ...meta, reason: auth.reason });
    return reply(request, auth.status, auth.error);
  }
  meta.uid = auth.userId;

  if (!(await checkRateLimit(env, auth.userId))) {
    log({ evt: 'rate_limited', ...meta });
    return reply(request, 429, 'Rate limit exceeded. Please try again later.', { 'Retry-After': '60' });
  }

  if (isPmtiles) return servePmtilesRange(request, env, ctx, filePath);
  return serveJson(request, env, ctx, filePath);
}

// ---------------------------------------------------------------- auth

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function validateToken(url, env, filePath, nowS = Math.floor(Date.now() / 1000)) {
  const token = url.searchParams.get('token');
  const exp = url.searchParams.get('exp');
  const userId = url.searchParams.get('uid');

  if (!token || !exp || !userId) {
    return { valid: false, status: 401, reason: 'missing', error: 'Missing authentication parameters' };
  }
  // uid must not contain the payload separator (would allow shifting fields).
  if (!/^[0-9a-f]{64}$/i.test(token) || !/^\d{1,12}$/.test(exp) || userId.length > 128 || userId.includes('|')) {
    return { valid: false, status: 403, reason: 'malformed', error: 'Invalid authentication token' };
  }
  const expS = parseInt(exp, 10);
  // Optional rollout aid: accept recently expired tokens for long-open old-frontend tabs.
  const graceS = Math.min(Math.max(Number(env.EXPIRY_GRACE_SECONDS) || 0, 0), 3600);
  if (nowS > expS + graceS) {
    return { valid: false, status: 403, reason: 'expired', error: 'URL has expired. Please refresh and try again.' };
  }
  if (expS - nowS > MAX_TOKEN_LIFETIME_S + CLOCK_SKEW_S) {
    return { valid: false, status: 403, reason: 'exp_too_far', error: 'Invalid authentication token' };
  }
  const signingKey = env.PMTILES_SIGNING_KEY ? String(env.PMTILES_SIGNING_KEY).trim() : '';
  if (!signingKey) {
    log({ evt: 'config_error', error: 'PMTILES_SIGNING_KEY not configured' });
    return { valid: false, status: 500, reason: 'no_key', error: 'Server configuration error' };
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  // subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify('HMAC', key, hexToBytes(token), enc.encode(`${filePath}|${exp}|${userId}`));
  if (!ok) return { valid: false, status: 403, reason: 'bad_signature', error: 'Invalid authentication token' };
  return { valid: true, userId };
}

// ---------------------------------------------------------------- rate limit

async function checkRateLimit(env, userId) {
  if (env.PMTILES_RATE_LIMITER && typeof env.PMTILES_RATE_LIMITER.limit === 'function') {
    try {
      const { success } = await env.PMTILES_RATE_LIMITER.limit({ key: `uid:${userId}` });
      return success;
    } catch (e) {
      log({ evt: 'ratelimit_binding_error', error: String(e && e.message || e) });
    }
  }
  const now = Date.now();
  const k = `uid:${userId}`;
  const entry = rateLimitMap.get(k);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(k, { count: 1, resetTime: now + 60000 });
    if (rateLimitMap.size > 10000) rateLimitMap.delete(rateLimitMap.keys().next().value);
    return true;
  }
  entry.count++;
  return entry.count <= FALLBACK_RATE_LIMIT;
}

// ---------------------------------------------------------------- range serving

export function parseRange(header, maxBytes) {
  if (!header) return { ok: false, error: 'Range header required' };
  const m = /^bytes=(\d{1,15})-(\d{1,15})$/.exec(header.trim());
  if (!m) return { ok: false, error: 'Only a single closed range (bytes=a-b) is supported' };
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (end < start) return { ok: false, error: 'Invalid range' };
  if (end - start + 1 > maxBytes) return { ok: false, error: `Range too large (max ${maxBytes} bytes)` };
  return { ok: true, start, end };
}

function edgeCache() {
  return (typeof caches !== 'undefined' && caches && caches.default) ? caches.default : null;
}

function cacheKeyFor(filePath, suffix) {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return new Request(`${CACHE_ORIGIN}/${encoded}${suffix}`, { method: 'GET' });
}

function dataHeaders(request, contentType) {
  const headers = new Headers(corsHeaders(request));
  headers.set('Content-Type', contentType);
  // URLs carry a per-user token; browsers may reuse, shared caches must not.
  headers.set('Cache-Control', 'private, max-age=3600, no-transform');
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

async function servePmtilesRange(request, env, ctx, filePath) {
  const maxBytes = Number(env.MAX_RANGE_BYTES) > 0 ? Number(env.MAX_RANGE_BYTES) : DEFAULT_MAX_RANGE_BYTES;
  const range = parseRange(request.headers.get('Range'), maxBytes);
  if (!range.ok) return reply(request, 416, range.error);

  const cache = edgeCache();
  const key = cacheKeyFor(filePath, `?r=${range.start}-${range.end}`);

  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const headers = dataHeaders(request, 'application/vnd.pmtiles');
      for (const h of ['Content-Range', 'ETag', 'Content-Length']) {
        const v = hit.headers.get(h === 'Content-Range' ? 'X-Content-Range' : h);
        if (v) headers.set(h, v);
      }
      headers.set('Accept-Ranges', 'bytes');
      headers.set('X-Cache', 'HIT');
      return new Response(request.method === 'HEAD' ? null : hit.body, { status: 206, headers });
    }
  }

  let obj;
  try {
    obj = await env.PMTILES_BUCKET.get(filePath, { range: { offset: range.start, length: range.end - range.start + 1 } });
  } catch {
    // Typically a range starting beyond the end of the object.
    const head = await env.PMTILES_BUCKET.head(filePath);
    if (!head) return reply(request, 404, 'Not found');
    return reply(request, 416, 'Range not satisfiable', { 'Content-Range': `bytes */${head.size}` });
  }
  if (!obj) return reply(request, 404, 'Not found');

  const size = obj.size;
  if (range.start >= size) {
    return reply(request, 416, 'Range not satisfiable', { 'Content-Range': `bytes */${size}` });
  }
  const offset = obj.range && typeof obj.range.offset === 'number' ? obj.range.offset : range.start;
  const length = obj.range && typeof obj.range.length === 'number'
    ? obj.range.length
    : Math.min(range.end, size - 1) - range.start + 1;
  const contentRange = `bytes ${offset}-${offset + length - 1}/${size}`;

  const body = await obj.arrayBuffer();
  const headers = dataHeaders(request, 'application/vnd.pmtiles');
  headers.set('Content-Range', contentRange);
  headers.set('Content-Length', String(body.byteLength));
  headers.set('Accept-Ranges', 'bytes');
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  headers.set('X-Cache', 'MISS');

  if (cache) {
    // Cache API cannot store 206; store the slice as a 200 under the range key.
    const ch = new Headers({
      'Content-Type': 'application/vnd.pmtiles',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Range': contentRange,
      'Content-Length': String(body.byteLength),
    });
    if (obj.httpEtag) ch.set('ETag', obj.httpEtag);
    const put = cache.put(key, new Response(body.slice(0), { status: 200, headers: ch }));
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }

  return new Response(request.method === 'HEAD' ? null : body, { status: 206, headers });
}

async function serveJson(request, env, ctx, filePath) {
  const cache = edgeCache();
  const key = cacheKeyFor(filePath, '');
  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      const headers = dataHeaders(request, 'application/json');
      const etag = hit.headers.get('ETag');
      if (etag) headers.set('ETag', etag);
      headers.set('X-Cache', 'HIT');
      return new Response(request.method === 'HEAD' ? null : hit.body, { status: 200, headers });
    }
  }
  const obj = await env.PMTILES_BUCKET.get(filePath);
  if (!obj) return reply(request, 404, 'Not found');
  const body = await obj.arrayBuffer();
  const headers = dataHeaders(request, 'application/json');
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  headers.set('X-Cache', 'MISS');
  if (cache) {
    const ch = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
    if (obj.httpEtag) ch.set('ETag', obj.httpEtag);
    const put = cache.put(key, new Response(body.slice(0), { status: 200, headers: ch }));
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
}

// ---------------------------------------------------------------- listing

async function handleListTehsils(request, env, ctx) {
  const cache = edgeCache();
  const key = new Request(`${CACHE_ORIGIN}/__list-tehsils`, { method: 'GET' });
  let json = null;
  if (cache) {
    const hit = await cache.match(key);
    if (hit) json = await hit.text();
  }
  if (json === null) {
    const names = new Set();
    let cursor;
    do {
      const listed = await env.PMTILES_BUCKET.list({ delimiter: '/', limit: 1000, cursor });
      for (const prefix of listed.delimitedPrefixes || []) {
        const name = prefix.replace(/\/$/, '');
        if (name) names.add(name);
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    json = JSON.stringify([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    if (cache) {
      const put = cache.put(key, new Response(json, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } }));
      if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
    }
  }
  const headers = new Headers(corsHeaders(request));
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(request.method === 'HEAD' ? null : json, { status: 200, headers });
}
