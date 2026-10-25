/**
 * One reusable guard chain for land-record vector data (GeoJSON, metadata,
 * shajra overlays). Used by the static data roots in server.js and by
 * /api/geojson. Order:
 *
 *   isAuthenticated (caller) → vectorEntitlement → requireVectorClient
 *     → per-user rpm / rph limiters → distinct-mouza daily quota
 *
 * Only JSON / GeoJSON files count as "vector data" for the header, limits and
 * quota; raster tiles (.png) and PMTiles under the same roots only get the
 * entitlement check.
 */
const logger = require('../utils/logger');
const { vectorConfig } = require('../services/vectorConfig');
const { parseVectorPath, isEntitled } = require('../services/vectorAccess');
const { subscriptionState } = require('../services/accessPolicy');
const { EXPIRED_BODY } = require('./mapAccess');
const { touchDistinct } = require('../services/vectorQuota');
const { makeVectorLimiter } = require('./rateLimiters');

const VECTOR_EXT = /\.(geo)?json$/i;

// ─── Audit (throttled: one row per user / action / 10 min) ───────────────────
const auditSeen = new Map();
function auditVector(req, action, metadata = {}) {
    const userId = req.user?.userId || req.userId || 'anonymous';
    logger.warn(`[vector] ${action}`, { userId, path: req.originalUrl, ip: req.ip, ...metadata });
    const k = `${userId}|${action}`;
    const now = Date.now();
    if (auditSeen.get(k) > now) return;
    auditSeen.set(k, now + 10 * 60e3);
    if (auditSeen.size > 10000) for (const [key, exp] of auditSeen) if (exp < now) auditSeen.delete(key);
    try {
        const AuditLog = require('../models/AuditLog');
        AuditLog.create({
            action, adminId: userId, targetUserId: userId, ipAddress: req.ip,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
            metadata: { path: String(req.originalUrl || '').slice(0, 500), ...metadata }, success: false,
        }).catch(err => logger.error(`[vector] audit write failed: ${err.message}`));
    } catch (_) { /* model unavailable in tests */ }
}

const isVectorRequest = (req) => VECTOR_EXT.test(decodeSafe(req.path)) || req.vectorScope?.api === true;
const decodeSafe = (p) => { try { return decodeURIComponent(p || ''); } catch { return p || ''; } };
const isAdmin = (req) => req.user?.userType === 'admin';

/** Loads legacy fallback fields when the session user has no tehsilAccess. */
async function withLegacyFields(user) {
    if (!user || user.userType === 'admin' || (Array.isArray(user.tehsilAccess) && user.tehsilAccess.length)) return user;
    try {
        const User = require('../models/User');
        const extra = await User.findOne({ userId: user.userId }).select('tehsil mauzaList').lean();
        return { ...user, ...(extra || {}) };
    } catch { return user; }
}

/**
 * Entitlement. `paramsFrom`: 'path' (static roots: tehsil/mouza parsed from the
 * URL below the mount point) or 'params' (express :tehsil/:mauza).
 */
function vectorEntitlement({ paramsFrom = 'path', tilesOnlyWhenExpired = false } = {}) {
    // Expired / pending accounts: mouza GeoJSON is refused (EXPIRED_TILES_ONLY) so the
    // app shows the map as PMTiles tiles instead. Tehsil-wide index files stay open.
    const expiredBlock = (req, res, scope, user) => {
        if (!tilesOnlyWhenExpired || !scope.mouza || !isVectorRequest(req)) return false;
        if (subscriptionState(user) !== 'expired') return false;
        auditVector(req, 'VECTOR_EXPIRED_TILES_ONLY', { tehsil: scope.tehsil, mouza: scope.mouza });
        res.status(403).json(EXPIRED_BODY);
        return true;
    };
    return async (req, res, next) => {
        try {
            if (!req.user) return res.status(401).json({ message: 'Authentication required' });
            let scope;
            if (paramsFrom === 'params') {
                scope = { tehsil: req.params.tehsil, mouza: req.params.mauza || req.params.mouza, api: true };
            } else {
                scope = parseVectorPath(req.path);
                if (!scope) return res.status(400).json({ message: 'Invalid data path' });
            }
            req.vectorScope = scope;
            if (isAdmin(req)) return next();
            const user = await withLegacyFields(req.user);
            if (expiredBlock(req, res, scope, user)) return;
            if (!vectorConfig().entitlement && paramsFrom === 'params') return next();
            // Kill-switch keeps the old tehsil-level rule (mouza ignored).
            const mouza = vectorConfig().entitlement ? scope.mouza : null;
            if (await isEntitled(user, scope.tehsil, mouza)) return next();
            auditVector(req, 'VECTOR_ACCESS_DENIED', { tehsil: scope.tehsil, mouza: scope.mouza });
            return res.status(403).json({
                message: scope.mouza ? 'Access denied: this mouza is not in your subscription.' : 'Access denied to this tehsil data.',
                code: 'VECTOR_NOT_ENTITLED',
            });
        } catch (err) { next(err); }
    };
}

