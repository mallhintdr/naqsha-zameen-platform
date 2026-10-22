const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const logger = require('./logger');

/**
 * Runs database hygiene tasks.
 * 1. Deletes Audit Logs older than 60 days.
 * 2. Prunes stale sessions older than 30 days from all users (Issue #12).
 * 3. Cleans expired demo links.
 * 4. Removes expired temporary mouza assignments.
 *
 * Users are never deleted here. Renewal history is never trimmed (the
 * permanent record lives in AccountEvent).
 */
const runCleanupTasks = async () => {
    try {
        const auditThreshold = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 Days
        const sessionThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 Days

        // 1. Clean old audit logs
        try {
            const auditResult = await AuditLog.deleteMany({ timestamp: { $lt: auditThreshold } });
            if (auditResult.deletedCount > 0) {
                logger.info('DB Hygiene: Cleaned up old audit logs', {
                    deletedCount: auditResult.deletedCount,
                    threshold: auditThreshold.toISOString()
                });
            }
        } catch (auditErr) {
            logger.warn('DB Hygiene: Could not clean old audit logs', { error: auditErr.message });
        }

        // 2. Issue #12: Prune stale sessions older than 30 days from the standalone Session collection
        try {
            const Session = require('../models/Session');
            const sessionResult = await Session.deleteMany({ start: { $lt: sessionThreshold } });
            if (sessionResult.deletedCount > 0) {
                logger.info('DB Hygiene: Pruned stale sessions from Session collection', {
                    deletedCount: sessionResult.deletedCount,
                    threshold: sessionThreshold.toISOString()
                });
            }
        } catch (sessionErr) {
            logger.warn('DB Hygiene: Could not prune stale sessions', { error: sessionErr.message });
        }

        // 4. Clean expired demo links
        try {
            const DemoLink = require('../models/DemoLink');
            const demoResult = await DemoLink.deleteMany({ expiresAt: { $lt: new Date() } });
            if (demoResult.deletedCount > 0) {
                logger.info('DB Hygiene: Cleaned expired demo links', {
                    deletedCount: demoResult.deletedCount
                });
            }
        } catch (e) {
            // DemoLink model might not exist yet
        }

        // 5. Remove expired temporary mouza assignments from all users
        try {
            const now = new Date();
            const result = await User.updateMany(
                { 'tehsilAccess.tempGrants.expiresAt': { $lt: now } },
                { $pull: { 'tehsilAccess.$[].tempGrants': { expiresAt: { $lt: now } } } }
            );
            if (result.modifiedCount > 0) {
                logger.info('DB Hygiene: Cleaned expired temp mouza assignments from user documents', {
                    usersAffected: result.modifiedCount
                });
            }
        } catch (e) {
            logger.warn('DB Hygiene: Could not clean temp mouza assignments', { error: e.message });
        }

        // 7. Drop legacy TTL index on PendingVerification/Pending users so deletions are governed by 30-day policy
        try {
            const collection = User.collection;
            const indexes = await collection.indexes();
            for (const idx of indexes) {
                if (idx.name === 'createdAt_ttl_pending_verification' || (idx.expireAfterSeconds && idx.partialFilterExpression?.status === 'Pending')) {
                    await collection.dropIndex(idx.name);
                    logger.info(`DB Hygiene: Successfully dropped legacy TTL index ${idx.name}`);
                }
            }
        } catch (e) {
            // Index might not exist or already dropped
        }

    } catch (err) {
        logger.error('DB Hygiene Error:', { error: err.message });
    }
};

module.exports = { runCleanupTasks };
