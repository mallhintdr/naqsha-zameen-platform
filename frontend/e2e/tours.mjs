// Runs every guided tour end to end in a real browser (production build on :4173),
// against real map tiles and imagery; login/profile are stubbed as a regular customer.
// Usage (in frontend/): npx vite build && npx vite preview --port 4173 &  node e2e/tours.mjs <outDir> [tourTitleFilter]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const OUT = process.argv[2] || 'e2e/tour-shots';
const ONLY = process.argv[3] || '';
const BASE = 'http://localhost:4173';
const WORKER = 'https://pmtiles-worker.mallhintdr.workers.dev';
const TEHSIL = 'Lodhran';
fs.mkdirSync(OUT, { recursive: true });

// The secured worker no longer lists mouzas; use the dashboard's public list, else a fixed one.
const mouzas = await fetch(`https://dashboard.naqsha-zameen.com/api/mauza-list/${TEHSIL}`).then((r) => r.json()).then((l) => (Array.isArray(l) && l.length ? l.filter((m) => /^[A-Za-z0-9]/.test(m)).slice(0, 40) : null)).catch(() => null)
  || ['Lodhran', 'Kahror Pacca', 'Dunyapur'];
const user = {
  userId: 'tour.user', userName: 'Tour User', userType: 'user', status: 'Active', subscriptionType: 'Monthly', daysRemaining: 20,
  startDate: new Date(Date.now() - 10 * 864e5).toISOString(), endDate: new Date(Date.now() + 20 * 864e5).toISOString(),
  tehsilAccess: [{ tehsil: TEHSIL, mouzas }], activeTehsil: TEHSIL, mauzaList: mouzas, mobileNumber: '+92 300 0000000',
  provider: { name: 'GeoMatrix', jazzcash: { title: 'Muhammad', number: '0300 0000000' }, easypaisa: { title: 'Muhammad', number: '0300 0000000' }, whatsapp: '920000000000' },
  ipMisuse: { warn: false, count30: 1, count7: 1, devices30: [] },
};
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

