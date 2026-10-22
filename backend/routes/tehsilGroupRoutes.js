const express = require('express');
const router = express.Router();
const tehsilGroupController = require('../controllers/tehsilGroupController');
const { isAuthenticated, maybeAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/api/tehsil-groups', maybeAuthenticated, asyncHandler(tehsilGroupController.getGroups));
router.get('/api/admin/tehsil-groups', isAuthenticated, isAdmin, asyncHandler(tehsilGroupController.getGroups));
router.post('/api/admin/tehsil-groups', isAuthenticated, isAdmin, asyncHandler(tehsilGroupController.createGroup));
router.put('/api/admin/tehsil-groups/:id', isAuthenticated, isAdmin, asyncHandler(tehsilGroupController.updateGroup));
router.delete('/api/admin/tehsil-groups/:id', isAuthenticated, isAdmin, asyncHandler(tehsilGroupController.deleteGroup));

module.exports = router;
