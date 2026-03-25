#!/usr/bin/env bash
set -euo pipefail
echo "== Afro_Future Dev Bootstrap (bash)=="

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if jq -e '.scripts["dev:full"]' package.json >/dev/null 2>&1; then
  echo "Starting dev:full"
  exec npm run dev:full
else
  echo "dev:full not found; launching server & dev separately"
  npm run server &
  SERVER_PID=$!
  sleep 2
  npm run dev &
  FRONT_PID=$!
  trap 'echo Stopping...; kill $SERVER_PID $FRONT_PID' INT TERM
  wait $SERVER_PID $FRONT_PID
fi