# Next steps: step-by-step guide (payments set aside)

This turns `docs/REVIEW.md` into an ordered checklist. Each step says what changes, who does it, how to check it worked, and how to undo it. Payment-gateway work is excluded for now; when you return to it, steps 1, 2, 5 and 6 must already be done.

**Who does what**
- **You**: anything on the VPS, Cloudflare, o3host, GitHub settings or third-party accounts.
- **Code**: changes in this repository. Ask Claude Code to "do step N" and it will make the change, test it and commit it.

**Ground rules for every step**
- One step at a time, deployed and checked before the next.
- Test locally first (`npm run dev:backend` and `npm run dev`), then deploy.
- If a check fails, use that step's undo, then investigate.

---

## Phase A: get the new code live safely (week 1)

### Step 0. Put the repo on GitHub and run it on the VPS

> **Superseded:** the app and website are moving to `naqsha-zameen.com` on Hostinger. Follow `docs/DOMAIN-MIGRATION.md` instead of the deployment items below; only item 1 (push to GitHub) and item 2 (commit the website) still apply as written.

Today production still runs the old code. The new repo also carries the CORS fix for `www`, so going live fixes the website's registration as well.

1. **You**: create a private GitHub repository, then from `D:\temp-repo`:
   ```bash
   git remote add origin git@github.com:<you>/naqsha-zameen.git
   git push -u origin main
   ```
2. **You**: commit the website. First add these to `.gitignore`: `site/node_modules/`, `site/dist/`, `site/.astro/`, `site/*.log`. Then `git add site && git commit -m "Add website source" && git push`.
3. **You**: follow `docs/DEPLOYMENT.md` sections 1 and 2. Run the new app on the VPS and test it at `https://api.naqsha-zameen.pk/` while `dashboard.` still points at o3host.
4. **You**: when the smoke checklist passes, do section 3 (switch the `dashboard` DNS record to the VPS).

**Check:** `https://dashboard.naqsha-zameen.pk/register` loads the new registration page; registering from the website works.
**Undo:** point the `dashboard` DNS record back to o3host.

### Step 1. Lock the map tiles (review C1)
1. **Code**: patch `cloudflare-worker/pmtiles-worker.js` to expose `Content-Length, Content-Range, Accept-Ranges, ETag` (the simple worker does; the map library reads them). Add `https://naqsha-zameen.pk` and `https://www.naqsha-zameen.pk` to its allowed origins. Switch `wrangler.toml` to `main = "pmtiles-worker.js"`.
2. **You**: set the secret to exactly the backend's `PMTILES_SIGNING_KEY`, then deploy:
   ```bash
   cd cloudflare-worker
   npx wrangler secret put PMTILES_SIGNING_KEY
   npx wrangler deploy
   ```

**Check:**
- In the dashboard, open a mouza; tiles and killa lines appear.
- This must be refused with 401:
  ```bash
  curl -I "https://pmtiles-worker.mallhintdr.workers.dev/<Tehsil>/<Mouza>.pmtiles"
  ```

**Undo:** `npx wrangler rollback`.

### Step 2. Run background jobs once, not once per process (review C2)
1. **Code**: in `backend/server.js`, start the purge, multi-device warning, sub-admin expiry notices and fallback scheduler only on the first pm2 instance (`NODE_APP_INSTANCE` is `0` or unset). Log one line saying "jobs started on this instance".
2. **You**: deploy (`./deploy.sh`).

**Check:** `pm2 logs geo-dashboard --lines 200 | grep "jobs started"` shows exactly one line after a reload.
**Undo:** redeploy the previous commit.

### Step 3. Patch vulnerable dependencies (review H4)
1. **Code**: `npm audit fix` for the backend, upgrade anything left by hand, then run the app and the smoke test.
2. **You**: on GitHub, enable Dependabot alerts and security updates (Settings → Code security).

**Check:** `npm audit --omit=dev -w backend` reports no high or critical issues.

