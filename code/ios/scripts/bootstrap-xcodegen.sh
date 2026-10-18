#!/bin/bash
# Downloads the pinned XcodeGen release into code/ios/tools/xcodegen and checks its SHA-256
# against the digest GitHub publishes for the release asset. XcodeGen runs without Xcode
# (only the Command Line Tools), so this works before Xcode is installed.
#
# Usage: scripts/bootstrap-xcodegen.sh        (no-op when the pinned version is already there)
set -euo pipefail

VERSION="2.46.0"   # published 2026-07-16
SHA256="4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806"
URL="https://github.com/yonaskolb/XcodeGen/releases/download/${VERSION}/xcodegen.zip"

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$IOS_DIR/tools"
BIN="$TOOLS/xcodegen/bin/xcodegen"

if [[ -x "$BIN" ]] && [[ "$("$BIN" --version 2>/dev/null)" == "Version: $VERSION" ]]; then
  exit 0
fi

# Never let a download take the disk below 6 GB free.
free_kb=$(df -k / | awk 'NR==2 {print $4}')
if (( free_kb < 6 * 1024 * 1024 + 20 * 1024 )); then
  echo "error: less than 6 GB would be left on / after downloading XcodeGen. Free some space first." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading XcodeGen $VERSION…"
curl -fsSL -o "$tmp/xcodegen.zip" "$URL"
echo "$SHA256  $tmp/xcodegen.zip" | shasum -a 256 -c - >/dev/null || {
  echo "error: XcodeGen checksum mismatch; not installing it." >&2
  exit 1
}
mkdir -p "$TOOLS"
rm -rf "$TOOLS/xcodegen"
unzip -q "$tmp/xcodegen.zip" -d "$TOOLS"
echo "XcodeGen $("$BIN" --version | sed 's/Version: //') is in tools/xcodegen (checksum OK)."
