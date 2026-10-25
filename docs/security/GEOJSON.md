# Vector data protection (GeoJSON / metadata)

Covers `/JSON Murabba/…` (`/JSON%20Murabba`), `/Metadata/…`, `/Shajra Parcha/…` (`/Shajra%20Parcha`), `/tiles/…` and `/api/geojson/:tehsil/:mauza`.
PMTiles is covered separately in [PMTILES.md](PMTILES.md).

**Anything the browser renders can be copied.** These controls make access require an entitled session, make bulk extraction slow, noisy and attributable, make a casual DevTools "Save response" useless, and make leaks traceable. They do not stop a determined, entitled user from reading the decoded objects out of memory.

## Threat model

| Actor | Goal | Relevant controls |
|---|---|---|
| Anonymous / expired cookie | download data | session auth (401) |
| Paying user, 1 mouza | other mouzas of the same tehsil (the old rule was tehsil-level only) | mouza-level entitlement (403) |
| Whole-tehsil user / sub-admin with a script | bulk-download a tehsil | client header, per-user rpm/rph limits, distinct-mouza daily quota, audit log |
| User with DevTools | "Save response" → GeoJSON | envelope (AES-GCM, per-session key), no-store |
| Insider who resells files | redistribute | forensic watermark + `scripts/identify_leak.js` |

## Controls

