require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVectorPath, isEntitled } = require('../services/vectorAccess');

// Linked tehsils: "Group A" = ["Ali Pur", "Alipur Old"]
const groups = [['Group A', 'Ali Pur', 'Alipur Old']];
const linked = async (t) => {
    const g = groups.find(x => x.some(n => n.toLowerCase() === String(t).toLowerCase()));
    return g ? g.slice(1) : [t];
};
const opt = { linked };
const day = 86400e3;

test('parseVectorPath: mouza files, murabba files, tehsil-wide files', () => {
    assert.deepEqual(parseVectorPath('/Ali%20Pur/Chak%2012.geojson'), { tehsil: 'Ali Pur', mouza: 'Chak 12', file: 'Chak 12.geojson' });
    assert.equal(parseVectorPath('/Ali Pur/Chak 12/5-1.geojson').mouza, 'Chak 12');
    assert.equal(parseVectorPath('/Ali Pur/Chak 12-Murabba.json').mouza, 'Chak 12');
    assert.equal(parseVectorPath('/Ali Pur/Chak 12-Killa.json').mouza, 'Chak 12');
    assert.equal(parseVectorPath('/Ali Pur/Chak 12-Metadata.json').mouza, 'Chak 12');
    assert.equal(parseVectorPath('/Ali Pur/Chak 12.json').mouza, 'Chak 12');
    assert.equal(parseVectorPath('/Ali Pur/Chak 12-complete.pmtiles').mouza, 'Chak 12');
    assert.equal(parseVectorPath('/Ali Pur/Chak 12/17/1/2.png').mouza, 'Chak 12');
    assert.deepEqual(parseVectorPath('/Ali Pur/Ali Pur-Mouza-Index.json'), { tehsil: 'Ali Pur', mouza: null, file: 'Ali Pur-Mouza-Index.json' });
    assert.deepEqual(parseVectorPath('/Ali Pur-Mouza-Index.json'), { tehsil: 'Ali Pur', mouza: null, file: 'Ali Pur-Mouza-Index.json' });
    assert.equal(parseVectorPath('/Ali Pur/../../server.js'), null);
    assert.equal(parseVectorPath('/Ali Pur/%2e%2e/x.json'), null);
    assert.equal(parseVectorPath('/'), null);
});

test('admins see everything', async () => {
    assert.equal(await isEntitled({ userType: 'admin', tehsilAccess: [] }, 'Anything', 'Any', opt), true);
});

test('mouza-level: only listed mouzas, case-insensitive', async () => {
    const u = { userType: 'user', tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: ['Chak 12', 'Kot Adu'] }] };
    assert.equal(await isEntitled(u, 'Ali Pur', 'Chak 12', opt), true);
    assert.equal(await isEntitled(u, 'ali pur', 'CHAK 12', opt), true);
    assert.equal(await isEntitled(u, 'Ali Pur', 'Chak 13', opt), false);
    assert.equal(await isEntitled(u, 'Ali Pur', null, opt), true, 'tehsil-wide index allowed');
    assert.equal(await isEntitled(u, 'Other', null, opt), false);
    assert.equal(await isEntitled(u, 'Other', 'Chak 12', opt), false);
});

test('empty mouza list = whole tehsil', async () => {
    const u = { userType: 'user', tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: [] }] };
    assert.equal(await isEntitled(u, 'Ali Pur', 'Anything', opt), true);
    assert.equal(await isEntitled(u, 'Bahawalnagar', 'Anything', opt), false);
});

