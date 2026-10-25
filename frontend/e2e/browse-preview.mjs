// "All Mouzas" browsing on a phone: switch, own mouzas marked, an unowned mouza opens as preview
// (banner, street basemap, locked features), and a website deep link opens a preview mouza.
import { chromium } from '@playwright/test';
import { mockFor } from './smoke-mocks.mjs';

const OUT = process.argv[2] || 'e2e/shots';
const BASE = process.env.SMOKE_BASE || 'http://localhost:4173';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const base = mockFor('user');
await page.route('**/*', async (route) => {
  const p = decodeURIComponent(new URL(route.request().url()).pathname);
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (p === '/api/me/browse/tehsils') return json({ publicBrowse: true, tehsils: [{ name: 'Bahawalpur', own: true }, { name: 'Lodhran', own: false }] });
  if (p === '/api/me/browse/mouzas/Bahawalpur') return json({ tehsil: 'Bahawalpur', mouzas: [{ name: 'Chak 1', own: true }, { name: 'Chak 2', own: false }, { name: 'Chak 3', own: false }], preview: { used: 1, limit: 10, left: 9 } });
  if (p === '/api/me/browse/mouzas/Lodhran') return json({ tehsil: 'Lodhran', mouzas: [{ name: 'Kot 7', own: false }], preview: { used: 1, limit: 10, left: 9 } });
  // Map data: answer like the real server does for a preview / unknown file (no '{}' bodies).
  if (p.startsWith('/api/geojson/') || p.startsWith('/Metadata/') || p.startsWith('/api/pmtiles/')) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'PREVIEW_TILES_ONLY' }) });
  return base(route);
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.locator('#mauza-dropdown').click();
await page.getByRole('tab', { name: 'All Mouzas' }).click();
await page.waitForTimeout(400);
const items = await page.locator('.dropdown-item').allTextContents();
check('own mouza first and marked', items[0]?.includes('✓') && items[0]?.includes('Chak 1'));
check('unowned mouzas listed', items.some((t) => t.includes('Chak 2')));
check('previews-left footer', (await page.locator('.browse-footer').innerText()).includes('9 of 10'));
await page.screenshot({ path: `${OUT}/browse-list.png` });

await page.locator('.dropdown-item', { hasText: 'Chak 2' }).click();
await page.waitForTimeout(600);
check('preview banner shown', (await page.locator('.preview-banner').innerText()).includes('Chak 2'));
check('street basemap in preview', (await page.locator('#map-base-layer-select').inputValue()) === 'Google Streets');
await page.locator('#leaflet-location-control-btn').click();
await page.waitForTimeout(300);
check('live location locked in preview', (await page.locator('[role=dialog]').last().innerText()).includes('previewing'));
await page.screenshot({ path: `${OUT}/browse-preview.png` });
await page.keyboard.press('Escape');

// Back to an own mouza: full access again.
await page.locator('#mauza-dropdown').click();
await page.locator('.dropdown-item', { hasText: 'Chak 1' }).click();
await page.waitForTimeout(400);
check('own mouza: no preview banner', (await page.locator('.preview-banner').count()) === 0);

// Website deep link into another tehsil.
await page.goto(`${BASE}/?browse=all&t=Lodhran&m=Kot%207`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
check('deep link opens preview mouza', (await page.locator('.preview-banner').innerText().catch(() => '')).includes('Kot 7'));
check('deep link cleaned from address bar', !page.url().includes('browse='));

await b.close();
// The mocks serve no map data, so 'GeoJSON not found' is expected here.
const real = errors.filter((m) => !/GeoJSON not found/.test(m));
check('no page errors', real.length === 0);
if (real.length) console.log(real);
