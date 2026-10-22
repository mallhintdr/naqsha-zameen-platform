const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

router.post('/api/admin/reports/generate', isAuthenticated, isAdmin, asyncHandler(reportController.generate));

module.exports = router;
