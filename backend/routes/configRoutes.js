const express = require('express');
const router = express.Router();
const { isAuthenticated, isSelfOrAdmin } = require('../middleware/authMiddleware');
const configController = require('../controllers/configController');

// GET all config - maybe just public or admin? Registration limits info should probably be internal but we can expose it.
// Let's restrict it to admin for getting and setting.
router.get('/', isAuthenticated, isSelfOrAdmin, configController.getConfig);
router.put('/', isAuthenticated, isSelfOrAdmin, configController.updateConfig);

// A public endpoint to get specific public configs like 'limitsEnabled'
router.get('/public', configController.getPublicConfig);

module.exports = router;
