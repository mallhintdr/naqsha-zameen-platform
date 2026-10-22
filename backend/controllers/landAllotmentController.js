const LandAllotment = require('../models/LandAllotment');
const { getAllottedKillaGeometries } = require('../services/landAllotmentGeometryService');
const { buildKmz } = require('../services/kmzBuilderService');
const logger = require('../utils/logger');

const normalizeCnic = (raw) => String(raw || '').replace(/\D/g, '');

// Escape regex special characters to prevent ReDoS / broken patterns from
// stray user input (same helper pattern used in userController.js).
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FILTERABLE_FIELDS = {
    cnic: 'cnic',           // matched against the normalized digits-only field
    fullName: 'fullName',
    lotTehsil: 'lotTehsil',
    lotMauza: 'lotMauza',
    applicantTehsil: 'applicantTehsil',
    lotNumber: 'lotNumber',
    blockNo: 'blockNo',
    murabbaNo: 'murabbaNo',
    killaNo: 'killaNos'      // array field — Mongo regex matches if any element matches
};
const SORTABLE_FIELDS = new Set(['cnic', 'fullName', 'lotTehsil', 'lotMauza', 'applicantTehsil', 'lotNumber', 'blockNo', 'murabbaNo', 'createdAt']);

/**
 * GET /api/admin/land-allotments
 * Paginated, per-column-filterable listing of every allotment record — the
 * table view backing the admin tool's main list (filters are column-header
 * inputs on the frontend, one query param per filterable field above).
 */
exports.list = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const skip = (page - 1) * limit;

        const sortKey = SORTABLE_FIELDS.has(req.query.sortKey) ? req.query.sortKey : 'fullName';
        const sortDir = req.query.sortDir === 'desc' ? -1 : 1;

        const matchFilter = {};
        for (const [param, field] of Object.entries(FILTERABLE_FIELDS)) {
            const raw = (req.query[param] || '').trim();
            if (!raw) continue;
            if (param === 'cnic') {
                matchFilter.cnic = { $regex: escapeRegex(normalizeCnic(raw)), $options: 'i' };
            } else {
                matchFilter[field] = { $regex: escapeRegex(raw), $options: 'i' };
            }
        }

        const [results, total] = await Promise.all([
            LandAllotment.find(matchFilter)
                .sort({ [sortKey]: sortDir, _id: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            LandAllotment.countDocuments(matchFilter)
        ]);

        res.json({
            results,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        logger.error('landAllotment.list error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Failed to fetch allotment records' });
    }
};

/**
 * GET /api/admin/land-allotments/search?cnic=...  (exact, normalized)
 * GET /api/admin/land-allotments/search?name=...   (fallback partial search)
 */
exports.search = async (req, res) => {
    try {
        const { cnic, name } = req.query;

        if (cnic) {
            const normalized = normalizeCnic(cnic);
            if (normalized.length < 5) {
                return res.status(400).json({ message: 'Enter at least 5 digits of the CNIC.' });
            }
            const results = await LandAllotment.find({ cnic: normalized }).limit(20).lean();
            return res.json({ results });
        }

        if (name && name.trim().length >= 3) {
            const results = await LandAllotment.find(
                { $text: { $search: name.trim() } },
                { score: { $meta: 'textScore' } }
            ).sort({ score: { $meta: 'textScore' } }).limit(20).lean();
            return res.json({ results });
        }

        return res.status(400).json({ message: 'Provide a CNIC (or at least 3 characters of a name) to search.' });
    } catch (error) {
        logger.error('landAllotment.search error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Search failed' });
    }
};

/**
 * GET /api/admin/land-allotments/:id
 * Single record lookup — used before export to show a preview.
 */
exports.getById = async (req, res) => {
    try {
        const record = await LandAllotment.findById(req.params.id).lean();
        if (!record) return res.status(404).json({ message: 'Allotment record not found' });
        res.json({ record });
    } catch (error) {
        logger.error('landAllotment.getById error:', { error: error.message });
        res.status(500).json({ message: 'Failed to fetch record' });
    }
};

/**
 * GET /api/admin/land-allotments/:id/geometry
 * Returns the resolved killa GeoJSON features — used to render the map
 * preview in the admin tool before committing to a KMZ export.
 */
exports.getGeometry = async (req, res) => {
    try {
        const record = await LandAllotment.findById(req.params.id).lean();
        if (!record) return res.status(404).json({ message: 'Allotment record not found' });

        const result = getAllottedKillaGeometries({
            lotMauza: record.lotMauza,
            murabbaNo: record.murabbaNo,
            killaNos: record.killaNos
        });

        if (!result.ok) {
            return res.status(404).json({ message: result.reason });
        }

        res.json({
            type: 'FeatureCollection',
            features: result.killaFeatures,
            murabbaFeature: result.murabbaFeature
        });
    } catch (error) {
        logger.error('landAllotment.getGeometry error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Failed to resolve geometry' });
    }
};

/**
 * GET /api/admin/land-allotments/:id/export.kmz
 */
exports.exportKmz = async (req, res) => {
    try {
        const record = await LandAllotment.findById(req.params.id).lean();
        if (!record) return res.status(404).json({ message: 'Allotment record not found' });

        const result = getAllottedKillaGeometries({
            lotMauza: record.lotMauza,
            murabbaNo: record.murabbaNo,
            killaNos: record.killaNos
        });

        if (!result.ok) {
            return res.status(404).json({ message: result.reason });
        }

        const info = {
            mouza: record.lotMauza,
            murabbaNo: record.murabbaNo,
            killaNos: record.killaNos,
            allotteeName: record.fullName,
            cnic: record.cnicRaw || record.cnic
        };

        const kmzBuffer = await buildKmz(result.killaFeatures, info);

        // Filename structure: chak name_allottee name_CNIC.kmz
        const sanitize = (s) => String(s || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
        const chakName = sanitize(record.lotMauza);
        const allotteeName = sanitize(record.fullName);
        const cnicPart = sanitize(record.cnicRaw || record.cnic);
        const fileName = `${chakName}_${allotteeName}_${cnicPart}.kmz`;

        // Every export hits the exact same URL (/:id/export.kmz). Without an
        // explicit no-store, the browser's HTTP cache can serve back a stale
        // or incompletely-received prior response body for that URL instead
        // of re-requesting — producing a "new" download that is actually the
        // old (or a truncated) file. Always force a fresh fetch.
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Content-Type', 'application/vnd.google-earth.kmz');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Length', kmzBuffer.length);
        res.send(kmzBuffer);
    } catch (error) {
        logger.error('landAllotment.exportKmz error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Failed to generate KMZ' });
    }
};
