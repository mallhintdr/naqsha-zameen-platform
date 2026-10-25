const express = require('express');
const router = express.Router();
const geoController = require('../controllers/geoController');
const { isAuthenticated, maybeAuthenticated, isSubscribed, isSubscribedOrLimitedZoom, isAdmin } = require('../middleware/authMiddleware');
const { limiterGeo, apiLimiter, publicListLimiter, browseLimiter, pmtilesSignLimiterMinute, pmtilesSignLimiterHour } = require('../middleware/rateLimiters');
const signedPMTilesUrl = require('../middleware/signedPMTilesUrl');
const { vectorGuards } = require('../middleware/vectorDataGuard');
const { requireMapAccess } = require('../middleware/mapAccess');
const { pathParamValidation } = require('../middleware/validationMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/api/tehsil-list', maybeAuthenticated, publicListLimiter, asyncHandler(geoController.getTehsilList));
router.get('/api/mauza-list/:tehsil', maybeAuthenticated, publicListLimiter, pathParamValidation, asyncHandler(geoController.getMauzaList));
// "All Mouzas" browsing: lists with own mouzas marked + today's preview usage (names only).
const catalog = require('../controllers/catalogController');
router.get('/api/public/catalog', publicListLimiter, asyncHandler(catalog.publicCatalog));
router.get('/api/me/browse/tehsils', isAuthenticated, browseLimiter, asyncHandler(catalog.tehsils));
router.get('/api/me/browse/mouzas/:tehsil', isAuthenticated, browseLimiter, pathParamValidation, asyncHandler(catalog.mouzas));
router.get('/api/geojson/:tehsil/:mauza', isAuthenticated, requireMapAccess({ allowExpired: false }), limiterGeo, pathParamValidation, ...vectorGuards({ paramsFrom: 'params', tilesOnlyWhenExpired: true }), asyncHandler(geoController.serveGeoJson));
router.post('/api/geojson/:tehsil/:mauza/shift', isAuthenticated, isAdmin, isSubscribedOrLimitedZoom, limiterGeo, asyncHandler(geoController.shiftGeoJson));
router.post('/api/geojson/:tehsil/:mauza/reset', isAuthenticated, isAdmin, isSubscribedOrLimitedZoom, limiterGeo, asyncHandler(geoController.resetGeoJson));

// Mouza Offset (Unified for GeoJSON & PMTiles)
router.get('/api/offset/:tehsil/:mouza', isAuthenticated, asyncHandler(geoController.getMouzaOffset));
router.post('/api/offset/:tehsil/:mouza', isAuthenticated, isAdmin, asyncHandler(geoController.saveMouzaOffset));

// Database-backed Per-User Adjustments (New System)
router.get('/api/geo/adjustment/:tehsil/:mauza', maybeAuthenticated, asyncHandler(geoController.getUserAdjustment));
router.post('/api/geo/adjustment/:tehsil/:mauza', isAuthenticated, isSubscribed, asyncHandler(geoController.saveUserAdjustment));
router.delete('/api/geo/adjustment/:tehsil/:mauza', isAuthenticated, isSubscribed, pathParamValidation, asyncHandler(geoController.resetUserAdjustment));
router.get('/api/geo/shifted-mouzas/:tehsil', isAuthenticated, asyncHandler(geoController.getShiftedMouzas));

router.get('/api/shajra-tiles/:tehsil/:mouza/:z/:x/:y.png', isAuthenticated, requireMapAccess({ allowExpired: true }), pathParamValidation, asyncHandler(geoController.serveShajraTile));

router.get('/api/geo/ip-lookup', isAuthenticated, isAdmin, apiLimiter, asyncHandler(geoController.ipLookup));

// PMTiles
router.get('/pmtiles/:tehsil/:mouza.pmtiles', isAuthenticated, requireMapAccess({ allowExpired: true }), pathParamValidation, asyncHandler(geoController.servePMTiles));

// Signed Cloudflare-worker URLs (mouza entitlement is checked inside the handler)
router.post('/api/pmtiles/signed-url', isAuthenticated, requireMapAccess({ allowExpired: true }), pmtilesSignLimiterMinute, pmtilesSignLimiterHour, asyncHandler(signedPMTilesUrl.generateSignedUrlMiddleware));
router.post('/api/pmtiles/signed-urls', isAuthenticated, requireMapAccess({ allowExpired: true }), pmtilesSignLimiterMinute, pmtilesSignLimiterHour, asyncHandler(signedPMTilesUrl.generateBatchSignedUrlsMiddleware));

module.exports = router;
