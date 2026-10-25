/**
 * One answer to "what may this user see of this tehsil / mouza?" for every map-data
 * route, the PMTiles signer and the static fallbacks (docs/PUBLIC-BROWSE-PLAN.md §3.1).
 *
 *   'full'    admin, or entitled to the mouza with an active subscription
 *   'expired' entitled, but the subscription is expired / pending activation:
 *             map tiles only (PMTiles, shajra raster), no GeoJSON downloads
 *   'preview' not entitled, but "All Mouzas" browsing is on (PUBLIC_BROWSE): tiles only via
 *             the signed worker URLs, a few new mouzas per day (previewQuota)
 *   'none'    suspended, not logged in, or not entitled with browsing off
 *
 * Entitlement is the mouza-level rule from vectorAccess.isEntitled (temp grants,
 * linked / grouped tehsils), so every route gives the same answer.
 */
const { isEntitled } = require('./vectorAccess');
const { calculateDatesAndStatus } = require('../utils/dateUtils');
const { vectorConfig } = require('./vectorConfig');
const { touchDistinct, countDistinct, hasDistinct } = require('./vectorQuota');

const EXPIRED_STATUSES = new Set(['Expired', 'Pending', 'AwaitingActivation']);

/** Subscription state of the account itself: 'full' | 'expired' | 'none'. */
function subscriptionState(user) {
    if (!user) return 'none';
    if (user.userType === 'admin') return 'full';
    if (user.status === 'Suspended') return 'none';
    if (EXPIRED_STATUSES.has(user.status)) return 'expired';
    try {
        const { status } = calculateDatesAndStatus(user.startDate, user.subscriptionType);
        if (status === 'Expired') return 'expired';
    } catch {
        return 'expired'; // unknown dates: never more than tiles
    }
    return 'full';
}

/**
 * @param {object} user lean user (userType, status, subscriptionType, startDate, tehsilAccess)
 * @param {string} tehsil requested tehsil (any linked / group name)
 * @param {string|null} mouza requested mouza, null for tehsil-wide files
 * @param {object} [opts] passed to isEntitled (tests: linked, now)
 * @returns {Promise<'full'|'expired'|'none'>}
 */
async function accessLevel(user, tehsil, mouza, opts = {}) {
    if (!user) return 'none';
    if (user.userType === 'admin') return 'full';
    const state = subscriptionState(user);
    if (state === 'none') return 'none';
    if (!(await isEntitled(user, tehsil, mouza ?? null, opts))) {
        return vectorConfig().publicBrowse && mouza ? 'preview' : 'none';
    }
    return state;
}

const member = (tehsil, mouza) => `${String(tehsil).toLowerCase()}|${String(mouza).toLowerCase()}`;
const quotaOpts = () => ({ scope: 'preview', tzOffsetMin: vectorConfig().quotaTzOffsetMin });

/**
 * Daily limit on distinct preview mouzas. A mouza already previewed today stays open.
 * @returns {Promise<{allowed: boolean, used: number, limit: number}>}
 */
async function previewQuota(user, tehsil, mouza) {
    const limit = vectorConfig().previewMouzasPerDay;
    const r = await touchDistinct(user.userId, member(tehsil, mouza), limit, quotaOpts());
    return { allowed: r.allowed, used: r.count, limit };
}

/** Preview mouzas used today and the daily limit (no change). */
async function previewUsage(user) {
    return { used: await countDistinct(user.userId, quotaOpts()), limit: vectorConfig().previewMouzasPerDay };
}

async function previewOpenedToday(user, tehsil, mouza) {
    return hasDistinct(user.userId, member(tehsil, mouza), quotaOpts());
}

module.exports = { accessLevel, subscriptionState, previewQuota, previewUsage, previewOpenedToday };
