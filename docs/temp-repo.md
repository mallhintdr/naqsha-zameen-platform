# App profile: temp-repo (Naqsha Zameen)

A record of how this app is built, for side-by-side comparison with other apps and for building a shared template. Colors are left out on purpose. Paths are relative to the repo root. "Not present" means it was searched for and not found.

Snapshot: version 5.5.0, 2026-10-30. Describes the working tree, including uncommitted fixes to the backend (auth cache, background timers on the primary worker only, renewal-token check, admin socket room, error-response CORS); these are marked "fixed, not yet committed".

---

## 1. Overview

**What the app does.** A subscription map dashboard for Pakistani land records. Users pick a tehsil → mouza (village) → murabba and see parcel boundaries (killas) on a Leaflet map, measure land in local units (karam, marla, kanal), draw, and save layers. Around it sit:
- Accounts, subscriptions, renewals and payment-proof uploads.
- A reseller system (sub-admins who sell to their own customers and get daily bills).
- Admin insights.
- An "Aks Shajra" map-sheet editor.
- A public marketing website with about 21,500 SEO pages, one per mouza.
- A public inheritance (Shajra Nasab) calculator.

**Tech stack**

| Part | Stack (versions from package.json) |
|---|---|
| Monorepo | npm workspaces: `frontend`, `backend`, `packages/*` (root `package.json`, Node ≥ 20). `site/` is a separate package. |
| Frontend (dashboard SPA) | Vite ^8.3.5, React ^19.3.1, TypeScript ^6.0.3, Tailwind ^4.3.3 (`@tailwindcss/vite`), react-router ^7.18.4, zustand ^5.0.16, Radix (dialog, popover, tabs), lucide-react ^1.61.0, Leaflet ^1.9.4 + leaflet-rotate + Geoman, pmtiles ^4.5.0, @turf/turf ^7.4.0, konva ^10.9.0 / react-konva, recharts ^3.10.1, jspdf ^4.2.1, idb ^8.0.4, socket.io-client ^4.8.4, @marsidev/react-turnstile. Tests: vitest ^5, Playwright ^1.64, axe-core. |
| Backend (API) | Express ^4.21.1, Mongoose ^8.7.1 (MongoDB), ioredis ^5.8.2, BullMQ ^5, socket.io ^4.8.3 + @socket.io/redis-adapter, helmet ^8.1.0, express-rate-limit ^8.5.2 + rate-limit-redis, express-validator ^7.3.1, jsonwebtoken ^9, bcrypt ^6, winston ^3.19, web-push, nodemailer ^8, puppeteer ^23.9, @napi-rs/canvas + chart.js, geoip-lite, archiver. CommonJS. |
| Website | Astro ^5.1.1 (static), Tailwind ^4, @astrojs/sitemap, @astrojs/react (only for `/tools/**`), qrcode-generator. |
| Shared package | `packages/inheritance-engine`: pure TypeScript, no dependencies, run directly by Node ≥ 22.18 (type stripping). |
| Edge | Cloudflare Worker (`cloudflare-worker/pmtiles-worker.js`) serving signed PMTiles from R2. |
| Hosting | One VPS (Hostinger): nginx → pm2 cluster → Express; MongoDB and Redis on the same box. |

**Folder structure**

```
frontend/src/
  app/            App.tsx (routes), guards.tsx, store.ts (zustand)
  features/       admin/ (insights, subadmins) · aks-shajra/ · auth/ · chrome/ (header, menu,
                  notifications, modals) · map/ (core, config, modals) · subadmin/ · tours/ · users/
  shared/         api/ (fetch client) · components/ · lib/ (format, device, push, system…) · ui/ (design system)
  styles/         tailwind.css (tokens + component classes)
backend/
  server.js       app setup (663 lines)
  controllers/ (22) models/ (26) routes/ (16) services/ (37) middleware/ (7) utils/ (16)
  scripts/ (one-off migrations) templates/ test/ (node:test)
site/src/         pages/ (incl. maps/[tehsil]/[mouza].astro) · layouts/ · components/ · tools/shajra/ · styles/
packages/inheritance-engine/   src/ (compute, fraction, rules/…) · test/ · law/citations.json
cloudflare-worker/  deploy/ (nginx.conf)  scripts/  .githooks/  docs/
```

Size: about 61,000 lines across frontend (185 files), backend (148), site (45) and packages (22).

**Build and deploy**
- **Dev:** `npm run dev` (Vite on :3000, proxying API paths to :5000) and `npm run dev:backend`.
- **Build:** `npm run build` builds the SPA into `/build`, which Express serves. A custom Vite plugin (`buildMeta` in `frontend/vite.config.ts`) writes `/meta.json` with the version and build date. The app polls it to detect new deploys.
- **Versioning:** a `.githooks/pre-commit` hook runs `scripts/bump-version.mjs`, which bumps the patch number on every commit; each digit rolls over at 9 (5.4.9 → 5.5.0).
- **Deploy (`deploy.sh` on the VPS):**
  1. `git fetch` + `git reset --hard origin/main`.
  2. `npm ci` only if `package-lock.json` changed.
  3. Build into `build_next`, then swap folders atomically (`build` → `build_prev`).
  4. `pm2 reload <app> --update-env` (zero downtime). The first time, it runs `pm2 start backend/server.js -i max`.
  5. Rebuild the website only if `site/` or the engine changed (`.site-built-commit` marker; `FORCE_SITE=1` / `SKIP_SITE=1`), at low priority (`nice`/`ionice`, concurrency 2, 1 GB heap).
  6. Hard-link rollback copy (`cp -al`), then `rsync --delete`.
- **From the PC:** `ssh root@<vps> "cd /var/www/naqsha-zameen && APP_NAME=geo-dashboard-test bash deploy.sh"`. `scripts/deploy-site-from-pc.sh` builds the website locally and streams it over `tar | ssh`.
- **nginx (`deploy/nginx.conf`):**
  - Proxies to pm2 with keepalive 32 and `client_max_body_size 8m`.
  - Upgrades the socket.io connection.
  - Passes Range requests through to `/pmtiles/`.
  - Caches the static site's `/_astro/` for a year (`immutable`).
- **Cloudflare Worker:** `wrangler` deploy, separate from the app.

---

## 2. Styling system

**Approach.** Tailwind 4 utility classes plus a Bootstrap-like class library built in Tailwind, in one global file. Older map code still uses plain per-component CSS.
- **Global entry:** `frontend/src/styles/tailwind.css` (438 lines), imported in `main.tsx` after `leaflet.css` and `leaflet-geoman.css`.
- **Tokens:** an `@theme` block (lines 9–129). **Component classes:** `@layer components`, with `.btn*`, `.icon-btn`, `.action-btn`, `.input/.select/.textarea`, `.field-*`, `.card*`, `.alert*`, `.badge*`, `.table*`, `.tabs/.tab`, `.stat-tile`, `.spinner`, `.page`, `.page-title`, `.tile-row`, `.fill-row`. **Custom utilities:** `@utility` (`bg-chrome`, `bg-dropdown` …).
- **Plain CSS:** 20 `.css` files, about 4,300 lines. Largest: `features/aks-shajra/AksShajra.css` 1,080, `map/ShiftMouzaForm.css` 480, `map/core/GuidedDrawingMode.css` 436, plus 10 files in `map/core/css/`.
- **Usage counts:** 2,523 `className=` vs 199 inline `style={{}}`. Pages and chrome (TSX) are Tailwind; the map core (legacy JSX) is plain CSS.
- **Class merging helper:** `shared/ui/cn.ts`, `cn = (...inputs) => twMerge(clsx(inputs))`.
- **Website (`site/`):** Tailwind 4 with a 107-line `site/src/styles/global.css` (`@theme` fonts, `.btn-primary`, `.btn-ghost`, `.card`, `.eyebrow`, `.reveal`).

