# Naqsha Zameen Dashboard: Frontend Rebuild and Unified Repo Plan

Status: DRAFT FOR REVIEW. Nothing has been built yet. Every section marked "Decision" needs your answer before that phase starts.

Companion documents (the design record, one file per area, ~2,800 lines, every colour, size, field, button, endpoint and workflow quoted from the current code):

| File | Covers |
|---|---|
| `docs/legacy-inventory/inv-01-chrome.md` | Design tokens, navbar, side menu, all 13 global modals, common components, Bootstrap usage, 20 gotchas |
| `docs/legacy-inventory/inv-02-auth-users.md` | Login, public and admin registration, reset and verify, user list, user edit modal, user detail tabs, subscription and payment UI, 25 gotchas |
| `docs/legacy-inventory/inv-03-admin.md` | Insights (7 tabs, every chart), sub-admin console and dashboard, activation pages, land allotment, operations report, tehsil grouping, payment proof, 30 gotchas |
| `docs/legacy-inventory/inv-04-map.md` | Map page layout, every control, base layers, PMTiles and GeoJSON pipeline, feature styling, drawing tools, guided mobile drawing, Go-To and Shift forms, library replacement table, 20 gotchas |
| `docs/legacy-inventory/inv-05-aksshajra.md` | Aks Shajra digitiser: constants, toolbar, panels, cell editor, export pipeline, 20 gotchas |
| `docs/legacy-inventory/inv-06-api-deploy.md` | ~190 endpoints with auth and payloads, cookie/JWT/CSRF model, socket and push, env vars, PMTiles worker, deployment topology, dead code |

---

## 1. What exists today

**Frontend.** Create React App 5 (react-scripts, webpack 5, no longer maintained), React 18.3, react-bootstrap 2.10 on Bootstrap 5.3, Leaflet 1.9 with react-leaflet 4, Geoman, PMTiles, Recharts 2, react-konva, Font Awesome 6 plus react-icons plus raw emoji for icons. 214 source files, 57,186 lines (10,208 of CSS across 30 stylesheets).

Styling density, which is why a clean rebuild is the right call rather than a migration:

| Metric | Count |
|---|---|
| `!important` declarations | 618 |
| Inline `style={{...}}` objects | 1,217 |
| Bootstrap utility class usages | ~970 |
| Files importing react-bootstrap | 76 |
| Media query breakpoints in use | 14 different values (768px dominates, then 767, 576, 991, 480) |
| Stylesheets that are dead (never imported) | 6 of 30 |
| Source files that are dead (never imported) | 22 |

**Backend.** Express 4 + Mongoose 8 on a Hostinger VPS under pm2 cluster mode, Redis optional (BullMQ, rate limits, socket adapter), Socket.io, web-push, nodemailer, puppeteer for the operations report PDF. It already serves `../build` with an SPA catch-all. It stays unchanged except for three small config items listed in section 7.

**Map data.** PMTiles in a Cloudflare R2 bucket behind a worker (`pmtiles-worker.mallhintdr.workers.dev`), signed by the backend; GeoJSON, metadata JSON and shajra raster tiles served by the backend from `backend/data/` behind cookie auth.

**Hosting split.** The SPA build sits on the o3host shared PHP host at `dashboard.naqsha-zameen.pk`; the API is `api.naqsha-zameen.pk` on Hostinger. Cookies are `Domain=.naqsha-zameen.pk; SameSite=None; Secure` to bridge the two. The two PHP helper files on o3host are dead (one is never called, the other is called against the wrong host), so nothing on o3host needs to survive except the DNS zone.

---

## 2. Goals and non-goals

Goals (from your brief):

1. One repo, deployed as one unit on Hostinger, domain still managed at o3host for now.
2. Frontend rebuilt from scratch on Vite + Tailwind, modern, responsive, scalable, with first-class mobile behaviour.
3. Every form, table, modal, list, button and tab keeps its current colour scheme.
4. Every workflow stays intact against the unchanged backend API.

