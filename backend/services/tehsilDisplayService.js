// How a user's tehsil/mouza access is presented to the app (header dropdowns).
//
// 1. Merged tehsils: tehsils linked in a TehsilGroup are one tehsil. A user who
//    holds separate entries for linked names (assigned before the group existed,
//    or a territory picked from the raw list) gets them collapsed into ONE entry
//    under the group's name, so the dropdown shows it once. Files and APIs already
//    resolve linked names (getLinkedTehsils), so the group name loads all of them.
// 2. Sub-admins: an empty mouza list means "every mouza" on the server (hasAccess),
//    but the dropdown only shows listed mouzas, so sub-admins saw none. For them,
//    empty entries are filled with the tehsil's full mouza list for display only.
const fs = require('fs');
const path = require('path');
const { getAllGroups, getLinkedTehsils } = require('./tehsilAliasService');
const { getAllTehsilsAndMouzas } = require('./geoService');
const logger = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const lc = (s) => String(s || '').trim().toLowerCase();

/**
 * Collapse entries that belong to the same tehsil group into one entry named after
 * the group. Mouza lists are unioned; an empty list ("all mouzas") wins.
 * Returns { tehsilAccess, activeTehsil, changed }.
 */
async function collapseGroupedAccess(tehsilAccess, activeTehsil) {
    const entries = Array.isArray(tehsilAccess) ? tehsilAccess : [];
    if (entries.length < 2) return { tehsilAccess: entries, activeTehsil, changed: false };

    const groups = await getAllGroups();
    if (!groups.length) return { tehsilAccess: entries, activeTehsil, changed: false };
    const groupOf = new Map();
    groups.forEach(g => {
        [g.canonicalName, ...(g.aliases || [])].forEach(n => groupOf.set(lc(n), g.canonicalName));
    });

    const out = [];
    const byGroup = new Map(); // canonical (lc) -> merged entry
    let changed = false;
    let newActive = activeTehsil;

    for (const e of entries) {
        const canonical = groupOf.get(lc(e.tehsil));
        if (!canonical) { out.push(e); continue; }
        const key = lc(canonical);
        if (lc(activeTehsil) === lc(e.tehsil)) newActive = canonical;
        const existing = byGroup.get(key);
        if (!existing) {
            const merged = { tehsil: canonical, mouzas: [...(e.mouzas || [])], tempGrants: [...(e.tempGrants || [])], _all: !(e.mouzas || []).length };
            if (lc(canonical) !== lc(e.tehsil)) changed = true;
            byGroup.set(key, merged);
            out.push(merged);
        } else {
            changed = true; // a second linked name folded in
            existing._all = existing._all || !(e.mouzas || []).length;
            existing.mouzas = Array.from(new Set([...existing.mouzas, ...(e.mouzas || [])]));
            existing.tempGrants = [...existing.tempGrants, ...(e.tempGrants || [])];
        }
    }
    out.forEach(e => { if (e._all !== undefined) { if (e._all) e.mouzas = []; delete e._all; } });
    return { tehsilAccess: out, activeTehsil: newActive, changed };
}

