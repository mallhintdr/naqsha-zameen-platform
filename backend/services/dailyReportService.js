/**
 * dailyReportService.js
 *
 * Aggregates everything needed for the admin operations-report PDF, for an
 * admin-chosen date range (not a fixed "today"):
 *   - KPI tiles (active users snapshot, registrations/renewals/expirations
 *     and revenue WITHIN the selected range)
 *   - Revenue for the range vs. the immediately-prior period of equal length
 *   - Daily trend series (revenue + registrations) spanning the range
 *   - Subscription health breakdown + top tehsils (current snapshot)
 *   - Range-scoped user-wise detail lists (registrations / renewals / expirations)
 *   - Rule-based (non-AI) insight bullets
 *
 * Reuses the same aggregation patterns already proven in statsController.js
 * (AccountEvent-based revenue, subscriptionHealth, registrationsDaily,
 * tehsilStats) rather than inventing a parallel set of queries.
 */
const User = require('../models/User');
const AccountEvent = require('../models/AccountEvent');
const SubAdminPayment = require('../models/SubAdminPayment');
const { calculateDatesAndStatus } = require('../utils/dateUtils');
const logger = require('../utils/logger');

// Same GMT+5 (Pakistan) convention used in utils/dateUtils.js, so a
// "day"/"date" in this report always means the Pakistan calendar day
// regardless of the server's own OS timezone.
const OFFSET_MS = 5 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const MAX_LIST_ROWS = 500;

function pakistanDayBounds(referenceDate = new Date()) {
    const shifted = new Date(referenceDate.getTime() + OFFSET_MS);
    shifted.setUTCHours(0, 0, 0, 0);
    const startOfDayPkLocal = shifted.getTime();
    const start = new Date(startOfDayPkLocal - OFFSET_MS);
    const end = new Date(startOfDayPkLocal + 24 * 60 * 60 * 1000 - OFFSET_MS);
    return { start, end };
}

