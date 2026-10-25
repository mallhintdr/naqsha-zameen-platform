# Open Dashboard: "All Mouzas" browsing — product, UX, engineering and security plan

Status: **draft for review** · Date: 25 Oct 2026 · Feature flag: `PUBLIC_BROWSE` (off by default)

---

## 0. Summary

Today a registered user sees only the mouzas they paid for. We want every registered user to be able to open **any mouza of any available tehsil**, in a limited "preview" mode, so the dashboard reaches far more people and each of them sees what they would get by subscribing.

Three access levels replace today's "has it / doesn't have it":

| Level | Who / which mouza | What they get |
|---|---|---|
| **Full** | Active subscriber, own mouza | Everything, as today |
| **Expired** | Expired subscriber, own mouza | Map at **any zoom** (zoom cap removed) on street maps; no satellite, no live location, no shift mouza, no change mouza |
| **Preview** | Any registered user, a mouza they don't own | Street map only; no live location, no opening saved layers, no shift mouza, no change mouza; daily preview limit; upgrade prompt |

The navbar gets a **My Mouzas | All Mouzas** switch.

The asset we sell is the **murabba and killa boundaries**, not the background imagery (that belongs to Google and Esri). Most of the security work is therefore about stopping preview from becoming a free bulk download of boundaries. Section 5 explains why, and section 6 lists the decisions you need to make.

---

## 1. Product plan (product manager)

### 1.1 Goals and success measures

| Goal | Measure | Target (first 90 days) |
|---|---|---|
| Wider reach | Registered users | 3× current |
| Engagement | Registered users who open ≥ 1 preview mouza in week 1 | ≥ 60 % |
| Conversion | Preview users who subscribe within 30 days | ≥ 5 % |
| Demand insight | Mouzas with preview demand but no subscriber | Visible to admin and sub-admins weekly |
| Safety | Accounts flagged for scraping | < 1 % of active; zero confirmed bulk leaks |

### 1.2 Who it is for

- **Curious landowner:** heard of Naqsha Zameen and wants to see their chak before paying. Preview is the hook.
- **Subscriber with land elsewhere:** owns one mouza and has relatives' land in others. "All Mouzas" turns them into a multi-mouza buyer.
- **Expired subscriber:** keeps using their own mouza on street maps, misses satellite and GPS, renews.
- **Sub-admin (reseller):** gets leads, meaning preview users in their territory.

### 1.3 Scope

**In scope**
- My Mouzas / All Mouzas switch.
- Preview level with its restrictions.
- New expired-level rules: zoom unrestricted, satellite/GPS/shift/change disabled.
- Upgrade flow from a preview mouza.
- Preview quota.
- Admin "Preview demand" insight.
- Sub-admin lead routing.
- A feature flag and kill switch.

**Out of scope for now**
- Showing maps to visitors who are not logged in. Registration is the gate and it is what gives us the lead.
- Payments inside the app.
- Changes to the old .pk frontend. It must keep working unchanged on the shared server.

### 1.4 The rules, written once

Shown as allowed (✓), blocked (✗), or partly allowed (~):

| Capability | Full | Expired (own) | Preview (not own) | Server-enforced? |
|---|---|---|---|---|
| See mouza boundaries | ✓ | ✓ any zoom | ✓ (see decision D1) | **Yes** |
| Killa boundaries / numbers | ✓ | ✓ | see D1 | **Yes** |
| Satellite / hybrid basemaps | ✓ | ✗ | ✗ | UI only (third-party tiles, see 5.4) |
| Street / topo / light / dark basemaps | ✓ | ✓ | ✓ | — |
| Live location (GPS follow) | ✓ | ✗ | ✗ | UI only (device feature, see 5.4) |
| Open saved layers | ✓ | ✓ (D4) | ✗ | **Yes**, in the layers API |
| Save new layer / draw / measure | ✓ | ✓ | draw and measure ✓, save ✗ (D4) | **Yes** for save |
| Shift mouza | ✓ | ✗ | ✗ | **Yes** (already `isSubscribed`) |
| Change mouza request | ✓ | ✗ | ✗ | **Yes** (already in controller) |
| Aks Shajra raster tiles | ✓ | ✓ | ✗ (D2) | **Yes** |
| Mouza search / Go-To | ✓ | ✓ | ✓ | — |
| Distinct mouzas per day | 40 (today) | 40 | **10 preview** (D3) | **Yes** |

