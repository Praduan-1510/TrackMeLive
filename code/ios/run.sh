#!/bin/bash
# Track Me Live for iOS: generate the Xcode project, build for the iOS Simulator, boot an
# iPhone 17 Pro if no simulator is booted, then install, launch and take a screenshot.
#
# Usage: ./run.sh [--fresh] [--dark] [--device "iPhone 17 Pro"] [--no-launch]
#   --fresh      uninstall first, so the app starts at onboarding
#   --dark       switch the simulator to dark appearance before the screenshot
#   --device     simulator model when none is booted (default: iPhone 17 Pro; or $TML_SIM_DEVICE)
#   --no-launch  generate and build only
#
# Needs Xcode 26 or later (Xcode 27 expected) with the iOS Simulator platform installed.
# Once Xcode is installed, the MobileBuildMCP server (already configured) can do the same
# build/install/launch/screenshot loop from an agent session, using TrackMeLive.xcodeproj and
# the TrackMeLive scheme that this script generates.
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$IOS_DIR"

DEVICE_NAME="${TML_SIM_DEVICE:-iPhone 17 Pro}"
FRESH=0 DARK=0 LAUNCH=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fresh) FRESH=1 ;;
    --dark) DARK=1 ;;
    --device) DEVICE_NAME="$2"; shift ;;
    --no-launch) LAUNCH=0 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see ./run.sh --help)" >&2; exit 2 ;;
  esac
  shift
done

SCHEME="TrackMeLive"
BUNDLE_ID="live.trackme.app"
BUILD="$IOS_DIR/build"
DERIVED="$BUILD/DerivedData"
LOGS="$BUILD/logs"
SHOTS="$BUILD/screenshots"
mkdir -p "$LOGS" "$SHOTS"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------
# 1. Xcode. Use the selected developer directory if it's a full Xcode; otherwise the newest
#    /Applications/Xcode*.app through DEVELOPER_DIR, so no `sudo xcode-select` is needed.
# ---------------------------------------------------------------------------------------------
dev_dir="$(xcode-select -p 2>/dev/null || true)"
if [[ "$dev_dir" != *".app/Contents/Developer" ]]; then
  xcode_app="$(ls -d /Applications/Xcode*.app 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -z "$xcode_app" ]]; then
    die "Xcode isn't installed, so the iOS app can't be built yet.

Only the Command Line Tools are here ($dev_dir). They have no iOS SDK or Simulator.
  1. Install Xcode 27 (App Store or developer.apple.com), then open it once.
  2. Run: sudo xcodebuild -license accept && xcodebuild -runFirstLaunch
  3. If the iOS Simulator wasn't installed with Xcode: xcodebuild -downloadPlatform iOS
  4. Run ./run.sh again.

Until then:
  scripts/test-core.sh   builds TMLCore and runs its tests (swift test)
  scripts/typecheck.sh   type-checks the app and widget sources (Mac Catalyst stand-in)"
  fi
  export DEVELOPER_DIR="$xcode_app/Contents/Developer"
  echo "Using $xcode_app (xcode-select points at $dev_dir; set it with: sudo xcode-select -s \"$DEVELOPER_DIR\")"
fi

if ! xcode_version="$(xcodebuild -version 2>&1)"; then
  die "xcodebuild can't run yet:
$xcode_version

Finish Xcode's setup, then run ./run.sh again:
  sudo xcodebuild -license accept && xcodebuild -runFirstLaunch"
fi
echo "$xcode_version" | head -2
xcode_major="$(echo "$xcode_version" | awk '/^Xcode/ {split($2, v, "."); print v[1]}')"
(( xcode_major >= 26 )) || die "Xcode $xcode_major is too old: Track Me Live needs the iOS 26 SDK (Xcode 26 or later)."

if ! xcodebuild -showsdks 2>/dev/null | grep -q iphonesimulator; then
  die "Xcode has no iOS Simulator SDK. Install it with: xcodebuild -downloadPlatform iOS (several GB; keep 6 GB free)."
fi

# ---------------------------------------------------------------------------------------------
# 2. The Xcode project, generated from project.yml (XcodeGen, downloaded and checksum-verified).
# ---------------------------------------------------------------------------------------------
say "Generating TrackMeLive.xcodeproj"
"$IOS_DIR/scripts/bootstrap-xcodegen.sh"
if [[ ! -f "$IOS_DIR/TrackMeLive/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png" ]]; then
  "$IOS_DIR/scripts/export-assets.sh"
fi
"$IOS_DIR/tools/xcodegen/bin/xcodegen" generate --spec "$IOS_DIR/project.yml" --quiet

# ---------------------------------------------------------------------------------------------
# 3. A simulator: the booted one, else an iPhone 17 Pro on the newest iOS runtime (created if
#    there isn't one), booted and shown in Simulator.app.
# ---------------------------------------------------------------------------------------------
say "Choosing a simulator"
sim_json="$(xcrun simctl list devices available --json)"
udid="$(python3 -I -c '
import json, sys
devices = json.loads(sys.argv[1])["devices"]
booted = [d for rt, ds in devices.items() if "iOS" in rt for d in ds if d["state"] == "Booted"]
iphones = [d for d in booted if d["name"].startswith("iPhone")]
pick = (iphones or booted)
print(pick[0]["udid"] if pick else "")
' "$sim_json")"

