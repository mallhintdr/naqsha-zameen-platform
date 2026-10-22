const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const GeoJson = require('../models/GeoJson');
const UserGeoAdjustment = require('../models/UserGeoAdjustment');
const User = require('../models/User');
const { getAllTehsilsAndMouzas } = require('../services/geoService');
const { getLinkedTehsils } = require('../services/tehsilAliasService');
const { shiftCoordinates } = require('../utils/geoUtils');
const { getRedisClient } = require('../services/redisClient');
const { createSharedCache } = require('../utils/sharedCache');
const logger = require('../utils/logger');

// Issue #9 & #14 / SCALE-04: Shared (Redis-backed, memory-fallback) cache for
// filesystem and DB lookups (5-minute TTL) — consistent across PM2 workers.
const geoCache = createSharedCache('geo', 300);

// Define data directories
const TILES_DIR = path.join(__dirname, '../data/tiles'); // Or public/Shajra Parcha
const PUBLIC_DIR = path.join(__dirname, '../data'); // Point to the secure backend data directory

// --- Helpers for Filesystem Discovery (Issue #9: cached + async) ---

// True when the folder holds at least one real (non-hidden, non-empty) file,
// directly or in sub-folders up to `depth` levels. Empty folders (e.g. made
// ahead of time by a data-prep script) must not show up as tehsils / mouzas.
const dirHasContent = async (dir, depth = 4) => {
    let entries;
    try { entries = await fsPromises.readdir(dir, { withFileTypes: true }); } catch { return false; }
    const visible = entries.filter(e => !e.name.startsWith('.') && !/^(thumbs\.db|desktop\.ini)$/i.test(e.name));
    for (const e of visible) {
        if (e.isFile()) {
            try { if ((await fsPromises.stat(path.join(dir, e.name))).size > 0) return true; } catch { /* skip */ }
        }
    }
    if (depth <= 0) return false;
    for (const e of visible) {
        if (e.isDirectory() && await dirHasContent(path.join(dir, e.name), depth - 1)) return true;
    }
    return false;
};

// PERF-05: Async filesystem helpers for cache misses
const listFilesystemDirs = async (parentPath) => {
    const cacheKey = `dirs2:${parentPath}`;
    const cached = await geoCache.get(cacheKey);
    if (cached) return cached;

    try {
        await fsPromises.access(parentPath);
        const entries = await fsPromises.readdir(parentPath, { withFileTypes: true });
        const candidates = entries
            .filter(d => d.isDirectory() && !d.name.toLowerCase().includes('-complete') && !d.name.startsWith('.'))
            .map(d => d.name);
        // Only folders that actually contain data.
        const keep = await Promise.all(candidates.map(name => dirHasContent(path.join(parentPath, name))));
        const result = candidates.filter((_, i) => keep[i]);
        await geoCache.set(cacheKey, result);
        return result;
    } catch (e) {
        return [];
    }
};

const listFilesystemGeoJsons = async (parentPath) => {
    const cacheKey = `geojsons:${parentPath}`;
    const cached = await geoCache.get(cacheKey);
    if (cached) return cached;

    try {
        await fsPromises.access(parentPath);
        const files = await fsPromises.readdir(parentPath);
        const result = files
            .filter(f => f.toLowerCase().endsWith('.geojson') && !f.toLowerCase().includes('-complete') && !f.startsWith('.'))
            .map(f => path.basename(f, path.extname(f)));
        await geoCache.set(cacheKey, result);
        return result;
    } catch (e) {
        return [];
    }
};

const listFilesystemPmtiles = async (parentPath) => {
    const cacheKey = `pmtiles:${parentPath}`;
    const cached = await geoCache.get(cacheKey);
    if (cached) return cached;

    try {
        await fsPromises.access(parentPath);
        const files = await fsPromises.readdir(parentPath);
        const result = files
            .filter(f => f.toLowerCase().endsWith('.pmtiles') && !f.toLowerCase().includes('-complete') && !f.startsWith('.'))
            .map(f => path.basename(f, path.extname(f)));
        await geoCache.set(cacheKey, result);
        return result;
    } catch (e) {
        return [];
    }
};

