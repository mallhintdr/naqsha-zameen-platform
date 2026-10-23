/**
 * Distinct-mouza-per-day quota for vector data, Redis-backed (shared across
 * PM2 workers) with an in-memory fallback when Redis is off or down — same
 * pattern as middleware/rateLimiters.js FallbackStore.
 */
const logger = require('../utils/logger');
const { getRedisClient, isRedisReady } = require('./redisClient');

const memory = new Map(); // key -> { set: Set<string>, exp: number }

function dayKey(now, tzOffsetMin) {
    return new Date(now.getTime() + tzOffsetMin * 60e3).toISOString().slice(0, 10);
}

function memTouch(key, member, max) {
    const now = Date.now();
    if (memory.size > 20000) for (const [k, v] of memory) if (v.exp < now) memory.delete(k);
    let e = memory.get(key);
    if (!e || e.exp < now) { e = { set: new Set(), exp: now + 2 * 86400e3 }; memory.set(key, e); }
    if (e.set.has(member)) return { allowed: true, count: e.set.size, isNew: false };
    if (e.set.size >= max) return { allowed: false, count: e.set.size, isNew: true };
    e.set.add(member);
    return { allowed: true, count: e.set.size, isNew: true };
}

/**
 * Records that `userId` opened `member` (e.g. "tehsil|mouza") today.
 * Already-opened mouzas are always allowed again; a new one is refused once
 * `max` distinct mouzas were opened today.
 * @returns {Promise<{allowed: boolean, count: number, isNew: boolean}>}
 */
async function touchDistinct(userId, member, max, { now = new Date(), tzOffsetMin = 300, scope = 'mouza' } = {}) {
    const key = `vq:${scope}:${String(userId).toLowerCase()}:${dayKey(now, tzOffsetMin)}`;
    const client = getRedisClient && getRedisClient();
    if (client && isRedisReady()) {
        try {
            const added = await client.sadd(key, member);
            const count = await client.scard(key);
            if (added) await client.expire(key, 2 * 86400);
            if (added && count > max) {
                await client.srem(key, member);
                return { allowed: false, count: count - 1, isNew: true };
            }
            return { allowed: true, count, isNew: Boolean(added) };
        } catch (err) {
            logger.error(`vectorQuota: Redis error, using memory: ${err.message}`);
        }
    }
    return memTouch(key, member, max);
}

const _resetMemory = () => memory.clear();

module.exports = { touchDistinct, dayKey, _resetMemory };