Non-goals (unless you say otherwise):

- No backend rewrite, no API changes, no database changes.
- No new features. Bugs found in the old code are listed in section 9 as decisions; default is "preserve behaviour, fix only what is clearly broken".
- No native app store build (though the chosen stack leaves that door open, section 4.4).

---

## 3. Target repo layout

```
naqsha-zameen/                      (new git repo, replaces old-repo)
├── package.json                    npm workspaces: frontend, backend
├── deploy.sh                       same flow as today, builds frontend/ into build/
├── .env.example                    documented frontend + backend variables
├── build/                          Vite output (gitignored). server.js serves ../build unchanged
├── frontend/
│   ├── index.html
│   ├── vite.config.ts              outDir ../build, dev proxy for /api, /socket.io, /Metadata,
│   │                               "/JSON Murabba", "/Shajra Parcha", /pmtiles, /stats, ...
│   ├── tailwind.css                @theme tokens (section 5.1)
│   ├── public/                     favicon.svg, logo192/512.png, manifest.webmanifest,
│   │                               push-sw.js (kept byte-identical), meta.json (generated)
│   └── src/
│       ├── app/                    router, providers (auth, query, socket), layouts
│       ├── shared/
│       │   ├── ui/                 Button, Modal, Dropdown, Tabs, Table, Badge, Alert,
│       │   │                       Spinner, Toast, Card, Field... (the design system)
│       │   ├── api/                fetch client, CSRF, endpoints typed per inv-06
│       │   ├── hooks/, utils/      date (GMT+5), phone format, akar, device id, lru
│       │   └── icons/
│       └── features/
│           ├── auth/               login, register (public, admin), reset, verify
│           ├── chrome/             navbar, side menu, notification panel, global modals
│           ├── map/                leaflet core, panes, controls, loaders, draw, guided
│           ├── users/              user list, edit modal, detail tabs, change mouzas
│           ├── admin/              insights, sub-admin console, tools, activation pages
│           ├── subadmin/           dashboard, my customers
│           ├── aks-shajra/         konva digitiser
│           └── tours/              9 hand-rolled tours re-pointed at new DOM ids
├── backend/                        moved as-is from old-repo/backend
├── cloudflare-worker/              worker + wrangler.toml, test files removed
└── docs/                           this plan + legacy-inventory/
```

Why this shape: the backend's `BUILD_ROOT = path.join(__dirname, '..', 'build')` and `deploy.sh` keep working with zero edits; workspaces give one `npm ci` at the root; feature folders map one-to-one onto the inventory documents so parity checking is mechanical.

---

## 4. Technology choices

### 4.1 Core stack (recommended)