### Step 4. Stop the request flood from open tabs (review C3)
1. **Code**:
   - In `frontend/src/features/auth/AuthProvider.tsx`, poll notifications only while the live connection is down.
   - Pause polling and the heartbeat while the tab is hidden, and refetch once when it becomes visible.
   - Ask for notification permission from a button in the notification panel, not at login.
2. **You**: deploy.

**Check:**
- In the browser dev tools Network tab, with the app idle and visible, `/api/notifications` should not repeat every 12 s.
- A test notification from the admin still arrives instantly.

### Step 5. Continuous integration and a deploy you can roll back (review H8, start of H3)
1. **Code**:
   - Add `.github/workflows/ci.yml`: install, typecheck, lint, unit tests, build and smoke test on every push.
   - In `deploy.sh`: after `pm2 reload`, wait for `/health`; if it fails, move `build_prev` back into place and reload again. Keep `build_prev` instead of deleting it.
2. **You**: on GitHub, protect `main` (require the CI check to pass before merging).

**Check:** a pull request shows a green CI check. On a test deploy with a deliberately broken health check, the script rolls back.

### Step 6. Error screens and error reporting (review H6)
1. **You**: create a free Sentry project (or self-host GlitchTip) and copy its DSN.
2. **Code**:
   - Add an error boundary per route with a "Something went wrong, Reload" screen in the dashboard style.
   - Send frontend and backend errors to Sentry when `VITE_SENTRY_DSN` / `SENTRY_DSN` are set.
3. **You**: put the DSNs in `frontend/.env.production` and `backend/.env`, then deploy.

**Check:** throw a test error from the browser console; it appears in Sentry, and the app shows the error screen instead of a blank page.

---

## Phase B: website fixes that cost you sign-ups (week 2)

### Step 7. Website quick fixes (review H7, M8)
1. **You**: decide the main domain: bare `naqsha-zameen.pk` (current) or `www`. Tell Claude Code which.
2. **Code** in `site/`:
   - `.htaccess`: 301 `/register` and `/login` to the dashboard; one-hop redirect to the chosen domain; HSTS and basic security headers; long caching for images.
   - Make page sections visible by default; animate them only when JavaScript runs.
   - Point the visitor counter at the existing `GET /api/visit.gif` endpoint.
   - Replace the 378 KB logo PNG favicon with the SVG; compress the logo to WebP.
   - Remove the switched-off AdSense scaffolding.
3. **You**: build and upload (`cd site && npm run build`, then upload `dist/` to o3host).

**Check:**
- `naqsha-zameen.pk/register` lands on the dashboard registration page.
- The page is fully visible on a phone.
- The visitor count in Insights → Visitors starts rising.

### Step 8. A pricing page and a real sign-up path
1. **You**: decide which plans and prices are public (Trial, Monthly, Yearly; price per mouza tier?).
2. **Code**:
   - Add `site/src/pages/pricing.astro`.
   - Add "Start free trial" buttons that link to `dashboard.../register?plan=...&tehsil=...`.
   - The dashboard registration form preselects the plan and tehsil from those links.

**Check:** the site → pricing → register flow arrives with the plan preselected.

### Step 9. Trust and proof on the website
1. **You**: provide:
   - company NTN, address, a domain email (instead of Gmail), the WhatsApp number;
   - 3-5 short testimonials with permission;
   - 3-4 real dashboard screenshots, or a 30-second screen recording.
2. **Code**:
   - A trust section and a coverage page listing available tehsils (generated at build time from `/api/tehsil-list`).
   - Structured data: Organization, LocalBusiness, Service, FAQ.

---

## Phase C: lighter servers, ready for growth (weeks 3-4)

### Step 10. Fewer database reads per request (review H1, H2)
**Code:**
- Cache each user's access data in Redis for 60 s and clear it whenever their password, tokens, status or access change.
- Impersonation ("Login as") sessions expire after 2 hours.
- Demo-link sessions become revocable.

**Check:** `/api/profile` and tile requests no longer hit MongoDB on every call. Logging in as a user still works, and ends after 2 hours.

