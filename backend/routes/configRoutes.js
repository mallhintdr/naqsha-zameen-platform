const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');
const configController = require('../controllers/configController');

// Restrict getting and updating full system config to admins only.
router.get('/', isAuthenticated, isAdmin, configController.getConfig);
router.put('/', isAuthenticated, isAdmin, configController.updateConfig);

// A public endpoint to get specific public configs like 'limitsEnabled'
router.get('/public', configController.getPublicConfig);

module.exports = router;
