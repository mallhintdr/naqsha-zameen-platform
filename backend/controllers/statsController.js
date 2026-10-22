const User = require('../models/User');
const AccountEvent = require('../models/AccountEvent');
const SubAdminPayment = require('../models/SubAdminPayment');
// CQ-01: Import from userUtils instead of duplicating
const { deriveTehsilState } = require('../utils/userUtils');
const logger = require('../utils/logger');
const { getRedisClient, isRedisReady } = require('../services/redisClient');

// SCALE-03: In-process response cache with 60s TTL (no Redis required)
const statsShared = require('../utils/sharedCache').createSharedCache('stats', 60);
// npm install node-cache  (if not already installed)
let NodeCache;
let statsCache;
try {
    NodeCache  = require('node-cache');
    statsCache = new NodeCache({ stdTTL: 60, checkperiod: 30, useClones: false });
} catch {
    logger.warn('node-cache not installed — stats caching disabled. Run: npm install node-cache');
    statsCache = null;
}

/** Helper: get from cache or run the factory fn and cache the result.
 *  @param {string} key   Cache key
 *  @param {Function} factory  Async factory that produces the data
 *  @param {number} [ttl]  Optional TTL override in seconds (default: stdTTL from NodeCache config)
 */
async function withCache(key, factory, ttl) {
    // Shared by every server instance (Redis, else MongoDB), so all workers
    // return the same numbers — never a per-process copy.
    const hit = await statsShared.get(key);
    if (hit !== undefined) return hit;
    const result = await factory();
    await statsShared.set(key, result, ttl !== undefined ? ttl : 60);
    return result;
}

/**
 * GET /stats
 * Returns: { totalUsers, totalOnline, sessions, loginStats, dailyActivity, tehsilStats, subscriptionHealth }
 * PERF-01: All aggregation done in MongoDB instead of loading sessions into memory.
 * SCALE-03: Results cached for 60 seconds — no redundant DB load on repeated admin refreshes.
 */
