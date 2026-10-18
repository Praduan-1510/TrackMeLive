#!/usr/bin/env bash
# Drives the call-detection spike on a running emulator and saves timestamped evidence.
#
#   scripts/emulator-run.sh [scenario ...]      # default: all scenarios, in order
#
# Needs the spike installed (app/build/outputs/apk/debug/app-debug.apk) and one emulator in
# `adb devices`. Simulated calls go through the emulator console (`adb emu gsm ...`), which feeds
# the emulator's modem, so they travel the real Telephony -> Telecom -> AudioService path.
#
# Output, per scenario, in results/emulator/:
#   <scenario>.host.txt     host-side steps with host timestamps (the emulator clock follows the host)
#   <scenario>.logcat.txt   the spike's own events (tag CallSpike), device timestamps
#   <scenario>.audio.txt    `dumpsys audio` mode history (when AudioService changed the mode)
#
# Incoming calls are answered with `gsm accept`. On a host short of RAM that console command once
# blocked QEMU's main loop long enough for its watchdog to kill the emulator; if that happens, answer
# with `adb shell input keyevent KEYCODE_CALL` instead.
set -u

ADB=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
PKG=live.trackme.spike.calldetect
ACT=$PKG/.MainActivity
NUM=5551234
NUM2=5559876
HERE=$(cd "$(dirname "$0")/.." && pwd)
OUT=${OUT:-$HERE/results/emulator}
mkdir -p "$OUT"

now() { python3 -c 'import datetime; print(datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3])'; }
step() { echo "$(now) HOST  $*" | tee -a "$OUT/$SCEN.host.txt"; }
emu() { step "adb emu $*"; "$ADB" emu "$@" > /dev/null; }
cmd() { step "app cmd $1"; "$ADB" shell am start -n "$ACT" --es cmd "$1" > /dev/null; }
front() { step "bring app to front"; "$ADB" shell am start -n "$ACT" > /dev/null; }
home() { step "press HOME (app to background)"; "$ADB" shell input keyevent KEYCODE_HOME; }
wait_s() { sleep "$1"; }

# The emulator can lag several seconds behind the console under host load, so scenarios wait for
# AudioService's mode instead of fixed delays. Polls every 2 s (faster polling of dumpsys starved
# the emulator once).
mode_now() { "$ADB" shell "dumpsys audio 2>/dev/null | grep -m1 'Actual mode'" 2>/dev/null | sed 's/.*= //' | tr -d '\r'; }
wait_mode() {
  local t=0 limit=${2:-40}
  while [ "$t" -lt "$limit" ]; do
    if [ "$(mode_now)" = "$1" ]; then step "AudioService mode is now $1"; return 0; fi
    sleep 2; t=$((t + 2))
  done
  step "TIMEOUT: mode still $(mode_now), wanted $1"; return 1
}

# Process state as the system sees it: procstate, oom adj and the freezer flag.
proc() {
  local pid line
  pid=$("$ADB" shell pidof "$PKG" | tr -d '\r')
  if [ -z "$pid" ]; then step "process: not running"; return; fi
  line=$("$ADB" shell dumpsys activity processes "$PKG" 2>/dev/null \
    | grep -E 'mCurProcState|curProcState|setAdj|mFrozen|isFrozen|frozen' | tr -s ' ' | tr '\n' ' ' | cut -c1-400)
  step "process: pid=$pid $line"
}

phone_grant() { step "pm grant READ_PHONE_STATE"; "$ADB" shell pm grant "$PKG" android.permission.READ_PHONE_STATE; }
# Revoking a runtime permission kills the app process, like a user turning it off in Settings.
phone_revoke() { step "pm revoke READ_PHONE_STATE"; "$ADB" shell pm revoke "$PKG" android.permission.READ_PHONE_STATE 2>/dev/null; }

begin() {
  SCEN=$1
  : > "$OUT/$SCEN.host.txt"
  # Hang up anything a previous scenario left behind ("KO" replies for no such call are fine).
  "$ADB" emu gsm cancel "$NUM" > /dev/null 2>&1; "$ADB" emu gsm cancel "$NUM2" > /dev/null 2>&1
  sleep 2
  "$ADB" logcat -c
  step "=== $SCEN: $2"
  step "device time $("$ADB" shell date +%H:%M:%S | tr -d '\r')"
}

finish() {
  sleep 1
  # The spike's events plus Telecom's own record of the same moments, all on the device clock:
  # "setCallState" (Telecom call state), "Broadcasted state change" (the device-wide call state
  # that TelephonyCallback and PHONE_STATE receive) and "AudioManager#setMode" (Telecom asking
  # AudioService for a mode).
  "$ADB" logcat -d -v time -s CallSpike:I Telecom:I \
    | grep -E 'CallSpike|setCallState|Broadcasted state change|AudioManager#setMode' \
    | cut -c1-260 > "$OUT/$SCEN.logcat.txt"
  # AudioService's mode history: when the mode actually changed and who owned it.
  "$ADB" shell dumpsys audio 2>/dev/null | grep -E 'setMode\(MODE|selected mode' | tail -30 > "$OUT/$SCEN.audio.txt"
  step "=== end $SCEN"
}

