/**
 * Cross-instance cache invalidation.
 *
 * Some lookups (tehsil list, linked tehsils, mouza lists, estate files, prices)
 * are kept in each worker's memory for speed. When one worker changes the
 * underlying data it calls bump(name); every worker sees the new version within
 * a few seconds (MongoDB SystemConfig 'cacheVersions', polled every 5 s — works
 * with or without Redis) and clears its own copy.
 *
 *   register(name, clearFn)   clear this worker's copy when `name` changes
 *   bump(name)                clear `name` on ALL workers (and here, now)
 */
const logger = require('./logger');

const handlers = new Map();      // name -> [clearFn]
const seen = {};                 // name -> version this worker has applied
const KEY = 'cacheVersions';
const POLL_MS = 5000;
let started = false;
let firstPoll = true;   // first poll only records the current versions

const SystemConfig = () => require('../models/SystemConfig');
const mongoReady = () => { try { return require('mongoose').connection.readyState === 1; } catch { return false; } };

function runLocal(name) {
    for (const fn of handlers.get(name) || []) {
        try { fn(); } catch (e) { logger.warn(`cacheBus: clear "${name}" failed`, { error: e.message }); }
    }
}

function register(name, clearFn) {
    if (!handlers.has(name)) handlers.set(name, []);
    handlers.get(name).push(clearFn);
    start();
}

async function bump(name) {
    runLocal(name);
    if (!mongoReady()) return;
    const version = Date.now();
    seen[name] = version;
    try {
        await SystemConfig().updateOne({ key: KEY }, { $set: { [`value.${name}`]: version } }, { upsert: true });
    } catch (e) {
        logger.warn(`cacheBus: bump "${name}" failed`, { error: e.message });
    }
}

async function poll() {
    if (!mongoReady()) return;
    try {
        const doc = await SystemConfig().findOne({ key: KEY }).lean();
        const versions = doc?.value || {};
        for (const [name, v] of Object.entries(versions)) {
            if (firstPoll && seen[name] === undefined) { seen[name] = v; continue; }   // startup: just record
            if (v !== seen[name]) { seen[name] = v; runLocal(name); }
        }
        firstPoll = false;
    } catch (e) { /* try again next tick */ }
}

function start() {
    if (started) return;
    started = true;
    const t = setInterval(poll, POLL_MS);
    if (t.unref) t.unref();
}

module.exports = { register, bump };
