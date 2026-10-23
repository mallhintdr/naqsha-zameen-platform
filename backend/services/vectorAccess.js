/**
 * Mouza-level entitlement for land-record vector data.
 *
 * parseVectorPath() maps a data URL (relative to its root) to { tehsil, mouza }
 * (mouza null = tehsil-wide file such as <Tehsil>-Mouza-Index.json).
 * isEntitled() decides whether a user may read that tehsil/mouza.
 */
const { getLinkedTehsils } = require('./tehsilAliasService');
const { vectorConfig } = require('./vectorConfig');

const lc = (s) => String(s ?? '').trim().toLowerCase();
/** Comparable mouza name: case/space-insensitive, file-name sanitising ignored. */
// Mirrors the data pipeline's file naming: "/" -> "-", [\\:*?"<>|] -> "_".
const normMouza = (s) => lc(s).replace(/-complete$/, '').replace(/\s+/g, ' ').replace(/\//g, '-').replace(/[\\:*?"<>|]/g, '_');

const MOUZA_SUFFIXES = ['-murabba.json', '-killa.json', '-metadata.json', '-complete.pmtiles', '.pmtiles', '.geojson', '.json'];

function stripSuffix(name) {
    const l = name.toLowerCase();
    for (const s of MOUZA_SUFFIXES) if (l.endsWith(s)) return name.slice(0, name.length - s.length);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * @param {string} reqPath path below the data root, e.g. "/Ali Pur/Chak 1/12.geojson"
 * @returns {{tehsil: string, mouza: string|null, file: string}|null}
 */
function parseVectorPath(reqPath) {
    let decoded;
    try { decoded = decodeURIComponent(reqPath || ''); } catch { return null; }
    const parts = decoded.split(/[\\/]/).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.some(p => p === '.' || p === '..')) return null;
    const tehsilWide = vectorConfig().tehsilWideFiles;
    if (parts.length === 1) {
        const f = parts[0];
        const tehsil = f.toLowerCase().endsWith('-mouza-index.json') ? f.slice(0, -17) : f;
        return { tehsil, mouza: null, file: f };
    }
    const tehsil = parts[0];
    const file = parts[parts.length - 1];
    if (parts.length === 2) {
        if (tehsilWide.test(file)) return { tehsil, mouza: null, file };
        return { tehsil, mouza: stripSuffix(file).replace(/-complete$/i, ''), file };
    }
    return { tehsil, mouza: parts[1].replace(/-complete$/i, ''), file };
}

/**
 * Effective access entries: valid temp grants added, expired ones removed.
 * `all` = whole tehsil (no permanent mouzas and no temp grants on the entry —
 * an entry that only ever held temp grants never widens to the whole tehsil
 * once they expire).
 */
function effectiveAccess(user, now = new Date()) {
    let raw = Array.isArray(user?.tehsilAccess) ? user.tehsilAccess : [];
    if (!raw.length && user?.tehsil) raw = [{ tehsil: user.tehsil, mouzas: user.mauzaList || [] }];
    return raw.filter(e => e && e.tehsil).map(e => {
        const grants = Array.isArray(e.tempGrants) ? e.tempGrants.filter(g => g && g.mouza) : [];
        const grantMouzas = new Set(grants.map(g => normMouza(g.mouza)));
        const permanent = (e.mouzas || []).map(String).filter(m => m.trim() && !lc(m).includes('-complete') && !grantMouzas.has(normMouza(m)));
        const valid = grants.filter(g => new Date(g.expiresAt) > now).map(g => String(g.mouza));
        const mouzas = new Set([...permanent, ...valid].map(normMouza));
        return { tehsil: String(e.tehsil), all: permanent.length === 0 && grants.length === 0, mouzas };
    });
}

/**
 * @param {object} user lean user ({ userType, tehsilAccess, tehsil?, mauzaList? })
 * @param {string} tehsil requested tehsil (any linked / group name, any case)
 * @param {string|null} mouza requested mouza, null for tehsil-wide files
 * @param {{ linked?: (t: string) => Promise<string[]>, now?: Date }} [opts]
 */
async function isEntitled(user, tehsil, mouza, opts = {}) {
    if (!user) return false;
    if (user.userType === 'admin') return true;
    if (!tehsil) return false;
    const linkedFn = opts.linked || getLinkedTehsils;
    const wanted = new Set(((await linkedFn(tehsil)) || []).concat(tehsil).map(lc));
    const entries = [];
    for (const e of effectiveAccess(user, opts.now)) {
        if (wanted.has(lc(e.tehsil))) { entries.push(e); continue; }
        // User holds a group/alias name whose members include the requested folder.
        const theirs = ((await linkedFn(e.tehsil)) || []).map(lc);
        if (theirs.includes(lc(tehsil))) entries.push(e);
    }
    if (!entries.length) return false;
    if (mouza === null || mouza === undefined) return true;
    const m = normMouza(mouza);
    return entries.some(e => e.all || e.mouzas.has(m));
}

module.exports = { parseVectorPath, isEntitled, effectiveAccess, normMouza };
