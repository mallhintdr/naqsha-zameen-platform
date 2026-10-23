# Moving website + app to naqsha-zameen.com on Hostinger

Goal: the website and the app run from the Hostinger VPS under the new domain `naqsha-zameen.com`, with DNS also at Hostinger. The old `.pk` addresses keep working by redirecting to the new ones, so no link in old emails, WhatsApp messages or Google results breaks.

This replaces step 0 of `docs/NEXT-STEPS.md` and the o3host parts of `docs/DEPLOYMENT.md`. The other steps in NEXT-STEPS still apply afterwards.

**Who does what**
- **You**: Hostinger hPanel (DNS, VPS), the VPS terminal, o3host, Cloudflare, Google Search Console.
- **Code**: changes in this repository. Ask Claude Code to "do domain step 1" and it will make, test and commit the change.

---

## The new layout

| Address | Serves | Notes |
|---|---|---|
| `https://naqsha-zameen.com` | Website (Astro, static files) | Main public address |
| `https://www.naqsha-zameen.com` | 301 redirect to `naqsha-zameen.com` | One canonical domain for Google |
| `https://dashboard.naqsha-zameen.com` | The dashboard app and its API (`/api`, `/socket.io`, data files) | Same origin: no CORS, no cross-site cookies |
| `naqsha-zameen.pk`, `www.`, `dashboard.`, `api.` | 301 redirects to the matching `.com` address, keeping the path | Old links keep working |

Everything runs on one VPS: nginx serves the website files directly and passes `dashboard.` to the Node app (pm2) on port 5000.

The app keeps the familiar `dashboard.` name on the new domain.

### What happens to `api.naqsha-zameen.pk`

The new codebase has **no separate API address**. The API lives on the same address as the app: `https://dashboard.naqsha-zameen.com/api/...`, plus `/socket.io`, `/Metadata`, `/pmtiles` and the other data paths. nginx sends everything for `dashboard.` to the Node app, which serves both the pages and the API. Demo links are built from the address the request arrived on, so they also use `dashboard.naqsha-zameen.com`.

`api.naqsha-zameen.pk` existed only because the old frontend sat on o3host and the API on this VPS. Its life from here:

| Phase | `api.naqsha-zameen.pk` |
|---|---|
| Parallel testing | Unchanged. It keeps serving the old `.pk` dashboard that customers use. |
| After cutover (step 7) | 301 redirect to the same path on `dashboard.naqsha-zameen.com`. This keeps old demo links (`api.naqsha-zameen.pk/demo-access/...`) working. |
| Clean-up (step 8) | Keep the redirect while the `.pk` domain is registered; no other change. |

### One deploy for website and dashboard

The website (`site/`) and the dashboard (`frontend/` + `backend/`) live in this one repository and go live with one command, `./deploy.sh`:

1. builds the dashboard into `build/`, which the Node app serves on `dashboard.naqsha-zameen.com`;
2. builds the website into `site/dist/` and copies it to `/var/www/naqsha-zameen-site`, which nginx serves on `naqsha-zameen.com`;
3. keeps the previous copy of both for rollback, and reloads the app.

Use `SKIP_SITE=1 ./deploy.sh` to update only the dashboard.

## Parallel testing phase (the plan you chose)

Customers keep using the `.pk` addresses, served by today's backend exactly as now. The new code runs **next to it** on the `.com` addresses for testing. Both use the **same MongoDB database**, so you test with real data.

```
customers  -> dashboard.naqsha-zameen.pk / api.naqsha-zameen.pk -> old backend  (pm2 "geo-dashboard",      port 5000, jobs ON)  \
                                                                                                                             -> same MongoDB + Redis
you (test) -> dashboard.naqsha-zameen.com                       -> new backend  (pm2 "geo-dashboard-test", port 5001, jobs OFF) /
```

### Is sharing the database safe? Yes, with these rules

Checked in the code: the new backend differs from the running one in only three files (CORS, the `/stats` page fix, security headers). It has **no database or schema changes**, so both versions read and write the same data in the same way.

