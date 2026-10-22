const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

// Get notification history
router.get('/api/notifications', isAuthenticated, asyncHandler(notificationController.getNotifications));

// Mark a notification as read
router.post('/api/notifications/:id/read', isAuthenticated, asyncHandler(notificationController.readNotification));

// Mark all as read
router.post('/api/notifications/read-all', isAuthenticated, asyncHandler(notificationController.readAllNotifications));

// Subscribe to Web Push
router.post('/api/notifications/subscribe', isAuthenticated, asyncHandler(notificationController.subscribePush));
router.post('/api/notifications/unsubscribe', isAuthenticated, asyncHandler(notificationController.unsubscribePush));
router.get('/api/notifications/vapid-public-key', asyncHandler(notificationController.vapidPublicKey));
// Admin / sub-admin: reply to the customer a notification is about
router.get('/api/notifications/:id/reply-info', isAuthenticated, asyncHandler(notificationController.replyInfo));
router.post('/api/notifications/:id/reply', isAuthenticated, asyncHandler(notificationController.replyToNotification));

// Clear all notifications
router.delete('/api/notifications', isAuthenticated, asyncHandler(notificationController.clearNotifications));

module.exports = router;