exports.getStats = async (req, res) => {
    try {
        const data = await withCache('stats', async () => {
            const now = Date.now();
            const cutoff30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
            const cutoff7  = new Date(now - 7  * 24 * 60 * 60 * 1000);
            const cutoff24 = new Date(now - 24  * 60 * 60 * 1000);
            const activeCutoff = new Date(now - 1 * 60 * 1000);
            const cutoffWeekly = new Date(now - 12 * 7 * 24 * 60 * 60 * 1000);
            const cutoffMonthly = new Date(now - 12 * 30 * 24 * 60 * 60 * 1000);

            // PERF-04: Run all independent aggregations in parallel — replaces sequential awaits
            const [
                totalUsers,
                totalOnline,
                loginStatsResult,
                dailyActivity,
                sessions,
                tehsilStats,
                subHealthResult,
                registrationsDaily,
                registrationsWeekly,
                registrationsMonthly
            ] = await Promise.all([
                User.countDocuments(),
                User.countDocuments({ lastActive: { $gte: activeCutoff } }),

                // PERF-01: Login stats directly from Session collection
                (() => {
                    const Session = require('../models/Session');
                    return Session.aggregate([
                        { $match: { start: { $gte: cutoff30 } } },
                        {
                            $group: {
                                _id: null,
                                users24h:  { $addToSet: { $cond: [{ $gte: ['$start', cutoff24] }, '$userId', '$$REMOVE'] } },
                                count24h:  { $sum: { $cond: [{ $gte: ['$start', cutoff24] }, 1, 0] } },
                                users7d:   { $addToSet: { $cond: [{ $gte: ['$start', cutoff7]  }, '$userId', '$$REMOVE'] } },
                                count7d:   { $sum: { $cond: [{ $gte: ['$start', cutoff7]  }, 1, 0] } },
                                users30d:  { $addToSet: '$userId' },
                                count30d:  { $sum: 1 }
                            }
                        },
                        {
                            $project: {
                                _id: 0,
                                last24h: { uniqueUsers: { $size: '$users24h' }, sessionCount: '$count24h' },
                                last7d:  { uniqueUsers: { $size: '$users7d'  }, sessionCount: '$count7d'  },
                                last30d: { uniqueUsers: { $size: '$users30d' }, sessionCount: '$count30d' }
                            }
                        }
                    ]).then(r => r[0]);
                })(),

                // Daily activity chart data
                (() => {
                    const Session = require('../models/Session');
                    return Session.aggregate([
                        { $match: { start: { $gte: cutoff30 } } },
                        {
                            $group: {
                                _id:         { $dateToString: { format: '%Y-%m-%d', date: '$start' } },
                                activeUsers: { $addToSet: '$userId' },
                                sessions:    { $sum: 1 }
                            }
                        },
                        {
                            $project: {
                                _id: 0,
                                date:        '$_id',
                                activeUsers: { $size: '$activeUsers' },
                                sessions:    1
                            }
                        },
                        { $sort: { date: 1 } }
                    ]);
                })(),

                // Sessions list (last 30 days, capped at 500)
                (() => {
                    const Session = require('../models/Session');
                    return Session.aggregate([
                        { $match: { start: { $gte: cutoff30 } } },
                        { $sort: { start: -1 } },
                        { $limit: 500 },
                        {
                            $lookup: {
                                from: 'users',
                                localField: 'userId',
                                foreignField: 'userId',
                                as: 'user'
                            }
                        },
                        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                        {
                            $project: {
                                _id: 0,
                                userId: '$userId',
                                userName: { $ifNull: ['$user.userName', '$userId'] },
                                tehsil: { $ifNull: ['$user.activeTehsil', ''] },
                                subscriptionType: { $ifNull: ['$user.subscriptionType', 'Trial'] },
                                start: '$start',
                                end: '$end',
                                ipAddress: '$ipAddress',
                                duration: '$duration',
                                deviceInfo: '$deviceInfo'
                            }
                        }
                    ]);
                })(),

                // Tehsil hotspots: every tehsil, all customers, split into active
                // (subscription Active or Trial) and inactive (everything else).
                User.aggregate([
                    { $match: { userType: 'user' } },
                    { $unwind: { path: '$tehsilAccess', preserveNullAndEmptyArrays: false } },
                    { $group: {
                        _id: { tehsil: '$tehsilAccess.tehsil', user: '$userId' },   // count each user once per tehsil
                        active: { $max: { $cond: [{ $in: ['$status', ['Active', 'Trial']] }, 1, 0] } }
                    } },
                    { $group: { _id: '$_id.tehsil', userCount: { $sum: 1 }, activeCount: { $sum: '$active' } } },
                    { $addFields: { inactiveCount: { $subtract: ['$userCount', '$activeCount'] } } },
                    { $sort:  { userCount: -1 } }
                ]),

                // Subscription health
                User.aggregate([
                    { $match: { userType: 'user' } },
                    { $group: {
                        _id:          null,
                        active:       { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'Pending'] }, { $gt: ['$endDate', new Date(now)]  }] }, 1, 0] } },
                        expired:      { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'Pending'] }, { $lte: ['$endDate', new Date(now)] }] }, 1, 0] } },
                        pending:      { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] } },
                        expiringSoon: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'Pending'] }, { $gt: ['$endDate', new Date(now)] }, { $lte: ['$endDate', new Date(now + 7 * 24 * 60 * 60 * 1000)] }] }, 1, 0] } }
                    }}
                ]).then(r => r[0]),

                // Daily registration stats
                User.aggregate([
                    { $match: { createdAt: { $gte: cutoff30 } } },
                    {
                        $group: {
                            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                            count: { $sum: 1 },
                            publicCount: { $sum: { $cond: [{ $eq: ['$registrationSource', 'public'] }, 1, 0] } }
                        }
                    },
                    { $project: { _id: 0, label: '$_id', count: 1, publicCount: 1 } },
                    { $sort: { label: 1 } }
                ]),

                // Weekly registration stats
                User.aggregate([
                    { $match: { createdAt: { $gte: cutoffWeekly } } },
                    {
                        $group: {
                            _id: {
                                year: { $year: '$createdAt' },
                                week: { $week: '$createdAt' }
                            },
                            count: { $sum: 1 },
                            publicCount: { $sum: { $cond: [{ $eq: ['$registrationSource', 'public'] }, 1, 0] } }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            label: { $concat: [{ $toString: '$_id.year' }, '-W', { $toString: '$_id.week' }] },
                            count: 1,
                            publicCount: 1
                        }
                    },
                    { $sort: { label: 1 } }
                ]),

                // Monthly registration stats
                User.aggregate([
                    { $match: { createdAt: { $gte: cutoffMonthly } } },
                    {
                        $group: {
                            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                            count: { $sum: 1 },
                            publicCount: { $sum: { $cond: [{ $eq: ['$registrationSource', 'public'] }, 1, 0] } }
                        }
                    },
                    { $project: { _id: 0, label: '$_id', count: 1, publicCount: 1 } },
                    { $sort: { label: 1 } }
                ])
            ]);

            const loginStats = loginStatsResult || {
                last24h: { uniqueUsers: 0, sessionCount: 0 },
                last7d:  { uniqueUsers: 0, sessionCount: 0 },
                last30d: { uniqueUsers: 0, sessionCount: 0 }
            };

            const subscriptionHealth = subHealthResult || { active: 0, expired: 0, pending: 0, expiringSoon: 0, suspended: 0 };
            if (subHealthResult) delete subscriptionHealth._id;

            return { 
                totalUsers, 
                totalOnline, 
                sessions, 
                loginStats, 
                dailyActivity, 
                tehsilStats, 
                subscriptionHealth,
                registrationsDaily,
                registrationsWeekly,
                registrationsMonthly
            };
        });

        res.json(data);
    } catch (err) {
        logger.error('Stats error', { error: err.message });
        res.status(500).json({ error: 'Unable to fetch statistics' });
    }
};