The risks come from running two servers at once, and each has a rule:

| Risk | Rule |
|---|---|
| Scheduled tasks would run twice: the hourly purge of unverified sign-ups, daily multi-device warnings, sub-admin expiry notices. The background workers (emails, push, and the nightly sub-admin bill closing at 00:00) would compete with production's. | The test copy runs with `JOBS_ENABLED=false` (added in domain step 1). It still *queues* emails and pushes, and the production copy sends them, so nothing is lost or doubled. |
| Every action on `.com` is real: editing, renewing or deleting a user, recording a sub-admin payment, approving requests. | Make changes only on **test accounts** created for the purpose (for example `test.user1`, `test.subadmin1`). On real accounts, look but do not save. |
| Logging in as a real customer on `.com` registers a "new device" for that customer, which can trigger a multi-device sharing warning to them. | Never log in as a real customer on `.com`, and do not use "Login as" on real customers there. Use your admin account (admins are not device-tracked) and the test accounts. |
| Emails from actions on `.com` contain `.com` links; a real customer receiving one would be confused. | Give test accounts an email address you own. |
| Payment proofs uploaded on one copy must be visible to the other. | Both copies use the same `backend/uploads` folder (symlink, domain step 3). |
| Live notifications use the same Redis. | Harmless: a notification raised on either copy reaches the user on either site. |
| Sessions | Separate and safe: `.com` and `.pk` login cookies cannot see each other. |

When testing is done, the **cutover** (domain step 7) stops the old backend, turns jobs on in the new one, and makes `.pk` redirect to `.com`.

### What users will notice at cutover (one time only)
- **Everyone is logged out once.** Login cookies belong to the old domain.
- **Browser-saved data starts fresh**: "Remember me", the unit choice on the map, the Aks Shajra draft, admin map mode. Export any Aks Shajra draft you need (Save → JSON) before the switch, and open it again afterwards.
- **Phone and desktop notifications must be allowed again** on the new address. The app asks after the first tap.
- **Devices get a new device id.** The backend also recognises devices by their fingerprint, so multi-device counts should mostly carry over. Watch the Multi-IP tab for a week and use "forget device" if a user is flagged wrongly.

Announce it a day before, for example on WhatsApp: "From [date] the dashboard is at dashboard.naqsha-zameen.com. Old links will forward automatically. Please log in once again."

---

## Domain step 1. Make the domain a setting (Code)

Before anything changes on the server, the code must stop assuming `.pk`. Claude Code will (**done** on 2026-10-23, see the commit "domain is a setting"):

1. **Backend: one setting for addresses.** New env values `APP_URL=https://dashboard.naqsha-zameen.com` and `SITE_URL=https://naqsha-zameen.com`. These replace every hard-coded `dashboard.naqsha-zameen.pk`: email links, the logout and demo-link redirects, the cookie domain and the CORS default.
   Files: `utils/emailUtils.js`, `utils/frontendOrigin.js`, `controllers/authController.js`, `middleware/authMiddleware.js`, `server.js`, `services/visitorCounter.js`.
2. **Backend: allowed origins for both domains during the move.** `utils/allowedOrigins.js` accepts https on `naqsha-zameen.com` and `naqsha-zameen.pk`, plus their subdomains (list set by an `ALLOWED_DOMAINS` env value).
3. **Frontend:** remove the four `dashboard.naqsha-zameen.pk` fallbacks (the app always knows its own address), and include both domains in "Clear cache" cookie clean-up.
4. **Tile workers:** add `https://dashboard.naqsha-zameen.com` to the allowed origins of `cloudflare-worker/pmtiles-worker.js` and `pmtiles-worker-simple.js`.
5. **Website:**
   - `site/src/site.ts`: `url`, `dashboardUrl`, `registerUrl`, `loginUrl` move to `.com`; the visit counter points at `https://dashboard.naqsha-zameen.com/api/visit.gif`.
   - `site/astro.config.mjs`: `site: 'https://naqsha-zameen.com'`.
   - Replace the visible `dashboard.naqsha-zameen.pk` text on 3 pages.
   - Delete the Apache `site/public/.htaccess` (nginx does redirects now).
