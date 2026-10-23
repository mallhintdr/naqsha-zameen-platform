# Naqsha Zameen

Land-record map dashboard by GeoMatrix Technologies. One repository, deployed as one unit:

- `frontend/` — Vite + React 19 + TypeScript + Tailwind v4 single-page app.
- `backend/` — Express + MongoDB API (also serves the built frontend from `build/`).
- `cloudflare-worker/` — PMTiles gateway on Cloudflare R2.
- `docs/` — rebuild plan, porting guide, deployment runbook and the legacy design record.

## Develop

```bash
npm ci                    # installs both workspaces
cp .env.example frontend/.env.development   # optional; defaults work with the dev proxy
npm run dev:backend       # API on :5000 (needs backend/.env)
npm run dev               # app on http://localhost:3000, proxies /api, data folders and sockets
```

## Versioning

Every commit raises the app version by one step, rolling over at 9 (`5.1.9` -> `5.2.0`, `5.9.9` -> `6.0.0`). The version shows in the menu footer, and the dashboard reloads itself in open browsers when a newer build is deployed.
Enable the commit hook once per clone: `npm run setup-hooks`. Skip it for one commit with `SKIP_VERSION_BUMP=1 git commit ...`.

## Check

```bash
npm run typecheck
npm run lint
npm test
npm run build             # writes ./build, served by backend/server.js
```

## Deploy

Step-by-step runbook: `docs/DEPLOY-NAQSHA-ZAMEEN-COM.md`. Routine updates on the VPS: `./deploy.sh` (test copy: `APP_NAME=geo-dashboard-test ./deploy.sh`).
