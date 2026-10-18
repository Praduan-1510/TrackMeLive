#!/bin/bash
# A pre-Xcode smoke check: type-checks the app and widget sources with only the Command Line Tools.
#
# The CLT have no iOS SDK, but the macOS SDK carries Mac Catalyst's iOS frameworks (UIKit,
# SwiftUI, ActivityKit, WidgetKit), so the sources are checked for arm64-apple-ios26.0-macabi,
# where `#if os(iOS)` is true. This catches Swift errors (types, Swift 6 concurrency, API shape);
# it does not prove the iOS build, which only Xcode's iOS SDK can. Once Xcode is installed,
# run.sh is the real check.
#
# Usage: scripts/typecheck.sh
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
# arm64e, because that's the slice the SDK's Catalyst interfaces are written for.
TARGET="arm64e-apple-ios26.0-macabi"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

CATALYST="$SDK/System/iOSSupport"

# Live Activities exist only on iOS: ActivityKit and WidgetKit mark them unavailable on Catalyst.
# Shadow those two modules with copies of their Catalyst interfaces minus exactly those
# `@available(macCatalyst, unavailable)` lines, so the Live Activity code is checked too.
# Nothing else in the interfaces changes.
mkdir -p "$OUT/patched"
for fw in ActivityKit WidgetKit; do
  src="$(find -L "$SDK/System/Library/Frameworks/$fw.framework" "$CATALYST/System/Library/Frameworks/$fw.framework" \
    -path "*/Modules/$fw.swiftmodule/arm64e-apple-ios-macabi.swiftinterface" 2>/dev/null | head -1)"
  [[ -n "$src" ]] || { echo "error: no Catalyst interface for $fw in $SDK" >&2; exit 1; }
  mkdir -p "$OUT/patched/$fw.swiftmodule"
  grep -v -E '^[[:space:]]*@available\(macCatalyst, unavailable\)[[:space:]]*$' "$src" > "$OUT/patched/$fw.swiftmodule/arm64e-apple-ios-macabi.swiftinterface"
done

common=(-sdk "$SDK" -target "$TARGET" -swift-version 6 -parse-as-library
  -module-cache-path "$OUT/module-cache" -I "$OUT/patched"
  -Fsystem "$CATALYST/System/Library/Frameworks" -I "$CATALYST/usr/lib/swift" -L "$CATALYST/usr/lib")

# TMLCore as a module. SwiftPM normally generates `Bundle.module`; stand in for it here.
cat > "$OUT/BundleModule.swift" <<'EOF'
import Foundation
extension Foundation.Bundle { static var module: Bundle { .main } }
EOF
core_sources=()
while IFS= read -r -d '' f; do core_sources+=("$f"); done < <(find -L "$IOS_DIR/Packages/TMLCore/Sources/TMLCore" -name '*.swift' -print0)

echo "TMLCore (${#core_sources[@]} files)…"
swiftc "${common[@]}" -module-name TMLCore -emit-module -emit-module-path "$OUT/TMLCore.swiftmodule" \
  "${core_sources[@]}" "$OUT/BundleModule.swift"

# Xcode-only macro plugins: `#Preview` (PreviewsMacros) and, in the iOS 27 / macOS 27 SDKs,
# SwiftUI's `@State` (SwiftUIMacros). The CLT ship neither, so check copies of the sources with the
# previews cut off (each file's previews sit at its end) and `@State` spelled as the `State`
# property-wrapper type it has always been.
strip_previews() { # <src-dir> <dst-dir>
  mkdir -p "$2"
  while IFS= read -r -d '' f; do
    awk '/^#Preview/ { exit } { print }' "$f" | sed 's/@State /@_TypecheckState /g' > "$2/$(basename "$f")"
  done < <(find "$1" -name '*.swift' -print0)
  printf 'import SwiftUI\ntypealias _TypecheckState<Value> = SwiftUI.State<Value>\n' > "$2/_TypecheckShims.swift"
}

echo "App target…"
strip_previews "$IOS_DIR/TrackMeLive" "$OUT/app"
strip_previews "$IOS_DIR/Shared" "$OUT/app-shared"
swiftc "${common[@]}" -typecheck -I "$OUT" "$OUT"/app/*.swift $(ls "$OUT"/app-shared/*.swift | grep -v _TypecheckShims)

echo "Widget extension…"
strip_previews "$IOS_DIR/TrackMeLiveWidgets" "$OUT/widgets"
strip_previews "$IOS_DIR/Shared" "$OUT/widgets-shared"
swiftc "${common[@]}" -typecheck -application-extension -I "$OUT" "$OUT"/widgets/*.swift $(ls "$OUT"/widgets-shared/*.swift | grep -v _TypecheckShims)

echo "Type-check passed (Mac Catalyst stand-in for iOS)."
