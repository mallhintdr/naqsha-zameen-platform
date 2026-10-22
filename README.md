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

## Check

```bash
npm run typecheck
npm run lint
npm test
npm run build             # writes ./build, served by backend/server.js
```

## Deploy

See `docs/DEPLOYMENT.md`. Routine updates on the VPS: `./deploy.sh`.
