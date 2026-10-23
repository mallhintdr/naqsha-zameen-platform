// Captures real dashboard screenshots for the website hero.
// Runs the production build (vite preview on :4173) against the real PMTiles worker and
// satellite imagery; only the login/profile and app chrome API calls are stubbed.
// Usage (in frontend/): npx vite build && npx vite preview --port 4173 &  node e2e/capture-hero.mjs <outDir> [tehsil] [mouza]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const OUT = process.argv[2] || 'e2e/hero';
const TEHSIL = process.argv[3] || 'Lodhran';
const MOUZA = process.argv[4] || '100 M';
const BASE = process.env.CAPTURE_BASE || 'http://localhost:4173';
const WORKER = 'https://pmtiles-worker.mallhintdr.workers.dev';
fs.mkdirSync(OUT, { recursive: true });

const mouzas = (await (await fetch(`${WORKER}/list-mouzas/${encodeURIComponent(TEHSIL)}`)).json()).mouzas || [];
const user = {
  userId: 'demo', userName: 'Demo', userType: 'user', status: 'Active', subscriptionType: 'Yearly', daysRemaining: 300, ipMisuse: { warn: false, count30: 1 },
  tehsilAccess: [{ tehsil: TEHSIL, mouzas }], activeTehsil: TEHSIL, mauzaList: mouzas,
};
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

async function mock(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = decodeURIComponent(url.pathname);
  const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.origin !== new URL(BASE).origin) return route.continue(); // worker, Google tiles, fonts: real network
  if (p === '/api/csrf-token') return json({ csrfToken: 'x.y' });
  if (p === '/api/profile') return json(user);
  if (p === '/api/notifications') return json({ notifications: [] });
  if (p === '/api/tehsil-list') return json([TEHSIL]);
  if (p.startsWith('/api/mauza-list/')) return json(mouzas);
  if (p.startsWith('/api/geo/adjustment/')) return json({ latOffset: 0, lngOffset: 0 });
  if (p.startsWith('/api/geo/shifted-mouzas/')) return json([]);
  if (p === '/api/user-layers' || p === '/api/tehsil-groups') return json([]);
  if (p === '/api/pmtiles/signed-url') {
    const b = JSON.parse(req.postData() || '{}');
    const file = b.filename ? `${b.tehsil}/${b.filename}` : b.murabba ? `${b.tehsil}/${b.mouza}/${b.murabba}.pmtiles` : `${b.tehsil}/${b.mouza}.pmtiles`;
    return json({ success: true, url: `${WORKER}/${enc(file)}`, expiresAt: Date.now() + 3600e3 });
  }
  if (p.startsWith('/socket.io')) return route.abort();
  if (p.startsWith('/api/') || /^\/(Metadata|JSON Murabba|Shajra Parcha|pmtiles|tiles)\//.test(p)) return json({ message: 'not here' }, 404);
  return route.continue();
}

async function shoot(name, viewport, { murabba = false, isMobile = false } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  await page.route('**/*', mock);
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Choose the chak from the header dropdown, like a user would
  await page.click('#mauza-dropdown');
  await page.waitForTimeout(400);
  await page.keyboard.type(MOUZA, { delay: 30 });
  await page.waitForTimeout(600);
  await page.getByRole('menuitem', { name: MOUZA, exact: true }).first().click().catch(async () => {
    await page.getByText(MOUZA, { exact: true }).last().click();
  });
  await page.waitForTimeout(14000); // fly-to + tiles + murabba label extraction

  if (murabba) {
    await page.click('#murabba-dropdown').catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.type(String(murabba), { delay: 30 });
    await page.waitForTimeout(500);
    await page.getByText(String(murabba), { exact: true }).last().click();
    await page.waitForTimeout(12000); // fly to murabba, killa boundaries + labels
  }
  await page.mouse.move(viewport.width - 5, viewport.height / 2); // no hover tooltips
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('saved', `${OUT}/${name}.png`);
  await browser.close();
}

await shoot('dashboard-desktop', { width: 1280, height: 800 });
await shoot('dashboard-killa', { width: 1280, height: 800 }, { murabba: 16 });
await shoot('dashboard-phone', { width: 390, height: 844 }, { murabba: 16, isMobile: true });
