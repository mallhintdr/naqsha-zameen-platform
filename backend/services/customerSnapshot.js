/**
 * A customer's current state for notifications and reply templates:
 * plan, days left, mouzas, and the last fee paid.
 */
const User = require('../models/User');
const AccountEvent = require('../models/AccountEvent');

async function customerSnapshot(userOrId) {
    const u = typeof userOrId === 'string'
        ? await User.findOne({ userId: userOrId }).select('userId userName mobileNumber subscriptionType status startDate endDate fee tehsilAccess managedBy').lean()
        : userOrId;
    if (!u) return null;
    const mouzas = (u.tehsilAccess || []).flatMap(t => (t.mouzas || []).map(m => m));
    const last = await AccountEvent.findOne({ userId: u.userId, type: 'RENEWED', paymentAmount: { $gt: 0 } }).sort({ createdAt: -1 }).select('paymentAmount createdAt plan').lean();
    const daysLeft = u.endDate ? Math.max(0, Math.ceil((new Date(u.endDate) - Date.now()) / 86400e3)) : 0;
    return {
        userId: u.userId,
        userName: u.userName || u.userId,
        mobile: u.mobileNumber || '',
        plan: u.subscriptionType || '',
        status: u.status,
        endDate: u.endDate || null,
        daysLeft,
        isTrial: /trial/i.test(u.subscriptionType || ''),
        mouzaCount: mouzas.length,
        lastFeePaid: last?.paymentAmount ?? (u.fee || 0),
        lastPaidAt: last?.createdAt || null,
        managedBy: u.managedBy || null
    };
}

module.exports = { customerSnapshot };
