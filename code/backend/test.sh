#!/usr/bin/env bash
# Lints and builds the functions, type-checks the tests, then runs the rules and
# function tests against the test emulator set through scripts/with-test-emulators.sh:
# project demo-trackmelive-test on its own ports (firebase.test.json, scripts/env.sh).
# It never uses the dev set that ./run.sh serves to the apps, so it can run while
# that one is up, and the tests' wipes never reach the dev data. If ./run.sh --test
# has the test set up, the tests use it; otherwise `firebase emulators:exec` starts
# Auth, Firestore and Functions just for this run and stops them afterwards.
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

# scripts/with-test-emulators.sh takes the firebase lock (unless check-all holds it),
# reuses or starts the test set, and exports its hosts and project to the tests.
cd tests
exec "${BACKEND_DIR}/scripts/with-test-emulators.sh" "${test_cmd[@]}"
