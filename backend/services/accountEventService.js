const AccountEvent = require('../models/AccountEvent');
const logger = require('../utils/logger');

const NON_REVENUE_PLANS = ['trial', 'trial24', 'free', 'permanent'];

const isRevenuePlan = (plan) => !NON_REVENUE_PLANS.includes(String(plan || '').toLowerCase());

/** Role of whoever made the request, for the event's actorRole. */
const actorFromReq = (req) => {
    if (!req || !req.user) return { actorId: null, actorRole: 'system' };
    const role = ['admin', 'subadmin', 'user'].includes(req.user.userType) ? req.user.userType : 'user';
    return { actorId: req.user.userId, actorRole: role };
};

/**
 * Records one event. History must never block the action it describes, so
 * failures are logged rather than thrown. A duplicate requestKey means the
 * event already exists: it's ignored, or rethrown when throwOnDuplicate is set
 * (for callers that use the key to detect a repeated request).
 */
async function recordEvent(fields, req, { session, throwOnDuplicate = false } = {}) {
    const doc = {
        ...actorFromReq(req),
        ip: req?.ip,
        ...fields
    };
    try {
        const [created] = await AccountEvent.create([doc], session ? { session } : undefined);
        // A renewal / activation answers the customer's request: hide the
        // "Open Renewal" button on the provider's notification.
        if (['RENEWED', 'ACTIVATED'].includes(doc.type) && doc.userId) {
            require('../utils/notificationUtils').completeActions('renewal', doc.userId, {
                label: doc.type === 'RENEWED' ? 'Renewed' : 'Activated',
                at: new Date(),
                plan: doc.plan || undefined,
            }).catch(() => {});
        }
        return created;
    } catch (err) {
        if (err && err.code === 11000 && doc.requestKey) {
            if (throwOnDuplicate) throw err;
            return null;
        }
        logger.error('AccountEvent record failed', { error: err.message, type: fields.type, userId: fields.userId });
        return null;
    }
}

/** Short, safe snapshot of a user for before/after fields (no secrets). */
const snapshotUser = (u) => {
    if (!u) return null;
    const o = typeof u.toObject === 'function' ? u.toObject() : u;
    return {
        userName: o.userName,
        mobileNumber: o.mobileNumber,
        email: o.email,
        status: o.status,
        subscriptionType: o.subscriptionType,
        startDate: o.startDate,
        endDate: o.endDate,
        fee: o.fee,
        userType: o.userType,
        managedBy: o.managedBy || null,
        tehsilAccess: (o.tehsilAccess || []).map(t => ({ tehsil: t.tehsil, mouzas: t.mouzas || [] }))
    };
};

/**
 * Deterministic key for a renewal, shared by live recording and the
 * renewalHistory migration, so the same renewal is never stored twice.
 */
const renewalKey = (userId, date, plan) => `renewal:${userId}:${new Date(date).toISOString()}:${plan || ''}`;

/**
 * The same plan already given to this customer TODAY (Pakistan day) by the admin or a
 * sub-admin, with that period still running → setting it again is a duplicate: it
 * must not add another period, renewal count, bill or revenue. A real advance
 * renewal on a later day still extends the period.
 * @returns the earlier event, or null
 */
async function findSameDaySubscription(user, plan, now = new Date()) {
    if (!user || !plan) return null;
    if (user.subscriptionType !== plan) return null;
    if (!user.endDate || new Date(user.endDate) <= now) return null;
    const { pkDay, pkDayStart } = require('./subAdminBilling');
    const since = pkDayStart(pkDay(now));
    const AccountEvent = require('../models/AccountEvent');
    return AccountEvent.findOne({
        userId: user.userId,
        type: { $in: ['RENEWED', 'ACTIVATED', 'USER_CREATED'] },
        plan,
        createdAt: { $gte: since }
    }).sort({ createdAt: -1 }).lean();
}

module.exports = { recordEvent, actorFromReq, snapshotUser, isRevenuePlan, renewalKey, findSameDaySubscription };