| Concern | Choice | Why |
|---|---|---|
| Build | Vite 6, TypeScript (strict off initially, `allowJs` so ported logic can land as JS and be typed later) | Fast HMR, modern output, trivially swaps CRA. TypeScript catches the many prop-plumbing bugs the inventory found. |
| UI runtime | React 19 | Latest stable; all libraries below support it. |
| Styling | Tailwind CSS v4 with CSS-first `@theme` tokens | v4 reads design tokens from CSS, which is exactly how `tokens.css` is written today. No `!important` wars. |
| Headless components | Radix UI primitives via shadcn/ui generator (Dialog, DropdownMenu, Tabs, Tooltip, Popover, Select, Switch, Checkbox) | Accessible, keyboard and touch correct, unstyled so the legacy colours can be applied exactly. Code is copied into the repo, not a dependency you fight. |
| Routing | React Router 7 (library mode) | Same mental model as today's v6 routes; no rewrite of route guards. |
| Server state | TanStack Query 5 | Replaces 60+ ad-hoc axios effects, gives caching, refetch-on-focus (already needed for notifications), abort, retries. |
| Client state | Zustand 5 (already a dependency, unused) | Map selection, UI toggles, tour state. Removes the 30-prop drilling in `App.js`. |
| Forms | react-hook-form + zod | The registration and user-edit forms have 7-step validation chains; zod schemas make them readable and testable. |
| Tables | TanStack Table 8 | Sticky first column, sort, client/server pagination are all needed by six screens. |
| Charts | Recharts 3 | Keep: every chart's colours, margins, tick styles are recorded; porting to another library would risk parity. |
| Icons | lucide-react, plus the emoji the side menu already uses | One tree-shaken icon set instead of Font Awesome (105 raw `<i>` tags) plus react-icons/fa (36 files). Visual mapping table produced in phase 1. |
| Fonts | `@fontsource-variable/inter` self-hosted | The old app declares Inter but never loads it (see Decision D1). Self-hosting avoids a CSP change on the backend. |
| HTTP | native `fetch` wrapper | Keeps the CSRF header, credentials, localhost rewrite and 403 retry logic in one 80-line module instead of axios interceptors spread across files. |
| Realtime | socket.io-client 4 (keep) | Backend is Socket.io; one event (`notification`) only. |
| Dates | date-fns + a tiny GMT+5 helper module | The app has four different locale formats on one screen; centralising them is a prerequisite for any later clean-up (Decision D6). |
| Tests | Vitest (unit), Playwright (e2e + visual parity screenshots) | Parity is verified by screenshotting old vs new at 390px, 768px, 1280px for every screen in the inventory. |
| Lint/format | ESLint 9 flat config + Prettier | |

### 4.2 Map stack

Keep Leaflet 1.9 with Geoman and the hand-written PMTiles canvas renderer, but drop react-leaflet and drive the map imperatively from one hook. Reasons: 90% of the map code already bypasses react-leaflet with `L.Control.extend` and `useMap`; the tours target Geoman's DOM classes; the pane z-index and rotation monkey-patches are documented and portable. Dropped on this page: `react-leaflet`, `leaflet-simple-map-screenshoter` (control was disabled), `protomaps-leaflet` (never imported), `leaflet.locatecontrol`, `leaflet-rotatedmarker`, `leaflet.heat` on the map page (stays for the admin heatmap), `lodash` (undeclared, used for one throttle). Added explicitly: `idb` (currently an undeclared transitive dependency).

MapLibre GL with native PMTiles support is the bigger simplification (would delete the canvas MVT renderer, tooltip density logic and the rotation patches) but it changes the look of labels and the drawing toolbar, and `leaflet-rotate` plus Geoman have no drop-in equivalents. Recommended as a separate later project, not part of this rebuild (Decision D3).

### 4.3 What gets dropped from package.json

`react-scripts`, `@testing-library/*`, `web-vitals`, `bootstrap`, `react-bootstrap`, `react-leaflet`, `react-icons`, `@fortawesome/fontawesome-free`, `react-input-mask` (only used in a dead file), `react-joyride` (only in an unused component), `html2canvas` (unused anywhere), `leaflet-simple-map-screenshoter`, `protomaps-leaflet`, `leaflet.locatecontrol`, `leaflet-rotatedmarker`, `axios`, `uuid` (replace with `crypto.randomUUID`). Kept: `leaflet`, `@geoman-io/leaflet-geoman-free`, `leaflet-rotate`, `pmtiles`, `@mapbox/vector-tile`, `pbf`, `polylabel`, `@turf/turf` (import only the 8 functions used), `leaflet.heat`, `recharts`, `konva`, `react-konva`, `jspdf`, `socket.io-client`, `zustand`, `dompurify`, `@marsidev/react-turnstile`.

### 4.4 Best tooling for mobile (your explicit question)

The single biggest mobile win is not a library, it is building mobile-first with Tailwind's responsive variants and container queries so every table, tab bar and modal has a deliberate phone layout rather than the current scaled-down desktop one. Concretely:

