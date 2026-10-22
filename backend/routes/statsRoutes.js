const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/stats', isAuthenticated, isAdmin, asyncHandler(statsController.getStats));
// Website visitor counter: the home page loads this 1×1 image
//   <img src="https://dashboard.naqsha-zameen.pk/api/visit.gif?p=home" width="1" height="1" alt="" style="position:absolute;left:-9999px">
// Public, no login; an image works from any site without CORS.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const { apiLimiter } = require('../middleware/rateLimiters');
router.get('/api/visit.gif', apiLimiter, async (req, res) => {
    try { await require('../services/visitorCounter').record(req, res, String(req.query.p || 'home').toLowerCase()); } catch (e) { /* never break the page */ }
    res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.end(PIXEL);
});
router.get('/stats/visitors', isAuthenticated, isAdmin, asyncHandler(async (req, res) => {
    res.json(await require('../services/visitorCounter').summary(String(req.query.p || 'home').toLowerCase()));
}));
router.get('/online-users', isAuthenticated, isAdmin, asyncHandler(statsController.getOnlineUsers));
router.get('/multi-device-users', isAuthenticated, isAdmin, asyncHandler(statsController.getMultiDeviceUsers));
router.get('/subscription-stats', isAuthenticated, isAdmin, asyncHandler(statsController.getSubscriptionStats));
router.get('/user-ip-history/:userId', isAuthenticated, isAdmin, asyncHandler(statsController.getUserIpHistory));

module.exports = router;