// SCALE-05: Mouza index sync — only writes if data actually changed
const syncMouzaIndex = async (tehsil, mouzas) => {
    try {
        const metadataDir = path.join(PUBLIC_DIR, 'Metadata', tehsil);
        await fsPromises.mkdir(metadataDir, { recursive: true });
        const indexPath = path.join(metadataDir, `${tehsil}-Mouza-Index.json`);

        let existing = [];
        try {
            const content = await fsPromises.readFile(indexPath, 'utf8');
            existing = JSON.parse(content);
        } catch (e) { }

        const merged = Array.from(new Set([...(Array.isArray(existing) ? existing : []), ...mouzas]))
            .filter(m => m && !m.toLowerCase().includes('-complete'))
            .sort((a, b) => a.localeCompare(b));
        
        // Only write to the filesystem if the data has actually changed
        if (JSON.stringify(merged) !== JSON.stringify(existing)) {
            await fsPromises.writeFile(indexPath, JSON.stringify(merged, null, 2));
        }
        
        return true;
    } catch (error) {
        logger.error(`Error syncing mouza index for ${tehsil}:`, { error: error.message, stack: error.stack });
        return false;
    }
};

// --- Controller Methods ---

exports.getTehsilList = async (req, res) => {
    try {
        // 1. Get from Database
        const dbData = await getAllTehsilsAndMouzas();
        const dbTehsils = dbData.map(item => item.tehsil);

        // 2. Scan Filesystem (JSON Murabba, Shajra Parcha & pmtiles)
        const [geoDirs, tileDirs, pmtilesDirs] = await Promise.all([
            listFilesystemDirs(path.join(PUBLIC_DIR, 'JSON Murabba')),
            listFilesystemDirs(path.join(PUBLIC_DIR, 'Shajra Parcha')),
            listFilesystemDirs(path.join(PUBLIC_DIR, 'pmtiles'))
        ]);

        // 3. Merge and deduplicate
        const allTehsils = Array.from(new Set([...dbTehsils, ...geoDirs, ...tileDirs, ...pmtilesDirs])).sort((a, b) => a.localeCompare(b));

        res.json(allTehsils);
    } catch (error) {
        logger.error('getTehsilList error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error fetching tehsil list' });
    }
};

exports.getMauzaList = async (req, res) => {
    try {
        const { tehsil } = req.params;
        const linkedTehsils = await getLinkedTehsils(tehsil);

        // 1. Get from Database for all linked tehsils
        const dbData = await getAllTehsilsAndMouzas();
        const dbMouzas = [];
        for (const tName of linkedTehsils) {
            const tehsilData = dbData.find(t => t.tehsil && t.tehsil.toLowerCase() === tName.toLowerCase());
            if (tehsilData && Array.isArray(tehsilData.mouzas)) {
                dbMouzas.push(...tehsilData.mouzas);
            }
        }

        // 2. Scan Filesystem (PERF-05: async) for all linked tehsils
        const geoNames = [];
        const tileNames = [];
        const pmtilesNames = [];

        await Promise.all(linkedTehsils.map(async (tName) => {
            const geoDir = path.join(PUBLIC_DIR, 'JSON Murabba', tName);
            const tileDir = path.join(PUBLIC_DIR, 'Shajra Parcha', tName);
            const pmtilesDir = path.join(PUBLIC_DIR, 'pmtiles', tName);

            const [geos, tiles, pmtiles] = await Promise.all([
                listFilesystemGeoJsons(geoDir),
                listFilesystemDirs(tileDir),
                listFilesystemPmtiles(pmtilesDir)
            ]);

            geoNames.push(...geos);
            tileNames.push(...tiles);
            pmtilesNames.push(...pmtiles);
        }));

        // 3. Merge and deduplicate
        const allMouzas = Array.from(new Set([...dbMouzas, ...geoNames, ...tileNames, ...pmtilesNames]))
            .filter(m => m && !m.toLowerCase().includes('-complete'))
            .sort((a, b) => a.localeCompare(b));

        // 4. Sync Static Index for all linked tehsils (async, fire-and-forget)
        if (allMouzas.length > 0) {
            linkedTehsils.forEach(tName => {
                syncMouzaIndex(tName, allMouzas).catch(() => {});
            });
        }

        if (allMouzas.length > 0) {
            return res.json(allMouzas);
        } else {
            res.status(404).json({ message: 'Mouzas not found for this tehsil' });
        }
    } catch (error) {
        logger.error('getMauzaList error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error fetching mouza list' });
    }
};

