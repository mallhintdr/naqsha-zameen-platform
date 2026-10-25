require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { accessLevel, subscriptionState } = require('../services/accessPolicy');
const { hasAccess } = require('../middleware/authMiddleware');
const { requireMapAccess } = require('../middleware/mapAccess');
const { vectorGuards } = require('../middleware/vectorDataGuard');
const { _resetMemory } = require('../services/vectorQuota');

const linked = async (t) => [t];
const today = new Date().toISOString();
const longAgo = '2020-01-01T00:00:00Z';
const tomorrow = new Date(Date.now() + 86400e3);
const yesterday = new Date(Date.now() - 86400e3);
const base1 = { userType: 'user', subscriptionType: 'Yearly', startDate: today, tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: ['Chak 1'] }] };

const U = {
    active: { ...base1, userId: 'a', status: 'Active' },
    expired: { ...base1, userId: 'e', status: 'Expired', subscriptionType: 'Monthly', startDate: longAgo },
    lapsed: { ...base1, userId: 'l', status: 'Active', subscriptionType: 'Monthly', startDate: longAgo },
    pending: { ...base1, userId: 'p', status: 'Pending' },
    suspended: { ...base1, userId: 's', status: 'Suspended' },
    whole: { ...base1, userId: 'w', status: 'Active', tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: [] }] },
    grantOnly: { ...base1, userId: 'g', status: 'Active', tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: [], tempGrants: [{ mouza: 'Chak 5', expiresAt: tomorrow }] }] },
    grantGone: { ...base1, userId: 'gg', status: 'Active', tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: [], tempGrants: [{ mouza: 'Chak 5', expiresAt: yesterday }] }] },
    admin: { userId: 'root', userType: 'admin' },
};

test('subscription state', () => {
    assert.equal(subscriptionState(U.active), 'full');
    assert.equal(subscriptionState(U.expired), 'expired');
    assert.equal(subscriptionState(U.lapsed), 'expired', 'calculated expiry counts even if status says Active');
    assert.equal(subscriptionState(U.pending), 'expired');
    assert.equal(subscriptionState(U.suspended), 'none');
    assert.equal(subscriptionState(U.admin), 'full');
    assert.equal(subscriptionState(null), 'none');
});

test('access level per mouza', async () => {
    const o = { linked };
    assert.equal(await accessLevel(U.active, 'Ali Pur', 'Chak 1', o), 'full');
    assert.equal(await accessLevel(U.active, 'Ali Pur', 'Chak 2', o), 'none');
    assert.equal(await accessLevel(U.expired, 'Ali Pur', 'Chak 1', o), 'expired');
    assert.equal(await accessLevel(U.expired, 'Ali Pur', 'Chak 2', o), 'none');
    assert.equal(await accessLevel(U.suspended, 'Ali Pur', 'Chak 1', o), 'none');
    assert.equal(await accessLevel(U.whole, 'Ali Pur', 'Any Chak', o), 'full');
    assert.equal(await accessLevel(U.admin, 'Elsewhere', 'X', o), 'full');
    assert.equal(await accessLevel(null, 'Ali Pur', 'Chak 1', o), 'none');
});

test('G4: an entry holding only temp grants is not the whole tehsil', async () => {
    const o = { linked };
    assert.equal(await accessLevel(U.grantOnly, 'Ali Pur', 'Chak 5', o), 'full');
    assert.equal(await accessLevel(U.grantOnly, 'Ali Pur', 'Chak 6', o), 'none');
    assert.equal(await accessLevel(U.grantGone, 'Ali Pur', 'Chak 5', o), 'none', 'expired grant');
    assert.equal(await accessLevel(U.grantGone, 'Ali Pur', 'Chak 6', o), 'none', 'never widens after the grant ends');
});

// Real middleware over HTTP (linked-tehsil lookups fall back to the name without a DB).
let server, base;
test.before(async () => {
    const app = express();
    app.use((req, res, next) => { req.user = U[req.headers['x-test-user']]; next(); });
    app.get('/tiles/:tehsil/:mouza', requireMapAccess({ allowExpired: true }), (req, res) => res.json({ level: req.accessLevel }));
    app.get('/geojson/:tehsil/:mauza', requireMapAccess({ allowExpired: false }), (req, res) => res.json({ level: req.accessLevel }));
    app.get('/sign', requireMapAccess({ allowExpired: true }), (req, res) => res.json({ level: req.accessLevel }));
    app.use(['/JSON Murabba', '/JSON%20Murabba'], ...vectorGuards({ tilesOnlyWhenExpired: true }), (req, res) => res.json({ ok: true }));
    app.get('/has/:tehsil/:mouza', async (req, res) => res.json({ ok: await hasAccess(req.user, req.params.tehsil, req.params.mouza) }));
    server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
const get = (p, user) => fetch(base + encodeURI(p), { headers: { 'x-test-user': user, 'X-NZ-Client': 'dashboard' } });

test('tiles: expired users allowed at any zoom; not entitled / suspended refused', async () => {
    assert.equal((await get('/tiles/Ali Pur/Chak 1', 'expired')).status, 200);
    assert.equal((await get('/tiles/Ali Pur/Chak 1', 'active')).status, 200);
    assert.equal((await get('/tiles/Ali Pur/Chak 2', 'expired')).status, 403);
    assert.equal((await get('/tiles/Ali Pur/Chak 1', 'suspended')).status, 403);
    assert.equal((await get('/sign', 'expired')).status, 200, 'signing: the per-spec mouza check happens in the handler');
    assert.equal((await get('/sign', 'suspended')).status, 403);
});

test('GeoJSON API: expired users get EXPIRED_TILES_ONLY', async () => {
    const r = await get('/geojson/Ali Pur/Chak 1', 'expired');
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'EXPIRED_TILES_ONLY');
    assert.equal((await get('/geojson/Ali Pur/Chak 1', 'active')).status, 200);
});

test('static JSON Murabba: expired users refused mouza GeoJSON; index files stay open', async () => {
    _resetMemory();
    const r = await get('/JSON Murabba/Ali Pur/Chak 1.geojson', 'expired');
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'EXPIRED_TILES_ONLY');
    assert.equal((await get('/JSON Murabba/Ali Pur/Chak 1/3.geojson', 'expired')).status, 403, 'murabba files too');
    assert.equal((await get('/JSON Murabba/Ali Pur-Mouza-Index.json', 'expired')).status, 200);
    assert.equal((await get('/JSON Murabba/Ali Pur/Chak 1.geojson', 'active')).status, 200);
    assert.equal((await get('/JSON Murabba/Ali Pur/Chak 1.geojson', 'admin')).status, 200);
});

test('hasAccess (PMTiles signer, legacy callers) follows temp grants', async () => {
    assert.equal((await (await get('/has/Ali Pur/Chak 5', 'grantOnly')).json()).ok, true);
    assert.equal((await (await get('/has/Ali Pur/Chak 6', 'grantOnly')).json()).ok, false);
});

test('saved layers need a full subscription', async () => {
    const { requireFullSubscription } = require('../middleware/mapAccess');
    const mw = requireFullSubscription('saved-layers');
    const run = (user) => new Promise((resolve) => {
        const res = { status(c) { this.c = c; return this; }, json(b) { resolve({ status: this.c, body: b }); } };
        mw({ user }, res, () => resolve({ status: 200 }));
    });
    assert.equal((await run(U.active)).status, 200);
    assert.equal((await run(U.admin)).status, 200);
    const r = await run(U.expired);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'SUBSCRIPTION_REQUIRED');
    assert.equal((await run(U.pending)).status, 403);
});