/**
 * GET /multi-device-users
 * Every customer (online or not) who used more than one device in the last 30 days
 * (counted from the later of activation and 30 days ago; forgotten devices excluded).
 */
exports.getMultiDeviceUsers = async (req, res) => {
    try {
        const data = await withCache('multi-device-users', async () => {
            return require('../services/multiUseWarning').listMultiDeviceUsers();
        });
        res.json(data);
    } catch (err) {
        logger.error('Multi-device users error', { error: err.message });
        res.status(500).json({ error: 'Unable to fetch multi-device users' });
    }
};

/**
 * GET /online-users
 * Returns full online user list with multi-IP analysis.
* PERF-03: Only select needed fields; $slice:-5 to avoid loading all 100 sessions per user.
 * SCALE-03: Cached for 30s (real-time feel, but protects against admin polling storms).
 */
exports.getOnlineUsers = async (req, res) => {
    try {
        const data = await withCache('online-users', async () => {
            const cutoff = new Date(Date.now() - 1 * 60 * 1000);
            const users = await User.find({ lastActive: { $gte: cutoff } })
                .select({
                    userName:         1,
                    userId:           1,
                    userType:         1,
                    startDate:        1,
                    lastActive:       1,
                    subscriptionType: 1,
                    tehsilAccess:     1,
                    activeTehsil:     1
                })
                .lean();

            const userIds = users.map(u => u.userId);
            const Session = require('../models/Session');
            const allSessions = await Session.find({ userId: { $in: userIds } })
                .sort({ start: -1 })
                .lean();

            const userSessionsMap = new Map();
            allSessions.forEach(s => {
                if (!userSessionsMap.has(s.userId)) {
                    userSessionsMap.set(s.userId, []);
                }
                const userSess = userSessionsMap.get(s.userId);
                if (userSess.length < 5) {
                    userSess.push(s);
                }
            });

            // Multi-use risk is counted by devices (30 days), not IP addresses.
            const usage = await require('../services/deviceTracker').usageFor(users.map(u => ({ ...u, userType: u.userType || 'user' })));
            const list = users.map(u => {
                const { activeTehsil, tehsilAccess, activeMouzas } = deriveTehsilState(u);
                const dev = usage[u.userId];
                const sessions       = userSessionsMap.get(u.userId) || [];
                const last           = sessions[0] || {};
                const activeSessions = sessions.filter(s => !s?.end);

                const ipSet = new Set();
                activeSessions.forEach(s => { if (s?.ipAddress) ipSet.add(s.ipAddress); });
                if (ipSet.size === 0 && last?.ipAddress) ipSet.add(last.ipAddress);

                const ipAddresses = Array.from(ipSet);

                return {
                    userName:         u.userName,
                    userId:           u.userId,
                    tehsil:           activeTehsil,
                    tehsilAccess,
                    mouzas:           activeMouzas,
                    subscriptionType: u.subscriptionType,
                    ipAddress:        last.ipAddress,
                    ipCount:          dev ? dev.count30 : 0,          // devices in 30 days (name kept for the screens)
                    deviceCount:      dev ? dev.count30 : 0,
                    sameTimeDevices:  dev ? dev.concurrent30 : 0,
                    devices:          dev ? dev.ips30 : [],
                    instances:        activeSessions.length || 1,
                    ipAddresses,
                    start:            last.start,
                    lastActive:       u.lastActive
                };
            }).sort((a, b) => (b.start || 0) - (a.start || 0));

            return list;
        }, 30); // 30s TTL for online users (more real-time than stats)

        res.json(data);
    } catch (err) {
        logger.error('online-users error', { error: err.message });
        res.status(500).json({ error: 'Unable to fetch online users' });
    }
};

