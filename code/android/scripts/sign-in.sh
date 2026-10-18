#!/usr/bin/env bash
# Drives the installed debug app on the running emulator from a fresh start to Home: onboarding (Skip),
# sign-up with a test number on the Firebase Auth emulator, the code read from the emulator's REST API,
# the first mascot pick (Continue), then Home. Needs the Firebase emulators (code/backend/run.sh).
#
#   code/android/scripts/sign-in.sh                 # fresh install state, name Alex, a random 650 555 01xx number
#   code/android/scripts/sign-in.sh --name Mia --number 6505550123 --keep
#
# --keep skips `pm clear`, for an app already on the sign-up screen. Run it under the emulator lock:
#   code/scripts/with-lock.sh emulator code/android/scripts/sign-in.sh
set -euo pipefail

APP_ID="live.trackme.app"
NAME="Alex"
NUMBER="650555$(printf '%04d' $((RANDOM % 10000)))"
CLEAR=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --number) NUMBER="$2"; shift 2 ;;
    --keep) CLEAR=0; shift ;;
    *) echo "sign-in.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
AUTH="http://127.0.0.1:9099/emulator/v1/projects/demo-trackmelive"
DUMP="${TMPDIR:-/tmp}/tml-ui.xml"

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf 'sign-in.sh: %s\n' "$*" >&2; exit 1; }

curl -s -m 3 -o /dev/null "$AUTH/verificationCodes" || die "The Auth emulator isn't running. Start code/backend/run.sh."

# Center of the first on-screen node whose text or content-desc is exactly $1 (uiautomator dump).
center_of() {
  "$ADB" exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped to.*//' >"$DUMP"
  python3 -I - "$DUMP" "$1" <<'PY'
import re, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for n in root.iter("node"):
    if sys.argv[2] in (n.get("text"), n.get("content-desc")):
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds")))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
PY
}

# Waits up to 15 s for $1 to show, then taps it.
tap() {
  for _ in $(seq 1 30); do
    local xy
    xy="$(center_of "$1")"
    if [[ -n "$xy" ]]; then
      # shellcheck disable=SC2086
      "$ADB" shell input tap $xy
      return 0
    fi
    sleep 0.5
  done
  die "\"$1\" never showed up."
}

if [[ $CLEAR == 1 ]]; then
  say "Clearing the app's data"
  "$ADB" shell pm clear "$APP_ID" >/dev/null
fi
"$ADB" shell am start -W -n "$APP_ID/.MainActivity" >/dev/null

if [[ $CLEAR == 1 ]]; then
  say "Onboarding: Skip"
  tap "Skip"
fi

say "Sign-up: $NAME, +1 $NUMBER"
tap "Name"
"$ADB" shell input text "$NAME"
tap "Mobile number"
"$ADB" shell input text "$NUMBER"
tap "Send code" # pinned above the keyboard

say "Reading the code from the Auth emulator"
CODE=""
for _ in $(seq 1 20); do
  CODE="$(curl -s "$AUTH/verificationCodes" | python3 -I -c '
import json, sys
codes = [c for c in json.load(sys.stdin).get("verificationCodes", []) if c.get("phoneNumber") == sys.argv[1]]
print(codes[-1]["code"] if codes else "")' "+1$NUMBER")"
  [[ -n "$CODE" ]] && break
  sleep 0.5
done
[[ -n "$CODE" ]] || die "No code for +1$NUMBER."
tap "6-digit code"
"$ADB" shell input text "$CODE"

say "Mascot: Continue"
tap "Continue"
center_of "Home" >/dev/null
say "Done: Home, signed in as +1$NUMBER"
