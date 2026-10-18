#!/usr/bin/env bash
# Runs an iOS check on a private snapshot of the files it reads, so the iOS agents can keep editing
# and building while the gate compiles: a file saved mid-build can't break the gate's compile, and
# the gate's builds (and test-core.sh's clean rebuilds) never touch Packages/TMLCore/.build.
#
#   code/qa/ios-snapshot.sh <command> [args...]
#
# The snapshot keeps the repo's layout, so TMLCore's relative symlinks into code/shared and the
# tests' paths to the design sources still resolve: code/ios (without build output or the generated
# Xcode project), code/shared, design-system, mascots/model and prototype/js. It lives in
# $TML_SNAPSHOT_DIR (default: $TMPDIR/tml-check-all-snapshot) and keeps its own build folders
# between runs, so builds stay incremental. The command runs in the snapshot's code/ios, with
# TML_IOS_DIR pointing there. In GitHub Actions the checkout is quiet, so it runs in place.
# code/check-all.sh holds the qa-ios lock around this, so two gate runs never share a snapshot.
set -euo pipefail

[[ $# -gt 0 ]] || { echo "usage: $0 <command> [args...]" >&2; exit 2; }

QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "${QA_DIR}/../.." && pwd -P)"

if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  export TML_IOS_DIR="${REPO}/code/ios"
  cd "${TML_IOS_DIR}"
  exec "$@"
fi

snap="${TML_SNAPSHOT_DIR:-${TMPDIR:-/tmp}/tml-check-all-snapshot}"
snap="${snap%/}"
mkdir -p "${snap}/code" "${snap}/mascots" "${snap}/prototype"
# Excluded paths are build output; --delete leaves the snapshot's own copies of them alone.
rsync -a --delete --exclude '/build/' --exclude '*.xcodeproj/' --exclude '.build/' --exclude '.swiftpm/' \
  "${REPO}/code/ios/" "${snap}/code/ios/"
rsync -a --delete "${REPO}/code/shared/" "${snap}/code/shared/"
rsync -a --delete "${REPO}/design-system/" "${snap}/design-system/"
rsync -a --delete "${REPO}/mascots/model/" "${snap}/mascots/model/"
rsync -a --delete "${REPO}/prototype/js/" "${snap}/prototype/js/"
echo "ios-snapshot: checking a snapshot taken $(date '+%H:%M:%S') in ${snap}"

export TML_IOS_DIR="${snap}/code/ios"
cd "${TML_IOS_DIR}"
exec "$@"