incoming_cycle() {
  emu gsm call "$NUM";   wait_mode MODE_RINGTONE; wait_s 2
  emu gsm accept "$NUM"; wait_mode MODE_IN_CALL;  wait_s 6
  emu gsm cancel "$NUM"; wait_mode MODE_NORMAL;   wait_s 4
}

prepare() {
  "$ADB" logcat -G 8M > /dev/null 2>&1
  "$ADB" shell pm grant "$PKG" android.permission.ACCESS_COARSE_LOCATION
  "$ADB" shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS 2>/dev/null
}

# ---- Scenarios ------------------------------------------------------------------------------
# "front" after an answer models the FSD flow: the call is answered, the dialer's in-call screen
# comes up, and the person switches to Track Me Live.

s1_nophone_foreground() {
  begin s1_nophone_foreground "no Phone permission; call answered, then the app is opened and stays open until the call ends"
  phone_revoke; wait_s 1
  front; wait_s 3; cmd clear; wait_s 1
  emu gsm call "$NUM";   wait_mode MODE_RINGTONE; wait_s 2
  emu gsm accept "$NUM"; wait_mode MODE_IN_CALL;  wait_s 3
  front; wait_s 5
  emu gsm cancel "$NUM"; wait_mode MODE_NORMAL;   wait_s 4
  proc
  finish
}

s2_nophone_background_cached() {
  begin s2_nophone_background_cached "no Phone permission; app left with HOME, no service (it stays the previous app: not cached, not frozen)"
  front; wait_s 2; cmd clear; wait_s 1
  home; wait_s 20
  proc
  incoming_cycle
  proc
  front; wait_s 4
  finish
}

# Leaving with HOME keeps the app as the "previous app" (procstate LAST_ACTIVITY), which isn't
# cached, so it isn't frozen. Opening another app after it pushes it to CACHED_ACTIVITY, and the
# freezer freezes cached apps 10 s later (Android 14+). That's the realistic "I used my phone for
# something else" case.
push_to_cached() {
  home; wait_s 2
  step "open Settings, then HOME again, so the spike is no longer the previous app"
  "$ADB" shell am start -a android.settings.SETTINGS > /dev/null; wait_s 3
  "$ADB" shell input keyevent KEYCODE_HOME
}

s2b_nophone_background_frozen() {
  begin s2b_nophone_background_frozen "no Phone permission; app pushed to cached by another app, no service (frozen)"
  front; wait_s 2; cmd clear; wait_s 1
  push_to_cached; wait_s 25
  proc
  incoming_cycle
  proc
  front; wait_s 4
  finish
}

s5b_phone_background_frozen() {
  begin s5b_phone_background_frozen "Phone granted; app pushed to cached by another app, no service (frozen)"
  front; wait_s 2; cmd clear; wait_s 1
  push_to_cached; wait_s 25
  proc
  incoming_cycle
  proc
  front; wait_s 4
  finish
}

s3_nophone_background_fgs() {
  begin s3_nophone_background_fgs "no Phone permission; app in the background with the location foreground service"
  front; wait_s 2; cmd clear; wait_s 1
  cmd fgs-start; wait_s 2
  home; wait_s 20
  proc
  incoming_cycle
  proc
  front; wait_s 2
  cmd fgs-stop; wait_s 1
  finish
}

s11_missed_call() {
  begin s11_missed_call "no Phone permission; app open; a call rings and is never answered"
  phone_revoke; wait_s 1
  front; wait_s 3; cmd clear; wait_s 1
  emu gsm call "$NUM";   wait_mode MODE_RINGTONE; wait_s 6
  emu gsm cancel "$NUM"; wait_mode MODE_NORMAL;   wait_s 4
  finish
}

s12_open_app_mid_call() {
  begin s12_open_app_mid_call "no Phone permission; the call is already connected when the app is opened from cold"
  phone_revoke; wait_s 1
  "$ADB" shell am force-stop "$PKG"; step "app force-stopped (not running)"
  emu gsm call "$NUM";   wait_mode MODE_RINGTONE; wait_s 2
  emu gsm accept "$NUM"; wait_mode MODE_IN_CALL;  wait_s 3
  front; wait_s 5
  emu gsm cancel "$NUM"; wait_mode MODE_NORMAL;   wait_s 4
  finish
}

s4_phone_foreground() {
  begin s4_phone_foreground "Phone granted; call answered, then the app is opened and stays open"
  phone_grant; wait_s 1
  front; wait_s 3; cmd clear; wait_s 1
  emu gsm call "$NUM";   wait_mode MODE_RINGTONE; wait_s 2
  emu gsm accept "$NUM"; wait_mode MODE_IN_CALL;  wait_s 3
  front; wait_s 5
  emu gsm cancel "$NUM"; wait_mode MODE_NORMAL;   wait_s 4
  finish
}

