# Gate G2: core sharing, end to end

Sprint 2's gate: Alex shares a live link and Mom follows it in the browser. Three QA folders:

| Folder | What it is |
| --- | --- |
| `code/qa/routes/` | Three simulated routes in San Francisco (`tml-route/1` JSON, a fix a second with accuracy, speed and course): `walk-ferry-building` (700 m, 9 min, a wait at a crossing), `drive-embarcadero-south` (2 km, under 5 min, three red lights), `stopgo-market-street` (1.5 km, 9 min, seven stops, worse accuracy between buildings). `build-routes.ts` makes them from specs (`--check` verifies), `to-gpx.ts` writes GPX for Xcode, and `play.ts` plays one into the Android emulator (`adb emu geo fix`, or `--via mock` to set the accuracy) or the iOS Simulator (`xcrun simctl location set`). |
| `code/qa/fake-sharer/` | A sharer without a phone. It signs in a new +1 415 555 xxxx user by phone on the Auth emulator, starts a session through the real `createSession`, and writes pings at FSD §7 cadence through the Firestore JS SDK, so the security rules judge every write. It prints the viewer link. |
| `code/qa/e2e-sharing/` | The scenarios below: Chrome (the system's Google Chrome, headless, through playwright-core) and the Android app on the emulator. |

## Run it

Every command runs from the repo root. On a fresh checkout, first run `npm ci --prefix code/qa/fake-sharer && npm ci --prefix code/qa/e2e-sharing`.

| What | Command |
| --- | --- |
| Everything that runs in CI | `code/check-all.sh --only qa`: routes current, typecheck, unit tests, then the sharing e2e on the test emulators |
| Viewer follows a route, plus the ping-rule checks (test set: own project, ports and data) | `code/backend/scripts/with-test-emulators.sh npm --prefix code/qa/e2e-sharing test` |
| The same on the dev set (needs `code/backend/run.sh` and its dev scheduler) | `npm --prefix code/qa/e2e-sharing test` |
| Android: share, view, stop on the emulator (dev set) | `npm --prefix code/qa/e2e-sharing run test:android`, or `TML_ANDROID_E2E=1 code/check-all.sh --only qa`. Both hold the `emulator` lock for the whole scenario (about 2 min); `test:android` refuses to start while someone else holds it, and names the holder. |
| A live share to look at by hand | `node code/qa/fake-sharer/src/cli.ts` (`--help` lists the options) |
| Unit tests of the tools | `npm --prefix code/qa/fake-sharer test` |

### Fake sharer recipes

Every recipe runs on the dev set. Ctrl-C stops the session, unless you pass `--keep`.

- `node code/qa/fake-sharer/src/cli.ts --speed 10`: a live walk at 10x. It ends with Stop.
- `--route drive-embarcadero-south` or `--route stopgo-market-street`: another route.
- `--pings 5`: 5 pings, then nothing, so the viewer shows Last seen. Add `--gps-lost` to keep checking in every 30 s without a fix.
- `--stop-after 30`: taps Stop after 30 s.
- `--end-in 30` or `--limit-in 30`: the timer, or the 1-hour limit, ends the session 30 s from now (end_reason `timer` or `limit`).
- `--precision approximate`, `--call`, `--battery 15`, `--name Mia --mascot ninja`: other share settings.
- `--json`: one event per line, for scripts.

`--end-in` and `--limit-in` use a **test-only shortcut**, on demo-* emulators only. Right after `createSession`, the session's `started_at`, `expires_at` and `stop_at` move back by the same amount. The server's clock is never faked. The rules, `redeemLinkToken`, the stop job and the viewer all run on real time.

### Players and GPX

- `node code/qa/routes/play.ts walk-ferry-building --speed 4`: plays the walk into the emulator's GPS, one fix a second, at 4x.
- `node code/qa/routes/play.ts drive-embarcadero-south --via mock --accuracy 30`: the platform's test provider, which reports the accuracy you set (it's removed again when the player stops).
- `node code/qa/routes/play.ts stopgo-market-street --target ios --sim booted`: plays the route into the iOS Simulator.
- `node code/qa/routes/to-gpx.ts walk-ferry-building --speed 2 -o walk.gpx`: GPX for an Xcode scheme or Debug › Simulate Location.

Every adb command runs under `code/scripts/with-lock.sh emulator`, one command at a time.

### How the scenarios end sessions

- **Test set:** nothing runs the scheduled jobs, so the tests run the real compiled `stopDueSessions` handler once each, after the due time.
- **Dev set:** `code/backend/scripts/dev-scheduler.sh` runs it every 5 s.

