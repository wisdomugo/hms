#!/usr/bin/env bash
#
# Deploy an update on the server.
#
#   ./scripts/deploy.sh
#
# Run it from the repository root, on the machine the hospital uses.
#
# THE ORDER MATTERS AND IT IS NOT ARBITRARY:
#
#   back up  ->  pull  ->  install  ->  generate  ->  migrate  ->  build  ->  restart
#
# Backup first, because everything after it can go wrong and a migration is the
# thing most likely to. Restart LAST, because new code running against an
# un-migrated database is the failure mode with the worst symptoms — it half
# works, which is harder to diagnose than not working at all.
#
# set -e means any failing step stops the deploy where it stands, with the old
# code still running. A half-deployed hospital is worse than an un-deployed one.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

say() { printf '\n\033[36m▸ %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
say "Backing up before anything else"
# ---------------------------------------------------------------------------
# If this fails, nothing else runs. A deploy without a backup to fall back on is
# a deploy you cannot undo.
( cd api && npm run backup )

# ---------------------------------------------------------------------------
say "Fetching the new code"
# ---------------------------------------------------------------------------
git pull --ff-only
COMMIT=$(git rev-parse --short HEAD)
echo "  now at $COMMIT"

# ---------------------------------------------------------------------------
say "Installing dependencies"
# ---------------------------------------------------------------------------
# npm ci, not npm install: it installs exactly what the lockfile says and fails
# if the lockfile and package.json disagree. On a server that difference is the
# one between a reproducible deploy and a surprise.
( cd api && npm ci --omit=dev --foreground-scripts )
( cd app && npm ci )

# ---------------------------------------------------------------------------
say "Generating Prisma clients"
# ---------------------------------------------------------------------------
# Both of them. Skipping this is the mistake from DEV_GUIDE_03 §8.1 — the
# migration applies, the client stays stale, and every query fails with
# "Cannot read properties of undefined" while the database is perfectly fine.
( cd api && npm run generate )

# ---------------------------------------------------------------------------
say "Migrating the control plane"
# ---------------------------------------------------------------------------
# `migrate deploy` only applies migrations that already exist and can never
# reset anything. `migrate dev` is a development command that offers to drop
# every table when it detects drift, and this database is the routing table for
# every hospital.
( cd api && npm run control:migrate )

# ---------------------------------------------------------------------------
say "Migrating every hospital"
# ---------------------------------------------------------------------------
# Exits non-zero if any hospital fails, which stops the deploy here — before the
# restart. A hospital left on an old schema while new code runs against it is
# the split-brain DEV_GUIDE_02 warned about.
( cd api && npm run migrate:all )

# ---------------------------------------------------------------------------
say "Building the staff application"
# ---------------------------------------------------------------------------
# app/dist is gitignored, so the server builds it. Pulling new front-end code
# without this leaves the old bundle being served — the change appears to have
# done nothing, which is a miserable thing to debug.
( cd app && npm run build )

# ---------------------------------------------------------------------------
say "Restarting"
# ---------------------------------------------------------------------------
# GIT_COMMIT is read by /health, so a fleet check can answer "what version is
# this hospital actually running" without anybody logging in.
export GIT_COMMIT="$COMMIT"

if command -v systemctl >/dev/null && systemctl list-units --type=service | grep -q hms-api; then
  sudo systemctl restart hms-api
  RESTARTED="systemd"
elif command -v pm2 >/dev/null; then
  pm2 restart hms-api --update-env
  RESTARTED="pm2"
else
  echo "  No systemd unit or pm2 process found."
  echo "  Restart the API however this machine runs it, with GIT_COMMIT=$COMMIT set."
  RESTARTED="manually — not done"
fi

# ---------------------------------------------------------------------------
say "Checking it came back"
# ---------------------------------------------------------------------------
sleep 3
if curl -fsS http://localhost:3000/health > /tmp/hms-health.json 2>/dev/null; then
  echo "  $(cat /tmp/hms-health.json)"
  echo
  echo "  Deployed $COMMIT, restarted via $RESTARTED."
else
  echo
  echo "  The API did not answer /health after restarting."
  echo "  Check the service log. The database is already migrated, so rolling"
  echo "  the code back may not be enough on its own."
  exit 1
fi