**Typography**
- **Font:** Inter Variable via `@fontsource-variable/inter` (self-hosted), fallback `-apple-system…`. Body is `0.9375rem` (15px).
- **Website fonts:** Inter + Plus Jakarta Sans (headings) + Noto Nastaliq Urdu, from Google Fonts with `display=swap`.
- **Token overrides:** `--text-xs 0.75rem`, `--text-sm 0.875rem`, `--text-base 0.9375rem`, `--text-md 1rem`.
- **What's actually used:** mostly arbitrary sizes — `text-[0.8rem]` (55), `[0.85rem]` (51), `[0.75rem]` (47), `[0.7rem]` (43), `[0.9rem]` (33), `[0.72rem]` (23), `[0.78rem]` (20), `[0.65rem]` (19), `[0.95rem]` (15). Named sizes: `text-sm` 93, `text-base` 25. Range 0.55–3rem. The UI is deliberately dense: most text is 11–14px.
- **Website scale:** hero h1 `text-4xl sm:text-6xl`, h2 `text-3xl sm:text-5xl`.

**Spacing.** The Tailwind default scale. Most used: `gap-2` (141), `mb-2` (100), `mb-3` (90), `px-2` (82), `py-1` (68), `gap-1` (61), `p-2` (50), `gap-1.5` (32), `gap-3` (25). Pages use `.page` padding `2rem 24px`, dropping to `0.5rem 4px` on phones.

**Radius.** Tokens `sm 4px`, `md 6px`, `lg 8px`, `xl 12px`, `2xl 16px`. Usage: `rounded` (57), `rounded-lg` (34), `rounded-md` (31), `rounded-full` (14), `rounded-xl` (8), plus a few arbitrary values (3, 10, 15, 18px).

**Other tokens.** Shadows `xs`–`xl`. Animations `fade-in` 0.2s, `pop-in` 0.3s, `slide-in-right` 0.3s, `sheet-up` 0.25s. `prefers-reduced-motion` is respected on the website and in the map camera.

**Layout system.** Flexbox first (524 uses) and grid second (199): `grid-cols-1/2/3`, `grid-cols-12`, `grid-cols-[5fr_7fr]`. Two shells:
- **Map route:** `fixed inset-0 flex flex-col overflow-hidden`.
- **Other pages:** `flex min-h-dvh flex-col`.

The website uses `max-w-7xl` with `px-4 sm:px-6 lg:px-8`.

**Icons.**
- **lucide-react only.** Old react-icons names survive as aliases, e.g. `import { UserPen as FaUserEdit } from 'lucide-react'` (`map/core/AdminToolbar.jsx:5`).
- **Emoji** serve as icons in the side menu (`chrome/NavigationMenu.tsx`).
- **Website:** inline SVG via `site/src/components/Icon.astro`.

---

## 3. Buttons

There are four button systems. The shared ones are in `frontend/src/shared/ui/index.tsx` and `styles/tailwind.css:182-251`.

**3.1 `Button` / `.btn` (general).**
- **Variants:** primary, secondary, success, danger, warning, info, dark, light, link, plus seven `outline-*`.
- **Sizes and states:**

| Size / state | Values |
|---|---|
| `.btn` | padding `0.4375rem 0.875rem`, 0.875rem, weight 600, radius 6px, gap 0.375rem |
| `.btn-sm` | `0.25rem 0.625rem`, 0.75rem |
| `.btn-lg` | `0.625rem 1.25rem`, 1.125rem |
| `.btn-block` | full width |
| Hover (solid) | `translateY(-1px)` plus a shadow |
| Disabled | opacity 0.65 |
| Focus | 3px ring |
| ≤ 640px | padding drops to `0.375rem 0.625rem` so labels stay on one line |
| Loading | button disabled, spinner shown inside |

- **In practice:** raw `className="btn btn-primary"` is used 99 times vs `<Button>` 33 times.

```tsx
// shared/ui/index.tsx:22
<button className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', block && 'btn-block', className)}
        disabled={disabled || loading} {...rest}>
  {loading && <Spinner size="sm" className="text-current" />}
  {children}
</button>
```

**3.2 Icon-only buttons.**
- **`.icon-btn`:** 2rem × 2rem, radius 8px, transparent with a hover background.
- **Built on it:** `HomeIconButton`, `RefreshIconButton` (the icon spins while loading) and `AdminNavIcons` (`index.tsx:151-182`). `AdminNavIcons` shows Home / Insights / Users / Sub-admins at icon size 17, leaving out the current page; it replaces breadcrumbs on admin pages.
- **`.action-btn`:** square icon buttons in table rows — `padding 0.28rem; aspect-ratio 1/1; transform: scale(0.81)`, 1rem svg that scales to 1.2 on hover.

```tsx
<button className="icon-btn" title="Insights" aria-label="Insights" onClick={() => navigate('/stats')}>
  <ChartColumn size={17} />
</button>
```

**3.3 `ChromeButton` (modal footers).** `features/chrome/modals/shared.tsx:18`. It fills its share of the footer (`flex-1`), so two or three buttons split the width evenly.

```tsx
'inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border-none px-1 py-2
 text-[0.8rem] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'
```

Loading state: the label is swapped for `<Spinner size="sm" />`.

**3.4 Map buttons (plain CSS).**
- **AdminToolbar** (`map/core/AdminToolbar.jsx`, `css/AdminToolbar.css`):
  - A vertical pill at the map's right middle: `right:10px; top:50%; z-index:1000; border-radius:20px`.
  - Round 32px buttons (34px at ≤ 768px, 29px inside the map), with a CSS hover tooltip `.admin-toolbar-tooltip` (12px).
  - Different button sets for admin and sub-admin.
- **Leaflet zoom / draw buttons** (`map/core/css/MapGlobal.css`): 24px on desktop (≥ 769px), 29px on phones; locate and search are 36px on phones.

```jsx
<button className="admin-toolbar-btn btn-insights" onClick={() => navigate('/stats')} title="Insights" aria-label="Insights">
  <FaChartBar className="admin-toolbar-icon" />
  <span className="admin-toolbar-tooltip">Insights</span>
</button>
```

**3.5 Other buttons.**
- **Navbar:**
  - Hamburger: `h-[30px] w-[30px]`, round.
  - Pill dropdown triggers `.rounded-dropdown`: height 29px, radius 18px, width 80–150px. On phones they shrink to 26px high and 75–100px wide, and to 56–84px wide at ≤ 400px.
  - Profile button: `h-[40px]` with a 16px unread badge.