async function mock(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = decodeURIComponent(url.pathname);
  const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (url.origin !== BASE) return route.continue();
  if (p === '/api/csrf-token') return json({ csrfToken: 'x.y' });
  if (p === '/api/profile') return json(user);
  if (p === '/api/notifications') return json({ notifications: [
    { id: 'n1', type: 'subscription', title: 'Subscription renewed', message: 'Your Monthly plan is active until next month.', timestamp: new Date().toISOString(), read: false },
    { id: 'n2', type: 'info', title: 'Message from GeoMatrix', message: 'Your mouza change request was approved.', timestamp: new Date(Date.now() - 3600e3).toISOString(), read: true },
  ] });
  if (p === '/api/tehsil-list') return json([TEHSIL]);
  if (p.startsWith('/api/mauza-list/')) return json(mouzas);
  if (p.startsWith('/api/geo/adjustment/')) return json({ latOffset: 0, lngOffset: 0 });
  if (p.startsWith('/api/geo/shifted-mouzas/')) return json([]);
  if (p === '/api/user-layers') return req.method() === 'POST' ? json({ _id: 'l1', name: 'Test Layer 101', geojson: JSON.parse(req.postData() || '{}').geojson, updatedAt: new Date().toISOString() }, 201) : json([]);
  if (p === '/api/me/assignment-requests/current') return json({ request: null });
  if (p === '/api/pmtiles/signed-url') {
    const b = JSON.parse(req.postData() || '{}');
    const file = b.filename ? `${b.tehsil}/${b.filename}` : b.murabba ? `${b.tehsil}/${b.mouza}/${b.murabba}.pmtiles` : `${b.tehsil}/${b.mouza}.pmtiles`;
    return json({ success: true, url: `${WORKER}/${enc(file)}`, expiresAt: Date.now() + 3600e3 });
  }
  if (p.startsWith('/socket.io')) return route.abort();
  if (p.startsWith('/api/') || /^\/(Metadata|JSON Murabba|Shajra Parcha|pmtiles|tiles)\//.test(p)) return json({ message: 'not here' }, 404);
  return route.continue();
}

const browser = await chromium.launch();
async function runTour(title, viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, permissions: ['geolocation'], geolocation: { latitude: 29.6077, longitude: 71.6224, accuracy: 8 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('nz_welcome_tour_done', '1'); } catch {} });
  const page = await ctx.newPage();
  await page.route('**/*', mock);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  await page.click('.navbar-brand-custom');
  await page.waitForTimeout(400);
  await page.getByText('📚 Guided Tutorials').click();
  await page.waitForTimeout(300);
  await page.locator('.submenu-item, .submenu-accordion button, .submenu-accordion a').filter({ hasText: title }).first().click({ timeout: 8000 });

  const slug = title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
  const steps = [];
  for (let i = 0; i < 40; i++) {
    const tip = page.locator('.tour-tooltip');
    try { await tip.waitFor({ timeout: 15000 }); } catch { errors.push(`no tooltip at step ${i + 1}`); break; }
    const next = page.locator('.tour-next');
    for (let w = 0; w < 60 && (await next.isDisabled().catch(() => false)); w++) await page.waitForTimeout(500);
    await page.waitForTimeout(700);
    const stepTitle = (await tip.getAttribute('aria-label')) || '';
    const box = await tip.boundingBox();
    const offscreen = !box || box.x < -1 || box.y < -1 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1;
    const hl = await page.locator('.tour-highlight').boundingBox().catch(() => null);
    steps.push({ step: i + 1, title: stepTitle, offscreen, highlight: Boolean(hl && hl.width > 2) });
    await page.screenshot({ path: `${OUT}/${tag}-${slug}-${String(i + 1).padStart(2, '0')}.png` });
    const label = (await next.textContent()) || '';
    if (process.env.DEBUG_TOURS) {
      const info = await page.evaluate(() => { const b = document.querySelector('.tour-next'); if (!b) return 'no btn'; const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); const cs = getComputedStyle(b); return `top=${el?.tagName}.${(el?.className || '').toString().slice(0, 80)} id=${el?.id} pe=${cs.pointerEvents} bodyPE=${getComputedStyle(document.body).pointerEvents} inert=${!!b.closest('[inert]')} ariaHidden=${!!b.closest('[aria-hidden=true]')}`; });
      console.log('   debug step', i + 1, info);
    }
    try { await next.click({ timeout: 8000 }); } catch (e) { errors.push(`step ${i + 1} Next not clickable: ${String(e.message).slice(0, 120)}`); break; }
    if (label.includes('Finish')) break;
  }
  await page.waitForTimeout(1500);
  await ctx.close();
  return { steps, errors };
}

const TOURS = [
  'Dashboard Quick Tour (start here)', 'Mouza & Murabba Selection Tour', 'Killa Area & Measurements Tour', 'Base Map Layers Tour',
  'Location & Tracking Tour', 'Go to Coordinates Tour', 'Compass & Map Rotation Tour', 'Map Drawing Tools Tour',
  'Save & Open Custom Layers Tour', 'Notifications Tour', 'Profile, Subscription & Renewal Tour', 'Request a Mouza Change Tour',
  'Shift Mouza (Offsets) Tour', 'Cache & Performance Tour', 'Multi-Device Security Tour', 'Change Password Tour',
].filter((t) => !ONLY || t.toLowerCase().includes(ONLY.toLowerCase()));

let bad = 0;
for (const [vp, tag] of [[{ width: 1280, height: 800 }, 'desk'], [{ width: 390, height: 844 }, 'phone']]) {
  for (const t of TOURS) {
    const { steps, errors } = await runTour(t, vp, tag);
    const issues = [...errors, ...steps.filter((s) => s.offscreen).map((s) => `step ${s.step} tooltip off-screen`), ...steps.filter((s) => !s.highlight).map((s) => `step ${s.step} no highlight`)];
    if (issues.length) bad++;
    console.log(`${issues.length ? 'FAIL' : 'ok  '} ${tag.padEnd(5)} ${t.padEnd(34)} ${steps.length} steps${issues.length ? '\n       ' + [...new Set(issues)].slice(0, 5).join('\n       ') : ''}`);
  }
}
await browser.close();
console.log(bad ? `\n${bad} tour runs with issues` : '\nall tours ran cleanly');
