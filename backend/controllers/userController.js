const User = require('../models/User');
const { ensureUserTehsilState, sanitizeUser, applyTehsilAssignmentsToUser, sanitizeTehsilAssignmentsInput, deriveTehsilState } = require('../utils/userUtils');
const deviceTracker = require('../services/deviceTracker');
const { calculateDatesAndStatus } = require('../utils/dateUtils');
const crypto = require('crypto');
const DemoLink = require('../models/DemoLink');
const RenewalToken = require('../models/RenewalToken');
// Issue #16: Top-level import instead of inline require() on every request
const { sendNotification, notifyAdmins } = require('../utils/notificationUtils');
const { sendResetEmail } = require('../utils/emailUtils');
const { getRedisClient } = require('../services/redisClient');
const logger = require('../utils/logger');
const { recordEvent, snapshotUser, isRevenuePlan, renewalKey, findSameDaySubscription } = require('../services/accountEventService');

// Escape regex special characters to prevent ReDoS
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function diffTehsilAccess(oldAccess, newAccess) {
    const oldMap = new Map();
    const newMap = new Map();

    (oldAccess || []).forEach(t => oldMap.set(t.tehsil, new Set(t.mouzas || [])));
    (newAccess || []).forEach(t => newMap.set(t.tehsil, new Set(t.mouzas || [])));

    const added = [];
    const removed = [];

    newMap.forEach((mouzas, tehsil) => {
        if (!oldMap.has(tehsil)) {
            added.push(tehsil + (mouzas.size ? ' (' + Array.from(mouzas).join(', ') + ')' : ' (All Mouzas)'));
        } else {
            const oldMouzas = oldMap.get(tehsil);
            const addedMouzas = Array.from(mouzas).filter(m => !oldMouzas.has(m));
            if (addedMouzas.length) {
                added.push(tehsil + ' (' + addedMouzas.join(', ') + ' added)');
            }
        }
    });

    oldMap.forEach((mouzas, tehsil) => {
        if (!newMap.has(tehsil)) {
            removed.push(tehsil + ' (Removed)');
        } else {
            const newMouzas = newMap.get(tehsil);
            const removedMouzas = Array.from(mouzas).filter(m => !newMouzas.has(m));
            if (removedMouzas.length) {
                removed.push(tehsil + ' (' + removedMouzas.join(', ') + ' removed)');
            }
        }
    });

    let msg = '';
    if (added.length) msg += 'Added: ' + added.join('; ') + '. ';
    if (removed.length) msg += 'Removed: ' + removed.join('; ') + '. ';
    return msg.trim();
}
const FRONTEND_URL = process.env.FRONTEND_URL;
const CORS_ORIGIN = process.env.CORS_ORIGIN;




