#!/usr/bin/env bash
# Build Track Me Live, install it on the running emulator (starting Pixel_9 if none is running) and launch it.
#
#   ./run.sh                    build, install, launch
#   ./run.sh --screenshot FILE  ...then save a PNG of the screen to FILE
#
# Needs JDK 17 and the Android SDK (see README.md). Override with JAVA_HOME, ANDROID_HOME, AVD or ANDROID_SERIAL.
set -euo pipefail

cd "$(dirname "$0")"

APP_ID="live.trackme.app"
ACTIVITY="$APP_ID/.MainActivity"
AVD="${AVD:-Pixel_9}"
SHOT=""
if [[ "${1:-}" == "--screenshot" ]]; then
  SHOT="${2:?--screenshot needs a file path}"
fi

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf 'run.sh: %s\n' "$*" >&2; exit 1; }

# ---- JDK 17 and the SDK ----
if [[ -z "${JAVA_HOME:-}" || ! -x "${JAVA_HOME}/bin/java" ]] || ! "${JAVA_HOME}/bin/java" -version 2>&1 | grep -q '"17\.'; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)" || die "JDK 17 not found. Install Temurin 17 (README.md)."
fi
export JAVA_HOME
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
[[ -x "$ADB" ]] || die "adb not found in $ANDROID_HOME/platform-tools. Install the SDK (README.md)."
[[ -f local.properties ]] || echo "sdk.dir=$ANDROID_HOME" > local.properties
# Some sandboxed shells break Java's TLS on dual-stack sockets; IPv4 avoids it and is harmless elsewhere.
export GRADLE_OPTS="${GRADLE_OPTS:--Djava.net.preferIPv4Stack=true}"

# ---- A device: the running emulator, or boot one with a window ----
online_emulator() { "$ADB" devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1; exit }'; }

"$ADB" start-server >/dev/null 2>&1 || true
SERIAL="${ANDROID_SERIAL:-$(online_emulator)}"
if [[ -z "$SERIAL" ]]; then
  [[ -x "$EMULATOR" ]] || die "emulator not found in $ANDROID_HOME/emulator."
  "$EMULATOR" -list-avds | grep -qx "$AVD" || die "No AVD named $AVD. Create it (README.md)."
  say "Starting the $AVD emulator"
  LOG="${TMPDIR:-/tmp}/trackmelive-emulator-$AVD.log"
  # Cold boot with no snapshot saved: snapshots cost about 2 GB of disk.
  nohup "$EMULATOR" -avd "$AVD" -no-snapshot -no-boot-anim >"$LOG" 2>&1 &
  disown || true
  for _ in $(seq 1 60); do
    SERIAL="$(online_emulator)"
    [[ -n "$SERIAL" ]] && break
    sleep 2
  done
  [[ -n "$SERIAL" ]] || die "The emulator didn't come online. Log: $LOG"
fi
export ANDROID_SERIAL="$SERIAL"

say "Waiting for $SERIAL to finish booting"
for _ in $(seq 1 120); do
  [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] && break
  sleep 2
done
[[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] || die "$SERIAL didn't finish booting."

# ---- Build and install (one Gradle build), then launch ----
say "Building and installing the debug app"
./gradlew --console=plain --quiet installDebug

say "Launching $APP_ID on $SERIAL"
"$ADB" shell am force-stop "$APP_ID"
"$ADB" shell am start -W -n "$ACTIVITY" >/dev/null

if [[ -n "$SHOT" ]]; then
  sleep 2
  mkdir -p "$(dirname "$SHOT")"
  "$ADB" exec-out screencap -p >"$SHOT"
  say "Screenshot: $SHOT"
fi
say "Done"
