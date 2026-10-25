// Preview mode on a phone: a website link opens an unowned mouza as a preview; only the map,
// account (log out) and "back to website" are offered; no notifications.
// Usage (in frontend/): npx vite preview --port 4173 &  node e2e/browse-preview.mjs [outDir]
import { chromium } from '@playwright/test';
import { mockFor } from './smoke-mocks.mjs';

const BASE = 'http://localhost:4173';
const OUT = process.argv[2] || 'e2e/shots';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const base = mockFor('user');
await page.route('**/*', async (route) => {
  const p = decodeURIComponent(new URL(route.request().url()).pathname);
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (p === '/api/me/browse/mouzas/Lodhran') return json({ tehsil: 'Lodhran', mouzas: [{ name: 'Kot 7', own: false }], preview: { used: 1, limit: 10, left: 9 } });
  if (p.startsWith('/api/geojson/') || p.startsWith('/Metadata/') || p.startsWith('/api/pmtiles/')) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'PREVIEW_TILES_ONLY' }) });
  return base(route);
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) process.exitCode = 1; };

await page.goto(`${BASE}/?browse=all&t=Lodhran&m=Kot%207`, { waitUntil: 'networkidle' });
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
check('deep link opens preview mouza', (await page.locator('.preview-banner').innerText().catch(() => '')).includes('Kot 7'));
check('deep link cleaned from address bar', !page.url().includes('browse='));
check('banner has website link', await page.locator('.preview-banner a', { hasText: 'Website' }).count() === 1);
check('street basemap in preview', (await page.locator('#map-base-layer-select').inputValue()) === 'Google Streets');
check('no notification badge', await page.locator('.notification-badge').count() === 0);

await page.locator('#profile-notification-btn').click();
await page.waitForTimeout(300);
check('profile opens account panel, not notifications', await page.locator('.preview-account').count() === 1);
check('account panel: website + logout', (await page.locator('.preview-account').innerText()).includes('Back to website') && (await page.locator('.preview-account').innerText()).includes('Log out'));
await page.keyboard.press('Escape');
await page.locator('#profile-notification-btn').click();

await page.locator('.navbar-brand-custom').click();
await page.waitForTimeout(400);
const items = await page.locator('.modern-sidebar nav').innerText();
check('menu: only full access, website, logout', items.includes('Back to website') && items.includes('Logout') && !items.includes('Saved Layers') && !items.includes('Guided Tutorials'));
await page.screenshot({ path: `${OUT}/browse-preview.png` });

// The mocks serve no map data, so 'GeoJSON not found' is expected here.
const real = errors.filter((m) => !/GeoJSON not found/.test(m));
check('no page errors', real.length === 0);
if (real.length) console.log(real);
await b.close();
