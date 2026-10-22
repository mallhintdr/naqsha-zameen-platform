/**
 * Ownership and territory rules for sub-admins, in one place. Every
 * sub-admin endpoint goes through these; nothing the browser sends about
 * scope is trusted.
 */
const User = require('../models/User');
const { getLinkedTehsils } = require('./tehsilAliasService');

class ScopeError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

/** Query filter restricting to the sub-admin's own customers. */
const ownedUsersFilter = (req) => ({ managedBy: req.subAdmin.userId, userType: 'user' });

/**
 * Looks up one customer owned by this sub-admin. Throws a 404 for anyone
 * else's user, so the response never reveals that the user exists.
 */
async function findOwnedUser(req, userId) {
    const user = await User.findOne({ userIdLower: String(userId || '').toLowerCase(), ...ownedUsersFilter(req) });
    if (!user) throw new ScopeError('User not found', 404);
    return user;
}

/**
 * Territory restriction removed: sub-admins may work in every tehsil, like the
 * admin. Kept as a function so existing callers still work; any named tehsil passes.
 */
async function tehsilInTerritory(tehsil, territory) { // eslint-disable-line no-unused-vars
    return Boolean(String(tehsil || '').trim());
}

/** Old territory check, kept for reference/reporting only. */
async function tehsilInTerritoryStrict(tehsil, territory) {
    const wanted = String(tehsil || '').trim().toLowerCase();
    if (!wanted) return false;
    for (const t of territory || []) {
        const linked = await getLinkedTehsils(t);
        if (linked.some(l => String(l).toLowerCase() === wanted)) return true;
    }
    return false;
}

/** Distinct mouza count across all tehsils of an assignment. */
const countMouzas = (assignment) =>
    new Set((assignment || []).flatMap(a => (a.mouzas || []).map(m => `${String(a.tehsil).toLowerCase()}|${String(m).toLowerCase()}`))).size;

/** Normalises a raw assignment payload into [{ tehsil, mouzas[] }]. */
function normaliseAssignment(raw) {
    if (!Array.isArray(raw)) throw new ScopeError('Tehsil and mouza assignment must be a list.');
    const byTehsil = new Map();
    for (const entry of raw) {
        const tehsil = String(entry?.tehsil || '').trim();
        if (!tehsil) throw new ScopeError('Every assignment needs a tehsil.');
        const mouzas = Array.isArray(entry.mouzas) ? entry.mouzas.map(m => String(m).trim()).filter(Boolean) : [];
        const key = tehsil.toLowerCase();
        const existing = byTehsil.get(key) || { tehsil, mouzas: [] };
        for (const m of mouzas) if (!existing.mouzas.some(x => x.toLowerCase() === m.toLowerCase())) existing.mouzas.push(m);
        byTehsil.set(key, existing);
    }
    return [...byTehsil.values()];
}

/**
 * Validates what a sub-admin may assign and merges it with anything outside
 * their scope that is already on the user (kept untouched, read-only).
 *
 * @returns {{ merged: Array, inScope: Array, mouzaCount: number }}
 */
async function assertAssignmentAllowed({ subAdmin, requested, existing = [], maxMouzas }) {
    const inScope = normaliseAssignment(requested);
    if (!inScope.length) throw new ScopeError('Assign at least one tehsil with at least one mouza.');

    const akar = require('../utils/akarGuard');
    for (const a of inScope) {
        // AKAR chaks: only the admin may assign them.
        if (akar.isAkarTehsil(a.tehsil)) throw new ScopeError(akar.AKAR_MESSAGE, 403);
        if (!a.mouzas.length) {
            // An empty mouza list means "every mouza in the tehsil" — never allowed for sub-admins.
            throw new ScopeError(`Choose at least one mouza in ${a.tehsil}. Whole-tehsil access can only be given by the admin.`);
        }
        if (!(await tehsilInTerritory(a.tehsil, subAdmin.territory))) {
            throw new ScopeError(`${a.tehsil} is outside your territory.`, 403);
        }
    }

    // Parts of the current assignment outside this sub-admin's territory stay as they are.
    const outOfScope = [];
    for (const e of existing || []) {
        if (!(await tehsilInTerritory(e.tehsil, subAdmin.territory))) {
            outOfScope.push({ tehsil: e.tehsil, mouzas: [...(e.mouzas || [])], tempGrants: e.tempGrants || [] });
        }
    }

    const mouzaCount = countMouzas(inScope); // no upper limit on mouzas

    const merged = [
        ...inScope.map(a => {
            const prev = (existing || []).find(e => String(e.tehsil).toLowerCase() === a.tehsil.toLowerCase());
            return { tehsil: a.tehsil, mouzas: a.mouzas, tempGrants: prev?.tempGrants || [] };
        }),
        ...outOfScope.filter(o => !inScope.some(a => a.tehsil.toLowerCase() === String(o.tehsil).toLowerCase()))
    ];
    return { merged, inScope, mouzaCount };
}

/** In-scope mouza count of an existing assignment (used to price renewals). */
async function inScopeMouzaCount(subAdmin, access) {
    const own = [];
    for (const a of access || []) if (await tehsilInTerritory(a.tehsil, subAdmin.territory)) own.push(a);
    return countMouzas(own);
}

module.exports = {
    ScopeError, ownedUsersFilter, findOwnedUser, tehsilInTerritory, tehsilInTerritoryStrict, countMouzas,
    normaliseAssignment, assertAssignmentAllowed, inScopeMouzaCount
};
