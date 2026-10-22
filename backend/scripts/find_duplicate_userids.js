/**
 * Diagnostic for the SCALE-01 migration's unique-index conflict: finds every
 * group of User documents whose `userId` values collide once lowercased
 * (e.g. "jhang.demo" vs "Jhang.Demo") — these are pre-existing duplicate
 * accounts in the data, not something the migration created. The migration
 * can't backfill `userIdLower` as a unique field until each group is
 * resolved (one kept, the other renamed/merged/deleted).
 *
 * Usage: node backend/scripts/find_duplicate_userids.js
 * Read-only — makes no changes.
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env'), override: false });

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('MONGO_URI is not defined in the environment variables.');
    process.exit(1);
}

async function run() {
    await mongoose.connect(MONGO_URI, { family: 4 });
    console.log('Connected to MongoDB');

    const users = mongoose.connection.db.collection('users');
    const groups = await users.aggregate([
        {
            $project: {
                userId: 1,
                userName: 1,
                createdAt: 1,
                lastLogin: 1,
                isActive: 1,
                subscriptionStatus: 1,
                lower: { $toLower: '$userId' }
            }
        },
        { $group: { _id: '$lower', accounts: { $push: '$$ROOT' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (groups.length === 0) {
        console.log('No case-only duplicate userIds found. The migration should run cleanly now.');
    } else {
        console.log(`Found ${groups.length} duplicate group(s):\n`);
        for (const g of groups) {
            console.log(`--- "${g._id}" (${g.count} accounts) ---`);
            for (const a of g.accounts) {
                console.log(`  _id=${a._id}  userId="${a.userId}"  userName="${a.userName || ''}"  isActive=${a.isActive}  subscriptionStatus=${a.subscriptionStatus || ''}  lastLogin=${a.lastLogin || 'never'}  createdAt=${a.createdAt || 'unknown'}`);
            }
        }
        console.log('\nResolve each group (e.g. rename or delete the stale duplicate) before re-running migrate_add_lowercase_fields.js.');
    }

    await mongoose.connection.close();
    process.exit(0);
}

run().catch((err) => {
    console.error('Diagnostic failed:', err);
    process.exit(1);
});