exports.serveGeoJson = async (req, res) => {
    try {
        const { tehsil, mauza } = req.params;
        const { getRedisClient, isRedisReady } = require('../services/redisClient');
        const redisClient = getRedisClient();
        const cacheKey = `geojson:${tehsil}:${mauza}`;
        
        if (redisClient && isRedisReady()) {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                return res.json(JSON.parse(cached));
            }
        }
        
        // SCALE-01: indexed exact match on lowercased mirrors instead of $regex/$in-of-regexes (COLLSCAN)
        const linkedTehsils = await getLinkedTehsils(tehsil);
        const linkedTehsilsLower = linkedTehsils.map(t => String(t).toLowerCase());
        const mauzaLower = String(mauza || '').toLowerCase();

        const geoJson = await GeoJson.findOne({
            tehsilLower: { $in: linkedTehsilsLower },
            mauzaLower
        });

        if (!geoJson) {
            return res.status(404).json({ message: 'GeoJSON not found' });
        }

        if (redisClient) {
            // Cache for 1 hour
            await redisClient.set(cacheKey, JSON.stringify(geoJson.data), 'EX', 3600);
        }

        // Set private browser caching for 5 minutes (LOW-03)
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.json(geoJson.data);
    } catch (error) {
        logger.error('serveGeoJson error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error serving GeoJSON' });
    }
};

exports.shiftGeoJson = async (req, res) => {
    try {
        const { tehsil, mauza } = req.params;
        const dx = parseFloat(req.body.dx);
        const dy = parseFloat(req.body.dy);

        if (isNaN(dx) || isNaN(dy) || !Number.isFinite(dx) || !Number.isFinite(dy)) {
            return res.status(400).json({ message: 'dx and dy must be valid finite numbers.' });
        }
        const MAX_SHIFT_METERS = 5000;
        if (Math.abs(dx) > MAX_SHIFT_METERS || Math.abs(dy) > MAX_SHIFT_METERS) {
            return res.status(400).json({ message: `Shift offsets exceed the maximum limit of ${MAX_SHIFT_METERS} meters.` });
        }

        // SCALE-01: indexed exact match on lowercased mirrors instead of $regex (COLLSCAN)
        const geoJson = await GeoJson.findOne({
            tehsilLower: String(tehsil || '').toLowerCase(),
            mauzaLower: String(mauza || '').toLowerCase()
        });
        if (!geoJson) return res.status(404).json({ message: 'GeoJSON not found' });

        // Apply shift to coordinates
        if (geoJson.data && geoJson.data.features) {
            geoJson.data.features.forEach(feature => {
                if (feature.geometry && feature.geometry.coordinates) {
                    feature.geometry.coordinates = shiftCoordinates(feature.geometry.coordinates, dx, dy);
                }
            });
            geoJson.markModified('data');
            await geoJson.save();
            
            // Sync with PMTiles global offset
            try {
                const referenceLat = 31.5497;
                const dLat = dy / 111320;
                const dLng = dx / (111320 * Math.cos(referenceLat * Math.PI / 180));

                const adjustment = await UserGeoAdjustment.findOne({ userId: 'GLOBAL', tehsil, mauza });
                const currentLatOffset = adjustment ? adjustment.latOffset : 0;
                const currentLngOffset = adjustment ? adjustment.lngOffset : 0;

                await UserGeoAdjustment.findOneAndUpdate(
                    { userId: 'GLOBAL', tehsil, mauza },
                    { 
                        latOffset: currentLatOffset + dLat, 
                        lngOffset: currentLngOffset + dLng,
                        updatedAt: new Date() 
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );
            } catch (syncErr) {
                logger.error('Failed to sync PMTiles global offset in shiftGeoJson:', { error: syncErr.message });
            }
            
            const { getRedisClient, isRedisReady } = require('../services/redisClient');
            const redisClient = getRedisClient();
            if (redisClient && isRedisReady()) {
                await redisClient.setex(`geojson:${tehsil}:${mauza}`, 86400, JSON.stringify(geoJson.data)); // 24 hour cache
            }
        }

        res.json({ success: true, message: 'GeoJSON shifted successfully' });
    } catch (error) {
        logger.error('shiftGeoJson error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error shifting GeoJSON' });
    }
};

