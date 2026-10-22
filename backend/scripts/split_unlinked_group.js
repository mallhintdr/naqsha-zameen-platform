// Repair users still showing a tehsil group's name after the group was unlinked
// (unlinked before the automatic split existed). Give the group name, then the
// original tehsil names. Dry run unless --apply is added. Safe to run twice.
//
//   node scripts/split_unlinked_group.js --list
//        lists tehsil names saved on users that are not a real tehsil folder
//   node scripts/split_unlinked_group.js "Group Name" "Tehsil A" "Tehsil B"
//   node scripts/split_unlinked_group.js "Group Name" "Tehsil A" "Tehsil B" --apply
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

(async () => {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const names = args.filter(a => !a.startsWith('--'));
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

    if (args.includes('--list') || names.length < 3) {
        const dataDir = path.join(__dirname, '..', 'data');
        const real = new Set();
        ['JSON Murabba', 'pmtiles', 'Metadata', 'Shajra Parcha'].forEach(d => {
            try { fs.readdirSync(path.join(dataDir, d)).forEach(n => real.add(n.toLowerCase())); } catch {}
        });
        const groups = await mongoose.connection.db.collection('tehsilgroups').find({}).toArray();
        groups.forEach(g => real.add(String(g.canonicalName).toLowerCase()));
        const rows = await mongoose.connection.db.collection('users').aggregate([
            { $unwind: '$tehsilAccess' }, { $group: { _id: '$tehsilAccess.tehsil', users: { $sum: 1 } } }
        ]).toArray();
        const odd = rows.filter(r => r._id && !real.has(String(r._id).toLowerCase()));
        console.log(odd.length ? 'Tehsil names on users with no data folder (likely old group names):' : 'No unknown tehsil names found.');
        odd.forEach(r => console.log(`  "${r._id}"  (${r.users} user(s))`));
        if (names.length < 3) console.log('\nTo split one: node scripts/split_unlinked_group.js "Group Name" "Tehsil A" "Tehsil B" [--apply]');
        await mongoose.disconnect();
        return;
    }

    const [groupName, ...aliases] = names;
    if (!apply) {
        const n = await mongoose.connection.db.collection('users').countDocuments({ 'tehsilAccess.tehsil': new RegExp(`^${groupName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
        console.log(`Dry run: ${n} user(s) have "${groupName}" and would be split into: ${aliases.join(', ')}. Add --apply to do it.`);
    } else {
        const { splitGroupAccess } = require('../services/tehsilDisplayService');
        const r = await splitGroupAccess(groupName, aliases);
        console.log(`Done: ${r.users} user(s) and ${r.subAdmins} sub-admin territory(ies) updated.`);
    }
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
