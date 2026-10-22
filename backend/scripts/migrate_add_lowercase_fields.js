/**
 * SCALE-01 migration: backfill `userIdLower` on User documents and
 * `tehsilLower`/`mauzaLower` on GeoJson documents.
 *
 * This must be run once BEFORE (or immediately after) deploying the model
 * changes that added these fields + unique/compound indexes, otherwise:
 *   - existing User docs will have userIdLower = undefined, so login /
 *     forgotPassword / impersonate / profile lookups will 404 for them
 *     until they save() again (which the pre-save hook would populate).
 *   - existing GeoJson docs will have tehsilLower/mauzaLower = undefined,
 *     so serveGeoJson / shiftGeoJson exact-match lookups will 404.
 *
 * Usage: node backend/scripts/migrate_add_lowercase_fields.js
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });
// Fall back to project-root .env (this repo keeps a root .env too)
dotenv.config({ path: path.join(__dirname, '../../.env'), override: false });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('❌ MONGO_URI is not defined in the environment variables.');
    process.exit(1);
}

async function run() {
    await mongoose.connect(MONGO_URI, { family: 4 });
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;

    // ── Users ────────────────────────────────────────────────────────────
    const users = db.collection('users');
    const userCursor = users.find(
        { $or: [{ userIdLower: { $exists: false } }, { userIdLower: null }] },
        { projection: { userId: 1 } }
    );

    // Unordered so that a duplicate-key conflict in one batch doesn't abort
    // the writes for every other (unrelated, non-conflicting) user in that
    // same batch of 500 — conflicts are collected and reported at the end
    // instead of crashing the whole migration.
    let userCount = 0;
    const userOps = [];
    const conflicts = [];

    const flushUserOps = async (ops) => {
        try {
            await users.bulkWrite(ops, { ordered: false });
        } catch (err) {
            // BulkWriteError still applies every non-conflicting write in the
            // batch; err.writeErrors lists just the ones that failed.
            const writeErrors = err.writeErrors || [];
            for (const we of writeErrors) {
                const failedOp = ops[we.index];
                conflicts.push(failedOp?.updateOne?.filter?._id);
            }
            if (writeErrors.length === 0) throw err; // not a partial bulk-write failure — rethrow
        }
    };

    while (await userCursor.hasNext()) {
        const doc = await userCursor.next();
        if (!doc.userId) continue;
        userOps.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: { userIdLower: String(doc.userId).toLowerCase() } }
            }
        });
        userCount++;
        if (userOps.length >= 500) {
            await flushUserOps(userOps.splice(0, userOps.length));
        }
    }
    if (userOps.length) await flushUserOps(userOps);
    console.log(`Users processed: ${userCount}`);
    if (conflicts.length) {
        console.log(`⚠️  ${conflicts.length} user(s) could NOT be backfilled due to a duplicate userIdLower (case-only duplicate userId already exists). Their _id: ${conflicts.join(', ')}`);
        console.log('   Run `node scripts/find_duplicate_userids.js` to see the full duplicate groups, resolve them (rename/merge/delete the stale account), then re-run this migration — it is safe to re-run.');
    }

    // ── GeoJson ──────────────────────────────────────────────────────────
    const geojsons = db.collection('geojsons');
    const geoCursor = geojsons.find(
        { $or: [{ tehsilLower: { $exists: false } }, { mauzaLower: { $exists: false } }] },
        { projection: { tehsil: 1, mauza: 1 } }
    );

    let geoCount = 0;
    const geoOps = [];
    while (await geoCursor.hasNext()) {
        const doc = await geoCursor.next();
        geoOps.push({
            updateOne: {
                filter: { _id: doc._id },
                update: {
                    $set: {
                        tehsilLower: String(doc.tehsil || '').toLowerCase(),
                        mauzaLower: String(doc.mauza || '').toLowerCase()
                    }
                }
            }
        });
        geoCount++;
        if (geoOps.length >= 500) {
            await geojsons.bulkWrite(geoOps.splice(0, geoOps.length));
        }
    }
    if (geoOps.length) await geojsons.bulkWrite(geoOps);
    console.log(`GeoJson docs backfilled: ${geoCount}`);

    // Ensure indexes declared on the schemas (unique userIdLower, compound tehsilLower+mauzaLower) exist.
    console.log('Syncing indexes...');
    const User = require('../models/User');
    const GeoJson = require('../models/GeoJson');
    try {
        await User.syncIndexes();
    } catch (err) {
        // If any conflicts weren't resolved yet, building the unique
        // userIdLower index fails too — the backfill work already done above
        // is still saved (this is a separate step), so report it instead of
        // treating the whole migration as failed.
        console.log(`⚠️  Could not build the unique userIdLower index yet: ${err.message}`);
        console.log('   This is expected if duplicate-key conflicts above are still unresolved. Resolve them and re-run this script to finish building the index.');
    }
    await GeoJson.syncIndexes();

    console.log('✅ Migration complete (see any warnings above).');
    await mongoose.connection.close();
    process.exit(0);
}

run().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