function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Parses a 'YYYY-MM-DD' string as a Pakistan calendar date (midday avoids any DST/rounding edge case). */
function parsePkDateString(s) {
    const d = new Date(`${s}T12:00:00+05:00`);
    if (isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`);
    return d;
}

function formatPkDate(date) {
    return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

function truncateList(list) {
    if (list.length <= MAX_LIST_ROWS) return { rows: list, truncatedBy: 0 };
    return { rows: list.slice(0, MAX_LIST_ROWS), truncatedBy: list.length - MAX_LIST_ROWS };
}

/**
 * STEP 1 — Live status refresh pass.
 *
 * `status`/`endDate`/`daysRemaining` on a User doc are only recalculated
 * on-demand (profile fetch, admin list) — a user who hasn't been viewed
 * recently can carry a stale status. Before generating a report that claims
 * to show "active users" and "expired in range", refresh every non-Permanent,
 * already-verified user's computed fields for real, in bulk.
 */
async function refreshAllSubscriptionStatuses() {
    const users = await User.find({
        userType: 'user',
        subscriptionType: { $ne: 'Permanent' },
        status: { $nin: ['Pending', 'PendingVerification', 'AwaitingActivation', 'Suspended'] }
    }).select('userId startDate subscriptionType status endDate daysRemaining').lean();

    const ops = [];
    for (const u of users) {
        const { status, endDate, daysRemaining } = calculateDatesAndStatus(u.startDate, u.subscriptionType);
        const changed = status !== u.status
            || daysRemaining !== u.daysRemaining
            || String(endDate) !== String(u.endDate);
        if (changed) {
            ops.push({
                updateOne: {
                    filter: { _id: u._id },
                    update: { $set: { status, endDate, daysRemaining } }
                }
            });
        }
    }

    if (ops.length) {
        await User.bulkWrite(ops, { ordered: false });
        logger.info(`Operations report: refreshed stale subscription status on ${ops.length} users`);
    }
}

// Revenue in this report counts only amounts actually recorded on a renewal
// (a renewal with no recorded amount counts as Rs 0), as it always has.
const RENEWALS_IN = (start, end) => ({ type: 'RENEWED', createdAt: { $gte: start, $lt: end } });
// Revenue = money actually received:
//   - renewals you collected directly (not billed to a sub-admin), plus
//   - payments sub-admins made to you (net of reversals), on the day received.
// Sub-admin renewals/activations/upgrades stay recorded as events with their
// platform price, but are NOT added here: the sub-admin pays for them in one
// lump sum later, and counting both would overstate revenue.
const REVENUE_IN = (start, end) => ({ type: 'RENEWED', billable: { $ne: true }, createdAt: { $gte: start, $lt: end } });
const SUBADMIN_PAID_IN = (start, end) => ({ receivedAt: { $gte: start, $lt: end } });

/** Money received within [start, end): direct renewals + sub-admin payments. */
async function sumRevenueBetween(start, end) {
    const [direct, fromSubAdmins] = await Promise.all([
        AccountEvent.aggregate([
            { $match: REVENUE_IN(start, end) },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$paymentAmount', 0] } }, count: { $sum: 1 } } }
        ]),
        SubAdminPayment.aggregate([
            { $match: SUBADMIN_PAID_IN(start, end) },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ])
    ]);
    const d = direct[0] || { total: 0, count: 0 };
    const s = fromSubAdmins[0]?.total || 0;
    return { total: d.total + s, count: d.count, direct: d.total, fromSubAdmins: s };
}

function pctChange(current, previous) {
    if (!previous) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
}

/**
 * @param {{ startDate: string, endDate: string }} range 'YYYY-MM-DD' Pakistan
 *   calendar dates, inclusive on both ends (e.g. startDate === endDate is a
 *   valid single-day report).
 */
async function getReportData({ startDate, endDate }) {
    if (!startDate || !endDate) throw new Error('startDate and endDate are required');

    const rangeStart = pakistanDayBounds(parsePkDateString(startDate)).start;
    const rangeEnd = pakistanDayBounds(parsePkDateString(endDate)).end;
    if (rangeEnd <= rangeStart) throw new Error('endDate must be on or after startDate');

    const rangeDays = Math.round((rangeEnd - rangeStart) / (24 * 60 * 60 * 1000));
    if (rangeDays > MAX_RANGE_DAYS) throw new Error(`Date range too large (max ${MAX_RANGE_DAYS} days)`);

    await refreshAllSubscriptionStatuses();

    // Immediately-prior period of the same length, for a like-for-like comparison.
    const priorStart = new Date(rangeStart.getTime() - (rangeEnd - rangeStart));
    const priorEnd = rangeStart;

    const now = new Date();

    const [
        activeUsers,
        newRegistrationsListFull,
        expiredListFull,
        revenueRange,
        revenuePrior,
        subscriptionHealthRaw,
        topTehsils,
        revenueTrend,
        registrationsTrend,
        renewalsInRangeFull
    ] = await Promise.all([
        User.countDocuments({ userType: 'user', status: { $nin: ['Expired', 'Pending', 'PendingVerification', 'AwaitingActivation'] } }),

        User.find({ createdAt: { $gte: rangeStart, $lt: rangeEnd }, userType: 'user' })
            .select('userId userName activeTehsil subscriptionType registrationSource createdAt')
            .sort({ createdAt: -1 })
            .lean(),

        User.find({ endDate: { $gte: rangeStart, $lt: rangeEnd }, status: 'Expired', userType: 'user' })
            .select('userId userName activeTehsil subscriptionType mobileNumber endDate')
            .sort({ endDate: -1 })
            .lean(),

        sumRevenueBetween(rangeStart, rangeEnd),
        sumRevenueBetween(priorStart, priorEnd),

        User.aggregate([
            { $match: { userType: 'user' } },
            { $group: {
                _id: null,
                active: { $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] } },
                expired: { $sum: { $cond: [{ $eq: ['$status', 'Expired'] }, 1, 0] } },
                pending: { $sum: { $cond: [{ $in: ['$status', ['Pending', 'PendingVerification', 'AwaitingActivation']] }, 1, 0] } },
                expiringSoon: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'Active'] }, { $lte: ['$daysRemaining', 5] }] }, 1, 0] } }
            } }
        ]).then(r => r[0] || { active: 0, expired: 0, pending: 0, expiringSoon: 0 }),

        User.aggregate([
            { $match: { userType: 'user', status: 'Active' } },
            { $unwind: { path: '$tehsilAccess', preserveNullAndEmptyArrays: false } },
            { $group: { _id: '$tehsilAccess.tehsil', userCount: { $sum: 1 } } },
            { $sort: { userCount: -1 } },
            { $limit: 10 }
        ]),

        Promise.all([
            AccountEvent.aggregate([
                { $match: REVENUE_IN(rangeStart, rangeEnd) },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:00' } }, amount: { $sum: { $ifNull: ['$paymentAmount', 0] } } } }
            ]),
            SubAdminPayment.aggregate([
                { $match: SUBADMIN_PAID_IN(rangeStart, rangeEnd) },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$receivedAt', timezone: '+05:00' } }, amount: { $sum: '$amount' } } }
            ])
        ]).then(([a, b]) => {
            const byDay = {};
            [...a, ...b].forEach(r => { byDay[r._id] = (byDay[r._id] || 0) + r.amount; });
            return Object.entries(byDay).map(([date, amount]) => ({ date, amount })).sort((x, y) => x.date.localeCompare(y.date));
        }),

        User.aggregate([
            { $match: { createdAt: { $gte: rangeStart, $lt: rangeEnd }, userType: 'user' } },
            { $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:00' } },
                count: { $sum: 1 },
                publicCount: { $sum: { $cond: [{ $eq: ['$registrationSource', 'public'] }, 1, 0] } }
            } },
            { $project: { _id: 0, date: '$_id', count: 1, publicCount: 1 } },
            { $sort: { date: 1 } }
        ]),

        AccountEvent.aggregate([
            { $match: RENEWALS_IN(rangeStart, rangeEnd) },
            { $lookup: { from: 'users', localField: 'userId', foreignField: 'userId', pipeline: [{ $project: { _id: 0, userName: 1 } }], as: 'u' } },
            { $project: {
                _id: 0,
                userId: 1,
                userName: { $ifNull: [{ $first: '$u.userName' }, '$userId'] },
                previousType: '$previousPlan',
                newType: '$plan',
                amount: { $ifNull: ['$paymentAmount', 0] },
                // Billed to a sub-admin: shown for the record, not counted in revenue.
                viaSubAdmin: { $cond: [{ $eq: ['$billable', true] }, '$ownerAtEvent', null] },
                date: '$createdAt'
            } },
            { $sort: { date: -1 } }
        ])
    ]);

    const subscriptionHealth = { ...subscriptionHealthRaw };
    delete subscriptionHealth._id;

    // Fill any missing days in the range's trends with zero so the chart axis is continuous.
    const fillDailySeries = (rows, valueKeys) => {
        const map = new Map(rows.map(r => [r.date, r]));
        const out = [];
        for (let i = 0; i < rangeDays; i++) {
            const d = addDays(rangeStart, i);
            const label = formatPkDate(d);
            const row = map.get(label);
            const entry = { date: label };
            valueKeys.forEach(k => { entry[k] = row ? (row[k] || 0) : 0; });
            out.push(entry);
        }
        return out;
    };

    const revenueTrendFilled = fillDailySeries(revenueTrend, ['amount']);
    const registrationsTrendFilled = fillDailySeries(registrationsTrend, ['count', 'publicCount']);

    const { rows: newRegistrationsList, truncatedBy: registrationsTruncated } = truncateList(newRegistrationsListFull);
    const { rows: expiredList, truncatedBy: expiredTruncated } = truncateList(expiredListFull);
    const { rows: renewalsList, truncatedBy: renewalsTruncated } = truncateList(renewalsInRangeFull);

    const totalNewRegistrations = newRegistrationsListFull.length;
    const publicRegistrations = newRegistrationsListFull.filter(u => u.registrationSource === 'public').length;
    const trialConversions = renewalsInRangeFull.filter(r => (r.previousType || '').toLowerCase() === 'trial').length;
    const publicConversionRate = publicRegistrations > 0
        ? Math.round((trialConversions / publicRegistrations) * 100)
        : null;

    const revenueChangePct = pctChange(revenueRange.total, revenuePrior.total);

    const periodLabel = startDate === endDate ? formatPkDate(rangeStart) : `${formatPkDate(rangeStart)} to ${formatPkDate(addDays(rangeEnd, -1))}`;

    const insights = [];
    insights.push(
        revenueChangePct >= 0
            ? `Revenue is up ${revenueChangePct}% vs. the prior equivalent period (Rs. ${revenueRange.total} vs Rs. ${revenuePrior.total}).`
            : `Revenue is down ${Math.abs(revenueChangePct)}% vs. the prior equivalent period (Rs. ${revenueRange.total} vs Rs. ${revenuePrior.total}).`
    );
    if (expiredListFull.length > 0) {
        insights.push(`${expiredListFull.length} user(s) expired in this period — consider a renewal follow-up outreach.`);
    }
    if (subscriptionHealth.expiringSoon > 0) {
        insights.push(`${subscriptionHealth.expiringSoon} active user(s) will expire within 5 days (as of report generation).`);
    }
    if (publicConversionRate !== null) {
        insights.push(`${publicConversionRate}% of this period's public trial registrations already converted to a paid renewal.`);
    }
    if (topTehsils[0]) {
        insights.push(`Top tehsil by active users: ${topTehsils[0]._id} (${topTehsils[0].userCount} users).`);
    }
    if (renewalsInRangeFull.length === 0 && expiredListFull.length === 0 && totalNewRegistrations === 0) {
        insights.push('No renewal, expiration, or registration activity in this period.');
    }

    return {
        reportDate: periodLabel,
        startDate,
        endDate,
        generatedAt: now,
        kpis: {
            activeUsers,
            newRegistrationsToday: totalNewRegistrations,
            renewalsToday: renewalsInRangeFull.length,
            expiredToday: expiredListFull.length,
            revenueToday: revenueRange.total
        },
        revenue: {
            today: revenueRange.total,
            todayChangePct: revenueChangePct,
            priorPeriodTotal: revenuePrior.total,
            trend30d: revenueTrendFilled
        },
        registrationsTrend30d: registrationsTrendFilled,
        trendDays: rangeDays,
        subscriptionHealth,
        topTehsils: topTehsils.map(t => ({ tehsil: t._id || 'Unknown', userCount: t.userCount })),
        newRegistrationsList,
        renewalsList,
        expiredList,
        listTruncation: { registrationsTruncated, renewalsTruncated, expiredTruncated },
        expiringUsersRenewedTodayCount: renewalsInRangeFull.filter(r => (r.previousType || '').toLowerCase() !== 'trial').length,
        insights
    };
}

module.exports = { getReportData, refreshAllSubscriptionStatuses };
