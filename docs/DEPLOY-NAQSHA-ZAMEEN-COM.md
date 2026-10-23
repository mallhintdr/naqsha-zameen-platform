# Deploy runbook: naqsha-zameen.com on the Hostinger VPS

The complete, ordered steps to put this repository live on the new domain, next to the current `.pk` production (parallel testing), and later to switch customers over.

| Address | What it serves |
|---|---|
| `https://naqsha-zameen.com` | Website (`site/`) |
| `https://www.naqsha-zameen.com` | Redirects to `naqsha-zameen.com` |
| `https://dashboard.naqsha-zameen.com` | Dashboard app and its API (`frontend/` + `backend/`) |

During testing customers keep using `.pk`, exactly as now. Both copies share the same MongoDB and Redis. The test copy runs on port 5001 with background jobs off; see "Is sharing the database safe?" in `docs/DOMAIN-MIGRATION.md` for the rules.

Facts used below (checked 23 October 2026):
- VPS IP: `46.202.153.115` (Ubuntu, nginx 1.18). Current production: pm2 app **`backend`** (cluster) running `/root/gis-dashboard/backend/server.js` on port 5000.
- **Other apps share this VPS and the same pm2:** `kiln-api`, `kpi-api`, `kpi-worker`. Never run `pm2 update`, `pm2 kill`, `pm2 delete all` or `pm2 restart all`; always name the app.
- `naqsha-zameen.com`, `www` and `dashboard` currently point to Hostinger's parking server (IPv6 records `2a02:4780:...`). These must be removed.
- Code repository: `github.com/mallhintdr/naqsha-zameen-platform` (public; contains no secrets). The older private `geo-dashboard` repository is what the current `.pk` production pulls from; leave it unchanged until cutover.

Time needed: about 2 hours the first time, plus DNS waiting time.

---

## Step 1. Put the repository on GitHub (your PC, 10 min)

**Done on 23 October 2026:** the code is in the private repository `https://github.com/mallhintdr/naqsha-zameen-platform` (branch `main`). To publish later changes from your PC: `git push`.

Check on GitHub that you see `backend/`, `frontend/`, `site/`, `docs/`, `deploy/` and `deploy.sh`, and that there is **no** `.env` file and no `old-repo/` folder. Both are excluded on purpose.

---

## Step 2. DNS for naqsha-zameen.com in Hostinger hPanel (10 min + waiting)

1. hPanel → **Domains** → `naqsha-zameen.com` → **DNS / Nameservers**.
2. Under **Nameservers**, make sure Hostinger's nameservers are selected.
3. Under **DNS records**, **delete** every `A`, `AAAA` and `CNAME` record whose name is `@`, `www` or `dashboard` (these point to the parking page). Do **not** delete `MX`, `TXT` or `CAA` records.
4. **Add** these three records:

   | Type | Name | Points to | TTL |
   |---|---|---|---|
   | A | `@` | `46.202.153.115` | 300 |
   | A | `www` | `46.202.153.115` | 300 |
   | A | `dashboard` | `46.202.153.115` | 300 |

   Do not add `AAAA` records. The VPS is used over IPv4 only, and a wrong IPv6 record makes some phones open the parking page.
5. Wait 5-30 minutes, then check from your PC:
   ```bash
   nslookup naqsha-zameen.com 8.8.8.8
   nslookup dashboard.naqsha-zameen.com 8.8.8.8
   ```
   Each must show only `46.202.153.115`, with no `2a02:` address. Continue with steps 3-6 while you wait; step 7 needs this to be done.

---

## Step 3. Check and prepare the VPS (20 min)

Open a terminal on the VPS: hPanel → **VPS** → **Browser terminal**, or `ssh root@46.202.153.115`.

1. **Find the current app**, and note the folder it runs from:
   ```bash
   pm2 list
   pm2 describe backend | grep -E "exec cwd|script path"
   ```
   On this VPS it is `/root/gis-dashboard`. Below it is called `OLD`. Set it now:
   ```bash
   export OLD=/root/gis-dashboard
   ls $OLD/backend/.env $OLD/backend/data $OLD/backend/uploads
   ```
