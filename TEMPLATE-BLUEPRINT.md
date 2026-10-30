# TEMPLATE-BLUEPRINT — the starter for future apps

Built from the five app records in this folder: **Citizen Desk** (`citizen.md`), **FleetOps** (`fleetops.md`), **Kiln / Bhatta Manager** (`kiln.md`), **kpi-scale** (`kpi-scale.md`) and **Naqsha Zameen** (`temp-repo.md`). Every choice below prefers what one of these apps already does and has proven in production. Things no app has are marked **(new)** and kept to the minimum a world-class app needs.

Colours are left out. Every colour is a neutral token (`--color-primary`, `--color-ink`, …) that each app swaps in one `@theme` block.

Short names used below: **CD** = Citizen Desk, **FO** = FleetOps, **KN** = Kiln, **KS** = kpi-scale, **NZ** = Naqsha Zameen.

---

## 1. Comparison tables

### 1.1 Tech stack

| | CD | FO | KN | KS | NZ |
|---|---|---|---|---|---|
| Language | JS (JSX), no TS | TS strict | JS, ESM | TS strict | TS (+ legacy JSX in map) |
| Web | React 18, Vite 5 | React 18, Vite 6 | React 18, Vite 5 | React 19, Vite 6 | React 19, Vite 8 |
| Router | none (useState tabs) | react-router 7 | react-router 6 | react-router 7 | react-router 7 |
| Server state | none (fetch on mount) | TanStack Query 5 | none | TanStack Query 5 | QueryClient exists, unused |
| Client state | Context | zustand | window events + localStorage | Context + module globals | zustand + Context |
| Forms | useState | react-hook-form | useState | useState | useState |
| API | Express 4, Mongoose | Express 5, Mongoose | Express 4, Mongo driver | Express 5, Mongoose | Express 4, Mongoose |
| Queue / cache | BullMQ, Redis | node-cron, none | none | BullMQ, Redis L1+L2 | BullMQ, Redis→Mongo→memory |
| Realtime | Socket.io + Redis adapter | Socket.io (no adapter) | none | none | Socket.io + Redis adapter |
| Validation | zod (server) | zod (server) | zod in `packages/shared` | zod middleware (body/query/params) | express-validator |
| PWA | hand-written sw.js | vite-plugin-pwa | vite-plugin-pwa | vite-plugin-pwa | push-sw only |
| Tests | none | none | node:test (63) | scripts only | vitest + Playwright + axe |
| Lint/CI | oxlint; GitHub Actions deploy | none | none | none | none |
| Deploy | PM2 + nginx, `update.sh`, bootstrap wizard | Docker compose | PM2 + nginx, `update.sh` | Docker compose (api×2 + worker) | pm2 cluster, atomic build swap |
| Monorepo | `server/` + `web/` | npm workspaces | npm workspaces + `packages/shared` | `server/` + `web/` | npm workspaces + packages |

### 1.2 Styling

| App | CSS approach | Type scale | Radius / spacing | Class merge | Weak spots |
|---|---|---|---|---|---|
| CD | Tailwind 4 CSS-first, one 65-line `index.css`, kit in one `ui.jsx` | `xs` 13 / `sm` 15 / `base` 17; ~60 arbitrary `text-[Npx]` | `rounded-xl` controls and cards; default spacing | `clsx` | Input `text-[15px]` beats the 16px base (iOS zoom); auto title-case; dead inline-style files |
| FO | Tailwind 4, 97-line `index.css`, 270-line `ui/index.tsx` | Tailwind defaults + `text-[11px]` ×40 | `rounded-lg` controls, `rounded-2xl` cards | `clsx` | No focus ring; raw `<button>`s outside the kit |
| KN | Tailwind 4 utilities layered `important` over a 1,101-line legacy `styles.css`; no Preflight | `2xs` 11 … `xl` 20, Urdu step-up | `--radius-md` 9px, `--radius-lg` 12px | `cx` join | Two CSS systems; `!important` layer trick |
| KS | Tailwind 4, one `index.css`, ~320-line `ui.tsx` | `xs` 13 / `sm` 15 / `base` 17; `text-[12px]` ×70 | `rounded-xl`; `ring-1` instead of borders | `clsx` | Arbitrary sizes; auto title-case |
| NZ | Tailwind 4 `@theme` + Bootstrap-like `@layer components` + 4,300 lines plain CSS | base 15px; ~15 arbitrary rem sizes dominate | tokens 4/6/8/12/16px; shadow and animation tokens | `cn = twMerge(clsx)` | Two styling worlds; `btn btn-primary` ×99 vs `<Button>` ×33 |

### 1.3 Buttons

| App | Components | Variants | Sizes | States | Gaps |
|---|---|---|---|---|---|
| CD | `Button`, `IconButton` (44px, `label` required), `Segmented` | primary, secondary, ghost, danger, danger-soft | md `h-10`, sm `h-9`, `block` | hover, active, disabled 50%, `loading` spinner, `focus-visible` | Children auto title-cased; IconButton has no size prop |
| FO | `Button` (forwardRef, `icon` prop) | primary, secondary, outline, ghost, danger | sm `h-8`, md `h-10`, lg `h-12` | hover, disabled, loading replaces icon | No `focus-visible`; icon-only not square; raw buttons in header |
| KN | `Button`, `IconButton` 40px, `IconBtn` 32px, FAB 56px, `Chips` | primary, secondary, danger, dangerGhost, ghost (unused) | md `min-h-11`, sm `min-h-9` | hover/active, disabled, border spinner, `focus-visible` | Row buttons 32px |
| KS | `Button`, `IconButton` 44px, `Segmented` | primary, secondary, ghost, danger | md `h-10`, sm `h-9` | as CD | No pressed state; title-case |
| NZ | Four systems: `Button`/`.btn`, `.icon-btn` 32px, `.action-btn`, `ChromeButton`, map CSS buttons | 9 solid + 7 outline | btn / sm / lg / block | hover lift, 3px focus ring, disabled .65 | Too many variants; raw classes dominate |

### 1.4 Forms

| App | Library | Inputs | Label / Field | Validation (client → server) | Error display | Uploads / dates |
|---|---|---|---|---|---|---|
| CD | none | `inputCls` 40px ring, 15px text; Input, Search, Password, Select, Textarea | `Field` with `useId` render-prop | HTML5 + manual → zod, `ZodError`→400 | `FormError` / `Alert` form-level | multer dev only; native dates |
| FO | react-hook-form (11 pages) | `inputCls` 40px border; Field wrapper with `*` | `Field` wraps `<label>` | `register` rules, **errors never rendered** → zod `parseBody` 400 `{error, details.fieldErrors}` | first fieldError in a toast | none; native dates, `DateRangePicker` |
| KN | none | `BOX` 40px, **16px text**; `Input` digit cleanup; `MoneyInput` + Urdu words; `FormGrid` | `Field` wraps `<label>`, `*` | native `required` + `ok` flags → shared zod 400 `{error, issues}`, 422 business | `Alert` + toast | none; native dates with `max` |
| KS | none | 40px ring, 15px | `Field` with `useId` | HTML5 → zod middleware `{error:{code,message,details}}` | `FormError` one message | CSV import with dry run; native dates |
| NZ | none (zod installed, unused) | `.input` classes; login 42px | `Field` used once | manual regex → express-validator | `Alert` above form ×76; guidance modal | `PaymentProof` paste + compress + magic bytes; custom date picker |

### 1.5 Dropdowns and selects

| App | Short lists | Long lists | Multi-select | Phone behaviour | Gaps |
|---|---|---|---|---|---|
| CD | native `Select` with SVG chevron | `CommandPalette` (Ctrl K, 200ms debounce, keyboard) | none | OS picker; `Segmented` pills scroll | No combobox |
| FO | native `Select`, `limit: 500` | `<datalist>` for cities | checkbox lists | OS picker | Entity 501+ never appears |
| KN | native `Select` | `SearchSelect` combobox (all-words match, keyboard, native-required shim) | `Chips` | list inside sheet, `max-h-64` | No result cap, no portal |
| KS | native `Select` | `UnitPicker` drill-down in a `Sheet` | `CheckGroup` select-all, year chips | bottom sheet | No combobox |
| NZ | native `.select` | `NavDropdown` on Radix Popover, 300ms debounce, cap 1,000–1,500 | mouza pickers with select-all and max | popover becomes a full-width sheet | Radix dropdown-menu installed, unused |

### 1.6 Menus and navigation

| App | Routing | Nav definition / roles | Desktop | Phone | Gaps |
|---|---|---|---|---|---|
| CD | none | `NAV` array `{roles, group}`; server `authorize()` | sidebar `w-56` → 60px rail, remembered | bottom bar 4 + "More" sheet | No URLs, no back button |
| FO | react-router 7, all lazy, `RequireAuth` | `NAV` 14 entries, `finance` flag | off-canvas `w-64` + hamburger | same sidebar slides in | No bottom bar; no collapsed mode |
| KN | react-router 6, eager | tile Home menu filtered by role; **no per-role route guard** | none (bottom nav everywhere) | bottom nav 5 with centre FAB; section tabs | Any user can open any URL |
| KS | react-router 7, lazy, `Protected` with role | `NAV` with `show(caps)` from `/rev/meta` | sidebar `w-52` collapsible | bottom bar 5 + More page; `PageBoundary` | No focus trap |
| NZ | react-router 7, lazy, `ProtectedRoute role` | hand-written menu by role; locked items | off-canvas 240px + flyout submenu | flyout covers menu, z-index 9999 | Emoji icons; inline route list |

### 1.7 Responsive

