// Customer mouza-change requests (customer asks; admin / owning sub-admin decides).
const express = require('express');
const router = express.Router();
const c = require('../controllers/assignmentRequestController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const { asyncHandler } = require('../middleware/errorHandler');

router.post('/api/me/assignment-requests', isAuthenticated, apiLimiter, asyncHandler(c.createMine));
router.get('/api/me/assignment-requests/current', isAuthenticated, asyncHandler(c.getMine));
router.delete('/api/me/assignment-requests/current', isAuthenticated, asyncHandler(c.cancelMine));

router.get('/api/assignment-requests', isAuthenticated, asyncHandler(c.listOpen));
router.get('/api/assignment-requests/user/:userId(*)', isAuthenticated, asyncHandler(c.pendingForUser));
router.post('/api/assignment-requests/:id/approve', isAuthenticated, asyncHandler(c.approve));
router.post('/api/assignment-requests/:id/confirm-payment', isAuthenticated, asyncHandler(c.confirmPayment));
router.post('/api/assignment-requests/:id/reject', isAuthenticated, asyncHandler(c.reject));

module.exports = router;