- **Pager:** `btn btn-sm btn-outline-primary min-w-[2rem]` (« ‹ › »).
- **Switch:** hand-made, `h-[18px] w-8` with a 12px knob (`NavigationMenu.tsx:103`). Radix Switch is installed but unused.
- **Tour buttons:** `.tour-btn`, `min-height:32px`.
- **Primary submit (login):** `btn btn-primary h-[45px] w-full !rounded-lg`.
- **Website:** `.btn-primary` / `.btn-ghost` in `global.css`.

---

## 4. Forms

**Inputs** (`tailwind.css:269-293`):
- `.input` / `.select` / `.textarea`: 1rem text, padding `0.5rem 0.75rem`, radius 6px, 3px focus ring.
- `.input-sm` / `.select-sm`: `0.25rem 0.5rem`, 0.875rem, radius 4px.
- `.select`: `appearance:none` with an SVG chevron.
- `.check`: 1rem checkbox. `.input-clear-btn-red`: 22px round ✕ inside an input.
- **Login style:** `input h-[42px] !rounded-lg !pl-[35px] text-[0.95rem]`, with a lucide icon positioned at `left-3 top-[13px]` and a show/hide eye toggle for passwords.

**Labels and the `Field` wrapper.**
- Classes: `.field-label` (0.9rem / 500), `.field-hint` (0.78rem), `.field-error` (0.8rem).
- `Field` (`shared/ui/index.tsx:123`) renders label → input → error-or-hint inside `mb-3`. It is used in only one file (`aks-shajra/MapMetadataModal.tsx`); most forms write labels inline.

**Validation.**
- **Client:** manual. Native `required` / `maxLength` and regex checks, e.g. user ID `/^[a-zA-Z0-9._-]+$/` (`auth/pages/PublicRegistrationPage.tsx:246`). **zod is installed but never imported.**
- **Error display:**
  - Registration opens a `RegistrationGuidanceModal` with title, message, details and the field to focus.
  - Elsewhere, an `<Alert variant="danger">` above the form (76 uses).
  - `.input-invalid` / `.field-error` are defined but unused.
- **Server:** express-validator rule sets in `backend/middleware/validationMiddleware.js`. The server's message is shown in the alert.

**Submit and loading.** Pattern: a `busy` state disables the button and swaps its label for `<Spinner size="sm" /> Logging in...`. Errors go to an alert, success to a toast or a closing modal. There is no form library.

**OTP.** A single 6-digit field, not split boxes:

```tsx
<input inputMode="numeric" autoComplete="one-time-code" maxLength={6}
  className="input h-[42px] !rounded-lg !pl-[35px] text-center text-[1.1rem] font-bold tracking-[5px]" />
```

**Captcha.** Cloudflare Turnstile (`@marsidev/react-turnstile`) on public registration (`PublicRegistrationPage.tsx:580`), behind `VITE_ENABLE_TURNSTILE`. The server checks it in `authController.js:39` with a 5s timeout.

**File uploads.** `shared/components/PaymentProof.tsx`:
- A hidden `<input type="file" accept="image/*">` behind an 84×84 button. Ctrl+V pasting of a screenshot also works.
- The image is shrunk on a canvas (max 1600px, JPEG 0.8) and sent as base64.
- The server checks the file type by its first bytes (JPG/PNG/WebP), caps it at 3MB, and stores it outside the web root (`paymentProofController.js:33-50`).
- Aks Shajra also has a JSON project import.

**Date picker.** Custom, no library: `features/users/CustomDatePicker.tsx`.
- Trigger `h-[38px]`; popup `w-[280px] max-w-[calc(100vw-32px)]`, a 7-column grid of 30px day cells.
- Shows dd-mm-yyyy and emits YYYY-MM-DD, with a "Go to Today" link.

**Other.** Phone formatting `formatPhoneNumber` → `+92 xxx xxxxxxx` (`shared/lib/formUtils.js`).

---

## 5. Dropdowns and selects

**Native `<select className="select select-sm">`** in 22 files: admin filters, pricing, Aks Shajra. The map base layer is a native `<select className="dropdown-select">` with `min-height:36px` (`map/core/LayerControl.jsx:114`).

**Searchable dropdown (the main one):** `NavDropdown` in `features/chrome/Header.tsx:74-136`, built on **Radix Popover**.
- **Search:** a sticky input at the top (`.dd-search`, 34px high) with a 300ms debounced filter (`useDebouncedFilter`) and a clear button.
- **Order and size:** sorted numbers first, then natural order (`sortList`, exported); lists are capped at 1,000–1,500 items.
- **Three dropdowns:** Tehsil (only shown when there is more than one), Chak/Mouza (with a "My Mouzas / All Mouzas ↗" switch) and Murabba (fixed 150px menu).
- **Menu:** `.nav-dd-menu`, `max-height:300px`, `min-width:200px`, radius 12px, z-index 10000.

**Multi-select.**
- **`features/subadmin/SubAdminMouzaPicker.tsx`:** a tehsil picker plus a filterable mouza checklist, with select-all and a `maxMouzas` limit. Value shape `[{ tehsil, mouzas[] }]`.
- **`features/auth/components/AreaPicker.tsx`:** rows `min-h-9 px-2.5 py-2 text-[0.85rem]`, with `public` and `admin` variants.
- **`features/users/ChangeMouzasModal.tsx`.**

**On phones.** At ≤ 639px the popover becomes a full-width sheet under the header, by overriding Radix's positioning:

```css
[data-radix-popper-content-wrapper]:has(> .nav-dd-menu){position:fixed!important;transform:none!important;
  top:46px!important;left:8px!important;right:8px!important}
.nav-dd-menu{max-height:min(60dvh,420px)!important}
.dropdown-item{padding:9px 12px;font-size:0.82rem}
```

**Website.** `site/src/components/MouzaPicker.astro`: a plain-JS combobox that loads `/maps/catalog.json` on first use. The header "Services" and "Tools" dropdowns are **CSS-only** (`.nav-dd:hover .nav-dd-panel, .nav-dd:focus-within .nav-dd-panel { display:block }`).

**Installed but unused:** Radix `react-dropdown-menu`.

---

## 6. Menus and navigation

**Routing.**
- react-router 7 with `<BrowserRouter>` (`main.tsx`). Routes are declared inline in `frontend/src/app/App.tsx:108-130`; there's no route-config file.
- **Every page is lazy-loaded** (22 `lazy()` imports) under one `<Suspense fallback={<PageSpinner/>}>`. Named exports load via `.then(m => ({ default: m.X }))`.

**Route guards** (`app/guards.tsx`):
- `ProtectedRoute role="admin" | "subadmin"`: sends you to `/login` if logged out, or `/` if the role is wrong.
- `SelfOrAdminRoute`: protects `/users/:userId`.
- `/` without a user redirects to `/login`.

**Header** (`features/chrome/Header.tsx`): `sticky top-0 z-[9999] h-[42px] backdrop-blur-[12px] px-1`. It holds the hamburger, the tehsil / mouza / murabba dropdowns, notifications and the profile button. Hidden on `/reset-password` and `/aks-shajra`; banners are hidden on auth pages.

**Sidebar** (`features/chrome/NavigationMenu.tsx`):
- **Panel:** off-canvas, `fixed left-0 top-[42px] z-[9998] w-[240px] h-[calc(100dvh-42px)]`. It slides in with `-translate-x-full`, `duration-300`, over a `bg-black/50` backdrop (z 9997).
- **Items:** `.nav-link-clean` — 0.82rem, `padding:4px 10px` (8px 10px on phones).
- **Submenu flyout** (`SubmenuFlyout`, portaled):
  - Desktop: a second column at `left:240px; width:280px`.
  - Phones (≤ 639px): it covers the menu at `width:min(320px,100vw)` with a "‹ Back" button.
