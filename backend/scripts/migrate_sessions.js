const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ MONGO_URI is not defined in the environment variables.');
    process.exit(1);
}

// standalone Session schema for migration
const locationSchema = new mongoose.Schema({
    latitude: { type: Number },
    longitude: { type: Number },
    city: String,
    region: String,
    country: String,
    countryCode: String,
    timezone: String,
    isp: String,
    accuracy: Number,
    source: String
}, { _id: false });

const sessionSchema = new mongoose.Schema({
    userId:     { type: String, required: true },
    start:      { type: Date,   required: true },
    end:        { type: Date,   default: null },
    duration:   { type: Number },
    ipAddress:  { type: String },
    deviceId:   { type: String },
    location:   { type: locationSchema },
    userAgent:  { type: String },
    deviceInfo: {
        type:       { type: String, default: 'unknown' },
        deviceType: { type: String, default: 'Unknown' },
        os:         String,
        browser:    String,
        mobile:     Boolean
    }
});

const Session = mongoose.model('Session', sessionSchema);

async function runMigration() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB.');

        // Use raw MongoDB collection to read sessions even if removed from the User schema
        const usersCollection = mongoose.connection.db.collection('users');
        console.log('🔍 Fetching user documents...');
        const rawUsers = await usersCollection.find({}).toArray();

        let totalMigrated = 0;
        let totalSkipped = 0;
        
        console.log(`📦 Found ${rawUsers.length} user documents. Starting migration...`);

        for (const user of rawUsers) {
            const userId = user.userId;
            const sessions = user.sessions || [];

            if (!sessions.length) {
                continue;
            }

            console.log(`👤 Processing ${sessions.length} sessions for user: ${userId}`);

            const bulkOps = [];
            for (const sess of sessions) {
                if (!sess.start) continue;

                // Check for duplicate session to prevent double-inserting
                const alreadyExists = await Session.exists({ userId, start: sess.start });
                if (alreadyExists) {
                    totalSkipped++;
                    continue;
                }

                bulkOps.push({
                    userId,
                    start: sess.start,
                    end: sess.end || null,
                    duration: sess.duration,
                    ipAddress: sess.ipAddress,
                    deviceId: sess.deviceId,
                    location: sess.location,
                    userAgent: sess.userAgent,
                    deviceInfo: sess.deviceInfo
                });
            }

            if (bulkOps.length > 0) {
                await Session.insertMany(bulkOps, { ordered: false });
                totalMigrated += bulkOps.length;
            }
        }

        console.log('--- Migration Summary ---');
        console.log(`✅ Successfully Migrated Sessions: ${totalMigrated}`);
        console.log(`⏭️ Already Migrated (Skipped):      ${totalSkipped}`);
        console.log('-------------------------');

        // Optional: Clean up old embedded sessions array to save space in User docs
        // const cleanupResult = await usersCollection.updateMany({}, { $unset: { sessions: "" } });
        // console.log(`🧹 Cleaned up embedded sessions array in ${cleanupResult.modifiedCount} user documents.`);

    } catch (err) {
        console.error('❌ Migration failed with error:', err);
    } finally {
        await mongoose.disconnect();
        console.log('🚪 Disconnected from MongoDB.');
    }
}

runMigration();
