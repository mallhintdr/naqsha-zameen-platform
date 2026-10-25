/**
 * Route guard built on services/accessPolicy.accessLevel. Replaces
 * isSubscribedOrLimitedZoom on map-data routes (its zoom gate trusted a
 * client-supplied ?z and is gone: expired users now get tiles at any zoom).
 *
 *   requireMapAccess({ allowExpired: true })   tiles: PMTiles, signing, shajra raster
 *   requireMapAccess({ allowExpired: false })  GeoJSON: expired users get 403 EXPIRED_TILES_ONLY
 *
 * Tehsil / mouza come from req.params (:tehsil, :mauza | :mouza). Without a tehsil
 * (PMTiles signing: specs are in the body and checked per spec) only the account
 * state is checked.
 */
const logger = require('../utils/logger');
const { accessLevel, subscriptionState } = require('../services/accessPolicy');

const EXPIRED_BODY = {
    message: 'Your subscription has expired. The map is shown as tiles; renew to download map data and use all features.',
    code: 'EXPIRED_TILES_ONLY',
    expired: true,
};

function requireMapAccess({ allowExpired }) {
    return async (req, res, next) => {
        try {
            if (!req.user) return res.status(401).json({ message: 'Authentication required' });
            const tehsil = req.params.tehsil;
            const mouza = req.params.mauza || req.params.mouza || null;
            const level = tehsil ? await accessLevel(req.user, tehsil, mouza) : subscriptionState(req.user);
            req.accessLevel = level;
            if (level === 'full' || (level === 'expired' && allowExpired)) return next();
            if (level === 'expired') return res.status(403).json(EXPIRED_BODY);
            if (req.user.status === 'Suspended') {
                return res.status(403).json({ message: 'Your account is suspended. Please contact your provider.', suspended: true });
            }
            logger.warn('[map-access] denied', { userId: req.user.userId, tehsil, mouza, path: req.originalUrl });
            return res.status(403).json({ message: 'Access denied: You do not have permission to access this tehsil/mouza.', code: 'NOT_ENTITLED' });
        } catch (err) { next(err); }
    };
}

/**
 * Full-subscription-only features (saved layers, ...): expired / pending accounts get
 * 403 SUBSCRIPTION_REQUIRED, which the dashboard turns into the "Subscribe to unlock" message.
 */
function requireFullSubscription(feature) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ message: 'Authentication required' });
        const state = subscriptionState(req.user);
        if (state === 'full') return next();
        return res.status(403).json({
            message: 'Please subscribe to use this feature. Your current access shows the map only.',
            code: 'SUBSCRIPTION_REQUIRED',
            feature,
        });
    };
}

module.exports = { requireMapAccess, requireFullSubscription, EXPIRED_BODY };
