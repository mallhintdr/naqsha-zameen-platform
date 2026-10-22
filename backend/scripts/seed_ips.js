const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const User = require('../models/User');

const seedIps = async () => {
    try {
        const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/geo-dashboard';
        console.log('Connecting to:', uri);
        await mongoose.connect(uri);
        console.log('Connected to MongoDB');

        const users = await User.find({ userType: { $ne: 'admin' } });
        console.log(`Found ${users.length} non-admin users`);

        for (const user of users) {
            const ipCount = Math.floor(Math.random() * 13) + 3; // 3 to 15
            console.log(`Seeding ${ipCount} unique IPs for user ${user.userId}`);

            const sessions = [];
            const now = new Date();
            
            // Determine a reasonable start date for sessions (current activation or last 30 days)
            let activationStart = user.startDate ? new Date(user.startDate) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            
            // If startDate is in the future (unlikely but safe), use 30 days ago
            if (activationStart > now) {
                activationStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            }

            // Generate unique IPs
            const uniqueIps = new Set();
            while (uniqueIps.size < ipCount) {
                uniqueIps.add(`${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`);
            }

            for (const ip of uniqueIps) {
                // Random date between activationStart and now
                const start = new Date(activationStart.getTime() + Math.random() * (now.getTime() - activationStart.getTime()));
                
                // Add a few sessions per IP to make it look realistic
                const sessionsForThisIp = Math.floor(Math.random() * 3) + 1;
                for (let j = 0; j < sessionsForThisIp; j++) {
                    const sessionStart = new Date(start.getTime() + Math.random() * 24 * 60 * 60 * 1000);
                    if (sessionStart > now) continue;

                    sessions.push({
                        ipAddress: ip,
                        start: sessionStart,
                        end: new Date(sessionStart.getTime() + Math.random() * 60 * 60 * 1000), 
                        duration: Math.floor(Math.random() * 60)
                    });
                }
            }

            // Limit to last 100 as per model logic
            user.sessions = sessions.sort((a, b) => b.start - a.start).slice(0, 100);
            await user.save();
        }

        console.log('Successfully seeded random IPs for testing.');
        process.exit(0);
    } catch (err) {
        console.error('Seeding failed:', err);
        process.exit(1);
    }
};

seedIps();