6. **Parallel mode switch:** a `JOBS_ENABLED` env value (default `true`). When `false`, the server starts no scheduled tasks and no queue workers, but still adds jobs to the queues. The startup log states which mode it is in.
7. **Server config:**
   - New `deploy/nginx.conf`: website, `www` redirect, `dashboard.naqsha-zameen.com` (to port 5001 while testing, 5000 after cutover), and a `.pk` redirect block that stays disabled until cutover.
   - `deploy.sh` also builds the website into `/var/www/naqsha-zameen/site` (keeps the previous copy for rollback).
   - `.env.example` gets the new values.

**Check (local):** `npm run dev` and `npm run dev:backend` still work; `npm run build` and `cd site && npm run build` both succeed.

---

## Domain step 2. DNS at Hostinger (You, ~10 minutes)

1. Find the VPS IP: hPanel → VPS → Overview (it should be `46.202.153.115`, the IP that `api.naqsha-zameen.pk` uses today).
2. hPanel → Domains → `naqsha-zameen.com` → DNS / Nameservers. Make sure the domain uses Hostinger's nameservers.
3. Delete any default `A` or `CNAME` records for `@` and `www` that point to Hostinger's parking or website builder.
4. Add these records (TTL 300 for now):

   | Type | Name | Points to |
   |---|---|---|
   | A | `@` | VPS IP |
   | A | `www` | VPS IP |
   | A | `dashboard` | VPS IP |

   If hPanel shows an `AAAA` (IPv6) record for `@` or `www` that is not your VPS, delete it too. A wrong IPv6 record makes some phones open the wrong server.
5. **Email**: leave `MX` records alone unless you set up Hostinger email for `.com`. Outgoing app email keeps using the `.pk` mail server (`SMTP_HOST` in `backend/.env`) until you choose to move it.

**Check** (from your PC, after 5-30 minutes):
```bash
nslookup naqsha-zameen.com
nslookup dashboard.naqsha-zameen.com
```
Both should return the VPS IP.

---

## Domain step 3. Prepare the VPS (You, ~30 minutes)

Connect: hPanel → VPS → Browser terminal, or `ssh root@<VPS IP>`.

1. **Get the new repo** (if not done yet):
   ```bash
   cd /var/www
   git clone git@github.com:<you>/naqsha-zameen.git naqsha-zameen
   cd naqsha-zameen
   ```
2. **Bring over secrets and data** from the old checkout. Find it with `pm2 describe geo-dashboard | grep "exec cwd"`.
   ```bash
   OLD=/path/to/old/geo-dashboard
   cp $OLD/backend/.env backend/.env
   ln -s $OLD/backend/data    backend/data
   ln -s $OLD/backend/uploads backend/uploads
   ```
3. **Edit `backend/.env`**: add or replace these lines.
   ```
   NODE_ENV=production
   PORT=5001
   JOBS_ENABLED=false
   APP_URL=https://dashboard.naqsha-zameen.com
   SITE_URL=https://naqsha-zameen.com
   FRONTEND_URL=https://dashboard.naqsha-zameen.com
   CORS_ORIGIN=https://dashboard.naqsha-zameen.com
   COOKIE_DOMAIN=.naqsha-zameen.com
   ALLOWED_DOMAINS=naqsha-zameen.com,naqsha-zameen.pk
   CLOUDFLARE_WORKER_URL=https://pmtiles-worker.mallhintdr.workers.dev
   ```
   Keep `MONGO_URI`, `SECRET_KEY`, `PMTILES_SIGNING_KEY`, `SMTP_*`, `VAPID_*` exactly as they were. `VAPID` keys must not change, or existing push subscriptions stop working.
   Keep the old checkout and its `.env` untouched: production keeps running from there.
   Set `PORT` and `JOBS_ENABLED` **in this `.env` file**, not on the command line: `server.js` loads `.env` with override, so values typed before `pm2 start` are ignored.
