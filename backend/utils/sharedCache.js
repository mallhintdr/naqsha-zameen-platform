/**
 * Cache shared by ALL server instances (pm2 cluster workers).
 *
 * Every worker must see the same cached values, otherwise refreshing a page
 * shows different numbers depending on which worker answered. Storage:
 *   1. Redis, when it is running (fastest), else
 *   2. MongoDB (models/SharedCache, TTL-expired) — still shared by all workers.
 * A per-process memory copy is NEVER used for reads, so instances can't drift.
 */
const { getRedisClient, isRedisReady } = require('../services/redisClient');
const logger = require('./logger');

const mongoReady = () => {
    try { return require('mongoose').connection.readyState === 1; } catch { return false; }
};
const Store = () => require('../models/SharedCache');

/**
 * @param {string} namespace short prefix for keys, e.g. 'geo'
 * @param {number} ttlSeconds default TTL in seconds
 */
function createSharedCache(namespace, ttlSeconds) {
    const fullKey = (k) => `cache:${namespace}:${k}`;

    return {
        async get(k) {
            const redis = getRedisClient();
            if (redis && isRedisReady()) {
                try {
                    const val = await redis.get(fullKey(k));
                    return val !== null && val !== undefined ? JSON.parse(val) : undefined;
                } catch (err) {
                    logger.warn(`sharedCache(${namespace}): Redis get failed, using MongoDB`, { error: err.message });
                }
            }
            if (!mongoReady()) return undefined;
            try {
                const doc = await Store().findOne({ key: fullKey(k), expiresAt: { $gt: new Date() } }).lean();
                return doc ? doc.value : undefined;
            } catch (err) {
                logger.warn(`sharedCache(${namespace}): MongoDB get failed`, { error: err.message });
                return undefined;
            }
        },

        async set(k, value, ttl = ttlSeconds) {
            const redis = getRedisClient();
            if (redis && isRedisReady()) {
                try {
                    await redis.set(fullKey(k), JSON.stringify(value), 'EX', ttl);
                    return;
                } catch (err) {
                    logger.warn(`sharedCache(${namespace}): Redis set failed, using MongoDB`, { error: err.message });
                }
            }
            if (!mongoReady()) return;
            try {
                // Stored as JSON-safe data (dates become strings, same as with Redis).
                await Store().updateOne(
                    { key: fullKey(k) },
                    { $set: { value: JSON.parse(JSON.stringify(value)), expiresAt: new Date(Date.now() + ttl * 1000) } },
                    { upsert: true }
                );
            } catch (err) {
                logger.warn(`sharedCache(${namespace}): MongoDB set failed`, { error: err.message });
            }
        },

        /** Clears this namespace for ALL instances using non-blocking SCAN. */
        async flushAll() {
            const redis = getRedisClient();
            if (redis && isRedisReady()) {
                try {
                    const pattern = fullKey('*');
                    let cursor = '0';
                    do {
                        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                        cursor = nextCursor;
                        if (keys && keys.length) await redis.del(...keys);
                    } while (cursor !== '0');
                } catch (err) {
                    logger.warn(`sharedCache(${namespace}): Redis flush failed`, { error: err.message });
                }
            }
            if (mongoReady()) {
                await Store().deleteMany({ key: { $regex: `^cache:${namespace}:` } }).catch(() => {});
            }
        }
    };
}

module.exports = { createSharedCache };
