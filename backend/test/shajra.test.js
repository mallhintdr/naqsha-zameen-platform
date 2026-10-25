require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { _validateCase } = require('../controllers/shajraController');

const big = (n) => ({ $big: String(n) });
const zero = { n: big(0), d: big(1) };
const sample = {
    id: 't', lawSystem: 'sunni-hanafi', deceasedId: 'D', dateOfDeath: '2026-01-01', province: 'punjab',
    persons: [
        { id: 'D', name: 'D', gender: 'M', alive: false, religion: 'muslim', flags: {} },
        { id: 'w', name: 'W', gender: 'F', alive: true, religion: 'muslim', flags: {} },
        { id: 's', name: 'S', gender: 'M', alive: true, religion: 'muslim', flags: {} },
    ],
    unions: [{ id: 'u', partners: ['D', 'w'], type: 'marriage' }],
    parents: [{ childId: 's', fatherId: 'D', motherId: 'w' }],
    estate: { immovable: [], debts: zero, funeral: zero, dower: zero, wills: [] },
    policy: { raddToSpouseWhenNoOtherHeir: true, grandfatherExcludesSiblings: true, shiaChildlessWidowLandRule: 'classical', applyMFLOs4: true, hinduDaughterOrder: 'benares', policyVersion: '2026.10-draft' },
};

test('shajra: a valid case passes validation (engine runs on the server)', async () => {
    const r = await _validateCase(sample);
    assert.equal(r.policyVersion, '2026.10-draft');
});

test('shajra: invalid / unsupported cases are refused', async () => {
    await assert.rejects(_validateCase('not json'), (e) => e.status === 400);
    await assert.rejects(_validateCase({ ...sample, persons: [] }), (e) => e.status === 400);
    await assert.rejects(_validateCase({ ...sample, lawSystem: 'not-a-law' }), (e) => e.status === 422);
    await assert.rejects(_validateCase('x'.repeat(400 * 1024)), (e) => e.status === 413);
});
