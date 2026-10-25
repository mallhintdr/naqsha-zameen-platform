const crypto = require('crypto');

// Signs short-lived URLs for the Cloudflare PMTiles worker (cloudflare-worker/pmtiles-worker.js).
//
// URL format (must stay identical to old-repo/backend, which signs for the same worker):
//   <worker>/<encodeURIComponent(seg)/...>?token=<hex>&exp=<unix s>&uid=<userId>
//   token = HMAC_SHA256(PMTILES_SIGNING_KEY, `${relativePath}|${exp}|${userId}`)
//
// Before signing, the user must be entitled to the mouza (same rule as the rest of
// the API: authMiddleware.hasAccess, which follows linked/grouped tehsils).

const SIGNING_KEY = process.env.PMTILES_SIGNING_KEY ? process.env.PMTILES_SIGNING_KEY.trim() : '';
const CLOUDFLARE_WORKER_URL = process.env.CLOUDFLARE_WORKER_URL || process.env.REACT_APP_CLOUDFLARE_WORKER_URL;

// 15 minutes. The frontend refreshes a URL once it is within 4 minutes of expiry.
// The worker rejects tokens that expire more than 2 h ahead, so keep this <= 7200.
const URL_TTL_SECONDS = Math.min(Number(process.env.PMTILES_URL_TTL_SECONDS) || 900, 7200);
const MAX_BATCH = 50;

// Lazily required so this module can be unit-tested without a database.
const deps = {
  hasAccess: (...args) => require('./authMiddleware').hasAccess(...args),
  resolveTehsilForMouza: (...args) => require('../utils/linkedTehsilPath').resolveTehsilForMouza(...args),
  // "All Mouzas" preview: a registered user may get tiles of a mouza they don't own,
  // a few new mouzas per day (services/accessPolicy).
  previewAllowed: async (user, tehsil, mouza) => {
    const { vectorConfig } = require('../services/vectorConfig');
    const { subscriptionState, previewQuota } = require('../services/accessPolicy');
    if (!vectorConfig().publicBrowse || subscriptionState(user) === 'none') return { ok: false };
    const q = await previewQuota(user, tehsil, mouza);
    return { ok: q.allowed, quota: q };
  },
};

const generateSignature = (payload) => {
  if (!SIGNING_KEY) {
    throw new Error('PMTILES_SIGNING_KEY not configured');
  }
  return crypto.createHmac('sha256', SIGNING_KEY).update(payload).digest('hex');
};

