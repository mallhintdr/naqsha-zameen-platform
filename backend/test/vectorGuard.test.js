require('./helpers');
process.env.VECTOR_RPM = '100';
process.env.VECTOR_MOUZA_DAILY_MAX = '3';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { vectorGuards } = require('../middleware/vectorDataGuard');
const { _resetMemory } = require('../services/vectorQuota');

const users = {
    alice: { userId: 'alice', userType: 'user', tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: [] }] },
    bob: { userId: 'bob', userType: 'user', tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: ['Chak 1'] }] },
    root: { userId: 'root', userType: 'admin', tehsilAccess: [] },
};

function makeApp() {
    const app = express();
    app.use((req, res, next) => { req.user = users[req.headers['x-test-user']]; next(); });
    app.use(['/JSON Murabba', '/JSON%20Murabba'], ...vectorGuards(), (req, res) => res.json({ ok: true, scope: req.vectorScope }));
    app.get('/api/geojson/:tehsil/:mauza', ...vectorGuards({ paramsFrom: 'params' }), (req, res) => res.json({ ok: true }));
    return app;
}

let server, base;
test.before(async () => {
    server = makeApp().listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const get = (path, user, header = true) => fetch(base + encodeURI(path), { headers: { 'x-test-user': user, ...(header ? { 'X-NZ-Client': 'dashboard' } : {}) } });

test('entitlement: mouza outside subscription is 403, inside is 200', async () => {
    _resetMemory();
    assert.equal((await get('/JSON Murabba/Ali Pur/Chak 1.geojson', 'bob')).status, 200);
    assert.equal((await get('/JSON Murabba/Ali Pur/Chak 1/3.geojson', 'bob')).status, 200);
    const r = await get('/JSON Murabba/Ali Pur/Chak 2.geojson', 'bob');
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'VECTOR_NOT_ENTITLED');
    assert.equal((await get('/api/geojson/Ali Pur/Chak 2', 'bob')).status, 403);
    assert.equal((await get('/api/geojson/Ali Pur/Chak 1', 'bob')).status, 200);
});

test('client header required for vector files', async () => {
    const r = await get('/JSON Murabba/Ali Pur/Chak 1.geojson', 'bob', false);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).code, 'VECTOR_CLIENT_REQUIRED');
    assert.equal((await get('/api/geojson/Ali Pur/Chak 1', 'bob', false)).status, 403);
    // Non-vector files under the same root (raster tiles) do not need it.
    assert.equal((await get('/JSON Murabba/Ali Pur/Chak 1/1/2/3.png', 'bob', false)).status, 200);
});

test('distinct mouza quota: 429 on the 4th new mouza, already-opened ones still work, admins exempt', async () => {
    _resetMemory();
    for (const m of ['A', 'B', 'C']) assert.equal((await get(`/JSON Murabba/Ali Pur/${m}.geojson`, 'alice')).status, 200, m);
    const r = await get('/JSON Murabba/Ali Pur/D.geojson', 'alice');
    assert.equal(r.status, 429);
    assert.equal((await r.json()).code, 'VECTOR_QUOTA_EXCEEDED');
    assert.equal((await get('/JSON Murabba/Ali Pur/A/7.geojson', 'alice')).status, 200, 'murabba of an opened mouza');
    assert.equal((await get('/JSON Murabba/Ali Pur/Ali Pur-Mouza-Index.json', 'alice')).status, 200, 'tehsil-wide index is free');
    for (const m of ['A', 'B', 'C', 'D', 'E']) assert.equal((await get(`/JSON Murabba/Ali Pur/${m}.geojson`, 'root')).status, 200);
});

test('per-minute rate limit returns 429 JSON (admins exempt)', async () => {
    process.env.VECTOR_RPM = '5'; // read per request
    let last;
    for (let i = 0; i < 8; i++) last = await get('/JSON Murabba/Ali Pur/Chak 1.geojson', 'bob');
    assert.equal(last.status, 429);
    const body = await last.json();
    assert.equal(body.code, 'VECTOR_RATE_LIMITED');
    assert.equal((await get('/JSON Murabba/Ali Pur/Z.geojson', 'root')).status, 200);
});