s5_phone_background_cached() {
  begin s5_phone_background_cached "Phone granted; app left with HOME, no service (stays the previous app, not frozen)"
  front; wait_s 2; cmd clear; wait_s 1
  home; wait_s 20
  proc
  incoming_cycle
  proc
  front; wait_s 4
  finish
}

s6_phone_background_fgs() {
  begin s6_phone_background_fgs "Phone granted; app in the background with the location foreground service"
  front; wait_s 2; cmd clear; wait_s 1
  cmd fgs-start; wait_s 2
  home; wait_s 20
  proc
  incoming_cycle
  proc
  front; wait_s 2
  cmd fgs-stop; wait_s 1
  finish
}

s7_phone_not_running() {
  begin s7_phone_not_running "Phone granted; app process killed (not force-stopped): does the PHONE_STATE receiver start it?"
  front; wait_s 2
  home; wait_s 3
  step "am kill (kills the background process; the app is not put in the stopped state)"
  "$ADB" shell am kill "$PKG"; wait_s 2
  proc
  incoming_cycle
  proc
  finish
}

s8_outgoing() {
  begin s8_outgoing "Phone granted; outgoing call from the dialer; app behind the dialer with the service on"
  front; wait_s 2; cmd clear; wait_s 1
  cmd fgs-start; wait_s 2
  step "dial $NUM with ACTION_CALL"
  "$ADB" shell am start -a android.intent.action.CALL -d "tel:$NUM" > /dev/null
  # The emulator's modem answers outgoing calls by itself after ~2 s, and the console's `gsm list`
  # doesn't show them (so `gsm accept`/`gsm cancel` don't apply): hang up on the device instead.
  wait_mode MODE_IN_CALL; wait_s 8
  step "hang up on the device (KEYCODE_ENDCALL)"
  "$ADB" shell input keyevent KEYCODE_ENDCALL; wait_mode MODE_NORMAL; wait_s 4
  front; wait_s 2
  cmd fgs-stop; wait_s 1
  finish
}

s9_waiting_and_hold() {
  begin s9_waiting_and_hold "Phone granted, service on: call waiting and hold (on the Android 16 emulator the modem never delivered the second call; needs a real phone)"
  front; wait_s 2; cmd clear; wait_s 1
  cmd fgs-start; wait_s 2
  emu gsm call "$NUM";    wait_mode MODE_RINGTONE; wait_s 2
  emu gsm accept "$NUM";  wait_mode MODE_IN_CALL;  wait_s 4
  emu gsm call "$NUM2";   wait_s 6
  emu gsm hold "$NUM";    wait_s 2
  emu gsm accept "$NUM2"; wait_s 6
  emu gsm cancel "$NUM2"; wait_s 8
  step "mode with only the held call left: $(mode_now)"
  emu gsm cancel "$NUM";  wait_mode MODE_NORMAL;   wait_s 4
  front; wait_s 2
  cmd fgs-stop; wait_s 1
  finish
}

s13_screen_off_end() {
  begin s13_screen_off_end "no Phone permission, service on: the screen goes off during the call and the call ends with the screen off"
  phone_revoke; wait_s 1
  front; wait_s 2; cmd clear; wait_s 1
  cmd fgs-start; wait_s 2
  emu gsm call "$NUM";   wait_mode MODE_RINGTONE; wait_s 2
  emu gsm accept "$NUM"; wait_mode MODE_IN_CALL;  wait_s 2
  step "screen off (KEYCODE_SLEEP)"; "$ADB" shell input keyevent KEYCODE_SLEEP; wait_s 15
  emu gsm cancel "$NUM"; wait_mode MODE_NORMAL;   wait_s 4
  step "screen on"; "$ADB" shell input keyevent KEYCODE_WAKEUP; wait_s 1
  "$ADB" shell wm dismiss-keyguard > /dev/null 2>&1; wait_s 1
  front; wait_s 2
  cmd fgs-stop; wait_s 1
  finish
}

s10_selftests() {
  begin s10_selftests "a normal app tries MODE_IN_CALL; then acts like a VoIP app (no call)"
  front; wait_s 2; cmd clear; wait_s 1
  cmd selftest-incall; wait_s 2
  cmd voip-on; wait_s 4
  step "mode while the spike acts like a VoIP app: $(mode_now)"
  cmd voip-off; wait_s 3
  finish
}

ALL="s1_nophone_foreground s2_nophone_background_cached s2b_nophone_background_frozen \
s3_nophone_background_fgs s11_missed_call s12_open_app_mid_call s4_phone_foreground \
s5_phone_background_cached s5b_phone_background_frozen s6_phone_background_fgs s7_phone_not_running \
s8_outgoing s9_waiting_and_hold s10_selftests s13_screen_off_end"

"$ADB" get-state > /dev/null || { echo "no device"; exit 1; }
prepare
for s in ${@:-$ALL}; do "$s"; done
