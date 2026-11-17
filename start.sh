#!/bin/sh
# macOS / Linux launcher. Requires Node.js 20.19+ or 22.12+.
set -e
cd "$(dirname "$0")/backend"
command -v node >/dev/null 2>&1 || { echo "Install Node.js 22 LTS from https://nodejs.org first."; exit 1; }
if [ ! -f node_modules/.meridian-installed ]; then
  echo "Installing components (first run only)..."
  npm ci --omit=dev --no-audit --no-fund
  echo ok > node_modules/.meridian-installed
fi
exec node scripts/run-local.js
