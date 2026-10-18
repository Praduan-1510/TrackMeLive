#!/bin/bash
# Until Xcode: type-checks the TrackMeLiveFirebase sources (code/ios/Firebase) against signature stubs
# of the Firebase Apple SDK 12.19.2 (scripts/firebase-stubs), then the app with that module importable,
# which compiles AppDependencies' `-backend emulator` path. Same Mac Catalyst stand-in as typecheck.sh.
# It proves Swift 6 isolation and our calls against those signatures, not the SDK itself; once Xcode
# builds the TrackMeLiveFirebase scheme, delete this script and the stubs.
#
# Usage: scripts/typecheck-firebase.sh
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STUBS="$IOS_DIR/scripts/firebase-stubs"
SDK="$(xcrun --sdk macosx --show-sdk-path)"
TARGET="arm64e-apple-ios26.0-macabi"
CATALYST="$SDK/System/iOSSupport"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# ActivityKit and WidgetKit, minus their `@available(macCatalyst, unavailable)` lines (see typecheck.sh).
mkdir -p "$OUT/patched"
for fw in ActivityKit WidgetKit; do
  src="$(find -L "$SDK/System/Library/Frameworks/$fw.framework" "$CATALYST/System/Library/Frameworks/$fw.framework" \
    -path "*/Modules/$fw.swiftmodule/arm64e-apple-ios-macabi.swiftinterface" 2>/dev/null | head -1)"
  [[ -n "$src" ]] || { echo "error: no Catalyst interface for $fw in $SDK" >&2; exit 1; }
  mkdir -p "$OUT/patched/$fw.swiftmodule"
  grep -v -E '^[[:space:]]*@available\(macCatalyst, unavailable\)[[:space:]]*$' "$src" > "$OUT/patched/$fw.swiftmodule/arm64e-apple-ios-macabi.swiftinterface"
done

common=(-sdk "$SDK" -target "$TARGET" -parse-as-library -module-cache-path "$OUT/module-cache"
  -I "$OUT" -I "$OUT/patched" -Fsystem "$CATALYST/System/Library/Frameworks" -I "$CATALYST/usr/lib/swift" -L "$CATALYST/usr/lib")

echo "Firebase stubs…"
for module in FirebaseCore FirebaseAuth FirebaseFirestore FirebaseFunctions FirebaseMessaging; do
  swiftc "${common[@]}" -swift-version 5 -module-name "$module" -emit-module -emit-module-path "$OUT/$module.swiftmodule" "$STUBS/$module.swift"
done

echo "TMLCore…"
printf 'import Foundation\nextension Foundation.Bundle { static var module: Bundle { .main } }\n' > "$OUT/BundleModule.swift"
core_sources=()
while IFS= read -r -d '' f; do core_sources+=("$f"); done < <(find -L "$IOS_DIR/Packages/TMLCore/Sources/TMLCore" -name '*.swift' -print0)
swiftc "${common[@]}" -swift-version 6 -module-name TMLCore -emit-module -emit-module-path "$OUT/TMLCore.swiftmodule" \
  "${core_sources[@]}" "$OUT/BundleModule.swift"

echo "TrackMeLiveFirebase…"
firebase_sources=()
while IFS= read -r -d '' f; do firebase_sources+=("$f"); done < <(find "$IOS_DIR/Firebase" -name '*.swift' -print0)
swiftc "${common[@]}" -swift-version 6 -D DEBUG -module-name TrackMeLiveFirebase -emit-module \
  -emit-module-path "$OUT/TrackMeLiveFirebase.swiftmodule" "${firebase_sources[@]}"

echo "App target with TrackMeLiveFirebase…"
# As typecheck.sh: previews cut off, `@State` spelled as the property-wrapper type.
mkdir -p "$OUT/app"
while IFS= read -r -d '' f; do
  awk '/^#Preview/ { exit } { print }' "$f" | sed 's/@State /@_TypecheckState /g' > "$OUT/app/$(basename "$f")"
done < <(find "$IOS_DIR/TrackMeLive" "$IOS_DIR/Shared" -name '*.swift' -print0)
printf 'import SwiftUI\ntypealias _TypecheckState<Value> = SwiftUI.State<Value>\n' > "$OUT/app/_TypecheckShims.swift"
swiftc "${common[@]}" -swift-version 6 -D DEBUG -typecheck "$OUT"/app/*.swift

echo "Firebase type-check passed (against the 12.19.2 signature stubs)."
