# Naqsha Zameen: critical review and roadmap (October 2026)

Scope: the rebuilt dashboard (`frontend/`), the API (`backend/`), the PMTiles worker (`cloudflare-worker/`), the new marketing website (`site/`, live at naqsha-zameen.pk), and the planned payment gateway.

Detailed evidence, with file and line references, is in four companion reports:

| Report | Covers |
|---|---|
| `docs/review/review-frontend.md` | Dashboard architecture, design system, accessibility, performance, future-proofing |
| `docs/review/review-backend.md` | Scaling to 100x, security, operations, target architecture and costs |
| `docs/review/review-site.md` | Website conversion, SEO, design, engineering, recommended site structure |
| `docs/review/review-payments.md` | Gateway choice, payment flows, data model, security, rollout |

The most serious findings were re-checked by hand. One reviewer claim was wrong and is corrected here (item M3).

---

## 1. The short version

The product is in better shape than most two-year codebases. The rebuild removed the worst front-end debt, the backend already does the hard things (CSRF, bcrypt, rate limits, signed tile URLs, Redis-backed queues), and the domain logic is rich.

What stands between it and "world class at 100x" is not a rewrite. It is about a dozen specific gaps, in four groups:

1. **Protect the paid asset.** The map tiles can be downloaded by anyone today.
2. **Make background work and real-time safe on more than one process**, before money flows through them.
3. **Cut the per-user request load** so 100x users does not mean 100x servers.
4. **Give the website and dashboard one face, prices, and a checkout**, which is where the payment gateway fits.

---

## 2. Findings, ranked

### Critical: fix before scaling or taking online payments

**C1. Paid map data is publicly downloadable.**
The deployed Cloudflare worker is `pmtiles-worker-simple.js` (`cloudflare-worker/wrangler.toml:10`). It does no token check; it only looks at the `Origin` header, which any script can fake. The backend already signs URLs with HMAC, and a validating worker (`pmtiles-worker.js`) already exists but is not deployed.
*Fix:* deploy `pmtiles-worker.js` with `wrangler secret put PMTILES_SIGNING_KEY` (same key as the backend), test one mouza, then switch `main`. One afternoon's work, and it closes the biggest business risk in the system.

**C2. Background jobs run once per pm2 worker.**
`server.js:576-589` starts the hourly unverified-account purge, the daily multi-device warning, the sub-admin expiry notices and the fallback scheduler inside every cluster worker (`pm2 -i max`). On an 8-core VPS each job runs 8 times: 8 identical emails or notifications, and 8 concurrent deletes.
*Fix (now):* run them only when `process.env.NODE_APP_INSTANCE === '0'`, or always through BullMQ repeatable jobs, which de-duplicate across processes. *Fix (target):* a separate `worker` process (section 4). This must be done before any payment job exists, or reminders and reconciliation will repeat.

**C3. Each open tab costs about 6 requests a minute, forever.**
The frontend polls notifications every 12 s on top of an open Socket.io connection, plus a 60 s heartbeat (`frontend/src/features/auth/AuthProvider.tsx`). The poll was added because sockets were unreliable across pm2 workers. At 100x today's users this alone is thousands of requests per second of pure overhead.
*Fix:* poll only while the socket is disconnected, and pause polling and the heartbeat when the tab is hidden. Use a `BroadcastChannel` so one tab per browser holds the socket and shares events. Expected effect: over 90% fewer requests with no visible change.

### High

**H1. Every authenticated request reads the user from MongoDB** (`backend/middleware/authMiddleware.js:45`), including every tile and data request. *Fix:* cache `{tokenVersion, userType, status, tehsilAccess}` in Redis for 60 s, and clear it on the same events that bump `tokenVersion`.

**H2. Long-lived and unrevocable tokens.** JWTs last 30 days, including impersonation tokens. Demo-link tokens are signed without `tokenVersion` (`authController.js:849`), and the middleware accepts that (`authMiddleware.js:48`), so they cannot be revoked. *Fix:* impersonation tokens expire in 2 hours; demo tokens carry `tokenVersion`; plan a short access token plus refresh rotation.

**H3. No automated tests, and type checking is off.** The backend has none; the frontend has 2 unit files and the smoke test. TypeScript runs with `strict: false`, and the 14,400-line map core is untyped JavaScript. *Fix:* start where money and access live. Add API tests for login, renewal, activation and pricing (Vitest + supertest + mongodb-memory-server). Add Playwright flows for register, login, renew and draw-and-save. Turn on `strict` folder by folder, starting with `shared/` and `features/auth/`.

**H4. Dependency vulnerabilities.** `npm audit --omit=dev` in `backend/` reports 13 (11 high). *Fix:* update now, then add Dependabot or Renovate to the repo.

**H5. Files live on the API server's disk.** Map data (`backend/data`) is served by Node with a directory listing per path segment on misses (`server.js:320-360`). Payment proofs are stored on local disk, and Puppeteer PDF rendering runs inside the API process. None of this survives a second server. *Fix:* move map data and payment proofs to the R2 bucket you already pay for (signed URLs, as for tiles). Move the operations-report renderer into the worker process.

