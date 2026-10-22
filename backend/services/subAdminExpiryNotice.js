/**
 * Tells a sub-admin when one of their customers' subscriptions expires.
 *
 * Runs every 15 minutes. A customer whose endDate passed in the last 2 days
 * (and isn't awaiting activation or suspended) gets one in-app notification sent
 * to their sub-admin. The expiry is marked on the user (subAdminExpiryNotifiedFor
 * = that endDate) with an atomic update, so each expiry is announced exactly once
 * even with several server instances; after a renewal the new endDate is
 * announced again when it in turn expires.
 */
const User = require('../models/User');
const logger = require('../utils/logger');

const WINDOW_MS = 2 * 24 * 3600 * 1000;   // don't announce old expiries (e.g. on first deploy)

async function notifySubAdminExpiries(now = new Date()) {
    const { sendNotification } = require('../utils/notificationUtils');
    const due = await User.find({
        userType: 'user',
        managedBy: { $nin: [null, ''] },
        status: { $nin: ['AwaitingActivation', 'Suspended', 'PendingVerification'] },
        endDate: { $lte: now, $gt: new Date(now.getTime() - WINDOW_MS) }
    }).select('_id userId userName managedBy endDate subscriptionType mobileNumber subAdminExpiryNotifiedFor').lean();

    let sent = 0;
    for (const u of due) {
        if (u.subAdminExpiryNotifiedFor && new Date(u.subAdminExpiryNotifiedFor).getTime() === new Date(u.endDate).getTime()) continue;
        // Claim this expiry (raw collection: the field isn't in the schema).
        const claim = await User.collection.updateOne(
            { _id: u._id, endDate: u.endDate, subAdminExpiryNotifiedFor: { $ne: u.endDate } },
            { $set: { subAdminExpiryNotifiedFor: u.endDate } }
        );
        if (!claim.modifiedCount) continue;
        const when = new Date(u.endDate).toLocaleString('en-PK', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        await sendNotification(u.managedBy, {
            type: 'subscription',
            title: `Expired · ${u.userId}`,
            replyTo: u.userId,
            message: `${u.subscriptionType || 'Plan'} ended ${new Date(u.endDate).toLocaleDateString('en-GB')}`,
            details: { kind: 'expired', plan: u.subscriptionType, endDate: u.endDate, mobile: u.mobileNumber || '', when }
        }).catch(e => logger.error('Expiry notice failed', { userId: u.userId, error: e.message }));
        sent++;
    }
    if (sent) logger.info('Sub-admin expiry notices sent', { count: sent });
    return sent;
}

function startSubAdminExpiryNotices() {
    const run = () => notifySubAdminExpiries().catch(e => logger.error('Sub-admin expiry notice job failed', { error: e.message }));
    setTimeout(run, 30 * 1000);              // shortly after start-up
    setInterval(run, 15 * 60 * 1000);        // then every 15 minutes
}

module.exports = { notifySubAdminExpiries, startSubAdminExpiryNotices };
