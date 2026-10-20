#!/usr/bin/env bash
# Redeploy RetailZero on EC2: pull latest main, rebuild, restart pm2.
# Usage: ./scripts/deploy.sh
set -euo pipefail

APP_NAME="retailzero-mcp"
BRANCH="main"

cd "$(dirname "$0")/.."

echo "==> Pulling latest $BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
echo "    now at $(git log -1 --format='%h %s')"

# Only reinstall when dependencies changed since the last install.
if [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "==> Installing dependencies"
  npm ci
fi

echo "==> Building"
npm run build

echo "==> Restarting $APP_NAME"
# pm2 restart prints the process table itself, so no separate status call.
pm2 restart "$APP_NAME" --update-env

echo "==> Done"