- **Escape** closes the submenu first, then the menu.

**Role-based menus.**
- **Everyone:** Map, Go To, Shift Mouza, Save/Open Layers, Guided Tutorials (16), Clear Cache, Change Password, user card, Logout.
- **Customer:** also Change Mouza.
- **Sub-admin:** also Dashboard, My Customers, New Customer.
- **Admin:** an "Admin Tools" flyout with:
  - Links: Register, Users, Sub-admins, Insights, Aks Shajra, Land Allotments, Ops Report, Tehsil grouping.
  - Toggles: Test Mode, Killa Measurement, Mobile Mode, Limits, Invoices.
  - Scan Hosting (with a progress bar) and a Layer Mode segmented control.
- **Limited users** (expired, pending, or in preview; `shared/lib/featureAccess.ts isLimitedUser`) still see locked items marked "🔒 subscribe". Tapping one opens `SubscribeRequiredModal`.
- **Preview mode** shows a minimal menu.

**Map toolbar.** The AdminToolbar pill on the map (section 3.4) gives admins and sub-admins quick links.

**Breadcrumbs.** Not present in the dashboard. Admin pages use `AdminNavIcons` instead. The website builds BreadcrumbList JSON-LD (SEO only) from the URL.

**Mobile menu.**
- **Dashboard:** the same off-canvas sidebar.
- **Website:** a JS toggle (`#menu-btn` with `aria-expanded`/`aria-controls` → `#mobile-menu`) below `xl` (1280px); the desktop nav shows at `xl` and up.

---

## 7. Modals, toasts, notifications, tables, cards, loaders, empty states

**Modals.** One component, `shared/ui/Modal.tsx`, on Radix Dialog.
- **Sizes:**

| Size | Width |
|---|---|
| `compact` | 315px |
| `warning` | 300px |
| `sm` | 340px (360px at `sm:`) |
| `md` | 400px (500px at `sm:`) |
| `lg` | 900px at `sm:` |
| `salg` | `min(960px,96vw)` |
| `wide` | `min(1200px,96vw)` |
| `xl` | 95% |

- **Placement:** always below the header and centred without transforms:
  ```tsx
  'inset-x-0 top-[50px] bottom-2 m-auto h-fit w-[calc(100vw-24px)] max-h-[calc(100dvh-58px)] sm:w-full'
  ```
- **Header variants:** `chrome | table | custom | none`; the header is `min-h-[38px]`.
- **Body and footer:** body `p-4` (`max-sm:p-2.5`); footer right-aligned with `gap-2`.
- **Behaviour:** the backdrop can be `'static'`. Stacking uses z-index 10500 / 10600 / 10800 / 11000.
- **Disabled:** a bottom-sheet mode exists in the code (`const SHEET: ModalSize[] = []`) but is switched off — phones get compact centred modals.

**Dialogs and toasts** (`shared/ui/feedback.tsx`):
- **Dialogs:** `DialogProvider` + `useDialog()` give promise-based `alert`, `confirm` and `prompt`, queued, at z 11000. `dialogs.*` does the same for non-React map code.
- **Toasts:** `toast.success / error / warning / info` with `<Toaster>`. Fixed `top-[60px]` (`sm:top-[80px] right-6`), z 12000, slide-in, auto-dismissed after 4s (6s for errors).

**Notifications** (`features/chrome/NotificationPanel.tsx`):
- **Layout:** a dropdown panel, `absolute w-[360px] max-h-[calc(100dvh-80px)]`; on phones `fixed left-2 right-2 top-[48px]`.
- **Content:** filter tabs, unread highlight, "Details" expander with a key/value table, action buttons (Open / Reply), and an outcome line once handled ("Renewed on … as …", "Replied on …").
- **Text:** WhatsApp-style `*bold*` rendering (`chrome/WaText.tsx`).
- **Delivery:** in real time over socket.io, plus web push (`public/push-sw.js`). A pop-up shows notifications as they arrive (`RealtimeNotificationModal`).

**Tables.** Plain `<table className="table">`. **@tanstack/react-table is installed but unused.**
- Sticky header (z 3); `.freeze` sticky first column; `.sortable` headers with ▲/▼.
- Row status classes `row-active / expiring / expired / pending / risk-*`.
- Wrapper `.table-wrap` (radius 12px, `overflow:auto`).
- Server-side pagination with chevron buttons (`features/users/UserListPage.tsx:296-550`). Smaller padding and 0.75–0.78rem text on phones.

**Cards.**
- `Card` (`.card`, radius 8px, with a header); rarely used (1 file).
- `StatTile` in `.tile-row` / `.fill-row`: 3 per row on phones, 4 at ≥ 1024px. This is the main "info card" pattern (Insights, user details).
- `Badge` (90 uses).

**Loaders.**
- `Spinner`: 2rem, `sm` 1rem, a border spinner turning every 0.75s.
- `PageSpinner`: `min-h-[40vh]`, used as the route fallback.
- Map `LoadingOverlay.jsx`.
- A shimmer bar (`.user-list-loading-bar`) for list reloads.

**Empty states.**
- `Empty`: `py-6 text-center text-sm italic`.
- Notifications use an icon + message (e.g. "No notifications yet").
- Dropdowns show an inline "No Chak Found".

**Tooltips.** Native `title=`, CSS tooltips (`.admin-toolbar-tooltip`), Leaflet tooltips, and Recharts tooltips that auto-hide on touch after 3s (`shared/lib/system.ts`). Radix Tooltip is installed but unused.

**Tabs.** Radix Tabs wrapped as `Tabs` (`shared/ui/index.tsx:99`), pill style. At ≤ 768px they wrap 3 per row at 0.72rem; `.tabs-equal` gives `min-height:44px`.

**Guided tours.** `features/tours/` holds 16 hand-made tours on one engine, `TourRunner.tsx`.
- **Steps:** each is `{ title, text, target(), action(), circle, avoid(), placeTop() }`.
- **Behaviour:** re-measures every 250ms; highlight at z 10600; tooltip `width:min(290px,100vw-24px)`, `max-height:45vh`; separate placement for phone and desktop; avoids open modals; a "Don't show again" option.
- **`TourManager.tsx`** lazy-loads tours and starts the Welcome tour 3.5s after load.

---

## 8. Responsive design

**Approach.** Mostly desktop-first: `max-width` queries dominate.
- **Tailwind prefix counts:** `max-sm:` 110, `md:` 79, `max-md:` 71, `sm:` 45, `lg:` 5, `max-lg:` 2, `xl:` 1.
- **The website** is mobile-first (`sm:`/`lg:`/`xl:` only).

**Breakpoints.**
- **Tailwind defaults** — 640, 768, 1024, 1280px — plus a custom `--breakpoint-xs: 480px`.
- **Custom `@media` in CSS:** `max-width` 768 (16 times), 639, 640, 576, 400, 900, 520, 480; `min-width` 1024, 769, 768; `(pointer: coarse)` in Aks Shajra (40px minimum targets).
- **In JavaScript:** `window.innerWidth < 768` (`admin/insights/statsUtils.tsx:89`), ≤ 1024 plus `maxTouchPoints` for guided drawing, ≤ 768 for tour placement.

