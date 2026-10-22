const express = require('express');
const router = express.Router();
const landAllotmentController = require('../controllers/landAllotmentController');
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

// Admin-only — this data is sensitive (CNIC + land allotment details).
router.get('/api/admin/land-allotments', isAuthenticated, isAdmin, asyncHandler(landAllotmentController.list));
router.get('/api/admin/land-allotments/search', isAuthenticated, isAdmin, asyncHandler(landAllotmentController.search));
router.get('/api/admin/land-allotments/:id/geometry', isAuthenticated, isAdmin, asyncHandler(landAllotmentController.getGeometry));
router.get('/api/admin/land-allotments/:id/export.kmz', isAuthenticated, isAdmin, asyncHandler(landAllotmentController.exportKmz));
router.get('/api/admin/land-allotments/:id', isAuthenticated, isAdmin, asyncHandler(landAllotmentController.getById));

module.exports = router;
