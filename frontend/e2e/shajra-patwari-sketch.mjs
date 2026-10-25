// Recreates a real patwari sketch (two widows, predeceased son with a daughter) and screenshots the chart.
// Usage: (in site/) npx astro dev --port 4335 &  then (in frontend/) node e2e/shajra-patwari-sketch.mjs <outDir>
import { chromium } from '@playwright/test';
const P = (id, name, gender, alive = true, dateOfDeath) => ({ id, name, gender, alive, dateOfDeath, religion: 'muslim', flags: {} });
const z = { n: { $big: '0' }, d: { $big: '1' } };
const kase = {
  id: 'SN-SKETCH', lawSystem: 'sunni-hanafi', deceasedId: 'D', dateOfDeath: '2025-09-01', province: 'punjab',
  persons: [P('D', 'محمد شریف', 'M', false, '2025-09-01'), P('fa', 'جیوانہ', 'M', false, '1990-01-01'), P('mo', 'حیراں', 'F', false, '1995-01-01'),
    P('w1', 'نذیراں بی بی', 'F'), P('w2', 'فاطمہ بی بی', 'F'),
    P('k1', 'کوثر بی بی', 'F'), P('k2', 'محمد عمران', 'M'), P('k3', 'محمد احسان', 'M'), P('k4', 'محمد اکرام', 'M', false, '2020-01-01'), P('g1', 'تحریم فاطمہ', 'F'),
    P('k5', 'پروین بی بی', 'F')],
  unions: [{ id: 'u0', partners: ['fa', 'mo'], type: 'marriage' }, { id: 'u1', partners: ['D', 'w1'], type: 'marriage' }, { id: 'u2', partners: ['D', 'w2'], type: 'marriage' }],
  parents: [{ childId: 'D', fatherId: 'fa', motherId: 'mo' }, ...['k1', 'k2', 'k3', 'k4'].map((k) => ({ childId: k, fatherId: 'D', motherId: 'w1' })), { childId: 'k5', fatherId: 'D', motherId: 'w2' }, { childId: 'g1', fatherId: 'k4' }],
  estate: { immovable: [], debts: z, funeral: z, dower: z, wills: [] },
  policy: { raddToSpouseWhenNoOtherHeir: true, grandfatherExcludesSiblings: true, shiaChildlessWidowLandRule: 'classical', applyMFLOs4: true, hinduDaughterOrder: 'benares', policyVersion: '2026.10-draft' },
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript((c) => localStorage.setItem('nz_shajra_case_v1', c), JSON.stringify(kase));
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4335/tools/shajra-nasab/', { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('svg.shajra-tree', { timeout: 90000 });
await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(800);
await page.locator('svg.shajra-tree').screenshot({ path: process.argv[2] + '/sketch.png' });
console.log('shares:', (await page.locator('#shajra-results tbody').innerText()).replace(/\s+/g, ' '));
console.log('errors', errors.length ? errors : 'none');
await b.close();