1. **Tailwind v4 + Radix (shadcn)** as above. Radix handles touch targets, focus trapping, scroll locking and `100dvh` safe areas correctly, which is where the current Bootstrap modals struggle (the inventory lists four separate `calc(100dvh - N)` hacks).
2. **Container queries and `dvh` units** instead of the 14 scattered `max-width` breakpoints; `env(safe-area-inset-*)` applied once in the layout shell instead of in three places.
3. **TanStack Table with a card-list renderer under 640px** for the user list, sub-admin list and online-users table, keeping the same status row colours. Today these are horizontally scrolling tables with a frozen first column on phones; that frozen-column pattern will be kept as an option so you can compare both in review.
4. **Bottom-sheet presentation of compact modals on phones** (Radix Dialog styled as a sheet, same header gradient and body colours). This is a presentation change only and is listed as Decision D4 because it is visible.
5. **PWA manifest** with correct icons (the current manifest points at `.ico` files that do not exist). No caching service worker: the version checker and push worker rely on there being exactly one service worker, `push-sw.js`.
6. **Capacitor** is the recommended path if you ever want a Play Store or App Store build: it wraps this exact Vite build with no code changes, and can later expose native geolocation, which would improve the Locate control's accuracy. Not in scope now; the stack is chosen so it is possible.
7. **Playwright device emulation** (Pixel 7, iPhone 14, iPad) in the parity suite so mobile regressions are caught, not reported by users.

---

## 5. Design preservation approach

### 5.1 Tokens

`tokens.css` becomes the Tailwind `@theme` block, one-to-one. Every value is already recorded in inv-01 section 1. The three variables that are referenced but never defined (`--primary-cyan`, `--gradient-danger`, `--secondary-color`) are defined with the values the authors clearly intended (cyan `#00ffff`, red gradient, `#6c757d`).

Component-level colours that live outside tokens today (there are hundreds, all recorded) are grouped into named Tailwind utilities during phase 1 so they are used by name, not re-typed. Examples: `bg-header-gradient` (the dark radial navbar/modal/card-header gradient), `bg-table-header` (`#0f2027 → #203a43 → #2c5364`), `badge-success-gradient`, `tile-tone-primary` (`#e7f1ff` / `#084298`), the four status row colours, the WhatsApp palette of the notification panel, the slate palette of Aks Shajra.

### 5.2 Component library (built once, used everywhere)

Each shared component is specified by the inventory and reviewed against the old app before any screen uses it. Where the legacy CSS cascade produced two different looks for the same component depending on which page loaded first (modal header padding, modal footer button size, dropdown search placeholder opacity), the inventory records both; the plan picks the admin-page look as canonical (Decision D2).

| Component | Legacy source of truth |
|---|---|
| Navbar (42px, dark radial gradient, three rounded dropdowns with sticky search, gold profile button, red badge) | inv-01 §1.4, §1.5, §2 |
| Side menu (240px white offcanvas, 14 items, accordions, toggles, version footer) | inv-01 §1.12, §3 |
| Modal (unified, compact 315px, subscription 300px, sa-wide 1200px, sa-lg 960px, compact-fit) | inv-01 §1.7 |
| Buttons (7 solid + 6 outline variants, sm/lg, icon-only action buttons at scale 0.81) | inv-01 §1.8, §1.9, §1.10 |
| Inputs, selects, textareas, labels, floating labels, dark-gray-border variant | inv-01 §1.8 |
| Cards with dark gradient header and cyan text | inv-01 §1.8 |
| Tables (dark gradient header, cyan th, sticky first column, 4 status row tints, zebra frozen cells) | inv-03 §14.3, inv-02 §11 |
| Badges (6 gradient variants) and alerts (4 pastel variants) | inv-01 §1.7, inv-03 §14.1 |
| Tabs (`compact-tabs` pill style, active `#e0f2fe/#0ea5e9`; UserDetail tab bar; mobile select fallback under 576px) | inv-03 §14.1, inv-02 §13 |
| KPI stat tiles (7 tones) | inv-03 §14.1 |
| Subscription warning banner (fixed amber pill at top 65px) | inv-01 §1.11 |
| Toast (currently never mounted; will be mounted and used for the `alert()` calls, Decision D5) | inv-01 §1.13 |