| App | Direction | Tables on phones | Dialogs | Safe areas | Touch targets | Problems |
|---|---|---|---|---|---|---|
| CD | mobile-first (`sm:` ×98) | card list `md:hidden` + table `hidden md:block` | `Sheet` bottom sheet → dialog at `sm` | `pt-safe`/`pb-safe`, `viewport-fit=cover` | 40–44px; `Segmented` 32px | 15px inputs zoom on iOS |
| FO | mobile-first | horizontal scroll `min-w-[640px]` | Modal → sheet below 640 | none | 24–32px icons/pills | Toaster overflows at 320px |
| KN | mobile-first | CSS `data-label` card stacking below 640 | `Sheet` | insets used but **no `viewport-fit=cover`** | 44px buttons, 32px row icons | Truncated Urdu labels |
| KS | mobile-first, 360px audit clean | scroll; `hidden sm:table-cell`; Officer-wise layout | `Sheet` | yes | 44px; checkboxes 32px | — |
| NZ | desktop-first (`max-sm:` ×110) | smaller padding and text | compact centred modals only | yes | 36px | `maximum-scale=1`; 0.55rem text |

### 1.8 Performance

| App | Splitting / bundle | Browser cache | Server cache | DB | Slow spots |
|---|---|---|---|---|---|
| CD | 6 lazy panels; main 344kB, recharts 417kB | hand sw.js network-first shell; nginx immutable | Redis 30–300s TTL | `syncIndexes` in migrate, `.lean()`, projections, capped arrays | 200-row lists filtered client-side; one 1s timer per row; skip paging |
| FO | all routes lazy; `manualChunks` vendor/charts/map | Workbox precache; RQ `staleTime` 20s | none | `.lean()`, parallel count+find, TTL on pings; **autoIndex off in prod, no migrate** | unanchored regex search; N+1 reports; 13-query dashboard; 4–5 writes per GPS ping |
| KN | **none**: one 851kB chunk | API SW cache regex never matches; nginx immutable | in-process maps | 20 indexes, many hot collections unindexed | `recomputeLines` over all history on every read; dashboards 5–25 uncached queries |
| KS | lazy + `manualChunks`; exceljs on demand | NetworkFirst API cache cleared per user; RQ 30s | L1 LRU + L2 Redis, **data-version keys, single-flight** | tenant-first indexes, rollups, `anc` arrays | 720kB payloads; org-wide invalidation; Excel from DOM |
| NZ | 22 lazy pages; no `manualChunks` (1.6MB map route) | version checker; encrypted IDB tile cache | Redis → Mongo TTL → memory; cross-worker bus | explicit indexes, `$facet`, pool 25 | auth lookup every request; Puppeteer in API; broken stats cache |

### 1.9 Scalability

| App | State | API shape | Jobs | Rate limit | Multi-instance |
|---|---|---|---|---|---|
| CD | Context + useState, no request cache | module `routes → controller → service`; `{success,…}` | BullMQ 4 queues, idempotent ids, Redis locks, separate worker | Redis store, per IP / IP+email / user | Redis adapter, leader-elected change stream; local uploads block it |
| FO | RQ + zustand | `mountCrud` factory; `{items,total,page,limit,pages}` | node-cron **in-process** | memory store | no adapter, cron duplicates, single-node Mongo |
| KN | window events; Dexie outbox | `register*Routes`; `scope()` tenant | none | memory, login only | one pm2 process |
| KS | RQ + Context | routers per module; `{error:{code,message,details}}`; `tenantPlugin` | BullMQ `defineJob/enqueue`, inline fallback, tenant context | Redis store keyed by JWT subject | api×2 + worker, pub/sub invalidation |
| NZ | zustand + Context | mixed envelopes, duplicate routes | BullMQ + **timers on every instance** | Redis with memory fallback, many tiers | pm2 cluster, adapter, no sticky sessions |

### 1.10 Security

| App | Auth | Secrets / env | Input | Headers | Extras | Gaps |
|---|---|---|---|---|---|---|
| CD | JWT 15m in memory + httpOnly refresh 7d hashed, rotation, reuse detection; bcrypt 12; Redis active-check 60s | zod env, fail-fast in prod | zod `.strict()`, ObjectId checks, body 200kb | helmet CSP, CORS allowlist | signed file URLs, single-use form tokens, webhook HMAC, SSRF-safe fetch, CSV neutralisation | no tests |
| FO | JWT 7d in localStorage, also `?token=` | fallback `dev-secret-change-me` | zod `parseBody`; raw body spread in ping | helmet on API only, no CSP on SPA | — | no refresh, no revocation |
| KN | JWT 7d localStorage, sliding header renewal; bcrypt 10 | dev fallback secret; prod refuses without | shared zod; some routes unvalidated | **no helmet**; CORS reflects any origin when unset | audit log on every write; 402/423 states | 500 leaks `err.message`; no revocation |
| KS | JWT 15m + refresh cookie with family revocation, `tokenVersion`, role from DB, read-only guest | zod env, secrets ≥32 chars, pino redaction | zod body/query/params everywhere, body 200KB | helmet, CORS allowlist | timing-safe login, webhook HMAC | — |
| NZ | JWT 30d httpOnly cookie, `tokenVersion`, email OTP, device tracking, Turnstile | `SECRET_KEY` ≥32 enforced | express-validator, per-route body limits, magic-byte uploads | helmet CSP (`unsafe-inline`), HSTS | HMAC CSRF, signed PMTiles, watermarking | PMTiles full download; missing ownership check; origin echo on errors |

---

## 2. Decisions per section

