const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');
const profileController = require('../controllers/profileController');
const { isAuthenticated, isAuthenticatedLight, isAdmin } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

// Heartbeat – lightweight ping and JWT check
router.all(['/heartbeat', '/api/heartbeat'], (req, res) => {
    return profileController.heartbeat(req, res);
});

// Admin-only location routes
router.get('/user-locations/:userId', isAuthenticated, isAdmin, asyncHandler(locationController.getUserLocations));
router.get('/location-heatmap', isAuthenticated, isAdmin, asyncHandler(locationController.getLocationHeatmap));
router.get('/location-stats', isAuthenticated, isAdmin, asyncHandler(locationController.getLocationStats));

module.exports = router;