exports.resetGeoJson = async (req, res) => {
    return res.status(501).json({ message: 'GeoJSON reset not implemented (requires original data source)' });
};

// --- PMTiles & Offsets ---

exports.getMouzaOffset = async (req, res) => {
    try {
        const { tehsil, mouza } = req.params;
        const userId = req.userId; // From isAuthenticated middleware
        
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const adjustment = await UserGeoAdjustment.findOne({ userId, tehsil, mauza: mouza });
        if (!adjustment) {
            return res.json({ latOffset: 0, lngOffset: 0 });
        }
        res.json({ latOffset: adjustment.latOffset, lngOffset: adjustment.lngOffset });
    } catch (error) {
        logger.error('getMouzaOffset error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error fetching offset' });
    }
};

exports.saveMouzaOffset = async (req, res) => {
    try {
        const { tehsil, mouza } = req.params;
        const latOffset = parseFloat(req.body.latOffset);
        const lngOffset = parseFloat(req.body.lngOffset);
        const userId = req.userId;

        if (!userId) return res.status(401).json({ message: 'Unauthorized' });
        if (isNaN(latOffset) || isNaN(lngOffset) || !Number.isFinite(latOffset) || !Number.isFinite(lngOffset)) {
            return res.status(400).json({ message: 'latOffset and lngOffset must be valid finite numbers.' });
        }
        const MAX_SHIFT_DEG = 0.05;
        if (Math.abs(latOffset) > MAX_SHIFT_DEG || Math.abs(lngOffset) > MAX_SHIFT_DEG) {
            return res.status(400).json({ message: `Offsets exceed the maximum limit of ${MAX_SHIFT_DEG} degrees.` });
        }

        if (latOffset === 0 && lngOffset === 0) {
            await UserGeoAdjustment.findOneAndDelete({ userId, tehsil, mauza: mouza });
            return res.json({ success: true, message: 'Offset reset successfully', latOffset: 0, lngOffset: 0 });
        }

        const adjustment = await UserGeoAdjustment.findOneAndUpdate(
            { userId, tehsil, mauza: mouza },
            { latOffset, lngOffset, updatedAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, message: 'Offset saved successfully', offset: { latOffset: adjustment.latOffset, lngOffset: adjustment.lngOffset, updatedAt: adjustment.updatedAt } });
    } catch (error) {
        logger.error('saveMouzaOffset error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error saving offset' });
    }
};


exports.resetPMTilesShift = async (req, res) => {
    try {
        const { tehsil, mouza } = req.params;
        const userId = req.userId;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        await UserGeoAdjustment.findOneAndDelete({ userId, tehsil, mauza: mouza });
        
        const offsets = { latOffset: 0, lngOffset: 0, updatedAt: new Date().toISOString() };
        res.json({ success: true, data: offsets });
    } catch (error) {
        logger.error('resetPMTilesShift error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error resetting PMTiles offset' });
    }
};