| # | Control | Prevents / deters | Where |
|---|---|---|---|
| 1 | **Session auth** (`isAuthenticated`, tokenVersion check, same rule as the API, so demo-link tokens work too) | prevents | `server.js` `dataRoute`, `geoRoutes.js` |
| 2 | **Mouza-level entitlement**: the URL's tehsil/mouza must be in `tehsilAccess`. Admins: everything. Sub-admins: their own `tehsilAccess`. Empty `mouzas[]` = whole tehsil. Valid `tempGrants` count; expired ones do not, and an entry that only ever held temp grants never widens to the whole tehsil after they expire (the old `hasAccess` had this gap). Linked/merged tehsils in both directions, case-insensitive, file-name sanitising (`/`→`-`, `\:*?"<>\|`→`_`), `-complete` suffix. Tehsil-wide files (`<Tehsil>-Mouza-Index.json`, `list-*.json`, `index.json`) need only the tehsil. Also fixed: `../` escapes in the static resolver. | prevents | `services/vectorAccess.js`, `middleware/vectorDataGuard.js` |
| 3 | **`X-NZ-Client: dashboard` header** required on `.json`/`.geojson` (and `/api/geojson`). A browser tab, `curl`, or "open in new tab" gets 403. Anyone can add the header, so this is a speed bump. | deters | `requireVectorClient` |
| 4 | **Per-user rate limits**: requests per minute and per hour, keyed by userId, Redis store with memory fallback. 429 JSON `{code:'VECTOR_RATE_LIMITED'}`. | deters (slows) | `makeVectorLimiter` in `rateLimiters.js` |
| 5 | **Distinct mouzas per day** (Redis `SADD`/`SCARD`, PKT day): a mouza you already opened today always works again; the next new one gets 429 `{code:'VECTOR_QUOTA_EXCEEDED'}`. Tehsil-wide files are free. | deters (caps volume) | `services/vectorQuota.js` |
| 6 | **Audit**: `VECTOR_ACCESS_DENIED`, `VECTOR_RATE_LIMITED`, `VECTOR_QUOTA_EXCEEDED`, `VECTOR_CLIENT_HEADER_MISSING` rows in `AuditLog` (max one row per user per action per 10 min), plus a winston warn on every event and an info line for each first-opened mouza (`[vector] mouza opened`). | attributes | `auditVector` |
| 7 | **Headers**: `Cache-Control: private, no-store`, `Pragma: no-cache`, `Content-Disposition: inline`, `nosniff`, `Vary`. CORS is still the global allow-list; `X-NZ-Client` was added to the allowed request headers. | hygiene | `vectorResponder.setVectorHeaders` |
| 8 | **Envelope** (opt-in per request with `Accept: application/x-nz-vector` or `?enc=1`, *and* `VECTOR_ENVELOPE=true`): coordinates quantized to 1e-7° (~1 cm), delta + zigzag varints, then AES-256-GCM with a key = HMAC(secret, userId, tokenVersion, session `iat`, time bucket). The client gets the key from `GET /api/vector-key[?kid=]` (current or previous bucket only) and decodes in `shared/lib/vectorEnvelope.js`. A saved response is binary that needs this session's key. Obfuscation, not DRM: the key is in JS memory. | deters | `services/vectorCodec.js`, `vectorResponder.js`, `frontend/src/shared/lib/vectorFetch.js` |
| 9 | **Forensic watermark** (`VECTOR_WATERMARK=true`): each x/y moves by up to ±`VECTOR_WATERMARK_UNITS` quanta (default 3, so at most ~4.5 cm diagonally at 30°N, well below the data's accuracy). The shift is a keyed hash of the **rounded vertex coordinate** and the user, so shared edges between neighbouring killas/murabbas stay identical. It is applied to plain JSON and to envelope responses. Admins are exempt by default. | traces | `vectorCodec.applyWatermark` |

Without an envelope request and with the watermark off, files are streamed byte for byte as before (fast path). The old frontend and any tooling keep working, except that they need the `X-NZ-Client` header while `VECTOR_REQUIRE_CLIENT_HEADER` is on.

### Frontend
Every vector/metadata fetch to our own backend goes through `vectorFetch(url, init)`. It adds the header, asks for the envelope when WebCrypto is available (https or localhost), decodes it, and returns a Response-like object (`ok/status/json()/text()`). It covers `useGeoJsonLayer`, `getMurabbaGeoJson` and the metadata fetch in `loadMurabbaPMTiles`, `useFallbackGeoJSON`, the local `/Metadata` functions in `mouzaApi.js`, `VectorTileLoader`, the Shajra JSON in `MapComponent`, `store.selectMauza`, and `geoJsonTransform`. Requests to other hosts pass through untouched. `VITE_VECTOR_ENVELOPE=false` stops asking for the envelope.

## Configuration (backend env)

| Var | Default | Meaning |
|---|---|---|
| `VECTOR_MOUZA_ENTITLEMENT` | `true` | `false` = old tehsil-level rule (kill switch) |
| `VECTOR_REQUIRE_CLIENT_HEADER` | `true` | require `X-NZ-Client` |
| `VECTOR_CLIENT_HEADER_VALUE` | `dashboard` | |
| `VECTOR_RPM` / `VECTOR_RPH` | `300` / `3000` | vector requests per user per minute / hour (0 = off). Murabba files are many per mouza, so these are generous. |
| `VECTOR_MOUZA_DAILY_MAX` | `40` | distinct mouzas per user per day (0 = off) |
| `VECTOR_MOUZA_DAILY_MAX_SUBADMIN` | `150` | same for sub-admins |
| `VECTOR_QUOTA_TZ_OFFSET_MIN` | `300` | day boundary (PKT) |
| `VECTOR_ENVELOPE` | `false` | serve the envelope to clients that ask for it |
| `VECTOR_ENVELOPE_SECRET` | derived from `SECRET_KEY` | key derivation secret |
| `VECTOR_ENVELOPE_KEY_TTL_MIN` | `360` | key bucket length |
| `VECTOR_WATERMARK` | `false` | per-user watermark |
| `VECTOR_WATERMARK_SECRET` | derived from `SECRET_KEY` | **keep it stable**: rotating it makes old leaks unidentifiable (keep the old value on file) |
| `VECTOR_WATERMARK_UNITS` | `3` (1–4) | max shift per axis in 1e-7° units |
| `VECTOR_WATERMARK_ADMINS` | `false` | also mark admin downloads |
| `VECTOR_CACHE_MB` | `256` | per-worker memory for prepared files (75%) and per-user encoded bodies (25%) |
| `VECTOR_TEHSIL_WIDE_FILES` | `(-mouza-index\.json\|^list-[^/]*\.json\|^index\.json)$` | files that need only tehsil entitlement |

The header applies to everyone. Admins are exempt from the limits, the quota and (by default) the watermark.

## Performance (synthetic 7.6 MB mouza, 170k vertices, 10k killas; `npm test` in backend)
- Server: one-time prepare per file (cached by path, mtime and size) ~150 ms. Per request, watermark, encode and AES take ~15–25 ms. A watermarked plain-JSON response costs ~140–230 ms (cached per user and file).
- Wire size: envelope 1.9 MB vs 7.6 MB raw (`/JSON Murabba` is excluded from compression).
- Client: AES-GCM decrypt ~10–20 ms. Decoding takes ~40–60 ms standalone vs ~120–170 ms for `JSON.parse` of the raw file; under heavy GC pressure (inside the test runner) it is ~210 ms, about the same as `JSON.parse`. Low-end phones should be roughly 3–5× slower, and still no slower than the old path while downloading a quarter of the bytes.

## Rollout
1. Deploy to the test copy (dashboard.naqsha-zameen.com, `JOBS_ENABLED=false`) with the defaults: entitlement, header, limits and quota on; envelope and watermark off. Check the map in PMTiles and GeoJSON modes as a normal user, a whole-tehsil user, a temp-grant user, a linked-tehsil user, a sub-admin, a demo link, an expired user and an admin. Watch the logs for `VECTOR_ACCESS_DENIED` false positives (mouza naming mismatches).
2. Turn on `VECTOR_ENVELOPE=true` on the test copy. In DevTools, responses should show `application/x-nz-vector`.
3. Turn on `VECTOR_WATERMARK=true`. Download a file as a test user, then run `node scripts/identify_leak.js --leaked f.geojson --original "data/JSON Murabba/T/M.geojson" --users a,b,c`.
4. Production cutover (new frontend): same order, one flag at a time. Adjust the quota thresholds from a week of `[vector] mouza opened` logs.
5. Kill switches: `VECTOR_MOUZA_ENTITLEMENT=false`, `VECTOR_REQUIRE_CLIENT_HEADER=false`, `VECTOR_RPM=0`, `VECTOR_MOUZA_DAILY_MAX=0`, `VECTOR_ENVELOPE=false`, `VECTOR_WATERMARK=false` (restart pm2).

## Monitoring / alerts
- AuditLog `action: /^VECTOR_/`, grouped by `adminId` (the user). Alert when one user has more than 3 `VECTOR_QUOTA_EXCEEDED` days per week, any `VECTOR_RATE_LIMITED` with `window: 'hour'`, or more than 20 `VECTOR_CLIENT_HEADER_MISSING` from one user (scripting).
- `logs/security.log` (warn level) holds every event, not only the throttled audit rows.
- Count distinct `[vector] mouza opened` per user per day. Users near the quota are the ones to look at.

## Leak investigation
`node scripts/identify_leak.js --leaked <file> --original <server file> (--users a,b | --users-file ids.txt | --all-users) [--json]`
It matches leaked vertices to the original ones within ~9 cm and correlates the residuals with each candidate's expected offsets. The leaker scores ≈1.0 (100% exact matches if the file was not rounded); everyone else scores ≈0. It still works after rounding to 6 decimals (tested). Use the un-shifted server file as `--original`. Downloads made while the watermark was off carry no mark.

## Still not prevented
- An entitled user can read decoded objects from JS memory or Leaflet layers, or script the app itself (which sends the header and decodes the envelope) within their quota.
- The watermark can be destroyed by adding noise of more than ~5 cm or by re-digitising, and averaging the files of several colluding accounts weakens it. It proves the source only for files served while the flag was on.
- Screenshots and tracing of the rendered map.
- The live site still runs `old-repo/` against its own backend copy. None of this applies there until cutover.
- Metadata centroids (`-Killa.json`, `-Metadata.json`) are not watermarked (non-geo JSON goes through the envelope only). The app caches consolidated metadata in `localStorage` (decoded).
- `/pmtiles` static fallback still uses the tehsil-level check (owned by the PMTiles work).

## Update 25 Oct 2026: one access rule, expired = tiles only

- **One rule:** every map-data route uses `services/accessPolicy.accessLevel` (full / expired / none).
- **Gaps closed:** the tehsil-only check on the static `/pmtiles` fallback, and the temp-grant gap in `hasAccess`.
- **Expired / pending accounts:** PMTiles and shajra raster tiles are served at any zoom; mouza GeoJSON returns `403 EXPIRED_TILES_ONLY`. They have no clean GeoJSON download; tiles need short-lived signed, range-limited requests.
- **Limit:** vector tiles still carry geometry (quantised per tile), so this raises the effort of copying rather than making it impossible. Raster tiles would be the strong form (see docs/PUBLIC-BROWSE-PLAN.md).