| Section | Decision | Why (and source) |
|---|---|---|
| **Styling** | Tailwind 4 CSS-first only. One `index.css` with `@theme` tokens, a tiny `@layer base`, two safe-area utilities and two keyframes. UI kit in `components/ui/` on utility classes. `cn = twMerge(clsx)` everywhere. **No** `@layer components` class library, **no** legacy CSS, **no** `!important` layer. | CD, FO and KS prove a sub-100-line stylesheet plus a small kit keeps 20–35 pages uniform. NZ's `.btn` library and KN's legacy file both turned into a second styling system. `twMerge` (NZ) fixes the `className` override problem the other four have. |
| **Type scale** | Seven named sizes, no arbitrary `text-[…]` (checked in CI). `base` = 16px so inputs and buttons use `text-base` and iOS never zooms. | CD and KS both run a one-step-larger scale on phones; KN adds `2xs` for badges and table meta, which is the only honest use of the 40–70 `text-[11px]` hits in FO and KS. Fixing `base` at 16px removes the CD zoom bug by construction. |
| **Buttons** | One `Button` (CD/KS base) with FO's `lg` size and `icon` prop, KN's 44px default for icon buttons. Variants: `primary`, `secondary`, `ghost`, `danger`, `danger-soft`. Sizes `sm` 36, `md` 40, `lg` 48. `focus-visible` ring, `loading`, `block`, `type="button"` default. No automatic title-casing. | CD/KS buttons are the most complete (focus, loading, aria). FO's `icon` prop removes ad-hoc icon markup. `danger-soft` (CD/KN) is used in every app for row deletes; FO's `outline` duplicates `secondary`. Title-casing is in CD's and KS's avoid lists. |
| **Forms** | react-hook-form + `zodResolver`, schemas in `packages/shared` and reused by the API. `Field` renders label, hint and error for every control; server `fieldErrors` are mapped onto fields with `setError`. Inputs 40px, 16px text, ring style; `MoneyInput` and numeric digit cleanup from KN. Native date inputs. | FO already has RHF and the resolver installed, and its own avoid list says to wire them. KN's shared zod package is the only app where client and server cannot drift. CD/KS `useId` `Field` gives correct labels for free. Native dates worked in all five apps; NZ's custom picker is 1 file nobody else needed. |
| **Dropdowns** | Native `Select` for ≤ 15 options. `SearchSelect` (KN) for longer lists, with a 50-result cap and server-side search once a list passes 200 rows (NZ's debounce + cap). Multi-select = checkbox list with select-all (FO/KS) or `Chips` for ≤ 8 options (KN). Drill-down `UnitPicker` (KS) as an optional module. No headless UI library. | KN's `SearchSelect` is 1 file, keyboard-accessible and already handles native `required`. FO's `limit: 500` into native selects silently loses rows; the cap + server search prevents that. NZ shows Radix Popover ends up being overridden with `!important` on phones anyway. |
| **Menus / navigation** | react-router 7, layout route `AppShell`, every page `lazy()`, `Protected` guard **per role** (KS/NZ). One `NAV` array with `roles` and `group` (CD/KS). Desktop: collapsible sidebar `w-56` → 60px rail remembered in `localStorage`. Phone: bottom tab bar, 4 tabs + "More" sheet. Header `h-14` sticky with bell, avatar, sign-out. Filters, tabs and open modals in search params (FO). `PageBoundary` error boundary per route (KS). | CD's lack of a router is its #1 weakness; FO/KS/NZ all use react-router 7 without issue. Bottom tabs appear in CD, KN and KS, the three phone-first apps; FO's off-canvas drawer is the only desktop-first nav. KN shows that menu filtering without route guards is a hole. |
| **Responsive** | Mobile-first with Tailwind's default breakpoints; `max-*` variants forbidden. `viewport-fit=cover` plus `pt-safe`/`pb-safe`. Minimum 40px for any tappable control, 44px for icon-only. `DataTable` renders `<table>` from `md` and a card per row below it, from the same column definitions. `Sheet` is a bottom sheet below `sm`, a dialog above. No `maximum-scale=1`. | Four apps are mobile-first and their phone screens work; NZ's desktop-first CSS needed 180 `max-*` overrides. CD's cards-below-`md` pattern and FO's typed `DataTable` merge into one component so no page writes a table twice. KN proves safe-area insets are useless without `viewport-fit=cover`. |
| **Performance** | Route-level `lazy()` + `manualChunks` (`vendor`, `charts`, `map`), recharts never in the landing route, exceljs on demand. vite-plugin-pwa with precache + NetworkFirst API cache using a **function** `urlPattern`. TanStack Query `staleTime` 30s. Server `cached(key, ttl, fn)` with single-flight and version-scoped keys (KS), Redis-backed, in-process fallback. Indexes declared on models and synced by `migrate` on deploy (CD/KS). `.lean()` + projections, paged lists, no N+1. | FO/KS bundles show `manualChunks` cuts first paint by two thirds vs KN's single chunk. KN's regex SW rule never matched; the function form is the fix named in its record. KS's cache is "correct by construction"; the template scopes keys per resource so one write doesn't evict everything. FO's `autoIndex: false` with no migrate step means no indexes in production. |
| **Scalability** | Stateless API; **nothing per-process**: Redis for rate limits, cache L2, Socket.io adapter, locks. BullMQ via `defineJob/enqueue/schedule` with inline fallback (KS); schedulers run only in the `worker` process (`RUN_WORKERS`), never in API replicas (CD). Socket.io `transports: ['websocket']` so no sticky sessions are needed. One error envelope `{ error: { code, message, details, requestId } }`; lists `{ items, total, page, limit, pages }`. `mountCrud` for plain resources, explicit routes for actions (FO). | CD and KS are the two apps that already run API×N + worker; everything they externalised is what FO, KN and NZ list under "breaks first". KS's error shape has codes the client can switch on; FO's paging contract makes `useList` generic. |
| **Security** | KS auth: 15m access JWT in memory, rotating httpOnly refresh cookie with family revocation, `tokenVersion`, role read from DB, 60s Redis-cached active check (CD). bcrypt 12. zod env with fail-fast and ≥32-char secrets. helmet CSP on API and SPA (nginx). CORS allowlist, bearer only (never query string or localStorage). zod `validate` on body/query/params for every route; `router.use(requireAuth)` by default so a forgotten guard denies. Generic 500 message, pino redaction, request id. Webhook HMAC with `timingSafeEqual`, signed file URLs, SSRF-safe fetch, CSV neutralisation, magic-byte upload check (NZ). Audit log helper (KN). | CD and KS independently converged on the same auth design and neither has a known gap. FO, KN and NZ gaps (fallback secrets, `?token=`, open CORS, missing per-route checks, leaked messages) are all prevented by env validation, default-deny routers and one error handler. |

Where two systems conflicted the loser is dropped, not kept beside the winner: Tailwind over component-class CSS, react-hook-form over `useState` forms, fetch wrapper over axios, react-router over tab state, bottom tabs over drawer, TanStack Query over fetch-on-mount, BullMQ over node-cron, Redis stores over memory stores.

---

## 3. Component system

### 3.1 Tokens (`apps/web/src/index.css`)

```css
@import 'tailwindcss';

@theme {
  /* Colours: neutral placeholders, swap per app. Keep the names. */
  --color-primary: #335;        --color-primary-strong: #224;  --color-on-primary: #fff;
  --color-surface: #fff;        --color-surface-2: #f5f5f5;    --color-canvas: #ececec;
  --color-ink: #111;            --color-ink-muted: #666;       --color-line: #ddd;
  --color-danger: #a33;         --color-danger-soft: #fdd;
  --color-success: #3a3;        --color-warning: #a83;         --color-info: #36a;
  --color-focus: #335;

  /* Type: seven named sizes, nothing else. base = 16px so inputs never zoom on iOS. */
  --text-2xs: 0.6875rem; --text-2xs--line-height: 1rem;     /* 11px  badges, table meta */
  --text-xs:  0.8125rem; --text-xs--line-height: 1.15rem;   /* 13px  hints, labels */
  --text-sm:  0.9375rem; --text-sm--line-height: 1.35rem;   /* 15px  body, cells */
  --text-base: 1rem;     --text-base--line-height: 1.5rem;  /* 16px  inputs, buttons */
  --text-lg:  1.125rem;  --text-lg--line-height: 1.6rem;    /* 18px  card titles */
  --text-xl:  1.25rem;   --text-xl--line-height: 1.75rem;   /* 20px  page titles */
  --text-2xl: 1.5rem;    --text-2xl--line-height: 2rem;     /* 24px  stat values */

  --font-sans: 'Inter', 'Noto Sans', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --radius-md: 0.5rem;   /* inputs, small chips */
  --radius-lg: 0.75rem;  /* buttons, cards, sheets on desktop */
  --radius-xl: 1rem;     /* bottom sheets, skeletons */
  --breakpoint-xs: 30rem; /* 480px: only for 2→3 column tile rows */
}

@layer base {
  html { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
  body { @apply bg-canvas text-ink text-sm antialiased; overscroll-behavior-y: none; font-feature-settings: 'tnum'; }
  input, select, textarea { font-size: 16px; }      /* iOS: never zoom on focus */
  button { cursor: pointer; }
  :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
  table > tbody > tr:nth-child(even) { @apply bg-surface-2; }
}

@utility pt-safe { padding-top: max(0.75rem, env(safe-area-inset-top)); }
@utility pb-safe { padding-bottom: max(0.75rem, env(safe-area-inset-bottom)); }

@keyframes sheet-up { from { transform: translateY(100%); } to { transform: none; } }
@keyframes fade-in  { from { opacity: 0; } to { opacity: 1; } }
.animate-sheet { animation: sheet-up 220ms cubic-bezier(.2,.8,.2,1); }
.animate-fade  { animation: fade-in 160ms ease-out; }
@media (prefers-reduced-motion: reduce) { .animate-sheet, .animate-fade { animation: none; } }
@media print { .no-print { display: none !important; } body { background: #fff; } }
```

Sources: scale and safe-area utilities from CD/KS, `2xs` and 16px inputs from KN, `tnum` and print rules from FO, reduced motion from CD. `viewport` meta in `index.html`: `width=device-width, initial-scale=1, viewport-fit=cover`.

### 3.2 Sizes, spacing, breakpoints

| Thing | Value |
|---|---|
| Control heights | `sm` 36px (`h-9`), `md` 40px (`h-10`), `lg` 48px (`h-12`); icon-only 44px (`size-11`), 40px in dense headers |
| Inputs | 40px, `px-3`, `text-base`, `ring-1 ring-line`, `focus:ring-2 focus:ring-primary`, `rounded-md` |
| Page gutter | `px-3 sm:px-4 lg:px-6`; `<main>` bottom padding `pb-28 lg:pb-6` to clear the tab bar |
| Max content width | `max-w-[1600px] mx-auto` |
| Card | `rounded-lg bg-surface ring-1 ring-line shadow-sm`, padding `p-3 sm:p-4`, header `px-4 py-3 border-b` |
| Vertical rhythm | `space-y-4` between cards, `gap-3` inside forms, `gap-2` in toolbars |
| Sidebar | `w-56`, collapsed `w-[60px]`; header `h-14`; bottom tab bar `h-16` |
| Table cells | `px-3 py-2 text-sm`; header `text-2xs font-semibold uppercase tracking-wide` |
| Breakpoints | Tailwind defaults `sm` 640, `md` 768, `lg` 1024, `xl` 1280 plus `xs` 480. Sidebar from `lg`; tables from `md`; dialogs from `sm` |
| Icons | lucide-react, `size-4` in buttons, `size-5` in icon buttons, `size-[22px]` in tab bar, `aria-hidden` |
| Z-index | header 30, tab bar 40, sheet 50, toast 60. Nothing else |

### 3.3 `cn` helper and Button

```tsx
// components/ui/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...i: ClassValue[]) => twMerge(clsx(i));
```

```tsx
// components/ui/Button.tsx
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary:       'bg-primary text-on-primary shadow-sm hover:bg-primary-strong active:bg-primary-strong',
  secondary:     'bg-surface text-ink ring-1 ring-line hover:bg-surface-2',
  ghost:         'text-ink hover:bg-surface-2',
  danger:        'bg-danger text-on-primary hover:brightness-95',
  'danger-soft': 'bg-danger-soft text-danger ring-1 ring-danger/30 hover:brightness-95',
};
const SIZE: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-base gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size; block?: boolean; loading?: boolean; icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap select-none transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none',
        VARIANT[variant], SIZE[size], block && 'w-full', className,
      )} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'md' | 'lg' }>(
  function IconButton({ label, size = 'lg', className, children, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} aria-label={label} title={label}
        className={cn('grid shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-surface-2 disabled:opacity-50',
          size === 'lg' ? 'size-11' : 'size-10', className)} {...rest}>
        {children}
      </button>
    );
  });
```

Usage, one line per variant:

```tsx
<Button loading={save.isPending} type="submit">Save</Button>
<Button variant="secondary" icon={<Plus className="size-4" />} onClick={openNew}>New customer</Button>
<Button variant="ghost" onClick={close}>Cancel</Button>
<Button variant="danger" onClick={remove}>Delete</Button>
<Button variant="danger-soft" size="sm" onClick={discard}>Discard</Button>
<Button block size="lg" type="submit">Sign in</Button>           {/* driver / login screens */}
<IconButton label="Close" onClick={close}><X className="size-5" /></IconButton>
```

Behaviour: hover changes background; `loading` disables and swaps the icon for a spinner; `disabled` is 50% opacity with no pointer events; `focus-visible` ring always on; `active` darkens `primary` only. `Segmented` (CD/KS) covers tab-like toggles with `role="tablist"` and `aria-selected`; `Chips` (KN) covers pill toggles with `aria-pressed`. Neither is a `Button` variant.

### 3.4 Inputs and Field

```tsx
// components/ui/Field.tsx
import { useId, type ReactNode } from 'react';
import { cn } from './cn';

export const inputCls =
  'h-10 w-full rounded-md bg-surface px-3 text-base text-ink ring-1 ring-line placeholder:text-ink-muted ' +
  'outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2 disabled:opacity-70 aria-[invalid=true]:ring-danger';

export function Field({ label, hint, error, required, className, children }: {
  label: string; hint?: string; error?: string; required?: boolean; className?: string;
  children: (id: string, aria: { 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink">
        {label}{required && <span className="ms-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children(id, { 'aria-invalid': !!error || undefined, 'aria-describedby': error || hint ? msgId : undefined })}
      {(error || hint) && (
        <p id={msgId} role={error ? 'alert' : undefined} className={cn('text-xs', error ? 'text-danger' : 'text-ink-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
```

```tsx
// components/ui/Input.tsx  (Input, Textarea, Select, SearchInput, PasswordInput, MoneyInput)
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  (p, ref) => <input ref={ref} {...p} className={cn(inputCls, p.className)} />);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  (p, ref) => <textarea ref={ref} {...p} className={cn(inputCls, 'h-auto min-h-24 py-2', p.className)} />);

const CHEVRON = `url("data:image/svg+xml,...")`; // 18px chevron, same in every app
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  (p, ref) => <select ref={ref} {...p}
    className={cn(inputCls, 'appearance-none pe-9 bg-no-repeat bg-[length:18px] bg-[right_10px_center] rtl:bg-[left_10px_center]', p.className)}
    style={{ backgroundImage: CHEVRON }} />);

// Numeric: Urdu/Arabic digits → ASCII, strip commas (KN). Use inputMode="numeric" | "decimal".
export const cleanNumber = (s: string) =>
  s.replace(/[٠-٩۰-۹]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d) >= 0 ? '٠١٢٣٤٥٦٧٨٩'.indexOf(d) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
   .replace(/[,\s]/g, '');
```

Form pattern (react-hook-form + shared zod schema):

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { customerSchema, type CustomerInput } from '@app/shared/schemas/customer';

const form = useForm<CustomerInput>({ resolver: zodResolver(customerSchema), defaultValues });
const save = useSave<CustomerInput>('/customers', { onFieldErrors: (e) => Object.entries(e).forEach(([k, m]) => form.setError(k as any, { message: m[0] })) });

<form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid grid-cols-2 gap-3" noValidate>
  <Field label="Name" required error={form.formState.errors.name?.message} className="col-span-2">
    {(id, aria) => <Input id={id} {...aria} {...form.register('name')} autoComplete="name" />}
  </Field>
  <Field label="Phone" error={form.formState.errors.phone?.message}>
    {(id, aria) => <Input id={id} {...aria} {...form.register('phone')} inputMode="tel" />}
  </Field>
  <FormError error={save.error} />                       {/* non-field errors only */}
  <div className="col-span-2 flex justify-end gap-2">
    <Button variant="ghost" onClick={close}>Cancel</Button>
    <Button type="submit" loading={save.isPending}>Save</Button>
  </div>
</form>
```

Rules: every control sits in a `Field`; `noValidate` on the form so zod messages (not browser bubbles) show; the server's `details.fieldErrors` are mapped with `setError`; the submit button carries `loading`; success → toast + `invalidateQueries` + close. Form grids are `grid-cols-2` on phones (KN/KS), `md:grid-cols-3` or `-4` above, wide fields `col-span-2`.

### 3.5 Dropdowns

Native `Select` for short lists. `SearchSelect` (KN, copied as-is, plus a result cap and server search):

```tsx
// components/ui/SearchSelect.tsx — props
type Option = { value: string; label: string; search?: string };
type Props = {
  options: Option[]; value: string | null; onChange: (v: string | null) => void;
  placeholder?: string; required?: boolean; ariaLabel?: string;
  onQuery?: (q: string) => void;   // set this when the list is server-searched (> 200 rows)
  max?: number;                    // default 50 rendered results
};
```

Behaviour: `type="search" role="combobox"` input 40px, 16px text; every word of the query must match `label + search` in any order; ArrowUp/Down, Enter, Escape; active row kept in view; closes on outside `pointerdown`; option chosen on `onPointerDown` + `preventDefault` so blur doesn't race; a hidden 1px `required` input keeps native validation; list `absolute top-full z-30 max-h-64 overflow-y-auto rounded-lg bg-surface shadow-lg ring-1`; on phones the list may sit inside a `Sheet`. "No results" and "Type to search" rows. When `onQuery` is given the parent debounces 300ms (NZ) and the hook is `useList('/customers', { q, limit: 50 })`.

Multi-select: `CheckGroup` (KS) = checkbox rows `min-h-10` with "Select all / Clear" and a count; `Chips` (KN) for ≤ 8 toggles. Hierarchical: `UnitPicker` optional module (§6).

### 3.6 Menus and navigation

```ts
// components/layout/nav.ts
export type NavItem = { to: string; label: string; icon: LucideIcon; roles?: Role[]; group?: 'manage' | 'dev'; end?: boolean };
export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['owner', 'manager'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['owner'], group: 'manage' },
];
export const visibleNav = (role: Role) => NAV.filter(n => !n.roles || n.roles.includes(role));
```

`AppShell` (CD/KS merged):
- Frame `min-h-dvh lg:flex`. Sidebar from `lg`: `sticky top-0 h-dvh w-56`, collapses to `w-[60px]` with `transition-[width] duration-200`, state in `localStorage['sidebar-collapsed']`; links `h-10 rounded-md text-sm`, active = background + 3px `before:` bar + `aria-current="page"`; collapsed links show `title` and `aria-label`; group headings "Manage".
- Header `sticky top-0 z-30 h-14 pt-safe` with brand, page title (short on phones), search/command button, bell with unread badge (`9+` cap), avatar, sign-out below `lg`.
- Phone: `fixed inset-x-0 bottom-0 z-40 h-16 pb-safe lg:hidden` tab bar with the first 4 visible items + "More"; More opens a `Sheet` with a 3-column grid of every item. Tabs are `flex-col text-2xs`, icon in a `h-7 w-14 rounded-full` pill when active.
- `<main className="px-3 sm:px-4 lg:px-6 pb-28 lg:pb-6 max-w-[1600px] mx-auto w-full">` with `<Suspense fallback={<Loading/>}>` and `<PageBoundary key={pathname}>`.
- `PageHeader({ title, subtitle, back, actions })`: `text-xl lg:text-2xl font-bold line-clamp-2`; actions wrap `w-full sm:w-auto`.

Routing:

```tsx
// App.tsx
const Customers = lazy(() => import('./features/customers/pages/Customers'));
<Routes>
  <Route path="/login" element={<Login />} />
  <Route element={<Protected />}>                      {/* no session → /login?from= */}
    <Route element={<AppShell />}>
      <Route index element={<Home />} />
      <Route path="customers" element={<Customers />} />
      <Route path="customers/:id" element={<CustomerDetail />} />
      <Route element={<Protected roles={['owner']} />}>  {/* wrong role → / with toast */}
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Route>
</Routes>
```

UI state that must survive reload or be shareable lives in search params: `?tab=`, `?status=`, `?q=`, `?page=`, `?new=1` (FO). Keyboard: Ctrl/⌘ K opens the command palette (CD) when a search endpoint exists; Esc closes any `Sheet`.

### 3.7 Sheet (modal / bottom sheet / dialog)

One component for every dialog (CD/KS, plus the focus trap no app had):

```tsx
// components/ui/Sheet.tsx
export function Sheet({ open, onClose, title, size = 'md', tone, footer, children }: {
  open: boolean; onClose: () => void; title: string; size?: 'md' | 'lg' | 'xl' | 'full';
  tone?: 'form'; footer?: ReactNode; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE); (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab' || !panel.current) return;                         // (new) focus trap
      const f = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.hasAttribute('disabled'));
      if (!f.length) return;
      const [a, z] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade bg-ink/40 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sheet-title"
        className={cn('relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface shadow-2xl animate-sheet',
          'rounded-t-xl sm:rounded-lg',
          { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-5xl', full: 'sm:max-w-6xl h-dvh sm:h-auto rounded-none pt-safe sm:pt-0' }[size])}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />   {/* drag handle, decorative */}
        <div className={cn('flex items-center justify-between gap-2 px-4 py-3', tone === 'form' ? 'bg-surface-2 border-b' : '')}>
          <h2 id="sheet-title" className="text-lg font-bold">{title}</h2>
          <IconButton label="Close" size="md" onClick={onClose}><X className="size-5" /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="border-t px-4 py-3 pb-safe">{footer}</div>}
      </div>
    </div>, document.body);
}
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
```

Behaviour: bottom sheet below `sm`, centred dialog above; backdrop click, Esc and ✕ close; body scroll lock; focus moves in and returns on close; `size="full"` is full-screen on phones. Confirmations use `useConfirm()` (NZ's promise-based `confirm` rendered as a small `Sheet`), never `window.confirm`.

### 3.8 Toasts

`ToastProvider` + `useToast()` (CD/KS) with FO's queue limit and dismiss button: `toast(message, tone: 'ok' | 'error' | 'info')`, fixed top-centre `z-60 pt-safe`, `aria-live="polite"`, max 3 visible, auto-dismiss 3200ms (6000ms for errors), `w-[min(24rem,calc(100vw-1.5rem))]` so it never overflows a 320px screen, each toast has an ✕. Errors from `useSave`/`useRemove` go here automatically.

### 3.9 DataTable and Pagination

Typed columns (FO) that render a table from `md` and a card list below it (CD):

```tsx
// components/ui/DataTable.tsx
export type Column<T> = {
  key: string; header: string; render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center'; className?: string;
  hideOnMobile?: boolean;      // omit from the phone card
  primary?: boolean;           // shown as the card title on phones
};
export function DataTable<T extends { _id: string }>({ columns, rows, loading, empty, onRowClick, footer, minWidth = 640 }: Props<T>) {
  return (
    <>
      <Card className="hidden md:block overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth }}>
          <thead className="sticky top-0 z-10 bg-surface-2 text-2xs font-semibold uppercase tracking-wide">
            <tr>{columns.map(c => <th key={c.key} className={cn('px-3 py-2 text-left border-b', c.align === 'right' && 'text-right')}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={columns.length} className="py-12 text-center"><Spinner /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={columns.length} className="py-14"><Empty title={empty ?? 'Nothing here yet'} /></td></tr>}
            {rows.map(r => (
              <tr key={r._id} onClick={onRowClick && (() => onRowClick(r))}
                  className={cn(onRowClick && 'cursor-pointer hover:bg-surface-2', 'aria-selected:bg-primary/10')}>
                {columns.map(c => <td key={c.key} className={cn('px-3 py-2 border-b tabular-nums', c.align === 'right' && 'text-right', c.className)}>
                  {c.render ? c.render(r) : String((r as any)[c.key] ?? '')}</td>)}
              </tr>))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </Card>
      <div className="md:hidden space-y-2">
        {rows.map(r => (
          <Card key={r._id} onClick={onRowClick && (() => onRowClick(r))} className="px-4 py-3">
            {columns.filter(c => c.primary).map(c => <div key={c.key} className="text-base font-semibold">{c.render ? c.render(r) : String((r as any)[c.key])}</div>)}
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {columns.filter(c => !c.primary && !c.hideOnMobile).map(c => (
                <Fragment key={c.key}><dt className="text-ink-muted">{c.header}</dt><dd className="text-right tabular-nums">{c.render ? c.render(r) : String((r as any)[c.key] ?? '')}</dd></Fragment>))}
            </dl>
          </Card>))}
      </div>
    </>
  );
}
```

Behaviour: sticky header, zebra rows from base CSS, numbers `tabular-nums` and right-aligned, hover and `aria-selected` row states, loading row, empty row, optional totals `tfoot`. Sorting by header click sets `?sort=` (server supports `-field,field`, whitelisted). `Pagination` (FO): "Page x of y · n records" with prev/next `secondary sm` buttons, hidden when one page; lists keep `placeholderData` while paging. Long client-side lists use `useProgressive` (KS) instead of a virtualisation library. Inline row editing (`useRowEdit`, KN) is an optional module.

### 3.10 Cards, stats, loaders, empty states

- `Card({ title?, action?, padded = true, onClick?, as? })`: see §3.2; clickable cards add `cursor-pointer active:scale-[0.99] hover:ring-primary/40`.
- `Stat({ label, value, hint, icon, tone, loading, onClick })` (CD `KpiTile` + FO `Stat`): `rounded-lg p-4 ring-1`, label `text-2xs uppercase tracking-wide`, value `text-2xl font-bold tabular-nums`, skeleton while loading. Grid `grid-cols-2 sm:grid-cols-3 xl:grid-cols-6`.
- `Badge({ tone: 'neutral' | 'ok' | 'warn' | 'err' | 'info' })`: `rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset`; status → tone mapping in one `STATUS_TONE` dictionary with a `label()` humaniser (FO).
- `Spinner` (lucide `Loader2 animate-spin`); `Loading({ rows = 3 })` = `h-20 animate-pulse rounded-xl` blocks with `aria-busy` as the route fallback; `Skeleton` for inline use.
- `Empty({ title, body, action, icon = Inbox })` centred with a `size-14 rounded-xl` icon tile; `ErrorState({ error, retry })` builds on it with "Try again".
- `Alert({ tone })` inline banner with `role="alert"` for errors, `role="status"` otherwise.

---

## 4. Standard tech stack and folder structure

### 4.1 Stack (ranges; pin exact versions in the lockfile; Node pinned in `.nvmrc` and `engines`)

| Layer | Choice | Taken from |
|---|---|---|
| Runtime | Node 22 (`engines: ">=22"`), npm workspaces | all five |
| Language | TypeScript 5, `strict: true`, in web, api and shared | FO, KS, NZ |
| Web | React 19, Vite 6, `@vitejs/plugin-react`, `vite-plugin-pwa` 1.x | KS |
| Styling | Tailwind 4 via `@tailwindcss/vite`, `clsx`, `tailwind-merge`, `lucide-react` | all; `twMerge` from NZ |
| Routing / data | react-router 7, `@tanstack/react-query` 5, `zustand` 5 (persisted UI prefs only) | FO, KS |
| Forms | `react-hook-form` 7 + `@hookform/resolvers` + `zod` 3 | FO (installed), KN (shared schemas) |
| Charts | `recharts` 2 in its own chunk; `exceljs` on demand | FO, KS |
| Realtime | `socket.io-client` 4 | CD, FO, NZ |
| API | Express 5 (native async errors), `helmet`, `cors`, `compression`, `cookie-parser`, `pino` + `pino-http` | KS, FO |
| Data | MongoDB 7 replica set, Mongoose 8, `ioredis` 5, `bullmq` 5, `socket.io` 4 + `@socket.io/redis-adapter`, `express-rate-limit` 7 + `rate-limit-redis` | CD, KS |
| Auth | `jsonwebtoken` 9, `bcryptjs` | CD, KS |
| Tests | `vitest` (web + api), `mongodb-memory-server` (replica set), `@testing-library/react`, Playwright smoke + `axe-core` | KN, NZ |
| Quality | ESLint flat config + `typescript-eslint`, Prettier, `lint-staged` on pre-commit, `scripts/check-classes.mjs` **(new)** | CD (lint), NZ (hooks) |
| Ops | Docker compose for dev and CI; PM2 + nginx recipe for a VPS; `update.sh` with `flock` and `migrate`; GitHub Actions `ci.yml` + `deploy.yml` | CD, KS, NZ |

Dropped on purpose: axios (fetch wrapper is enough), node-cron (BullMQ schedulers), express-validator (zod), Radix (Sheet + SearchSelect cover it), react-table (DataTable), dayjs (`Intl` + 6 helpers in `format.ts`), winston (pino).

### 4.2 Folder structure

```
template/
  package.json                 workspaces ["apps/*","packages/*"]; scripts: dev, build, test, lint, typecheck, check
  .nvmrc  .editorconfig  .prettierrc  eslint.config.js  tsconfig.base.json
  .githooks/pre-commit         lint-staged + scripts/bump-version.mjs
  .github/workflows/ci.yml     typecheck → lint → check-classes → test → build (on every PR)
  .github/workflows/deploy.yml build + ssh → scripts/ci-entry.sh → update.sh (on main)
  docker-compose.yml           mongo (rs0), redis, migrate, api, worker, web (nginx)
  deploy/nginx.conf  deploy/ecosystem.config.cjs  update.sh
  scripts/bump-version.mjs  check-classes.mjs  vps-bootstrap.sh  setup-wizard.sh  ci-entry.sh  backup.sh
  docs/ADR-0001-stack.md       one-page record of the decisions in this blueprint (new)

  packages/shared/src/
    index.ts                   re-exports
    schemas/<entity>.ts        zod input/output schemas, used by API validate() and web zodResolver
    roles.ts                   Role union, RANK, DEFAULT_PERMS
    constants.ts               statuses, enums, limits
    money.ts                   paisa helpers (KN) when the app has money

  apps/api/src/
    index.ts                   boot: env → db → redis → app → socket → (workers if RUN_WORKERS) → graceful shutdown
    worker.ts                  standalone worker + schedulers
    migrate.ts                 replica-set check, syncIndexes for every model, idempotent backfills, seed admin
    app.ts                     helmet, cors allowlist, compression, pino-http (+requestId), json limit, rate limit, routes, 404, error handler
    config/env.ts              zod-validated env; exits in prod on missing/short secrets
    config/db.ts  redis.ts  logger.ts
    lib/errors.ts              AppError, httpError(status, code, message)
    lib/cache.ts               cached(key, ttl, fn): L1 LRU + Redis, single-flight, version-scoped keys
    lib/queue.ts               defineJob / enqueue / schedule / startWorker (BullMQ, inline fallback)
    lib/locks.ts               acquire/renew/release with token (Lua)
    lib/pagination.ts          parsePaging, paginate, searchFilter, dateRange, pickFilters
    lib/crud.ts                mountCrud(router, { model, schemas, searchFields, filterKeys, hooks, softDelete })
    lib/sequence.ts            nextNumber(key, prefix, width)
    lib/fileUrl.ts  safeFetch.ts  csv.ts  audit.ts
    middleware/authenticate.ts authorize.ts  validate.ts  rateLimit.ts  error.ts
    realtime/socket.ts         JWT handshake, rooms user:/role:/tenant:, emitUser/emitRole, Redis adapter
    models/<Entity>.ts         schema + indexes declared next to each other
    modules/<feature>/
      <feature>.routes.ts      router.use(requireAuth) first; mountCrud + explicit action routes
      <feature>.service.ts     all DB access; controllers stay thin or are omitted
      <feature>.jobs.ts        defineJob(...) handlers
    test/                      vitest + memory replica set + login helper

  apps/web/src/
    main.tsx                   providers: QueryClient, Auth, Toast, Router
    App.tsx                    route table (lazy pages, Protected, AppShell)
    index.css                  §3.1
    app/queryClient.ts  guards.tsx  (Protected, PageBoundary)
    components/ui/             cn, Button, Field, Input, Select, SearchSelect, Sheet, Toast, DataTable, Pagination,
                               Card, Stat, Badge, Segmented, Chips, Loading, Empty, Alert   (each file < 300 lines)
    components/layout/         AppShell.tsx, nav.ts, PageHeader.tsx
    features/<feature>/        pages/, components/, api.ts (useList/useOne/useSave typed to the shared schema)
    lib/api.ts                 fetch wrapper: in-memory access token, single-flight refresh on 401, ApiError, qs(), download()
    lib/auth.tsx               AuthProvider, useAuth, can(role)
    lib/data.ts                useList, useOne, useSave, useRemove, useAction (TanStack Query, FO contract)
    lib/socket.ts  useSocketEvent / useGlobalRealtime
    lib/format.ts              money (k/L/Cr), num, date, dateTime, ago, inputDate, label()
    lib/hooks.ts               useMediaQuery, useDebounce, useOnline, useProgressive, useConfirm
    public/manifest.webmanifest, icons

  apps/site/                   optional Astro 5 static marketing site (KN/NZ skeleton), only when a public site is needed
```

File-size rule: no source file over 400 lines (NZ's 1,800-line components are on the avoid list); `check` script fails CI above that.

---

## 5. Performance and scalability baseline

Rules every new app follows from day one. Each one is a defect that at least one of the five apps shipped with.

**Frontend**
1. Every page is `lazy()`; `manualChunks` split `vendor`, `charts`, `map`. Nothing above 300 kB gzip may load on the landing route; `recharts` is only imported inside chart components. (KN single chunk, FO charts on landing.)
2. TanStack Query for all server data: `staleTime` 30s, `retry` 1, no retry on 4xx, `placeholderData: prev` on lists, cache cleared on login/logout/tenant change. No `useEffect` fetching. (CD, KN, NZ fetch on mount.)
3. Lists are paged on the server (`limit` ≤ 100, default 25) and rendered with `useProgressive` when a single screen must show more than 200 rows. Never fetch 200–500 rows to filter in the browser. (CD queue, FO selects.)
4. One shared timer per screen for live counters, not one per row. (CD `WaitTimer`.)
5. Memoise row derivation and cache `Intl.NumberFormat` instances. (KS 13× speedup.)
6. PWA: precache the build; API GETs use NetworkFirst with a **function** `urlPattern`, 24h, cleared per user; `/api/auth` never cached; update by `autoUpdate` + version poll and one reload. (KN regex bug.)
7. Exports are built from data on the server (streamed CSV, or an `exceljs` job), never from the DOM. (KS.)
8. Fonts self-hosted with `font-display: swap`; images lazy and sized; no raster in `public/` over 100 kB. (NZ.)

**API**
9. Every list filter, foreign key and sort field has an index; tenant-owned indexes start with `tenantId`; `migrate` runs `syncIndexes()` on every deploy and `autoIndex` is off in production. (FO had neither.)
10. Reads use `.lean()` and `.select()`; list payloads exclude large sub-documents; aggregations fan out with `Promise.all` and are bounded by date. (KS 720 kB rows, KN all-history scans.)
11. Search: text index or anchored regex on an indexed field, query 2–64 chars, regex-escaped. (FO unanchored `$or` scan.)
12. No N+1: use `$lookup`, `$in` or a map. CI test fixture with 50 rows fails if a list endpoint exceeds 5 queries. (FO, NZ, KN.)
13. Derived numbers (balances, stock, scores) are stored as running totals or rollup documents written on change, never recomputed from full history per request. (KN `recomputeLines`, KS rollups as the fix.)
14. `cached(key, ttl, fn)` with single-flight for every dashboard endpoint; keys scoped `tenant:resource:version`, bumped on write to that resource only. (KS org-wide churn.)
15. Heavy work (PDF, OCR, email, WhatsApp, imports) runs as a BullMQ job in the `worker` process with `jobId` de-duplication, 3 attempts, exponential backoff and `removeOnComplete`. Nothing launches Chromium in an API process. (NZ Puppeteer.)
16. Schedulers (`schedule(name, cron)`) register only in the worker; the API never runs `setInterval`/cron. (FO, NZ duplicate timers.)
17. Nothing per-process: rate-limit store, cache L2, Socket.io adapter, locks are Redis. The app still boots without Redis in single-instance dev mode (KS inline fallback, NZ kill switch).
18. Socket.io: JWT handshake, rooms `user:`, `role:`, `tenant:`; `transports: ['websocket']`; emit minimal payloads; clients invalidate queries on events rather than carrying data. (CD, FO.)
19. Uploads go to S3-compatible storage behind `STORAGE_MODE`; local disk only in dev. (CD.)
20. `/health` (liveness) and `/ready` (Mongo + Redis ping) endpoints; graceful shutdown on SIGTERM with a 10s cap. **(ready is new)**
21. Response compression on, `ETag` default, hashed assets `immutable` 1y, `index.html`/`sw.js` `no-cache`, API `no-store`. (CD/KN nginx.)
22. Multi-tenant apps enable `tenantPlugin` (KS) so a query without tenant context throws.

---

## 6. Feature library (optional modules)

Each module is copied from the named app and adapted to the template's kit, error envelope and shared schemas. "Needs" lists what the module depends on beyond the template core.

### UI and interaction

| Module | What it gives | Source | Path | Needs |
|---|---|---|---|---|
| Command palette | Ctrl/⌘ K global search with debounce and keyboard nav, full-screen on phones | CD | `web/src/components/common/CommandPalette.jsx` | a `/search` endpoint |
| Searchable combobox | `SearchSelect` type-to-filter, keyboard, native-required shim | KN | `apps/pwa/src/components/SearchSelect.jsx` | — |
| Drill-down picker | `UnitPicker`/`UnitField` tree chooser in a sheet with breadcrumb trail | KS | `web/src/components/rev.tsx` | a `/:id/children` endpoint |
| Searchable popover that becomes a sheet | `NavDropdown`, `sortList`, `useDebouncedFilter` | NZ | `frontend/src/features/chrome/Header.tsx` | replace Radix with `Sheet` |
| Multi-select with limit | tehsil + filterable checklist, select-all, `maxItems` | NZ | `frontend/src/features/subadmin/SubAdminMouzaPicker.tsx` | — |
| Inline row editing | `useRowEdit`, `RowActions` edit/save/cancel/delete in tables | KN | `apps/pwa/src/components/RowActions.jsx` | — |
| Card-stacked tables (CSS only) | `data-label` stacking below 640px, sticky first column, per-column filter row | KN | `apps/pwa/src/tailwind.css:80-104`, `useFrozenColumns.js` | alternative to DataTable cards |
| Officer-wise / grouped report layout + toolbar | collapse groups, full screen, print, Excel, CSV; icon-only on phones | KS | `web/src/components/reportTools.tsx`, `lib/xlsx.ts` | exceljs (lazy) |
| Progressive list rendering | page-at-a-time render, `withAll()` for print/export | KS | `web/src/lib/progressive.ts` | — |
| Year / period comparison | side-by-side periods with change | KS | `web/src/components/yearCompare.tsx` | — |
| Quick-entry bottom sheet + FAB | `openQuick(kind)`, `SPEC {ok, send, clear}`, "Save & next", remembered last values | KN | `apps/pwa/src/components/QuickEntry.jsx` | — |
| Day register (batch save grid) | paper-register screen, one Save all, partial-failure report | KN | `apps/pwa/src/components/DayRegister.jsx` | domain adaptation |
| Guided tours | spotlight engine with `data-tour` hooks, `waitFor`, auto-run once | KN (simpler) / NZ (16 tours, avoids modals) | `apps/pwa/src/components/Tour.jsx` / `frontend/src/features/tours/TourRunner.tsx` | — |
| Promise-based confirm / prompt | `useDialog().confirm()` queued dialogs | NZ | `frontend/src/shared/ui/feedback.tsx` | render in `Sheet` |
| Stat grid with CountUp | `StatCard`, `cardSpan`, `StatGrid` 6-column auto layout | KN | `apps/pwa/src/components/ui.jsx:127-154` | — |
| Dependency-free SVG charts | line + bar with legend, tooltip, a11y table | KN | `apps/pwa/src/components/LineChart.jsx`, `BarChart.jsx` | use instead of recharts for 1–2 charts |
| Recharts wrappers | shared axis/tooltip style, `Donut`, `HBar`, `TrendLine` | FO | `client/src/components/charts/index.tsx` | recharts |
| Leaflet map + live markers | `FleetMap` divIcon markers, fit bounds, trails | FO | `client/src/components/map/FleetMap.tsx` | leaflet |
| Location picker | Leaflet picker, satellite/street layers | KN | `apps/pwa/src/components/LocationPicker.jsx` | leaflet |
| Printable documents | `.no-print`, `print:` utilities, bare `/print/*` routes, `@page` rules | FO / KN | `client/src/pages/bilty/BiltyDetail.tsx`; `apps/pwa/src/pages/Print*.jsx` | — |
| Urdu/English i18n + RTL | `dict` + `useT`, `dir` at runtime, Urdu font step-up, digit cleanup, amount in words | KN | `apps/pwa/src/i18n.js`, `components/AmountHint.jsx` | — |
| Money input | grouped echo while typing, plain digits to parent | KN | `apps/pwa/src/components/ui.jsx:260-265` | — |
| Image paste/upload with compression | hidden input, Ctrl+V paste, canvas resize to 1600px JPEG | NZ | `frontend/src/shared/components/PaymentProof.tsx` | server magic-byte check (below) |
| CSV bulk import with dry run | row-level errors, template download, background job polled by id | KS | `web/src/pages/admin/Import.tsx`, `server/src/modules/org/imports.ts` | queue |
| Web push | subscribe/unsubscribe, `push-sw.js`, VAPID keys kept in DB | NZ | `frontend/src/shared/lib/push.ts`, `public/push-sw.js`, `backend/services/pushNotificationService.js` | web-push |
| Deploy detection + reload | `/meta.json` from a Vite plugin, poll, clear caches, reload | NZ / KN | `frontend/vite.config.ts` `buildMeta`; `apps/pwa/src/updateWatcher.js` | — |
| Offline outbox | Dexie POST queue with `clientUuid`, replay on reconnect, "Saved offline" | KN | `apps/pwa/src/api.js:1-8,75-103` | unique `clientUuid` index on every replayed collection |
| Optimistic switch | `AvailabilityToggle` with revert + toast | CD | `web/src/components/layout/AppShell.jsx` | — |
| Attention strip | icon badges for pending counts, hidden when clear | KN | `apps/pwa/src/components/Attention.jsx` | — |
| Error boundary per route, offline banner | `PageBoundary`, `OfflineBanner`/`useOnline` | KS | `web/src/components/AppShell.tsx` | in core |

### Server

| Module | What it gives | Source | Path | Needs |
|---|---|---|---|---|
| CRUD factory | `mountCrud` with zod schemas, search, filters, date range, scope, hooks, soft delete | FO | `server/src/utils/crud.ts`, `pagination.ts` | in core |
| Sequence numbers | `BL-000123` via atomic `$inc` upsert | FO | `server/src/utils/sequence.ts` | in core |
| Multi-tenancy plugin | `tenantPlugin` + `AsyncLocalStorage`, `runUnscoped`, `runAsTenant` | KS | `server/src/lib/tenantPlugin.ts`, `tenantContext.ts` | — |
| Versioned cache | `cached()`, `dataVersion`, `bumpData`, pub/sub invalidation | KS | `server/src/lib/cache.ts`, `dataVersion.ts` | in core |
| Period rollups | per-unit per-period totals with change-only writes and a verification script | KS | `server/src/modules/revenue/rollup.ts`, `scripts/check-rollups.mjs` | — |
| Job wrapper | `defineJob/enqueue/schedule/startWorker` with inline fallback and tenant context | KS | `server/src/lib/queue.ts` | in core |
| Distributed locks | token-based acquire/renew/release (Lua) | CD | `server/src/config/redis.js` | in core |
| Change stream → sockets | leader-elected Mongo change stream with resume token and room-scoped payloads | CD | `server/src/changeStreams/customerStream.js` | replica set |
| Notification router | `notify()` persists + emits to user/role room; `notifyOnce()` dedupe; TTL index | FO / CD | `server/src/services/notificationService.ts`; CD `Notification` model | — |
| One-call notification (DB + socket + push) | with action buttons that hide once handled | NZ | `backend/utils/notificationUtils.js` | web-push |
| WhatsApp provider facade | cloud / WASender / mock behind one interface, templates, logged dev mode, E.164 | CD / FO / KS | CD `server/src/modules/whatsapp/*`; FO `services/whatsappService.ts` | — |
| WhatsApp coaching scheduler | morning/evening/escalation ladder, rate-limited send queue | KS | `server/src/modules/whatsapp/*` | queue |
| AI intake pipeline | webhook → dialog state machine → Gemini extraction → payment pitch | CD | `server/src/modules/{webhook,dialog,ai,payment}/` | Gemini key |
| Receipt OCR verification | AI vision, duplicate transaction refs refused, idempotent | CD | `server/src/modules/ai/ai.vision.js`, `payment/payment.worker.js` | — |
| Atomic "take next" claim | single `findOneAndUpdate` sorted by urgency, double-click guard hook | CD | `server/src/modules/ticket/ticket.service.js`, `web/src/lib/useTakeNextCase.js` | — |
| Event timeline on a record | capped `events` array + `CaseTimeline` | CD | `server/src/models/Customer.model.js`, `web/src/components/case/CaseTimeline.jsx` | — |
| Double-entry ledger | `postEntry`/`reverseEntry`/`balance`, money as paisa `Decimal128` | KN | `apps/api/src/core.js`, `packages/shared/src/index.js` | — |
| Khata ledger with denormalised balance | `postLedgerEntry` `$inc` + `balanceAfter`, `recomputeBalance`, aging buckets | FO | `server/src/services/ledgerService.ts`, `routes/reports.ts:205-232` | — |
| Append-only account ledger | update/delete hooks throw, idempotent `requestKey` | NZ | `backend/models/AccountEvent.js`, `services/accountEventService.js` | — |
| Fee split + streaming CSV export | split percentages validated to sum 1, cursor stream, BOM, per-admin lock | CD | `server/src/modules/financial/financial.service.js` | — |
| Audit log | before/after snapshots on every write, `editor()`/`deleter()` factories | KN | `apps/api/src/core.js`, `edits.js`, `deletes.js` | in core (`lib/audit.ts`) |
| Permissions matrix | `requirePerm(module, action)`, role defaults + per-user overrides | KN | `apps/api/src/users.js` | — |
| Subscriptions / trial / grace | tenant states, 402 read-only, banner | KN | `apps/api/src/admin.js`, `components/SubscriptionBanner.jsx` | — |
| Reseller billing | territories, versioned pricing, daily bills, credit checks | NZ | `backend/services/subAdminBilling.js`, `pricing.js` | — |
| Device tracking / concurrent-use detection | fingerprint + cookie, warnings | NZ | `backend/services/deviceTracker.js`, `multiDeviceWarnings.js` | — |
| Email OTP on first login | `crypto.randomInt`, hashed, 15-min, timing-safe | NZ | `backend/controllers/authController.js` | nodemailer |
| Read-only guest demo | `ro` claim, non-GET refused | KS | `server/src/middleware/auth.ts` | — |
| Signed file URLs + safe streaming | HMAC expiring URLs | CD | `server/src/utils/fileUrl.js`, `modules/files/files.routes.js` | in core |
| Signed, range-only tile delivery at the edge | Cloudflare Worker + R2, per-user limits, encrypted IDB cache | NZ | `cloudflare-worker/pmtiles-worker.js`, `frontend/src/features/map/core/tileCache.js` | Cloudflare |
| SSRF-safe fetch | https only, host allowlist, no redirects, size/timeout caps | CD | `server/src/utils/safeFetch.js` | in core |
| Magic-byte upload validation | JPG/PNG/WebP by first bytes, 3 MB cap, stored outside web root | NZ | `backend/controllers/paymentProofController.js:33-50` | in core |
| Stateless HMAC CSRF | for cookie-only auth setups | NZ | `backend/server.js:178-257` | only if bearer tokens are not used |
| Server PDF reports | aggregations → canvas charts → HTML → Puppeteer → email, in a worker | NZ | `backend/services/pdfReportService.js`, `chartRenderer.js` | puppeteer in worker only |
| KMZ export | parcels with canvas label icons | NZ | `backend/services/kmzBuilderService.js` | — |
| Open-Meteo weather proxy | with TTL cache | KN | `apps/api/src/weather.js` | — |
| Org blueprint (config as versioned data) + 27 starter templates | hierarchy/posts/KPIs validated with `superRefine` | KS | `server/src/modules/org/blueprint.ts`, `templates.ts` | — |
| Score baseline snapshot | diff two snapshots after a refactor | KS | `server/scripts/baseline.mjs` | — |
| Realistic seed | 6-month coherent demo data | FO / KN | `server/src/seed/seed.ts`; `apps/api/src/seedHistory.js` | — |
| Shared pure TS package | engine used by browser and server, `node --test`, no build | NZ | `packages/inheritance-engine/` | pattern |

### Ops

| Module | What it gives | Source | Path |
|---|---|---|---|
| One-command VPS setup | interactive wizard + idempotent bootstrap (replica set, deploy key, secrets, PM2, nginx with rollback, certbot, CI key) | CD | `scripts/setup-wizard.sh`, `scripts/vps-bootstrap.sh`, `scripts/ci-entry.sh` |
| Locked, checked deploy | `update.sh`: `flock`, `npm ci`, check, `migrate`, build, PM2 restart, `/health` | CD | `update.sh`, `ecosystem.config.cjs` |
| Zero-downtime atomic deploy | build into `build_next`, swap, `pm2 reload`, hard-link rollback, conditional site build | NZ | `deploy.sh` |
| GitHub Actions deploy | build + check on push, ssh with forced command | CD | `.github/workflows/deploy.yml` |
| Docker compose with replicas | migrate one-shot, api×2, worker, nginx web | KS | `docker-compose.yml`, `web/nginx.conf` |
| nginx site template | SPA fallback, `/api` proxy, socket upgrade, immutable assets, security headers | CD / KN | `deploy/nginx-citizen-desk.conf`; `deploy/nginx/bhatta-manger.conf` |
| Backups | mongodump rotation, guarded restore | KN | `scripts/backup.sh` |
| Version bump on commit + `/version` + `__APP_VERSION__` | | KN / NZ | `scripts/bump-version.mjs`, `.githooks/pre-commit` |
| Static marketing site | Astro, EN/UR, SEO head, JSON-LD, sitemap, breadcrumbs, 404 for both languages, programmatic pages from the API | KN / NZ | `apps/site/`; `site/src/mouza-catalog.ts` |

---

## 7. Avoid list

| Weakness found | Where | How the template prevents it |
|---|---|---|
| No router; tabs in `useState`, no URLs or back button | CD | react-router in `App.tsx` from the first commit; `Protected` + `AppShell` layout route are part of the template |
| Two styling systems (legacy CSS beside Tailwind, `!important` layer, Bootstrap-like class library) | KN, NZ | Only `index.css` may contain CSS; `check-classes.mjs` fails CI on any other `.css` file and on `style={{` outside `charts/` and `map/` |
| Arbitrary font sizes (`text-[13px]`, `text-[0.8rem]` ×15 variants) | CD, KS, NZ, FO | Seven named sizes; CI greps for `text-\[` and fails |
| Inputs under 16px → iOS zoom | CD | `base` = 16px; inputs use `text-base`; base CSS sets 16px; CI greps `text-sm` inside `inputCls` |
| No `tailwind-merge`, `className` overrides depend on CSS order | CD, FO, KN, KS | `cn()` is the only class helper exported |
| Auto title-casing of labels | CD, KS | Not included; labels are written as they should render |
| Silent client validation (RHF rules without rendering errors; zod installed unused) | FO, NZ | `Field` requires `error` to be passed from `formState`; the `useForm` wrapper `useAppForm(schema)` always uses `zodResolver`; a lint rule bans bare `useForm` |
| Server `fieldErrors` not mapped onto fields | KS, CD | `useSave` takes `onFieldErrors`; the error envelope always has `details.fieldErrors` |
| Native selects loaded with up to 500 rows; row 501 missing | FO | `SearchSelect` with cap 50 and `onQuery` server search; `useLookup()` warns in dev when a list has > 200 rows |
| Menu filtered by role but routes not guarded | KN | `Protected roles` route element; API `router.use(requireAuth)` as the first line of every module router (default deny) |
| Dialogs without Esc, focus trap, portal, scroll lock or `role="dialog"` | FO, KN, (trap: all) | `Sheet` has all five; `window.confirm` is banned by lint (`no-restricted-globals`) |
| Toasts that overflow 320px screens, no dismiss, no cap | FO, CD | Toast width `min(24rem, 100vw − 1.5rem)`, ✕ button, max 3 |
| Touch targets 24–32px (pills, row icons, checkboxes, close buttons) | FO, KN, KS, NZ | Minimum `h-9` / `size-10` in every kit control; axe + Playwright check at 360px |
| Safe-area insets without `viewport-fit=cover`; or `viewport-fit=cover` without insets | KN, FO | Both are in `index.html` and `index.css` |
| `maximum-scale=1` | NZ | Not set; map pages lock zoom on the map container only |
| Desktop-first `max-*` queries | NZ | Lint bans `max-sm:`/`max-md:`/`max-lg:` prefixes |
| Single 850 kB chunk; recharts on the landing page | KN, FO | `manualChunks` in `vite.config.ts`; `size-limit` budget in CI: landing route ≤ 300 kB gzip **(new)** |
| Service-worker API cache rule that never matches | KN | Function `urlPattern`; a vitest test asserts the rule matches `/api/customers` |
| `autoIndex: false` in production with no index sync | FO | `migrate.ts` runs `syncIndexes()` and is a required step in `update.sh` and `docker-compose` |
| Full-history recomputation per request (`recomputeLines`, stock, 13-query dashboards, `/health` calling itself) | KN, FO | Running totals / rollups + `cached()`; rule 13–14 in §5; query-count test in rule 12 |
| Unanchored regex search over 6 fields | FO | `searchFilter` anchors on indexed fields or uses a text index; query length 2–64 |
| N+1 loops in reports and jobs | FO, NZ, KN | Query-count fixture test; `$lookup`/`$in` helpers in `lib/pagination.ts` |
| Per-row 1s timers, no memoisation | CD | One `useNow(1000)` hook per screen; `React.memo` on row components in the kit |
| Excel built from the DOM | KS | `exportXlsx(rows, columns)` job on the server |
| Process-local state: memory rate limiter, in-process cron, Socket.io without adapter, timers on every instance | FO, KN, NZ | Rules 15–17 in §5; `RUN_WORKERS` split; compose runs api×2 so duplicates show up in dev |
| Puppeteer / canvas in API processes | NZ | Only `worker.ts` may import puppeteer (lint `no-restricted-imports` in `apps/api/src/modules/**`) |
| Fallback JWT secret, token in `?token=`, token in `localStorage`, 7–30 day tokens with no revocation | FO, KN, NZ | zod env fails without ≥32-char secrets; bearer header only; 15m access + rotating refresh cookie + `tokenVersion` |
| No helmet / no CSP on SPA / CORS reflects any origin | KN, FO | helmet in `app.ts`; nginx template sends CSP and HSTS for the SPA; `CORS_ORIGINS` required in prod |
| 500 responses leak `err.message`; mixed error shapes; duplicate routes with and without `/api` | KN, NZ | One `errorHandler`, one envelope, generic message for non-operational errors, `requestId` in every error |
| Validation applied unevenly; raw `req.body` spread | KN, FO | `validate({ body, query, params })` replaces `req.body`; a test walks the router stack and fails for any write route without `validate` **(new)** |
| Per-route permission checks that can be forgotten (renewal token, PMTiles full download) | NZ | Default-deny routers; ownership checks live in services (`assertOwner(doc, user)`) |
| Idempotency only on some collections; offline replay duplicates | KN | Every write schema has optional `clientUuid`; `mountCrud` adds a unique sparse index on it |
| Installed-but-unused libraries (zod, react-table, Radix, csrf-csrf, React Query) | NZ, FO | `depcheck` in CI; one library per concern listed in §4.1 |
| Huge files (1,800-line components, 1,000-line controllers), dead code, hard-coded version strings | NZ, CD | 400-line limit in `check`; `knip` for unused exports **(new)**; version from `__APP_VERSION__` only |
| No tests, no lint, no CI, no `engines` pin | CD, FO, KN, KS | `ci.yml` runs typecheck, lint, check, tests and build on every PR; `.nvmrc` + `engines` |
| Module-level global metadata with Proxies | KS | Org/tenant metadata comes from `useAuth()` / a query hook |
| Emoji as icons or in product copy | FO, NZ | lucide only; lint rule on emoji ranges in JSX text |
| Local-disk uploads blocking a second server | CD | `STORAGE_MODE=s3` required when `API_REPLICAS > 1` (env refinement) |
| Backups on the same host only | KN | `backup.sh` pushes the archive to S3-compatible storage when `BACKUP_BUCKET` is set |

---

## 8. Build plan

In order. Each step ends with a running, tested state.

1. **Repo skeleton.** `git init`, npm workspaces, `.nvmrc` 22, `tsconfig.base.json`, ESLint flat + Prettier, `lint-staged`, `.githooks/pre-commit` with `bump-version.mjs` (KN/NZ), `.editorconfig`, `.gitignore` (CD list), `docs/ADR-0001-stack.md` summarising §2.
2. **`packages/shared`.** `roles.ts`, `constants.ts`, `schemas/user.ts` (login, create, update), `schemas/common.ts` (`objectId`, `pagination`, `dateRange`), `money.ts`. Vitest for schemas.
3. **API core.** `config/env.ts` (zod, fail-fast, ≥32-char secrets, `STORAGE_MODE` refinement), `logger.ts` (pino + redaction + requestId), `db.ts` (replica-set check, pool), `redis.ts` (optional with kill switch), `app.ts` (helmet, CORS allowlist, compression, json limit, pino-http, `/health`, `/ready`, 404, `errorHandler` with the one envelope), `lib/errors.ts`, `middleware/validate.ts`, `middleware/rateLimit.ts` (Redis store, memory fallback in dev). Boot with `index.ts` + graceful shutdown. Test: app boots against memory replica set; `/ready` 200.
4. **Auth module.** `User` model (bcrypt 12, `tokenVersion`, `status`), `Session` model (hashed refresh, `familyId`, TTL), `tokens.ts`, routes `login/refresh/logout/me` with rotation and family revocation (KS), login limiters per IP and per email+IP, `authenticate` with 60s Redis-cached active check (CD), `authorize(...roles)` and `atLeast(role)`. Tests: login, refresh rotation, reuse revokes family, deactivated user rejected.
5. **Data helpers.** `lib/pagination.ts`, `lib/crud.ts` (`mountCrud`, FO), `lib/sequence.ts`, `lib/cache.ts` (KS), `lib/locks.ts` (CD), `lib/queue.ts` (KS) + `worker.ts`, `lib/audit.ts` (KN), `migrate.ts` (`syncIndexes` + backfills + seed admin). Tests: paging contract, crud hooks, cache single-flight, query-count fixture, router-walk test for `validate` on writes.
6. **Realtime + notifications.** `realtime/socket.ts` with JWT handshake, rooms and Redis adapter; `Notification` model with TTL; `notify()`/`notifyOnce()` (FO) as a job. `GET /notifications`, `unread-count`, `read-all`.
7. **Example module.** `modules/customers` using `mountCrud` + one action route (`/:id/status`) + one job + audit, with a shared schema. This is the copy-me template for every future entity.
8. **Web core.** Vite config (alias, dev proxy for `/api` and `/socket.io`, `manualChunks`, `__APP_VERSION__`, vite-plugin-pwa with function `urlPattern`), `index.html` (viewport, self-hosted fonts, manifest), `index.css` (§3.1), `lib/api.ts` (fetch wrapper, in-memory token, single-flight refresh), `lib/auth.tsx`, `lib/data.ts` (`useList/useOne/useSave/useRemove/useAction`), `queryClient.ts`, `lib/format.ts`, `lib/hooks.ts`.
9. **UI kit.** `cn`, `Button`/`IconButton`, `Field`/`Input`/`Select`/`Textarea`/`SearchInput`/`PasswordInput`/`MoneyInput`, `SearchSelect`, `Segmented`, `Chips`, `Sheet` (with focus trap), `useConfirm`, `Toast`, `Card`/`Stat`/`Badge`, `DataTable`/`Pagination`, `Loading`/`Spinner`/`Empty`/`ErrorState`/`Alert`. Storybook is not needed; a `/dev/kit` route (dev-only, CD's `devOnly` flag) renders every component in every state and is the visual check. Testing-library tests for Sheet (Esc, trap, return focus), Field (label/aria wiring), Button (loading disables).
10. **Shell and routing.** `nav.ts`, `AppShell` (sidebar, header, bottom tabs + More sheet, `PageBoundary`, `OfflineBanner`), `PageHeader`, `Protected`, `App.tsx` with lazy routes, `Login` page, `Home` with `Stat` grid, `Notifications` page, `More` sheet. Playwright: login, navigate, 360px no horizontal scroll, axe clean.
11. **Example feature on the web.** `features/customers`: list page (`DataTable`, search param filters, `Pagination`), detail page, create/edit in a `Sheet` with `useAppForm(customerSchema)` and field-error mapping, delete with `useConfirm`. This is the copy-me page set.
12. **Quality gates.** `scripts/check-classes.mjs` (arbitrary text sizes, extra `.css` files, `max-*` prefixes, `window.confirm`, emoji, 400-line files), `depcheck`, `knip`, `size-limit` budget, `ci.yml` running typecheck → lint → check → test → build. Make the gates fail on a deliberate violation, then fix it.
13. **Ops.** `docker-compose.yml` (mongo rs0, redis, migrate, api×2, worker, web nginx), `deploy/nginx.conf` with security headers and cache rules, `deploy/ecosystem.config.cjs` (`api` with `RUN_WORKERS=false`, `worker`), `update.sh` (CD: flock, ci, check, migrate, build, reload, health), optional atomic swap from NZ, `scripts/vps-bootstrap.sh` + `setup-wizard.sh` + `ci-entry.sh` (CD), `scripts/backup.sh` (KN) with optional bucket upload, `deploy.yml`. Dry-run the bootstrap on a fresh VM.
14. **Feature modules folder.** Copy the §6 modules that are generic enough into `modules/` (API) and `features/` (web) behind a `template.config.json` list, each with a README of what it needs. Start with: command palette, offline outbox, CSV import, WhatsApp facade, multi-tenancy plugin, rollups, signed files, image upload, web push, audit permissions matrix, subscriptions, i18n. Each module has at least one test.
15. **Seed and docs.** `seed.ts` with a coherent 3-month dataset (FO pattern), `README.md` (dev in 3 commands, env table, module list, how to add an entity in 20 lines), `CONTRIBUTING.md` with the rules from §5 and §7.
16. **Dogfood.** Build one small real app from the template in a day. Every friction point becomes a template fix, not an app workaround. Tag `v1.0.0`.

### Additions not found in any app (kept deliberately small)

- Focus trap and focus return in `Sheet`.
- `/ready` endpoint, CI pipeline with typecheck/lint/test/build, `size-limit` budget, `depcheck`/`knip`, 400-line file limit, class-usage checker.
- Router-walk test proving every write route has `validate` and `requireAuth`; query-count fixture test.
- `useAppForm(schema)` wrapper and `useConfirm()` so forms and confirmations have one path.
- Error tracking hook: `logger.error` plus an optional `SENTRY_DSN` env; off by default.
- `docs/ADR-0001-stack.md` so the next person knows why each library is there and which ones are banned.
