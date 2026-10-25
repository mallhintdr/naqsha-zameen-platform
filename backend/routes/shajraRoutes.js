// Public Shajra Nasab tool (no login). CSRF-exempt in server.js; CORS allows the website.
const express = require('express');
const rateLimit = require('express-rate-limit');
const c = require('../controllers/shajraController');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
const limit = (windowMs, max, prefix) => rateLimit({
    windowMs, max, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
    ...require('../middleware/rateLimiters').makeStore?.(prefix),
});
const big = express.json({ limit: '320kb' });

router.post('/api/public/shajra/cases', limit(60 * 60e3, 30, 'rl:shajra:save:'), big, asyncHandler(c.saveCase));
router.get('/api/public/shajra/cases/:id', limit(15 * 60e3, 300, 'rl:shajra:get:'), asyncHandler(c.getCase));
router.get('/api/public/shajra/law/:policyVersion', limit(15 * 60e3, 300, 'rl:shajra:law:'), asyncHandler(c.law));
router.post('/api/public/shajra/pdf', limit(10 * 60e3, 10, 'rl:shajra:pdf:'), big, asyncHandler(c.pdf));

module.exports = router;
