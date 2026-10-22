const mongoose = require('mongoose');

/**
 * One physical device (phone / computer browser) an account has used.
 * Replaces counting IP addresses, which change with every network switch,
 * flight mode or carrier change. A device is recognised by:
 *   - deviceIds: the browser's stored device ID(s) (kept across "Clear Cache",
 *     also sent back by the server as a long-lived cookie), and
 *   - signature: a hash of the device's characteristics, used to re-attach a
 *     new ID to a known device when every stored ID was wiped.
 */
const deviceSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    deviceIds: { type: [String], default: [] },
    signature: { type: String, default: null },
    label: String,                       // e.g. "Android · Chrome · 1080×2400"
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    logins: { type: Number, default: 0 },
    ips: { type: [String], default: [] },   // networks used (info only, last 20)
    lastConcurrentAt: Date,              // last time another device was active at the same time
    concurrentCount: { type: Number, default: 0 },
    forgotten: { type: Boolean, default: false }   // admin "Forget device" (e.g. phone replaced)
}, { versionKey: false });

deviceSchema.index({ userId: 1, deviceIds: 1 });
deviceSchema.index({ userId: 1, signature: 1 });
deviceSchema.index({ userId: 1, lastSeen: -1 });

module.exports = mongoose.model('Device', deviceSchema);
