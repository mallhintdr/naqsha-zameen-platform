# Frontend review — D:\temp-repo\frontend (2026-10-23)

Evidence came from reading the source, running `npx vite build` (output goes to `../build`, which git ignores), and running `eslint src`. I did not take the 390px screenshots or a Lighthouse trace, so those items still need checking.

## Measured facts
- Largest chunks, raw / gzip: MapPage 840k / 223k · AksShajraPage 764k / 242k · index (entry) 420k / 132k · recharts ComposedChart 352k / 102k · html2canvas 196k / 46k · leaflet 148k / 43k · ui 96k / 32k.
- `useQuery` appears in 0 files, even though `@tanstack/react-query` is a dependency.
- Arbitrary `[#…]` colour classes per feature: users 149, auth 106, admin 96, chrome 68, subadmin 19, components 15, map 12, ui 6. That is about 474 in total.
- `strict:false`, `noImplicitAny:false`, `allowJs:true` (tsconfig.json).
- 2 unit test files. ESLint reports 0 errors and 2 warnings.
- map/core is about 14.4k lines of JS and contains 10 `window.x =` assignments.
- `dark:` variants and `#00ffff`: 24 occurrences across the codebase.
- i18n: none. Only `LandAllotmentPage.tsx` sets `dir=`.

## Critical
1. **The polling load grows linearly with open tabs and can't be cached.** Evidence: `AuthProvider.tsx:239` polls notifications every 12 s and also refetches on every focus and visibility change (`:240-242`); a socket is opened per tab (`:246`); `:288` sends a heartbeat every 60 s. That is about 6 requests per minute per tab even while the socket is connected. Today's load is roughly 1k concurrent tabs, about 100 req/s. At 100x users (100k tabs) it becomes about 10k req/s of pure overhead, plus 100k sockets. Fix: poll only as a fallback while `socket.connected === false`. Pause the heartbeat while `document.hidden`, or carry it on the socket (`socket.emit('hb')`). Elect one leader tab with `BroadcastChannel` (or a SharedWorker) so a user's tabs share one socket and one poll. Make `/api/notifications` support `?since=<ts>` with ETag/304.
2. **The type system is effectively off** (tsconfig `strict:false`, `allowJs`, with `any` everywhere, e.g. `AuthProvider.tsx:231`). At scale, contract drift with the backend becomes a runtime bug. Fix: enable `strict` per folder via a `tsconfig.strict.json` covering `src/shared` and `src/app` first. Turn on `@typescript-eslint/no-explicit-any` as a warning with a budget. Parse API responses with zod, which is already installed.
3. **The map core is a ported legacy global-state island** (14.4k lines of JS, `window.*` globals, monkey patches, 840 kB chunk). It can't be tested, it leaks across route changes, and it blocks strict mode. Fix: wrap it behind one typed facade (`createMapEngine(el, opts) → {destroy, on, setLayer}`). Ban new globals with an ESLint rule (`no-restricted-globals`/`no-restricted-properties` on window assignment). Migrate one module per sprint. Add a Playwright test that mounts and unmounts MapPage 10 times and checks the heap.

## High
4. **TanStack Query is installed but unused.** Every page hand-rolls `useEffect` + `useState` fetching plus its own `setInterval` (`SubAdminDashboardPage.tsx:234` every 30 s, `:244` every 60 s). This gives no deduplication, no caching, and no cancel-on-unmount, and shows spinners on every navigation. Fix: a `QueryClientProvider` in `App.tsx`, and feature hooks such as `useUsers()` and `useNotifications()` with `refetchInterval` and `refetchIntervalInBackground:false`. Pushing a socket event becomes `queryClient.setQueryData`.
5. **Bundle weight hurts LCP on 3G/low-end Android.**
   - The entry chunk is 132 kB gzip before any route loads.
   - AksShajra is 242 kB gzip, likely from jspdf, html2canvas and konva.
   - Recharts is 102 kB gzip just for admin charts.

   Fix:
   - Dynamically `import('jspdf')` and `import('html2canvas')` only inside the export handler.
   - Add `build.rollupOptions.output.manualChunks` for leaflet, recharts and radix.
   - Check what lands in the entry chunk with `rollup-plugin-visualizer`; socket.io-client and zod probably belong after login.
   - Set budgets with `size-limit` in CI.