if [[ -n "$udid" ]]; then
  echo "Using the booted simulator $udid."
else
  runtime="$(xcrun simctl list runtimes available --json | python3 -I -c '
import json, sys
rts = [r for r in json.load(sys.stdin)["runtimes"] if r.get("platform") == "iOS" and r.get("isAvailable")]
rts.sort(key=lambda r: [int(x) for x in r["version"].split(".")])
print(rts[-1]["identifier"] if rts else "")
')"
  [[ -n "$runtime" ]] || die "No iOS Simulator runtime is installed. Install one with: xcodebuild -downloadPlatform iOS"

  udid="$(python3 -I -c '
import json, sys
devices, name, runtime = json.loads(sys.argv[1])["devices"], sys.argv[2], sys.argv[3]
match = [d for d in devices.get(runtime, []) if d["name"] == name]
print(match[0]["udid"] if match else "")
' "$sim_json" "$DEVICE_NAME" "$runtime")"

  if [[ -z "$udid" ]]; then
    type_id="$(xcrun simctl list devicetypes --json | python3 -I -c '
import json, sys
name = sys.argv[1]
types = json.load(sys.stdin)["devicetypes"]
exact = [t for t in types if t["name"] == name]
pros = [t for t in types if t["name"].startswith("iPhone") and t["name"].endswith(" Pro")]
pick = exact or pros[-1:]
print(pick[0]["identifier"] + "\t" + pick[0]["name"] if pick else "")
' "$DEVICE_NAME")"
    [[ -n "$type_id" ]] || die "This Xcode has no iPhone simulator model named \"$DEVICE_NAME\"."
    model_name="${type_id#*$'\t'}"
    [[ "$model_name" == "$DEVICE_NAME" ]] || echo "No \"$DEVICE_NAME\" model in this Xcode; using \"$model_name\"."
    udid="$(xcrun simctl create "$model_name" "${type_id%%$'\t'*}" "$runtime")"
    echo "Created $model_name ($udid) on $runtime."
  fi
  echo "Booting $DEVICE_NAME ($udid)…"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
fi
open -a Simulator --args -CurrentDeviceUDID "$udid" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------------------------
# 4. Build. Simulator builds are signed "to run locally" (no team or profile), which still
#    embeds the entitlements (App Groups, Push). If that's refused, build unsigned: the app
#    runs, but the App Group container is unavailable (TMLCore.sharedDefaults falls back).
# ---------------------------------------------------------------------------------------------
say "Building $SCHEME for the iOS Simulator"
build() { # extra build settings...
  xcodebuild -project "$IOS_DIR/TrackMeLive.xcodeproj" -scheme "$SCHEME" -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$DERIVED" \
    "$@" build > "$LOGS/xcodebuild.log" 2>&1
}
if build CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=; then
  echo "Build succeeded (signed to run locally)."
elif grep -q -i -E "sign|provision|entitlement" "$LOGS/xcodebuild.log"; then
  cp "$LOGS/xcodebuild.log" "$LOGS/xcodebuild-signed.log"
  echo "Local signing failed (see build/logs/xcodebuild-signed.log); building without signing…"
  build CODE_SIGNING_ALLOWED=NO || { grep -E "error:|BUILD FAILED" "$LOGS/xcodebuild.log" | head -40; die "Build failed. Full log: build/logs/xcodebuild.log"; }
  echo "Build succeeded (unsigned: App Groups and Push entitlements aren't applied)."
else
  grep -E "error:|BUILD FAILED" "$LOGS/xcodebuild.log" | head -40
  die "Build failed. Full log: build/logs/xcodebuild.log"
fi
warnings="$(grep -c "warning:" "$LOGS/xcodebuild.log" || true)"
echo "$warnings warning lines in build/logs/xcodebuild.log"

APP="$DERIVED/Build/Products/Debug-iphonesimulator/TrackMeLive.app"
[[ -d "$APP" ]] || die "Built app not found at $APP"
[[ -d "$APP/PlugIns/TrackMeLiveWidgets.appex" ]] || echo "Warning: the widget extension isn't embedded in the app."
(( LAUNCH )) || { echo "Built $APP"; exit 0; }

# ---------------------------------------------------------------------------------------------
# 5. Install, launch, screenshot.
# ---------------------------------------------------------------------------------------------
say "Installing and launching"
if (( FRESH )); then xcrun simctl uninstall "$udid" "$BUNDLE_ID" 2>/dev/null || true; fi
xcrun simctl ui "$udid" appearance "$( (( DARK )) && echo dark || echo light )" 2>/dev/null || true
xcrun simctl install "$udid" "$APP"
xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID"
sleep 4
shot="$SHOTS/$(date +%Y%m%d-%H%M%S)-$( (( DARK )) && echo dark || echo light ).png"
xcrun simctl io "$udid" screenshot "$shot" >/dev/null
echo "Screenshot: $shot"

cat <<EOF

Track Me Live is running on simulator $udid.
  Deep links:  xcrun simctl openurl $udid trackmelive://share
  Logs:        xcrun simctl spawn $udid log stream --predicate 'subsystem BEGINSWITH "live.trackme"'
  Tests:       xcodebuild test -project TrackMeLive.xcodeproj -scheme $SCHEME -destination "platform=iOS Simulator,id=$udid"
EOF
