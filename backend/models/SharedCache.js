const mongoose = require('mongoose');

/**
 * Cache shared by every server instance (pm2 cluster) when Redis is not
 * available: one document per key, removed by MongoDB when it expires.
 * Keeps statistics and other cached figures identical on every instance.
 */
const sharedCacheSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
    expiresAt: { type: Date, required: true }
}, { versionKey: false });

sharedCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SharedCache', sharedCacheSchema);