/**
 * GET /subscription-stats
 * Returns subscription breakdown + recent renewals.
 * SCALE-05: Renewal processing done entirely in MongoDB ($unwind + $match) — no JS forEach.
 * SCALE-03: Cached for 60s.
 */
exports.getSubscriptionStats = async (req, res) => {
    try {
        const data = await withCache('subscription-stats', async () => {
            const typeBreakdown = await User.aggregate([
                { $match: { userType: 'user' } },
                { $group: { _id: '$subscriptionType', count: { $sum: 1 } } }
            ]);

            const breakdown = typeBreakdown.reduce((acc, curr) => {
                acc[curr._id || 'Unknown'] = curr.count;
                return acc;
            }, {});

            // Last 730 days of renewals, from the permanent AccountEvent history
            // (no longer limited by the old 15-per-user renewalHistory cap).
            const renewalsWindowStart = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000);

            const recentRenewals = await AccountEvent.aggregate([
                // Renewals you collected directly. Sub-admin billed events are left out of the
                // revenue totals; the sub-admin's lump-sum payments are added below instead.
                { $match: { createdAt: { $gte: renewalsWindowStart }, type: 'RENEWED', billable: { $ne: true } } },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: 'userId',
                        pipeline: [{ $project: { _id: 0, userName: 1 } }],
                        as: 'u'
                    }
                },
                {
                    $project: {
                        _id: 0,
                        userId: 1,
                        userName: { $ifNull: [{ $first: '$u.userName' }, '$userId'] },
                        subscriptionType: '$plan',
                        date: '$createdAt',
                        fee: {
                            $cond: [
                                { $in: [{ $toLower: { $ifNull: ['$plan', ''] } }, ['trial', 'trial24', 'free', 'permanent']] },
                                0,
                                // No recorded amount on old data: show the user's fee, as this tab always has.
                                { $ifNull: ['$paymentAmount', { $ifNull: ['$estimatedAmount', 0] }] }
                            ]
                        }
                    }
                },
                { $sort: { date: -1 } }
            ]);

            // Sub-admin sales: every line billed to a sub-admin is revenue on the day
            // it is billed (what they owe you — money owed is revenue). Renewals and
            // activations also count as renewals (total = admin + sub-admin); other
            // billed lines (mouza-change fees, adjustments, credits) are revenue only.
            // Payments received from sub-admins are NOT added again (that would double count).
            const subAdminBilled = await AccountEvent.aggregate([
                { $match: { createdAt: { $gte: renewalsWindowStart }, billable: true, ownerAtEvent: { $nin: [null, ''] }, platformPrice: { $ne: 0 } } },
                { $lookup: { from: 'users', localField: 'userId', foreignField: 'userId', pipeline: [{ $project: { _id: 0, userName: 1 } }], as: 'u' } },
                { $project: {
                    _id: 0,
                    userId: 1,
                    userName: { $ifNull: [{ $first: '$u.userName' }, '$userId'] },
                    subscriptionType: { $ifNull: ['$plan', '$type'] },
                    date: '$createdAt',
                    fee: { $ifNull: ['$platformPrice', 0] },
                    amount: { $ifNull: ['$platformPrice', 0] },
                    bySubAdmin: '$ownerAtEvent',
                    // Not a renewal (fees, adjustments): revenue only, like a payment row.
                    subAdminPayment: { $not: [{ $in: ['$type', ['RENEWED', 'ACTIVATED']] }] }
                } }
            ]);
            recentRenewals.push(...subAdminBilled);
            recentRenewals.sort((a, b) => new Date(b.date) - new Date(a.date));

            // Total revenue so far (all time): money you collected directly (renewals and
            // other paid admin events) + everything billed to sub-admins. Trials / free plans are 0. Same basis as the revenue charts.
            const [direct] = await AccountEvent.aggregate([
                { $match: { type: { $in: ['RENEWED', 'ASSIGNMENT_TOPUP'] }, billable: { $ne: true } } },
                { $match: { $expr: { $not: { $in: [{ $toLower: { $ifNull: ['$plan', ''] } }, ['trial', 'trial24', 'free', 'permanent']] } } } },
                { $group: { _id: null, total: { $sum: { $ifNull: ['$paymentAmount', { $ifNull: ['$estimatedAmount', 0] }] } }, count: { $sum: { $cond: [{ $eq: ['$type', 'RENEWED'] }, 1, 0] } } } }
            ]);
            // Billed to sub-admins (all time) — counted when billed, not when paid.
            const [fromSubAdmins] = await AccountEvent.aggregate([{ $match: { billable: true, ownerAtEvent: { $nin: [null, ''] } } }, { $group: { _id: null, total: { $sum: { $ifNull: ['$platformPrice', 0] } } } }]);
            const totalRevenue = {
                total: (direct?.total || 0) + (fromSubAdmins?.total || 0),
                direct: direct?.total || 0,
                fromSubAdmins: fromSubAdmins?.total || 0
            };

            return { breakdown, recentRenewals, totalRevenue };
        });

        res.json(data);
    } catch (error) {
        logger.error('getSubscriptionStats error:', { error: error.message });
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * GET /user-ip-history/:userId
 * Returns IP history for a specific user.
 */
exports.getUserIpHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findOne({ userId }).select('userName userId').lean();
 
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
 
        const Session = require('../models/Session');
        const sessions = await Session.find({ userId }).lean();
 
        const ipMap = {};
        sessions.forEach(s => {
            if (!s.ipAddress) return;
            const ip = s.ipAddress;
            if (!ipMap[ip]) {
                ipMap[ip] = {
                    ipAddress:    ip,
                    firstSeen:    s.start,
                    lastSeen:     s.start,
                    sessionCount: 0,
                    location: s.location ? {
                        city:    s.location.city,
                        region:  s.location.region,
                        country: s.location.country,
                    } : null,
                };
            }
            ipMap[ip].sessionCount += 1;
            if (s.start < ipMap[ip].firstSeen) ipMap[ip].firstSeen = s.start;
            if (s.start > ipMap[ip].lastSeen)  ipMap[ip].lastSeen  = s.start;
        });
 
        const ipHistory = Object.values(ipMap)
            .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
 
        res.json({ userId, userName: user.userName, ipHistory });
    } catch (error) {
        logger.error('getUserIpHistory error:', { error: error.message });
        res.status(500).json({ message: 'Internal server error' });
    }
};
