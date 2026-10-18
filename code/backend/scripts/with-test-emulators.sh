#!/usr/bin/env bash
# Runs a command against the test emulator set: project demo-trackmelive-test,
# firebase.test.json, Auth 9199, Firestore 8180, Functions 5101 (scripts/env.sh).
# Any test suite that needs the emulators uses this, so there's one copy of the set.
#   code/backend/scripts/with-test-emulators.sh <command> [args...]
#
# - Takes the machine-wide `firebase` lock (code/scripts/with-lock.sh) for the whole
#   run, unless a caller already holds it (check-all.sh does), and never in CI.
# - Builds the functions when functions/lib is missing or older than functions/src
#   or the shared schema.
# - Reuses a test set that `./run.sh --test` has up. Otherwise `firebase
#   emulators:exec` starts Auth, Firestore and Functions for the command and stops
#   them afterwards.
# - Runs the command in the folder it was called from, with these exported:
#     GCLOUD_PROJECT=demo-trackmelive-test
#     FIRESTORE_EMULATOR_HOST=127.0.0.1:8180
#     FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199
#     FUNCTIONS_EMULATOR_HOST=127.0.0.1:5101
#     TML_TEST_EMULATORS=1
# - Exits with the command's status.
#
# The command may wipe the test project's data; nothing else uses it. The dev set
# (./run.sh, demo-trackmelive) is never touched. The emulators take browser requests
# from any origin, the viewer's dev server (localhost:5173, 127.0.0.1:5173) included.
set -euo pipefail
if [[ $# -eq 0 ]]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 2
fi
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
use_emulator_set test

# The lock: with-lock.sh records its own pid and runs the command as its child, so
# a holder among this process's ancestors means a caller took it for this run.
LOCK="${BACKEND_DIR}/../scripts/with-lock.sh"
lock_held_by_caller() {
  local holder pid="$$"
  holder="$(cat "${TMPDIR:-/tmp}/tml-lock-firebase/pid" 2>/dev/null)" || return 1
  while [[ -n "${pid}" && "${pid}" -gt 1 ]]; do
    [[ "${pid}" == "${holder}" ]] && return 0
    pid="$(ps -o ppid= -p "${pid}" | tr -d ' ')"
  done
  return 1
}
if [[ "${GITHUB_ACTIONS:-}" != true && "${TML_NO_LOCKS:-0}" != 1 ]] && ! lock_held_by_caller; then
  exec "${LOCK}" firebase "$0" "$@"
fi

functions_stale() {
  local lib="${BACKEND_DIR}/functions/lib/index.js"
  [[ ! -f "${lib}" ]] && return 0
  [[ -n "$(find "${BACKEND_DIR}/functions/src" "${BACKEND_DIR}/../shared/schema/generated/ts/schema.ts" \
    -newer "${lib}" -print -quit 2>/dev/null)" ]]
}
if functions_stale; then
  build_functions
fi
write_test_params

export GCLOUD_PROJECT="${PROJECT_ID}"
export FIRESTORE_EMULATOR_HOST="127.0.0.1:${FIRESTORE_PORT}"
export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:${AUTH_PORT}"
export FUNCTIONS_EMULATOR_HOST="127.0.0.1:${FUNCTIONS_PORT}"
export TML_TEST_EMULATORS=1

test_set_running() {
  local list
  list="$(curl -fsS "http://127.0.0.1:${HUB_PORT}/emulators" 2>/dev/null)" || return 1
  [[ "${list}" == *'"auth"'* && "${list}" == *'"firestore"'* && "${list}" == *'"functions"'* ]]
}

if test_set_running; then
  echo "==> using the test emulators already running (project ${PROJECT_ID}, hub on ${HUB_PORT})"
  # The Functions emulator reloads lib/ on its own; give it a moment after a build.
  sleep 2
  exec "$@"
fi

echo "==> starting the test emulators (project ${PROJECT_ID}: Auth ${AUTH_PORT}, Firestore ${FIRESTORE_PORT}, Functions ${FUNCTIONS_PORT})"
caller_dir="$(pwd)"
# The CLI writes its logs to its working folder; keep them out of the dev set's way.
mkdir -p "${TEST_LOG_DIR}"
cd "${TEST_LOG_DIR}"
# emulators:exec runs the command through a shell (from the CLI's folder), so quote
# each word and go back to the caller's folder first. It exits with the command's status.
printf -v cmd '%q ' "$@"
exec "${FIREBASE[@]}" emulators:exec --config "${EMULATOR_CONFIG}" --project "${PROJECT_ID}" \
  --only auth,firestore,functions "cd $(printf '%q' "${caller_dir}") && ${cmd}"