2. **Node.js version.** The new frontend build needs Node 20.19 or newer (22 recommended):
   ```bash
   node -v
   ```
   If it is older than `v20.19`, install Node 22 (this does not stop the running app):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v && npm -v
   ```
   Do **not** run `pm2 update` or reinstall pm2. On 23 October 2026 `pm2 update` on this VPS restarted the pm2 daemon and every app on it stopped (Naqsha Zameen, kiln-api, kpi-api, kpi-worker) until `pm2 resurrect` was run. The installed pm2 works with Node 22 as it is.
3. **Tools:**
   ```bash
   sudo apt-get update
   sudo apt-get install -y git rsync certbot python3-certbot-nginx
   ```
4. **Firewall.** Ports 80 and 443 must be open (they already are if `.pk` works on https):
   ```bash
   sudo ufw status
   # if active and 80/443 are missing:  sudo ufw allow 'Nginx Full'
   ```
   Also check hPanel → VPS → **Firewall** that 80 and 443 are allowed.

---

## Step 4. Get the code onto the VPS (10 min)

The repository is public, so no key is needed.

1. Clone into a **new** folder. The old folder stays untouched and production keeps running from it.
   ```bash
   sudo mkdir -p /var/www && cd /var/www
   git clone https://github.com/mallhintdr/naqsha-zameen-platform.git naqsha-zameen
   cd /var/www/naqsha-zameen
   ```

---

## Step 5. Settings and data for the test copy (10 min)

1. **Secrets:** start from the production `.env`, then add the test-copy lines:
   ```bash
   cd /var/www/naqsha-zameen
   cp $OLD/backend/.env backend/.env
   nano backend/.env
   ```
   Keep every existing line (`MONGO_URI`, `SECRET_KEY`, `PMTILES_SIGNING_KEY`, `SMTP_*`, `VAPID_*`, `REDIS_*`, `TURNSTILE_*` ...). Delete any existing `PORT`, `CORS_ORIGIN`, `FRONTEND_URL` or `COOKIE_DOMAIN` lines, then add at the end:
   ```
   NODE_ENV=production
   PORT=5001
   JOBS_ENABLED=false
   APP_URL=https://dashboard.naqsha-zameen.com
   SITE_URL=https://naqsha-zameen.com
   FRONTEND_URL=https://dashboard.naqsha-zameen.com
   COOKIE_DOMAIN=.naqsha-zameen.com
   ALLOWED_DOMAINS=naqsha-zameen.com,naqsha-zameen.pk
   CLOUDFLARE_WORKER_URL=https://pmtiles-worker.mallhintdr.workers.dev
   ```
   Save with `Ctrl+O`, `Enter`, `Ctrl+X`.
   **Important:** `PORT` and `JOBS_ENABLED` must be set in this file. The server reads `.env` last, so values typed on the command line are ignored.
2. **Map data and uploads:** share production's folders (no copy, so both copies always see the same files):
   ```bash
   ln -s $OLD/backend/data    backend/data
   ln -s $OLD/backend/uploads backend/uploads
   ls backend/data            # should list Metadata, JSON Murabba, pmtiles, ...
   ```

---

## Step 6. Build and start the test copy (15 min)

1. **Install and build the dashboard:**
   ```bash
   cd /var/www/naqsha-zameen
   npm ci
   npm run build
   ls build/index.html build/meta.json
   ```
   `npm ci` also downloads the Chromium that the Operations Report PDF uses; that is expected and takes a few minutes.
2. **Build and publish the website:**
   ```bash
   (cd site && npm ci && npm run build)
   sudo mkdir -p /var/www/naqsha-zameen-site
   sudo rsync -a --delete site/dist/ /var/www/naqsha-zameen-site/
   ls /var/www/naqsha-zameen-site/index.html
   ```
3. **Start the test copy next to production.** Do not stop `backend`, and do not touch the other apps.
   ```bash
   pm2 start backend/server.js --name geo-dashboard-test -i 2 --time
   pm2 save            # saves the whole list (all apps), so everything comes back after a reboot
   pm2 logs geo-dashboard-test --lines 40 --nostream
   ```
   The log must contain `Server running on port 5001` and `Background jobs: OFF`. If it says port 5000 or jobs ON, fix `backend/.env` (step 5.1) and run `pm2 restart geo-dashboard-test --update-env`.
4. **Quick check on the server:**
   ```bash
   curl -s http://127.0.0.1:5001/health
   ```
   You should see `"status":"healthy"`.

---

## Step 7. nginx and HTTPS (15 min; needs step 2 finished)

1. **Install the site config:**
   ```bash
   sudo cp /var/www/naqsha-zameen/deploy/nginx.conf /etc/nginx/sites-available/naqsha-zameen
   sudo ln -sf /etc/nginx/sites-available/naqsha-zameen /etc/nginx/sites-enabled/naqsha-zameen
   sudo nginx -t && sudo systemctl reload nginx
   ```
   Leave the existing site file for `api.naqsha-zameen.pk` enabled; it serves your customers.
   If `nginx -t` complains about `map $http_upgrade` being defined twice, open `/etc/nginx/sites-available/naqsha-zameen`, delete the line starting with `map $http_upgrade`, and run `sudo nginx -t` again.
2. **Certificates** (free, Let's Encrypt; renew automatically):
   ```bash
   sudo certbot --nginx -d naqsha-zameen.com -d www.naqsha-zameen.com -d dashboard.naqsha-zameen.com
   ```
   Give your email, accept the terms, and choose **redirect** if asked. Then:
   ```bash
   sudo certbot renew --dry-run
   ```
   Note: certbot has now edited `/etc/nginx/sites-available/naqsha-zameen`. Do not copy `deploy/nginx.conf` over it again, or the HTTPS lines are lost; edit the live file instead.
3. **Check from your PC:**
   ```bash
   curl -sI https://naqsha-zameen.com | head -1                 # HTTP/2 200
   curl -sI https://www.naqsha-zameen.com/about | grep -i location   # https://naqsha-zameen.com/about
   curl -s  https://dashboard.naqsha-zameen.com/health         # "status":"healthy"
   ```

---

## Step 8. Let the map tiles load on the new domain (your PC, 10 min)

The map tiles come from the Cloudflare worker, which only answers browsers on addresses it knows. The repository version already includes `https://dashboard.naqsha-zameen.com`; publish it:

