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
const { requireFullSubscription, requireMapAccess } = require('../middleware/mapAccess');
const layersFull = requireFullSubscription('saved-layers');
const landRecordsAccess = requireMapAccess({ requireFull: true });
router.post('/api/user-layers', isAuthenticated, layersFull, createUserLayerValidation, asyncHandler(layersController.createUserLayer));
router.get('/api/user-layers', isAuthenticated, layersFull, asyncHandler(layersController.getUserLayers));
router.put('/api/user-layers/:id', isAuthenticated, layersFull, updateUserLayerValidation, asyncHandler(layersController.updateUserLayer));
router.delete('/api/user-layers/:id', isAuthenticated, layerIdValidation, asyncHandler(layersController.deleteUserLayer));

// Land Records (requires full subscription and mouza entitlement)
router.get('/api/landrecords/tehsils', isAuthenticated, requireFullSubscription('land-records'), asyncHandler(landRecordController.getTehsils));
router.get('/api/landrecords/mauzas/:tehsil', isAuthenticated, requireFullSubscription('land-records'), asyncHandler(landRecordController.getMauzas));
router.get('/api/landrecords/khewats/:tehsil/:mauza', isAuthenticated, landRecordsAccess, asyncHandler(landRecordController.getKhewats));
router.get('/api/landrecords/details/:khewatId', isAuthenticated, requireFullSubscription('land-records'), recordDetailsValidation, asyncHandler(landRecordController.getRecordDetails));

module.exports = router;
