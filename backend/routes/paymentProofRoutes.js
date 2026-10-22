const express = require('express');
const router = express.Router();
const proof = require('../controllers/paymentProofController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const { asyncHandler } = require('../middleware/errorHandler');

// Admin, or a sub-admin for their own customers; each handler checks access itself.
router.post('/api/payment-proofs', isAuthenticated, apiLimiter, asyncHandler(proof.create));
router.get('/api/payment-proofs', isAuthenticated, asyncHandler(proof.list));
router.get('/api/payment-proofs/:id/file', isAuthenticated, asyncHandler(proof.file));

module.exports = router;
