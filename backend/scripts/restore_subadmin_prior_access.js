// One-time repair: sub-admins promoted before the fix lost the mouzas they had as
// normal users (promotion replaced tehsilAccess with the territory only).
// Their pre-promotion access is in the "promoted to sub-admin" history event
// (before.tehsilAccess). This adds back every earlier entry that is outside the
// current territory. Territory tehsils keep "all mouzas". Safe to run twice.
//
//   node scripts/restore_subadmin_prior_access.js          (dry run: shows what would change)
//   node scripts/restore_subadmin_prior_access.js --apply  (writes the changes)
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
    const apply = process.argv.includes('--apply');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const events = await db.collection('accountevents')
        .find({ type: 'PLAN_CHANGED', note: 'promoted to sub-admin' }).sort({ createdAt: 1 }).toArray();
    console.log(`${events.length} promotion event(s) found. Mode: ${apply ? 'APPLY' : 'dry run'}`);

    let fixed = 0;
    for (const ev of events) {
        const prior = ev.before?.tehsilAccess || [];
        const user = await db.collection('users').findOne({ userId: ev.userId, userType: 'subadmin' }, { projection: { userId: 1, tehsilAccess: 1 } });
        if (!user || !prior.length) continue;
        const have = new Map((user.tehsilAccess || []).map(e => [String(e.tehsil).toLowerCase(), e]));
        const add = [];
        for (const p of prior) {
            const key = String(p.tehsil || '').toLowerCase();
            if (!key) continue;
            const cur = have.get(key);
            if (!cur) add.push({ tehsil: p.tehsil, mouzas: p.mouzas || [], tempGrants: [] });
            // present already: territory entry ([] = all) or restored before -> nothing to do
        }
        if (!add.length) { console.log(`  ${user.userId}: nothing to restore`); continue; }
        console.log(`  ${user.userId}: restore ${add.map(a => `${a.tehsil} (${a.mouzas.length || 'all'} mouzas)`).join(', ')}`);
        if (apply) {
            await db.collection('users').updateOne({ _id: user._id }, { $push: { tehsilAccess: { $each: add } } });
        }
        fixed++;
    }
    console.log(`${fixed} sub-admin(s) ${apply ? 'restored' : 'would be restored (re-run with --apply)'}.`);
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
