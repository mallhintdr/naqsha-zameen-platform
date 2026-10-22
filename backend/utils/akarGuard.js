/**
 * AKAR (Cholistan state-land) chaks are high-value data: only the admin may give
 * a user access to them. Public sign-ups, sub-admins and customers' mouza-change
 * requests cannot add or change AKAR chaks.
 *
 * The AKAR tehsil is exactly "AKAR-Cholistan" (any capitalisation). Extra
 * names can be listed in AKAR_TEHSILS (comma-separated) in .env.
 */
const EXTRA = String(process.env.AKAR_TEHSILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const AKAR_MESSAGE = 'AKAR chaks can only be assigned by the admin. Please contact the admin for access.';

function isAkarTehsil(name) {
    const n = String(name || '').trim();
    if (!n) return false;
    return n.toLowerCase() === 'akar-cholistan' || EXTRA.includes(n.toLowerCase());
}

/** Any entry of a tehsil assignment list ([{ tehsil, mouzas }]) is AKAR. */
const hasAkar = (list) => (Array.isArray(list) ? list : []).some(e => isAkarTehsil(e && (e.tehsil || e)));

/** AKAR entries that differ between before and after (added, removed or changed mouzas). */
function akarChanged(before, after) {
    const key = (list) => JSON.stringify((Array.isArray(list) ? list : [])
        .filter(e => isAkarTehsil(e && e.tehsil))
        .map(e => [String(e.tehsil).toLowerCase(), [...(e.mouzas || [])].map(String).sort()])
        .sort());
    return key(before) !== key(after);
}

module.exports = { isAkarTehsil, hasAkar, akarChanged, AKAR_MESSAGE };
