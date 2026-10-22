# Porting guide (contract for every feature port)

Read `docs/REBUILD-PLAN.md` first. Decisions D1-D12 were accepted at their **defaults** (bold column in plan section 9).

## Sources of truth
- Legacy code: `old-repo/src/**` (read-only, never edit).
- Design record: `docs/legacy-inventory/inv-0*.md` — exact colours, sizes, fields, endpoints, flows, gotchas.
- Backend: `backend/` — unchanged. Every endpoint, payload and auth rule must be honoured as-is.

## Stack you must use (already installed in `frontend/`)
- React 19 + TypeScript (`strict: false`, `allowJs`), React Router 7 (`import { useNavigate, Link, useParams, useSearchParams } from 'react-router'`).
- Tailwind v4. Tokens and component classes live in `frontend/src/styles/tailwind.css` — read it. Prefer its classes:
  `btn btn-{primary|secondary|success|danger|warning|info|dark|light|link|outline-*} btn-sm btn-lg`, `input select textarea input-sm select-sm field-label field-error field-hint check`,
  `card card-header card-body card-plain`, `alert alert-{danger|success|info|warning}`, `badge badge-{success|primary|danger|warning|info|secondary|dark|light} badge-pill`,
  `table-wrap table table-hover table-striped freeze row-{active|expiring|expired|pending} row-risk-{high|medium|low}`, `tabs tab`, `stat-tile tone-*`,
  `bg-chrome bg-chrome-solid bg-table-head bg-dropdown bg-gold`, `modal-header-chrome modal-header-table`, `spinner spinner-sm`, `page page-title`, `input-clear-btn-red`, `action-btn {primary|info|warning|secondary|success|danger}`.
  For any legacy colour not covered, use Tailwind arbitrary values with the exact legacy value (`bg-[#e0f2fe]`, `shadow-[0_4px_12px_rgba(0,0,0,0.1)]`). Feature-specific CSS that is genuinely easier as CSS (Leaflet tooltips, Konva-adjacent, keyframes) goes in a co-located `*.css` file imported by the component.
- Shared UI: `import { Button, Modal, Alert, Badge, Card, Spinner, PageSpinner, StatTile, Tabs, Field, Pager, Empty, useDialog, toast, dialogs, cn } from '@/shared/ui'`.
  - `Modal` props: `show onHide title footer size('compact'|'warning'|'sm'|'md'|'lg'|'salg'|'wide'|'xl') backdrop('static') headerVariant('chrome'|'table'|'custom'|'none') headerStyle headerClassName bodyClassName id zIndex`. It already renders the legacy dark header, white body, `#f9fafb` footer, sits below the 42 px navbar, and is a bottom sheet on phones for small sizes.
  - Replace every `window.alert/confirm/prompt` with `useDialog()` (`await dialog.confirm(msg, {variant:'danger', okLabel})`, `await dialog.prompt(msg, {multiline, required, type})` → `string|null`) or `toast.success/error` for transient success/failure. Outside React use `dialogs.*`.
- HTTP: `import { api, errText, isCancel } from '@/shared/api/client'` — axios-like: `const { data } = await api.get('/api/x', { params, signal, timeout, responseType:'blob' })`, `api.post(url, body)`, errors expose `e.response.status/data`. Credentials and CSRF are automatic. **Never** hard-code a host; paths are relative (`/api/...`, `/stats`, ...). For static data folders use `dataUrl('JSON Murabba', tehsil, file)` / `apiUrl(path)` from `@/shared/api/base`. Raw `fetch` must use `apiUrl()` and `credentials: 'include'`.
- Server state: TanStack Query is available (`useQuery/useMutation`) — use it where it simplifies; plain effects are fine for ported logic.
- Auth/session: `import { useAuth } from '@/features/auth/AuthProvider'` — same API as legacy `useAuth()` (user, login, logout, loginAs, switchAccount, clearAppData, setActiveTehsil, fetchUserProfile, warning, setWarning, ipMisuse, notifications, markNotificationAsRead, ..., modalError/setModalError).
- App state that legacy `App.js` held and passed as props: `import { useAppStore } from '@/app/store'` (read the file; names match legacy App.js state: selectedMauza, murabbaOptions, selectedMurabba, goToMarkers, baseLayer, testMode, adminMapMode, showGoToForm, showShiftForm, showSaveLayerModal, tourType, runTour, ... plus actions `set`, `selectMauza`, `toggleMenu`, `setAdminMapMode`, `toggleMobileMode`, `addGoToMarker`, `resetMapSelection`).
- Shared logic already ported (JS, import with `@/shared/lib/...`): `mouzaApi.js`, `userUtils.js`, `formUtils.js`, `akar.js`, `lruCache.js`, `locationUtils.js`, `killaBandi.js`, `device.js` (getDeviceId/getDevicePayload), `push.ts`. Map PMTiles config: `@/features/map/config/pmtiles.js`.
- Icons: `lucide-react` (preferred) or keep the legacy emoji where legacy used emoji. Do not add Font Awesome / react-icons / Bootstrap.
- Charts: `recharts` v3 (same component API as v2 for everything used here).
- Do not add npm dependencies without need; if you must, run `npm i -w frontend <pkg>` from the repo root and say so in your report.

## Rules
1. **Parity first.** Same workflow, same fields, same validation messages, same API calls, same success/failure text, same colours. Keep legacy DOM `id`s and the class names the tours target (listed in inv-01 gotcha 17 and inv-04 gotcha 11).
2. **Mobile-first.** Every screen must work at 360-390 px width with no horizontal page scroll (tables may scroll inside `.table-wrap`). Data tables with many columns additionally render a card list under 640 px (`sm:` breakpoint) using the same row status colours (left border + tinted background). Touch targets ≥ 36 px on phones. Use `dvh`, `env(safe-area-inset-*)` where relevant.
3. **Fix-or-preserve (decision D7 default):** fix clearly broken things (dead buttons, duplicate menu entries, stale forms, coordinate bugs, non-existent endpoints), preserve business assumptions (e.g. Rs 1000 default fee) and byte-exact clipboard/WhatsApp texts. Do not port dead code (D8). Standardise dates to `dd-mm-yyyy` and money to `Rs {en-PK}` (D6) via the helpers in `@/shared/lib/format.ts` (create it if absent; keep it tiny and pure).
4. Keep each ported component's **name and props** the same as legacy unless they referred to removed prop-drilling (then read from `useAppStore`/`useAuth`). Other agents import your exports using legacy names.
5. Only write inside the folders you own (listed in your brief). If you need something from a folder you do not own and it does not exist yet, import it by the agreed path anyway and note it in your report — do not create it.
6. TypeScript: `.tsx`/`.ts` for new code. Loose typing (`any`) is acceptable for ported data shapes.
7. Before reporting, run from `frontend/`: `npx tsc --noEmit -p .` and fix every error in your files (errors from other agents' missing files are expected; list them). Also run `npx eslint <your folders>` and fix errors.
8. Report: files created, deviations from legacy (and why), anything unfinished, cross-folder imports you rely on.
