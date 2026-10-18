# Android call detection spike: results

Sprint 0 spike for the FSD's riskiest open question (§4 "Call-triggered sharing", §8 "Phone state").
Oct 18, 2026. Evidence: the Android source (AOSP release branches for Android 10 to 16, plus CTS),
developer.android.com, and 14 scripted call scenarios on the Android 16 emulator.

## Recommendation

**Keep the audio-mode approach as the FSD has it.** Until the Phone permission is granted, the app
reads `AudioManager` mode `MODE_IN_CALL` (no permission, Android 10 to 16). Phone is still asked at
the first share started during a call.

- **The audio mode is a sound way to notice a call while the app is open.** Telecom sets
  `MODE_IN_CALL` for every SIM call, and CTS checks that it does. Only Telecom and the phone
  process can set that mode. Reading it needs no permission, and no Android version restricts it.
  On the emulator the app heard about the mode change 4 to 180 ms after the system changed it.
- **Keep Phone (TelephonyCallback) as the source for "the call ended"**, which drives the stop rule
  and share back. It reports the end about 30 ms after hang-up; the audio mode takes about 3 s.
  By the source, the call state also stays correct through hold, two SIMs, and a VoIP call on top
  of a held carrier call. The emulator couldn't test those. On some phones the carrier's calling software may report a carrier call as
  `MODE_IN_COMMUNICATION` (VoIP) instead of `MODE_IN_CALL` (`config_use_voip_mode_for_ims`; see
  §2). The real-phone test below has to check this.
- **Suggested FSD changes:**
  1. On Android 10 and 11, the call state needs no permission, so the app never asks for Phone
     there.
  2. A share started from Quick start counts as "during a call" for the Phone request, even when
     the audio mode doesn't show a call.
  3. "Neither platform tells an app about calls while it isn't running" is true only without
     Phone. With Phone, Android started the closed app within 0.2 s of a ring (scenario s7).
     That ability can stay unused in v1, but the sentence should say so.

Suggested FSD wording, §8 Phone state: "Until it's granted, the app can tell a call is in progress
only from the audio mode (`MODE_IN_CALL`, no permission), while it's open or sharing. Confirmed in
the Sprint 0 spike. On Android 10 and 11 the call state needs no permission, so the app doesn't ask
there."

## 1. The question

Can an app tell it's on a cellular call without READ_PHONE_STATE, on Android 10 to 16? How does it
see the call end, with and without the permission?

**Short answer:**
- **On Android 12 to 16:** yes. It reads the audio mode while its process is running. Its process
  runs while the screen is open, while a foreground service runs, or for a short time after the
  person leaves the app.
- **On Android 10 and 11:** the regular call-state APIs work with no permission at all.
- **The call end without Phone:** the audio mode returns to `MODE_NORMAL` about 1.1 to 1.4 s after
  the hang-up, when the end-of-call tone stops.
- **The call end with Phone:** `TelephonyCallback` reports `CALL_STATE_IDLE` within about 40 ms.

## 2. Findings by Android version (official sources)

### Who sets the audio mode

Telecom's `CallAudioModeStateMachine` calls `AudioManager.setMode()` on every call change. The
mapping is the same on every branch from android10-release to android16-release:

| Telecom state | When | Mode |
| --- | --- | --- |
| Ringing | An incoming call rings and no other call is active | `MODE_RINGTONE` (1) |
| SIM call | A SIM call is placed, dialing or active. This includes VoLTE and Wi-Fi calling, unless the device uses VoIP audio for them (see below) | `MODE_IN_CALL` (2) |
| VoIP call | The foreground call has VoIP audio: a self-managed `ConnectionService` (VoIP apps that use Telecom), or a managed call flagged that way | `MODE_IN_COMMUNICATION` (3) |
| Holding / tone | All calls are on hold, or the end-of-call tone is playing | Keeps the last mode, so `MODE_IN_CALL` stays |
| Audio processing (API 30+) | A connected call is with a call-screening app | `MODE_CALL_SCREENING` (4) |
| Streaming (API 34+) | The call is streamed to another device | `MODE_COMMUNICATION_REDIRECT` (6) |
| Unfocused | No calls are left, after the end tone | `MODE_NORMAL` (0) |