**What changes on phones.**
- `.page` padding goes from `2rem 24px` to `0.5rem 4px`.
- Header dropdowns shrink; their menus become full-width sheets (section 5).
- The sidebar submenu covers the menu instead of opening beside it; the notification panel goes full width.
- Modals stay centred at `calc(100vw-24px)`; footer buttons get `max-sm:min-h-[36px]`.
- Tabs wrap 3 per row; stat tiles 3 per row.
- Aks Shajra: the left panel becomes an overlay drawer at ≤ 900px and the cell editor goes fullscreen.
- Guided drawing gets a crosshair toolbar raised above the layer control.

**Touch targets.**
- Common minimums are 36px: `min-h-[36px]` (14 uses) and `min-h-9`.
- Map buttons are 29–36px on phones (`MapGlobal.css`: "touch targets >= 36px on phones"). Leaflet zoom buttons are 24px on desktop.
- Aks Shajra uses 40px on coarse pointers.

**Viewport and safe areas.**
- `index.html` sets `viewport-fit=cover, maximum-scale=1`.
- `env(safe-area-inset-*)` is applied to the Leaflet corners, sidebar bottom, flyout body, guided-drawing toolbar (`calc(env(safe-area-inset-bottom,0px) + 56px)`) and the `UserEditForm` footer.
- `100dvh` is used throughout instead of `100vh`.

**Known small-screen problems and fixes (from code comments and history).**
- Bottom-sheet modals were turned off so windows stay compact and centred.
- `.btn` padding was tightened so labels fit on one line.
- The guided toolbar is placed so it doesn't overlap the layer control.
- Recharts tooltips are capped at `max-width:min(240px,80vw)`.
- `maximum-scale=1` blocks pinch-zoom of the page, which is an accessibility trade-off taken for the map.
- Some text goes down to 0.55–0.65rem, which is hard to read on phones.

---

## 9. Performance

**Bundle size** (`npx vite build`, rechecked 2026-10-30; 109 asset files, `/build` total 9.3MB including static images):

| Chunk | Size | Gzip |
|---|---|---|
| `MapPage` (Leaflet app, map core) | 860.7 KB | 227.1 KB |
| `AksShajraPage` (Konva editor, jspdf) | 779.8 KB | 245.7 KB |
| `index` (entry: React, router, auth, chrome) | 382.8 KB | 120.4 KB |
| `ComposedChart` (Recharts, Insights only) | 358.3 KB | 103.7 KB |
| `html2canvas` (via jspdf, lazy) | 199.4 KB | 46.7 KB |
| `index.es` | 151.4 KB | 48.9 KB |
| `leaflet-src` | 148.6 KB | 43.3 KB |
| `index.css` (global Tailwind + components) | 144.6 KB | 34.1 KB |
| `ui` (shared UI kit) | 96.6 KB | 32.6 KB |
| `AdminSubAdminConsolePage` | 68.1 KB | 17.0 KB |
| `MapPage.css` | 36.4 KB | 7.2 KB |

A customer opening the map downloads roughly entry + MapPage + leaflet + CSS ≈ 1.6MB raw / about 440KB gzipped.

**Code splitting and lazy loading.**
- Route-level `lazy()` for all 22 pages, lazy Insights tabs (`InsightsPage.tsx:11-18`) and 16 lazy tours.
- Not present: `manualChunks` (`chunkSizeWarningLimit: 1500` hides the warning). Sourcemaps are off.
- Not present: web workers. Heavy geometry (turf) runs on the main thread.

**Browser caching.**
- **No caching service worker.** `public/push-sw.js` handles push only.
- **Version checker** (`shared/lib/system.ts startVersionChecker`): polls `/meta.json` every 30 minutes, clears `caches` and reloads on a new version.
- **Encrypted tile cache:** IndexedDB, AES-GCM with a non-extractable key, per user, 7-day TTL, 150MB cap, oldest entries pruned first (`map/core/tileCache.js`). `securePMTilesProtocol.js` wraps `fetch` for `.pmtiles` (signed-URL refresh, retry on 403, cache read and write).
- **Other client caches:** `shared/lib/lruCache.js` (in memory) and an `idb` raster cache (`map/core/shajraCache.js`).

**Server caching.**
- **`utils/sharedCache.js`:** Redis first, then a Mongo TTL collection. Namespaces `geo` 300s, `stats` 60s, `multiuse` 26h.
- **`utils/cacheBus.js`:** cross-worker invalidation of in-memory caches (polls a version map every 5s).
- **node-cache:** tehsil lists 300s, aliases 600s.
- **Redis GeoJSON cache:** `geojson:{tehsil}:{mauza}` for 3600s.
- **`vectorResponder.js`:** an in-process LRU of 256MB (`VECTOR_CACHE_MB`) with in-flight request dedupe.
- **Heartbeats:** buffered in Redis and flushed with `bulkWrite` every 60s.

**HTTP and CDN.**
- **Compression:** gzip level 6, threshold 1KB; skipped for pmtiles and images.
- **Cache headers:**
  - SPA assets: `maxAge 1d` plus ETag.
  - Public catalog: `public, max-age=3600`.
  - Vector data: `private, no-store`.
  - Website `/_astro/`: `max-age=31536000, immutable` (nginx).
- **PMTiles via Cloudflare:** the Worker serves from R2 with an edge cache keyed by path + byte range.

**Images.**
- Payment proofs are shrunk in the browser before upload.
- The website uses `astro:assets` `<Image>`, which writes hashed WebP variants.
- The dashboard has no image pipeline; images are a few PNGs in `public/`.

**Database.**
- **Indexes:** every model has explicit `schema.index()` calls. Highlights:
  - User: unique `userId`; `{status, subscriptionType}`, `{managedBy, status}`, `{lastActive, userType}`; text index on name/ID; sparse token hashes.
  - GeoJson: unique `{tehsil, mauza}`.
  - Notification: `{userId, read, createdAt}` plus 90-day TTL.
  - Session: 90-day TTL.
  - AccountEvent: `{ownerAtEvent, billable, billDay}`.
  - SubAdminBill: unique `{subAdminId, day}`.
  - SharedCache and RenewalToken: TTL indexes.
- **Queries:**
  - `lean()` is used widely.
  - Stats use parallel aggregations cached for 60s.
  - `getAllUsers` returns the page, the count and the stats in one `$facet`.
- **Connection pool** (`server.js:519-529`): `maxPoolSize 25`, `minPoolSize 5`, global `maxTimeMS 10000`.

