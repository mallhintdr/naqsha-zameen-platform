const winston = require('winston');
const path = require('path');

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'geo-dashboard-api' },
    transports: [
        // Error logs
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Security logs
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/security.log'),
            level: 'warn',
            maxsize: 5242880,
            maxFiles: 5,
        }),
        // Combined logs
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/combined.log'),
            maxsize: 5242880,
            maxFiles: 5,
        }),
    ],
});

// Console logging in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    return `[${timestamp}] ${level}: ${message}${metaStr}`;
                })
            ),
        })
    );
}

// Helper methods for common log patterns
logger.security = (message, meta = {}) => {
    logger.warn(message, { ...meta, type: 'security' });
};

logger.audit = (action, userId, meta = {}) => {
    logger.info(`AUDIT: ${action}`, {
        ...meta,
        userId,
        type: 'audit',
    });
};

module.exports = logger;
