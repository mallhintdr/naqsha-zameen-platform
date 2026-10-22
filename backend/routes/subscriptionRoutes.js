const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscriptionController');
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

// Admin-only subscription activation routes
router.post('/api/subscriptions/:userId/activate-trial', isAuthenticated, isAdmin, asyncHandler(subscriptionController.activateTrialSubscription));
router.post('/api/subscriptions/:userId/activate-monthly', isAuthenticated, isAdmin, asyncHandler(subscriptionController.activateMonthlySubscription));
router.post('/api/subscriptions/:userId/activate', isAuthenticated, isAdmin, asyncHandler(subscriptionController.activateSubscription));

module.exports = router;
