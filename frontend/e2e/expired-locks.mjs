// Expired customer on a phone: basemap falls back to streets, locked items open the Subscribe message.
import { chromium } from '@playwright/test';
import { mockFor } from './smoke-mocks.mjs';
const OUT = process.argv[2] || 'e2e/shots';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const base = mockFor('user');
await page.route('**/*', async (route) => {
  const p = new URL(route.request().url()).pathname;
  if (p === '/api/profile') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    userId: 'user1', userName: 'User One', userType: 'user', status: 'Expired', subscriptionType: 'Monthly', daysRemaining: 0,
    startDate: '2026-01-01', tehsilAccess: [{ tehsil: 'Bahawalpur', mouzas: ['Chak 1'] }], activeTehsil: 'Bahawalpur', ipMisuse: { warn: false } }) });
  return base(route);
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
for (const sel of ['.modal-close', '[aria-label=Close]']) { await page.locator(sel).first().click({ timeout: 1500 }).catch(() => {}); }
await page.waitForTimeout(500);
console.log('basemap', await page.locator('#map-base-layer-select').inputValue());
console.log('options', JSON.stringify(await page.locator('#map-base-layer-select option').allTextContents()));
await page.locator('#leaflet-location-control-btn').click();
await page.waitForTimeout(400);
console.log('after GPS tap:', await page.locator('[role=dialog]').last().innerText().catch(() => 'no dialog'));
await page.screenshot({ path: `${OUT}/expired-gps.png` });
await page.keyboard.press('Escape');
await b.close();
console.log('errors', errors.length ? errors : 'none');