### 5.3 Parity verification

For every screen and modal in the inventory, a Playwright script opens old and new at three widths and stores screenshots side by side under `docs/parity/`. Review happens per phase, not at the end. Colour parity is checked mechanically by sampling the computed styles of named elements (header gradient, button backgrounds, row tints) and diffing against the token table.

---

## 6. Workflow preservation approach

All ~190 endpoints, their auth, payloads and the frontend file that calls each are tabulated in inv-06 section 1. The API client module is generated from that table so no endpoint is retyped by hand. Session mechanics that must be reproduced exactly:

- Cookie JWT `authToken` (httpOnly, 30 days), `adminAuthToken` for impersonation, `did` device cookie.
- CSRF: `GET /api/csrf-token`, header `x-csrf-token` on every mutating request, token bound to the current cookie so it is refetched after login, logout, login-as and password change; 16 exempt path prefixes.
- Profile hydration, 12-second notification poll plus focus refetch, 60-second heartbeat with device fingerprint, one Socket.io connection per user, push subscription after first user gesture.
- Version checker: `meta.json` written at build time, polled every 30 minutes, reload once per build.
- Stats endpoints without the `/api` prefix (`/stats`, `/online-users`, ...) kept as they are.
- Every localStorage and sessionStorage key (12 of them, listed per inventory) kept with the same names so existing users' browsers carry over "remember me", device id, unit mode, admin map mode and the Aks Shajra draft.
- All tour DOM ids and classes (`#tehsil-dropdown`, `#nav-link-*`, `.leaflet-draw-*`, `#map-base-layer-select`, ...) kept so the nine tours work unchanged.

---

## 7. Unified deployment on Hostinger

Target: one origin, `https://dashboard.naqsha-zameen.pk`, served by nginx on the Hostinger VPS, proxying to the pm2 Express app on port 5000, which serves both the SPA (`build/`) and the API. `api.naqsha-zameen.pk` keeps working during transition and can be retired later.

Steps:

1. **DNS at o3host.** In the o3host DNS zone editor change the `dashboard` A record to the Hostinger VPS IP (keep TTL low, 300s, a day before switching). Nothing else moves; the domain registration and zone stay at o3host as you asked. If o3host's panel does not expose zone editing, the fallback is a CNAME to `api.naqsha-zameen.pk`.
2. **nginx + Let's Encrypt** on the VPS for both hostnames, `proxy_pass http://127.0.0.1:5000`, WebSocket upgrade headers for `/socket.io`, `client_max_body_size 8m` for payment proof uploads, gzip off for `/pmtiles` (backend already handles ranges).
3. **Backend `.env` additions** (the only backend changes):
   - `CORS_ORIGIN=https://dashboard.naqsha-zameen.pk` (already the default).
   - `CLOUDFLARE_WORKER_URL=...` set explicitly (today the signer falls back to a `REACT_APP_` name that disappears with Vite).
   - Helmet CSP `connect-src` must include the worker origin and `https://api.ngdc.noaa.gov` (compass declination), and `img-src` already allows `https:` for base map tiles. One line in `server.js`. Without this the map breaks when the backend serves the SPA; that is why the split hosting was never collapsed before.
   - Optional: `COOKIE_SAMESITE=lax` once `api.` is retired (same-origin no longer needs `None`).
4. **Frontend env**: `VITE_API_URL=` (empty, same origin) for production; `VITE_CLOUDFLARE_WORKER_URL`, `VITE_TURNSTILE_SITE_KEY`. All other `REACT_APP_*` variables are dead (inv-06 §4) and are not carried over. Every `|| 'http://localhost:5000'` and `|| 'https://api.naqsha-zameen.pk'` fallback scattered through the old code collapses into one `apiBase()` helper, which is what currently prevents a same-origin build from working.
5. **deploy.sh**: unchanged flow (fetch, `npm ci` on lockfile change, build into `build_next`, atomic swap, `pm2 reload`). Only the build command changes to `npm run build -w frontend`.
6. **Cutover**: deploy the new build to the VPS while DNS still points at o3host, test it at `https://api.naqsha-zameen.pk/` (the backend already serves `build/` there), then flip the A record. Rollback is flipping it back; the o3host copy stays untouched until you delete it.

