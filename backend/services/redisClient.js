const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;

const initRedis = async () => {
    if (redisClient) return true;

    // Kill-switch for environments without Redis (e.g. local dev). Defaults to
    // enabled so production behaviour is unchanged; set REDIS_ENABLED=false to
    // run with in-memory fallbacks (rate limiter, no BullMQ, single-node socket).
    const enabled = String(process.env.REDIS_ENABLED ?? 'true').toLowerCase() !== 'false';
    if (!enabled) {
        logger.info('Redis disabled (REDIS_ENABLED=false) — using in-memory fallbacks');
        return false;
    }

    redisClient = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
        enableOfflineQueue: false,
        retryStrategy: (times) => {
            return Math.min(times * 50, 2000);
        }
    });

    redisClient.on('error', (err) => {
        // Suppress initial spam, but log severe errors occasionally
        if (err.code !== 'ECONNREFUSED') {
            logger.error('Redis error:', err);
        }
    });

    redisClient.on('connect', () => {
        logger.info('Shared Redis client connected');
    });

    // We don't await connect() here because ioredis connects automatically in the background
    // and handles reconnects seamlessly. This unblocks the server startup.
    return true;
};

const getRedisClient = () => redisClient;

const isRedisReady = () => {
    return redisClient && redisClient.status === 'ready';
};

module.exports = {
    initRedis,
    getRedisClient,
    isRedisReady
};
