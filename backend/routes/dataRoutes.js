const express = require('express');
const router = express.Router();
const layersController = require('../controllers/layersController');
const landRecordController = require('../controllers/landRecordController');
const { isAuthenticated } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');
const {
    createUserLayerValidation,
    updateUserLayerValidation,
    layerIdValidation,
    recordDetailsValidation,
} = require('../middleware/validationMiddleware');

// User Layers: open / save need a full subscription (delete stays allowed).
const { requireFullSubscription } = require('../middleware/mapAccess');
const layersFull = requireFullSubscription('saved-layers');
router.post('/api/user-layers', isAuthenticated, layersFull, createUserLayerValidation, asyncHandler(layersController.createUserLayer));
router.get('/api/user-layers', isAuthenticated, layersFull, asyncHandler(layersController.getUserLayers));
router.put('/api/user-layers/:id', isAuthenticated, layersFull, updateUserLayerValidation, asyncHandler(layersController.updateUserLayer));
router.delete('/api/user-layers/:id', isAuthenticated, layerIdValidation, asyncHandler(layersController.deleteUserLayer));

// Land Records
router.get('/api/landrecords/tehsils', isAuthenticated, asyncHandler(landRecordController.getTehsils));
router.get('/api/landrecords/mauzas/:tehsil', isAuthenticated, asyncHandler(landRecordController.getMauzas));
router.get('/api/landrecords/khewats/:tehsil/:mauza', isAuthenticated, asyncHandler(landRecordController.getKhewats));
router.get('/api/landrecords/details/:khewatId', isAuthenticated, recordDetailsValidation, asyncHandler(landRecordController.getRecordDetails));

module.exports = router;
