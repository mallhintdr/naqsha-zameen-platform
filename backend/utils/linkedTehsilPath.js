// Linked (grouped) tehsils: a user may be assigned the group name, but the data
// lives in each original tehsil's own folder (data/<root>/<Tehsil>/…, and the
// same layout on R2). These helpers find the real folder for a request by
// trying every linked tehsil, ignoring upper / lower case (Linux is case-sensitive).
const fs = require('fs').promises;
const path = require('path');
const { getLinkedTehsils } = require('../services/tehsilAliasService');

const DATA_DIR = path.join(__dirname, '../data');
const ROOTS = ['pmtiles', 'JSON Murabba', 'Shajra Parcha', 'Metadata', 'tiles'];

// Small in-memory cache: "tehsil|mouza" -> real tehsil folder name.
const cache = new Map();
require('../utils/cacheBus').register('geo', () => cache.clear());
require('../utils/cacheBus').register('tehsilGroups', () => cache.clear());
const TTL = 10 * 60 * 1000;
const cached = (k) => { const c = cache.get(k); return c && Date.now() - c.at < TTL ? c.v : undefined; };
const remember = (k, v) => { cache.set(k, { v, at: Date.now() }); if (cache.size > 5000) cache.delete(cache.keys().next().value); return v; };

/** Case-insensitive walk from `base` through `segments`; returns the real path or null. */
async function matchPath(base, segments) {
    let cur = base;
    for (const seg of segments) {
        let children;
        try { children = await fs.readdir(cur); } catch { return null; }
        const hit = children.find(c => c === seg) || children.find(c => c.toLowerCase() === String(seg).toLowerCase());
        if (!hit) return null;
        cur = path.join(cur, hit);
    }
    return cur;
}

/**
 * Real file for <root>/<tehsil>/<rest…>, looking in every linked tehsil's folder.
 * Segments that start with the requested name (e.g. "<Group>-Mouza-Index.json")
 * are renamed for each linked tehsil too. Returns { file, tehsil, segments } or null.
 */
async function resolveLinkedFile(rootDir, tehsil, rest) {
    const linked = await getLinkedTehsils(tehsil);
    const names = [...new Set([tehsil, ...(linked || [])])];
    for (const t of names) {
        const segs = rest.map(s => (s.toLowerCase().startsWith(tehsil.toLowerCase() + '-') ? t + s.slice(tehsil.length) : s));
        const file = await matchPath(rootDir, [t, ...segs]);
        if (file) {
            try { if ((await fs.stat(file)).isFile()) return { file, tehsil: t, segments: [t, ...segs] }; } catch { /* next */ }
        }
    }
    return null;
}

/**
 * Which linked tehsil really holds this mouza (for R2 paths, map layers, etc.).
 * Local data folders first, then the database; falls back to the given name.
 */
async function resolveTehsilForMouza(tehsil, mouza) {
    if (!tehsil || !mouza) return tehsil;
    const key = `${tehsil.toLowerCase()}|${String(mouza).toLowerCase()}`;
    const c = cached(key); if (c) return c;
    const linked = await getLinkedTehsils(tehsil);
    if (!linked || linked.length <= 1) return remember(key, tehsil);

    for (const t of linked) {
        for (const root of ROOTS) {
            const base = path.join(DATA_DIR, root);
            if (await matchPath(base, [t, `${mouza}.pmtiles`]) || await matchPath(base, [t, `${mouza}.geojson`])
                || await matchPath(base, [t, mouza]) || await matchPath(base, [t, `${mouza}-Murabba.json`])) {
                const real = await matchPath(base, [t]);
                return remember(key, real ? path.basename(real) : t);
            }
        }
    }
    try {
        const GeoJson = require('../models/GeoJson');
        const row = await GeoJson.findOne({ tehsilLower: { $in: linked.map(t => t.toLowerCase()) }, mauzaLower: String(mouza).toLowerCase() }).select('tehsil').lean();
        if (row?.tehsil) return remember(key, row.tehsil);
    } catch { /* fall through */ }
    return remember(key, tehsil);
}

/**
 * Express middleware for a static data root: when /<tehsil>/… doesn't exist as
 * asked, rewrite the URL to the linked tehsil folder that has the file.
 */
function linkedTehsilRewrite(rootDir) {
    return async (req, res, next) => {
        try {
            const parts = decodeURIComponent(req.path).split(/[\\/]/).filter(Boolean);
            if (parts.length < 2) return next();
            const exact = path.resolve(rootDir, ...parts);
            if (!exact.startsWith(path.resolve(rootDir))) return next();
            try { await fs.access(exact); return next(); } catch { /* not there as asked */ }
            const hit = await resolveLinkedFile(rootDir, parts[0], parts.slice(1));
            if (hit && path.resolve(hit.file).startsWith(path.resolve(rootDir))) {
                const rel = path.relative(rootDir, hit.file).split(path.sep).map(encodeURIComponent).join('/');
                const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
                req.url = '/' + rel + q;
            }
            next();
        } catch (e) { next(); }
    };
}

module.exports = { resolveLinkedFile, resolveTehsilForMouza, linkedTehsilRewrite, matchPath, DATA_DIR };