**Slow spots.**
- **Auth lookup per request:** `isAuthenticated` now uses a 15-second in-memory cache (max 2,000 users) on an indexed `userIdLower` lookup (`middleware/authMiddleware.js:13-32`). Fixed, not yet committed. The cache is per pm2 instance.
- **User list stats:** `getAllUsers` recomputes whole-collection stats on every call. Its cache is still broken: `cachedStats` is set to `null` and never assigned (`userController.js:157`), and `redisClient.setEx` (line 234) isn't an ioredis method (ioredis has `setex`).
- **Unbounded `Session.find`** with `days=all` in `userController.js:966`. The stats version is now capped at 1,000 rows (`statsController.js:477`).
- **N+1 loops:** `services/multiDeviceWarnings.js:42` (one `Notification.exists` per user) and `services/subAdminBilling.js:189`. The sub-admin console now uses `computePositionsBulk` (`adminSubAdminController.js:151`), falling back to one call per sub-admin only when missing.
- **Puppeteer in the API process:** the operations report (`pdfReportService.js:20`) still launches a new Chromium per request, now with a concurrency limit that returns 429. The Shajra PDF reuses one shared browser.
- **Large GeoJSON:** `GeoJson.findOne` without `lean()` hydrates big documents (`geoController.js:234, 271`).
- **Device writes:** `Device` is loaded and saved on every heartbeat (`services/deviceTracker.js:58-69`), not buffered.

---

## 10. Scalability

**State management (frontend).**
- **Zustand:** `app/store.ts` (`useAppStore`: UI flags, map selection, preview, tours, admin toggles; some saved in localStorage) and `features/chrome/chromeStore.ts`.
- **Auth and notifications:** a React context (`features/auth/AuthProvider.tsx`).
- **React Query:** a `QueryClient` exists (`staleTime 30_000`, `retry 1`), but no `useQuery` is used. Data loads in `useEffect` through `shared/api/client.ts` (a fetch wrapper with an axios-like API, CSRF header, timeouts and blob support).

**API structure.**
- **Shape:** REST over Express routers with absolute paths, mostly `/api/...`. Actions are POST sub-resources (`/renew`, `/suspend`, `/approve`). `:userId(*)` allows dots in IDs.
- **Legacy duplicates:** many routes also exist without the `/api` prefix (`/login`, `/profile`, `/stats`).
- **Errors:** `asyncHandler` wraps the routes; `middleware/errorHandler.js` returns `{ error, requestId }`. Response shapes are mixed (`{message}`, `{error}`, `{success}`); a few machine codes exist (`EXPIRED_TILES_ONLY`, `PREVIEW_QUOTA`).
- **Logging:** winston JSON with a request ID on every request; files `error.log`, `security.log`, `combined.log` (5MB × 5). An `AuditLog` collection keeps 60 days.

**Auth.** Stateless JWT in an httpOnly cookie (section 11), so any instance can serve any request.

**Multiple instances.**
- **pm2 cluster:** `-i max`, one instance per CPU. Zero-downtime `pm2 reload`. No ecosystem file and no memory limit.
- **socket.io:** uses the Redis adapter so events reach users on any instance. nginx proxies to one port (`upstream naqsha_dashboard { server 127.0.0.1:5001; }`) and pm2 cluster mode spreads connections round-robin, with **no sticky sessions**, so the long-polling fallback breaks across instances; websockets work.
- **Shared state** lives in Redis or Mongo. Still per process: the 256MB vector LRU, node-caches, and the memory fallback for rate limits.

**Background jobs.**
- **BullMQ** (`services/queueService.js`), only when `JOBS_ENABLED`. Queues: `email`, `push` (concurrency 10), `tasks`.
- **Repeatable jobs:**

| Job | Schedule |
|---|---|
| `cleanup` | `0 0 * * *` |
| `flushHeartbeats` | every 60s |
| `subadmin:closeBills` | `0 0 * * *` PKT |
| `subadmin:dailyEmails` | `10 0 * * *` |
| `subadmin:reminders` | `0 10 * * *` |
| `subadmin:creditChecks` | `5 * * * *` |
| `multiDeviceWarnings` | `0 11 * * *` |

- **Fallback without Redis:** an in-memory scheduler (`subAdminJobs.startFallbackScheduler`).
- **Plain timers** in `server.js:573-600` (unverified sign-up purge, sub-admin expiry notices, multi-use warning, fallback hygiene) now run only on the primary pm2 instance (`isPrimaryWorker`, `NODE_APP_INSTANCE === '0'`). Fixed, not yet committed. With more than one server they would still run once per server.
- **Two multi-device warning systems:** `services/multiUseWarning.js` (2+ devices, when `JOBS_ENABLED`) and `services/multiDeviceWarnings.js` (4+ devices, BullMQ job or `MULTI_DEVICE_WARNINGS=on`).
- **Test copy:** a parallel copy runs with `JOBS_ENABLED=false` so it doesn't send real emails or bills.

**Rate limiting** (`backend/middleware/rateLimiters.js`). express-rate-limit with a Redis store that falls back to memory if Redis is down (`FallbackStore`):

| Limiter | Window | Max |
|---|---|---|
| login (`limiterStrict`, failures only, IP + user) | 15 min | 20 |
| registration | 1 h | 5 |
| password reset | 1 h | 3 |
| geo | 1 min | 60 |
| general API | 15 min | 100 |
| public lists | 15 min | 400 |
| browse (per user) | 15 min | 600 |
| sub-admin writes | 15 min | 150 |
| PMTiles signing (per user) | 1 min / 1 h | 120 / 1500 |
| vector data (per user) | 1 min / 1 h | 300 / 3000 |
| Shajra PDF | 10 min | 10 |

Plus daily quotas: 40 distinct mouzas per user, 150 per sub-admin, 10 preview mouzas (`services/vectorQuota.js`). The Cloudflare Worker adds 1,200 requests per minute per user. Most limiters skip admins.

**What would break first at 10x users.**
1. **MongoDB writes from heartbeats:** a device load-and-save on every heartbeat. Auth lookups are now cached for 15s, so this is the main per-request database load left. It needs buffered device writes like the heartbeat buffer.
2. **The admin user list:** stats recomputed on every call (broken cache).
3. **Puppeteer in the API processes:** PDF and report rendering uses a lot of memory and CPU inside the API processes; a concurrency limit now returns 429 instead of piling up, but rendering should move to a worker or queue.
4. **RAM:** 256MB vector LRU × instances, plus Chromium, on one VPS.
5. **Timers once there is a second server:** they now run on one pm2 instance, but per server, outside BullMQ.
6. **socket.io long-polling** without sticky sessions.
7. **Everything on one VPS:** Mongo, Redis, API and site build share the box; only PMTiles are offloaded to R2.

---

## 11. Security basics

**Auth method.**
- **Token:** JWT `{ userId, tokenVersion }`, 30 days, in an httpOnly `authToken` cookie (Secure; SameSite `none` in production, configurable).
- **No refresh tokens.** Logging out everywhere works by bumping `tokenVersion`.
- **Variants:** `isAuthenticatedLight` (no DB lookup) and `maybeAuthenticated`.
- **Admin "login as" (impersonation):** keeps the admin token in a second cookie and restores it on logout.
- **OTP:** an emailed 6-digit code on first login only — `crypto.randomInt`, stored as SHA-256, 15-minute expiry, max 3 per 15 minutes, checked with `timingSafeEqual`. No TOTP / 2FA.
- **Device tracking** (`services/deviceTracker.js`): a `did` cookie (2 years) plus a client fingerprint. It flags concurrent use and accounts with 4+ devices in 30 days.
- **Passwords:** bcrypt with 12 salt rounds (User pre-save hook), a complexity check and a common-password list.