// Every mouza of a tehsil (and its linked names): database list + data folders.
const mouzaCache = new Map(); // lc tehsil -> { at, list }
// Cleared on every instance when tehsil data or links change.
require('../utils/cacheBus').register('geo', () => mouzaCache.clear());
require('../utils/cacheBus').register('tehsilGroups', () => mouzaCache.clear());
async function listMouzasForTehsil(tehsil) {
    const key = lc(tehsil);
    const hit = mouzaCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.list;

    const linked = await getLinkedTehsils(tehsil);
    const names = new Set();
    try {
        const db = await getAllTehsilsAndMouzas();
        linked.forEach(t => {
            const row = db.find(r => lc(r.tehsil) === lc(t));
            (row?.mouzas || []).forEach(m => names.add(m));
        });
    } catch (e) { logger.warn('listMouzasForTehsil: db list failed', { error: e.message }); }

    const readDir = async (dir) => { try { return await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return []; } };
    for (const t of linked) {
        for (const d of await readDir(path.join(DATA_DIR, 'JSON Murabba', t))) {
            if (d.isFile() && d.name.toLowerCase().endsWith('.geojson')) names.add(d.name.slice(0, -8));
        }
        for (const d of await readDir(path.join(DATA_DIR, 'pmtiles', t))) {
            if (d.isFile() && d.name.toLowerCase().endsWith('.pmtiles')) names.add(d.name.slice(0, -8));
        }
        for (const d of await readDir(path.join(DATA_DIR, 'Shajra Parcha', t))) {
            // Skip empty mouza folders (created ahead of time by data-prep scripts).
            if (d.isDirectory() && (await readDir(path.join(DATA_DIR, 'Shajra Parcha', t, d.name))).some(x => !x.name.startsWith('.'))) names.add(d.name);
        }
    }
    const list = Array.from(names)
        .filter(m => m && !m.toLowerCase().includes('-complete'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    mouzaCache.set(key, { at: Date.now(), list });
    return list;
}

/** Sub-admins: fill "all mouzas" (empty) entries with the real list, for display. */
async function expandSubAdminMouzas(sanitized) {
    if (!sanitized || sanitized.userType !== 'subadmin' || !Array.isArray(sanitized.tehsilAccess)) return sanitized;
    sanitized.tehsilAccess = await Promise.all(sanitized.tehsilAccess.map(async (e) =>
        (e.mouzas && e.mouzas.length) ? e : { ...e, mouzas: await listMouzasForTehsil(e.tehsil) }
    ));
    const active = sanitized.tehsilAccess.find(e => e.tehsil === sanitized.activeTehsil) || sanitized.tehsilAccess[0];
    sanitized.mauzaList = active ? active.mouzas : [];
    return sanitized;
}

/**
 * Reverse of collapseGroupedAccess, run when a group is unlinked (or renamed):
 * every user entry saved under the group name is split back into the original
 * tehsils, each mouza going to the tehsil whose data actually has it.
 * "All mouzas" entries become "all mouzas" for every original tehsil.
 * Sub-admin territories are updated the same way. Returns counts.
 *
 * @param {string} groupName  the (old) group name users were saved under
 * @param {string[]} aliases  the original tehsil names
 * @param {string|null} renameTo  when set, entries are renamed instead of split
 */
async function splitGroupAccess(groupName, aliases, renameTo = null) {
    const User = require('../models/User');
    const SubAdmin = require('../models/SubAdmin');
    const name = lc(groupName);
    const originals = Array.from(new Set((aliases || []).map(a => String(a).trim()).filter(Boolean)));
    if (!name || (!renameTo && !originals.length)) return { users: 0, subAdmins: 0 };

    mouzaCache.clear(); // lists built while linked contained the other names' mouzas
    const owner = new Map(); // lc mouza -> original tehsil that has it
    if (!renameTo) {
        for (const t of originals) {
            (await listMouzasForTehsil(t)).forEach(m => { if (!owner.has(lc(m))) owner.set(lc(m), t); });
        }
    }

    const rx = new RegExp(`^${String(groupName).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const users = await User.find({ 'tehsilAccess.tehsil': rx }).select('userId tehsilAccess activeTehsil');
    for (const u of users) {
        const next = [];
        for (const e of u.tehsilAccess) {
            if (lc(e.tehsil) !== name) { next.push(e); continue; }
            if (renameTo) { next.push({ tehsil: renameTo, mouzas: e.mouzas || [], tempGrants: e.tempGrants || [] }); continue; }
            const mouzas = e.mouzas || [];
            if (!mouzas.length) {
                originals.forEach(t => next.push({ tehsil: t, mouzas: [], tempGrants: [] }));
            } else {
                const per = new Map(originals.map(t => [t, []]));
                mouzas.forEach(m => per.get(owner.get(lc(m)) || originals[0]).push(m));
                const grants = e.tempGrants || [];
                per.forEach((list, t) => {
                    if (!list.length) return;
                    const set = new Set(list.map(lc));
                    next.push({ tehsil: t, mouzas: list, tempGrants: grants.filter(g => set.has(lc(g.mouza))) });
                });
            }
        }
        // Merge with any entry the user already had for an original name.
        const merged = [];
        const seen = new Map();
        next.forEach(e => {
            const k = lc(e.tehsil);
            const prev = seen.get(k);
            if (!prev) { const c = { tehsil: e.tehsil, mouzas: [...(e.mouzas || [])], tempGrants: [...(e.tempGrants || [])] }; seen.set(k, c); merged.push(c); return; }
            if (!prev.mouzas.length || !(e.mouzas || []).length) prev.mouzas = [];
            else prev.mouzas = Array.from(new Set([...prev.mouzas, ...e.mouzas]));
            prev.tempGrants.push(...(e.tempGrants || []));
        });
        u.tehsilAccess = merged;
        if (lc(u.activeTehsil) === name) u.activeTehsil = renameTo || merged[0]?.tehsil || '';
        u.markModified('tehsilAccess');
        await u.save();
    }

    const sas = await SubAdmin.find({ territory: rx });
    for (const sa of sas) {
        const t = [];
        sa.territory.forEach(x => (lc(x) === name ? (renameTo ? [renameTo] : originals) : [x]).forEach(y => { if (!t.some(z => lc(z) === lc(y))) t.push(y); }));
        sa.territory = t;
        await sa.save();
    }
    logger.info('Tehsil group access split', { groupName, renameTo, users: users.length, subAdmins: sas.length });
    return { users: users.length, subAdmins: sas.length };
}

module.exports = { collapseGroupedAccess, listMouzasForTehsil, expandSubAdminMouzas, splitGroupAccess };
