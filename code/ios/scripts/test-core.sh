#!/bin/bash
# Runs TMLCore's tests (Swift Testing) with `swift test`. Works with only the Command Line Tools.
#
# Works around a quirk of the CLT 6.4 `swiftbuild` backend: some compile batches of the test target
# come out without Swift Testing's macro plugin ("plugin for module 'TestingMacros' not found"),
# after a source change and sometimes even from clean. Loading the plugin explicitly prevents it.
# If it happens anyway, this rebuilds from clean once and shows only that run's output.
# (`--build-system native` can't find the Testing module at all with the CLT.)
#
# Usage: scripts/test-core.sh [swift test options]
set -uo pipefail
cd "$(dirname "$0")/../Packages/TMLCore" || exit 1

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

# The plugin the build sometimes forgets, next to the toolchain's other macro plugins.
plugin="$(dirname "$(xcrun --find swift)")/../lib/swift/host/plugins/testing/libTestingMacros.dylib"
args=("$@")
[[ -f "$plugin" ]] && args+=(-Xswiftc -load-plugin-library -Xswiftc "$plugin")

rm -rf .build/out/XCBuildData
swift test ${args[@]+"${args[@]}"} > "$log" 2>&1
status=$?
if (( status != 0 )) && grep -q "plugin for module 'TestingMacros' not found" "$log"; then
  # That attempt's output is noise: hundreds of macro errors, plus "no calls to throwing functions
  # occur within 'try'" warnings on `try #require`, because the macros never expanded. Drop it.
  echo "Swift Testing's macro plugin went missing from the incremental build (a CLT swiftbuild quirk). Rebuilding from clean…"
  rm -rf .build
  swift test ${args[@]+"${args[@]}"}
  status=$?
else
  cat "$log"
fi
exit "$status"
