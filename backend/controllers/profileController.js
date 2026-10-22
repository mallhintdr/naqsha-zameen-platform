const User = require('../models/User');
const { ensureUserTehsilState, sanitizeUser, applyTehsilAssignmentsToUser, deriveTehsilState } = require('../utils/userUtils');
const deviceTracker = require('../services/deviceTracker');
const { calculateDatesAndStatus } = require('../utils/dateUtils');
const { getAllTehsilsAndMouzas } = require('../services/geoService');
const { getRedisClient } = require('../services/redisClient');
const logger = require('../utils/logger');
const { collapseGroupedAccess, expandSubAdminMouzas } = require('../services/tehsilDisplayService');

exports.getProfile = async (req, res) => {
    try {
        // PERF-4/SCALE-01: Single query, indexed exact match on userIdLower (avoids COLLSCAN)
        const user = await User.findOne({ userIdLower: String(req.user.userId || '').toLowerCase() })
            .select('-notifications -pushSubscriptions -resetPasswordToken -resetPasswordExpires');
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Ensure status is up-to-date for natural expirations before sending to frontend
        if (!['Pending', 'PendingVerification', 'AwaitingActivation', 'Suspended'].includes(user.status)) {
            const { status, endDate, daysRemaining } = calculateDatesAndStatus(user.startDate, user.subscriptionType);
            user.status = status;
            user.endDate = endDate;
            user.daysRemaining = daysRemaining;
        }

        const state = ensureUserTehsilState(user);
        // Merged tehsils: fold separate entries for linked names into one (saved).
        // Never allowed to break the profile: on any error the access is left as is.
        try {
            const plainAccess = (user.tehsilAccess || []).map(e => ({
                tehsil: e.tehsil,
                mouzas: Array.isArray(e.mouzas) ? [...e.mouzas] : [],
                tempGrants: Array.isArray(e.tempGrants) ? e.tempGrants.map(g => ({ mouza: g.mouza, expiresAt: g.expiresAt })) : []
            }));
            const collapsed = await collapseGroupedAccess(plainAccess, user.activeTehsil);
            if (collapsed.changed) {
                user.tehsilAccess = collapsed.tehsilAccess;
                user.activeTehsil = collapsed.activeTehsil;
                state.changed = true;
            }
        } catch (collapseErr) {
            logger.warn('getProfile: merged-tehsil folding skipped', { error: collapseErr.message, userId: user.userId });
        }
        try {
            if (state.changed || user.isModified()) {
                user.markModified('tehsilAccess');
                await user.save();
            }
        } catch (saveErr) {
            logger.warn('Non-fatal user.save failure in getProfile:', { error: saveErr.message, userId: user.userId });
        }

        const sanitized = sanitizeUser(user);

        // Multi-use: counted by devices (not IP addresses). Field name kept for the screens.
        if (user.userType !== 'admin') {
            sanitized.ipMisuse = await deviceTracker.usageForOne(user.toObject ? user.toObject() : user);
        }

        // Who this user pays for renewals (sub-admin or admin), and never token internals.
        try {
            sanitized.provider = await require('../services/providerService').getProviderForUser(user);
        } catch (provErr) {
            logger.warn('getProfile: provider lookup failed', { error: provErr.message });
        }
        if (sanitized.activation) sanitized.activation = { activatedAt: sanitized.activation.activatedAt, expiresAt: sanitized.activation.expiresAt };
        if (sanitized.pendingEmail) sanitized.pendingEmail = { email: sanitized.pendingEmail.email };
        if (user.userType === 'subadmin') {
            const sa = await require('../models/SubAdmin').findOne({ userId: user.userId }).select('status territory').lean();
            sanitized.subAdminStatus = sa?.status || null;
        }
        try {
            await expandSubAdminMouzas(sanitized); // sub-admins see every mouza of their tehsils
        } catch (expandErr) {
            logger.warn('getProfile: sub-admin mouza list skipped', { error: expandErr.message, userId: user.userId });
        }

        res.status(200).json(sanitized);
    } catch (error) {
        logger.error('getProfile error:', { error: error.message, stack: error.stack, userId: req.user?.userId });
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateActiveTehsil = async (req, res) => {
    try {
        const requestedTehsil = typeof req.body?.tehsil === 'string' ? req.body.tehsil.trim() : '';
        if (!requestedTehsil) {
            return res.status(400).json({ message: 'Tehsil is required.' });
        }
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Same merged-tehsil folding as the profile, so the group name is a valid choice.
        const collapsed = await collapseGroupedAccess(user.tehsilAccess, user.activeTehsil);
        if (collapsed.changed) {
            user.tehsilAccess = collapsed.tehsilAccess;
            user.activeTehsil = collapsed.activeTehsil;
            user.markModified('tehsilAccess');
        }
        const normalized = deriveTehsilState(user);
        const { activeTehsil } = applyTehsilAssignmentsToUser(
            user,
            normalized.tehsilAccess,
            requestedTehsil
        );
        user.activeTehsil = activeTehsil;
        user.tehsil = activeTehsil; // sync legacy field

        if (activeTehsil !== requestedTehsil) {
            return res.status(400).json({ message: 'Tehsil not assigned to user.' });
        }

        await user.save();
        const out = await expandSubAdminMouzas(sanitizeUser(user));
        res.json({ message: 'Active tehsil updated', user: out });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update active tehsil.' });
    }
};

exports.updateEmail = async (req, res) => {
    try {
        let emailVal = typeof email === 'string' ? email.trim() : email;
        if (emailVal === '') emailVal = undefined;

        // Check if email is already taken by another user
        if (emailVal) {
            const existingUser = await User.findOne({ email: emailVal, userId: { $ne: userId } });
            if (existingUser) {
                return res.status(400).json({ message: 'This email is already registered with another account.' });
            }
        }

        const user = await User.findOne({ userId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.email = emailVal;
        if (emailVal === undefined) {
            user.set('email', undefined);
        }
        await user.save();

        res.json({ message: 'Email updated successfully', email: user.email });
    } catch (error) {
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Failed to update email' });
    }
};

exports.heartbeat = async (req, res) => {
    try {
        let userId = req.user?.userId;
        if (!userId && req.cookies?.authToken) {
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.decode(req.cookies.authToken);
                userId = decoded?.userId;
            } catch (_) {}
        }
        if (!userId) {
            return res.json({ status: 'ok', authenticated: false, timestamp: Date.now() });
        }

        const location = req.body?.location;
        const now = new Date();
        deviceTracker.touch(req, userId); // device active now (same-time use detection)

        const { getRedisClient, isRedisReady } = require('../services/redisClient');
        const redisClient = getRedisClient();
        if (redisClient && isRedisReady()) {
            // Buffer in Redis
            let payload = { t: now.getTime() };
            if (location && location.latitude && location.longitude) {
                payload.loc = {
                    lat: location.latitude,
                    lng: location.longitude,
                    acc: location.accuracy,
                    src: location.source || 'gps'
                };
            }
            await redisClient.hset('heartbeats', userId, JSON.stringify(payload));
            return res.json({ success: true, locationUpdated: !!payload.loc });
        }

        // Original inline logic if Redis is down
        if (location && location.latitude && location.longitude) {
            const Session = require('../models/Session');
            await Session.updateOne(
                { userId, end: null },
                {
                    $set: {
                        location: {
                            latitude: location.latitude,
                            longitude: location.longitude,
                            accuracy: location.accuracy,
                            source: location.source || 'gps'
                        }
                    }
                }
            );
        }

        await User.updateOne({ userId }, { $set: { lastActive: now } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to record heartbeat' });
    }
};

exports.flushHeartbeats = async () => {
    try {
        const { getRedisClient, isRedisReady } = require('../services/redisClient');
        const redisClient = getRedisClient();
        if (!redisClient || !isRedisReady()) return;

        const heartbeats = await redisClient.hgetall('heartbeats');
        const userIds = Object.keys(heartbeats);
        
        if (userIds.length === 0) return;

        // Delete processed keys immediately
        await redisClient.hdel('heartbeats', ...userIds);

        const Session = require('../models/Session');
        const userBulkOps = [];
        const sessionBulkOps = [];
        
        for (const [userId, dataStr] of Object.entries(heartbeats)) {
            const data = JSON.parse(dataStr);
            userBulkOps.push({
                updateOne: {
                    filter: { userId },
                    update: { $set: { lastActive: new Date(data.t) } }
                }
            });

            if (data.loc) {
                sessionBulkOps.push({
                    updateOne: {
                        filter: { userId, end: null },
                        update: {
                            $set: {
                                location: {
                                    latitude: data.loc.lat,
                                    longitude: data.loc.lng,
                                    accuracy: data.loc.acc,
                                    source: data.loc.src
                                }
                            }
                        }
                    }
                });
            }
        }

        if (userBulkOps.length > 0) {
            await User.bulkWrite(userBulkOps, { ordered: false });
        }
        if (sessionBulkOps.length > 0) {
            await Session.bulkWrite(sessionBulkOps, { ordered: false });
        }
    } catch (err) {
        logger.error('Error flushing heartbeats:', { error: err.message, stack: err.stack });
    }
};