// --- Per-User Database Adjustments (New System) ---

/**
 * Fetch specific adjustment for a user and mouza from the database
 */
exports.getUserAdjustment = async (req, res) => {
    try {
        const { tehsil, mauza } = req.params;
        const userId = req.userId || req.user?.userId;

        let adjustment = null;
        if (userId) {
            adjustment = await UserGeoAdjustment.findOne({ userId, tehsil, mauza });
        }
        
        if (!adjustment) {
            // Fallback to GLOBAL adjustment
            adjustment = await UserGeoAdjustment.findOne({ userId: 'GLOBAL', tehsil, mauza });
        }

        if (!adjustment) {
            return res.json({ latOffset: 0, lngOffset: 0, isDefault: true });
        }

        res.json(adjustment);
    } catch (error) {
        logger.error('getUserAdjustment error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error fetching user adjustment' });
    }
};

/**
 * Save or Update specific adjustment for a user and mouza in the database
 */
exports.saveUserAdjustment = async (req, res) => {
    try {
        const { tehsil, mauza } = req.params;
        const latOffset = parseFloat(req.body.latOffset);
        const lngOffset = parseFloat(req.body.lngOffset);
        const userId = req.userId || req.user?.userId;

        if (isNaN(latOffset) || isNaN(lngOffset) || !Number.isFinite(latOffset) || !Number.isFinite(lngOffset)) {
            return res.status(400).json({ message: 'latOffset and lngOffset must be valid finite numbers.' });
        }
        const MAX_SHIFT_DEG = 0.05;
        if (Math.abs(latOffset) > MAX_SHIFT_DEG || Math.abs(lngOffset) > MAX_SHIFT_DEG) {
            return res.status(400).json({ message: `Offsets exceed the maximum limit of ${MAX_SHIFT_DEG} degrees.` });
        }

        // If unauthenticated guest, acknowledge offset so client stores in localStorage
        if (!userId && !req.user) {
            return res.json({
                success: true,
                message: 'Guest adjustment acknowledged',
                data: { userId: 'GUEST', tehsil, mauza, latOffset, lngOffset }
            });
        }

        const user = req.user || (await User.findOne({ userId }));
        const targetUserId = (user && user.userType === 'admin') ? 'GLOBAL' : (userId || user?.userId);

        const oldAdjustment = await UserGeoAdjustment.findOne({ userId: targetUserId, tehsil, mauza });
        const oldLat = oldAdjustment ? oldAdjustment.latOffset : 0;
        const oldLng = oldAdjustment ? oldAdjustment.lngOffset : 0;

        const dLat = latOffset - oldLat;
        const dLng = lngOffset - oldLng;

        const adjustment = await UserGeoAdjustment.findOneAndUpdate(
            { userId: targetUserId, tehsil, mauza },
            { 
                latOffset, 
                lngOffset, 
                updatedAt: new Date() 
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.json({ 
            success: true, 
            message: 'Adjustment saved to database', 
            data: adjustment 
        });
    } catch (error) {
        logger.error('saveUserAdjustment error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error saving user adjustment' });
    }
};

exports.resetUserAdjustment = async (req, res) => {
    try {
        const { tehsil, mauza } = req.params;
        const userId = req.userId || req.user?.userId;

        if (!userId && !req.user) {
            return res.json({ 
                success: true, 
                message: 'Guest adjustment reset',
                latOffset: 0,
                lngOffset: 0
            });
        }

        const user = req.user || (await User.findOne({ userId }));
        const isAdminUser = (user && user.userType === 'admin');

        if (isAdminUser) {
            await UserGeoAdjustment.deleteMany({ tehsil, mauza });
        } else {
            // Non-admin regular user: only delete their own adjustment
            await UserGeoAdjustment.findOneAndDelete({ userId, tehsil, mauza });
        }

        // Return global fallback offset if available
        const globalAdj = await UserGeoAdjustment.findOne({ userId: 'GLOBAL', tehsil, mauza });
        const fallbackLat = globalAdj ? globalAdj.latOffset : 0;
        const fallbackLng = globalAdj ? globalAdj.lngOffset : 0;

        res.json({ 
            success: true, 
            message: 'Adjustment reset successfully',
            latOffset: fallbackLat,
            lngOffset: fallbackLng
        });
    } catch (error) {
        logger.error('resetUserAdjustment error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error resetting user adjustment' });
    }
};


