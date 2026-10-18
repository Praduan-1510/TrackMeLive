#!/usr/bin/env bash
# Lints and builds the functions, type-checks the tests, then runs the rules and
# function tests against the emulators. If ./run.sh already has the emulators up,
# the tests use them; otherwise `firebase emulators:exec` starts Auth, Firestore
# and Functions just for this run and stops them afterwards.
# Pass a test file to run only that one: ./test.sh src/rules.test.ts
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/env.sh"
cd "${BACKEND_DIR}"

ensure_deps "${BACKEND_DIR}/tests"
build_functions
echo "==> lint functions"
npm --prefix functions run --silent lint
echo "==> type-check tests"
npm --prefix tests run --silent typecheck

if [[ $# -gt 0 ]]; then
  test_cmd=(node --test --test-concurrency=1 --disable-warning=ExperimentalWarning "$@")
else
  test_cmd=(npm run --silent test)
fi

emulators_running() {
  local list
  list="$(curl -fsS "http://127.0.0.1:${HUB_PORT}/emulators" 2>/dev/null)" || return 1
  [[ "${list}" == *'"auth"'* && "${list}" == *'"firestore"'* && "${list}" == *'"functions"'* ]]
}

if emulators_running; then
  echo "==> using the emulators already running (hub on ${HUB_PORT})"
  export GCLOUD_PROJECT="${PROJECT_ID}"
  export FIRESTORE_EMULATOR_HOST="127.0.0.1:${FIRESTORE_PORT}"
  export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:${AUTH_PORT}"
  export FUNCTIONS_EMULATOR_HOST="127.0.0.1:${FUNCTIONS_PORT}"
  # The Functions emulator reloads lib/ on its own; give it a moment after the build.
  sleep 2
  cd tests && exec "${test_cmd[@]}"
fi

echo "==> starting Auth, Firestore and Functions emulators for this run"
# emulators:exec runs the command through a shell, so quote each word.
printf -v cmd '%q ' "${test_cmd[@]}"
exec "${FIREBASE[@]}" emulators:exec --project "${PROJECT_ID}" --only auth,firestore,functions \
  "cd $(printf '%q' "${BACKEND_DIR}/tests") && ${cmd}"