6. **There are no route-level error boundaries.** I found no `ErrorBoundary` in `src`. One throw in the map core blanks the whole SPA. Fix: use react-router 7's `errorElement` per route plus a `<ErrorBoundary>` around MapPage and AksShajra, with a "Reload map" CTA, and report the error (see #12).
7. **Formatting and API helpers are duplicated.** For example, `admin/insights/statsUtils.tsx` exists, and each insights tab and `AdminSubAdminConsolePage` imports its own formatting helpers; there is also a separate `subAdminApi.ts`. Fix: put a single `shared/lib/format.ts` (dates and PKR via `Intl`) and a `shared/api/*` layer per resource next to the query hooks.
8. **The design tokens are bypassed.** About 474 arbitrary `[#…]` colours (users 149, auth 106) sit alongside the tokens in `styles/tailwind.css:13-34`. The result is visual drift, and theming or dark mode becomes impossible. Fix: add the missing semantic tokens (`--color-surface`, `--color-muted`, `--color-border`…), then codemod hex values to the nearest token. Add a lint rule (`eslint-plugin-tailwindcss` or a grep in CI) that fails on new `[#`.
9. **Accessibility.**
   - `--color-accent:#00ffff` has about a 1.25:1 contrast ratio on white, so it fails WCAG wherever it is used as text or icon colour on light surfaces.
   - Only 36 `aria-` attributes exist across all of the TSX.
   - The custom pickers (`users/CustomDatePicker.tsx`, `subadmin/SubAdminMouzaPicker.tsx`) and LocationComponents dropdowns are not Radix and likely lack combobox roles and keyboard support.

   Fix:
   - Use cyan for borders and glows only; use the brand colour #0096c7 for text (darken it to #0077a3 for AA small text).
   - Replace the custom dropdowns with Radix Popover + `cmdk`, or `react-aria` ComboBox/DatePicker.
   - Add `@axe-core/playwright` to the smoke test.
10. **i18n/RTL is absent for an Urdu-speaking audience.** Fix: add `i18next` + `react-i18next` now while strings are still fresh. Switch to logical Tailwind utilities (`ms-/me-/ps-/pe-`, `start-/end-`) and set `<html dir>` per locale. Add Noto Nastaliq Urdu as a lazily loaded font. Use `Intl.NumberFormat('ur-PK')`.

## Medium
11. **Field use offline/PWA.** `public/manifest.webmanifest` and `push-sw.js` exist, but nothing precaches the app shell or tiles. Fix: `vite-plugin-pwa` (Workbox) for the shell, a runtime CacheFirst rule for pmtiles/vector tiles, and `idb` (already a dependency) for drafts, with an offline banner.
12. **Errors are invisible.** Errors are swallowed everywhere (`catch {}`, e.g. `AuthProvider.tsx:237`, `:286`). Fix: Sentry (or self-hosted GlitchTip) with `@sentry/react`, plus web-vitals reporting. Replace silent catches with `report(e)`.
13. **Notification permission is requested on login** without a user gesture (`AuthProvider.tsx:250`). Browsers penalise this and users deny it permanently. Fix: ask from a "Enable alerts" button.
14. **Insights N+1 risk.** Per-row IP lookups in the insights tabs should be batched server-side (one `/api/admin/ip-geo?ips=` call, cached), not fetched per user from the client. Verify this in `MultiIpTab.tsx` and `OnlineUsersTab.tsx`.
15. **Testing is thin:** 2 unit files plus one smoke script. Fix: Vitest + Testing Library for shared hooks and stores. Add a Playwright suite with `page.route` mocks for login, user list, map open and notification receipt, running in CI against `vite preview`.
16. **Leftover intervals.** `NavigationMenu.tsx:59` runs a fake progress interval every 600 ms, and `TourRunner.tsx:96` measures every 250 ms; replace the latter with `ResizeObserver`/`requestAnimationFrame`. `system.ts:52` checks every 30 min, which is fine.
17. **Dependency risk.**
   - `leaflet-rotate` 0.2.x and `leaflet.heat` 0.2 are unmaintained.
   - `@geoman-io/leaflet-geoman-free` is the free tier.
   - Very new majors (TS 6, Vite 8, ESLint 10, react-table 9) mean ecosystem plugins may lag.

   Fix: pin versions, use Renovate with grouped updates, and plan a MapLibre GL migration (GPU rendering, works with pmtiles natively, better on low-end phones than Leaflet DOM/SVG with thousands of parcels).

## Low
18. **No dark mode.** This becomes trivial once #8 is done (tokens plus a `prefers-color-scheme` override).
19. **Typography scale.** There is no defined type ramp in `tailwind.css`, only the font family. Define `--text-*` steps and use them.
20. **Feature flags.** There are none. A tiny `/api/flags` + `useFlag()` hook (or GrowthBook) lets the map rewrite roll out gradually.
21. **Inter is bundled via fontsource import** (`tailwind.css:7`) with all axes. Subset it to latin and use `font-display:swap`.

## World-class UX — top 10 visible improvements
1. Use skeleton loaders and cached data via React Query instead of a spinner on every navigation.
2. Show a consistent palette from tokens. Use cyan only as an accent and fix the contrast.
3. Add Urdu with an RTL toggle in the header.
4. Make it an installable PWA with offline maps for field patwaris.
5. Make the map open fast: split the 840 kB chunk, and make MapLibre the long-term map engine.
6. Use accessible, keyboard-friendly pickers (date, mouza, location) with search.
7. Show friendly error screens per route with retry, instead of a blank page.
8. Add dark mode, which suits night/field glare and the existing neon dark panels.
9. Ask for notification permission in context, and show an in-app toast centre with real-time updates over the socket only.
10. Mobile-first layouts: bottom-sheet modals at 390px, 44px tap targets, sticky primary actions on forms.
