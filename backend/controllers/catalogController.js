/**
 * "All Mouzas" browsing (docs/PUBLIC-BROWSE-PLAN.md): the mouza list of a tehsil with the
 * caller's own mouzas marked, and today's preview usage. Names only, no map data.
 */
const logger = require('../utils/logger');
const { listMouzas, listTehsils } = require('./geoController');
const { effectiveAccess, normMouza } = require('../services/vectorAccess');
const { getLinkedTehsils } = require('../services/tehsilAliasService');
const { previewUsage } = require('../services/accessPolicy');
const { vectorConfig } = require('../services/vectorConfig');

const lc = (s) => String(s ?? '').trim().toLowerCase();

// GET /api/me/browse/tehsils
exports.tehsils = async (req, res) => {
    try {
        const all = await listTehsils();
        const own = new Set(effectiveAccess(req.user).map(e => lc(e.tehsil)));
        res.json({
            publicBrowse: vectorConfig().publicBrowse,
            tehsils: all.map(name => ({ name, own: own.has(lc(name)) })),
        });
    } catch (err) {
        logger.error('browse tehsils failed', { error: err.message });
        res.status(500).json({ message: 'Could not load the tehsil list' });
    }
};

// GET /api/me/browse/mouzas/:tehsil
exports.mouzas = async (req, res) => {
    try {
        const { tehsil } = req.params;
        const names = await listMouzas(tehsil);
        const isAdmin = req.user.userType === 'admin';
        const wanted = new Set(((await getLinkedTehsils(tehsil)) || []).concat(tehsil).map(lc));
        const entries = effectiveAccess(req.user).filter(e => wanted.has(lc(e.tehsil)));
        const whole = entries.some(e => e.all);
        const ownSet = new Set(entries.flatMap(e => [...e.mouzas]));
        const mouzas = names.map(name => ({ name, own: isAdmin || whole || ownSet.has(normMouza(name)) }));
        const usage = isAdmin ? { used: 0, limit: 0 } : await previewUsage(req.user);
        res.json({
            tehsil,
            publicBrowse: vectorConfig().publicBrowse,
            mouzas,
            preview: { used: usage.used, limit: usage.limit, left: Math.max(0, usage.limit - usage.used) },
        });
    } catch (err) {
        logger.error('browse mouzas failed', { error: err.message });
        res.status(500).json({ message: 'Could not load the mouza list' });
    }
};