**H6. The dashboard has no error boundaries.** One thrown error in the map blanks the whole app. *Fix:* a boundary per route with a "Something went wrong, reload" screen. Report errors to Sentry or self-hosted GlitchTip, which also covers the silent `catch {}` blocks.

**H7. The website has no prices and no working sign-up path.** There is no pricing page. `naqsha-zameen.pk/register` returns 404. On phones, content below the hero stays invisible until a scroll script runs (`site/src/layouts/Base.astro:219-245`). *Fix:* a `/pricing` page fed by the backend price table; a 301 from `/register` and `/login` to the dashboard; content visible by default, with animation only as an enhancement.

**H8. Deploys reset the server working tree.** `deploy.sh` runs `git reset --hard` with no tests, health gate or rollback. *Fix:* run in CI (GitHub Actions) on every push: typecheck, lint, tests and build. Deploy only tagged builds. After `pm2 reload`, check `/health`, and roll back to `build_prev` if it fails. Keep the last two builds.

### Medium

**M1. Statistics endpoints scan whole collections on each load** (`statsController.js:67-219`, about 10 counts and aggregations). User search uses unanchored case-insensitive regex, which cannot use an index. *Fix:* cache stats in Redis for 5 minutes; add a MongoDB text or Atlas Search index for user search; pre-aggregate daily figures with a nightly job.

**M2. Heartbeats write to MongoDB every minute per user** (unless Redis buffering is active), and the cache-invalidation bus polls MongoDB every 5 s per worker. *Fix:* keep heartbeats in Redis only and flush to MongoDB every 5 minutes; switch the cache bus to Redis pub/sub.

**M3. Real-time depends on Redis without saying so.** The Redis adapter *is* wired (`socketService.js:43`), but only if Redis is reachable at start-up. Otherwise each worker has its own sockets, and notifications reach only some users. The client also falls back to HTTP long-polling, which needs sticky sessions under pm2 cluster mode. *Fix:* treat Redis as required in production (fail the health check if it is down), and use websocket transport only behind nginx.

**M4. Design tokens are bypassed.** There are about 474 hard-coded hex colours across features. The cyan `#00ffff` accent has roughly 1.25:1 contrast on white (it reads well only on the dark navy). There are few ARIA attributes, and the custom pickers are not accessible to keyboard or screen readers. *Fix:* move the remaining colours into named tokens, keep cyan for dark surfaces only, and use the darker `#0096c7`/`#0e7490` on light ones. Rebuild the mouza and date pickers on Radix primitives.

**M5. Heavy bundles.** The map page is 840 kB (223 kB gzip), Aks Shajra 764 kB, and charts about 100 kB gzip. *Fix:* load PDF export libraries on click only; split Geoman and drawing tools from the viewing path; add bundle-size budgets in CI. Mid-range Android phones on 4G are the real target device.

**M6. No Urdu, no right-to-left layout, no offline mode.** Your users are patwaris and landowners, often in the field. *Fix:* add i18n now (react-i18next, with English as source and Urdu next), using logical CSS properties so RTL works. Add a service worker that caches the app shell and recently viewed mouzas, so the map opens with poor signal. It must stay compatible with `push-sw.js` and the version checker.

**M7. The website and dashboard look like two companies.** The site uses indigo and cyan, the dashboard navy, cyan and gold. The site loads three Google font families including Noto Nastaliq, and a 378 KB logo PNG is used as its favicon. *Fix:* one shared token file (colours, type scale, radius) consumed by both Tailwind configs. Self-host fonts, use Noto Nastaliq only on Urdu text, and serve an SVG favicon and WebP logo.

**M8. The website's visitor counter has never counted a visit.** It POSTs to `/api/site-visits`, which does not exist; the backend has `GET /api/visit.gif` (`backend/routes/statsRoutes.js:13`). *Fix:* point the counter at the existing endpoint.

### Low

- Controllers of 40-55 KB mix HTTP handling and business rules; extract services as they are touched (payments will force this for renewals).
- Consider `/api/v1` before the mobile or partner clients mentioned in the plan exist.
- Notification permission is requested on login without a user click; ask in context ("Get renewal reminders?").
- The website's AdSense scaffolding is switched off; remove it from a paid product site. Replace the personal Gmail contact with a domain address, and add NTN and a business address.
- `site/` is untracked in git; add `site/dist`, `site/.astro` and log files to `.gitignore`, then commit the source.

### Things that are already right (keep them)

- Passwords hashed with bcrypt; plain-text password field removed.
- Stateless, cookie-bound CSRF tokens; Helmet; rate limits backed by Redis.
- HMAC-signed tile URLs with expiry (only the worker side is missing).
- BullMQ queues already exist for push and reports.
- Indexed lowercase login fields; `.env` files never committed.

---

## 3. Payment gateway: the recommendation

Full design: `docs/review/review-payments.md`.

