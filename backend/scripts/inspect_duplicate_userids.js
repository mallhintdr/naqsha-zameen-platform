/**
 * Follow-up to find_duplicate_userids.js: dumps full detail for the specific
 * userId values passed on the command line, so a human can judge which
 * account in a case-only-duplicate pair is the real/active one before
 * renaming or deleting the other. Read-only — makes no changes.
 *
 * Usage: node backend/scripts/inspect_duplicate_userids.js jhang.demo safdar.npt
 * (matches case-insensitively, so passing either casing works)
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
    const targets = process.argv.slice(2).map(s => s.toLowerCase());
    if (targets.length === 0) {
        console.error('Usage: node backend/scripts/inspect_duplicate_userids.js <userId1> [userId2 ...]');
        process.exit(1);
    }

    await mongoose.connect(MONGO_URI, { family: 4 });
    console.log('Connected to MongoDB\n');

    const users = mongoose.connection.db.collection('users');
    for (const target of targets) {
        const docs = await users.find({
            userId: { $regex: `^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
        }).toArray();

        console.log(`=== "${target}" (${docs.length} account(s)) ===`);
        for (const u of docs) {
            console.log(JSON.stringify({
                _id: u._id,
                userId: u.userId,
                userName: u.userName,
                email: u.email || null,
                mobileNumber: u.mobileNumber || null,
                status: u.status || null,
                subscriptionType: u.subscriptionType || null,
                startDate: u.startDate || null,
                endDate: u.endDate || null,
                userType: u.userType || null,
                registrationSource: u.registrationSource || null,
                tehsilAccessCount: (u.tehsilAccess || []).length,
                tehsilAccessNames: (u.tehsilAccess || []).map(t => t.tehsil),
                activeTehsil: u.activeTehsil || null,
                renewalCount: u.renewalCount || 0,
                lastActive: u.lastActive || null,
                profileEditedAt: u.profileEditedAt || null,
                createdAt: u.createdAt || null,
                updatedAt: u.updatedAt || null
            }, null, 2));
        }
        console.log('');
    }

    await mongoose.connection.close();
    process.exit(0);
}

run().catch((err) => {
    console.error('Inspection failed:', err);
    process.exit(1);
});
