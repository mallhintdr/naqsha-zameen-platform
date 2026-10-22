# Deployment and cutover runbook

Target: one origin, `https://dashboard.naqsha-zameen.pk`, served by the Hostinger VPS.
nginx (already in front of pm2) proxies to the Express app on port 5000, which serves both the
Vite build (`./build`) and the API. The domain's DNS zone stays at o3host.

## 1. One-time server setup (VPS)

```bash
# as the deploy user
git clone <new-repo-url> /var/www/naqsha-zameen
cd /var/www/naqsha-zameen

# carry over secrets and data from the old checkout (never committed)
cp /path/to/old/backend/.env            backend/.env
ln -s /path/to/old/backend/data         backend/data      # or move it
ln -s /path/to/old/backend/uploads      backend/uploads

# backend .env: make sure these are present
#   CORS_ORIGIN=https://dashboard.naqsha-zameen.pk
#   FRONTEND_URL=https://dashboard.naqsha-zameen.pk
#   CLOUDFLARE_WORKER_URL=https://pmtiles-worker.mallhintdr.workers.dev   <- new name, required
#   NODE_ENV=production

PUPPETEER_SKIP_DOWNLOAD= npm ci     # root install covers frontend + backend workspaces
npm run build                       # writes ./build
pm2 delete geo-dashboard || true    # old process pointed at the old checkout
pm2 start backend/server.js --name geo-dashboard -i max --time
pm2 save
```

nginx: copy `deploy/nginx.conf` to `/etc/nginx/sites-available/naqsha-zameen`, merge with the
existing `api.naqsha-zameen.pk` server block (keep its certificate lines), enable, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dashboard.naqsha-zameen.pk -d api.naqsha-zameen.pk
```

Certbot's HTTP challenge for `dashboard.` only succeeds after DNS points at the VPS (step 3).
Until then, issue the certificate with the DNS challenge, or run certbot right after the flip.

## 2. Verify before touching DNS

The backend already serves the SPA on the API hostname, so the new frontend can be tested live
without changing DNS: open `https://api.naqsha-zameen.pk/` and run the smoke test below.

Smoke test (each as admin, sub-admin and plain user):
1. Login, logout, login-as (admin) and back.
2. Map: pick tehsil, chak, murabba; killa click shows area; draw a polygon; save and reopen a layer; Go-To; Shift Mouza and reset.
3. Phone (real device): map controls, guided drawing toolbar above the home bar, dropdowns, modals as bottom sheets.
4. Users list, edit modal save, demo link, payment proof upload.
5. Insights tabs, sub-admin console and dashboard.
6. Notifications arrive (socket) and the bell badge updates.
7. Version checker: deploy twice, the open tab reloads once.

## 3. DNS flip at o3host

1. A day before: lower the TTL of the `dashboard` record to 300 s.
2. Change `dashboard` A record to the VPS IP (same IP as `api`).
   If o3host only allows CNAME edits for that host, use `CNAME dashboard -> api.naqsha-zameen.pk`.
3. Issue/extend the certificate for `dashboard.` (section 1) once DNS resolves to the VPS.
4. Watch `pm2 logs geo-dashboard` and nginx access logs for an hour.

Rollback: point the record back to the o3host IP. The old static build on o3host is untouched
until you delete it, and the API stays the same for both frontends.

## 4. After one stable release (decision D11)

- Remove the old files from o3host (`public_html` of the dashboard subdomain).
- Optional: retire `api.naqsha-zameen.pk`, then set `COOKIE_SAMESITE=lax` in `backend/.env`
  (same-origin no longer needs `SameSite=None`) and reload pm2.

## 5. Routine deploys

```bash
cd /var/www/naqsha-zameen && ./deploy.sh
```

`deploy.sh` pulls `main`, runs `npm ci` only when `package-lock.json` changed, builds into
`build_next`, swaps it atomically into `build`, and does a zero-downtime `pm2 reload`.

## 6. Known items carried over (not changed by this rebuild)

- D12: `cloudflare-worker/wrangler.toml` deploys the no-auth worker while the backend signs URLs
  for the HMAC worker. Behaviour is unchanged; switching to the HMAC worker is a separate task.
- D10: Google base-map tiles are used without an API key, as before.
