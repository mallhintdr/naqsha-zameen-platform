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
| `https://app.naqsha-zameen.com` | The dashboard app and its API (`/api`, `/socket.io`, data files) | Same origin: no CORS, no cross-site cookies |
| `naqsha-zameen.pk`, `www.`, `dashboard.`, `api.` | 301 redirects to the matching `.com` address, keeping the path | Old links keep working |

Everything runs on one VPS: nginx serves the website files directly and passes `app.` to the Node app (pm2) on port 5000.

`app.` is recommended over `dashboard.`: it is shorter to type on a phone and reads well in Urdu and English messages. If you prefer `dashboard.naqsha-zameen.com`, tell Claude Code before domain step 1; nothing else changes.

### What users will notice (one time only)
- **Everyone is logged out once.** Login cookies belong to the old domain.
- **Browser-saved data starts fresh**: "Remember me", the unit choice on the map, the Aks Shajra draft, admin map mode. Export any Aks Shajra draft you need (Save → JSON) before the switch, and open it again afterwards.
- **Phone and desktop notifications must be allowed again** on the new address. The app asks after the first tap.
- **Devices get a new device id.** The backend also recognises devices by their fingerprint, so multi-device counts should mostly carry over. Watch the Multi-IP tab for a week and use "forget device" if a user is flagged wrongly.

Announce it a day before, for example on WhatsApp: "From [date] the dashboard is at app.naqsha-zameen.com. Old links will forward automatically. Please log in once again."

---

## Domain step 1. Make the domain a setting (Code)

Before anything changes on the server, the code must stop assuming `.pk`. Claude Code will:

1. **Backend: one setting for addresses.** New env values `APP_URL=https://app.naqsha-zameen.com` and `SITE_URL=https://naqsha-zameen.com`. These replace every hard-coded `dashboard.naqsha-zameen.pk`: email links, the logout and demo-link redirects, the cookie domain and the CORS default.
   Files: `utils/emailUtils.js`, `utils/frontendOrigin.js`, `controllers/authController.js`, `middleware/authMiddleware.js`, `server.js`, `services/visitorCounter.js`.
2. **Backend: allowed origins for both domains during the move.** `utils/allowedOrigins.js` accepts https on `naqsha-zameen.com` and `naqsha-zameen.pk`, plus their subdomains (list set by an `ALLOWED_DOMAINS` env value).
3. **Frontend:** remove the four `dashboard.naqsha-zameen.pk` fallbacks (the app always knows its own address), and include both domains in "Clear cache" cookie clean-up.
4. **Tile workers:** add `https://app.naqsha-zameen.com` to the allowed origins of `cloudflare-worker/pmtiles-worker.js` and `pmtiles-worker-simple.js`.
5. **Website:**
   - `site/src/site.ts`: `url`, `dashboardUrl`, `registerUrl`, `loginUrl` move to `.com`; the visit counter points at `https://app.naqsha-zameen.com/api/visit.gif`.
   - `site/astro.config.mjs`: `site: 'https://naqsha-zameen.com'`.
   - Replace the visible `dashboard.naqsha-zameen.pk` text on 3 pages.
   - Delete the Apache `site/public/.htaccess` (nginx does redirects now).
6. **Server config:**
   - New `deploy/nginx.conf` with four server blocks: website, `www` redirect, app, and `.pk` redirects.
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
   | A | `app` | VPS IP |

   If hPanel shows an `AAAA` (IPv6) record for `@` or `www` that is not your VPS, delete it too. A wrong IPv6 record makes some phones open the wrong server.
5. **Email**: leave `MX` records alone unless you set up Hostinger email for `.com`. Outgoing app email keeps using the `.pk` mail server (`SMTP_HOST` in `backend/.env`) until you choose to move it.

