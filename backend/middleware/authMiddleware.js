const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { calculateDatesAndStatus } = require('../utils/dateUtils');
const { ensureUserTehsilState } = require('../utils/userUtils');

const SECRET_KEY = process.env.SECRET_KEY;
const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax')).toLowerCase();
const _IS_PROD_AUTH = process.env.NODE_ENV === 'production' ||
    (process.env.CORS_ORIGIN || '').startsWith('https://');
const COOKIE_SECURE = _IS_PROD_AUTH || COOKIE_SAMESITE === 'none';
const { COOKIE_DOMAIN } = require('../utils/siteConfig');

const isAuthenticated = async (req, res, next) => {
    // Extract all candidate authToken cookies from both req.cookies and raw header
    // to handle collisions where a stale host-only cookie shadows the valid domain cookie.
    const rawCookie = req.headers.cookie || '';
    const candidateTokens = [];
    if (req.cookies?.authToken) candidateTokens.push(req.cookies.authToken);
    const matches = [...rawCookie.matchAll(/(?:^|;\s*)authToken=([^;]+)/g)];
    for (const m of matches) {
        const t = decodeURIComponent(m[1]);
        if (!candidateTokens.includes(t)) candidateTokens.push(t);
    }

    if (candidateTokens.length === 0) {
        return res.status(401).json({ message: 'Not authenticated' });
    }

    let authenticatedUser = null;
    let authSession = null;

    for (const token of candidateTokens) {
        try {
            const decoded = jwt.verify(token, SECRET_KEY);
            // SCALE-01: indexed exact match on userIdLower instead of a case-insensitive
            // $regex query, which cannot use the userId index and forces a COLLSCAN.
            const user = await User.findOne({ userIdLower: String(decoded.userId || '').toLowerCase() })
                .select('userId userType tokenVersion tehsilAccess activeTehsil status subscriptionType startDate endDate')
                .lean();

            if (user && (decoded.tokenVersion === undefined || decoded.tokenVersion === (user.tokenVersion || 0))) {
                authenticatedUser = user;
                authSession = { iat: decoded.iat }; // vector envelope keys are per session
                break;
            }
        } catch (_) {}
    }

    if (!authenticatedUser) {
        // Clear all cookies (both domain and host-only variants)
        res.clearCookie('authToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
           .clearCookie('authToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE })
           .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, domain: COOKIE_DOMAIN })
           .clearCookie('adminAuthToken', { httpOnly: true, path: '/', secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE });
        return res.status(401).json({ message: 'User session not found. Please log in again.' });
    }

    req.user = authenticatedUser;
    req.userId = authenticatedUser.userId;
    req.authSession = authSession;
    next();
};

// Same mouza-level rule as the vector guards (temp grants, linked / grouped tehsils).
// The old version ignored tempGrants, so an entry holding only temp grants counted as
// the whole tehsil.
const hasAccess = async (user, tehsil, mouza) => {
    if (user?.userType === 'admin') return true;
    if (!tehsil) return true;
    return require('../services/vectorAccess').isEntitled(user, tehsil, mouza || null);
};

const isSubscribed = async (req, res, next) => {
    if (req.user.userType === 'admin') return next();

    // SEC-06: Actually block expired users from accessing map/data endpoints.
    // Respect the explicit database status first for manual overrides
    if (req.user.status === 'Expired') {
        return res.status(403).json({
            message: 'Your subscription has expired. Please contact support to renew your subscription.',
            expired: true
        });
    }
    if (req.user.status === 'Pending' || req.user.status === 'AwaitingActivation') {
        return res.status(403).json({
            message: 'Your account is pending activation.',
            pending: true
        });
    }
    if (req.user.status === 'Suspended') {
        return res.status(403).json({
            message: 'Your account is suspended. Please contact your provider.',
            suspended: true
        });
    }

    const { status } = calculateDatesAndStatus(req.user.startDate, req.user.subscriptionType);

    if (status === 'Expired') {
        return res.status(403).json({
            message: 'Your subscription has expired. Please contact support to renew your subscription.',
            expired: true
        });
    }

    // HIGH-01: Enforce Tehsil/Mouza access check
    const tehsil = req.params.tehsil;
    const mouza = req.params.mauza || req.params.mouza;
    const allowed = await hasAccess(req.user, tehsil, mouza);
    if (!allowed) {
        return res.status(403).json({ message: 'Access denied: You do not have permission to access this tehsil/mouza.' });
    }

    next();
};

const isSubscribedOrLimitedZoom = async (req, res, next) => {
    if (req.user.userType === 'admin') return next();

    // HIGH-01: Enforce Tehsil/Mouza access check
    const tehsil = req.params.tehsil;
    const mouza = req.params.mauza || req.params.mouza;
    const allowed = await hasAccess(req.user, tehsil, mouza);
    if (!allowed) {
        return res.status(403).json({ message: 'Access denied: You do not have permission to access this tehsil/mouza.' });
    }

    let isExpiredOrPending = false;
    if (req.user.status === 'Suspended') {
        return res.status(403).json({ message: 'Your account is suspended. Please contact your provider.', suspended: true });
    }
    if (['Expired', 'Pending', 'AwaitingActivation'].includes(req.user.status)) {
        isExpiredOrPending = true;
    } else {
        const { status } = calculateDatesAndStatus(req.user.startDate, req.user.subscriptionType);
        if (status === 'Expired') {
            isExpiredOrPending = true;
        }
    }

    if (isExpiredOrPending) {
        // Enforce max zoom level of 16 for expired/pending users on all endpoints.
        // For shajra tiles, z is in params. For geojson/pmtiles, z must be provided in query.
        let z = req.params.z !== undefined ? parseInt(req.params.z, 10) : undefined;
        if (z === undefined && req.query.z !== undefined) {
            z = parseInt(req.query.z, 10);
        }

        if (z !== undefined && !isNaN(z) && z <= 16) {
            return next();
        }
        
        return res.status(403).json({
            message: 'Your subscription has expired. Please contact support to renew your subscription.',
            expired: true
        });
    }

    next();
};

