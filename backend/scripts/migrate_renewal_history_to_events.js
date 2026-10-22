/**
 * One-time (safe to re-run) copy of every user's renewalHistory into the
 * permanent AccountEvent collection as RENEWED events (source: 'migrated').
 *
 * Each migrated event gets a deterministic requestKey, so running this again
 * skips entries already copied instead of duplicating them.
 *
 * Usage (take a mongodump first):
 *   node scripts/migrate_renewal_history_to_events.js           -> migrate
 *   node scripts/migrate_renewal_history_to_events.js --dry-run -> count only
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
    await mongoose.connect(process.env.MONGO_URI, { family: 4 });
    const User = require('../models/User');
    const AccountEvent = require('../models/AccountEvent');
    const { renewalKey, isRevenuePlan } = require('../services/accountEventService');
    await AccountEvent.syncIndexes();

    const cursor = User.find({ 'renewalHistory.0': { $exists: true } })
        .select('userId managedBy fee subscriptionType renewalHistory')
        .lean()
        .cursor();

    let users = 0, entries = 0, inserted = 0, skipped = 0;
    let batch = [];

    const flush = async () => {
        if (!batch.length || DRY_RUN) { batch = []; return; }
        try {
            const res = await AccountEvent.insertMany(batch, { ordered: false });
            inserted += res.length;
        } catch (err) {
            // Duplicate keys = already migrated; count the rest as inserted.
            const okCount = err.insertedDocs ? err.insertedDocs.length : (err.result?.insertedCount || 0);
            inserted += okCount;
            const dupes = (err.writeErrors || []).filter(e => (e.code || e.err?.code) === 11000).length;
            skipped += dupes;
            const other = (err.writeErrors || []).length - dupes;
            if (other > 0) throw err;
        }
        batch = [];
    };

    for await (const u of cursor) {
        users++;
        for (const r of u.renewalHistory) {
            entries++;
            if (!r || !r.date) continue;
            batch.push({
                userId: u.userId,
                ownerAtEvent: u.managedBy || null,
                actorId: null,
                actorRole: 'system',
                type: 'RENEWED',
                // Both old screens fall back to the user's current plan when none was recorded.
                plan: r.type || u.subscriptionType,
                previousPlan: r.previousSubscriptionType,
                previousPeriodStart: r.previousStartDate,
                previousPeriodEnd: r.previousEndDate,
                // Keep exactly what was recorded; an entry with no amount stays null,
                // with the user's fee kept as an estimate (what the Renewals tab shows).
                paymentAmount: typeof r.paymentAmount === 'number' ? r.paymentAmount : null,
                estimatedAmount: typeof r.paymentAmount === 'number'
                    ? undefined
                    : (isRevenuePlan(r.type || u.subscriptionType) ? (u.fee || 0) : 0),
                source: 'migrated',
                // Same key format as live renewals (accountEventService.renewalKey),
                // so entries already recorded live are never copied a second time.
                requestKey: renewalKey(u.userId, r.date, r.type),
                createdAt: new Date(r.date)
            });
            if (batch.length >= 500) await flush();
        }
    }
    await flush();

    console.log(JSON.stringify({ dryRun: DRY_RUN, usersWithHistory: users, historyEntries: entries, inserted, alreadyMigrated: skipped }));
    await mongoose.connection.close();
    process.exit(0);
})().catch((e) => { console.error('Migration failed:', e); process.exit(1); });
