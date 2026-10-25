// Shajra Nasab tool: accessibility (axe-core), Urdu notes and Hindu manual override.
// Usage: (in site/) npx astro dev --port 4330 &  then (in frontend/) node e2e/shajra-a11y.mjs [baseUrl]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const BASE = process.argv[2] || 'http://localhost:4330';
const axe = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };

await page.goto(`${BASE}/tools/shajra-nasab/?beta=hindu`, { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('svg.shajra-tree', { timeout: 90000 });
await page.getByPlaceholder('e.g. Muhammad Aslam').fill('Test');
// Tap a person -> menu -> Add relative -> choose
const add = async (who, rel) => {
  await page.locator('svg.shajra-tree g[role=button]').nth(who).click();
  await page.locator('[role=menu] button', { hasText: 'Add relative' }).click();
  await page.locator('[role=menu] button[role=menuitem]', { hasText: new RegExp(`^${rel}`) }).click();
};
await add(0, 'Spouse'); await add(0, 'Son');
await page.waitForTimeout(300);

// Accessibility of the tool area
await page.addScriptTag({ content: axe });
const res = await page.evaluate(async () => (await window.axe.run('.shajra', { resultTypes: ['violations'] })).violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.length} (${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')})`));
console.log(res.length ? res.join('\n') : 'axe: no violations');
check('axe: no serious/critical violations', !res.some((r) => /^(serious|critical)/.test(r)));

// Keyboard: Enter on a person opens the menu; arrows move; Edit opens the editor; Escape closes
await page.locator('svg.shajra-tree g[role=button]').nth(1).focus();
await page.keyboard.press('Enter');
check('keyboard opens the person menu', await page.locator('[role=menu]').count() === 1);
await page.keyboard.press('Enter'); // first item: Edit details
check('Edit opens the editor', /Gender|Religion/.test(await page.locator('#shajra-editor').innerText()));
await page.locator('svg.shajra-tree g[role=button]').nth(1).click();
await page.keyboard.press('Escape');
check('Escape closes the menu', await page.locator('[role=menu]').count() === 0);
// Delete from the menu
await add(0, 'Daughter');
const before = await page.locator('svg.shajra-tree g[role=button]').count();
await page.locator('svg.shajra-tree g[role=button]').nth(before - 1).click();
await page.locator('[role=menu] button', { hasText: 'Delete' }).click();
check('Delete removes the person', (await page.locator('svg.shajra-tree g[role=button]').count()) === before - 1);

// Urdu notes
await page.locator('button', { hasText: 'اردو' }).click();
check('Urdu notes shown', /بیٹا|حصہ|اولاد/.test(await page.locator('#shajra-results ol').innerText()));
await page.locator('button', { hasText: 'English' }).click();

// Hindu manual override
await page.locator('select').first().selectOption('hindu-mitakshara-benares');
await page.waitForTimeout(300);
await page.locator('button', { hasText: 'Edit shares manually' }).click();
const inputs = page.locator('input[aria-label^="Manual share"]');
check('override inputs present', (await inputs.count()) >= 2);
await inputs.nth(0).fill('1/4'); await inputs.nth(1).fill('1/2');
check('invalid total warned', (await page.locator('[role=status]').innerText()).includes('not 1'));
await inputs.nth(1).fill('3/4');
await page.locator('button', { hasText: 'Done editing' }).click();
check('valid override applied', (await page.locator('#shajra-results tbody').innerText()).includes('manual'));
check('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