/** Speed bump against scripted downloads / opening URLs in a tab: the app sends X-NZ-Client. */
function requireVectorClient(req, res, next) {
    const cfg = vectorConfig();
    if (!cfg.requireClientHeader || !isVectorRequest(req)) return next();
    if (String(req.headers['x-nz-client'] || '') === cfg.clientHeaderValue) return next();
    auditVector(req, 'VECTOR_CLIENT_HEADER_MISSING', { secFetchMode: req.headers['sec-fetch-mode'] });
    return res.status(403).json({ message: 'Map data can only be opened from the Naqsha Zameen app.', code: 'VECTOR_CLIENT_REQUIRED' });
}

const onLimit = (req, windowName) => auditVector(req, 'VECTOR_RATE_LIMITED', { window: windowName });
const perMinute = makeVectorLimiter({ name: 'minute', windowMs: 60e3, getMax: () => vectorConfig().rpm, onLimit });
const perHour = makeVectorLimiter({ name: 'hour', windowMs: 3600e3, getMax: () => vectorConfig().rph, onLimit });
const onlyVector = (mw) => (req, res, next) => (isVectorRequest(req) ? mw(req, res, next) : next());

/** Distinct mouzas per user per day (tehsil-wide files are free). */
async function mouzaQuota(req, res, next) {
    try {
        const scope = req.vectorScope;
        if (isAdmin(req) || !scope?.mouza || !isVectorRequest(req)) return next();
        const cfg = vectorConfig();
        const max = req.user.userType === 'subadmin' ? cfg.mouzaDailySubAdmin : cfg.mouzaDaily;
        if (!(max > 0)) return next();
        const member = `${String(scope.tehsil).toLowerCase()}|${String(scope.mouza).toLowerCase()}`;
        const r = await touchDistinct(req.user.userId, member, max, { tzOffsetMin: cfg.quotaTzOffsetMin });
        if (r.isNew && r.allowed) logger.info('[vector] mouza opened', { userId: req.user.userId, tehsil: scope.tehsil, mouza: scope.mouza, today: r.count });
        if (r.allowed) return next();
        auditVector(req, 'VECTOR_QUOTA_EXCEEDED', { tehsil: scope.tehsil, mouza: scope.mouza, limit: max });
        res.setHeader('Retry-After', '3600');
        return res.status(429).json({
            message: `Daily limit reached: you can open up to ${max} different mouzas per day. Mouzas you already opened today still work; please try others tomorrow or contact support.`,
            code: 'VECTOR_QUOTA_EXCEEDED',
            limit: max,
        });
    } catch (err) {
        logger.error(`[vector] quota error: ${err.message}`);
        next(); // fail open on infrastructure errors; the rate limiters still apply
    }
}

/** Full chain (after authentication). */
function vectorGuards(opts = {}) {
    return [vectorEntitlement(opts), requireVectorClient, onlyVector(perMinute), onlyVector(perHour), mouzaQuota];
}

module.exports = { vectorGuards, vectorEntitlement, requireVectorClient, mouzaQuota, auditVector, isVectorRequest };
