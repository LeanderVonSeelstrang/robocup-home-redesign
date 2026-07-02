#!/usr/bin/env bash
# Start the Firebase emulator + Astro dev server together.
# Auto-seeds the emulator on first run (when no emulator-data dir exists).
#
# Usage:
#   npm run local          — start with persisted emulator data (or fresh + auto-seed)
#   npm run local:fresh    — wipe data, start fresh with a clean seed

set -e
cd "$(dirname "$0")/.."

FRESH=${1:-}
SEED_NEEDED=false

if [ "$FRESH" = "--fresh" ]; then
  echo "♻️  Wiping emulator-data for a fresh seed…"
  rm -rf emulator-data
  SEED_NEEDED=true
elif [ ! -d emulator-data ]; then
  echo "No emulator-data found — will auto-seed after emulator starts."
  SEED_NEEDED=true
fi

# Kill background jobs on Ctrl+C or script exit
trap 'echo; echo "Stopping…"; kill $(jobs -p) 2>/dev/null; wait 2>/dev/null' EXIT INT TERM

# Start emulator in background
IMPORT_FLAG=""
[ -d emulator-data ] && IMPORT_FLAG="--import=./emulator-data"
firebase emulators:start --project robocup-home --export-on-exit=./emulator-data $IMPORT_FLAG &
EMULATOR_PID=$!

# Seed once emulator is ready (only on first run or --fresh)
if [ "$SEED_NEEDED" = "true" ]; then
  echo "Waiting for emulator to be ready…"
  until curl -s http://localhost:8080 > /dev/null 2>&1; do sleep 1; done
  echo "Emulator ready — seeding…"
  npm run seed
fi

# Start Astro dev server in foreground
npm run dev

# Wait for emulator to finish cleanly (it exports data on exit)
wait $EMULATOR_PID
