# PMTiles delivery security

Map tiles (`.pmtiles`) and per-mouza JSON live in the R2 bucket `geo-dashboard-pmtiles`
and are served by the worker `pmtiles-worker` (https://pmtiles-worker.mallhintdr.workers.dev).
The same worker serves the live site (`dashboard.naqsha-zameen.pk`, old code in
`old-repo/`) and the rebuild (`.com` / localhost).

## Threat model

| Attacker | Goal | Before | Now |
|---|---|---|---|
| Anonymous internet user | Download any `.pmtiles` | Possible: `pmtiles-worker-simple.js` had no auth | **Prevented**: every data request needs a valid HMAC token |
| Anonymous user | List all tehsils/mouzas | `/list-tehsils` and `/list-mouzas/:t` public | `/list-tehsils` still public (names only, the old frontend needs it); `/list-mouzas` removed |
| Logged-in user | Files of mouzas they did not buy | Possible: the backend signed any tehsil/mouza | **Prevented**: backend checks mouza entitlement (`hasAccess`, linked tehsils) before signing |
| Logged-in user | Pull a whole archive in one request | Possible (plain GET) | **Prevented**: only closed `Range: bytes=a-b` ≤ 2 MiB |
| Logged-in user | Scrape all entitled data by many ranges | Unlimited | **Deterred**: per-uid worker rate limit (1200/min), signing rate limit (120/min, 1500/h), 15-min URLs, logs by uid |
| Someone given a copied URL | Reuse it | 1 h, any origin | **Deterred**: ≤15 min (new backend), browser Origin must be allowed (forgeable outside a browser) |
| Token forgery | Never-expiring token by putting `|` in a mouza/uid | Possible in principle | **Prevented**: backend rejects `|`, `/`, `..` in specs; worker rejects `|` in uid and `exp` more than 2 h ahead |

What this does **not** stop: an entitled user who writes a script with their own valid
session can still slowly copy the mouzas they are entitled to. That is deterred
(rate limits, short URLs, per-uid logs for investigation), not prevented.

## What is enforced

Worker (`cloudflare-worker/pmtiles-worker.js`, now `main` in `wrangler.toml`):

- Token: `HMAC_SHA256(PMTILES_SIGNING_KEY, "<path>|<exp>|<uid>")` where `<path>` is
  `decodeURIComponent(pathname)` without the leading `/`. Same format as
  `backend/middleware/signedPMTilesUrl.js` and `old-repo/backend/...` (unchanged).
  Verified with `crypto.subtle.verify` (constant time). Missing → 401; malformed,
  expired, wrong path/case, wrong uid, `exp` > now + 2 h → 403.
- Required for every `.pmtiles` and every `.json` (`-Murabba.json`, `-Metadata.json`, indexes).
  Other extensions → 404.
- `.pmtiles`: GET/HEAD only with a single closed range, max `MAX_RANGE_BYTES`
  (2 MiB; pmtiles reads a 16 KiB header, then directories and single tiles).
  No/open/suffix/multi/oversized range → 416. Start past EOF → 416 `Content-Range: bytes */size`
  (the pmtiles library's small-file retry).
- CORS: only `https://dashboard.naqsha-zameen.pk`, `https://dashboard.naqsha-zameen.com`,
  `http://localhost:<any port>` get `Access-Control-Allow-Origin` (+ credentials). Data
  requests without an allowed Origin are refused (`ENFORCE_ORIGIN`). Exposes
  `Content-Range, Content-Length, Accept-Ranges, ETag`.
- Edge cache: key = object path + range (no token, no uid), looked up only after the
  token was validated. Browser cache `private`.
- Rate limit: Workers Rate Limiting binding `PMTILES_RATE_LIMITER` keyed `uid:<uid>`,
  in-memory per-isolate fallback when the binding is missing.
- Logs: one JSON line per request (`uid, path, range, status, cache, origin, ip, ms`) and
  `auth_fail` / `rate_limited` events. `[observability] enabled = true` keeps them in Workers Logs.

Backend:

- `POST /api/pmtiles/signed-url[s]`: `isAuthenticated` + `isSubscribedOrLimitedZoom` (account
  status) + per-user limiters (`PMTILES_SIGN_MAX_PER_MINUTE` 120, `PMTILES_SIGN_MAX_PER_HOUR` 1500),
  then for each file `hasAccess(user, tehsil, mouza)`; for `filename` requests the mouza is taken
  from the filename (`<mouza>.pmtiles`, `-complete.pmtiles`, `-Murabba.json`, `-Metadata.json`).
  Denials are logged.
- URL lifetime 15 min (`PMTILES_URL_TTL_SECONDS`, capped at 7200).

Frontend (rebuild):

- `config/pmtiles.js`: no unsigned fallback; URLs cached until 4 min before expiry.
- `core/securePMTilesProtocol.js`: the fetch wrapper swaps an about-to-expire worker URL for a
  fresh one and retries a 403 once, so long-open maps keep loading tiles.

## Compatibility with the live `.pk` site (old code)

The old frontend calls: `/list-tehsils` (public, kept), signed `<mouza>.pmtiles` and
`<mouza>-complete.pmtiles` through pmtiles range reads, and signed `<mouza>-Murabba.json`
with a plain `fetch` (no Range needed for JSON). `-Metadata.json` comes from
`api.naqsha-zameen.pk/Metadata`, not the worker. `/list-mouzas` is not called by either
frontend. The old backend signs 1 h URLs in the same format with the same key; the worker
accepts up to 2 h. Covered by `cloudflare-worker/test/worker.test.mjs` (uses the old signer).

Known difference: with the old no-auth worker, a `.pk` tab left open for more than 1 h kept
loading tiles; now new tile reads fail after the URL expires until the user reloads or picks
the mouza again. If that bites, set `EXPIRY_GRACE_SECONDS` (≤ 3600) and redeploy.

## Rollout

1. `cd cloudflare-worker && node --test test/worker.test.mjs`
2. `npx wrangler secret put PMTILES_SIGNING_KEY` — paste exactly the value of
   `PMTILES_SIGNING_KEY` in the production backend `.env` (old and new backends must share it).
3. `npx wrangler@4 deploy` (wrangler 4 is needed for `[[ratelimits]]`; 3.x ignores it — or use
   `[[unsafe.bindings]] name="PMTILES_RATE_LIMITER" type="ratelimit" namespace_id="4101" simple={limit=1200, period=60}`).
4. Smoke checks (replace values):
   - `curl -i https://pmtiles-worker.mallhintdr.workers.dev/list-tehsils` → 200 JSON array.
   - `curl -i -H "Origin: https://dashboard.naqsha-zameen.pk" -H "Range: bytes=0-16383" "<signed url>"` → 206.
   - Same without the token → 401; without Range → 416; with `Origin: https://example.com` → 403.
   - `.pk`: log in, open a mouza in PMTiles mode, check tiles and murabba list load; DevTools
     shows 206 from the worker.
   - `.com`: same, plus leave the map open > 15 min and pan/zoom: tiles keep loading.
   - `npx wrangler tail --format pretty` while doing the above: `req` lines with uid and 206.
5. Deploy the new backend (15-min URLs, entitlement, signing limits) as usual.

Rollback: `npx wrangler rollback` (returns to the previous worker version). The old simple worker
is kept as `pmtiles-worker-simple.js` for reference only.

## Monitoring

- Workers Logs / `wrangler tail`: filter `evt = "rate_limited"` or `"auth_fail"`; group `req`
  events by `uid` to find users pulling unusual volumes or many distinct paths.
- Backend logs: `[pmtiles-sign] denied` (entitlement failures) and 429s with
  `PMTILES_SIGN_RATE_LIMITED`.
- If a uid is abusive: suspend the account (stops new signatures within 15 min); rotating
  `PMTILES_SIGNING_KEY` (backend `.env` for both backends + `wrangler secret put`) kills all URLs at once.