---

## 8. Phases

Each phase ends with a parity review you sign off. Order is chosen so the highest-risk code (map) is proven early on the real backend, and so the app is usable by admins first (they are the heaviest users of tables and modals).

| Phase | Scope | Exit criteria |
|---|---|---|
| 0. Repo | New repo layout, workspaces, backend moved unchanged, Vite skeleton, dev proxy, env files, CI running lint/tests, `deploy.sh` adjusted, nginx config written | `npm run dev` serves a blank app against the local backend; `deploy.sh` produces `build/` the backend serves |
| 1. Design system | Tokens, all shared components in section 5.2, Storybook-style gallery page comparing each against screenshots of the old app, icon mapping table FA → Lucide | Gallery reviewed; every component visually matches at 3 widths |
| 2. Shell + auth | Router, auth provider (CSRF, cookies, heartbeat, socket, push, version checker), navbar with the three dropdowns, side menu, notification panel, all 13 global modals, login, public registration, admin registration, reset, verify, activation pages, demo link | Can log in as user, sub-admin, admin; all auth flows pass against the live API |
| 3. Map | Leaflet core hook, panes and rotation patches, base layers, PMTiles + GeoJSON pipeline, tooltips and density classes, killa interaction and measurements, Geoman drawing with all custom styling, guided mobile drawing, ruler overlay, compass, locate, search, admin toolbar, layer control, Go-To and Shift modals, saved layers, shajra raster mode | Side-by-side parity on desktop and phone for a mouza in each data mode; all 9 tours run |
| 4. Users | User list (filters, sort, pagination, bulk, status tints, demo links), user edit modal (4 sections, temp grants, mouza requests, payment proof, WhatsApp copy), user detail tabs, change-mouzas modal, subscription warning modal and banner | Admin can do every action in inv-02 §11-13 |
| 5. Admin | Insights (7 tabs, 12 charts, IP modal), sub-admin console (5 tabs, appoint and detail modals), sub-admin dashboard and customers, land allotment, operations report, tehsil grouping, payment proof | Every chart matches colours, margins, legends; every table matches |
| 6. Aks Shajra | Konva digitiser ported with constants intact; saved JSON and localStorage drafts load unchanged | A project saved in the old tool opens identically |
| 7. Hardening | Playwright suite across all screens at 3 widths, Lighthouse mobile pass, bundle analysis and route-level code splitting, accessibility pass | Lighthouse mobile performance ≥ 85, no console errors |
| 8. Cutover | Deploy to VPS, test at api host, DNS flip, monitor, retire o3host copy | Live for one week with no rollback |

Rough size for planning: phases 2 to 5 are the bulk, roughly equal to each other; phase 3 is the riskiest; phase 6 is small but exact.

---

## 9. Decisions needed from you

Each item below changes visible behaviour. Default shown in bold is what the plan assumes if you do not answer.