const isAdmin = (req, res, next) => {
    if (req.user.userType !== 'admin') {
        return res.status(403).json({ message: 'Forbidden: admins only' });
    }
    next();
};

/**
 * Sub-admin gate: the account must be a sub-admin, and its SubAdmin profile
 * is loaded onto req.subAdmin. Disabled sub-admins and ones still awaiting
 * activation are refused (they activate through a public route).
 */
const isSubAdmin = async (req, res, next) => {
    if (req.user.userType !== 'subadmin') {
        return res.status(403).json({ message: 'Forbidden: sub-admins only' });
    }
    const SubAdmin = require('../models/SubAdmin');
    const subAdmin = await SubAdmin.findOne({ userId: req.user.userId });
    if (!subAdmin) return res.status(403).json({ message: 'Sub-admin profile not found' });
    if (subAdmin.status === 'disabled') {
        return res.status(403).json({ message: 'Your sub-admin account has been disabled. Please contact the admin.', disabled: true });
    }
    if (subAdmin.status === 'awaiting_activation') {
        return res.status(403).json({ message: 'Please activate your sub-admin account from the email we sent you.', awaitingActivation: true });
    }
    req.subAdmin = subAdmin;
    next();
};

/** Write actions are refused while suspended for unpaid bills (view-only). */
const requireSubAdminWritable = (req, res, next) => {
    if (req.subAdmin.status === 'suspended_unpaid') {
        return res.status(403).json({
            message: 'Your account is suspended for unpaid bills. You can view your users and bills; creating, renewing and editing resume once payment is recorded.',
            suspended: true
        });
    }
    next();
};

/**
 * Admin, the user themself, or the sub-admin who manages this user (their own
 * customer). Sets req.actingSubAdmin (the SubAdmin record) for the last case.
 * Writes are refused while the sub-admin is suspended/disabled/not activated.
 */
const isSelfAdminOrOwner = async (req, res, next) => {
    try {
        if (req.user.userType === 'admin' || req.user.userId === req.params.userId) return next();
        if (req.user.userType !== 'subadmin') return res.status(403).json({ message: 'Forbidden' });
        const User = require('../models/User');
        const SubAdmin = require('../models/SubAdmin');
        const target = await User.findOne({ userId: req.params.userId }).select('managedBy userType').lean();
        if (!target || target.userType !== 'user' || target.managedBy !== req.user.userId) {
            return res.status(404).json({ message: 'User not found' });
        }
        const sa = await SubAdmin.findOne({ userId: req.user.userId });
        if (!sa) return res.status(403).json({ message: 'Forbidden' });
        if (req.method !== 'GET' && ['suspended_unpaid', 'disabled', 'awaiting_activation'].includes(sa.status)) {
            return res.status(403).json({ message: sa.status === 'suspended_unpaid'
                ? 'Your account is suspended for unpaid bills. Changes resume once your payment is recorded.'
                : 'Your sub-admin account is not active.' });
        }
        req.actingSubAdmin = sa;
        next();
    } catch (err) { next(err); }
};

/** Admin, or the sub-admin who manages this customer (not the user themself). */
const isAdminOrOwner = (req, res, next) => {
    if (req.user.userType !== 'admin' && req.user.userType !== 'subadmin') return res.status(403).json({ message: 'Forbidden' });
    if (req.user.userType === 'subadmin' && req.user.userId === req.params.userId) return res.status(403).json({ message: 'Forbidden' });
    return isSelfAdminOrOwner(req, res, next);
};

const isSelfOrAdmin = (req, res, next) => {
    if (req.user.userType === 'admin' || req.user.userId === req.params.userId) {
        return next();
    }
    res.status(403).json({ message: 'Forbidden' });
};

/**
 * Lightweight auth: only verifies JWT, no DB lookup.
 * Use for high-frequency endpoints like /api/heartbeat.
 */
const isAuthenticatedLight = (req, res, next) => {
    const token = req.cookies.authToken;
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = { userId: decoded.userId };
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

const maybeAuthenticated = async (req, res, next) => {
    const token = req.cookies.authToken;
    if (!token) return next();

    jwt.verify(token, SECRET_KEY, async (err, decoded) => {
        if (err) return next();
        try {
            const user = await User.findOne({ userId: decoded.userId }).select('userType userId').lean();
            if (user) {
                req.user = user;
                req.userId = user.userId;
            }
            next();
        } catch (error) {
            next();
        }
    });
};

module.exports = { hasAccess, isAuthenticated, isAuthenticatedLight, maybeAuthenticated, isSubscribed, isSubscribedOrLimitedZoom, isAdmin, isSelfOrAdmin, isSelfAdminOrOwner, isAdminOrOwner, isSubAdmin, requireSubAdminWritable };