4. **Install and build** (the app and the website):
   ```bash
   PUPPETEER_SKIP_DOWNLOAD= npm ci
   npm run build
   (cd site && npm ci && npm run build)
   sudo mkdir -p /var/www/naqsha-zameen-site && sudo rsync -a --delete site/dist/ /var/www/naqsha-zameen-site/
   ```
   After domain step 1, `./deploy.sh` does all of this for future updates.

---

## Domain step 4. nginx and HTTPS certificates (You, ~20 minutes)

1. Copy the new nginx config from the repo and enable it:
   ```bash
   sudo cp deploy/nginx.conf /etc/nginx/sites-available/naqsha-zameen
   sudo ln -sf /etc/nginx/sites-available/naqsha-zameen /etc/nginx/sites-enabled/naqsha-zameen
   ls /etc/nginx/sites-enabled/
   ```
   If the last command lists the old `api.naqsha-zameen.pk` site file, keep it for now; remove it in domain step 7.
   Also remove any hard-coded `add_header Access-Control-...` lines from the old file. They broke registration from the website before.
2. Test and reload:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. Get certificates for the new names (DNS must already point here, from domain step 2):
   ```bash
   sudo apt install -y certbot python3-certbot-nginx   # if not installed
   sudo certbot --nginx -d naqsha-zameen.com -d www.naqsha-zameen.com -d dashboard.naqsha-zameen.com
   ```
   Certbot renews automatically. Check with `sudo certbot renew --dry-run`.
4. Start the new code **next to** production (do not stop `geo-dashboard`):
   ```bash
   cd /var/www/naqsha-zameen
   pm2 start backend/server.js --name geo-dashboard-test -i 2 --time
   pm2 save
   pm2 logs geo-dashboard-test --lines 30
   ```
   The log should show port 5001 and "background jobs: OFF". Customers on `.pk` are not affected.

---

## Domain step 5. Test the new domain (You, ~30 minutes)

The `.pk` addresses still run the old code, so customers are not affected. Follow the rules in the parallel testing table: make changes only on test accounts.

1. `https://naqsha-zameen.com`: the website loads, with the padlock.
2. `https://www.naqsha-zameen.com/about`: redirects to `https://naqsha-zameen.com/about`.
3. Website → Register button: opens `https://dashboard.naqsha-zameen.com/register`. Register a test account with your own email, and check the activation link points to `dashboard.naqsha-zameen.com`. Keep the test account for future tests.
4. `https://dashboard.naqsha-zameen.com`: log in as admin, sub-admin and user, then run the smoke checklist in `docs/DEPLOYMENT.md` section 2. Pay attention to:
   - the map: tehsil → chak → murabba, killa click, drawing and saving a layer;
   - notifications arriving live (an admin reply to a user);
   - Insights opens directly when you refresh on `/stats`;
   - on a real phone: the map, dropdowns, modals and the guided drawing toolbar.
5. Insights → Visitors: the website visit you just made is counted.

If something fails, nothing public is broken. Fix it, update only the test copy (`git pull && npm run build && pm2 reload geo-dashboard-test`), and repeat. Stay in this phase as long as you like.

---

## Domain step 6. Third-party settings (You, ~15 minutes)

1. **Cloudflare tile worker**: after domain step 1, deploy it so it accepts the new origin.
   ```bash
   cd cloudflare-worker && npx wrangler deploy
   ```
2. **Cloudflare Turnstile** (only if you turn the captcha on): add `dashboard.naqsha-zameen.com` to the site key's hostnames.
3. **Google Search Console**:
   - Add `naqsha-zameen.com` as a Domain property (verify with the TXT record hPanel shows you).
   - Submit `https://naqsha-zameen.com/sitemap-index.xml`.
   - After domain step 7, use **Settings → Change of address** on the old `.pk` property, pointing to `.com`. This moves your Google ranking.
