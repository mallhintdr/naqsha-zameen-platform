#!/usr/bin/env bash
# One-command update on the Hostinger VPS (frontend + backend from the same repo):
#   cd /path/to/naqsha-zameen && ./deploy.sh
# Pulls main, installs deps when lock files change, builds the Vite app into ./build
# (served by backend/server.js behind nginx), then reloads pm2 without downtime.
# Never touches .env files, backend/data, uploads or logs (gitignored).
set -euo pipefail
APP_NAME="${APP_NAME:-geo-dashboard}"
BRANCH="${BRANCH:-main}"
cd "$(dirname "$0")"

echo "==> Fetching $BRANCH"
OLD=$(git rev-parse HEAD)
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"
NEW=$(git rev-parse HEAD)
changed() { [ "$OLD" != "$NEW" ] && git diff --name-only "$OLD" "$NEW" | grep -qx "$1"; }

if [ ! -d node_modules ] || changed package-lock.json; then
  echo "==> Installing dependencies"; npm ci --no-audit --no-fund
fi

echo "==> Building frontend"
# Same origin as the API: VITE_API_URL empty. Build to a temp folder and swap atomically.
VITE_API_URL="" OUT_DIR=build_next npm run build
rm -rf build_prev; [ -d build ] && mv build build_prev; mv build_next build; rm -rf build_prev

echo "==> Reloading backend"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env
else
  pm2 start backend/server.js --name "$APP_NAME" -i max --time
fi
pm2 save >/dev/null
echo "==> Deployed $(git log -1 --pretty='%h %s')"
