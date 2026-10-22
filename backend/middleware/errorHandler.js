const logger = require('../utils/logger');

/**
 * Centralized error handler middleware
 * Logs errors and sends appropriate responses to clients
 */
const errorHandler = (err, req, res, next) => {
    // Log the full error server-side
    logger.error('Error occurred', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userId: req.user?.userId,
        requestId: req.id,
    });

    // Determine status code
    const statusCode = err.statusCode || err.status || 500;

    // Prepare error response
    const errorResponse = {
        error: process.env.NODE_ENV === 'production'
            ? 'An error occurred'
            : err.message,
        requestId: req.id,
    };

    // Add validation errors if present
    if (err.errors && Array.isArray(err.errors)) {
        errorResponse.errors = err.errors;
    }

    // Ensure CORS header is always present on error responses
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    // Send response
    res.status(statusCode).json(errorResponse);
};

/**
 * 404 handler for undefined routes
 */
const notFoundHandler = (req, res) => {
    // Ensure CORS header is always present even on 404s so the browser
    // can read the JSON error body instead of showing a silent CORS failure.
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.status(404).json({
        error: 'Route not found',
        path: req.path,
    });
};

/**
 * CQ-07: Async handler wrapper — catches rejected promises in async route
 * handlers and forwards them to Express's centralized error handler.
 * Usage: router.get('/path', asyncHandler(myController.method));
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler,
};