**Roles.** Middleware `isAdmin`, `isSubAdmin` (refuses disabled / awaiting accounts), `requireSubAdminWritable` (unpaid = read-only), `isSelfOrAdmin`, `isAdminOrOwner`, and `requireMapAccess` with levels full / expired / preview / none (`services/accessPolicy.js`). The frontend mirrors this with route guards and `isLimitedUser`.

**CSRF.** A hand-written stateless HMAC token (`nonce.HMAC(SECRET_KEY, nonce:authToken)`) sent in the `x-csrf-token` header (`server.js:178-263`). Login, register, password reset, demo access and the public Shajra API are exempt. The `csrf-csrf` package is installed but unused.

**Headers and CORS.**
- **helmet** (`server.js:73-103`):
  - CSP: `default-src 'self'`; scripts allow `'unsafe-inline'` + Cloudflare challenges; `connect-src` includes the Worker and `wss:`.
  - `frame-ancestors 'none'`; HSTS 1 year with preload.
- **CORS** (`utils/allowedOrigins.js`): https subdomains of `ALLOWED_DOMAINS` plus `CORS_ORIGIN`, with credentials.

**Input validation.**
- **express-validator** rule sets (`middleware/validationMiddleware.js`): register, login, password, user update, search, pagination, path params, layers with a 1MB GeoJSON cap, plus `escapeRegex`.
- **Hand-written checks** in the sub-admin, assignment and payment controllers.
- **Body limits by route:** auth 100KB, default 1MB, payment proofs 4MB, GeoJSON 5MB.

