#!/usr/bin/env node
/**
 * Identify which account a leaked GeoJSON came from (forensic watermark).
 *
 *   node scripts/identify_leak.js --leaked leaked.geojson --original "data/JSON Murabba/T/M.geojson" \
 *        --users alice,bob,carol            # or --users-file ids.txt (one per line)
 *        [--all-users]                      # every userId from MongoDB (needs MONGO_URI)
 *        [--secret ...] [--units 3] [--sample 20000] [--json]
 *
 * The secret defaults to VECTOR_WATERMARK_SECRET, else the value derived from
 * SECRET_KEY (same as the server), loaded from backend/.env.
 *
 * Method: each leaked vertex is matched to the nearest original vertex (within
 * a few cm); the residual (leaked − original) is correlated with the offset each
 * candidate would have received. The leaker scores ≈ 1.0 (exact = 100% when the
 * file was not re-rounded); everyone else ≈ 0. Survives re-rounding to 6
 * decimals and small extra noise by averaging over many vertices.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { watermarkSeeds, watermarkOffset, forEachPosition, XY_SCALE } = require('../services/vectorCodec');
const { vectorConfig } = require('../services/vectorConfig');

function parseArgs(argv) {
    const a = {};
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (!k.startsWith('--')) continue;
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) a[k.slice(2)] = true; else { a[k.slice(2)] = next; i++; }
    }
    return a;
}

const readJson = (f) => { const t = fs.readFileSync(f, 'utf8'); return JSON.parse(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t); };

/**
 * @param {object} leaked GeoJSON
 * @param {object} original GeoJSON (server copy)
 * @param {string[]} userIds candidates
 * @returns {{ matched: number, results: {userId, score, exact}[] }}
 */
function identify(leaked, original, userIds, { secret, units = 3, radius = 8, sample = 20000 } = {}) {
    // Original vertices on the quantum grid, bucketed for neighbourhood search.
    const orig = new Map();
    forEachPosition(original, (x, y) => {
        const qx = Math.round(x * XY_SCALE), qy = Math.round(y * XY_SCALE);
        orig.set(`${qx},${qy}`, [qx, qy]);
    });
    const leakedPts = [];
    forEachPosition(leaked, (x, y) => leakedPts.push([Math.round(x * XY_SCALE), Math.round(y * XY_SCALE)]));
    // De-duplicate shared vertices, then sample evenly.
    const uniq = [...new Map(leakedPts.map(p => [`${p[0]},${p[1]}`, p])).values()];
    const step = Math.max(1, Math.floor(uniq.length / sample));

    const pairs = []; // [ox, oy, dx, dy]
    for (let i = 0; i < uniq.length; i += step) {
        const [lx, ly] = uniq[i];
        let best = null, bestD = Infinity, ambiguous = false;
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                const o = orig.get(`${lx - dx},${ly - dy}`);
                if (!o) continue;
                const d = dx * dx + dy * dy;
                if (d < bestD) { best = o; bestD = d; ambiguous = false; } else if (d === bestD) ambiguous = true;
            }
        }
        if (best && !ambiguous) pairs.push([best[0], best[1], lx - best[0], ly - best[1]]);
    }

    const off = [0, 0];
    const results = userIds.map(userId => {
        const [s0, s1] = watermarkSeeds(secret, userId);
        let dot = 0, norm = 0, exact = 0;
        for (const [ox, oy, dx, dy] of pairs) {
            watermarkOffset(ox, oy, s0, s1, units, off);
            dot += dx * off[0] + dy * off[1];
            norm += off[0] * off[0] + off[1] * off[1];
            if (dx === off[0] && dy === off[1]) exact++;
        }
        return { userId, score: norm ? dot / norm : 0, exact: pairs.length ? exact / pairs.length : 0 };
    }).sort((a, b) => b.score - a.score);
    return { matched: pairs.length, results };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.leaked || !args.original) {
        console.error('Usage: node scripts/identify_leak.js --leaked <file> --original <file> (--users a,b | --users-file f | --all-users) [--secret s] [--units 3] [--json]');
        process.exit(2);
    }
    let users = [];
    if (typeof args.users === 'string') users = args.users.split(',');
    if (typeof args['users-file'] === 'string') users = users.concat(fs.readFileSync(args['users-file'], 'utf8').split(/\r?\n/));
    if (args['all-users']) {
        const mongoose = require('mongoose');
        await mongoose.connect(process.env.MONGO_URI);
        const User = require('../models/User');
        users = users.concat((await User.find({}).select('userId').lean()).map(u => u.userId));
        await mongoose.disconnect();
    }
    users = [...new Set(users.map(u => String(u).trim()).filter(Boolean))];
    if (!users.length) { console.error('No candidate users given.'); process.exit(2); }

    const cfg = vectorConfig();
    const { matched, results } = identify(readJson(args.leaked), readJson(args.original), users, {
        secret: typeof args.secret === 'string' ? args.secret : cfg.watermarkSecret,
        units: args.units ? parseInt(args.units, 10) : cfg.watermarkUnits,
        sample: args.sample ? parseInt(args.sample, 10) : 20000,
    });
    if (args.json) { console.log(JSON.stringify({ matched, results: results.slice(0, 20) }, null, 2)); return; }
    console.log(`Matched ${matched} leaked vertices to the original.`);
    if (matched < 50) console.log('WARNING: too few matching vertices — is --original the right file (and un-shifted)?');
    console.log('rank  score   exact   userId');
    results.slice(0, 10).forEach((r, i) => console.log(`${String(i + 1).padStart(4)}  ${r.score.toFixed(3).padStart(6)}  ${(r.exact * 100).toFixed(1).padStart(5)}%  ${r.userId}`));
    const [top, second] = results;
    if (top && top.score > 0.5 && (!second || top.score - second.score > 0.3)) console.log(`\nLikely source: ${top.userId}`);
    else console.log('\nNo confident match (watermark off for that download, data re-projected/re-noised, or user not in candidates).');
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });

module.exports = { identify };