// One path segment: no separators, no "|" (the payload delimiter), no dot-segments.
const SAFE_SEGMENT = /^[^/\\|?#\u0000-\u001f]{1,200}$/;
const isSafeSegment = (s) => typeof s === 'string' && SAFE_SEGMENT.test(s) && s !== '.' && s !== '..' && s.trim() === s;

// Files the frontends ask for by name; the mouza is the part before the suffix.
const FILENAME_RE = /^(.+?)(-complete\.pmtiles|-Murabba\.json|-Metadata\.json|\.pmtiles)$/;

/**
 * Validates a file spec and works out which mouza it belongs to.
 * Returns { ok: true, spec, mouza } or { ok: false, message }.
 */
const normalizeSpec = (fileSpec) => {
  const { tehsil, mouza, murabba, filename } = fileSpec || {};
  if (!tehsil || (!mouza && !filename)) return { ok: false, message: 'Missing required parameters' };
  if (!isSafeSegment(tehsil)) return { ok: false, message: 'Invalid tehsil' };
  if (filename) {
    if (!isSafeSegment(filename)) return { ok: false, message: 'Invalid filename' };
    const m = FILENAME_RE.exec(filename);
    if (!m || !isSafeSegment(m[1])) return { ok: false, message: 'Invalid filename' };
    // The filename decides which file is signed, so it also decides which mouza is checked.
    return { ok: true, spec: { tehsil, filename }, mouza: m[1] };
  }
  if (!isSafeSegment(mouza)) return { ok: false, message: 'Invalid mouza' };
  if (murabba !== undefined && murabba !== null && murabba !== '') {
    const safeMurabba = String(murabba).replace(/\//g, '-');
    if (!isSafeSegment(safeMurabba)) return { ok: false, message: 'Invalid murabba' };
    return { ok: true, spec: { tehsil, mouza, murabba: safeMurabba }, mouza };
  }
  return { ok: true, spec: { tehsil, mouza }, mouza };
};

// Generate a single signed URL for a file
const createSignedUrl = (fileSpec, userId, nowMs = Date.now()) => {
  const { tehsil, mouza, murabba, filename } = fileSpec;
  const exp = Math.floor(nowMs / 1000) + URL_TTL_SECONDS;

  // Worker computes filePath = decodeURIComponent(pathname.substring(1)).
  let relativePath;
  if (filename) {
    relativePath = `${tehsil}/${filename}`;
  } else if (murabba) {
    const safeMurabba = String(murabba).replace(/\//g, '-');
    relativePath = `${tehsil}/${mouza}/${safeMurabba}.pmtiles`;
  } else {
    relativePath = `${tehsil}/${mouza}.pmtiles`;
  }

  const token = generateSignature(`${relativePath}|${exp}|${userId}`);
  const baseUrl = CLOUDFLARE_WORKER_URL ? CLOUDFLARE_WORKER_URL.replace(/\/$/, '') : '';
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  const url = `${baseUrl}/${encodedPath}?token=${token}&exp=${exp}&uid=${userId}`;

  return {
    url,
    path: relativePath,
    expiresAt: exp * 1000
  };
};

// Linked tehsils: R2 keeps each mouza under its original tehsil folder, so a
// group (or other linked) name is swapped for the tehsil that holds the mouza.
const realTehsil = async (tehsil, mouza) => {
  try {
    return (await deps.resolveTehsilForMouza(tehsil, mouza)) || tehsil;
  } catch { return tehsil; }
};

/**
 * Checks entitlement and signs one spec for this user.
 * Returns { status, body } where body is the signed result or { error }.
 */
const signForUser = async (user, fileSpec) => {
  const norm = normalizeSpec(fileSpec);
  if (!norm.ok) return { status: 400, error: norm.message };
  const userId = user && user.userId;
  if (!userId || String(userId).includes('|')) return { status: 403, error: 'Access denied' };

  // Entitlement on the tehsil the user asked for (may be a group name).
  const allowed = await deps.hasAccess(user, norm.spec.tehsil, norm.mouza);
  let preview = false;
  if (!allowed) {
    const p = await deps.previewAllowed(user, norm.spec.tehsil, norm.mouza);
    if (p.quota && !p.ok) {
      return { status: 429, error: `Daily preview limit reached: you can preview ${p.quota.limit} new mouzas per day. Mouzas you already opened today still work.`, code: 'PREVIEW_QUOTA' };
    }
    if (!p.ok) return { status: 403, error: 'Access denied: You do not have permission to access this tehsil/mouza.' };
    preview = true;
  }

  const tehsil = await realTehsil(norm.spec.tehsil, norm.mouza);
  if (!isSafeSegment(tehsil)) return { status: 400, error: 'Invalid tehsil' };
  return { status: 200, result: { ...createSignedUrl({ ...norm.spec, tehsil }, userId), ...(preview ? { preview: true } : {}) } };
};

const logDenied = (req, spec, error) => {
  try {
    const logger = require('../utils/logger');
    logger.warn(`[pmtiles-sign] denied user=${req.user && req.user.userId} tehsil=${spec && spec.tehsil} mouza=${spec && (spec.mouza || spec.filename)}: ${error}`);
  } catch { /* logging must never break signing */ }
};

module.exports = {
  // POST /api/pmtiles/signed-url
  generateSignedUrlMiddleware: async (req, res) => {
    try {
      if (!SIGNING_KEY) {
        return res.status(500).json({ success: false, message: 'Server configuration error: Signing key missing' });
      }
      const spec = req.body || {};
      const out = await signForUser(req.user, spec);
      if (out.status !== 200) {
        if (out.status === 403) logDenied(req, spec, out.error);
        return res.status(out.status).json({ success: false, message: out.error, ...(out.code ? { code: out.code } : {}) });
      }
      res.json({ success: true, url: out.result.url, expiresAt: out.result.expiresAt, ...(out.result.preview ? { preview: true } : {}) });
    } catch (error) {
      console.error('Error generating signed URL:', error);
      res.status(500).json({ success: false, message: 'Failed to generate signed URL' });
    }
  },

  // POST /api/pmtiles/signed-urls (Batch)
  generateBatchSignedUrlsMiddleware: async (req, res) => {
    try {
      const { files } = req.body || {}; // Array of { tehsil, mouza, murabba?, filename? }

      if (!SIGNING_KEY) {
        return res.status(500).json({ success: false, message: 'Server configuration error: Signing key missing' });
      }
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid files array' });
      }
      if (files.length > MAX_BATCH) {
        return res.status(400).json({ success: false, message: `Batch size limit exceeded (max ${MAX_BATCH})` });
      }

      // Results stay in request order (the frontend matches them by index).
      const urls = await Promise.all(files.map(async (file) => {
        try {
          const out = await signForUser(req.user, file);
          if (out.status === 200) return out.result;
          if (out.status === 403) logDenied(req, file, out.error);
          if (out.code) return { error: out.error, code: out.code, fileSpec: file };
          return { error: out.status === 403 ? 'Access denied' : 'Invalid parameters', fileSpec: file };
        } catch (e) {
          return { error: 'Generation failed', fileSpec: file };
        }
      }));

      res.json({ success: true, urls });
    } catch (error) {
      console.error('Error generating batch signed URLs:', error);
      res.status(500).json({ success: false, message: 'Failed to generate batch signed URLs' });
    }
  },

  // Exposed for tests.
  _internal: { createSignedUrl, normalizeSpec, signForUser, deps, URL_TTL_SECONDS }
};