Sources:
- [CallAudioModeStateMachine.java on android16-release](https://android.googlesource.com/platform/packages/services/Telecomm/+/refs/heads/android16-release/src/com/android/server/telecom/CallAudioModeStateMachine.java):
  `SimCallFocusState`, `VoipCallFocusState`, `RingingFocusState`, `OtherFocusState`,
  `UnfocusedState` and `calculateProperStateFromArgs`.
- The same states on [android10-release](https://android.googlesource.com/platform/packages/services/Telecomm/+/refs/heads/android10-release/src/com/android/server/telecom/CallAudioModeStateMachine.java).
- CTS checks `getMode() == MODE_IN_CALL` during an active managed SIM call. See
  `testSelfManagedAndSimBasedCallSwapping` in [SelfManagedConnectionServiceTest](https://android.googlesource.com/platform/cts/+/refs/heads/android16-release/tests/tests/telecom/src/android/telecom/cts/SelfManagedConnectionServiceTest.java)
  and `testSetVoipAudioMode` in [CallDetailsTest](https://android.googlesource.com/platform/cts/+/refs/heads/android16-release/tests/tests/telecom/src/android/telecom/cts/CallDetailsTest.java).
  Play-certified devices have to pass CTS, so an OEM can't change Telecom's mapping without
  failing it. CTS can't see the IMS case below.

**The one real gap: carrier calls that use VoIP audio.** IMS calls (VoLTE and Wi-Fi calling) get
VoIP audio, and so `MODE_IN_COMMUNICATION` instead of `MODE_IN_CALL`, in two cases:
- **A device setting:** the device sets `config_use_voip_mode_for_ims=true`. The platform default
  is false
  ([config.xml](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/core/res/res/values/config.xml)),
  and none of the public Pixel device overlays (gs101, gs201, zuma, zumapro, redbull, sunfish) set
  it. The code is in
  [ImsPhoneConnection](https://android.googlesource.com/platform/frameworks/opt/telephony/+/refs/heads/android16-release/src/java/com/android/internal/telephony/imsphone/ImsPhoneConnection.java).
- **The vendor's calling software:** the vendor's IMS service hands the call audio to Android
  (`AUDIO_HANDLER_ANDROID`; see `onAudioModeIsVoipChanged` in
  [TelephonyConnection](https://android.googlesource.com/platform/packages/services/Telephony/+/refs/heads/android16-release/src/com/android/services/telephony/TelephonyConnection.java)).

Whether a Samsung or other OEM phone does this can only be seen on the real device.

**A normal app can't fake a cellular call.**
- `AudioService.setMode()` drops `MODE_IN_CALL` from any caller without `MODIFY_PHONE_STATE`. From
  API 33 it also drops `MODE_CALL_REDIRECT` and `MODE_COMMUNICATION_REDIRECT`.
  `MODIFY_PHONE_STATE` is a privileged permission held by Telecom and the phone process. The check
  is on every branch from Android 10 to 16
  ([AudioService.java on android16-release](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/services/core/java/com/android/server/audio/AudioService.java);
  search for "MODIFY_PHONE_STATE Permission Denial: setMode").
- The API reference says the same: `MODE_IN_CALL` "should only be used by the telephony
  application"
  ([AudioManager#setMode](https://developer.android.com/reference/android/media/AudioManager#setMode(int))).
- The emulator confirms it in scenario s10: the spike's own `setMode(MODE_IN_CALL)` was ignored.

**Reading the mode needs no permission, in any app state, on any version.**
- `AudioService.getMode()` and `registerModeDispatcher()` (the system side of
  `AudioManager.addOnModeChangedListener`) have no permission check and no check on the caller's
  process state. That holds on android10-release through android16-release and on AOSP main.
- The behavior-change pages for Android 12 to 17 have no privacy change for the audio mode.
- Android 17's
  [background audio hardening](https://developer.android.com/about/versions/17/changes/bg-audio)
  limits playback, audio focus and volume calls from the background. It doesn't limit reading the
  mode.

### By version

| Android (API) | Audio mode, no Phone | Call state, no Phone | Call state, with Phone |
| --- | --- | --- | --- |
| 10 (29) | `getMode()` only, with no change listener, so poll it while the app is open. Last setter wins: a VoIP app that sets `MODE_IN_COMMUNICATION` while a SIM call is held hides the call. | **Works.** `TelephonyManager.getCallState()` and `PhoneStateListener.LISTEN_CALL_STATE` need no permission, even for an app targeting API 36. The check is a compat change that only exists from Android 12. `LISTEN_CALL_STATE` isn't in `ENFORCE_PHONE_STATE_PERMISSION_MASK` ([TelephonyRegistry on android10-release](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android10-release/services/core/java/com/android/server/TelephonyRegistry.java)), and the client side has no check. | Same. |
| 11 (30) | Same as 10. Adds `MODE_CALL_SCREENING` (4). | **Works**, as on 10 ([TelephonyRegistry on android11-release](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android11-release/services/core/java/com/android/server/TelephonyRegistry.java)). Telecom's `getCallState()` has no check ([TelecomServiceImpl on android11-release](https://android.googlesource.com/platform/packages/services/Telecomm/+/refs/heads/android11-release/src/com/android/server/telecom/TelecomServiceImpl.java)). | Same. |
| 12 (31) | `getMode()` plus `AudioManager.OnModeChangedListener`, new in API 31. `getMode()` now returns the "mode owner's" mode. The most recent privileged requester wins, so a VoIP app can't hide Telecom's `MODE_IN_CALL`. A normal app's `MODE_IN_COMMUNICATION` counts only while that app plays or records voice. | **Gone.** Apps targeting API 31+ need READ_PHONE_STATE for `getCallState()`, `getCallStateForSubscription()`, `TelephonyCallback.CallStateListener` and `PhoneStateListener.LISTEN_CALL_STATE`. Sources: [ENABLE_GET_CALL_STATE_PERMISSION_PROTECTION, 157233955](https://developer.android.com/about/versions/12/reference/compat-framework-changes), [TelephonyManager#getCallState](https://developer.android.com/reference/android/telephony/TelephonyManager#getCallState()). | `TelephonyCallback.CallStateListener`. Registered on the default `TelephonyManager`, it gets Telecom's device-wide state for all SIMs (`notifyCallStateForAllSubs` in [TelephonyRegistry](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/TelephonyRegistry.java)). It doesn't see self-managed VoIP calls. `TelecomManager.isInCall()` does ([TelecomManager#isInCall](https://developer.android.com/reference/android/telecom/TelecomManager#isInCall())). |
| 13 (33) | Adds `MODE_CALL_REDIRECT` (5) and `MODE_COMMUNICATION_REDIRECT` (6), both privileged-only. With targetSdk 33+, `getMode()` returns them unmapped ([AudioManager.getMode](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/media/java/android/media/AudioManager.java), `CALL_REDIRECTION_AUDIO_MODES`), so the detector must also count 4 and 5 as a cellular call. | Gone, as on 12. | As on 12. |
| 14 (34) | As on 13. The [cached apps freezer](https://source.android.com/docs/core/perf/cached-apps-freezer) freezes a cached process 10 s after it becomes cached. One-way binder callbacks, such as the mode listener, are buffered and arrive when the process thaws ([binder and the freezer](https://source.android.com/docs/core/architecture/ipc/binder-freezer)). Foreground service types are required, and a `location` service needs the location permission. | Gone. | As on 12. |
| 15 (35) | No relevant change found. | Gone. | As on 12. |
| 16 (36) | No relevant change found. `RemoteCallbackList` gets frozen-callee policies, but AudioService's mode-dispatcher list keeps the default (deliver, buffered while frozen). The emulator shows this in s2b. | Gone. | As on 12. |

**What this means for Play:** Play requires new apps and updates to target API 36 from Aug 31, 2026
([target API requirement](https://developer.android.com/google/play/requirements/target-sdk)). So
the old no-permission call-state path depends only on the phone running Android 10 or 11, not on
the app's target.

### Other ways to read call state without READ_PHONE_STATE (Android 12+)

| Signal | Verdict |
| --- | --- |
| `AudioManager.getMode()` / `OnModeChangedListener` | **The only usable one.** It needs no permission, Telecom drives it, and only privileged code can set `MODE_IN_CALL`. |
| `TelephonyManager.getCallState()`, `getCallStateForSubscription()`, `TelephonyCallback`, `PhoneStateListener` | All throw SecurityException. The spike's probe shows it on Android 16 (s1): `getCallState=SecurityException`, and `registerTelephonyCallback` is refused. |
| `TelecomManager.isInCall()` / `isInManagedCall()` | `@RequiresPermission(READ_PHONE_STATE)`. Throws SecurityException (s1). |
| `ACTION_PHONE_STATE_CHANGED` broadcast | Sent only to READ_PHONE_STATE holders. |
| `AudioManager.getActivePlaybackConfigurations()` | Needs no permission (results are anonymized). But a cellular call's audio runs in the modem, not in an app player. On the emulator the list showed only the ringtone and the end tone. Not a call signal. |
| `getActiveRecordingConfigurations()`, `getCommunicationDevice()` | Same problem: the call isn't an app stream, and the communication device isn't a call flag. |
| Audio focus loss | Only arrives if the app holds focus, which would pause the user's music. Not usable. |
| `CallScreeningService`, `InCallService`, `CallRedirectionService` | Each needs a role (call screening, default dialer or call redirection). That's a bigger ask than the Phone permission. |
| `NotificationListenerService`, reading the dialer's call notification | Needs notification access, a special access in Settings, and is a Play review risk. Not usable. |

### Detecting the call end

**With Phone:**
- `TelephonyCallback.CallStateListener` reports `CALL_STATE_IDLE` when the last call ends. The
  state comes from Telecom's `PhoneStateBroadcaster` and covers all SIMs.
- On the emulator it arrived 13 to 39 ms after Telecom marked the call disconnected.
- It needs a running process, which the sharing foreground service provides.
- With the permission, a manifest receiver for `ACTION_PHONE_STATE_CHANGED` also works, even when
  the app is frozen or not running:
  - It's on the [implicit broadcast exception list](https://developer.android.com/develop/background-work/background-tasks/broadcasts/broadcast-exceptions).
  - It's a protected broadcast, so only the system can send it.
  - Telecom sends it with `FLAG_RECEIVER_INCLUDE_BACKGROUND`
    ([TelephonyRegistry.broadcastCallStateChanged](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/TelephonyRegistry.java)).

**Without Phone:**
- The mode goes from `MODE_IN_CALL` to `MODE_NORMAL` after the last call ends and its end tone
  stops: 1.1 to 1.4 s on the emulator.
- Telecom keeps `MODE_IN_CALL` while calls are on hold and while the tone plays, so the mode
  doesn't flap.
- Use the listener on API 31+ and poll on 29 and 30. Apply a short debounce: the spike uses 2 s.
  That puts the detected end at 3.1 to 3.4 s after hang-up.
- This also needs a running process.

## 3. Emulator results (Android 16)

### Setup

- **Emulator:** Pixel_9 AVD, `google/sdk_gphone64_arm64/emu64a:16/BE2A.250530.026.D1/13818094`
  (user build), emulator 37.2.12.
- **Spike app:** targetSdk 36. Built with Gradle 9.8.0 and AGP 9.4.1, the same toolchain as
  `code/android`.
- **Calls:** simulated with the emulator console (`adb emu gsm call / accept / cancel`), which
  feeds the emulator's modem. The calls take the real Telephony, Telecom and AudioService path:
  Telecom logs them as `TelephonyConnectionService` SIM calls.
- **Timing:** all times are device-clock logcat. Telecom's and AudioService's own logs are the
  reference.
- **Host load:** the host was heavily loaded (load average 13 to 15), which explains the few
  100 ms+ outliers.

### Scenarios

Raw evidence and the merged timelines are in `results/emulator/`. Start with
`results/emulator/TIMELINE.md`; each scenario also has `.logcat.txt`, `.audio.txt` and
`.host.txt` files.

In this table, "Process" is what `dumpsys activity` reported: procstate 2 is top, 4 is a
foreground service, 15 is the previous app and 16 is cached. "Start" and "End" are measured from
when AudioService changed the mode, or from Telecom's call state change for TelephonyCallback.

| # | Phone | App state | Process | Call start seen by the app | Call end seen by the app |
| --- | --- | --- | --- | --- | --- |
| s1 | no | Call answered, app reopened and left open | top (2) | Mode callback +156 ms (poll +115 ms) | Callback +35 ms; debounced end 3.4 s after hang-up |
| s2 | no | HOME, no service | previous app (15), not frozen | +150 ms | +8 ms; end 3.3 s after hang-up |
| s2b | no | HOME, then another app used; no service | cached (16), **frozen** | **Nothing while frozen.** All three changes (RINGTONE, IN_CALL, NORMAL) arrived in one burst when the app was reopened, 14 s late | Same burst |
| s3 | no | HOME, location foreground service | foreground service (4) | +180 ms (poll +24 ms) | +33 ms; end 3.4 s after hang-up |
| s11 | no | Open; call rings and is never answered | top | RINGTONE, then NORMAL; never IN_CALL, so no banner (correct) | n/a |
| s12 | no | App not running; opened mid-call | started cold | `getMode()` read IN_CALL at launch, so the banner shows at once | +5 ms; end 3.1 s after hang-up |
| s13 | no | Service on; screen turned off during the call, which ended with the screen off | foreground service | +4 ms | +4 ms; end 3.2 s after hang-up |
| s4 | yes | Open | top | TelephonyCallback OFFHOOK +5 ms after Telecom ACTIVE; mode +10 ms | IDLE +20 ms |
| s5 | yes | HOME, no service | previous app (15) | OFFHOOK +5 ms | IDLE +25 ms |
| s5b | yes | HOME, then another app used; no service | cached (16), frozen | The PHONE_STATE broadcast **thawed the app at the first ring**; after that, everything arrived live (OFFHOOK +1 ms) | IDLE +13 ms |
| s6 | yes | HOME, location foreground service | foreground service (4) | OFFHOOK +3 ms | IDLE +33 ms |
| s7 | yes | Process killed (not force-stopped) | not running | The PHONE_STATE receiver **started the app** 0.18 s after the ring; OFFHOOK +4 ms | IDLE +27 ms |
| s8 | yes | Outgoing call from the dialer; app behind the dialer; service on | foreground service | `MODE_IN_CALL` as soon as the call is placed, 0.3 s before DIALING; OFFHOOK at DIALING | IDLE +39 ms; mode end 3.1 s after hang-up |
| s9 | yes | Call waiting and hold | n/a | **Not reproducible:** the emulator modem never delivered the second call | n/a |
| s10 | no | Self-tests | top | `setMode(IN_CALL)` from the spike: **ignored**. Acting like a VoIP app gives `MODE_IN_COMMUNICATION`, and AudioService attributes it to the spike's package | n/a |

### Latency summary (process running)

| Step | Measured |
| --- | --- |
| Telecom ACTIVE to AudioService `MODE_IN_CALL` | 0.31 to 0.43 s (outgoing calls: at placement, before dialing) |
| AudioService mode change to app `OnModeChangedListener` | 4 to 180 ms, typically about 10 ms |
| Telecom ACTIVE to TelephonyCallback OFFHOOK (Phone) | 1 to 13 ms |
| Telecom DISCONNECTED to AudioService `MODE_NORMAL` | 1.08 to 1.39 s (end tone) |
| Telecom DISCONNECTED to audio-mode end, 2 s debounce included | 3.09 to 3.42 s |
| Telecom DISCONNECTED to TelephonyCallback IDLE (Phone) | 13 to 39 ms |

### What the emulator showed beyond the source reading

1. **The process state is what decides delivery.**
   - When the person leaves with HOME, the app stays the "previous app" and keeps receiving events
     (s2).
   - Once they use another app, it becomes cached and is frozen within about 10 s (s2b,
     `isFrozen=true`). It then gets nothing until it's reopened. At that point the buffered changes
     replay together, so the app must read `getMode()` on every resume rather than act on replayed
     events.
   - A foreground service keeps delivery live, including with the screen off (s3, s13).
2. **Phone changes the background picture.** With the permission, the PHONE_STATE manifest
   receiver thawed a frozen app (s5b) and started a dead one (s7) at the first ring. This is the
   one way an Android app can learn of a call while not running. It isn't open to an app without
   the permission.
3. **A missed call never reaches `MODE_IN_CALL`** (s11). The audio mode won't offer a share for a
   call that only rang.
4. **The permission dialog on Android 16 reads "Allow Call detect spike to make and manage phone
   calls?"**, with Allow and Don't allow. That matches the FSD's warning about the wording.

### Emulator limits

- **Only Android 16.** The only system image installed is API 36, and a second emulator wasn't
  allowed on this 16 GB machine. Android 10 to 15 are covered by source reading only.
- **No call waiting or hold.** The emulator's modem didn't deliver a second incoming call (s9).
- **Outgoing calls:** the modem answers them by itself, and `gsm list` doesn't show them. Hang up
  with `KEYCODE_ENDCALL`.
- **A risky console command.** Under host RAM pressure, `adb emu gsm accept` once blocked QEMU's
  main loop for 15 s, and its watchdog killed the emulator. It worked every time afterwards.
  `adb shell input keyevent KEYCODE_CALL` is a fallback for answering.
- **No IMS.** No real carrier, VoLTE or Wi-Fi calling, so the VoIP-audio IMS case can't show up
  here.

## 4. Detector rules for the app (handoff to `code/android`)

1. **What counts as a call.** A cellular call is mode `MODE_IN_CALL` (2), `MODE_CALL_SCREENING` (4)
   or `MODE_CALL_REDIRECT` (5).
   - `MODE_RINGTONE` is not a call yet: it only rang.
   - `MODE_IN_COMMUNICATION` means VoIP or voice chat. It isn't a cellular call. Showing a banner
     for VoIP calls is a product question; iOS's call observer also lists CallKit VoIP calls.
2. **Read `getMode()` on every `onResume`**, and show the banner from that value. The listener alone
   isn't enough after a freeze.
3. **Listening:**
   - API 31+: `addOnModeChangedListener` while the activity is resumed and while the sharing
     service runs.
   - API 29 and 30: poll `getMode()` every second or less in the same windows. It's a cheap binder
     call.
4. **Without Phone**, treat the call as ended after the mode stays outside the call set for 2 s.
   The FSD doesn't use this for the stop rule (the timer applies), but the app can still use it for
   UI.
5. **With Phone:**
   - Register `TelephonyCallback.CallStateListener` on the default `TelephonyManager`, not one
     created for a subscription. That covers all SIMs.
   - `CALL_STATE_IDLE` is the end of the call.
   - On API 29 and 30, use `PhoneStateListener.LISTEN_CALL_STATE` instead. It works there without
     the permission.
6. **Don't declare a manifest PHONE_STATE receiver in v1** unless the product decides to use
   closed-app call notifications. It starts the app on every call.

Reference implementation: `app/src/main/kotlin/live/trackme/spike/calldetect/CallMonitor.kt`
(`applyMode` holds the detector, `registerTelephony` the Phone path) and `AudioModes.kt` (which
modes count as a call).

## 5. What only a real phone can prove

- **Carrier calls over VoLTE and Wi-Fi calling.** They must give `MODE_IN_CALL` and not
  `MODE_IN_COMMUNICATION`; the latter would mean IMS uses VoIP audio. Check this on Samsung (One
  UI) and Pixel at least.
- **OEM changes:** Samsung, Xiaomi and others customize Telecom and AudioService, and some have
  their own call-recording and "call assistant" features.
- **Call waiting, hold, swap and conference.** The emulator couldn't produce them.
- **Two SIMs:** a call on the non-default SIM must reach TelephonyCallback on the default
  `TelephonyManager`.
- **Pixel Call Screen** (`MODE_CALL_SCREENING`) and Samsung Bixby text call.
- **VoIP apps** (WhatsApp, Google Meet, Teams, Signal): they must never show `MODE_IN_CALL`, alone
  or while a carrier call is on hold.
- **Bluetooth headsets and car audio** (Android Auto).
- **OEM battery managers:** whether they kill or freeze the foreground service or block the
  PHONE_STATE receiver (Xiaomi, Oppo and Samsung "sleeping apps").
- **Android 10 and 11:** that the no-permission call-state path works on a real device.

## 6. Real-device test to run later

**Setup:**
1. Build the spike (`./gradlew assembleDebug` in this folder, JDK 17).
2. Install it with `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
3. Keep `adb logcat -v time -s CallSpike:I Telecom:I > <device>-<case>.logcat.txt` running for
   each case.
4. After each case, save `adb shell dumpsys audio | grep -E 'setMode\(MODE' > <device>-<case>.audio.txt`.
5. `python3 scripts/summarize.py <folder>` turns those files into a timeline.
6. The in-app log is also at `adb shell run-as live.trackme.spike.calldetect cat files/events.log`.

**Devices, minimum:**

| ID | Phone | Android | Why |
| --- | --- | --- | --- |
| P | Pixel 8 or 9 | 16, or 17 if updated | The reference platform |
| S | Samsung Galaxy S or A series | One UI 7 or 8 (Android 15 or 16) | The biggest OEM, with its own dialer and IMS |
| M | Any phone | Android 12 or 13 | The listener and permission rules from API 31 |
| L | Any phone | Android 10 or 11 | The no-permission call-state path and polling |

Add a Xiaomi, Oppo or OnePlus phone and a dual-SIM phone if available.

Run each case twice: first with Phone denied ("Don't allow"), then granted. Run in three app states:
- **open:** the spike on screen;
- **service:** "Start background service", then HOME and use another app for 1 minute;
- **closed:** swiped from recents, but not force-stopped.

**Cases:**

| Case | Steps | Pass |
| --- | --- | --- |
| 1 Incoming VoLTE | Call the phone from another phone, answer, talk 20 s, hang up from the far end. Repeat with a local hang-up. | Mode 2 within 1 s of answering; 0 within 3 s of hang-up. Telephony OFFHOOK then IDLE. |
| 2 Outgoing | Dial from the phone's dialer, wait for the answer, hang up. | Mode 2 from placement until hang-up. |
| 3 Wi-Fi calling | Airplane mode on, Wi-Fi on, Wi-Fi calling on; repeat case 1. | Same as case 1. **Mode 3 here is the key failure to report.** |
| 4 No VoLTE | VoLTE off (or 3G only, where the network allows); repeat case 1. | Same as case 1. |
| 5 Missed and declined | Let a call ring out; decline another. | Mode 1 then 0, never 2. Telephony RINGING then IDLE. |
| 6 Waiting, hold, swap | During call A, receive call B, answer it (A holds), swap twice, end B, then end A. | Mode stays 2 until A ends. No NORMAL in between. One IDLE at the end. |
| 7 Conference | Merge A and B, then end. | Mode stays 2. |
| 8 Audio routes | Repeat case 1 on speaker, a Bluetooth headset and Android Auto, if available. | Mode is 2 on every route. |
| 9 Screening | Pixel: let Call Screen answer. Samsung: Bixby text call. | Note the mode (4 expected on Pixel). |
| 10 Dual SIM | Call the non-default SIM. | Telephony OFFHOOK and IDLE on the default `TelephonyManager`. |
| 11 VoIP | WhatsApp, Meet, Teams and Signal calls, alone and during a held carrier call. | Never mode 2 from VoIP alone. Note what the mode does during the held carrier call. |
| 12 Service and battery | Service on, screen off, a 10-minute call. | Listener still live at hang-up (end within 3.5 s). Battery drop recorded. |
| 13 Closed app with Phone | Swipe away, then call. | Note whether the PHONE_STATE receiver starts the app (it did on the emulator). Battery managers may block it. |

**Record:** device, Android or One UI version, carrier, case, Phone (yes or no), app state, the mode
sequence, the telephony sequence, banner time and end time relative to the dialer's own
connect and hang-up moments, and anything odd. Any carrier call that shows mode 3, or any VoIP call
that shows mode 2, goes straight to the lead: it changes rule 1 in §4.

## 7. Spike files

| Path | What |
| --- | --- |
| `app/src/main/kotlin/live/trackme/spike/calldetect/CallMonitor.kt` | All call signals (mode listener, mode poll, TelephonyCallback or PhoneStateListener, API probes, playback) and both detectors |
| `app/src/main/kotlin/live/trackme/spike/calldetect/AudioModes.kt` | Mode names and meanings, and which modes count as a cellular call |
| `app/src/main/kotlin/live/trackme/spike/calldetect/MainActivity.kt` | The screen: live mode, telephony state, both detectors' results, the event log and the buttons. Accepts `--es cmd <command>` from adb |
| `app/src/main/kotlin/live/trackme/spike/calldetect/ShareService.kt` | A stand-in for the sharing service: a `location` foreground service |
| `app/src/main/kotlin/live/trackme/spike/calldetect/PhoneStateReceiver.kt` | Manifest PHONE_STATE receiver (only fires with Phone) |
| `app/src/main/kotlin/live/trackme/spike/calldetect/SpikeLog.kt` | Timestamped log to logcat (tag `CallSpike`), `files/events.log` and the screen, with the process importance on each line |
| `scripts/emulator-run.sh` | The 14 emulator scenarios (`scripts/emulator-run.sh s4_phone_foreground` runs one) |
| `scripts/summarize.py` | Merges the spike, Telecom and AudioService logs into timelines |
| `results/emulator/` | Raw evidence and `TIMELINE.md` |

The build uses Gradle 9.8.0 (wrapper copied from `code/android`), AGP 9.4.1 with built-in Kotlin,
and KGP 2.4.20. It targets compileSdk and targetSdk 36 with minSdk 29, and has no AndroidX
dependencies. Run it with
`JAVA_HOME=$(/usr/libexec/java_home -v 17) JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true ./gradlew assembleDebug`.
