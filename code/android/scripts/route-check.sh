#!/bin/zsh
# The on-device sharing check: feeds a short walk to the emulator's GPS (`adb emu geo fix`, once a
# second) while SharingRouteTest shares from the real app against the Firebase emulators, and checks
# that the pings land in the dev Firestore, spaced and in order, and stop at Stop.
#
#   code/scripts/with-lock.sh emulator code/android/scripts/route-check.sh
#
# Needs the Pixel_9 emulator and the Firebase emulators running (code/backend/run.sh). It installs the
# debug app and its test APK (under the gradle lock) without uninstalling anything afterwards. The test
# signs in a new account and deletes it at the end, so the app is left at onboarding.
set -euo pipefail
here=${0:A:h}
android_dir=${here:h}
lock=${android_dir:h}/scripts/with-lock.sh
export JAVA_HOME=${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}
sdk=${ANDROID_HOME:-$HOME/Library/Android/sdk}
adb=$sdk/platform-tools/adb
serial=${ANDROID_SERIAL:-emulator-5554}

"$adb" -s "$serial" get-state >/dev/null
(cd "$android_dir" && "$lock" gradle ./gradlew --offline -q :app:installDebug :app:installDebugAndroidTest)

# Location on, for the fused provider.
"$adb" -s "$serial" shell settings put secure location_mode 3 >/dev/null 2>&1 || true

# A walk north-east from the prototype's harbor, about 2.5 m a second, until the test ends.
feed() {
  local i=0 lat lng
  while true; do
    lat=$(printf '%.6f' $(( 37.8044 + i * 0.00002 )))
    lng=$(printf '%.6f' $(( -122.2712 + i * 0.00001 )))
    "$adb" -s "$serial" emu geo fix "$lng" "$lat" >/dev/null 2>&1 || true
    sleep 1
    i=$(( i + 1 ))
  done
}
feed &
feeder=$!
trap 'kill $feeder 2>/dev/null || true' EXIT INT TERM
sleep 3

out=$("$adb" -s "$serial" shell am instrument -w -r -e route true \
  -e class live.trackme.app.SharingRouteTest \
  live.trackme.app.test/androidx.test.runner.AndroidJUnitRunner)
print -r -- "$out" | grep -E 'INSTRUMENTATION_STATUS: (test|stack)=|OK \(|FAILURES|Tests run|AssumptionViolated' || true
# A skipped test (no emulators) also ends "OK", so a skip is a failure here.
if print -r -- "$out" | grep -q 'AssumptionViolated'; then
  print -r -- "$out" | grep -m1 'AssumptionViolated' || true
  print "route-check: FAIL (skipped: are the Firebase emulators running?)"
  exit 1
elif print -r -- "$out" | grep -q 'OK (1 test)'; then
  print "route-check: PASS (pings from the fed route reached the dev Firestore and stopped at Stop)"
else
  print -r -- "$out" | tail -40
  print "route-check: FAIL"
  exit 1
fi
