// Runtime smoke test: loads every route against a mocked backend and reports page errors.
// Usage: (in frontend/) npx vite preview --port 4173 &  then  node e2e/smoke.mjs [outDir]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = process.env.SMOKE_BASE || 'http://localhost:4173';
const OUT = process.argv[2] || 'e2e/shots';
fs.mkdirSync(OUT, { recursive: true });

const users = {
  admin: { userId: 'admin1', userName: 'Admin One', userType: 'admin', status: 'Active', subscriptionType: 'Permanent', daysRemaining: 99999,
    tehsilAccess: [{ tehsil: 'Bahawalpur', mouzas: ['Chak 1', 'Chak 2'] }, { tehsil: 'Lodhran', mouzas: ['Chak 9'] }], activeTehsil: 'Bahawalpur' },
  user: { userId: 'user1', userName: 'User One', userType: 'user', status: 'Active', subscriptionType: 'Monthly', daysRemaining: 3,
    startDate: '2026-10-01', endDate: '2026-10-26', tehsilAccess: [{ tehsil: 'Bahawalpur', mouzas: ['Chak 1'] }], activeTehsil: 'Bahawalpur',
    provider: { name: 'GeoMatrix', jazzcash: { title: 'M', number: '0300' }, easypaisa: { title: 'M', number: '0300' }, whatsapp: '923048840264' },
    ipMisuse: { warn: false, count30: 1 } },
  subadmin: { userId: 'sub1', userName: 'Sub One', userType: 'subadmin', status: 'Active', subscriptionType: 'Permanent',
    tehsilAccess: [{ tehsil: 'Bahawalpur', mouzas: ['Chak 1'] }], activeTehsil: 'Bahawalpur' },
};

const ROUTES = {
  anon: ['/login', '/register', '/reset-password?token=x', '/verify-email?token=x', '/activate/t1', '/subadmin/activate/t1', '/confirm-email/t1'],
  admin: ['/', '/users', '/users/user1', '/admin/register', '/stats', '/admin/subadmins', '/admin/land-allotments', '/admin/operations-report', '/aks-shajra', '/admin/activate/t1'],
  user: ['/', '/users/user1'],
  subadmin: ['/subadmin', '/subadmin/users'],
};

function mockFor(role) {
  return async (route) => {
    const url = new URL(route.request().url());
    const p = decodeURIComponent(url.pathname);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/csrf-token') return json({ csrfToken: 'n.h' });
    if (route.request().resourceType() === 'document') return route.continue(); // page navigations get the SPA
    const sa = { userId: 'sub1', userName: 'Sub One', mobileNumber: '03001234567', email: 's@x.pk', status: 'active', territory: ['Bahawalpur'], customers: 3, active: 2, awaiting: 1, expiring: 0, salesThisMonth: 1000, balance: 500, overdue: 0, paidTotal: 2000, billedTotal: 2500, billedThisMonth: 500 };
    if (p === '/api/admin/subadmins') return json({ subAdmins: [sa] });
    if (p === '/api/admin/subadmins-overview') return json({ pendingRequests: 0, subAdminsInArrears: 0, todayTotal: 0 });
    if (p === '/api/admin/subadmin-requests' || p === '/api/subadmin/requests') return json({ requests: [] });
    if (p === '/api/admin/subadmins-rankings') return json({ rows: [] });
    if (p === '/api/subadmin/me') return json({ profile: { userId: 'sub1', userName: 'Sub One', email: 's@x.pk', mobileNumber: '0300' },
      subAdmin: { status: 'active', territory: ['Bahawalpur'], allowedPlans: ['Trial24', 'Monthly', 'Yearly'], trialQuotaPerMonth: 30, trialMaxMouzas: 1, maxMouzas: 10, paymentDetails: {}, unpaidThreshold: 1000, paymentWindowDays: 3 },
      money: { todayTotal: 0, todayLines: [], balance: 0, overdue: 0, advanceCredit: 0, oldestUnpaid: null }, overview: { total: 3, active: 2, awaiting: 1, expiring: 0 } });
    if (p === '/api/subadmin/users') return json({ users: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 }, counts: {} });
    if (p === '/api/subadmin/today') return json({ total: 0, lines: [] });
    if (p === '/api/subadmin/bills') return json({ bills: [] });
    if (p === '/api/subadmin/payments') return json({ payments: [] });
    if (p === '/api/subadmin/stats') return json({ overview: { total: 3, active: 2, awaiting: 1, expiring: 0 }, series: [], renewals: [] });
    if (p === '/api/profile') return role === 'anon' ? json({ message: 'no' }, 401) : json(users[role]);
    if (p === '/api/notifications') return json({ notifications: [{ id: 'n1', type: 'info', title: 'Hello', message: 'World', timestamp: new Date().toISOString(), read: false }] });
    if (p === '/api/tehsil-list') return json(['Bahawalpur', 'Lodhran']);
    if (p.startsWith('/api/mauza-list/')) return json(['Chak 1', 'Chak 2', 'Chak 10']);
    if (p === '/api/tehsil-groups') return json([]);
    if (p === '/api/users') return json({ users: [users.user], subAdmins: [], statistics: {}, pagination: { page: 1, limit: 20, total: 1, pages: 1 } });
    if (p.startsWith('/api/users/')) return json(users.user);
    if (p === '/stats') return json({ totalUsers: 1, totalOnline: 0, loginStats: {}, sessions: [], tehsilStats: [], dailyActivity: [], subscriptionHealth: {}, registrationsDaily: [] });
    if (['/online-users', '/multi-device-users'].includes(p)) return json([]);
    if (p === '/api/user-layers') return json([]);
    if (p.startsWith('/socket.io')) return route.abort();
    if (p.startsWith('/api/') || /^\/(stats|subscription-stats|user-|location-)/.test(p)) return json({});
    if (/^\/(Metadata|JSON Murabba|Shajra Parcha|pmtiles|tiles)\//.test(p)) return json({ message: 'nf' }, 404);
    if (/google\.com|arcgisonline|cartocdn|openstreetmap|opentopomap|flaticon|noaa/.test(url.host)) return route.fulfill({ status: 204, body: '' });
    return route.continue();
  };
}

const browser = await chromium.launch();
let failures = 0;
for (const [role, paths] of Object.entries(ROUTES)) {
  for (const width of [390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, isMobile: width < 600, hasTouch: width < 600 });
    const page = await ctx.newPage();
    await page.route('**/*', mockFor(role));
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|socket\.io|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`); });
    for (const path of paths) {
      errors.length = 0;
      try {
        await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 });
      } catch (e) { errors.push(`goto: ${e.message.split('\n')[0]}`); }
      await page.waitForTimeout(800);
      const blank = await page.evaluate(() => (document.querySelector('#root')?.innerText || '').trim().length === 0 && !document.querySelector('canvas,.leaflet-container'));
      const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (blank) errors.push('blank page');
      if (hScroll && path !== '/aks-shajra') errors.push(`horizontal page scroll (${await page.evaluate(() => document.documentElement.scrollWidth)}px)`);
      const name = `${role}_${width}_${path.replace(/[^a-z0-9]+/gi, '_')}.png`;
      await page.screenshot({ path: `${OUT}/${name}` }).catch(() => {});
      const status = errors.length ? 'FAIL' : 'ok  ';
      if (errors.length) failures++;
      console.log(`${status} ${role.padEnd(8)} ${String(width).padEnd(4)} ${path}${errors.length ? '\n       ' + [...new Set(errors)].slice(0, 4).join('\n       ') : ''}`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} failing page loads` : '\nall pages loaded cleanly');
process.exit(failures ? 1 : 0);
