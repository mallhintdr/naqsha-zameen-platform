const User = require('../models/User');
const Session = require('../models/Session');
const logger = require('../utils/logger');

/**
 * GET /user-locations/:userId
 * Returns all session location records for a specific user.
 * Used by the UserLocationModal in the statistics page.
 */
exports.getUserLocations = async (req, res) => {
    try {
        const { userId } = req.params;
        // SCALE-01: indexed exact match on userIdLower instead of case-insensitive $regex (COLLSCAN)
        const user = await User.findOne({ userIdLower: String(userId || '').toLowerCase() }).select('userName userId').lean();

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const sessions = await Session.find({
            userId: user.userId,
            'location.latitude': { $ne: null },
            'location.longitude': { $ne: null }
        }).sort({ start: -1 }).lean();

        const locations = sessions.map(s => ({
            timestamp: s.start,
            ipAddress: s.ipAddress || 'Unknown',
            latitude: s.location.latitude,
            longitude: s.location.longitude,
            city: s.location.city || 'Unknown',
            region: s.location.region || '',
            country: s.location.country || '',
            accuracy: s.location.accuracy || null,
            deviceInfo: s.deviceInfo || {},
        }));

        res.json({ userId, userName: user.userName, locations });
    } catch (error) {
        logger.error('getUserLocations error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * GET /location-heatmap?subscriptionType=&country=&limit=1000
 * Returns heatmap data points (lat, lng, intensity) for all user sessions.
 * Used by GlobalHeatmapModal.
 * PERF-02: Uses MongoDB aggregation instead of loading all sessions into memory.
 */
exports.getLocationHeatmap = async (req, res) => {
    try {
        const {
            subscriptionType,
            country,
            limit = 1000,
        } = req.query;

        const matchStage = {
            'location.latitude': { $ne: null },
            'location.longitude': { $ne: null }
        };
        if (country) matchStage['location.country'] = country;

        const pipeline = [
            { $match: matchStage },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: 'userId',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $match: {
                    'user.userType': 'user',
                    ...(subscriptionType ? { 'user.subscriptionType': subscriptionType } : {})
                }
            },
            {
                $project: {
                    _id: 0,
                    latitude: '$location.latitude',
                    longitude: '$location.longitude',
                    intensity: { $literal: 1 },
                    city: '$location.city',
                    region: '$location.region',
                    country: '$location.country',
                }
            },
            { $limit: Math.min(Number(limit) || 1000, 5000) }
        ];

        const points = await Session.aggregate(pipeline);

        res.json({ total: points.length, points });
    } catch (error) {
        logger.error('getLocationHeatmap error:', { error: error.message });
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * GET /location-stats
 * Returns aggregated location statistics: top countries, top cities.
 * Used by GlobalHeatmapModal sidebar.
 */
exports.getLocationStats = async (req, res) => {
    try {
        // Aggregate country stats
        const countriesAgg = await Session.aggregate([
            { $match: { 'location.country': { $exists: true, $ne: null } } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: 'userId',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            { $match: { 'user.userType': 'user' } },
            {
                $group: {
                    _id: '$location.country',
                    uniqueUsers: { $addToSet: '$userId' },
                    sessionCount: { $sum: 1 },
                }
            },
            {
                $project: {
                    country: '$_id',
                    uniqueUsers: { $size: '$uniqueUsers' },
                    sessionCount: 1,
                    _id: 0,
                }
            },
            { $sort: { uniqueUsers: -1 } },
            { $limit: 20 },
        ]);

        // Aggregate city stats
        const citiesAgg = await Session.aggregate([
            { $match: { 'location.city': { $exists: true, $ne: null } } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: 'userId',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            { $match: { 'user.userType': 'user' } },
            {
                $group: {
                    _id: {
                        city: '$location.city',
                        country: '$location.country',
                    },
                    uniqueUsers: { $addToSet: '$userId' },
                    sessionCount: { $sum: 1 },
                }
            },
            {
                $project: {
                    city: '$_id.city',
                    country: '$_id.country',
                    uniqueUsers: { $size: '$uniqueUsers' },
                    sessionCount: 1,
                    _id: 0,
                }
            },
            { $sort: { uniqueUsers: -1 } },
            { $limit: 30 },
        ]);

        res.json({
            countriesStats: countriesAgg,
            topCities: citiesAgg,
        });
    } catch (error) {
        logger.error('getLocationStats error:', { error: error.message });
        res.status(500).json({ message: 'Internal server error' });
    }
};