4. **Everywhere you publish the address**: WhatsApp business profile, Google Business Profile, Facebook, printed material, email signature.

---

## Domain step 7. Cutover: customers move to `.com` (You, ~30 minutes, at a quiet hour)

Do this only when testing on `.com` is complete. Announce it a day before.

1. **Switch the new copy to production mode.** In `/var/www/naqsha-zameen/backend/.env` set `PORT=5000` and `JOBS_ENABLED=true`.
2. **Swap the processes** (about 10 seconds of downtime):
   ```bash
   pm2 stop geo-dashboard              # old code, from the old folder
   pm2 delete geo-dashboard-test
   cd /var/www/naqsha-zameen
   pm2 delete geo-dashboard
   pm2 start backend/server.js --name geo-dashboard -i max --time
   pm2 save
   ```
3. **nginx:** in `/etc/nginx/sites-available/naqsha-zameen`, change the `dashboard.naqsha-zameen.com` upstream from port 5001 to 5000, and enable the `.pk` redirect block (instructions are in the file's comments). Then:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. **o3host DNS** for `naqsha-zameen.pk`: point `A @`, `A www` and `A dashboard` to the VPS IP (`api` already points there). Do not touch `MX` or `mail` records; the app sends email through `mail.naqsha-zameen.pk`.
5. **Certificates for the old names**, so the redirects work over https (run after DNS has switched):
   ```bash
   sudo certbot --nginx -d naqsha-zameen.pk -d www.naqsha-zameen.pk -d dashboard.naqsha-zameen.pk -d api.naqsha-zameen.pk
   ```
   Every old address now answers with a 301 to `.com`, path included. For example `dashboard.naqsha-zameen.pk/activate/abc` goes to `dashboard.naqsha-zameen.com/activate/abc`, so links already sent in emails keep working.

**Check:**
```bash
pm2 logs geo-dashboard --lines 50 | grep -i "jobs"     # background jobs: ON
curl -sI https://dashboard.naqsha-zameen.pk/login | grep -i location
# location: https://dashboard.naqsha-zameen.com/login
```

**Undo** (within minutes): `pm2 delete geo-dashboard`, then start the old code again from the old folder (`cd <old folder> && pm2 start backend/server.js --name geo-dashboard -i max --time`). Disable the `.pk` redirect block in nginx and reload; point the `.pk` DNS back to o3host if you already changed it.

---

## Domain step 8. Clean up (after 2-4 weeks)

1. Delete the old website and dashboard files from o3host. Keep the `.pk` domain registered and its DNS pointing at the VPS, so redirects and email keep working.
2. **Code**: remove `.pk` from `ALLOWED_DOMAINS`; then cookies can switch to `SameSite=Lax` (everything is same-origin now), which is safer.
3. Optional: move email to Hostinger mail on `.com` (`info@naqsha-zameen.com`), then update `SMTP_*` and `FROM_EMAIL` in `backend/.env`. Add SPF, DKIM and DMARC records in hPanel so emails do not land in spam.
4. Raise DNS TTLs back to 3600.
5. Continue with `docs/NEXT-STEPS.md` from step 1 (lock the map tiles). Step 7 there becomes simpler: redirects and security headers now live in `deploy/nginx.conf`, not in `.htaccess`.

---

## Summary checklist

- [ ] Domain step 1: code makes the domain a setting (Claude Code)
- [ ] Domain step 2: Hostinger DNS `@`, `www`, `dashboard` → VPS IP
- [ ] Domain step 3: repo, secrets and data on the VPS; test `.env` (port 5001, jobs off)
- [ ] Domain step 4: nginx config, certificates, start `geo-dashboard-test` next to production
- [ ] Domain step 5: test on `.com` with test accounts (customers stay on `.pk`)
- [ ] Domain step 6: tile worker, Turnstile, Search Console
- [ ] Domain step 7: cutover: new code becomes production, `.pk` redirects to `.com`
- [ ] Domain step 8: clean up after 2-4 weeks