Every wait is on a condition, with a 30 s default; nothing waits a fixed time.

The Android scenario:
- Holds the emulator lock from start to end. `TML_EMULATOR_LOCK_HELD=1` tells its own adb calls, the route player and `sign-in.sh` not to take the lock again, and the scenario checks that a `with-lock.sh` among its parent processes really holds it.
- Before signing in, launches the app once and waits for its first screen.
- After signing in, checks the app wasn't reinstalled mid-run (`run.sh` takes no lock).
- Taps an element only after it holds still across two reads of the screen, because the share sheet slides in.
- Opens the link exactly as the phone sent it when the viewer's dev server on :5173 answers.

The fake sharer never takes two fixes less than 2 s apart unless a test asks for an exact `recordedAt`, because the rules refuse pings closer than that.

The link-opened alert can only be checked as "fired once" on the emulators. FCM issues no token on the demo project, so the phone registers no device, and "alert (emulator: logged, not sent)" never appears. The functions log shows `alert sent` with `devices: 0`. Screenshots of every state go to `$TMPDIR/tml-e2e-sharing/<run>/` (or `$TML_E2E_SHOTS`). `TML_VIEWER_BASE=<url>` points the tests at a viewer that's already running instead of their own Vite server, and `TML_HEADED=1` shows Chrome.

## Gate G2 checklist

Status as of Oct 18. **PASS** means it was verified on both the test set and the dev set.

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Chrome follows a simulated route live: the marker moves along the walk, and each ping reaches the page within 5 s of capture (FSD §7) | **PASS** | `viewer-follow`: 5 pings; Open in Maps matches each ping to 5 decimals; the marker is on screen and moves; ping to page 10–25 ms |
| 2 | "Where Alex is" updates and names where Alex is | **PASS** | `viewer-follow`. With no Maps key the line gives coordinates. The page renames only after 25 m of movement (its place-asker), so the test allows that much. |
| 3 | Last seen shows when pings stop, not before 3 intervals / 15 s | **PASS** | `viewer-follow`: "Last seen 9:41 pm", "Alex’s signal dropped", the marker shows last seen; a new ping brings back Live |
| 4 | Stop: the ended state, "Alex stopped sharing at …" | **PASS** | `viewer-follow`: heading, title, Ended pill, Open in Maps gone, last-seen marker |
| 5 | No location after the end | **PASS** | The sharer's ping and check-in are refused. A second browser gets 403 on pings, where it got 200 while live. The ended page shows only the last place, and a fresh open shows "This location is no longer being shared" with no map position. |
| 6 | Ends on its timer, enforced by the server | **PASS** | `viewer-follow`: the rules refuse pings once `stop_at` passes; the stop job ends it as `timer` with `ended_at` = `stop_at`; the page shows "Sharing ended at …" |
| 7 | Ends at the 1-hour limit, enforced by the server, with the warning first | **PASS** | `viewer-follow`: "Sharing stops at …" appears in the last 5 min; it ends as `limit` at `expires_at` |
| 8 | Ping write contract (Q-PING-WRITE): clock skew, accuracy cap, id format, `last_fix_at` moves forward, a retried batch counts as written, and nothing is accepted after Stop | **PASS** | `ping-rules` |
| 9 | Step B: pings at least 2 s apart; a first ping no more than 5 min before the start | **PASS** | `ping-rules`. Step B has been unconditional in `firestore.rules` since every ping writer sends `last_fix_at`. |
| 10 | Alex shares from the Android emulator: sign-in, Share, the link from the share sheet, a route played with geo fix, Chrome following, Stop, the ended state on both sides | **PASS** | `android-share`, 16 steps, in about 2 min on the emulator:<br>• sign-in.sh, then Home › Share live location;<br>• the location explanation, then the system dialog (While using the app);<br>• Who it's for: Mom;<br>• the share sheet "Alex · Live location" carries `http://localhost:5173/s/<token>`; Copy text sends it;<br>• Turn on alerts, Allow;<br>• the live screen;<br>• Chrome opens that exact link and shows Alex at 3 places, each within 25 m of a fix sent to the emulator;<br>• "Mom opened your link at …";<br>• one `link_opened` alert, even with a second browser;<br>• Stop, confirmed;<br>• "Sharing ended / You stopped sharing at …" on the phone, and "Alex stopped sharing at …" in Chrome;<br>• the session is `stopped`, and a second browser gets 403 on pings;<br>• Done goes back to Home, still signed in. |
| 11 | Alex shares from the iOS Simulator (CI only, once Xcode exists) | **not run** | GPX and the simctl player are ready; there's no iOS scenario yet (no Xcode on this Mac, and no iOS share screens) |
