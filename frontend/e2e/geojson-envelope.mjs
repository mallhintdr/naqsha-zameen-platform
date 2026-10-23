// Real-backend check of the protected vector-data path (docs/security/GEOJSON.md):
// app shell APIs are mocked, but /JSON Murabba, /Metadata, /Shajra Parcha, /api/geojson and
// /api/vector-key go through Vite's proxy to a real backend started with VECTOR_ENVELOPE=true
// (and optionally VECTOR_WATERMARK=true). Asserts the app sends X-NZ-Client, receives the
// envelope, decodes it and draws the mouza in GeoJSON mode.
// Usage (in frontend/):
//   BACKEND_URL=http://localhost:5055 npx vite --port 3055 &
//   AUTH_TOKEN=<jwt for USER_ID> TEHSIL=Khanpur MOUZA="Bait Mughal" node e2e/geojson-envelope.mjs [outDir]
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';

const OUT = process.argv[2] || 'e2e/envelope-shots';
const BASE = process.env.BASE || 'http://localhost:3055';
const TEHSIL = process.env.TEHSIL || 'Khanpur';
const MOUZA = process.env.MOUZA || 'Bait Mughal';
const OTHER = process.env.OTHER_MOUZA || 'Not Mine';
const TOKEN = process.env.AUTH_TOKEN;
if (!TOKEN) throw new Error('AUTH_TOKEN required');
fs.mkdirSync(OUT, { recursive: true });

const user = { userId: process.env.USER_ID || 'u', userName: 'E2E', userType: 'user', status: 'Active', subscriptionType: 'Yearly', daysRemaining: 300,
  tehsilAccess: [{ tehsil: TEHSIL, mouzas: [MOUZA, OTHER] }], activeTehsil: TEHSIL, mauzaList: [MOUZA, OTHER], ipMisuse: { warn: false, count30: 1 } };
const REAL = /^\/(JSON Murabba|Metadata|Shajra Parcha)\/|^\/api\/(vector-key|geojson\/)/;

async function mock(route) {
  const url = new URL(route.request().url());
  const p = decodeURIComponent(url.pathname);
  const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.origin !== BASE) return /google\.com|arcgis|carto|openstreetmap/.test(url.host) ? route.fulfill({ status: 204 }) : route.continue();
  if (REAL.test(p)) return route.continue();
  if (p === '/api/csrf-token') return json({ csrfToken: 'x.y' });
  if (p === '/api/profile') return json(user);
  if (p === '/api/notifications') return json({ notifications: [] });
  if (p.startsWith('/api/mauza-list/')) return json([MOUZA, OTHER]);
  if (p.startsWith('/api/geo/')) return json({ latOffset: 0, lngOffset: 0 });
  if (p === '/api/user-layers') return json([]);
  if (p.startsWith('/socket.io')) return route.abort();
  if (p.startsWith('/api/') || /^\/(pmtiles|tiles)\//.test(p)) return json({ message: 'nf' }, 404);
  return route.continue();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
await ctx.addCookies([{ name: 'authToken', value: TOKEN, url: BASE, httpOnly: true }]);
await ctx.addInitScript(() => { try { localStorage.setItem('nz_welcome_tour_done', '1'); localStorage.setItem('admin_map_mode', 'geojson'); } catch {} });
const page = await ctx.newPage();
await page.route('**/*', mock);
const vector = [];
page.on('response', async (res) => {
  const p = decodeURIComponent(new URL(res.url()).pathname);
  if (!REAL.test(p)) return;
  const h = res.request().headers();
  vector.push({ path: p, status: res.status(), type: res.headers()['content-type'] || '', client: h['x-nz-client'] || '-', accept: (h['accept'] || '').slice(0, 24) });
});
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

async function pick(name) {
  await page.click('#mauza-dropdown');
  await page.waitForTimeout(300);
  await page.getByText(name, { exact: true }).last().click();
  await page.waitForTimeout(Number(process.env.SETTLE || 9000));
  const paths = await page.evaluate(() => document.querySelectorAll('.leaflet-fallbackGeoJson-pane path, .leaflet-geoJsonMouza-pane path').length);
  await page.screenshot({ path: `${OUT}/${name.replace(/\s/g, '_')}.png` });
  return paths;
}
const drawn = await pick(MOUZA);
const drawnOther = await pick(OTHER);
console.log('vector requests:');
for (const v of vector) console.log(`  ${v.status} ${v.type.padEnd(32)} client=${v.client} accept=${v.accept}  ${v.path}`);
console.log(`paths drawn for "${MOUZA}": ${drawn}; after "${OTHER}" (not entitled): ${drawnOther}`);
for (const l of logs) console.log('  ', l.slice(0, 200));
const ok = drawn > 0 && vector.some((v) => v.type.includes('application/x-nz-vector')) && vector.filter((v) => /\.(geo)?json$/.test(v.path)).every((v) => v.client === 'dashboard');
console.log(ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