test('temp grants: valid allowed, expired refused, temp-only entry never widens to whole tehsil', async () => {
    const now = new Date('2026-10-23T10:00:00Z');
    const u = {
        userType: 'user',
        tehsilAccess: [
            { tehsil: 'Ali Pur', mouzas: ['Chak 12'], tempGrants: [{ mouza: 'Chak 99', expiresAt: new Date(now.getTime() + day) }, { mouza: 'Old One', expiresAt: new Date(now.getTime() - day) }] },
            { tehsil: 'Bahawalnagar', mouzas: [], tempGrants: [{ mouza: 'Temp Only', expiresAt: new Date(now.getTime() - day) }] },
            { tehsil: 'Fort Abbas', mouzas: ['Granted'], tempGrants: [{ mouza: 'Granted', expiresAt: new Date(now.getTime() - day) }] },
        ],
    };
    const o = { ...opt, now };
    assert.equal(await isEntitled(u, 'Ali Pur', 'Chak 99', o), true);
    assert.equal(await isEntitled(u, 'Ali Pur', 'Old One', o), false);
    assert.equal(await isEntitled(u, 'Bahawalnagar', 'Temp Only', o), false);
    assert.equal(await isEntitled(u, 'Bahawalnagar', 'Something Else', o), false, 'expired temp-only entry is not "all mouzas"');
    assert.equal(await isEntitled(u, 'Fort Abbas', 'Granted', o), false, 'expired temp grant also present in mouzas[] is refused');
});

test('linked / merged tehsils both directions', async () => {
    const holdsGroup = { userType: 'user', tehsilAccess: [{ tehsil: 'Group A', mouzas: ['Chak 1'] }] };
    assert.equal(await isEntitled(holdsGroup, 'Alipur Old', 'Chak 1', opt), true);
    assert.equal(await isEntitled(holdsGroup, 'Ali Pur', 'chak 1', opt), true);
    assert.equal(await isEntitled(holdsGroup, 'Ali Pur', 'Chak 2', opt), false);
    const holdsMember = { userType: 'user', tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: ['Chak 1'] }] };
    assert.equal(await isEntitled(holdsMember, 'Alipur Old', 'Chak 1', opt), true);
    assert.equal(await isEntitled(holdsMember, 'Group A', 'Chak 1', opt), true);
});

test('sub-admins follow their own tehsilAccess', async () => {
    const sa = { userType: 'subadmin', tehsilAccess: [{ tehsil: 'Ali Pur', mouzas: [] }] };
    assert.equal(await isEntitled(sa, 'Ali Pur', 'X', opt), true);
    assert.equal(await isEntitled(sa, 'Lodhran', 'X', opt), false);
});

test('killa-bandi / sanitised names and -complete suffix', async () => {
    const u = { userType: 'user', tehsilAccess: [{ tehsil: 'Rojhan', mouzas: ['Bolani', 'Chak 5/1'] }] };
    assert.equal(await isEntitled(u, 'Rojhan', parseVectorPath('/Rojhan/Bolani/12.geojson').mouza, opt), true);
    assert.equal(await isEntitled(u, 'Rojhan', 'Chak 5-1', opt), true, '"/" sanitised to "-" in file names');
    assert.equal(await isEntitled(u, 'Rojhan', 'bolani-complete', opt), true);
    assert.equal(await isEntitled(u, 'Rojhan', 'Bolani Kalan', opt), false);
    const v = { userType: 'user', tehsilAccess: [{ tehsil: 'BC', mouzas: ['12-A-BC'] }] };
    assert.equal(await isEntitled(v, 'BC', '12-A BC', opt), false, 'near-identical names stay distinct');
    assert.equal(await isEntitled(v, 'BC', '12-A_BC', opt), false);
});

test('legacy users without tehsilAccess fall back to tehsil/mauzaList', async () => {
    const u = { userType: 'user', tehsilAccess: [], tehsil: 'Ali Pur', mauzaList: ['Chak 12'] };
    assert.equal(await isEntitled(u, 'Ali Pur', 'Chak 12', opt), true);
    assert.equal(await isEntitled(u, 'Ali Pur', 'Chak 13', opt), false);
    assert.equal(await isEntitled(null, 'Ali Pur', 'Chak 12', opt), false);
});