// Admin functions
exports.getAllUsers = async (req, res) => {
    const now = new Date();
    try {
        // SCALE-02: Always enforce pagination to prevent loading all users at once
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        
        const tab = req.query.tab || 'all';
        const searchName = (req.query.searchName || '').trim();
        const searchId = (req.query.searchId || '').trim();
        const searchTehsil = (req.query.searchTehsil || '').trim();
        const searchPhone = (req.query.searchPhone || '').trim();
        const searchEmail = (req.query.searchEmail || '').trim();
        
        let sortKey = req.query.sortKey;
        let sortDir;
        if (req.query.sortDir) {
            sortDir = req.query.sortDir === 'desc' ? -1 : 1;
        }

        if (!sortKey) {
            if (tab === 'publicRegistration') {
                sortKey = 'createdAt';
                sortDir = sortDir !== undefined ? sortDir : -1;
            } else if (tab === 'recentlyEdited') {
                sortKey = 'profileEditedAt';
                sortDir = sortDir !== undefined ? sortDir : -1;
            } else {
                sortKey = 'userId';
                sortDir = sortDir !== undefined ? sortDir : 1;
            }
        } else if (sortDir === undefined) {
            sortDir = (sortKey === 'createdAt' || sortKey === 'profileEditedAt') ? -1 : 1;
        }

        // Build MongoDB match filter
        const matchFilter = {};
        if (searchName) matchFilter.userName = { $regex: escapeRegex(searchName), $options: 'i' };
        if (searchId) matchFilter.userId = { $regex: escapeRegex(searchId), $options: 'i' };
        if (searchTehsil) matchFilter['tehsilAccess.tehsil'] = { $regex: escapeRegex(searchTehsil), $options: 'i' };
        if (searchPhone) matchFilter.mobileNumber = { $regex: escapeRegex(searchPhone), $options: 'i' };
        if (searchEmail) matchFilter.email = { $regex: escapeRegex(searchEmail), $options: 'i' };
        // Sub-admin ownership filter: 'direct' = your own customers, 'subadmins' = any sub-admin's, or one sub-admin's userId.
        const owner = (req.query.owner || '').trim();
        if (owner === 'direct') matchFilter.managedBy = null;
        else if (owner === 'subadmins') matchFilter.managedBy = { $ne: null };
        else if (owner) matchFilter.managedBy = owner;

        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const fortyEightHoursAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

        // Add tab filter
        const tabFilter = { ...matchFilter };
        switch (tab) {
            case 'active':
                tabFilter.status = { $ne: 'Pending' };
                tabFilter.endDate = { $gt: now };
                tabFilter.subscriptionType = { $ne: 'Trial' };
                break;
            case 'expired':
                tabFilter.status = { $ne: 'Pending' };
                tabFilter.endDate = { $lte: now };
                tabFilter.subscriptionType = { $ne: 'Trial' };
                break;
            case 'publicRegistration':
                tabFilter.$or = [
                    { isPublicRegistration: true },
                    { registrationSource: 'public' },
                    { status: 'PendingVerification' }
                ];
                break;
            case 'expiring':
                tabFilter.status = { $ne: 'Pending' };
                tabFilter.endDate = { $gt: now, $lte: sevenDaysFromNow };
                break;
            case 'recentlyEdited':
                const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                tabFilter.profileEditedAt = { $gte: sevenDaysAgo };
                break;
            case 'awaitingActivation':
                tabFilter.status = 'AwaitingActivation';
                break;
            case 'unactivated':
                tabFilter.status = { $in: ['PendingVerification', 'Pending'] };
                break;
        }

        const skip = (page - 1) * limit;

        const { getRedisClient, isRedisReady } = require('../services/redisClient');
        const redisClient = getRedisClient();
        // Base cache key is global to allow shared caching and avoid filtering global tab counts by search queries
        const cacheKey = `users_stats_global`;
        let cachedStats = null;

        const facetQuery = {
            // Page data pass: filtered + sorted + paginated
            pageData: [
                { $match: tabFilter },
                { $sort: { [sortKey]: sortDir, _id: sortDir } },
                { $skip: skip },
                { $limit: limit },
                { $addFields: {
                    sessions: {
                        $filter: {
                            input: { $ifNull: ["$sessions", []] },
                            as: "s",
                            cond: { $gte: ["$$s.start", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] }
                        }
                    }
                }},
                { $project: { notifications: 0, pushSubscriptions: 0, warnings: 0, resetPasswordToken: 0, resetPasswordExpires: 0 } }
            ],
            // Count pass: filtered count for pagination
            totalCount: [
                { $match: tabFilter },
                { $count: 'count' }
            ]
        };

        if (!cachedStats) {
            facetQuery.statistics = [
                { $match: {} },
                { $project: { status: 1, endDate: 1, updatedAt: 1, profileEditedAt: 1, subscriptionType: 1, isPublicRegistration: 1, registrationSource: 1 } },
                {
                    $group: {
                        _id: null,
                        total:          { $sum: 1 },
                        // BUG FIX: exclude PendingVerification (unverified public sign-ups) from
                        // active/expired/expiring counts, same as Pending — they haven't started
                        // a subscription window yet.
                        active:         { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$status', ['Pending', 'PendingVerification', 'AwaitingActivation']] }] }, { $gt: ['$endDate', now] }] }, 1, 0] } },
                        expired:        { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$status', ['Pending', 'PendingVerification', 'AwaitingActivation']] }] }, { $lte: ['$endDate', now] }] }, 1, 0] } },
                        publicRegistration: { 
                            $sum: { 
                                $cond: [
                                    { 
                                        $or: [
                                            { $eq: ['$isPublicRegistration', true] },
                                            { $eq: ['$registrationSource', 'public'] },
                                            { $eq: ['$status', 'PendingVerification'] }
                                        ] 
                                    }, 
                                    1, 
                                    0
                                ] 
                            } 
                        },
                        expiring:       { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$status', ['Pending', 'PendingVerification', 'AwaitingActivation']] }] }, { $gt: ['$endDate', now] }, { $lte: ['$endDate', sevenDaysFromNow] }] }, 1, 0] } },
                        recentlyEdited: { $sum: { $cond: [{ $gte: ['$profileEditedAt', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)] }, 1, 0] } }
                    }
                }
            ];
        }

        // PERF-01: Single $facet aggregation replaces 3 separate round-trips
        // (stats aggregate + find + countDocuments) with 1 query.
        const [facetResult] = await User.aggregate([
            { $facet: facetQuery }
        ]);

        let statistics;
        if (cachedStats) {
            statistics = cachedStats;
        } else {
            statistics = facetResult?.statistics?.[0] || { total: 0, active: 0, expired: 0, publicRegistration: 0, expiring: 0, recentlyEdited: 0 };
            delete statistics._id;
            
            if (redisClient && isRedisReady()) {
                try {
                    await redisClient.setEx(cacheKey, 60, JSON.stringify(statistics));
                } catch (err) {
                    logger.error('Redis stats cache set error:', { error: err.message });
                }
            }
        }
        const rawUsers = facetResult?.pageData || [];
        const total = facetResult?.totalCount?.[0]?.count || 0;

        // Multi-use by devices for this page of users (one query).
        const usage = await deviceTracker.usageFor(rawUsers);
        // Enrich the small page set (not entire collection)
        const enrichedUsers = rawUsers.map(u => {
            const sanitized = sanitizeUser(u);
            const { endDate, daysRemaining, status } = calculateDatesAndStatus(u.startDate, u.subscriptionType);
            // BUG FIX: PendingVerification (unverified public registration) must be preserved
            // literally, same as Pending — otherwise a brand-new unverified user (which has no
            // startDate) gets displayed as its recomputed subscription status instead of
            // "awaiting email verification".
            const actualStatus = ['Pending', 'PendingVerification', 'AwaitingActivation', 'Suspended'].includes(u.status) ? u.status : status;
            const assignments = Array.isArray(sanitized.tehsilAccess) ? sanitized.tehsilAccess : [];
            const tehsilSummary = assignments.map(({ tehsil }) => tehsil).join(', ');

            // True filtering using helper
            const misuse = usage[u.userId] || null;

            return {
                ...sanitized,
                tehsilAssignments: assignments,
                tehsilSummary,
                daysRemaining,
                endDate,
                status: actualStatus,
                userName: u.userName || '',
                userId: u.userId || '',
                ipCount30: misuse?.count30 || 0,
                ipMisuse: misuse
            };
        });

        // Names for the Sub-Admin column, plus the list of sub-admins for the owner filter.
        const subAdminUsers = await User.find({ userType: 'subadmin' }).select('userId userName').lean();
        const subAdminNames = Object.fromEntries(subAdminUsers.map(s => [s.userId, s.userName || s.userId]));
        enrichedUsers.forEach(u => { u.subAdminName = u.managedBy ? (subAdminNames[u.managedBy] || u.managedBy) : null; });

        res.status(200).json({
            users: enrichedUsers,
            subAdmins: subAdminUsers.map(s => ({ userId: s.userId, userName: s.userName })),
            statistics,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        logger.error('getAllUsers error:', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Failed to fetch users' });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId }).lean();
        if (!user) return res.status(404).json({ message: 'User not found' });
        const sanitized = sanitizeUser(user);
        
        // Add IP misuse info for admin view
        sanitized.ipMisuse = await deviceTracker.usageForOne(user);
        
        res.status(200).json(sanitized);
    } catch (error) {
        logger.error('getUserById error:', { error: error.message, stack: error.stack, paramsUserId: req.params.userId });
        res.status(500).json({ message: 'Failed to fetch user' });
    }
};

const flatMouzas = (access) => (access || []).flatMap(t => (t.mouzas && t.mouzas.length ? t.mouzas : ['*']).map(m => `${t.tehsil} - ${m}`));

/** Writes the permanent history events describing one updateUser save. */
async function recordUpdateEvents(req, user, beforeSnap, ctx) {
    const afterSnap = snapshotUser(user);
    const base = { userId: user.userId, ownerAtEvent: user.managedBy || null };

    if (ctx.isRenewal) {
        await recordEvent({
            ...base,
            type: 'RENEWED',
            plan: user.subscriptionType,
            previousPlan: ctx.previousSubscriptionType,
            periodStart: user.startDate,
            periodEnd: user.endDate,
            previousPeriodStart: ctx.previousStartDate,
            previousPeriodEnd: ctx.previousEndDate,
            paymentAmount: ctx.billing ? ctx.billing.price : ctx.renewalPaymentAmount,
            ...(ctx.billing ? {
                ownerAtEvent: ctx.billing.subAdminId,
                billable: true,
                platformPrice: ctx.billing.price,
                customerFee: user.fee || 0,
                billDay: ctx.billing.billDay,
                pricingVersion: ctx.billing.pricingVersion
            } : {}),
            requestKey: renewalKey(user.userId, ctx.renewalDate, user.subscriptionType),
            createdAt: ctx.renewalDate
        }, req);
    }

    const beforeFlat = flatMouzas(beforeSnap.tehsilAccess);
    const afterFlat = flatMouzas(afterSnap.tehsilAccess);
    const added = afterFlat.filter(m => !beforeFlat.includes(m));
    const removed = beforeFlat.filter(m => !afterFlat.includes(m));
    if (added.length || removed.length) {
        await recordEvent({
            ...base,
            type: 'ASSIGNMENT_CHANGED',
            before: { tehsilAccess: beforeSnap.tehsilAccess },
            after: { tehsilAccess: afterSnap.tehsilAccess, added, removed }
        }, req);
    }

    const profileFields = ['userName', 'mobileNumber', 'email'].filter(f => (beforeSnap[f] || '') !== (afterSnap[f] || ''));
    if (req.body && req.body.password) profileFields.push('password');
    if (profileFields.length) {
        const pick = (s) => Object.fromEntries(profileFields.filter(f => f !== 'password').map(f => [f, s[f]]));
        await recordEvent({
            ...base,
            type: 'PROFILE_EDITED',
            before: pick(beforeSnap),
            after: { ...pick(afterSnap), changedFields: profileFields }
        }, req);
    }

    if (ctx.expiredScheduleEdit) {
        // Recorded for the history, but with no payment and not as a renewal.
        await recordEvent({
            ...base, type: 'PLAN_CHANGED',
            note: 'dates/plan edited; resulting period already expired (not a renewal, no revenue)',
            before: { plan: beforeSnap.subscriptionType, startDate: ctx.previousStartDate, endDate: ctx.previousEndDate },
            after: { plan: afterSnap.subscriptionType, startDate: user.startDate, endDate: user.endDate }
        }, req);
    } else if (!ctx.isRenewal && beforeSnap.subscriptionType !== afterSnap.subscriptionType) {
        await recordEvent({ ...base, type: 'PLAN_CHANGED', before: { plan: beforeSnap.subscriptionType }, after: { plan: afterSnap.subscriptionType } }, req);
    }

    if (ctx.previousStatus !== user.status && ['Pending', 'PendingVerification'].includes(ctx.previousStatus) && ['Active', 'Trial'].includes(user.status)) {
        await recordEvent({ ...base, type: 'ACTIVATED', plan: user.subscriptionType, periodStart: user.startDate, periodEnd: user.endDate }, req);
    }
}

// Fields a non-admin may change on their own record. Everything else
// (plan, dates, status, fee, tehsil access) is admin-only.
const SELF_EDITABLE_FIELDS = ['userName', 'mobileNumber', 'email', 'password'];

// What a sub-admin may change on their own customer through the (admin-style) edit form.
const SUBADMIN_EDITABLE_FIELDS = ['userName', 'mobileNumber', 'email', 'password', 'subscriptionType', 'startDate', 'fee', 'tehsilAccess', 'activeTehsil'];

exports.updateUser = async (req, res) => {
    try {
        const sa = req.actingSubAdmin || null; // set by isSelfAdminOrOwner
        if (sa) {
            const forbidden = Object.keys(req.body || {}).filter(k => !SUBADMIN_EDITABLE_FIELDS.includes(k) && req.body[k] !== undefined);
            // Harmless read-only fields the form sends back are dropped rather than refused.
            const ignorable = ['userId', 'userType', 'status', 'endDate', 'daysRemaining', 'renewalHistory', 'ipMisuse', 'tehsil', 'mauzaList'];
            const real = forbidden.filter(k => !ignorable.includes(k));
            if (real.length) return res.status(403).json({ message: `You can't change: ${real.join(', ')}` });
            ignorable.forEach(k => delete req.body[k]);
            // Temporary mouza access: allowed for sub-admins too, limited to 1-30 days.
            if (Array.isArray(req.body.tehsilAccess)) {
                const maxEnd = Date.now() + 30 * 86400e3 + 60e3;
                req.body.tehsilAccess = req.body.tehsilAccess.map(e => ({
                    tehsil: e.tehsil, mouzas: e.mouzas || [],
                    tempGrants: (e.tempGrants || []).filter(g => g && g.mouza && g.expiresAt && new Date(g.expiresAt).getTime() <= maxEnd)
                }));
            }
            if (req.body.subscriptionType && !(sa.allowedPlans || []).includes(req.body.subscriptionType)) {
                return res.status(400).json({ message: `Plan must be one of: ${(sa.allowedPlans || []).join(', ')}.` });
            }
        } else if (req.user.userType !== 'admin') {
            const forbidden = Object.keys(req.body || {}).filter(k => !SELF_EDITABLE_FIELDS.includes(k));
            if (forbidden.length) {
                logger.security('Blocked self-edit of restricted fields', {
                    userId: req.user.userId,
                    fields: forbidden,
                    ip: req.ip
                });
                return res.status(403).json({ message: `You can't change: ${forbidden.join(', ')}` });
            }
        }

        const ALLOWED_FIELDS = [
            'userName', 'email', 'mobileNumber', 'subscriptionType',
            'startDate', 'status', 'fee', 'tehsilAccess', 'activeTehsil',
            'tehsil', 'mauzaList', 'password'
        ];
        const updateData = {};
        for (const key of ALLOWED_FIELDS) {
            if (req.body[key] !== undefined) {
                let val = req.body[key];
                if (key === 'email' && typeof val === 'string' && val.trim() === '') {
                    val = undefined;
                }
                updateData[key] = val;
            }
        }
        const rawAssignments = updateData.tehsilAccess;
        const legacyTehsil = typeof updateData.tehsil === 'string' ? updateData.tehsil.trim() : undefined;
        const legacyMauzas = Array.isArray(updateData.mauzaList) ? updateData.mauzaList : undefined;
        const requestedActiveTehsil = typeof updateData.activeTehsil === 'string'
            ? updateData.activeTehsil
            : undefined;

        delete updateData.tehsil;
        delete updateData.mauzaList;

        if (!updateData.password || !updateData.password.trim()) {
            delete updateData.password;
        }

        const user = await User.findOne({ userId: req.params.userId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const oldTehsilAccess = user.tehsilAccess ? JSON.parse(JSON.stringify(user.tehsilAccess)) : [];
        const beforeSnap = snapshotUser(user);

        // Sub-admins may not add, remove or change AKAR chaks (admin only). AKAR access
        // the admin already gave stays as it is.
        if (sa && Array.isArray(rawAssignments)) {
            const akar = require('../utils/akarGuard');
            if (akar.akarChanged(oldTehsilAccess, rawAssignments)) return res.status(403).json({ message: akar.AKAR_MESSAGE });
        }

        const currentState = ensureUserTehsilState(user);
        let tehsilModified = currentState.changed;

        let assignmentsPayload = null;
        if (rawAssignments !== undefined) {
            assignmentsPayload = sanitizeTehsilAssignmentsInput(rawAssignments);
        } else if (legacyTehsil !== undefined || legacyMauzas !== undefined) {
            assignmentsPayload = sanitizeTehsilAssignmentsInput([], {
                fallbackTehsil: legacyTehsil || '',
                fallbackMauzas: legacyMauzas || []
            });
        }

        if (assignmentsPayload !== null) {
            if (!assignmentsPayload.length) {
                logger.warn('UpdateUser: Assignments payload is empty after sanitization.', {
                    rawLength: rawAssignments?.length,
                    sanitizedLength: assignmentsPayload.length
                });
            }
            const { tehsilAccess, activeTehsil } = applyTehsilAssignmentsToUser(
                user,
                assignmentsPayload,
                requestedActiveTehsil ?? user.activeTehsil
            );
            updateData.tehsilAccess = tehsilAccess;
            updateData.activeTehsil = activeTehsil;
            tehsilModified = true;
        } else if (requestedActiveTehsil !== undefined) {
            const previousActive = user.activeTehsil;
            const { activeTehsil } = applyTehsilAssignmentsToUser(
                user,
                user.tehsilAccess,
                requestedActiveTehsil
            );
            updateData.activeTehsil = activeTehsil;
            tehsilModified = tehsilModified || activeTehsil !== previousActive;
        }


        let isRenewal = false;
        let previousSubscriptionType = user.subscriptionType;
        let previousStartDate = user.startDate;
        let previousEndDate = user.endDate;
        let previousStatus = user.status;

        if ((updateData.status === 'Active' || updateData.status === 'Trial') && (user.status === 'Pending' || user.status === 'PendingVerification')) {
            updateData.startDate = new Date();
            if (!user.endDate || new Date(user.endDate) <= new Date()) {
                const days = (user.subscriptionType || '').toLowerCase() === 'trial' ? 2 : 30;
                updateData.endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
            }
            user.verificationToken = undefined;
            user.verificationTokenExpires = undefined;
        }

        let expiredScheduleEdit = false;
        if (
            (updateData.subscriptionType && updateData.subscriptionType !== user.subscriptionType) ||
            (updateData.startDate && new Date(updateData.startDate).getTime() !== new Date(user.startDate).getTime())
        ) {
            // A change whose resulting period is ALREADY OVER (e.g. a back-dated start
            // date) activates nothing: it is a date/plan correction, not a renewal, so it
            // must not add to renewal counts or revenue.
            const nextStart = updateData.startDate || user.startDate;
            const nextPlan = updateData.subscriptionType || user.subscriptionType;
            const { status: nextStatus } = calculateDatesAndStatus(nextStart, nextPlan);
            if (nextStatus === 'Expired') expiredScheduleEdit = true;
            else isRenewal = true;
        }

        // Same plan already given today (by admin or a sub-admin) and still running:
        // don't subscribe twice. Keep the existing period; other edits still save.
        let duplicateOf = null;
        if (isRenewal) {
            duplicateOf = await findSameDaySubscription(user, updateData.subscriptionType || user.subscriptionType);
            if (duplicateOf) {
                isRenewal = false;
                delete updateData.startDate;
                delete updateData.endDate;
                delete updateData.subscriptionType;
                delete updateData.fee;
            }
        }

        Object.assign(user, updateData);
        if (req.body.email === '') {
            user.email = undefined;
            user.set('email', undefined);
        }
        if (tehsilModified || Object.prototype.hasOwnProperty.call(updateData, 'tehsilAccess')) {
            user.markModified('tehsilAccess');
        }

        let renewalPaymentAmount = 0;
        const renewalDate = new Date();
        if (isRenewal) {
            const isNonRevenueType = !isRevenuePlan(user.subscriptionType);
            renewalPaymentAmount = isNonRevenueType ? 0 : (updateData.fee !== undefined ? updateData.fee : user.fee);

            // Kept for the existing history screens; the permanent record is AccountEvent.
            user.renewalHistory.push({
                date: renewalDate,
                type: user.subscriptionType,
                paymentAmount: renewalPaymentAmount,
                previousSubscriptionType: previousSubscriptionType,
                previousStartDate: previousStartDate,
                previousEndDate: previousEndDate
            });
            if (!isNonRevenueType) {
                user.renewalCount = (user.renewalCount || 0) + 1;
            }
        }

        await user.save();

        // Sub-admin renewing their own customer: bill them the price they entered
        // (manual pricing for now; automatic tier pricing comes later).
        let billing = null;
        if (sa && isRenewal && isRevenuePlan(user.subscriptionType)) {
            const price = Math.max(0, Number(renewalPaymentAmount) || 0);
            billing = { subAdminId: sa.userId, price, pricingVersion: undefined, billDay: require('../services/subAdminBilling').pkDay(renewalDate) };
        }

        await recordUpdateEvents(req, user, beforeSnap, {
            billing,
            isRenewal,
            renewalDate,
            renewalPaymentAmount,
            previousSubscriptionType,
            previousStartDate,
            previousEndDate,
            previousStatus,
            expiredScheduleEdit
        });

        // Sub-admin saved one of their customers through the edit form: tell the admin
        // what changed (renewal, mouzas added/removed, temporary access, profile).
        if (sa) {
            try {
                const flat = (acc) => (acc || []).flatMap(x => (x.mouzas || []).map(m => `${x.tehsil} - ${m}`));
                const before = flat(beforeSnap.tehsilAccess), after = flat(snapshotUser(user).tehsilAccess);
                const added = after.filter(m => !before.includes(m)), removed = before.filter(m => !after.includes(m));
                const temps = (user.tehsilAccess || []).flatMap(x => (x.tempGrants || []).map(g => `${g.mouza} (until ${new Date(g.expiresAt).toLocaleDateString('en-GB')})`));
                const parts = [];
                if (isRenewal) parts.push(`renewed: ${user.subscriptionType}${billing ? `, billed Rs ${billing.price}` : ''}, customer fee Rs ${user.fee || 0}`);
                if (expiredScheduleEdit) parts.push('dates/plan corrected (already expired, not a renewal)');
                if (added.length) parts.push(`mouzas added: ${added.join(', ')}`);
                if (removed.length) parts.push(`mouzas removed: ${removed.join(', ')}`);
                if (temps.length && (added.length || removed.length || rawAssignments !== undefined)) parts.push(`temporary access: ${temps.join(', ')}`);
                const prof = ['userName', 'mobileNumber', 'email'].filter(k => req.body[k] !== undefined && String(beforeSnap[k] || '') !== String(user[k] || ''));
                if (prof.length) parts.push(`profile: ${prof.join(', ')}`);
                if (req.body.password) parts.push('password reset');
                if (parts.length) {
                    notifyAdmins({
                        type: isRenewal ? 'subscription' : 'info',
                        title: `[${sa.userId}] ${isRenewal ? 'renewed' : 'edited'} ${user.userId}`,
                        message: `${user.userName || user.userId}: ${parts.join('; ')}.`
                    }).catch(() => {});
                }
            } catch (e) { logger.warn('Sub-admin edit notification failed', { error: e.message }); }
        }

        // Respond immediately — do NOT await notifications before replying.
        // sendNotification() can hang when Redis is down and the web-push
        // fallback makes slow external HTTP calls, which would block this
        // response and cause the browser to time out with a CORS error.
        res.status(200).json({
            message: duplicateOf
                ? `Already subscribed today (${user.subscriptionType} until ${new Date(user.endDate).toLocaleDateString('en-GB')}). Not subscribed again; other changes saved.`
                : 'User updated successfully',
            duplicate: !!duplicateOf,
            user: sanitizeUser(user)
        });

        // Fire notifications in the background (fire-and-forget)
        const isActivating = (previousStatus === 'Pending' || previousStatus === 'PendingVerification') && (user.status === 'Active' || user.status === 'Trial');

        let tehsilChangesMessage = '';
        if (tehsilModified) {
            const newTehsilAccess = user.tehsilAccess ? JSON.parse(JSON.stringify(user.tehsilAccess)) : [];
            tehsilChangesMessage = diffTehsilAccess(oldTehsilAccess, newTehsilAccess);
        }

        if (isRenewal) {
            const curDateStr = new Date().toLocaleDateString();
            sendNotification(user.userId, {
                type: 'subscription',
                title: 'Subscription Renewed',
                message: `Your ${user.subscriptionType} subscription has been renewed for ${user.daysRemaining || 0} days on ${curDateStr} .`
            }).catch((e) => logger.error('updateUser: renewal notification failed', { error: e.message }));
        }

        if (isActivating) {
            sendNotification(user.userId, {
                type: 'activation',
                title: 'Account Activated',
                message: 'Great news! Your account has been activated. You now have full access to the system features .'
            }).catch((e) => logger.error('updateUser: activation notification failed', { error: e.message }));

            if (user.isPublicRegistration || user.registrationSource === 'public') {
                notifyAdmins({
                    type: 'activation',
                    title: 'Public User Activated',
                    message: `${user.userId} (${user.userName || user.userId}) activated their account.`
                }).catch((e) => logger.error('updateUser: admin activation notification failed', { error: e.message }));
            }
        }

        if (tehsilChangesMessage) {
            sendNotification(user.userId, {
                type: 'profile',
                title: 'Access Updated',
                message: `Your access have been updated by the team. ${tehsilChangesMessage}`
            }).catch((e) => logger.error('updateUser: assignments notification failed', { error: e.message }));
        }

        if (!isRenewal && !tehsilChangesMessage && !isActivating) {
            sendNotification(user.userId, {
                type: 'profile',
                title: 'Account Updated',
                message: 'Your account details have been updated by.'
            }).catch((e) => logger.error('updateUser: profile notification failed', { error: e.message }));
        }
    } catch (error) {
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0];
            const displayField = field === 'userId' ? 'User ID' : field;
            return res.status(400).json({ message: `Update failed. A user with this ${displayField} already exists.` });
        }
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: error.message || 'Failed to update user' });
    }
};

/**
 * GET /api/users/:userId/history — permanent account history (admin only).
 * Works for deleted users too, since events outlive the user record.
 */
exports.getUserHistory = async (req, res) => {
    try {
        const AccountEvent = require('../models/AccountEvent');
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const filter = { userId: req.params.userId };
        const [events, total] = await Promise.all([
            AccountEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            AccountEvent.countDocuments(filter)
        ]);
        res.json({ events, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        logger.error('getUserHistory error:', { error: error.message });
        res.status(500).json({ message: 'Failed to load history' });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findOneAndDelete({ userId: req.params.userId });
        if (!user) return res.status(404).json({ message: 'User not found' });
        await recordEvent({
            userId: user.userId,
            ownerAtEvent: user.managedBy || null,
            type: 'DELETED',
            before: snapshotUser(user)
        }, req);
        res.status(200).json({ message: 'User deleted successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete user' });
    }
};

exports.renewSubscription = async (req, res) => {
    try {
        const { subscriptionType } = req.body;
        const now = new Date();
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) return res.status(404).json({ message: 'User not found' });
        if (await findSameDaySubscription(user, subscriptionType, now)) {
            return res.json({ message: `Already subscribed today (${user.subscriptionType} until ${new Date(user.endDate).toLocaleDateString('en-GB')}). Not subscribed again.`, duplicate: true, user: sanitizeUser(user) });
        }
        const previousStatus = user.status;
        const isNonRevenueType = !isRevenuePlan(subscriptionType);
        const previous = { plan: user.subscriptionType, start: user.startDate, end: user.endDate };
        const paymentAmount = isNonRevenueType ? 0 : user.fee;

        user.renewalHistory.push({
            date: now,
            type: subscriptionType,
            paymentAmount,
            previousSubscriptionType: user.subscriptionType,
            previousStartDate: user.startDate,
            previousEndDate: user.endDate
        });

        if (!isNonRevenueType) {
            user.renewalCount++;
        }

        user.startDate = now;
        user.subscriptionType = subscriptionType;
        const { endDate, daysRemaining, status } = calculateDatesAndStatus(now, subscriptionType);
        user.endDate = endDate;
        user.daysRemaining = daysRemaining;
        user.status = status;
        await user.save();

        await recordEvent({
            userId: user.userId,
            ownerAtEvent: user.managedBy || null,
            type: 'RENEWED',
            plan: subscriptionType,
            previousPlan: previous.plan,
            periodStart: user.startDate,
            periodEnd: user.endDate,
            previousPeriodStart: previous.start,
            previousPeriodEnd: previous.end,
            paymentAmount,
            requestKey: renewalKey(user.userId, now, subscriptionType),
            createdAt: now
        }, req);

        // Respond immediately — fire notifications in the background
        res.json({ message: 'Subscription renewed', user: sanitizeUser(user) });

        const isActivating = previousStatus === 'Pending' && user.status === 'Active';

        if (isActivating) {
            sendNotification(user.userId, {
                type: 'activation',
                title: 'Account Activated',
                message: 'Your account has been activated successfully! You now have full access.'
            }).catch((e) => logger.error('renewSubscription: activation notification failed', { error: e.message }));
        } else {
            sendNotification(user.userId, {
                type: 'subscription',
                title: 'Subscription Renewed',
                message: `Your ${user.subscriptionType} subscription has been renewed successfully.`
            }).catch((e) => logger.error('renewSubscription: renewal notification failed', { error: e.message }));
        }
    } catch (error) {
        res.status(500).json({ message: 'Failed to renew subscription' });
    }
};

exports.searchUsers = async (req, res) => {
    const query = (req.query.query || '').trim();
    if (!query) return res.json([]);

    // Length guard
    if (query.length > 100) {
        return res.status(400).json({ error: 'Query too long' });
    }

    try {
        // SCALE-3: Use $text search with the existing text index on {userName, userId}
        // instead of case-insensitive $regex, which caused a full collection scan (COLLSCAN).
        // Results are ranked by relevance score for better UX.
        const users = await User.find(
            { $text: { $search: query } },
            { score: { $meta: 'textScore' } }
        )
            .sort({ score: { $meta: 'textScore' } })
            .limit(15)
            .select('userId userName -_id')
            .maxTimeMS(5000);

        res.json(users);
    } catch (err) {
        // Fallback to prefix regex for partial-word matches (e.g. query < 2 chars or special chars only)
        try {
            const sanitizedQuery = escapeRegex(query);
            const users = await User.find({
                $or: [
                    { userId: { $regex: `^${sanitizedQuery}`, $options: 'i' } },
                    { userName: { $regex: `^${sanitizedQuery}`, $options: 'i' } }
                ]
            })
                .limit(15)
                .select('userId userName -_id')
                .maxTimeMS(3000);
            res.json(users);
        } catch (fallbackErr) {
            res.status(500).json([]);
        }
    }
};

exports.checkUserIdExists = async (req, res) => {
    try {
        const userId = req.params.userId;
        if (!userId) return res.json({ exists: false });
        // SEC-04: Add timing-safe delay to prevent user enumeration
        const [exists] = await Promise.all([
            User.exists({ userId }),
            new Promise(r => setTimeout(r, 200 + Math.random() * 300))
        ]);
        res.json({ exists: !!exists });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

exports.resetDefaultPassword = async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Admin, or the sub-admin who manages this customer (route: isAdminOrOwner).
        // Random password from the name, a special character, the phone digits and
        // mixed-case letters, e.g. "Arif#4821kQ".
        const securePassword = require('../utils/passwordGenerator').generateUserPassword(user.userName, user.mobileNumber);

        user.password = securePassword;
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        // Also email it when the user has an address (in the background).
        if (user.email) {
            sendResetEmail(user.email, user.userId, null, securePassword)
                .catch(emailErr => logger.error('Failed to send reset password email:', { error: emailErr.message }));
        }
        if (req.user.userType === 'subadmin') {
            require('../utils/notificationUtils').notifyAdmins({
                type: 'info', title: `[${req.user.userId}] reset a customer's password`, message: `${user.userId}'s password was reset by ${req.user.userId}.`
            }).catch(() => {});
        }

        // The admin / sub-admin shares the new password with the customer (WhatsApp),
        // so it is always returned to them.
        res.status(200).json({
            message: 'Password reset successfully.',
            userId: user.userId,
            userName: user.userName,
            temporaryPassword: securePassword,
            emailSent: !!user.email
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to reset password' });
    }
};


exports.warnUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { warningType, message } = req.body;

        // SEC-07: Always use the server-verified identity from the JWT — never trust req.body.adminUserId
        const adminUserId = req.user.userId;

        const user = await User.findOne({ userId });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!user.warnings) user.warnings = [];

        user.warnings.push({
            type: warningType,
            message: message,
            adminUserId: adminUserId,
            timestamp: new Date(),
            resolved: false
        });

        await user.save();

        res.json({
            message: 'Warning issued successfully',
            warningCount: user.warnings.length
        });
    } catch (err) {
        res.status(500).json({ error: 'Unable to issue warning' });
    }
};

exports.getUserLoginHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const days = parseInt(req.query.days) || 30;
        
        // SCALE-01: indexed exact match on userIdLower instead of case-insensitive $regex (COLLSCAN)
        const user = await User.findOne({ userIdLower: String(userId || '').toLowerCase() }).select('userId').lean();
        if (!user) return res.status(404).json({ message: 'User not found' });

        const exactUserId = user.userId;
        const Session = require('../models/Session');
        const query = { userId: exactUserId };
        if (days !== 'all' && !isNaN(days)) {
            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            query.start = { $gte: cutoff };
        }

        const sessions = await Session.find(query).sort({ start: -1 }).lean();

        // Map backend session schema to frontend expectation
        const history = sessions.map(s => ({
            loginTime: s.start,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            deviceId: s.deviceId,
            deviceType: s.deviceInfo?.deviceType || 'Unknown',
            location: s.location,
            success: true // These are stored sessions, so they were successful logins
        }));

        res.json(history);
    } catch (error) {
        logger.error('getUserLoginHistory error:', { error: error.message, stack: error.stack, userId: req.params.userId });
        res.status(500).json({ error: 'Failed to fetch login history' });
    }
};
exports.getBlockedUsers = async (req, res) => {
    try {
        const { getRedisClient, isRedisReady } = require('../services/redisClient');
        const blocked = [];
        const maxAttempts = 20;
        const prefix = 'rl:login:';
        const redisClient = getRedisClient();
        if (redisClient && isRedisReady()) {
            const keys = []; let _c = '0'; do { const [nc, b] = await redisClient.scan(_c, 'MATCH', `${prefix}*`, 'COUNT', 100); _c = nc; if (b && b.length) keys.push(...b); } while (_c !== '0');
            for (const key of keys) {
                const hitsVal = await redisClient.get(key);
                const hits = parseInt(hitsVal, 10) || 0;
                if (hits >= maxAttempts) {
                    blocked.push({ ip: key.substring(prefix.length), attempts: hits });
                }
            }
        }
        res.json(blocked);
    } catch (error) {
        logger.error('getBlockedUsers error:', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Failed to fetch blocked users' });
    }
};

exports.unblockUser = async (req, res) => {
    try {
        const { ip } = req.body;
        const { getRedisClient, isRedisReady } = require('../services/redisClient');
        const redisClient = getRedisClient();
        if (redisClient && isRedisReady()) {
            await redisClient.del(`rl:login:${ip}`);
        }
        res.json({ message: 'Unblocked successfully' });
    } catch (error) {
        logger.error('unblockUser error:', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Failed to unblock' });
    }
};

