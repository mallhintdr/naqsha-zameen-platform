#!/usr/bin/env bash
# One-command update on the Hostinger VPS: dashboard app + backend + website.
#
#   ./deploy.sh                                # production (pm2 "geo-dashboard")
#   APP_NAME=geo-dashboard-test ./deploy.sh    # parallel test copy (docs/DOMAIN-MIGRATION.md)
#   SKIP_SITE=1 ./deploy.sh                    # app only
#   FORCE_SITE=1 ./deploy.sh                   # rebuild the website even if site/ did not change
#                                               (e.g. after new mouzas were added, for the /maps/ pages)
#
# The website (21,000+ /maps/ pages) is rebuilt ONLY when site/ or the inheritance engine changed
# since the last website build, at the lowest CPU / disk priority with limited parallelism, and
# AFTER the app has been reloaded, so the server stays responsive.
#
# Pulls the branch, installs dependencies when lock files change, builds the app into
# ./build (served by backend/server.js behind nginx) and the website into SITE_DIR,
# keeps the previous copies for rollback, then reloads pm2 without downtime.
# Never touches .env files, backend/data, uploads or logs (gitignored).
set -euo pipefail
APP_NAME="${APP_NAME:-geo-dashboard}"
BRANCH="${BRANCH:-main}"
SITE_DIR="${SITE_DIR:-/var/www/naqsha-zameen-site}"
cd "$(dirname "$0")"

echo "==> Fetching $BRANCH"
OLD=$(git rev-parse HEAD)
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"
NEW=$(git rev-parse HEAD)
changed() { [ "$OLD" != "$NEW" ] && git diff --name-only "$OLD" "$NEW" | grep -qx "$1"; }

if [ ! -d node_modules ] || changed package-lock.json; then
  echo "==> Installing app dependencies"; PUPPETEER_SKIP_DOWNLOAD="${PUPPETEER_SKIP_DOWNLOAD:-}" npm ci --no-audit --no-fund
fi

echo "==> Building dashboard app"
# Same origin as the API: VITE_API_URL empty. Build to a temp folder and swap atomically.
VITE_API_URL="" OUT_DIR=build_next npm run build
rm -rf build_prev; [ -d build ] && mv build build_prev; mv build_next build


echo "==> Reloading $APP_NAME"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env
else
  pm2 start backend/server.js --name "$APP_NAME" -i max --time
fi
pm2 save >/dev/null
# ---- website: only when it changed, gently ----
SITE_MARK=".site-built-commit"
site_changed() {
  [ -n "${FORCE_SITE:-}" ] && return 0
  [ -f "$SITE_MARK" ] || return 0
  git diff --quiet "$(cat "$SITE_MARK")" "$NEW" -- site packages/inheritance-engine 2>/dev/null && return 1 || return 0
}
if [ -z "${SKIP_SITE:-}" ] && [ -d site ]; then
  if site_changed; then
    echo "==> Building website (low priority; this can take a few minutes)"
    if [ ! -d site/node_modules ] || changed site/package-lock.json; then (cd site && nice -n 19 npm ci --no-audit --no-fund); fi
    LOWPRI="nice -n 19"; command -v ionice >/dev/null && LOWPRI="$LOWPRI ionice -c3"
    (cd site && SITE_BUILD_CONCURRENCY="${SITE_BUILD_CONCURRENCY:-2}" NODE_OPTIONS="--max-old-space-size=${SITE_BUILD_MEMORY_MB:-1024}" $LOWPRI npm run build)
    echo "==> Publishing website to $SITE_DIR"
    mkdir -p "$SITE_DIR"
    # Rollback copy with hard links (instant, no extra disk), then copy only what changed.
    rm -rf "${SITE_DIR}_prev"; cp -al "$SITE_DIR" "${SITE_DIR}_prev"
    $LOWPRI rsync -a --delete site/dist/ "$SITE_DIR/"
    echo "$NEW" > "$SITE_MARK"
  else
    echo "==> Website unchanged since $(cut -c1-7 "$SITE_MARK"); skipping (FORCE_SITE=1 to rebuild)"
  fi
fi

echo "==> Deployed $(git log -1 --pretty='%h %s')"
echo "    Rollback app:  mv build build_bad && mv build_prev build && pm2 reload $APP_NAME"
echo "    Rollback site: rsync -a --delete ${SITE_DIR}_prev/ $SITE_DIR/"
