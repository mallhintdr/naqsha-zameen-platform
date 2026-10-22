/**
 * estateFileResolver.js
 *
 * Maps a CSV/XLSX "LotMauza" estate name (e.g. "Chak No 248 DB") to the
 * actual .geojson file holding that estate's murabba boundaries.
 *
 * Real-world estate names are inconsistently punctuated ("Chak No.319(A)-HR",
 * "87/DNB", "Chak  No 150 DNB" — note the double space) so this is NOT a pure
 * regex problem. Resolution order:
 *   1. An explicit override in estate-file-map.json (authoritative, admin-editable)
 *   2. An exact (case-insensitive) filename match under the app's standard
 *      mouza-geojson location, backend/data/JSON Murabba/AKAR-Cholistan/ —
 *      the SAME convention/directory every other tehsil's mouza files
 *      already live in (backend/data/JSON Murabba/<Tehsil>/<Mouza>.geojson,
 *      served statically in server.js and scanned by geoController.js). New
 *      estate files should be dropped there, named exactly as the LotMauza
 *      value, e.g. "Chak No 248 DB.geojson" — no renaming needed.
 *   3. A legacy fallback: backend/data/AKAR/ with a normalized filename guess
 *      (kept only for the one estate — 239-DB.geojson — set up there before
 *      this resolver was aligned to the app's real JSON Murabba convention).
 *   4. null — caller must report "no geometry available for this estate yet"
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AKAR_DIR = path.join(DATA_DIR, 'AKAR'); // legacy location, kept for backward compat
const OVERRIDE_MAP_PATH = path.join(AKAR_DIR, 'estate-file-map.json');
const CHOLISTAN_MOUZA_DIR = path.join(DATA_DIR, 'JSON Murabba', 'AKAR-Cholistan');

let cachedLegacyFileList = null;
let cachedCholistanFileList = null;
let cachedOverrideMap = null;
// Directory listings are refreshed every 5 minutes (each pm2 instance keeps its own
// copy, so a file added after one instance cached its list was missed there).
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedAt = 0;

function listGeojsonFiles(dir) {
    try {
        return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.geojson'));
    } catch (e) {
        logger.warn(`estateFileResolver: failed to read directory ${dir}`, { error: e.message });
        return [];
    }
}

function loadOverrideMap() {
    if (cachedOverrideMap) return cachedOverrideMap;
    try {
        if (fs.existsSync(OVERRIDE_MAP_PATH)) {
            cachedOverrideMap = JSON.parse(fs.readFileSync(OVERRIDE_MAP_PATH, 'utf8'));
        } else {
            cachedOverrideMap = {};
        }
    } catch (e) {
        logger.error('estateFileResolver: failed to parse estate-file-map.json', { error: e.message });
        cachedOverrideMap = {};
    }
    return cachedOverrideMap;
}

/** Best-effort filename guess from a raw "Chak No ..." style estate name (legacy AKAR/ dir only). */
function normalizeToFilenameGuess(lotMauza) {
    let s = String(lotMauza || '').trim();
    s = s.replace(/^Chak\s*No\.?\s*/i, ''); // strip "Chak No" / "Chak No." prefix
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/\s+/g, '-'); // "239 DB" -> "239-DB"
    return s;
}

/**
 * Names to try for one estate: as stored, then with '/' replaced by '-'.
 * A '/' can't be in a file name, so estates such as "87/DNB" are saved on disk
 * as "87-DNB.geojson" while the database keeps "87/DNB".
 */
function nameVariants(lotMauza) {
    const raw = String(lotMauza || '').trim();
    const out = [raw];
    if (raw.includes('/')) {
        out.push(raw.replace(/\s*\/\s*/g, '-'));   // "87 / DNB" or "87/DNB" -> "87-DNB"
        out.push(raw.replace(/\//g, '-'));         // keep spaces as they are
    }
    return [...new Set(out)];
}

/**
 * @param {string} lotMauza
 * @returns {{ filePath: string, fileName: string } | null}
 */
function resolveEstateFile(lotMauza) {
    if (!lotMauza) return null;
    if (Date.now() - cachedAt > CACHE_TTL_MS) { invalidateCache(); cachedAt = Date.now(); }
    const found = findAll(lotMauza);
    if (found) return found;
    // Not found with the cached listing: re-read the folders once before giving up.
    invalidateCache(); cachedAt = Date.now();
    return findAll(lotMauza);
}

function findAll(lotMauza) {
    for (const name of nameVariants(lotMauza)) {
        const hit = resolveOne(name, lotMauza);
        if (hit) {
            if (name !== String(lotMauza).trim()) logger.info(`estateFileResolver: "${lotMauza}" found as "${hit.fileName}" ('/' replaced by '-')`);
            return hit;
        }
    }
    return null;
}

/** One lookup pass for a single name variant (override map keyed by the stored name). */
function resolveOne(lotMauza, storedName) {
    const overrides = loadOverrideMap();

    // 1. Explicit override (exact LotMauza string match) — may point at either
    //    the JSON Murabba/AKAR-Cholistan dir or the legacy AKAR/ dir.
    const overrideKey = overrides[lotMauza] ? lotMauza : (overrides[storedName] ? storedName : null);
    if (overrideKey) {
        const fileName = overrides[overrideKey];
        for (const dir of [CHOLISTAN_MOUZA_DIR, AKAR_DIR]) {
            const filePath = path.join(dir, fileName);
            if (fs.existsSync(filePath)) return { filePath, fileName };
        }
        logger.warn(`estateFileResolver: override maps "${lotMauza}" -> "${fileName}" but that file doesn't exist in either location`);
    }

    // 2. Standard location: backend/data/JSON Murabba/AKAR-Cholistan/<LotMauza>.geojson
    if (!cachedCholistanFileList) cachedCholistanFileList = listGeojsonFiles(CHOLISTAN_MOUZA_DIR);
    const wantedName = `${String(lotMauza).trim()}.geojson`;
    const cholistanMatch = cachedCholistanFileList.find(f => f.toLowerCase() === wantedName.toLowerCase());
    if (cholistanMatch) {
        return { filePath: path.join(CHOLISTAN_MOUZA_DIR, cholistanMatch), fileName: cholistanMatch };
    }

    // 3. Legacy AKAR/ dir, normalized-name guess (kept for 239-DB.geojson)
    if (!cachedLegacyFileList) cachedLegacyFileList = listGeojsonFiles(AKAR_DIR);
    const guess = `${normalizeToFilenameGuess(lotMauza)}.geojson`;
    const legacyMatch = cachedLegacyFileList.find(f => f.toLowerCase() === guess.toLowerCase());
    if (legacyMatch) {
        return { filePath: path.join(AKAR_DIR, legacyMatch), fileName: legacyMatch };
    }

    return null;
}

require('../utils/cacheBus').register('geo', () => invalidateCache());

/** Clears the cached directory listings / override map — call after adding new estate files. */
function invalidateCache() {
    cachedLegacyFileList = null;
    cachedCholistanFileList = null;
    cachedOverrideMap = null;
}

module.exports = { resolveEstateFile, invalidateCache, AKAR_DIR, CHOLISTAN_MOUZA_DIR };