exports.serveShajraTile = async (req, res) => {
    try {
        const { tehsil, mouza, z, x, y } = req.params;
        const fileName = `${y}.png`;
        const linkedTehsils = await getLinkedTehsils(tehsil);

        // Helper for case-insensitive file system path matching (Async & Non-blocking)
        const findCaseInsensitivePath = async (baseDir, segments) => {
            let current = baseDir;
            for (const segment of segments) {
                try {
                    await fsPromises.access(current);
                } catch (e) {
                    return null;
                }
                const children = await fsPromises.readdir(current);
                const match = children.find(c => c.toLowerCase() === segment.toLowerCase());
                if (!match) return null;
                current = path.join(current, match);
            }
            return current;
        };

        for (const tName of linkedTehsils) {
            const exactTilePath = path.resolve(path.join(PUBLIC_DIR, 'Shajra Parcha', tName, mouza, z, x, fileName));
            if (exactTilePath.startsWith(path.resolve(PUBLIC_DIR))) {
                try {
                    await fsPromises.access(exactTilePath);
                    return res.sendFile(exactTilePath);
                } catch (e) {
                    // Fallback to case-insensitive check
                    const matched = await findCaseInsensitivePath(PUBLIC_DIR, ['Shajra Parcha', tName, mouza, z, x, fileName]);
                    if (matched && matched.startsWith(path.resolve(PUBLIC_DIR))) {
                        return res.sendFile(matched);
                    }
                }
            }

            const exactBackupPath = path.resolve(path.join(TILES_DIR, tName, mouza, z, x, fileName));
            if (exactBackupPath.startsWith(path.resolve(TILES_DIR))) {
                try {
                    await fsPromises.access(exactBackupPath);
                    return res.sendFile(exactBackupPath);
                } catch (e) {
                    // Fallback to case-insensitive check
                    const matched = await findCaseInsensitivePath(TILES_DIR, [tName, mouza, z, x, fileName]);
                    if (matched && matched.startsWith(path.resolve(TILES_DIR))) {
                        return res.sendFile(matched);
                    }
                }
            }
        }

        res.status(404).send('Tile not found');
    } catch (error) {
        logger.error('serveShajraTile error:', { error: error.message, stack: error.stack });
        res.status(500).send('Error serving tile');
    }
};

exports.servePMTiles = async (req, res) => {
    try {
        const { tehsil, mouza, murabba } = req.params;
        let fileName = `${mouza}.pmtiles`;
        if (murabba) {
            fileName = `${murabba}.pmtiles`;
        }

        // Every linked tehsil folder, ignoring upper / lower case.
        const { resolveLinkedFile } = require('../utils/linkedTehsilPath');
        const hit = await resolveLinkedFile(path.join(PUBLIC_DIR, 'pmtiles'), tehsil, [fileName]);
        if (hit && path.resolve(hit.file).startsWith(path.resolve(PUBLIC_DIR))) {
            return res.sendFile(hit.file);
        }

        const pmtilesPath2 = path.resolve(path.join(PUBLIC_DIR, 'pmtiles', fileName));
        if (pmtilesPath2.startsWith(path.resolve(PUBLIC_DIR))) {
            try {
                await fsPromises.access(pmtilesPath2);
                return res.sendFile(pmtilesPath2);
            } catch (e) { /* not found */ }
        }

        res.status(404).send('PMTiles not found');
    } catch (error) {
        logger.error('servePMTiles error:', { error: error.message, stack: error.stack });
        res.status(500).send('Error serving PMTiles');
    }
};

