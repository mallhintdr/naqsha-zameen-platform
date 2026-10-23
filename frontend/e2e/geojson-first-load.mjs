// Reproduces: GeoJSON (mobile) mode, first mouza selection flies to the mouza but murabba
// outlines are not drawn; the second selection draws them.
// Serves synthetic murabba squares as each mouza's GeoJSON. Usage (in frontend/):
//   npx vite build && npx vite preview --port 4173 &   node e2e/geojson-first-load.mjs <outDir>
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';

const OUT = process.argv[2] || 'e2e/geojson-shots';
const BASE = 'http://localhost:4173';
fs.mkdirSync(OUT, { recursive: true });

const REAL = process.env.REAL_DIR; // folder with <mouza>.geojson built by e2e/pmtiles-to-geojson.mjs
const TEHSIL = REAL ? 'Lodhran' : 'Test';
const MOUZAS = REAL
  ? Object.fromEntries(fs.readdirSync(REAL).filter((f) => f.endsWith('.geojson')).map((f) => [f.replace(/\.geojson$/, ''), null]))
  : { 'Chak A': [29.60, 71.60], 'Chak B': [29.66, 71.70] };
function mouzaGeoJson([lat, lng]) {
  const d = 0.0055; // ~600 m murabba
  const features = [];
  let n = 1;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const y = lat + r * d, x = lng + c * d;
    features.push({ type: 'Feature', properties: { Murabba_No: String(n++), layer_type: 'murabba' },
      geometry: { type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] } });
    if (process.env.WITH_KILLAS) for (let kr = 0; kr < 5; kr++) for (let kc = 0; kc < 5; kc++) {
      const k = d / 5, ky = y + kr * k, kx = x + kc * k;
      features.push({ type: 'Feature', properties: { Murabba_No: String(n - 1), Killa: String(kr * 5 + kc + 1) },
        geometry: { type: 'Polygon', coordinates: [[[kx, ky], [kx + k, ky], [kx + k, ky + k], [kx, ky + k], [kx, ky]]] } });
    }
  }
  return { type: 'FeatureCollection', features };
}
const user = { userId: 'm', userName: 'Mobile', userType: process.env.AS_ADMIN ? 'admin' : 'user', status: 'Active', subscriptionType: 'Yearly', daysRemaining: 300,
  tehsilAccess: [{ tehsil: TEHSIL, mouzas: Object.keys(MOUZAS) }], activeTehsil: TEHSIL, mauzaList: Object.keys(MOUZAS), ipMisuse: { warn: false, count30: 1 } };

async function mock(route) {
  const url = new URL(route.request().url());
  const p = decodeURIComponent(url.pathname);
  const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.origin !== BASE) return /google\.com|arcgis|carto|openstreetmap/.test(url.host) ? route.fulfill({ status: 204 }) : route.continue();
  if (p === '/api/csrf-token') return json({ csrfToken: 'x.y' });
  if (p === '/api/profile') return json(user);
  if (p === '/api/notifications') return json({ notifications: [] });
  if (p.startsWith('/api/mauza-list/')) return json(Object.keys(MOUZAS));
  if (p.startsWith('/api/geo/')) return json({ latOffset: 0, lngOffset: 0 });
  if (p === '/api/user-layers') return json([]);
  // Mouza metadata (store.selectMauza -> shiftResult). Arrives after the GeoJSON, like on the live server.
  if (/^\/Metadata\/[^/]+\/[^/]+\.json$/.test(p) && !/-(Murabba|Killa|Metadata)\.json$/.test(p)) {
    await new Promise((r) => setTimeout(r, Number(process.env.META_DELAY || 0)));
    return json({ murabbas: {} });
  }
  if (p.startsWith('/Shajra Parcha/')) { await new Promise((r) => setTimeout(r, Number(process.env.SHAJRA_DELAY || 0))); return json({ message: 'nf' }, 404); }
  const m = p.match(/^\/JSON Murabba\/[^/]+\/(.+)\.geojson$/);
  if (m && m[1] in MOUZAS) {
    await new Promise((r) => setTimeout(r, Number(process.env.GEO_DELAY || 0)));
    return REAL ? route.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(`${REAL}/${m[1]}.geojson`) }) : json(mouzaGeoJson(MOUZAS[m[1]]));
  }
  if (p.startsWith('/socket.io')) return route.abort();
  if (p.startsWith('/api/') || /^\/(Metadata|JSON Murabba|Shajra Parcha|pmtiles|tiles)\//.test(p)) return json({ message: 'nf' }, 404);
  return route.continue();
}

const browser = await chromium.launch();
const ctx = await browser.newContext(process.env.DESKTOP ? { viewport: { width: 1280, height: 800 } } : { ...devices['Pixel 7'] });
await ctx.addInitScript((mode) => { try { localStorage.setItem('nz_welcome_tour_done', '1'); if (mode) localStorage.setItem('admin_map_mode', mode); } catch {} }, process.env.MAP_MODE || '');
const page = await ctx.newPage();
await page.route('**/*', mock);
const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

async function pick(name) {
  await page.click('#mauza-dropdown');
  await page.waitForTimeout(300);
  await page.getByText(name, { exact: true }).last().click();
  await page.waitForTimeout(Number(process.env.SETTLE || 7000));
  const r = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.leaflet-container path')];
    const byPane = {};
    for (const p of all) { const pn = [...(p.closest('.leaflet-pane')?.classList || [])].find((c) => c.endsWith('-pane') && c !== 'leaflet-pane') || '?'; byPane[pn] = (byPane[pn] || 0) + 1; }
    const pane = document.querySelector('.leaflet-fallbackGeoJson-pane');
    const paths = pane ? [...pane.querySelectorAll('path')] : [];
    const vis = paths.filter((p) => { const b = p.getBoundingClientRect(); return b.width > 2 && b.height > 2 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth; });
    const svg = pane?.querySelector('svg');
    const sb = svg?.getBoundingClientRect();
    return { byPane, totalPaths: all.length, pane: !!pane, paneVisibility: pane ? getComputedStyle(pane).visibility : '-', animating: document.querySelector('.leaflet-container')?.classList.contains('map-animating'),
      paths: paths.length, visiblePaths: vis.length, svg: sb ? `${Math.round(sb.x)},${Math.round(sb.y)} ${Math.round(sb.width)}x${Math.round(sb.height)}` : 'none',
      zoom: window.leafletMap?.getZoom?.() };
  });
  await page.screenshot({ path: `${OUT}/${name.replace(/\s/g, '_')}.png` });
  console.log(name, JSON.stringify(r));
}
const names = Object.keys(MOUZAS);
await pick(names[0]);
await pick(names[1]);
await pick(names[0]);
console.log('--- relevant console lines');
for (const l of logs.filter((l) => /GeoJSON|renderer|PAGEERROR|cleanup/i.test(l)).slice(0, 25)) console.log('  ', l.slice(0, 160));
await browser.close();
