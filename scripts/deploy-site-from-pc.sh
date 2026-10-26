#!/usr/bin/env bash
# Build the website (21,000+ pages) on THIS computer and upload it to the VPS, so the VPS
# never has to build it. Works in Git Bash on Windows (uses the built-in tar and ssh).
#
#   bash scripts/deploy-site-from-pc.sh
#   VPS=root@46.202.153.115 SITE_DIR=/var/www/naqsha-zameen-site bash scripts/deploy-site-from-pc.sh
#
# Then deploy the dashboard on the VPS without the website:
#   SKIP_SITE=1 APP_NAME=geo-dashboard-test bash deploy.sh
set -euo pipefail
VPS="${VPS:-root@46.202.153.115}"
SITE_DIR="${SITE_DIR:-/var/www/naqsha-zameen-site}"
cd "$(dirname "$0")/../site"

echo "==> Building website locally"
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build

echo "==> Uploading to $VPS:$SITE_DIR (one compressed stream)"
tar -czf - -C dist . | ssh "$VPS" "set -e
  rm -rf /tmp/nz_site_new && mkdir -p /tmp/nz_site_new && tar -xzf - -C /tmp/nz_site_new
  mkdir -p '$SITE_DIR' && rm -rf '${SITE_DIR}_prev' && cp -al '$SITE_DIR' '${SITE_DIR}_prev'
  rsync -a --delete /tmp/nz_site_new/ '$SITE_DIR/' && rm -rf /tmp/nz_site_new
  echo 'website published; rollback: rsync -a --delete ${SITE_DIR}_prev/ $SITE_DIR/'"