```bash
cd D:\temp-repo\cloudflare-worker
npx wrangler login        # opens the browser, log in to Cloudflare
npx wrangler deploy
```

This deploys the same worker that runs today, plus the new address; `.pk` keeps working.

**Check:** on `https://dashboard.naqsha-zameen.com`, open a chak; the red murabba lines must appear. If the map stays empty, see Troubleshooting.

---

## Step 9. Test on naqsha-zameen.com (as long as you need)

**Rules while testing on the shared database:**
- Make changes only on test accounts, for example `test.user1` and `test.subadmin1`, using an email address you own.
- Never log in as a real customer on `.com` (it registers a new device for them), and do not use "Login as" on real customers there.
- Looking at real data is fine; saving changes to it is real.

**Checklist** (desktop and a real phone):
1. Website: home page, all four service pages, the contact page and the Free trial button. The animated dashboard picture plays.
2. Register a test account from the website; the activation email link opens `dashboard.naqsha-zameen.com`.
3. Log in as admin, test sub-admin and test user. Log out.
4. Map: tehsil → chak → murabba; tap a killa (area box); draw and save a layer; Go-To; Shift Mouza then Reset (on a test account).
5. Phone: drawing toolbar, menu and the side panels for Guided Tutorials / Admin Tools; run the Quick Tour.
6. Admin: Users list, open a test user and save, Insights (refresh the page on `/stats`), Sub-admins.
7. Notifications: reply from admin to a test user; it arrives without refreshing.
8. `pm2 logs geo-dashboard-test --lines 100 --nostream` shows no repeating errors.

**Updating the test copy** after new commits are pushed to GitHub:
```bash
cd /var/www/naqsha-zameen
APP_NAME=geo-dashboard-test ./deploy.sh
```
This pulls, rebuilds the dashboard and website, publishes the website, and reloads only `geo-dashboard-test`. Production on `.pk` is not touched.

---

## Step 10. Cutover: customers move to .com (30 min, at a quiet hour)

Do this only when step 9 is complete. Send customers a WhatsApp message the day before, for example: "From tomorrow the dashboard is at dashboard.naqsha-zameen.com. Old links forward automatically. Please log in once again."

1. **Switch the new copy to production mode:**
   ```bash
   cd /var/www/naqsha-zameen
   nano backend/.env        # set PORT=5000 and JOBS_ENABLED=true
   ```
