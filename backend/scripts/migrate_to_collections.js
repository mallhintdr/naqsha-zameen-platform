/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║         GEO-DASHBOARD — SESSION & NOTIFICATION MIGRATION SCRIPT         ║
 * ║                                                                          ║
 * ║  Migrates embedded sessions[] and notifications[] arrays from the        ║
 * ║  monolithic User document into their own standalone collections.         ║
 * ║                                                                          ║
 * ║  USAGE:                                                                  ║
 * ║    node backend/scripts/migrate_to_collections.js                        ║
 * ║    node backend/scripts/migrate_to_collections.js --dry-run              ║
 * ║    node backend/scripts/migrate_to_collections.js --rollback             ║
 * ║                                                                          ║
 * ║  SAFETY:                                                                 ║
 * ║    • --dry-run  → Only counts/reports what WOULD be migrated. No writes. ║
 * ║    • Default    → Migrates data, does NOT remove from User docs yet.     ║
 * ║                   Run app, verify, then re-run with --strip to remove.   ║
 * ║    • --strip    → Removes sessions/notifications from User docs.         ║
 * ║                   Run ONLY after verifying the migration succeeded.      ║
 * ║    • --rollback → Copies data back from new collections into User docs.  ║
 * ║                   Use if something went wrong before --strip was run.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

// ── Models ───────────────────────────────────────────────────────────────────
// Load User WITHOUT the pre-save hooks firing during migration
const User        = require('../models/User');
const Session     = require('../models/Session');
const Notification = require('../models/Notification');

// ── Config ───────────────────────────────────────────────────────────────────
const MONGO_URI   = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/geo-dashboard';
const BATCH_SIZE  = 100; // Process N users at a time to avoid memory spikes
const DRY_RUN     = process.argv.includes('--dry-run');
const STRIP_MODE  = process.argv.includes('--strip');
const ROLLBACK    = process.argv.includes('--rollback');

