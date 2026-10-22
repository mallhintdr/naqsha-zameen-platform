const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const profileController = require('../controllers/profileController');
const renewalController = require('../controllers/renewalController');
const authController = require('../controllers/authController');
const { isAuthenticated, isAuthenticatedLight, maybeAuthenticated, isAdmin, isSelfOrAdmin, isSelfAdminOrOwner, isAdminOrOwner } = require('../middleware/authMiddleware');
const { registerValidation, updateUserValidation, emailUpdateValidation, searchValidation, paginationValidation } = require('../middleware/validationMiddleware');
const { apiLimiter } = require('../middleware/rateLimiters');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/profile', isAuthenticated, asyncHandler(profileController.getProfile));
router.get('/api/profile', isAuthenticated, asyncHandler(profileController.getProfile));
// PERF-07: Heartbeat route moved to locationRoutes.js to avoid duplication
// Note: :userId(*) is used instead of :userId to allow dots in userIds (e.g. azhar.aziz.kpr).
// Express stops param matching at '.' by default, treating the rest as a file extension.

router.post('/api/users/:userId(*)/active-tehsil', isAuthenticated, isSelfOrAdmin, asyncHandler(profileController.updateActiveTehsil));
router.post('/api/users/:userId(*)/renew', isAuthenticated, isAdmin, asyncHandler(userController.renewSubscription));
router.post('/api/users/:userId(*)/email', isAuthenticated, isSelfOrAdmin, emailUpdateValidation, asyncHandler(profileController.updateEmail));


// Admin Only


router.get('/api/users', isAuthenticated, isAdmin, paginationValidation, asyncHandler(userController.getAllUsers));
router.get('/api/users/search', isAuthenticated, isAdmin, searchValidation, asyncHandler(userController.searchUsers));
router.post('/api/admin/users/register', isAuthenticated, isAdmin, registerValidation, asyncHandler(authController.adminRegister));
router.post('/api/users/:userId(*)/reset-default-password', isAuthenticated, isAdminOrOwner, asyncHandler(userController.resetDefaultPassword));
router.post('/api/users/:userId(*)/demo-links', isAuthenticated, isAdminOrOwner, asyncHandler(renewalController.createDemoLink));
router.post('/api/user-warning/:userId(*)', isAuthenticated, isAdmin, asyncHandler(userController.warnUser));
// Admin: forget one of a customer's devices (e.g. phone replaced) so it no longer counts.
router.post('/api/users/:userId(*)/devices/:deviceId/forget', isAuthenticated, isAdmin, asyncHandler(async (req, res) => {
    const Device = require('../models/Device');
    const r = await Device.updateOne({ _id: req.params.deviceId, userId: req.params.userId }, { $set: { forgotten: true } });
    if (!r.matchedCount) return res.status(404).json({ message: 'Device not found' });
    res.json({ message: 'Device forgotten.' });
}));

// Public — Issue #5: Rate-limited to mitigate user enumeration
router.get('/api/public/check-userid/:userId(*)', maybeAuthenticated, apiLimiter, asyncHandler(userController.checkUserIdExists));
// User calls this to generate a WhatsApp deep-link token (must be logged in)
router.post('/api/users/:userId(*)/renewal-token', isAuthenticated, apiLimiter, asyncHandler(renewalController.createRenewalToken));
// Admin resolves the token from the deep-link URL (admin only)
// Admin: any link. Sub-admin: only links from their own customers (checked in the controller).
router.get('/api/admin/resolve-token/:token', isAuthenticated, asyncHandler(renewalController.resolveRenewalToken));

// Generic User Routes (Must be at the bottom to avoid swallowing other /:userId(*)/... routes)
router.get('/api/users/:userId(*)/login-history', isAuthenticated, isSelfOrAdmin, asyncHandler(userController.getUserLoginHistory));
router.get('/api/users/:userId(*)/history', isAuthenticated, isAdmin, asyncHandler(userController.getUserHistory));
router.get('/api/users/:userId(*)', isAuthenticated, isSelfAdminOrOwner, asyncHandler(userController.getUserById));
router.put('/api/users/:userId(*)', isAuthenticated, isSelfAdminOrOwner, updateUserValidation, asyncHandler(userController.updateUser));
router.delete('/api/users/:userId(*)', isAuthenticated, isAdmin, asyncHandler(userController.deleteUser));

// Admin Tools: Sync and Scan Hosting Data
const geoController = require('../controllers/geoController');
router.post('/api/admin/scan-hosting', isAuthenticated, isAdmin, asyncHandler(geoController.scanAndSyncHostingData));

module.exports = router;