2. **Swap the processes** (about 10 seconds of downtime):
   ```bash
   pm2 stop backend                      # old code in /root/gis-dashboard (kept for rollback)
   pm2 delete geo-dashboard-test
   pm2 start backend/server.js --name geo-dashboard -i 2 --time
   pm2 save
   pm2 logs geo-dashboard --lines 40 --nostream     # port 5000, Background jobs: ON
   ```
3. **nginx:**
   ```bash
   sudo nano /etc/nginx/sites-available/naqsha-zameen
   ```
   - In `upstream naqsha_dashboard`, change `127.0.0.1:5001` to `127.0.0.1:5000`.
   - At the bottom, remove the `# ` in front of each line of the `.pk` redirect `server { ... }` block.

   Disable the old `.pk` site file. Find it with `ls /etc/nginx/sites-enabled/`, then:
   ```bash
   sudo rm /etc/nginx/sites-enabled/<old-pk-file>
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. **Point the `.pk` names at the VPS** (o3host DNS for `naqsha-zameen.pk`): set `A` records for `@`, `www` and `dashboard` to `46.202.153.115`. `api` already points there. Do not change `MX` or `mail` records; the app sends email through `mail.naqsha-zameen.pk`.
5. **Certificates for the old names** (after the `.pk` DNS has switched):
   ```bash
   sudo certbot --nginx -d naqsha-zameen.pk -d www.naqsha-zameen.pk -d dashboard.naqsha-zameen.pk -d api.naqsha-zameen.pk
   ```
6. **Check:**
   ```bash
   curl -sI https://dashboard.naqsha-zameen.pk/login | grep -i location   # https://dashboard.naqsha-zameen.com/login
   curl -sI https://naqsha-zameen.pk/about | grep -i location             # https://naqsha-zameen.com/about
   ```

After one stable week, remove the old process: `pm2 delete backend && pm2 save`.

From now on, update with:
```bash
cd /var/www/naqsha-zameen && ./deploy.sh
```

---

## Rollback

| Situation | Do this |
|---|---|
| A test-copy update is broken | `cd /var/www/naqsha-zameen && mv build build_bad && mv build_prev build && pm2 reload geo-dashboard-test` |
| A website update is broken | `sudo rsync -a --delete /var/www/naqsha-zameen-site_prev/ /var/www/naqsha-zameen-site/` |
| Problems right after cutover | `pm2 stop geo-dashboard && pm2 start backend && pm2 save` (the old `backend` process is still in pm2 until you delete it); put the `#` back on the `.pk` redirect block, re-enable the old site file, reload nginx; point `.pk` DNS back to o3host if you changed it |

Keep `$OLD` and the o3host files for 2-4 weeks after cutover.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `naqsha-zameen.com` shows a Hostinger parking page on some phones | An old `AAAA` record is still there. Delete all `AAAA` records for `@`, `www`, `dashboard` (step 2) and wait for the TTL. |
| certbot: "Challenge failed" | DNS does not point to the VPS yet, or port 80 is blocked. Re-check step 2 and step 3.4. |
| `dashboard.naqsha-zameen.com` shows 502 Bad Gateway | The test copy is not running or uses another port: `pm2 logs geo-dashboard-test`; check `PORT=5001` in `backend/.env`. |
| Login works but you are logged out on every page | `COOKIE_DOMAIN` is not `.naqsha-zameen.com`, or `APP_URL` is wrong. Fix `backend/.env`, then `pm2 restart geo-dashboard-test --update-env`. |
| Map stays empty on `.com` but works on `.pk` | The worker was not redeployed (step 8). In the browser's developer tools (F12 → Console) you will see a CORS error for `pmtiles-worker`. |
| Activation or reset emails link to `.pk` | `APP_URL` / `FRONTEND_URL` in `backend/.env` still point to `.pk`. |
| `npm run build` fails with "Vite requires Node.js version 20.19+" | Install Node 22 (step 3.2). |
| `pm2 list` is suddenly empty and sites are down | The pm2 daemon restarted without loading its list. Run `pm2 resurrect`, then `pm2 list`; if still empty, start each app from its folder (see the chat log of 23 October 2026), then `pm2 save` and `pm2 startup`. |
| Customers get two copies of a daily email | The test copy has `JOBS_ENABLED` missing or `true`. Set it to `false` and restart it. |
