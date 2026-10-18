#!/bin/bash
# Runs TMLCore's tests (Swift Testing) with `swift test`. Works with only the Command Line Tools.
#
# Works around a quirk of the CLT 6.4 `swiftbuild` backend: after a source change, the incremental
# test build can lose Swift Testing's macro plugin ("plugin for module 'TestingMacros' not
# found"). When that happens, this rebuilds from clean once and runs the tests again.
# (`--build-system native` can't find the Testing module at all with the CLT.)
#
# Usage: scripts/test-core.sh [swift test options]
set -uo pipefail
cd "$(dirname "$0")/../Packages/TMLCore"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

rm -rf .build/out/XCBuildData
swift test "$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if (( status != 0 )) && grep -q "plugin for module 'TestingMacros' not found" "$log"; then
  echo
  echo "Swift Testing's macro plugin went missing from the incremental build (a CLT swiftbuild quirk). Rebuilding from clean…"
  rm -rf .build
  swift test "$@"
  status=$?
fi
exit "$status"