exports.ipLookup = async (req, res) => {
    try {
        if (!req.user || req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'Forbidden. Admin account required.' });
        }
        const { ip } = req.query;
        if (!ip) {
            return res.status(400).json({ message: 'IP address is required' });
        }

        if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
            return res.json({ city: 'Local Network', region: 'Local', country: 'Local', lat: 31.5204, lon: 74.3587 });
        }

        const geoip = require('geoip-lite');
        const geo = geoip.lookup(ip);
        if (!geo) {
            return res.json({ city: 'Unknown', region: 'Unknown', country: 'Pakistan', lat: 0, lon: 0 });
        }

        return res.json({
            city: geo.city || 'Unknown',
            region: geo.region || 'Unknown',
            country: geo.country || 'Pakistan',
            lat: geo.ll ? geo.ll[0] : 0,
            lon: geo.ll ? geo.ll[1] : 0
        });
    } catch (error) {
        logger.error('IP lookup error:', { error: error.message });
        res.status(500).json({ message: 'Error performing IP lookup' });
    }
};

exports.getShiftedMouzas = async (req, res) => {
    try {
        const { tehsil } = req.params;
        const userId = req.user.userId;
        
        // Find all adjustments for this tehsil
        const adjustments = await UserGeoAdjustment.find({ 
            tehsil,
            $or: [
                { userId },
                { userId: 'GLOBAL' }
            ]
        }).lean();
        
        // Filter those where offset is non-zero (meaning actually shifted/offset)
        const shifted = adjustments
            .filter(adj => adj.latOffset !== 0 || adj.lngOffset !== 0)
            .map(adj => adj.mauza);
            
        res.json(Array.from(new Set(shifted)));
    } catch (error) {
        logger.error('getShiftedMouzas error:', { error: error.message });
        res.status(500).json({ message: 'Error fetching shifted mouzas list' });
    }
};

