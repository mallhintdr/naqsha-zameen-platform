/**
 * landAllotmentGeometryService.js
 *
 * Given an allottee's { lotMauza, murabbaNo, killaNos }, produces the actual
 * killa polygon geometries for export.
 *
 * The estate GeoJSONs (backend/data/AKAR/*.geojson) only contain murabba-level
 * rectangles (no killa subdivision) — this mirrors the exact same approach
 * already used on the live map (src/components/Map/Core/Map/geoJsonTransform.js
 * `transformGeoJsonWithTurf`): take the murabba's 4 real-world corners and fit
 * the standard 25-killa (5x5) template grid into them via turf distance/
 * bearing/destination math, so the template's Killa "1".."25" polygons land
 * in their true real-world position and orientation.
 */
const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const { resolveEstateFile } = require('./estateFileResolver');
const logger = require('../utils/logger');

const MUSTATEEL_TEMPLATE_PATH = path.join(__dirname, '..', 'data', 'mustateel-template.json');
let cachedTemplate = null;
function loadMustateelTemplate() {
    if (!cachedTemplate) {
        cachedTemplate = JSON.parse(fs.readFileSync(MUSTATEEL_TEMPLATE_PATH, 'utf8'));
    }
    // Deep-clone every call — callers mutate feature geometry in place (same
    // pattern as the frontend's transformGeoJsonWithTurf).
    return JSON.parse(JSON.stringify(cachedTemplate));
}

/**
 * Ported 1:1 from geoJsonTransform.js's transformGeoJsonWithTurf — fits the
 * 25-cell (5x5) template grid into the real-world quadrilateral defined by
 * the murabba's 4 corners, in place, via turf distance/bearing/destination.
 */
function transformGeoJsonWithTurf(geojsonData, topLeft, topRight, bottomRight, bottomLeft) {
    const matrixSize = 5;
    const width = turf.distance(turf.point(topLeft), turf.point(topRight), { units: 'meters' });
    const height = turf.distance(turf.point(topLeft), turf.point(bottomLeft), { units: 'meters' });
    const cellWidth = width / matrixSize;
    const cellHeight = height / matrixSize;
    const bearingTop = turf.bearing(turf.point(topLeft), turf.point(topRight));
    const bearingLeft = turf.bearing(turf.point(topLeft), turf.point(bottomLeft));

    geojsonData.features.forEach((feature, index) => {
        const col = index % matrixSize;
        const row = Math.floor(index / matrixSize);
        const cellOrigin = turf.destination(
            turf.destination(turf.point(topLeft), col * cellWidth, bearingTop, { units: 'meters' }),
            row * cellHeight,
            bearingLeft,
            { units: 'meters' }
        );

        const cellTopLeft = cellOrigin;
        const cellTopRight = turf.destination(cellTopLeft, cellWidth, bearingTop, { units: 'meters' });
        const cellBottomLeft = turf.destination(cellTopLeft, cellHeight, bearingLeft, { units: 'meters' });
        const cellBottomRight = turf.destination(cellTopRight, cellHeight, bearingLeft, { units: 'meters' });

        feature.geometry.coordinates = [[
            cellTopLeft.geometry.coordinates,
            cellTopRight.geometry.coordinates,
            cellBottomRight.geometry.coordinates,
            cellBottomLeft.geometry.coordinates,
            cellTopLeft.geometry.coordinates
        ]];
    });

    return geojsonData;
}

const estateGeojsonCache = new Map(); // filePath -> parsed FeatureCollection
// Estate files replaced on disk: cleared on every instance with the data scan.
require('../utils/cacheBus').register('geo', () => estateGeojsonCache.clear());
function loadEstateGeojson(filePath) {
    if (estateGeojsonCache.has(filePath)) return estateGeojsonCache.get(filePath);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    estateGeojsonCache.set(filePath, data);
    return data;
}

/**
 * Resolves an allottee's killa geometries.
 * @returns {{ ok: true, killaFeatures: Array, murabbaFeature: object, fileName: string }
 *          | { ok: false, reason: string }}
 */
