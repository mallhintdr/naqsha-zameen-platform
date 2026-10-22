/**
 * Deletes public sign-ups that never verified their email in time.
 *
 * A public registration waits in 'PendingVerification' until the emailed link
 * is opened (the link is valid for 24 hours). Once that deadline passes, the
 * account is removed completely, and nothing personal is kept: the user
 * record, its device fingerprint (so the device and email can register again),
 * and the creation history event (which holds a snapshot with the email).
 * A DELETED event with only the user ID is written for the audit trail.
 */
const User = require('../models/User');
const AccountEvent = require('../models/AccountEvent');
const logger = require('../utils/logger');

const VERIFY_WINDOW_MS = 24 * 60 * 60 * 1000;

async function purgeUnverifiedPublicUsers(now = new Date()) {
    const DeviceFingerprint = require('../models/DeviceFingerprint');
    const stale = await User.find({
        userType: 'user',
        status: 'PendingVerification',
        $and: [
            { $or: [{ isPublicRegistration: true }, { registrationSource: 'public' }] },
            { $or: [
                { verificationTokenExpires: { $lt: now } },
                // Older records without an expiry: fall back to the creation time.
                { verificationTokenExpires: { $exists: false }, createdAt: { $lt: new Date(now.getTime() - VERIFY_WINDOW_MS) } }
            ] }
        ]
    }).select('_id userId email deviceId').lean();
    if (!stale.length) return { deleted: 0 };

    const ids = stale.map(u => u._id);
    const userIds = stale.map(u => u.userId);
    // Device fingerprints of these sign-ups, matched by user, device and email
    // (frees the device and email to register again; nothing of them is kept).
    const deviceIds = stale.map(u => u.deviceId).filter(Boolean);
    const emails = stale.map(u => u.email).filter(Boolean);
    await DeviceFingerprint.deleteMany({ $or: [
        { userId: { $in: userIds } },
        ...(deviceIds.length ? [{ deviceId: { $in: deviceIds } }] : []),
        ...(emails.length ? [{ email: { $in: emails } }] : [])
    ] });
    // Any sessions / notifications left by these accounts.
    await require('../models/Session').deleteMany({ userId: { $in: userIds } }).catch(() => {});
    await require('../models/Notification').deleteMany({ userId: { $in: userIds } }).catch(() => {});

    // History of a never-activated sign-up: only non-billable events of these IDs.
    // AccountEvent blocks deletes at the model level (append-only ledger), so the
    // raw collection is used, scoped tightly to these unverified public accounts.
    await AccountEvent.collection.deleteMany({ userId: { $in: userIds }, billable: { $ne: true }, type: { $in: ['USER_CREATED', 'PROFILE_EDITED', 'EMAIL_CHANGE_REQUESTED'] } });

    const result = await User.deleteMany({ _id: { $in: ids }, status: 'PendingVerification' });

    for (const userId of userIds) {
        AccountEvent.create({ userId, type: 'DELETED', actorRole: 'system', note: 'unverified public sign-up removed after the activation deadline' })
            .catch(() => {});
    }
    logger.info('Purged unverified public sign-ups', { count: result.deletedCount, userIds });
    return { deleted: result.deletedCount, userIds };
}

module.exports = { purgeUnverifiedPublicUsers };
