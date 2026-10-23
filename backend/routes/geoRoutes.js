const express = require('express');
const router = express.Router();
const geoController = require('../controllers/geoController');
const { isAuthenticated, maybeAuthenticated, isSubscribed, isSubscribedOrLimitedZoom, isAdmin } = require('../middleware/authMiddleware');
const { limiterGeo, apiLimiter, pmtilesSignLimiterMinute, pmtilesSignLimiterHour } = require('../middleware/rateLimiters');
const signedPMTilesUrl = require('../middleware/signedPMTilesUrl');
const { pathParamValidation } = require('../middleware/validationMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/api/tehsil-list', maybeAuthenticated, apiLimiter, asyncHandler(geoController.getTehsilList));
router.get('/api/mauza-list/:tehsil', maybeAuthenticated, apiLimiter, pathParamValidation, asyncHandler(geoController.getMauzaList));
router.get('/api/geojson/:tehsil/:mauza', isAuthenticated, isSubscribedOrLimitedZoom, limiterGeo, pathParamValidation, asyncHandler(geoController.serveGeoJson));
router.post('/api/geojson/:tehsil/:mauza/shift', isAuthenticated, isAdmin, isSubscribedOrLimitedZoom, limiterGeo, asyncHandler(geoController.shiftGeoJson));
router.post('/api/geojson/:tehsil/:mauza/reset', isAuthenticated, isAdmin, isSubscribedOrLimitedZoom, limiterGeo, asyncHandler(geoController.resetGeoJson));

// Mouza Offset (Unified for GeoJSON & PMTiles)
router.get('/api/offset/:tehsil/:mouza', isAuthenticated, asyncHandler(geoController.getMouzaOffset));
router.post('/api/offset/:tehsil/:mouza', isAuthenticated, isAdmin, asyncHandler(geoController.saveMouzaOffset));

// Database-backed Per-User Adjustments (New System)
router.get('/api/geo/adjustment/:tehsil/:mauza', maybeAuthenticated, asyncHandler(geoController.getUserAdjustment));
router.post('/api/geo/adjustment/:tehsil/:mauza', isAuthenticated, isSubscribed, asyncHandler(geoController.saveUserAdjustment));
router.delete('/api/geo/adjustment/:tehsil/:mauza', isAuthenticated, isSubscribed, pathParamValidation, asyncHandler(geoController.resetUserAdjustment));
router.get('/api/geo/shifted-mouzas/:tehsil', maybeAuthenticated, asyncHandler(geoController.getShiftedMouzas));

router.get('/api/shajra-tiles/:tehsil/:mouza/:z/:x/:y.png', isAuthenticated, isSubscribedOrLimitedZoom, pathParamValidation, asyncHandler(geoController.serveShajraTile));

router.get('/api/geo/ip-lookup', isAuthenticated, isAdmin, apiLimiter, asyncHandler(geoController.ipLookup));

// PMTiles
router.get('/pmtiles/:tehsil/:mouza.pmtiles', isAuthenticated, isSubscribedOrLimitedZoom, pathParamValidation, asyncHandler(geoController.servePMTiles));

// Signed Cloudflare-worker URLs (mouza entitlement is checked inside the handler)
router.post('/api/pmtiles/signed-url', isAuthenticated, isSubscribedOrLimitedZoom, pmtilesSignLimiterMinute, pmtilesSignLimiterHour, asyncHandler(signedPMTilesUrl.generateSignedUrlMiddleware));
router.post('/api/pmtiles/signed-urls', isAuthenticated, isSubscribedOrLimitedZoom, pmtilesSignLimiterMinute, pmtilesSignLimiterHour, asyncHandler(signedPMTilesUrl.generateBatchSignedUrlsMiddleware));

module.exports = router;