### Step 11. Make real-time reliable (review M3, M2)
1. **Code**:
   - Treat Redis as required in production; `/health` fails if Redis is down.
   - The browser uses websocket only.
   - Keep heartbeats in Redis and write them to MongoDB every 5 minutes.
2. **You**: in the nginx config, keep the `/socket.io/` block from `deploy/nginx.conf` (upgrade headers).

**Check:** with 2+ pm2 instances, an admin reply reaches the user instantly every time (try 10 times).

### Step 12. Faster statistics and user search (review M1)
**Code:**
- Cache Insights results for 5 minutes.
- Add a nightly job that pre-computes the daily charts.
- Add a text index for user search.

**Check:** `/stats` responds in under 300 ms on repeat loads; searching users by name stays fast with the full user list.

### Step 13. Tests for the flows that matter (rest of review H3)
**Code:**
- API tests for login, OTP, registration, renewal, activation links, sub-admin billing and pricing.
- Browser tests for register, login, select a mouza, draw and save a layer, and renew.

All run in CI from step 5.

---

## Phase D: scale-out foundation (month 2)

### Step 14. Files off the server disk (review H5)
1. **You**: in Cloudflare, create R2 buckets (or folders) for `metadata`, `geojson`, `shajra` and `payment-proofs`, and an API token for the backend.
2. **Code**:
   - The backend serves map metadata and GeoJSON through short-lived signed R2 links, like tiles.
   - Payment proofs are stored in R2.
   - Include a one-time upload script for existing `backend/data` and `backend/uploads`.

**Check:** with `backend/data` renamed temporarily, the map still loads everything.
**Undo:** rename the folder back; the code falls back to disk while a flag is off.

### Step 15. A separate job worker
**Code:**
- Move scheduled jobs, PDF report rendering (Puppeteer) and push sending into `backend/worker.js`.
- Run it as its own pm2 app with one instance. The API processes then only answer requests.

**You**: `pm2 start backend/worker.js --name geo-worker -i 1 && pm2 save`.

### Step 16. Managed database and backups
1. **You**: create a MongoDB Atlas cluster (M10 or above, Mumbai or Singapore region), enable backups, and migrate with `mongodump`/`mongorestore` during a quiet hour.
2. **You**: change `MONGO_URI` in `backend/.env` and reload.

**Check:** Atlas shows connections; a restore test into a scratch cluster works.

After steps 14-16, adding a second API server behind a load balancer is a configuration change (review section 4).

---

## Phase E: world-class experience (ongoing, in this order)

| Step | What | Done when |
|---|---|---|
| 17 | Design clean-up: move the ~470 hard-coded colours into named tokens; cyan only on dark surfaces; darker teal on light ones | No text below 4.5:1 contrast (check with the browser's accessibility panel) |
| 18 | Accessible, searchable pickers for tehsil, chak, murabba and dates, remembering recent picks | Fully usable with keyboard only |
| 19 | Lighter map page: viewer first, drawing tools and PDF libraries loaded on demand; bundle size limits in CI | Map page under 150 kB gzip before drawing |
| 20 | Skeleton loaders on lists, Insights and selectors | No full-page spinners after first load |
| 21 | Urdu interface (react-i18next, right-to-left layout, Noto Nastaliq for Urdu only) | A language switch in the menu; the whole dashboard in Urdu |
| 22 | Installable app with offline viewing of recently opened mouzas | Opening a recent mouza in airplane mode shows its map |
| 23 | One brand across website and dashboard: shared colour and type tokens, same logo files | The site and dashboard look like one product |
| 24 | Urdu version of the website (`/ur/`) and a page per covered tehsil | Indexed by Google within a few weeks |

---

## When you return to payments

Prerequisites from this guide: steps 1, 2, 5, 6 and 13 (login and renewal tests). Business prerequisites: NTN, a business bank account, gateway KYC, and refund, terms and privacy pages (step 9 covers the pages). The design is in `docs/review/review-payments.md`.