**Check** (from your PC, after 5-30 minutes):
```bash
nslookup naqsha-zameen.com
nslookup app.naqsha-zameen.com
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
   APP_URL=https://app.naqsha-zameen.com
   SITE_URL=https://naqsha-zameen.com
   FRONTEND_URL=https://app.naqsha-zameen.com
   CORS_ORIGIN=https://app.naqsha-zameen.com
   COOKIE_DOMAIN=.naqsha-zameen.com
   ALLOWED_DOMAINS=naqsha-zameen.com,naqsha-zameen.pk
   CLOUDFLARE_WORKER_URL=https://pmtiles-worker.mallhintdr.workers.dev
   ```
   Keep `MONGO_URI`, `SECRET_KEY`, `PMTILES_SIGNING_KEY`, `SMTP_*`, `VAPID_*` exactly as they were. `VAPID` keys must not change, or existing push subscriptions stop working.
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
   sudo certbot --nginx -d naqsha-zameen.com -d www.naqsha-zameen.com -d app.naqsha-zameen.com
   ```
   Certbot renews automatically. Check with `sudo certbot renew --dry-run`.
4. Restart the app from the new folder:
   ```bash
   pm2 delete geo-dashboard
   pm2 start backend/server.js --name geo-dashboard -i max --time
   pm2 save
   ```
   This briefly interrupts the old `.pk` site too, because both share the backend. Do it at a quiet hour.

---

## Domain step 5. Test the new domain (You, ~30 minutes)

The old `.pk` addresses are still untouched at this point, so users are not affected while you test.

1. `https://naqsha-zameen.com`: the website loads, with the padlock.
2. `https://www.naqsha-zameen.com/about`: redirects to `https://naqsha-zameen.com/about`.
3. Website → Register button: opens `https://app.naqsha-zameen.com/register`. Complete a test registration and check the activation email link points to `app.naqsha-zameen.com`.
4. `https://app.naqsha-zameen.com`: log in as admin, sub-admin and user, then run the smoke checklist in `docs/DEPLOYMENT.md` section 2. Pay attention to:
   - the map: tehsil → chak → murabba, killa click, drawing and saving a layer;
   - notifications arriving live (an admin reply to a user);
   - Insights opens directly when you refresh on `/stats`;
   - on a real phone: the map, dropdowns, modals and the guided drawing toolbar.
5. Insights → Visitors: the website visit you just made is counted.

If something fails, nothing public is broken yet. Fix it, then repeat this step.

---

## Domain step 6. Third-party settings (You, ~15 minutes)

1. **Cloudflare tile worker**: after domain step 1, deploy it so it accepts the new origin.
   ```bash
   cd cloudflare-worker && npx wrangler deploy
   ```
2. **Cloudflare Turnstile** (only if you turn the captcha on): add `app.naqsha-zameen.com` to the site key's hostnames.
3. **Google Search Console**:
   - Add `naqsha-zameen.com` as a Domain property (verify with the TXT record hPanel shows you).
   - Submit `https://naqsha-zameen.com/sitemap-index.xml`.
   - After domain step 7, use **Settings → Change of address** on the old `.pk` property, pointing to `.com`. This moves your Google ranking.
4. **Everywhere you publish the address**: WhatsApp business profile, Google Business Profile, Facebook, printed material, email signature.

---

## Domain step 7. Turn the old `.pk` addresses into redirects (You, ~15 minutes, at a quiet hour)

Once the new domain has worked for a day or two:

1. **o3host DNS** for `naqsha-zameen.pk`: point these to the VPS IP.
   - `A @` (the website)
   - `A www`
   - `A dashboard`

   `api` already points there. Do not touch `MX` or `mail` records: the app sends email through `mail.naqsha-zameen.pk`.
2. **VPS**: get certificates for the old names so the redirects work over https:
   ```bash
   sudo certbot --nginx -d naqsha-zameen.pk -d www.naqsha-zameen.pk -d dashboard.naqsha-zameen.pk -d api.naqsha-zameen.pk
   ```
   The `.pk` redirect block from domain step 1 now answers every old address with a 301 to `.com`, path included. For example `dashboard.naqsha-zameen.pk/activate/abc` goes to `app.naqsha-zameen.com/activate/abc`, so activation and reset links already sent in emails keep working.
3. Remove the old nginx site file for `api.naqsha-zameen.pk` if one is still enabled, then `sudo nginx -t && sudo systemctl reload nginx`.

**Check:**
```bash
curl -sI https://dashboard.naqsha-zameen.pk/login | grep -i location
# location: https://app.naqsha-zameen.com/login
curl -sI https://naqsha-zameen.pk/about | grep -i location
# location: https://naqsha-zameen.com/about
```

**Undo:** point the `.pk` DNS records back to o3host. The old o3host files are still there until step 8.

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
- [ ] Domain step 2: Hostinger DNS `@`, `www`, `app` → VPS IP
- [ ] Domain step 3: repo, secrets and data on the VPS; new `.env` values
- [ ] Domain step 4: nginx config, certificates, restart pm2
- [ ] Domain step 5: test everything on `.com` (users unaffected)
- [ ] Domain step 6: tile worker, Turnstile, Search Console
- [ ] Domain step 7: `.pk` addresses become redirects
- [ ] Domain step 8: clean up after 2-4 weeks