**Secrets.**
- **`backend/.env`** (gitignored; the repo is public): `MONGO_URI`, `SECRET_KEY` (the server refuses to start if it's under 32 characters), `PMTILES_SIGNING_KEY`, `SMTP_*`, `TURNSTILE_SECRET_KEY`, `VAPID_*`, and URL / feature flags.
- **VAPID keys** fall back to a pair generated once and stored in the database.
- **Worker secrets** are set with `wrangler secret`.

**Data protection.**
- **PMTiles:**
  - Served through HMAC-signed URLs (15-minute TTL) from the Worker.
  - The Worker accepts closed byte ranges only, at most 2MB each.
  - The local `/pmtiles` fallback is range-only.
- **GeoJSON** can be per-user watermarked and wrapped in an AES-256-GCM envelope (`services/vectorCodec.js`).
- **State-land (AKAR) chaks** are admin-only (`utils/akarGuard.js`).

**Known gaps (confirmed in code).**
- **PMTiles full download (open).** `GET /pmtiles/:tehsil/:mouza.pmtiles` (`backend/routes/geoRoutes.js:38` → `geoController.servePMTiles`, lines 590-610) calls `res.sendFile` with no Range check. It's registered before the range-only `/pmtiles` middleware, so a logged-in user with map access can download whole files.
- **CSP (open)** still allows `'unsafe-inline'` scripts and styles (`server.js:79-80`, with a note at line 92).
- **Renewal-token check: fixed, not yet committed.** The route now has `isSelfAdminOrOwner` (`routes/userRoutes.js:43`).
- **Admin socket room: fixed, not yet committed.** `userType` is read from the database at connect (`services/socketService.js:63`), so admins join `admins`.
- **Error-response CORS: fixed, not yet committed.** `errorHandler` / `notFoundHandler` only echo origins that pass `isAllowedOrigin` (`middleware/errorHandler.js:38, 52`).

---

## 12. Distinct features

| Feature | What it does | Where |
|---|---|---|
| Signed PMTiles on R2 | HMAC-signed, short-lived, range-only map tiles served by a Cloudflare Worker with per-user rate limits; browser cache encrypted in IndexedDB | `cloudflare-worker/pmtiles-worker.js`, `backend/middleware/signedPMTilesUrl.js`, `frontend/src/features/map/core/securePMTilesProtocol.js`, `tileCache.js` |
| Protected vector data | GeoJSON watermarked per user and wrapped in AES-GCM, with per-user daily quotas | `backend/services/vectorCodec.js`, `vectorQuota.js`, `frontend/src/shared/lib/vectorEnvelope.js` |
| Land measurement | Karam / marla / kanal units, segment and area labels, mobile crosshair drawing | `features/map/core/measurementUtils.jsx`, `GuidedDrawingMode.jsx`, `GuidedRulerOverlay.jsx` |
| Reseller (sub-admin) system | Territories, versioned pricing, daily bills from an append-only ledger, credit checks, suspend-when-unpaid, policy acceptance | `backend/services/subAdminBilling.js`, `pricing.js`, `subAdminPolicy.js`, `models/AccountEvent.js`, `features/subadmin/` |
| Append-only account ledger | `AccountEvent` with update/delete hooks that throw and an idempotent `requestKey` | `backend/models/AccountEvent.js`, `services/accountEventService.js` |
| Notifications, one call | Saved in DB, sent over socket and web push; action buttons hide once handled; admin reply with WhatsApp templates | `backend/utils/notificationUtils.js`, `frontend/src/features/chrome/NotificationPanel.tsx`, `modals/ReplyModal.tsx` |
| Renewal by WhatsApp | Customer gets a renewal link token; admin opens it and renews; outcome shown on the notification | `backend/controllers/renewalController.js`, `frontend/src/features/chrome/renewal.tsx` |
| Payment proofs | Paste or upload a screenshot or SMS text, compressed in the browser, file type checked on the server | `shared/components/PaymentProof.tsx`, `backend/controllers/paymentProofController.js` |
| Multi-device control | Device fingerprint + cookie, concurrent-use detection, daily bilingual warnings | `backend/services/deviceTracker.js`, `multiDeviceWarnings.js` |
| Preview / limited access | Expired or preview users see tiles only; features are shown locked with a subscribe prompt; daily preview quota | `backend/services/accessPolicy.js`, `frontend/src/shared/lib/featureAccess.ts`, `features/map/useBrowseDeepLink.ts` |
| Guided tours | 16 tours on one hand-made engine | `frontend/src/features/tours/TourRunner.tsx` |
| Aks Shajra editor | Konva map-sheet editor with PNG/PDF export | `frontend/src/features/aks-shajra/` |
| Programmatic SEO | ~21,500 static mouza pages built from one catalog request at build time, with disk cache, Retry-After handling and JSON-LD | `site/src/mouza-catalog.ts`, `site/src/pages/maps/` |
| Inheritance engine | Exact BigInt fractions, several law systems, explained and cited results; one source for browser and server | `packages/inheritance-engine/` |
| Shajra Nasab tool | Family-tree editor in patwari style, EN/UR, share links, server PDF via Puppeteer | `site/src/tools/shajra/`, `backend/controllers/shajraController.js` |
| Server reports | Aggregations → canvas charts → HTML → Puppeteer PDF → email | `backend/services/dailyReportJob.js`, `pdfReportService.js`, `chartRenderer.js` |
| KMZ export | Land allotment parcels with canvas-drawn label icons | `backend/services/kmzBuilderService.js` |
| Deploy detection | `/meta.json` from a Vite plugin; the client reloads on a new version | `frontend/vite.config.ts`, `shared/lib/system.ts` |
| Auto version bump | Pre-commit hook bumps the version | `scripts/bump-version.mjs`, `.githooks/pre-commit` |

---

## 13. Strengths and weaknesses

**Five best things to keep**
1. **One small UI kit with a token file.** `shared/ui` (Button, Modal, Tabs, Spinner, StatTile, feedback) plus `styles/tailwind.css` (`@theme` + `@layer components`). Pages look consistent and new screens are quick to build.
2. **A layered, cluster-safe server cache with graceful fallback.** Redis → Mongo TTL → memory, with a `REDIS_ENABLED=false` kill switch, a rate-limit store that falls back to memory, and cross-worker cache invalidation. The app keeps working when Redis is down.
3. **Safe, cheap deploys.** Atomic build-folder swap, `pm2 reload` with zero downtime, `npm ci` only when the lockfile changes, the website rebuilt only when it changed, hard-link rollback copies, and a version bump on every commit with client auto-reload.
4. **Protection of paid data.** Signed short-lived URLs, range-only access, edge rate limits, an encrypted client cache, per-user quotas and watermarking. This is reusable for any app that sells content.
5. **Static website + pure shared package.** Astro sends almost no JS, generates SEO pages from the API at build time and fails safely; the dependency-free TS engine runs unchanged in the browser and on the server, with tests and no build step.

**Five worst things to avoid**
1. **Two styling worlds and arbitrary type sizes.** 4,300 lines of legacy plain CSS next to Tailwind, and about 15 different `text-[0.xrem]` sizes instead of a fixed scale. Templates should have one approach and 5–6 named sizes.
2. **Installed but unused libraries.** zod, @tanstack/react-table, React Query hooks, Radix dropdown/tooltip/switch, `csrf-csrf`, `redis`, `uuid`. Each was meant to standardise something (validation, tables, data fetching) that ended up hand-made in many places. Pick one per concern and use it everywhere.
3. **Huge files and leftover legacy code.** `MapComponent.jsx` 1,823 lines, `DrawControl.jsx` 1,450, `userController.js` 1,023, `server.js` 663. Plus routes duplicated with and without `/api`, two multi-device warning systems and dead code. Keep files under ~400 lines and delete old paths when replacing them.
4. **Heavy work inside API processes.** Puppeteer, canvas rendering and whole-collection stats run in request handlers, and scheduled work is split between BullMQ and plain timers that had to be patched to run on one instance. Use a queue with a single scheduler, and a separate worker for PDFs.
5. **Inconsistent API contract and validation.** Mixed response shapes (`{message}` / `{error}` / `{success}`), manual client validation, and per-route permission checks that can be forgotten (the PMTiles gap is still open; the renewal-token gap needed a later fix). Use one response envelope, shared schemas (e.g. zod on both sides), and permission middleware applied by default.

---

## 14. Reusable code

**Frontend (`frontend/src/`)**
- `shared/ui/cn.ts`: clsx + tailwind-merge helper.
- `styles/tailwind.css`: `@theme` tokens and the component class library (`.btn`, `.input`, `.table`, `.tabs`, `.stat-tile`…).
- `shared/ui/index.tsx`: Button, Spinner, PageSpinner, Alert, Badge, Card, StatTile, Tabs (Radix), Field, Pager, Empty, HomeIconButton, RefreshIconButton, AdminNavIcons.
- `shared/ui/Modal.tsx`: Radix Dialog modal with size presets, header variants and phone-safe placement.
- `shared/ui/feedback.tsx`: promise-based `alert` / `confirm` / `prompt` and the toast system.
- `shared/api/client.ts` + `shared/api/base.ts`: fetch client with CSRF, timeouts and an axios-like API.
- `app/guards.tsx`: role-based route guards.
- `features/chrome/Header.tsx` (`NavDropdown`, `sortList`, `useDebouncedFilter`): searchable popover select that becomes a sheet on phones.
- `features/chrome/NavigationMenu.tsx` (`SubmenuFlyout`): off-canvas sidebar with a flyout submenu.
- `features/chrome/WaText.tsx`: WhatsApp-style `*bold*` / `_italic_` text.
- `features/tours/TourRunner.tsx`: generic guided-tour engine.
- `features/users/CustomDatePicker.tsx`: date picker with no dependencies.
- `shared/components/PaymentProof.tsx`: image paste/upload with compression.
- `shared/lib/format.ts`: date, date-time, number and currency formatting (tested).
- `shared/lib/formUtils.js`, `locationUtils.js` (DMS ↔ decimal, haversine), `device.js` (device id/label), `lruCache.js`.
- `shared/lib/system.ts`: version checker (`/meta.json`), touch-friendly chart tooltips.
- `shared/lib/push.ts` + `public/push-sw.js`: Web Push subscribe/unsubscribe.
- `features/map/core/tileCache.js`: encrypted IndexedDB response cache.
- `vite.config.ts` `buildMeta()` plugin: version file for deploy detection.

**Backend (`backend/`)**
- `middleware/errorHandler.js`: `asyncHandler`, error handler, 404 handler.
- `middleware/rateLimiters.js`: limiter factory with a Redis store that falls back to memory.
- `utils/sharedCache.js`: Redis → Mongo TTL cache. `utils/cacheBus.js`: cross-worker cache invalidation.
- `services/redisClient.js`: optional ioredis singleton with a kill switch.
- `services/queueService.js`: BullMQ queues, workers and repeatable jobs behind `JOBS_ENABLED`.
- `services/socketService.js`: socket.io with cookie-JWT auth, user rooms and the Redis adapter.
- `utils/notificationUtils.js` + `services/pushNotificationService.js`: one call sends DB + socket + web push; VAPID keys kept in the DB.
- `utils/logger.js`: winston file/console logging with `security` and `audit` helpers.
- `utils/siteConfig.js`, `utils/allowedOrigins.js`: env-driven URLs, cookie domain and CORS.
- `server.js:178-257`: stateless HMAC CSRF (worth moving into its own module).
- `middleware/validationMiddleware.js`: express-validator rule sets and `escapeRegex`.
- `services/deviceTracker.js`: device tracking and concurrent-use detection.
- `models/AccountEvent.js` + `services/accountEventService.js`: append-only ledger with an idempotency key.
- `services/pdfReportService.js` (HTML → PDF), `services/chartRenderer.js` (chart.js → PNG on the server).
- `services/visitorCounter.js`: privacy-light unique visitor counter (`/api/visit.gif`).
- `utils/dbHygiene.js`, `services/unverifiedPurge.js`: retention jobs.
- `controllers/paymentProofController.js:33-50`: magic-byte image validation and storage.

**Infrastructure and other**
- `deploy.sh`: atomic build swap, pm2 reload, conditional low-priority site build, hard-link rollback.
- `deploy/nginx.conf`: proxy with socket upgrade, Range pass-through and immutable static caching.
- `scripts/bump-version.mjs` + `.githooks/pre-commit`: automatic version bump.
- `cloudflare-worker/pmtiles-worker.js` + `backend/middleware/signedPMTilesUrl.js`: signed, range-only file delivery from R2.
- `site/src/layouts/Base.astro`: SEO head (canonical, OG, Organization/WebSite/Breadcrumb JSON-LD), skip link, CSS-only dropdown nav, mobile menu toggle.
- `site/src/mouza-catalog.ts`: build-time API fetch with disk cache, `Retry-After` handling and safe failure.
- `site/astro.config.mjs`: sitemap with per-section priorities and `entryLimit`.
- `packages/inheritance-engine/`: pattern for a dependency-free TS package shared by browser and server, tested with `node --test` and no build step.