function getAllottedKillaGeometries({ lotMauza, murabbaNo, killaNos }) {
    try {
        return getAllottedKillaGeometriesInner({ lotMauza, murabbaNo, killaNos });
    } catch (e) {
        // Last-resort catch: any unexpected shape/edge case surfaces its real
        // message here instead of the controller's generic "Failed to
        // resolve geometry" 500, which gave no clue what actually broke.
        logger.error('landAllotmentGeometryService: unexpected error', { error: e.message, stack: e.stack, lotMauza, murabbaNo });
        return { ok: false, reason: `Unexpected error resolving geometry: ${e.message}` };
    }
}

function getAllottedKillaGeometriesInner({ lotMauza, murabbaNo, killaNos }) {
    const resolved = resolveEstateFile(lotMauza);
    if (!resolved) {
        return { ok: false, reason: `No estate geometry file found for "${lotMauza}" yet.` };
    }

    let estateGeojson;
    try {
        estateGeojson = loadEstateGeojson(resolved.filePath);
    } catch (e) {
        logger.error('landAllotmentGeometryService: failed to read estate geojson', { error: e.message, file: resolved.filePath });
        return { ok: false, reason: 'Estate geometry file could not be read.' };
    }

    const murabbaFeature = (estateGeojson.features || []).find(
        f => String(f.properties?.Murabba_No).trim() === String(murabbaNo).trim()
    );
    if (!murabbaFeature) {
        return { ok: false, reason: `Murabba "${murabbaNo}" not found in ${resolved.fileName}.` };
    }

    const geomType = murabbaFeature.geometry?.type;
    if (geomType !== 'Polygon') {
        return { ok: false, reason: `Murabba "${murabbaNo}" in ${resolved.fileName} has geometry type "${geomType}" — expected "Polygon".` };
    }

    const ring = murabbaFeature.geometry?.coordinates?.[0];
    if (!ring || ring.length < 4) {
        return { ok: false, reason: `Murabba "${murabbaNo}" has invalid geometry (ring has ${ring ? ring.length : 0} point(s), need at least 4).` };
    }
    // A valid ring corner is a [lon, lat] pair of finite numbers. Catches the
    // usual real-world causes of a bad export: string coordinates, swapped
    // lat/lon nesting, missing values, or [lon, lat, elevation] triples with
    // a non-numeric third element some GIS tools add.
    const isValidCorner = (pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]);
    const corners = ring.slice(0, 4);
    const badIndex = corners.findIndex(pt => !isValidCorner(pt));
    if (badIndex !== -1) {
        return {
            ok: false,
            reason: `Murabba "${murabbaNo}" in ${resolved.fileName} has a malformed corner coordinate at ring position ${badIndex}: ${JSON.stringify(corners[badIndex])}.`
        };
    }

    // Same corner order the frontend reads: [topLeft, topRight, bottomRight, bottomLeft]
    const [topLeft, topRight, bottomRight, bottomLeft] = corners;

    const template = loadMustateelTemplate();
    let transformed;
    try {
        transformed = transformGeoJsonWithTurf(template, topLeft, topRight, bottomRight, bottomLeft);
    } catch (e) {
        logger.error('landAllotmentGeometryService: turf transform failed', {
            error: e.message, stack: e.stack, lotMauza, murabbaNo, file: resolved.fileName,
            topLeft, topRight, bottomRight, bottomLeft
        });
        return { ok: false, reason: `Could not compute killa geometry for murabba "${murabbaNo}": ${e.message}` };
    }

    const wantedKillas = new Set((killaNos || []).map(k => String(k).trim()));
    const killaFeatures = transformed.features.filter(f => wantedKillas.has(String(f.properties.Killa).trim()));

    return { ok: true, killaFeatures, murabbaFeature, fileName: resolved.fileName };
}

module.exports = { getAllottedKillaGeometries, transformGeoJsonWithTurf };