exports.scanAndSyncHostingData = async (req, res) => {
    try {
        const adminUser = await User.findOne({ userId: req.user.userId });
        if (!adminUser || adminUser.userType !== 'admin') {
            return res.status(403).json({ message: 'Forbidden. Admin account required.' });
        }

        // 1. Scan filesystem for tehsils & mouzas
        const baseGeoDir = path.join(PUBLIC_DIR, 'JSON Murabba');
        const baseTileDir = path.join(PUBLIC_DIR, 'Shajra Parcha');
        const basePmtilesDir = path.join(PUBLIC_DIR, 'pmtiles');

        const [geoTehsils, tileTehsils, pmtilesTehsils] = await Promise.all([
            listFilesystemDirs(baseGeoDir),
            listFilesystemDirs(baseTileDir),
            listFilesystemDirs(basePmtilesDir)
        ]);

        const allTehsils = Array.from(new Set([...geoTehsils, ...tileTehsils, ...pmtilesTehsils]))
            .sort((a, b) => a.localeCompare(b));

        const tehsilAccess = [];
        let totalMouzasCount = 0;

        for (const tehsil of allTehsils) {
            // Find all mouzas in JSON Murabba, Shajra Parcha, and pmtiles folders for this tehsil
            const [geoNames, tileNames, pmtilesNames] = await Promise.all([
                listFilesystemGeoJsons(path.join(baseGeoDir, tehsil)),
                listFilesystemDirs(path.join(baseTileDir, tehsil)),
                listFilesystemPmtiles(path.join(basePmtilesDir, tehsil))
            ]);

            const allMouzas = Array.from(new Set([...geoNames, ...tileNames, ...pmtilesNames]))
                .filter(m => m && !m.toLowerCase().includes('-complete'))
                .sort((a, b) => a.localeCompare(b));

            if (allMouzas.length > 0) {
                tehsilAccess.push({
                    tehsil,
                    mouzas: allMouzas
                });
                totalMouzasCount += allMouzas.length;

                // Sync index file for this tehsil
                await syncMouzaIndex(tehsil, allMouzas).catch(() => {});

                // Upsert records into the database GeoJson collection
                // This ensures MongoDB contains these tehsils & mouzas, so ensureUserTehsilStateAsync maps them
                for (const mouza of allMouzas) {
                    await GeoJson.updateOne(
                        { tehsil, mauza: mouza },
                        {
                            $setOnInsert: {
                                data: { type: "FeatureCollection", features: [] }
                            },
                            // SCALE-01: updateOne bypasses the pre('save') hook, so set the
                            // lowercase mirrors explicitly to keep exact-match lookups correct.
                            $set: { tehsil, mauza: mouza, tehsilLower: tehsil.toLowerCase(), mauzaLower: mouza.toLowerCase() }
                        },
                        { upsert: true }
                    ).catch((e) => {
                        logger.error(`Failed to upsert GeoJson mapping for ${tehsil}/${mouza}: ${e.message}`);
                    });
                }
            }
        }

        // Purge any legacy -complete entries from GeoJson collection so they never appear in admin assignment or mouza lists
        await GeoJson.deleteMany({ mauza: { $regex: /-complete/i } }).catch(() => {});

        // Tehsil folders that exist but are empty (e.g. made ahead by a data-prep
        // script): remove the placeholder rows (no map features) an earlier sync
        // added for them, so they stop listing as tehsils. Only those tehsils are
        // touched; rows with real features, and tehsils served from R2/CDN only
        // (no local folder), are left alone.
        try {
            const rawDirs = async (p) => { try { return (await fsPromises.readdir(p, { withFileTypes: true })).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch { return []; } };
            const withData = new Set(tehsilAccess.map(t => t.tehsil.toLowerCase()));
            const emptyTehsils = [...new Set([...(await rawDirs(baseGeoDir)), ...(await rawDirs(baseTileDir)), ...(await rawDirs(basePmtilesDir))])]
                .filter(t => !withData.has(t.toLowerCase()));
            if (emptyTehsils.length) {
                const r = await GeoJson.deleteMany({ tehsilLower: { $in: emptyTehsils.map(t => t.toLowerCase()) }, 'data.features.0': { $exists: false } });
                if (r.deletedCount) logger.info('Removed placeholder rows of empty tehsil folders', { count: r.deletedCount, tehsils: emptyTehsils });
            }
        } catch (e) { logger.warn('Empty-folder placeholder cleanup failed', { error: e.message }); }

        // Invalidate database cache so lists refresh
        const geoService = require('../services/geoService');
        if (geoService && geoService.invalidateCache) {
            geoService.invalidateCache();
        }
        await geoCache.flushAll();

        // Save directly to admin user's account from the scanned filesystem structure (clean mouza names only)
        adminUser.tehsilAccess = tehsilAccess.map(t => ({
            tehsil: t.tehsil,
            mouzas: (t.mouzas || []).filter(m => !m.toLowerCase().includes('-complete'))
        }));
        if (tehsilAccess.length > 0 && !tehsilAccess.find(t => t.tehsil === adminUser.activeTehsil)) {
            adminUser.activeTehsil = tehsilAccess[0].tehsil;
        }

        adminUser.markModified('tehsilAccess');
        await adminUser.save();

        res.json({
            success: true,
            message: 'Hosting files scanned and admin account updated successfully.',
            stats: {
                tehsilsCount: tehsilAccess.length,
                mouzasCount: totalMouzasCount
            },
            tehsilAccess
        });

    } catch (error) {
        logger.error('scanAndSyncHostingData error:', { error: error.message, stack: error.stack });
        res.status(500).json({ message: 'Error scanning and syncing hosting data' });
    }
};