1. **Gateway:** PayFast (APPS, licensed by the State Bank) hosted checkout first. One integration covers JazzCash and Easypaisa wallets, Raast and cards, and card data never touches your servers (lightest PCI scope, SAQ-A). Add the direct JazzCash API later only if its fees are meaningfully lower. Fees and settlement terms were not publicly available for 2026; confirm them during onboarding.
2. **Keep the manual flow** (account numbers + WhatsApp receipt) as a permanent "Other ways to pay" option.
3. **Money is only confirmed server-to-server.** A new `Payment` collection holds the frozen amount, price-table version, idempotency key and gateway transaction id. Only the gateway's signed notification, or a server-side status check, can mark an order paid; the browser's return page only shows status.
4. **One fulfilment path.** A paid order runs the same renewal code the admin's manual activation runs today (extracted from `userController.updateUser`). It writes the same `RENEWED` account event with request key `pay:<orderId>`, so duplicates are impossible.
5. **Scope:**
   - **First:** direct customers renewing, and mouza-change invoices.
   - **Then:** sub-admins paying their platform bills; payment lifts warnings and suspensions automatically.
   - **Sub-admins' own customers:** keep paying the sub-admin, as today. Platform-collected payouts can come later.
6. **Prerequisites you need to arrange:** NTN, a business bank account, gateway KYC, and refund, terms and privacy pages on the website.
7. **Rollout:** about 3 weeks of development. Sandbox, then a live pilot for admins only, then all direct users, then sub-admins.

**Critical items C2 and H8 must be done before payments go live.** Without them, payment reminders and reconciliation jobs would run several times, and a bad deploy could break checkout with no rollback.

---

## 4. Target architecture for 100x

Detailed staged path and costs: `docs/review/review-backend.md`.

| Stage | When | Change | Rough monthly cost |
|---|---|---|---|
| 0 | Now | Items C1-C3, H1, H4, H8 on the current VPS | Current ($10-25) |
| 1 | ~10x users | MongoDB Atlas with replica set and backups; Redis required; map data and uploads on R2; a separate job worker process; error tracking | $90-150 |
| 2 | ~100x users | 2+ API nodes behind a load balancer; managed Redis; Cloudflare in front of the dashboard; read replicas for statistics | $300-700 |

Today's app talks to a single process with local files. Stage 1 is the important step: once files are on R2 and jobs are in their own process, adding API servers becomes a configuration change rather than a project.

---

## 5. Making it feel world class

**Dashboard**
1. Skeleton loaders instead of spinners on lists, Insights and the map selectors.
2. Urdu interface option, with right-to-left layout and Noto Nastaliq for Urdu text.
3. Works offline in the field for recently viewed mouzas (installable app).
4. Faster first map paint on phones: load the viewer first and drawing tools on demand.
5. A "Pay now" button in the renewal warning, with instant activation and a PDF receipt.
6. Accessible, searchable pickers for tehsil, mouza and murabba, with recent selections remembered.
7. Friendly error screens with a retry button, never a blank page.
8. Readable contrast on light surfaces; cyan kept for the dark chrome.
9. A notification prompt that asks at the right moment, not at login.
10. A first-run guided tour that starts automatically for new users (the 9 tours already exist).

**Website**
1. A pricing page, and "Start free trial" buttons that carry the chosen plan and tehsil into dashboard registration.
2. A coverage page listing available tehsils, with one page per tehsil, which is also strong for search in Urdu and English.
3. Real screenshots and a short screen recording of the map, instead of an illustration.
4. Trust block: company registration and NTN, address, WhatsApp, testimonials from patwaris and dealers.
5. An Urdu version at `/ur/`.
6. Structured data for search (Organization, LocalBusiness, Service, FAQ, Offer), security headers, and one canonical domain. Today `www` redirects to the bare domain; choose one and use it everywhere.

---

## 6. Suggested order of work

| # | Work | Size | Why first |
|---|---|---|---|
| 1 | Deploy the validating tile worker (C1) | Half a day | Stops data theft today |
| 2 | Single-instance jobs (C2), update dependencies (H4) | 1 day | Correctness and security |
| 3 | Socket-first notifications and hidden-tab pause (C3) | 1-2 days | Biggest load reduction |
| 4 | CI with tests on critical flows, safer deploy (H3, H8) | 3-5 days | Required before payments |
| 5 | Website fixes: pricing, redirects, mobile visibility, counter (H7, M8) | 2-3 days | Conversion |
| 6 | Payment gateway (section 3) | ~3 weeks after merchant approval | Revenue; start KYC now, in parallel |
| 7 | Error boundaries and error tracking (H6) | 1 day | Visibility |
| 8 | Auth caching and token lifetimes (H1, H2) | 2 days | Load and security |
| 9 | Move files to R2, separate worker process (H5, stage 1) | 1-2 weeks | Unlocks horizontal scaling |
| 10 | Urdu, offline, design-token clean-up, accessibility (M4, M6, M7) | Ongoing | World-class experience |

Merchant onboarding with the gateway takes weeks, so start the paperwork now, while items 1-5 are done.
