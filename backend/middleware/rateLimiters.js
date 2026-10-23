const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { getRedisClient, isRedisReady } = require('../services/redisClient');

// ─── Redis Store (shared across PM2 cluster workers) ────────────────────────
// Falls back to default in-memory store when Redis is disabled/unavailable.
// Gated on the same REDIS_ENABLED switch as the shared client (defaults to
// enabled so production is unchanged) — this avoids eager RedisStore.init()
// errors when running locally without a Redis server.
const REDIS_ENABLED = String(process.env.REDIS_ENABLED ?? 'true').toLowerCase() !== 'false';
let redisStoreFn = null;
if (REDIS_ENABLED) {
    try {
        const { RedisStore } = require('rate-limit-redis');

        redisStoreFn = (prefix) => new RedisStore({
            sendCommand: (...args) => {
                const client = getRedisClient();
                if (client && isRedisReady()) {
                    return client.call(...args);
                }
                return Promise.reject(new Error('Redis not ready'));
            },
            prefix
        });
    } catch (e) {
        logger.warn('Rate limiter: rate-limit-redis not loaded — using in-memory store');
    }
}

// ─── Fallback Store Class ────────────────────────────────────────────────────
// Wraps RedisStore and MemoryStore. If Redis is down/unavailable, it falls
// back to local memory store dynamically without crashing the request.
class FallbackStore {
    constructor(prefix) {
        this.prefix = prefix;
        this.memoryStore = new rateLimit.MemoryStore();
        if (redisStoreFn) {
            this.redisStore = redisStoreFn(prefix);
        }
    }

    async init(options) {
        this.memoryStore.init(options);
        if (this.redisStore) {
            try {
                await this.redisStore.init(options);
            } catch (err) {
                logger.warn(`Rate limiter: Redis store init failed for ${this.prefix}, using memory fallback initially. Error: ${err.message}`);
            }
        }
    }

    async increment(key) {
        if (this.redisStore && isRedisReady()) {
            try {
                return await this.redisStore.increment(key);
            } catch (err) {
                logger.error(`Rate limiter: Redis increment error for ${this.prefix}: ${err.message}. Falling back to memory.`);
            }
        }
        return this.memoryStore.increment(key);
    }

    async decrement(key) {
        if (this.redisStore && isRedisReady()) {
            try {
                return await this.redisStore.decrement(key);
            } catch (err) {
                logger.error(`Rate limiter: Redis decrement error for ${this.prefix}: ${err.message}.`);
            }
        }
        return this.memoryStore.decrement(key);
    }

    async resetKey(key) {
        if (this.redisStore && isRedisReady()) {
            try {
                return await this.redisStore.resetKey(key);
            } catch (err) {
                logger.error(`Rate limiter: Redis resetKey error for ${this.prefix}: ${err.message}.`);
            }
        }
        return this.memoryStore.resetKey(key);
    }
}

// Helper — returns store config
const makeStore = (prefix) => {
    return {
        store: new FallbackStore(prefix)
    };
};

// ─── Limiters ────────────────────────────────────────────────────────────────

// Strict limiter for login/admin requests
const limiterStrict = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Increased from 10 to prevent blocking valid users due to minor input/network errors
    skipSuccessfulRequests: true,
    skip: (req) => req.user?.userType === 'admin',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const userId = req.body?.userId || req.user?.userId || '';
        const cleanUser = String(userId).trim().toLowerCase();
        return `${req.ip}_${cleanUser}`;
    },
    validate: false,
    message: { message: 'Too many login attempts, please try again after 15 minutes' },
    ...makeStore('rl:login:')
});

const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    skip: (req) => req.user?.userType === 'admin',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many registration attempts. Please wait for one hour before registering another user.' },
    ...makeStore('rl:register:')
});

const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    skip: (req) => req.user?.userType === 'admin',
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many password reset requests, please try again later' },
    ...makeStore('rl:pwreset:')
});

const limiterGeo = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    skip: (req) => req.user?.userType === 'admin',
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests from this IP, please try again later' },
    ...makeStore('rl:geo:')
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    skip: (req) => req.user?.userType === 'admin',
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later' },
    ...makeStore('rl:api:')
});

// Per-sub-admin limit on write actions (create, renew, edit, resend...)
const subAdminWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `sa_${req.user?.userId || req.ip}`,
    validate: false,
    message: { message: 'Too many changes in a short time. Please wait a few minutes and try again.' },
    ...makeStore('rl:subadmin:')
});

// Per-user limits on minting signed PMTiles URLs (POST /api/pmtiles/signed-url[s]).
// A normal map session needs a few signatures per mouza plus a refresh every
// ~10 minutes per open file; bulk scraping needs thousands.
const makePmtilesSignLimiter = (name, windowMs, max) => rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `u_${String(req.user?.userId || req.ip).toLowerCase()}`,
    validate: false,
    message: { success: false, message: 'Too many map file requests. Please wait a minute and try again.', code: 'PMTILES_SIGN_RATE_LIMITED' },
    ...makeStore(`rl:pmsign:${name}:`)
});
const pmtilesSignLimiterMinute = makePmtilesSignLimiter('m', 60 * 1000, Number(process.env.PMTILES_SIGN_MAX_PER_MINUTE) || 120);
const pmtilesSignLimiterHour = makePmtilesSignLimiter('h', 60 * 60 * 1000, Number(process.env.PMTILES_SIGN_MAX_PER_HOUR) || 1500);

module.exports = {
    pmtilesSignLimiterMinute,
    pmtilesSignLimiterHour,
    subAdminWriteLimiter,
    limiterStrict,
    registrationLimiter,
    passwordResetLimiter,
    limiterGeo,
    apiLimiter
};