| # | Question | Options |
|---|---|---|
| D1 | Font: the old CSS declares Inter but never loads it, so users see their OS font (Segoe UI on Windows, Roboto on Android, San Francisco on iOS). | **Load Inter for real** (consistent everywhere, slightly different from what users see today) / keep system fonts |
| D2 | Compact modal header: two looks exist today depending on navigation order (10px/0.85rem vs 6px/0.95rem). | **Use the admin-page look everywhere** / use the map-page look |
| D3 | Map engine: Leaflet (as today) or MapLibre GL. | **Leaflet, MapLibre as a later project** / MapLibre now (adds risk and changes label look) |
| D4 | Phone presentation of compact modals: centred dialog (as today) or bottom sheet with identical colours. | **Bottom sheet on phones, dialog on desktop** / dialog everywhere |
| D5 | Native `alert()` / `window.confirm()` (17 call sites) and the unmounted toast system. | **Replace alerts with the designed toast and confirm dialogs** / keep native dialogs |
| D6 | Date formatting mixes `en-GB`, `en-US`, `en-PK` and browser default on the same screens. | **Standardise on `dd-mm-yyyy` and `en-PK` for money** / keep each screen as-is |
| D7 | Known legacy bugs found during analysis (full list in each inventory's gotchas). Preserve or fix? Notable ones: profile modal "Change Password" button does nothing; a duplicate "Shift Mouza" menu entry; "Forgot Password?" link from registration guidance is a no-op; `badge.bg-secondary` is nearly invisible on white in stats; alert text is pastel-on-light; Aks Shajra objects drawn on the master canvas land in the wrong coordinate space; Aks Shajra metadata form goes stale after Open/Undo; "Vector/Web" export is really PNG; the `Rs 1000` assumed fee in revenue tiles; `Revenue at Risk = expiring × 1000`. | **Fix the clearly broken ones (dead buttons, duplicate entry, stale form, coordinate bug), preserve the business assumptions (Rs 1000) and flag them in the UI** / preserve everything byte-for-byte / fix everything |
| D8 | Dead code (22 unused files, 6 unused stylesheets, 6 unmounted components, EmailSetup modal disabled by a hard-coded flag). | **Do not port** / port the ones you name |
| D9 | Turnstile on public registration is compiled out by `ENABLE_TURNSTILE = false`. | **Keep disabled, wired behind an env flag** / enable |
| D10 | Google tile endpoints are used without an API key or attribution (ToS exposure, unchanged from today). | **Carry over as-is and note the risk** / drop Google layers / add attribution control |
| D11 | Retire `api.naqsha-zameen.pk` after cutover and switch cookies to `SameSite=Lax`? | **Keep both hosts for one release, then retire** / retire immediately / keep forever |
| D12 | Cloudflare worker: `wrangler.toml` deploys the no-auth worker, while the backend signs URLs for the HMAC worker that is not deployed. Also its listing endpoint returns a shape the frontend rejects. | **Leave as-is (out of scope, note it)** / deploy the HMAC worker as part of cutover |

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Map pipeline has global state on `map` and `window`, monkey-patches `window.fetch` and Leaflet prototypes, and wipes event listeners with bare `map.off('mousemove')` | Port behaviour into one `useLeafletMap` hook with explicit lifecycle; each patch documented in inv-04 §8 and gotchas 1, 7, 8, 9, 12 and re-implemented deliberately |
| Same-origin build silently targets wrong hosts (the reason deploy.sh's single-host mode was never usable) | One `apiBase()` helper; a CI test fails if any URL literal for the old hosts appears in `src/` |
| CSP blocks tiles/worker when backend serves the SPA | Section 7 step 3; verified in phase 0 against the local backend with production CSP |
| Pixel parity disputes late in the project | Per-phase screenshot review, gallery page in phase 1 |
| Tours break | DOM id contract list kept in `features/tours/contract.ts` and asserted by a test |
| Users lose saved state | All storage keys preserved by name; Aks Shajra constants (3.5 zoom, 45 padding) preserved |
| Version checker loops or stops | `meta.json` generated by a Vite plugin at build, same `{version, buildDate}` shape |
| pm2 cluster + socket without Redis drops events | Unchanged from today; the 12-second poll remains the safety net |

---

## 11. What I need from you to start phase 0

1. Answers to D1-D12 (defaults are acceptable if you say "use defaults").
2. Confirmation that the new repo lives at `d:\temp-repo` root with `old-repo/` kept read-only until cutover.
3. Confirmation that o3host's panel lets you edit the DNS zone (or the hosting login so this can be checked).
4. The current Hostinger VPS details: whether nginx is already in front of pm2, and whether `api.naqsha-zameen.pk` already terminates TLS on the VPS.
