const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');
const profileController = require('../controllers/profileController');
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

// Heartbeat – lightweight ping with verified JWT check in profileController.heartbeat
router.all(['/heartbeat', '/api/heartbeat'], asyncHandler(profileController.heartbeat));

// Admin-only location routes
router.get('/user-locations/:userId', isAuthenticated, isAdmin, asyncHandler(locationController.getUserLocations));
router.get('/location-heatmap', isAuthenticated, isAdmin, asyncHandler(locationController.getLocationHeatmap));
router.get('/location-stats', isAuthenticated, isAdmin, asyncHandler(locationController.getLocationStats));

module.exports = router;