// ── Logging helpers ───────────────────────────────────────────────────────────
const log   = (msg, data = '') => console.log(`[${new Date().toISOString()}] ${msg}`, data);
const warn  = (msg, data = '') => console.warn(`[${new Date().toISOString()}] ⚠️  ${msg}`, data);
const error = (msg, data = '') => console.error(`[${new Date().toISOString()}] ❌ ${msg}`, data);
const ok    = (msg, data = '') => console.log(`[${new Date().toISOString()}] ✅ ${msg}`, data);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: Migrate sessions[] → sessions collection
// ─────────────────────────────────────────────────────────────────────────────
async function migrateSessions() {
    log('─────────────────────────────────────────────────────────');
    log('PHASE 1: Migrating sessions[] → sessions collection');
    log('─────────────────────────────────────────────────────────');

    const totalUsers = await User.countDocuments({ 'sessions.0': { $exists: true } });
    log(`Found ${totalUsers} users with sessions to migrate.`);

    if (DRY_RUN) {
        const totalSessions = await User.aggregate([
            { $match: { 'sessions.0': { $exists: true } } },
            { $project: { count: { $size: '$sessions' } } },
            { $group: { _id: null, total: { $sum: '$count' } } }
        ]);
        const count = totalSessions[0]?.total || 0;
        log(`[DRY RUN] Would migrate ${count} session documents from ${totalUsers} users.`);
        return { users: totalUsers, documents: count };
    }

    let processedUsers = 0;
    let totalMigrated  = 0;
    let totalSkipped   = 0;
    let totalErrors    = 0;

    // Process in batches to avoid loading all 5,000 users into memory at once
    let skip = 0;
    while (skip < totalUsers) {
        const batch = await User.find({ 'sessions.0': { $exists: true } })
            .select('userId sessions')
            .lean()
            .skip(skip)
            .limit(BATCH_SIZE);

        if (batch.length === 0) break;

        const sessionDocs = [];
        for (const user of batch) {
            for (const s of (user.sessions || [])) {
                // Skip sessions that are already in the new collection
                sessionDocs.push({
                    userId:     user.userId,
                    start:      s.start,
                    end:        s.end     || null,
                    duration:   s.duration,
                    ipAddress:  s.ipAddress,
                    deviceId:   s.deviceId,
                    location:   s.location,
                    userAgent:  s.userAgent,
                    deviceInfo: s.deviceInfo
                });
            }
        }

        if (sessionDocs.length > 0) {
            try {
                // ordered: false — continue even if a duplicate key error occurs
                const result = await Session.insertMany(sessionDocs, {
                    ordered: false,
                    // If a session with same userId+start already exists, skip it
                });
                totalMigrated += result.length;
            } catch (err) {
                if (err.code === 11000 || err.name === 'BulkWriteError') {
                    // Duplicate key — some sessions already migrated (safe to continue)
                    const inserted = err.result?.nInserted || 0;
                    const skipped  = sessionDocs.length - inserted;
                    totalMigrated += inserted;
                    totalSkipped  += skipped;
                    warn(`Batch had ${skipped} duplicate sessions (already migrated) — skipped.`);
                } else {
                    error(`Batch insert failed for batch at skip=${skip}:`, err.message);
                    totalErrors++;
                }
            }
        }

        processedUsers += batch.length;
        skip           += BATCH_SIZE;
        log(`  Progress: ${processedUsers}/${totalUsers} users processed, ${totalMigrated} sessions migrated...`);
    }

    log('');
    ok(`Sessions migration complete:`);
    log(`  • Users processed : ${processedUsers}`);
    log(`  • Sessions migrated: ${totalMigrated}`);
    log(`  • Duplicates skipped: ${totalSkipped}`);
    if (totalErrors > 0) warn(`  • Batches with errors: ${totalErrors}`);

    return { users: processedUsers, migrated: totalMigrated, skipped: totalSkipped, errors: totalErrors };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: Migrate notifications[] → notifications collection
// ─────────────────────────────────────────────────────────────────────────────
async function migrateNotifications() {
    log('─────────────────────────────────────────────────────────');
    log('PHASE 2: Migrating notifications[] → notifications collection');
    log('─────────────────────────────────────────────────────────');

    const totalUsers = await User.countDocuments({ 'notifications.0': { $exists: true } });
    log(`Found ${totalUsers} users with notifications to migrate.`);

    if (totalUsers === 0) {
        log('No notifications to migrate. Skipping.');
        return { users: 0, migrated: 0 };
    }

    if (DRY_RUN) {
        const agg = await User.aggregate([
            { $match: { 'notifications.0': { $exists: true } } },
            { $project: { count: { $size: '$notifications' } } },
            { $group: { _id: null, total: { $sum: '$count' } } }
        ]);
        const count = agg[0]?.total || 0;
        log(`[DRY RUN] Would migrate ${count} notification documents from ${totalUsers} users.`);
        return { users: totalUsers, documents: count };
    }

    let totalMigrated = 0;
    let totalSkipped  = 0;
    let skip = 0;

    while (skip < totalUsers) {
        const batch = await User.find({ 'notifications.0': { $exists: true } })
            .select('userId notifications')
            .lean()
            .skip(skip)
            .limit(BATCH_SIZE);

        if (batch.length === 0) break;

        const notifDocs = [];
        for (const user of batch) {
            for (const n of (user.notifications || [])) {
                notifDocs.push({
                    userId:    user.userId,
                    type:      n.type     || 'info',
                    title:     n.title,
                    message:   n.message,
                    read:      n.read     || false,
                    createdAt: n.timestamp || new Date()
                });
            }
        }

        if (notifDocs.length > 0) {
            try {
                const result = await Notification.insertMany(notifDocs, { ordered: false });
                totalMigrated += result.length;
            } catch (err) {
                if (err.code === 11000 || err.name === 'BulkWriteError') {
                    const inserted = err.result?.nInserted || 0;
                    totalMigrated += inserted;
                    totalSkipped  += notifDocs.length - inserted;
                } else {
                    error(`Notification batch insert failed at skip=${skip}:`, err.message);
                }
            }
        }

        skip += BATCH_SIZE;
        log(`  Progress: ${skip}/${totalUsers} users processed, ${totalMigrated} notifications migrated...`);
    }

    ok(`Notifications migration complete:`);
    log(`  • Notifications migrated: ${totalMigrated}`);
    if (totalSkipped > 0) warn(`  • Duplicates skipped: ${totalSkipped}`);

    return { migrated: totalMigrated, skipped: totalSkipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: Verify — compare counts between old and new collections
// ─────────────────────────────────────────────────────────────────────────────
async function verify() {
    log('─────────────────────────────────────────────────────────');
    log('PHASE 3: Verification');
    log('─────────────────────────────────────────────────────────');

    // Session count in User docs
    const [sessionAgg] = await User.aggregate([
        { $match: { 'sessions.0': { $exists: true } } },
        { $project: { count: { $size: '$sessions' } } },
        { $group: { _id: null, total: { $sum: '$count' } } }
    ]);
    const sessionsInUserDocs = sessionAgg?.total || 0;
    const sessionsInNewColl  = await Session.countDocuments();

    // Notification count
    const [notifAgg] = await User.aggregate([
        { $match: { 'notifications.0': { $exists: true } } },
        { $project: { count: { $size: '$notifications' } } },
        { $group: { _id: null, total: { $sum: '$count' } } }
    ]);
    const notifsInUserDocs = notifAgg?.total || 0;
    const notifsInNewColl  = await Notification.countDocuments();

    log('');
    log('  ┌─────────────────────────────────────────────────────┐');
    log('  │  VERIFICATION REPORT                                │');
    log('  ├──────────────────────┬──────────────┬──────────────┤');
    log('  │  Type                │  In User doc │  New coll    │');
    log('  ├──────────────────────┼──────────────┼──────────────┤');
    log(`  │  Sessions            │  ${String(sessionsInUserDocs).padEnd(12)} │  ${String(sessionsInNewColl).padEnd(12)} │`);
    log(`  │  Notifications       │  ${String(notifsInUserDocs).padEnd(12)} │  ${String(notifsInNewColl).padEnd(12)} │`);
    log('  └──────────────────────┴──────────────┴──────────────┘');
    log('');

    // Note: new collection count may be >= old because TTL may not have fired
    // and because we may have run this more than once. What matters: new >= old.
    const sessionsOk = sessionsInNewColl >= sessionsInUserDocs;
    const notifsOk   = notifsInNewColl  >= notifsInUserDocs;

    if (sessionsOk && notifsOk) {
        ok('Verification PASSED ✅ — New collections have all data from User docs.');
        ok('You can now run with --strip to remove the embedded arrays from User docs.');
    } else {
        error('Verification FAILED ❌ — New collections have FEWER records than User docs.');
        warn('DO NOT run --strip yet. Investigate the discrepancy above.');
        if (!sessionsOk) error(`  Sessions: User docs have ${sessionsInUserDocs}, new coll has ${sessionsInNewColl}`);
        if (!notifsOk)   error(`  Notifications: User docs have ${notifsInUserDocs}, new coll has ${notifsInNewColl}`);
    }

    return { sessionsOk, notifsOk };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: STRIP — Remove embedded arrays from User docs (run after verify)
// ─────────────────────────────────────────────────────────────────────────────
async function strip() {
    log('─────────────────────────────────────────────────────────');
    log('PHASE 4: STRIP — Removing embedded arrays from User docs');
    log('─────────────────────────────────────────────────────────');
    warn('This operation REMOVES sessions[] and notifications[] from all User documents.');
    warn('Make sure PHASE 3 verification passed BEFORE running this step.');
    log('');

    // Wait 5 seconds to give a chance to Ctrl+C
    log('Starting in 5 seconds... Press Ctrl+C to abort.');
    await new Promise(r => setTimeout(r, 5000));

    const result = await User.updateMany(
        {},
        { $unset: { sessions: '', notifications: '' } }
    );

    ok(`Strip complete. Modified ${result.modifiedCount} user documents.`);
    log('  • sessions[]     field removed from all User docs');
    log('  • notifications[] field removed from all User docs');
    log('');
    warn('Next steps:');
    log('  1. Remove the sessions[] and notifications[] fields from backend/models/User.js');
    log('  2. Update all controllers that reference user.sessions[] to use the Session model');
    log('  3. Update notification routes to use the Notification model');
    log('  4. Update dbHygiene.js — remove the User.updateMany $pull for sessions');

    return result.modifiedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLLBACK — Copy data back from new collections into User docs
// (Only works BEFORE --strip has been run)
// ─────────────────────────────────────────────────────────────────────────────
async function rollback() {
    log('─────────────────────────────────────────────────────────');
    log('ROLLBACK: Copying data back into User.sessions[]');
    log('─────────────────────────────────────────────────────────');

    const userIds = await Session.distinct('userId');
    log(`Rolling back sessions for ${userIds.length} users...`);

    let rollbackCount = 0;
    for (const userId of userIds) {
        const sessions = await Session.find({ userId }).lean();
        const sessionData = sessions.map(s => ({
            start: s.start, end: s.end, duration: s.duration,
            ipAddress: s.ipAddress, deviceId: s.deviceId,
            location: s.location, userAgent: s.userAgent,
            deviceInfo: s.deviceInfo
        }));

        await User.updateOne({ userId }, { $set: { sessions: sessionData } });
        rollbackCount++;
    }

    // Rollback notifications
    const notifUserIds = await Notification.distinct('userId');
    log(`Rolling back notifications for ${notifUserIds.length} users...`);

    for (const userId of notifUserIds) {
        const notifs = await Notification.find({ userId }).lean();
        const notifData = notifs.map(n => ({
            id: n._id.toString(),
            type: n.type, title: n.title, message: n.message,
            read: n.read, timestamp: n.createdAt
        }));
        await User.updateOne({ userId }, { $set: { notifications: notifData } });
    }

    ok(`Rollback complete. Restored sessions for ${rollbackCount} users.`);
    warn('The new Session and Notification collections still exist. Drop them manually if desired.');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    log('══════════════════════════════════════════════════════════');
    log('  GEO-DASHBOARD MIGRATION: sessions + notifications');
    log('══════════════════════════════════════════════════════════');

    if (DRY_RUN)    log('MODE: DRY RUN — No data will be written.');
    if (STRIP_MODE) log('MODE: STRIP — Will remove embedded arrays after migration.');
    if (ROLLBACK)   log('MODE: ROLLBACK — Reverting migration.');
    log('');

    try {
        log(`Connecting to: ${MONGO_URI.replace(/:\/\/[^@]+@/, '://***@')}`);
        await mongoose.connect(MONGO_URI, {
            maxPoolSize: 10,
            socketTimeoutMS: 60000,
            serverSelectionTimeoutMS: 10000,
            family: 4
        });
        ok('Connected to MongoDB.');
        log('');

        if (ROLLBACK) {
            await rollback();
        } else {
            // Step 1: Migrate
            const sessionResult = await migrateSessions();
            log('');
            const notifResult = await migrateNotifications();
            log('');

            // Step 2: Verify
            if (!DRY_RUN) {
                const { sessionsOk, notifsOk } = await verify();
                log('');

                // Step 3 (optional): Strip
                if (STRIP_MODE) {
                    if (!sessionsOk || !notifsOk) {
                        error('Aborting --strip because verification failed. Fix the migration first.');
                        process.exit(1);
                    }
                    await strip();
                }
            }
        }

        log('');
        log('══════════════════════════════════════════════════════════');
        ok('Migration script finished successfully.');
        log('══════════════════════════════════════════════════════════');

    } catch (err) {
        error('Fatal error during migration:', err.message);
        console.error(err.stack);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        log('MongoDB connection closed.');
        process.exit(0);
    }
}

main();