### 1.5 Monetisation hooks

- **Badge:** every preview mouza shows a "Preview" badge and a **Get full access** button. The button opens a pre-filled request for that mouza, using the existing assignment-request flow or WhatsApp to the owning sub-admin or admin.
- **Prompt on a blocked feature:** tapping satellite, GPS or a saved layer in preview opens a short "Available with subscription" sheet with the same button. It never shows a dead or greyed-out control without a reason.
- **Expired users:** "Renew to bring back satellite and live location", using the existing renewal flow.
- **Leads:** each preview open is recorded as `{user, tehsil, mouza, time}`. Admin Insights gets a **Preview demand** tab (top mouzas, users who previewed but don't own). Sub-admins see their territory's preview users as leads.

### 1.6 Phases

| Phase | Content | Exit criteria |
|---|---|---|
| **0. Hardening** (before anything public) | Fix the access gaps in 5.2: one entitlement function, expiry enforced on every data route, static `/pmtiles` checked per mouza | Security tests pass; .pk unaffected |
| **1. Expired rework** | Zoom cap removed; satellite/GPS/shift/change disabled for expired | Expired user can work at full zoom on street maps |
| **2. Preview (flag on for admins and testers)** | All Mouzas switch, preview level, quota, upgrade flow | Internal test on .com |
| **3. Preview for everyone on .com** | Flag on; demand insights; lead routing | Metrics in 1.1 tracked; abuse checks quiet for 2 weeks |
| **4. Cutover** | .pk moves to the new frontend (existing runbook) | — |

---

## 2. UX plan (UI/UX expert)

### 2.1 Navbar: My Mouzas | All Mouzas

```
┌────────────────────────────────────────────────────────────┐
│ ☰  [Bahawalpur ▾]  [ My Mouzas | All Mouzas ]  [Chak ▾]  🔔 │
└────────────────────────────────────────────────────────────┘
```

- **The switch:** a segmented control with two pills, placed before the mouza dropdown. On phones it collapses into a header row inside the mouza dropdown ("My mouzas · All mouzas") to save width.
- **My Mouzas:** today's list, unchanged. This is the default for subscribers.
- **All Mouzas:**
  - Lists every mouza of the selected tehsil, with own mouzas pinned at the top and marked ✓.
  - Search-as-you-type at the top, since tehsils have hundreds of mouzas.
  - New users with no subscription land here by default.
- **Tehsil dropdown:** in All Mouzas mode it shows every available tehsil. Today it is hidden when a user has a single tehsil.
- **Remembered:** the last mode per user is kept in local storage.

### 2.2 Status, always visible

- **Preview mouza:** a small amber chip "Preview · Street map" next to the mouza name in the navbar. Tapping it opens the "What's included" sheet with the Get full access button.
- **Expired, own mouza:** the existing red "Expired" pill stays. Its sheet lists what is off (satellite, live location, shift, change) and has Renew.
- **Preview quota:** "3 of 10 previews left today" appears in the All Mouzas dropdown footer. At 0, the list still shows names, and opening a new one explains the daily limit and offers subscription. Mouzas already opened today stay open.

### 2.3 Disabled features: always explain, never hide

| Control | In preview / expired |
|---|---|
| Basemap list | Satellite entries are shown with a lock icon. Choosing one opens the upgrade sheet; the map stays on street. If the user was on satellite, the map switches automatically to **Google Streets** with a one-time toast: "Street map in preview". |
| GPS / live location button | Lock badge; tap opens the sheet. The **one-shot "where am I"** marker stays allowed (see D5). |
| Saved layers menu item | "Open Saved Layers (subscription)": tap opens the sheet. |
| Shift / Change mouza | Already disabled with "(renew first)". Same pattern, with the reason in the label. |

### 2.4 Upgrade sheet (one component, reused everywhere)

```
┌──────────────────────────────┐
│ Chak 105/DB — Preview         │
│ ✓ Mouza & murabba map         │
│ ✗ Satellite imagery           │
│ ✗ Live location               │
│ ✗ Saved layers & shift        │
│                               │
│ [ Get full access ]  [ Later ]│
└──────────────────────────────┘
```

- **Size and look:** the compact centred modal (current style), about 320 px wide.
- **Get full access** pre-fills the mouza. A user with a sub-admin goes to them; others go to the admin's WhatsApp or the existing request flow.

### 2.5 Guided tour

- **New tour step:** "All Mouzas", explaining preview and the switch.
- **Welcome tour:** for users with no subscription, it ends on the All Mouzas switch.

### 2.6 Accessibility and mobile

- **Touch targets:** the switch and the lock controls are at least 36 px tall.
- **Colour:** the amber preview chip passes 4.5:1 contrast, and the lock icon carries `aria-label`s.
- **Phones:** every sheet is a compact centred modal.

---

## 3. Engineering plan (engineer)

### 3.1 One access function (backend)

Add `services/accessPolicy.js`:

```js
// The single source of truth. Every data route, the signer and the UI use it.
// returns { level: 'full' | 'expired' | 'preview' | 'none', reason }
accessLevel(user, tehsil, mouza)
```

- **Admin:** `full`.
- **Entitled to the mouza** (permanent or a valid temp grant, linked tehsils included; this replaces `hasAccess`, `isEntitled` and `checkTehsilAccessForStatic`):
  - account active → `full`;
  - expired or pending → `expired`;
  - suspended → `none`.
- **Not entitled:**
  - `PUBLIC_BROWSE` on, account verified (D6), not suspended, tehsil marked available → `preview`;
  - otherwise → `none`.
- **Sub-admin:** their territory counts as entitled.

`hasAccess` stays as a thin wrapper (`level !== 'none'` and `!== 'preview'`) so the old .pk frontend keeps today's behaviour.

### 3.2 Data routes: what each level is served

| Resource | full | expired | preview |
|---|---|---|---|
| `/JSON Murabba/…` murabba/killa GeoJSON | ✓ | ✓ (**new: expiry checked, allowed**) | D1: murabba-only file, watermarked, envelope on |
| `/Metadata/…` | ✓ | ✓ | murabba summary only |
| `/api/geojson/:t/:m` | ✓ | ✓ (zoom gate removed) | as for GeoJSON above |
| PMTiles signing `/api/pmtiles/signed-url(s)` | ✓ | ✓ | preview pmtiles (D1) or ✗ |
| Static `/pmtiles` fallback | per-mouza check (**new**) | same | same |
| `/api/shajra-tiles/…` (Aks Shajra raster) | ✓ | ✓ (zoom gate removed) | ✗ (D2) |
| `/api/user-layers` GET by id | ✓ | ✓ | ✗ for preview context (D4) |
| `POST /api/user-layers` | ✓ | ✓ | ✗ |
| `/api/geo/adjustment` POST/DELETE | ✓ | ✗ | ✗ |
| `/api/me/assignment-requests` | ✓ | ✗ | creating a **subscription request** for a new mouza is allowed (it is the upgrade path) |

Implementation:
- `middleware/accessGuard.js` replaces `isSubscribedOrLimitedZoom` and the entitlement step of the vector guard chain. It sets `req.access = { level }` and rejects per the table with machine-readable codes: `PREVIEW_ONLY`, `PREVIEW_QUOTA`, `EXPIRED_FEATURE`, `NOT_AVAILABLE`.
- **Cache safety:** responses vary by level. GeoJSON already uses `no-store`, and the Redis GeoJSON cache stores raw data, with the level transform applied after it. Add `Vary: Cookie` wherever a response is level-dependent.

### 3.3 Preview data (depends on D1)

- **Recommended (D1-B):**
  - A **preview file per mouza**, generated offline: murabba outlines and murabba numbers only, simplified (Douglas-Peucker, about 0.5 m) so the exact vertices are not given away, and no killa lines.
  - Stored beside the full file as `<mouza>-Preview.geojson` and `<mouza>-preview.pmtiles`.
  - Built by a script `scripts/build-preview.js` over the data folder, run on the VPS or locally, then uploaded to R2. Incremental: it rebuilds only mouzas whose source changed.
  - The server picks the file by level, so preview can never be served the full file by accident (5.3).
- **Alternative (D1-A):** serve the full data in preview, protected only by quota, watermark and envelope. No build step, but the full killa geometry becomes available to anyone who registers.

### 3.4 Quota and limits for preview

- **Daily limit:** reuse `vectorQuota.touchDistinct` with a separate key `vq:preview:<uid>:<day>`, default **10 distinct preview mouzas a day** (`PREVIEW_MOUZAS_PER_DAY`).
- **Rate limits:** lower than full, at 120 requests/min and 1000/h.
- **Signing limiter:** preview signatures count against it the same as full ones.

### 3.5 Lists

- **Mouza list:** `GET /api/mauza-list/:tehsil` stays as it is (names are already public). Add `GET /api/me/mouza-catalog/:tehsil`, which returns `[{ name, own: bool, level }]` plus `previewsLeftToday`. The navbar uses that.
- **Available tehsils:** a tehsil is open for preview if it has data and an admin setting allows it (`availableForPreview`, default true). This lets you keep a tehsil private, for example where a sub-admin has an exclusive.
- **Switching tehsil:** `POST /api/users/:id/active-tehsil` changes. Viewing a tehsil you don't own no longer needs it; the selected tehsil and mouza travel in app state and the URL (`?t=&m=`), and the user's record is not written.

### 3.6 Frontend changes

| Area | Change |
|---|---|
| `app/store.ts` | `browseMode: 'mine' \| 'all'`, `access: { level, reason }` for the open mouza (from the catalog plus response codes) |
| `chrome/Header.tsx` | Switch; All Mouzas list with search, own-pinned, quota footer; remove the "drop mouza not in mauzaList" rule when mode is `all` |
| `map/core/MapComponent.jsx` | Remove the expired zoom cap (14); keep the admin/full path unchanged |
| `map/core/LayerControl.jsx` | `allowedBaseLayers(level)`; lock icon on satellite; auto-switch to Google Streets; fix the effect deps so a maxZoom change applies |
| `map/core/LocateControl.jsx` / `CompassControl.jsx` | `disabled` + lock when level ≠ full; one-shot locate allowed (D5) |
| `chrome/NavigationMenu.tsx` | Saved layers, shift and change gated by `access.level`, each with its reason |
| `shared/ui` | `UpgradeSheet` component, `PreviewChip` |
| `admin/insights` | **Preview demand** tab |
| `subadmin` | **Leads** list |
| `tours` | "All Mouzas" step |

### 3.7 Old .pk frontend compatibility

The old .pk frontend runs against the same backend until cutover.
- **Flag off:** behaviour is identical to today.
- **Flag on:**
  - The old frontend never asks for non-owned mouzas, so preview is invisible to it.
  - The expired changes (zoom gate removed, GeoJSON allowed) apply to it as well. That is harmless, because its own UI still caps zoom at 14.
- `hasAccess` keeps its meaning for old callers.

### 3.8 Tests

- **Unit:**
  - `accessLevel` matrix: user type × status × own/not own × temp grant × linked tehsil × flag × tehsil availability.
  - Quota.
  - Preview file selection.
- **API:**
  - Every route in 3.2 for every level, including the static `/pmtiles` fallback and `/api/user-layers/:id` belonging to the same user.
  - Negative cases: forged `?enc`, missing header, other user's layer id.
- **E2E (Playwright, mocked):**
  - The switch, the preview chip, the auto street switch, the lock sheets, and the quota at 0.
  - Expired user at zoom 19.
- **Load:** preview catalog and mouza opens with 500 concurrent users.

### 3.9 Effort (rough)

| Phase | Backend | Frontend | Data | Total |
|---|---|---|---|---|
| 0 Hardening | 3 d | — | — | 3 d |
| 1 Expired | 1 d | 1.5 d | — | 2.5 d |
| 2 Preview | 3 d | 4 d | 2 d (preview build) | 9 d |
| 3 Insights/leads | 1.5 d | 2 d | — | 3.5 d |

---

## 4. Rollout and operations

- **Flags** (backend env):
  - `PUBLIC_BROWSE` (master switch);
  - `PREVIEW_MOUZAS_PER_DAY`;
  - `PREVIEW_DATA=simplified|full` (D1);
  - `PREVIEW_REQUIRE_VERIFIED=true`.
  - The kill switch is `PUBLIC_BROWSE=false` followed by `pm2 restart <app> --update-env`; the effect is immediate.
- **Order:** turn it on for the .com test copy first (`geo-dashboard-test`), with admins and testers on an allow-list (`PREVIEW_ALLOW_USERS`), then everyone on .com, then production after cutover.
- **Monitoring:**
  - preview opens per day;
  - users hitting the quota;
  - `VECTOR_NOT_ENTITLED` and `PREVIEW_*` denials;
  - new registrations per IP;
  - conversion (preview → request → active).
  - These go into the admin Insights page.

---

## 5. Security audit (security engineer)

### 5.1 What we are protecting

| Asset | Value | Where it leaks from |
|---|---|---|
| Killa / murabba boundaries (vector) | **High**: the product itself | `/JSON Murabba`, `/api/geojson`, PMTiles via R2 worker |
| Aks Shajra raster | High | `/api/shajra-tiles`, `/Shajra Parcha` |
| Mouza / tehsil names | Low (already public) | lists |
| Satellite imagery | Not ours (Google/Esri) | third-party CDNs |
| User saved layers | Private user data | `/api/user-layers` |

### 5.2 Existing gaps, which must be fixed in Phase 0 whatever else is decided

| # | Finding | Severity | Fix |
|---|---|---|---|
| G1 | Three different entitlement rules (`hasAccess` ignores temp grants; `checkTehsilAccessForStatic` is tehsil-only; `isEntitled` is mouza-level). The same user gets different answers on different routes. | High | One `accessLevel` (3.1) used everywhere |
| G2 | The static `/pmtiles` fallback checks **tehsil only**: any user of a tehsil can fetch every mouza's `.pmtiles` in it by range requests. | High | Per-mouza check via `accessLevel` |
| G3 | "Expired" is enforced on some routes only. `/JSON Murabba` and `/Metadata` serve expired users at any zoom; `/api/geojson` and signing block them. The behaviour is inconsistent, not deliberate. | Medium | Explicit level table (3.2) |
| G4 | `hasAccess` treats an entry holding only temp grants (empty `mouzas`) as **whole-tehsil** access. | High | `effectiveAccess` semantics everywhere |
| G5 | `/api/user-layers` has no scoping check beyond login; confirm that layer id lookup is restricted to the owner. | Medium (verify) | Owner check plus test |
| G6 | `GET /api/geo/shifted-mouzas/:tehsil` returns 500 for logged-out callers (it reads `req.user.userId`). | Low | `isAuthenticated` |
| G7 | The zoom gate depends on a client-supplied `z`, so it is not a control. | Info | Removed by design (3.2) |

**Phase 0 status (25 Oct 2026): G1, G2, G3, G4 and G6 fixed; G5 verified (layers are owner-scoped in every query).**
- **One rule:** `services/accessPolicy.js` (`accessLevel` / `subscriptionState`) and `middleware/mapAccess.js` are the single rule. `hasAccess` now delegates to the mouza-level `isEntitled`.
- **Expired / pending accounts are tiles only:**
  - Allowed at any zoom: PMTiles signing, `/pmtiles` and shajra raster.
  - Refused: mouza GeoJSON (`/JSON Murabba/…`, `/api/geojson`) returns `403 EXPIRED_TILES_ONLY`, and the dashboard skips GeoJSON for them (`setTilesOnly`).
  - Still open: tehsil-wide index files and `/Metadata`.
- **Zoom cap kept for now:** the dashboard still caps their zoom at 14 until Phase 1 (satellite / GPS / shift / change disabled) ships, so the two changes go live together.
- **Tests:** `backend/test/accessPolicy.test.js`.

### 5.3 New threats from preview, and controls

| Threat | Likelihood | Control |
|---|---|---|
| **Account farming to scrape all mouzas** (register many accounts, use 10 previews each) | **High** once public | (a) D1-B: preview data is simplified murabba-only, so a scrape yields no killa geometry; (b) verified phone or email required (D6), one account per phone; (c) registration rate limit per IP and per device fingerprint (the device id already exists in deviceTracker); (d) quota per user **and** per device; (e) an alert on the admin when one device or IP pulls many accounts' previews |
| **Wrong file to wrong level** (bug serves full file in preview) | Medium | The server chooses the file by level, and the preview path is a different file name; a unit test asserts preview never resolves to a non-preview file; signer refuses a full path when the level is preview |
| **Signed PMTiles URL reuse** | Low | Existing: 15-minute HMAC bound to path and uid; preview signs only `-preview.pmtiles` |
| **Cache mix-up** (a full response cached and served to preview) | Medium | `no-store` already on vector responses; transform after the Redis raw cache; `Vary: Cookie`; test |
| **Basemap restriction bypassed** (user enables satellite via devtools) | High, but **low impact** | Satellite tiles are third-party and not our asset, so a UI-only control is acceptable. Document it as a product restriction, not a security control. |
| **Live location bypassed** | High, low impact | Same: a device feature. UI-only is acceptable. |
| **Saved layers in preview** | Medium | Enforced in the API (open/save return `PREVIEW_ONLY` when the layer's mouza is preview for that user) |
| **Shift/change bypass** | Low | Already server-enforced; covered by the level table |
| **Leak tracing** | — | Watermark **on** for preview responses (`VECTOR_WATERMARK` per level), envelope on for preview, and the existing `scripts/identify_leak.js` |
| **Lead data privacy** (sub-admins see who previewed) | Medium | Show sub-admins only users in their territory who agreed at registration ("A local partner may contact me"); never phone numbers of users who opted out |
| **Enumeration of tehsil availability** | Low | Names already public; fine |

### 5.4 Accepted risks (please sign off)

1. Satellite basemap and live location restrictions can be bypassed by a technical user. They are product limits, not data protection. The data protection sits on our boundaries, which are server-enforced.
2. An entitled user can always copy the data they are shown (existing doc note). Watermarking traces it.
3. Under D1-A (full data in preview), a determined attacker with many verified phone numbers could rebuild boundary data over time. **This is why D1-B is recommended.**

### 5.5 Security acceptance criteria (before Phase 3)

- [ ] A single `accessLevel` is used by every data route, the signer and the static fallback (code search shows no other entitlement checks).
- [ ] The automated matrix test passes (all levels × all routes).
- [ ] The preview level can never receive a killa-level file (test plus manual check in DevTools).
- [ ] The quota is enforced per user and per device; registration rate limits are in place.
- [ ] Watermark and envelope are on for preview, and the leak script identifies a test leak.
- [ ] The kill switch has been tested on `.com`.
- [ ] The old .pk frontend has been regression-tested with the flag on.

---

## 6. Decisions needed from you

| # | Question | Options | Recommendation |
|---|---|---|---|
| **D1** | What does preview show? | **A** full murabba + killa boundaries (bigger hook, high scrape risk) · **B** murabba outlines + numbers only, simplified (strong hook, low risk) · **C** B plus killas visible only at one murabba at a time, server-limited | **B** at launch; consider C later based on conversion |
| **D2** | Aks Shajra raster in preview? | yes / no | **No**: it is high-value and a strong reason to subscribe |
| **D3** | Preview mouzas per day | 5 / 10 / 20 | **10** |
| **D4** | Saved layers for expired users and drawing in preview | expired: open ✓ save ✓ · preview: draw ✓ save ✗ | As recommended |
| **D5** | "Live location" in preview: block GPS follow only, or also the one-tap "where am I"? | follow only / both | Block **follow** only; one tap is what makes a landowner say "this is my land" |
| **D6** | Account check before preview | none / verified email / verified phone (OTP) | **Verified phone**: the strongest anti-farming control. It needs an SMS/WhatsApp OTP provider, which is a cost and setup item. Verified email is the fallback for launch. |
| **D7** | Tehsils open for preview | all with data / admin chooses | All with data, with an admin switch per tehsil |
| **D8** | Leads to sub-admins | on (with opt-in) / off | On, opt-in only |

---

## 7. Next step

After you approve the decisions in section 6:
1. **Phase 0 (hardening):** I'll start here. It is worth doing even if preview is never launched, because G2 and G4 are real gaps today.
2. **Phase 1:** follows straight after.

Each phase ships to the `.com` test copy behind the flag before anything changes for `.pk` customers.

---

## Status log

- **25 Oct 2026, Phase 1 done (expired / pending customers):**
  - **Zoom:** the cap is removed; the map is served as tiles only.
  - **Locked features:** satellite basemaps, live location, open / save saved layers, shift mouza and change mouza. Each one opens the "Subscribe for full features" message, which also links the website services.
  - **Server enforcement:** saved layers return `403 SUBSCRIPTION_REQUIRED`; delete is still allowed. Shift and change mouza were already enforced on the server.
  - **Code:** `shared/lib/featureAccess.ts`, `SubscribeRequiredModal`.
  - **Check:** `frontend/e2e/expired-locks.mjs`.
  - **Preview:** uses the same locks via `isLimitedUser` once preview users exist.
