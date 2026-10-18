#!/usr/bin/env bash
# Starts the Track Me Live emulators for the offline demo project:
# Auth, Firestore, Functions, the Emulator UI, and Hosting when code/viewer/dist
# exists. Extra arguments go to `firebase emulators:start`, for example
#   ./run.sh --import .emulator-data --export-on-exit
# The dev set also gets the dev scheduler (scripts/dev-scheduler.sh), which runs
# the scheduled functions the emulators never fire, so sessions end on their timer
# and at the 1-hour limit; it stops with the emulators. DEV_SCHEDULER=0 leaves it out.
# ./run.sh --test starts the test set instead (scripts/env.sh): project
# demo-trackmelive-test on its own ports, no UI, Hosting or scheduler. test.sh
# reuses it while it runs, which saves the emulator start-up on every run.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/env.sh"
cd "${BACKEND_DIR}"

set_name="dev"
if [[ "${1:-}" == "--test" ]]; then
  set_name="test"
  shift
  write_test_params
fi
use_emulator_set "${set_name}"

build_functions

only="auth,firestore,functions"
viewer_dist="${BACKEND_DIR}/../viewer/dist"
if [[ "${set_name}" == "test" ]]; then
  # Its own folder for firebase-debug.log and firestore-debug.log, so they don't
  # overwrite the dev set's logs in this folder.
  mkdir -p "${TEST_LOG_DIR}"
  cd "${TEST_LOG_DIR}"
  echo "==> test emulators: project ${PROJECT_ID}, Auth ${AUTH_PORT}, Firestore ${FIRESTORE_PORT}, Functions ${FUNCTIONS_PORT}  (Ctrl-C to stop)"
elif [[ -f "${viewer_dist}/index.html" ]]; then
  only="${only},hosting"
else
  echo "==> code/viewer/dist/index.html not found; starting without Hosting (build the viewer to serve it)"
fi

echo "==> Java: $(java -version 2>&1 | grep -v "^Picked up" | head -n 1)"
if [[ "${set_name}" == "test" ]]; then
  exec "${FIREBASE[@]}" emulators:start --config "${EMULATOR_CONFIG}" --project "${PROJECT_ID}" --only "${only}" "$@"
fi

echo "==> Emulator UI http://127.0.0.1:${UI_PORT}  (Ctrl-C to stop)"
echo "    Rebuild functions on change in another terminal: npm --prefix functions run build:watch"
if [[ "${DEV_SCHEDULER:-1}" != 0 ]]; then
  # It waits for Firestore to answer, so it can start first. A background job here
  # ignores Ctrl-C, so the trap stops it when the emulators exit.
  "${BACKEND_DIR}/scripts/dev-scheduler.sh" &
  scheduler_pid=$!
  trap 'kill "${scheduler_pid}" 2>/dev/null || true' EXIT
fi
"${FIREBASE[@]}" emulators:start --config "${EMULATOR_CONFIG}" --project "${PROJECT_ID}" --only "${only}" "$@"
