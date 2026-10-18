#!/usr/bin/env bash
# Runs the dev scheduler (functions/scripts/dev-scheduler.mjs) against the dev
# emulator set that ./run.sh serves: stopDueSessions every 5 s, and the other
# scheduled functions at their own cadence, with one line per change. The
# Functions emulator never fires scheduled functions, so without this no dev
# session ends at its timer or the 1-hour limit. ./run.sh starts it by itself;
# run this next to a dev set that's already up. Ctrl-C stops it.
#   code/backend/scripts/dev-scheduler.sh [--interval <s>] [--once]
# It runs the compiled handlers in functions/lib, building them only if lib is
# missing (the running Functions emulator reloads lib on every build). When lib is
# rebuilt, the scheduler exits with status 75 and this starts it again, so it
# never runs stale handlers.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
use_emulator_set dev

if [[ ! -f "${BACKEND_DIR}/functions/lib/index.js" ]]; then
  build_functions
fi

export GCLOUD_PROJECT="${PROJECT_ID}"
export FIRESTORE_EMULATOR_HOST="127.0.0.1:${FIRESTORE_PORT}"
export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:${AUTH_PORT}"
# Offline: don't let google-auth-library probe for a GCP metadata server.
export METADATA_SERVER_DETECTION=none
# Node runs as a child so it can be restarted; a TERM (run.sh stopping it) or
# Ctrl-C stops it and this loop together.
child=""
trap '[[ -n "${child}" ]] && kill "${child}" 2>/dev/null; exit 0' TERM INT HUP
while :; do
  node "${BACKEND_DIR}/functions/scripts/dev-scheduler.mjs" "$@" &
  child=$!
  status=0
  wait "${child}" || status=$?
  child=""
  [[ "${status}" -eq 75 ]] || exit "${status}"
done
