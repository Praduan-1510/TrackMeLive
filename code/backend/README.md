# Track Me Live backend

Firebase: Firestore, Cloud Functions, phone-number Auth, and Hosting for the viewer page (FSD §5, §6, §8). Sprint 0 runs entirely on the local emulators against the offline demo project `demo-trackmelive`. No real Firebase project exists yet; see [When the real project exists](#when-the-real-project-exists).

```
code/backend/
  firebase.json            emulators, functions, Firestore and Hosting config (the dev set)
  firebase.test.json       the test set's config: its own ports, no UI or Hosting
  .firebaserc              default project: demo-trackmelive
  firestore.rules          deny by default; who may read and write each FSD §6 collection
  firestore.indexes.json   composite indexes for the scheduled functions, and the token-hash lookup
  run.sh                   start the dev emulators and the dev scheduler (--test: the test set)
  test.sh                  lint, build, then run every test on the test emulators
  scripts/env.sh           shared setup: JDK 21+, the two emulator sets and their ports, the pinned Firebase CLI
  scripts/with-test-emulators.sh  run any command against the test set (the firebase lock, a build, the env)
  scripts/dev-scheduler.sh run the scheduled functions against the dev set (the emulators never fire them)
  test-logs/               the test set's CLI and emulator logs (gitignored)
  functions/               Cloud Functions (TypeScript, Node 22 runtime)
    src/index.ts           global options, exports
    src/createSession.ts   the createSession callable
    src/contracts.ts       request parsing and the sharer snapshot, on top of the shared schema
    src/auth.ts            caller checks: phone-number sharers (and that the sign-in still stands), and a browser's existing viewer sign-in
    src/authViewer.ts      viewer uids and the {sid, role} custom tokens
    src/profile.ts         the saveProfile callable
    src/profileRequest.ts  saveProfile input parsing, on the shared validate()
    src/redeemLinkToken.ts the redeemLinkToken callable
    src/viewerOrigin.ts    VIEWER_ORIGIN checks: local origins only on a demo- project
    src/deleteAccount.ts   the deleteAccount callable
    src/sessionLookup.ts   finding sessions through private/meta: by link token, and by owner
    src/requestErrors.ts   the shared validate()'s issues as invalid-argument details
    src/sessions/          the session lifecycle: ending a session (end.ts), typed reads (read.ts), request parsing,
                           deleting what an ended session leaves (deletion.ts), transactions on a session doc
                           (transactions.ts), and the callables stopSession, reportCallEnded, reportCallActive
                           and discardSession
    src/jobs/              the scheduled functions: stopDueSessions, callWatchdog, cleanupEndedSessions,
                           purgeEndedSessions, sweepRetention, and what they share (run.ts)
    src/alerts/            push alerts: the FCM message (message.ts), sending once under retries (delivery.ts),
                           the FCM and logging senders (push.ts), and the link-opened trigger (linkOpened.ts)
    src/shared/schema.ts   copy of code/shared/schema/generated/ts/schema.ts (gitignored; made by the build)
    scripts/sync-schema.mjs  makes that copy
    scripts/dev-scheduler.mjs  the dev scheduler itself (scripts/dev-scheduler.sh starts it)
    .env.demo-trackmelive  params for the demo project (VIEWER_ORIGIN); env.sh copies it for the test project
  tests/                   emulator tests (node:test, run as TypeScript by Node's type stripping)
    src/rules.test.ts         Firestore rules
    src/createSession.test.ts createSession over the callable protocol
    src/contract.test.ts      the functions build against the shared schema
    src/auth.test.ts          phone sign-in on the Auth emulator, step by step
    src/profile.test.ts       saveProfile over the callable protocol
    src/profileRequest.test.ts saveProfile's validation edge cases (no emulator)
    src/redeemLinkToken.test.ts redeemLinkToken, and the minted sign-in under the rules
    src/deleteAccount.test.ts deleteAccount over the callable protocol, partial runs included
    src/sessions.test.ts      the session callables over the callable protocol
    src/lifecycle.test.ts     the scheduled jobs, run through their handlers
    src/devScheduler.test.ts  the dev scheduler as a process: its refusals, a tick, the loop, restarts
    src/retention.test.ts     FSD §8 retention: each window at its boundary, overlapping and repeated runs
    src/alerts.test.ts        the link-opened alert: payload, delivery with a fake FCM, the trigger end to end
    src/emulators.ts          emulator hosts, Auth REST helpers, callable helper
    src/authEmulator.ts       the Auth emulator's phone and custom-token REST calls, one step at a time
```

## Setup

You need:

- **Node 22 or newer.** The functions runtime is `nodejs22`. On a host with Node 24 the emulator says `requested "node" version "22" doesn't match your global version "24"` and runs on 24; that warning is expected.
- **JDK 21 or newer.** firebase-tools 15 refuses older Java. This machine has Temurin 21.0.12.1+1 at `~/Library/Java/JavaVirtualMachines/jdk-21.0.12.1+1`, next to the JDK 17 the Android build uses. `scripts/env.sh` picks a JDK 21+ by itself (`/usr/libexec/java_home -v 21+`) and ignores a `JAVA_HOME` that points at 17. To force one, set `EMULATOR_JAVA_HOME`. It also adds `-Djava.net.preferIPv4Stack=true` to `JAVA_TOOL_OPTIONS`, because Java's dual-stack sockets fail HTTPS handshakes in this machine's sandboxed shells.
- **A network connection the first time.** The CLI downloads the Firestore emulator jar and the Emulator UI into `~/.cache/firebase/emulators`. After that, everything runs offline.

There's nothing to install by hand. Both scripts run `npm ci` in `functions/` and `tests/` when `node_modules` is missing or older than the lockfile. The Firebase CLI runs as `npx -y firebase-tools@15.32.1`. npm 11 warns that the postinstall scripts of `@firebase/util` and `protobufjs` were skipped; neither is needed here.

## Commands

| Command | What it does |
| --- | --- |
| `./run.sh` | The dev set: builds the functions and starts Auth, Firestore, Functions and the Emulator UI for `demo-trackmelive`, plus the dev scheduler (below; `DEV_SCHEDULER=0` leaves it out). It adds Hosting when `code/viewer/dist/index.html` exists. Extra arguments go to `firebase emulators:start`, e.g. `./run.sh --import .emulator-data --export-on-exit`. Stop with Ctrl-C. |
| `./run.sh --test` | The test set, long-lived: `demo-trackmelive-test` on its own ports, no UI, Hosting or scheduler. `test.sh` and `with-test-emulators.sh` reuse it while it's up, which saves the emulator start-up on every run. |
| `./test.sh` | Lints and builds the functions, type-checks the tests, then runs every test on the test set, through `scripts/with-test-emulators.sh`. It never touches the dev set, so it runs while `./run.sh` is up, and the tests' wipes never reach the dev data. |
| `./test.sh src/rules.test.ts` | Runs one test file (paths are relative to `tests/`). |
| `scripts/with-test-emulators.sh <command...>` | Runs any command against the test set, for any suite that needs the emulators (the viewer's live e2e: `code/backend/scripts/with-test-emulators.sh npm --prefix code/viewer run test:e2e:live`). It takes the `firebase` lock (unless a caller such as check-all holds it; never in CI), builds the functions when `lib` is older than `src` or the shared schema, reuses a running test set or starts one with `emulators:exec`, runs the command in the caller's folder with `GCLOUD_PROJECT`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `FUNCTIONS_EMULATOR_HOST` and `TML_TEST_EMULATORS=1` exported, and exits with its status. The emulators accept browser requests from any origin, the viewer's dev server included. |
| `scripts/dev-scheduler.sh [--interval <s>] [--once]` | Runs the scheduled functions against the dev set, next to a running `./run.sh` (which already starts it). See [The dev scheduler](#the-dev-scheduler). |
| `npm --prefix functions run build:watch` | Rebuilds on save. The running Functions emulator reloads `lib/` by itself. |
| `npm --prefix functions run lint` | ESLint (type-aware typescript-eslint) plus `tsc --noEmit`. |
| `npm --prefix functions run sync:schema` | Refreshes `src/shared/schema.ts` from the shared schema. `build` and `lint` already run it. |

The Firestore emulator reloads `firestore.rules` on save, for the dev set too, and the rules tests load the file fresh on each run. The Functions emulator reads `functions/.env.<project>` when it (re)loads `lib/`: after changing a param, rebuild (or touch `functions/lib/index.js`); no restart is needed.

## Emulator ports

All emulators listen on `127.0.0.1`. There are two sets, so tests never touch what the apps use (`scripts/env.sh`):
- the **dev set** (`./run.sh`, project `demo-trackmelive`, `firebase.json`): the apps, the viewer and QA connect to it;
- the **test set** (`./test.sh`, `./run.sh --test`, `scripts/with-test-emulators.sh`; project `demo-trackmelive-test`, `firebase.test.json`): every test run wipes its data. `tests/src/emulators.ts` refuses to run on `demo-trackmelive` or any project that isn't `demo-`.

| Emulator | Dev set | Test set |
| --- | --- | --- |
| Emulator UI | 4000 | none |
| Auth | 9099 | 9199 |
| Firestore | 8080 (UI websocket 9150) | 8180 (9250) |
| Functions | 5001 (`http://127.0.0.1:5001/demo-trackmelive/us-central1/createSession`) | 5101 (`http://127.0.0.1:5101/demo-trackmelive-test/us-central1/createSession`) |
| Hosting | 5050. The default, 5000, is taken by macOS AirPlay Receiver (and 7000 too). | none |
| Hub, Logging, Eventarc, Cloud Tasks | 4400, 4500, 9299, 9499 | 4410, 4510, 9399, 9599 |

The test set's CLI runs from `test-logs/`, where its `firebase-debug.log` and `firestore-debug.log` land, so they never overwrite the dev set's logs here. Its params file, `functions/.env.demo-trackmelive-test`, is copied from the demo one on each run and gitignored.

### Connecting the apps to the emulators

The demo project has no `GoogleService-Info.plist` or `google-services.json`, so debug builds configure Firebase in code. Then they point each SDK at the emulators, before any other call on that SDK.

**Firebase options.**
- `projectId`: `demo-trackmelive`. The `demo-` prefix keeps every SDK off real resources.
- `appId`: any well-formed one, such as `1:000000000000:ios:0000000000000000` or `1:000000000000:android:0000000000000000`, with sender id `000000000000`.
- `apiKey`: `AIzaSy` followed by 33 zeros (39 characters). The emulators accept any key, but Firebase Installations checks the format.

| | iOS Simulator | Android emulator | Viewer page (a browser on this Mac) |
| --- | --- | --- | --- |
| Host | `127.0.0.1` | `10.0.2.2`, the Android emulator's alias for the Mac's loopback | `127.0.0.1` |
| Auth (9099) | `Auth.auth().useEmulator(withHost: "127.0.0.1", port: 9099)` | `Firebase.auth.useEmulator("10.0.2.2", 9099)` | `connectAuthEmulator(auth, "http://127.0.0.1:9099")` |
| Firestore (8080) | `Firestore.firestore().useEmulator(withHost: "127.0.0.1", port: 8080)` | `Firebase.firestore.useEmulator("10.0.2.2", 8080)` | `connectFirestoreEmulator(db, "127.0.0.1", 8080)` |
| Functions (5001, region `us-central1`) | `Functions.functions(region: "us-central1").useEmulator(withHost: "127.0.0.1", port: 5001)` | `Firebase.functions("us-central1").useEmulator("10.0.2.2", 5001)` | `connectFunctionsEmulator(getFunctions(app, "us-central1"), "127.0.0.1", 5001)` |
| App verification for phone sign-in (debug builds only, never release) | `Auth.auth().settings?.isAppVerificationDisabledForTesting = true` | `Firebase.auth.firebaseAuthSettings.setAppVerificationDisabledForTesting(true)` | not used |

A callable's emulator URL is `http://<host>:5001/demo-trackmelive/us-central1/<name>`.

**Share links.** On the dev set, createSession's `link_url` is `http://localhost:5173/s/<token>`: `VIEWER_ORIGIN` in `functions/.env.demo-trackmelive` points at the viewer's Vite dev server (`npm --prefix code/viewer run dev`), the build of the page that talks to the emulators. Hosting on 5050 serves a production build, which never does. Only a `demo-` project may use a local or http origin: createSession refuses one on any other project (`src/viewerOrigin.ts`), and `contract.test.ts` checks every `functions/.env.<project>` file.

**Plain HTTP.** Emulator traffic isn't encrypted. Android's debug build needs a `network_security_config` that allows cleartext to `10.0.2.2`. On iOS, if App Transport Security blocks it, add `NSAllowsLocalNetworking` to the debug Info.plist.

**Physical phone.** Bind the emulators to `0.0.0.0` in `firebase.json` and use the Mac's LAN address in the app.

**Phone sign-in on the emulator.** Any E.164 number works; there are no test numbers to set up and no text is sent. The 6-digit code appears:
- in the emulator's terminal output;
- in the Emulator UI;
- at `GET http://<host>:9099/emulator/v1/projects/demo-trackmelive/verificationCodes`, which returns `{verificationCodes: [{phoneNumber, sessionInfo, code}]}`. Instrumented tests read it there.

The SDKs make three Identity Toolkit calls:
1. `accounts:sendVerificationCode {phoneNumber}` returns a `sessionInfo`.
2. The code is read.
3. `accounts:signInWithPhoneNumber {sessionInfo, code}` returns the sign-in. Its ID token carries `firebase.sign_in_provider: "phone"` and `phone_number`.

`tests/src/auth.test.ts` runs those steps through `tests/src/authEmulator.ts` and checks what can go wrong:
- a wrong code gets `INVALID_CODE`;
- a used code is refused;
- a number that isn't E.164 is refused;
- the same number signs back in as the same uid, which is how a new phone restores the account.

## Versions

Every version is exact and was published before Oct 4, 2026. Lockfiles are committed, and `.npmrc` sets `save-exact`.

| Package | Version | Published |
| --- | --- | --- |
| firebase-tools (CLI, via npx) | 15.32.1 | Sep 30, 2026 |
| firebase-functions | 7.4.0 | Sep 15, 2026 |
| firebase-admin | 14.5.0 | Sep 23, 2026 |
| typescript | 6.0.3 | Apr 16, 2026 |
| eslint / @eslint/js | 10.12.0 / 10.0.1 | Oct 2 / Feb 6, 2026 |
| typescript-eslint | 8.71.0 | Sep 28, 2026 |
| @types/node | 22.20.5 | Oct 1, 2026 |
| @firebase/rules-unit-testing | 5.0.2 | Aug 19, 2026 |
| firebase (JS SDK, tests only) | 12.19.0 | Sep 9, 2026 |
| Firestore emulator / Emulator UI | 1.22.0 / 1.15.0 | bundled with firebase-tools 15.32.1 |
| JDK | Temurin 21.0.12.1+1 | Aug 2026 |

**Why TypeScript 6.0.3 and not 7.0.2.** 7.0.2 (Jul 8, 2026) is the native compiler: it ships no `tsserver` and no JavaScript API. typescript-eslint 8.71.0, the newest before the cutoff, supports `typescript <6.1.0`. 6.0.3 keeps type-aware lint working. Revisit once typescript-eslint supports 7.

## createSession

A callable function. The contract is `CreateSessionRequest` and `CreateSessionResponse` in `code/shared/schema/schema.json`, owned by the shared-contracts agent.

- **Caller.** It must be signed in with a phone number (`sign_in_provider == "phone"`). A signed-out caller gets `unauthenticated`, an anonymous or custom (viewer) sign-in gets `permission-denied`, and a caller with no usable `users/{uid}` profile gets `failed-precondition`.
- **Input.** `stop_rule` (`call`, `minutes` or `limit`), `stop_minutes` (15, 30 or 60 with `minutes`, otherwise null), `call_id` (null for a manual share), `share_back_allowed` (forced to false without a call), `precision`, and an optional `viewer_name`. The name is trimmed, then held to the shared `PersonName`: 1–24 grapheme clusters (characters as people see them), at least one letter, number, symbol or emoji, and no control or text-direction characters. A blank name means none. Unknown keys are rejected, so the request can never name an owner. Errors come back as `invalid-argument` with `details.errors[]` listing each `{field, message}`.
- **One session at a time.** If `users/{uid}.active_session_id` points at a session that is still live (active, and before its `stop_at` and `expires_at`), the call fails with `already-exists` and `details: {reason: "active_session", session_id}`. A pointer at a session that is over doesn't block. One that stopped or is gone is simply replaced. One still marked active but past `stop_at` or `expires_at` is ended on the spot, in the same transaction, as `timer` at `stop_at` or `limit` at `expires_at`, so its end isn't left to the next stop-job run. The check and the writes are one transaction, so of two simultaneous calls exactly one wins.
- **Writes, in that transaction:**
  - `shareSessions/{id}`: every `ShareSession` field. That's `status: "active"`, `started_at` = server now, `expires_at` = `started_at` + 1 h, `stop_rule` and `stop_minutes`, `stop_at` (now plus the minutes, capped at `expires_at`; `expires_at` for `limit`; null for `call`), `call_active` = whether there's a call, `last_ping_at` = `started_at`, `ping_interval_s` = `INITIAL_PING_INTERVAL_SECONDS` (5) until the first ping, and the `sharer` snapshot from `users/{uid}`. Every other field, `call_ended_at`, `precision_next`, `last_fix_at` and `place` included, is null or false. The times and the 1-hour limit come only from the server: a request that names `started_at`, `expires_at` or `stop_at` is `invalid-argument` (unknown keys).
  - `shareSessions/{id}/private/meta`: `user_id` = the caller's uid, `link_token_hash` = SHA-256 (lowercase hex) of the token, `viewer_name`, and `viewer_uid` and `activity_push_token` as null.
  - `callLogs/{session id}`, for a call-triggered share: `user_id`, `session_id`, `call_id` and `call_time` = server time (each session has at most one call, so the log shares its id; x-decisions Q-CALLLOG-ID).
  - `users/{uid}`: `active_session_id` = the new session, `updated_at` = server time, and `last_viewer_name` when a name is given.
- **Returns** `{session_id, link_token, link_url, started_at, expires_at}`, with times in epoch ms. `link_token` is 128 random bits in base64url (22 characters, the shared `LinkToken`). It's returned once and never stored. `link_url` is `VIEWER_ORIGIN` + `/s/` + the token.
- **Still to do:** App Check.

## saveProfile

A callable. The contract is `SaveProfileRequest` and `SaveProfileResponse` in the shared schema. Sign-up, the mascot picker and Settings all save through it. Clients can read `users/{uid}`, but every client write to it is denied (Backend B's rules).

- **Caller.** Phone sign-in only, as with createSession. A signed-out caller gets `unauthenticated`, and an anonymous or viewer sign-in gets `permission-denied`.
  - The sign-in must also still stand. An ID token keeps verifying for up to an hour after its Auth user is deleted, disabled or signed out everywhere. So every sharer callable that writes (saveProfile, createSession, stopSession, reportCallEnded, reportCallActive, discardSession) starts with `requireCurrentSharer` in `src/auth.ts`.
  - That's `verifyIdToken(token, true)`, which reads the Auth user, so those callers get `unauthenticated` ("Your sign-in has ended. Sign in again."). Any other failure, such as Auth being unreachable, is passed on as it is.
  - Tests: a disabled account and revoked tokens (`profile.test.ts`), and a deleted account on all six callables (`deleteAccount.test.ts`).
- **Input.** The whole profile the app shows:
  - `name`, `mascot_id`, `mascot_color` and `mascot_accessory` (null for none), all required;
  - `settings`, optional, the whole `UserSettings` object.

  The checks:
  - the name is trimmed, then must be 1–24 grapheme clusters with at least one letter, number or symbol, and no control or direction-override characters (the shared `PersonName`; x-decisions Q-NAME-CHARACTERS);
  - the accessory must be one the mascot takes (`MASCOT_CATALOG`; the astronaut takes none);
  - unknown keys are rejected, including the server-owned `last_viewer_name`, `active_session_id`, `created_at` and `updated_at`;
  - before counting, a raw name over 768 UTF-16 units is turned away. That's 32 per character, above the longest emoji sequence (19). It's `NAME_MAX_UTF16` in `contracts.ts`, shared with createSession's `viewer_name`.

  The checking is the shared `validate("SaveProfileRequest")` after trimming, plus the accessory table. Errors come back as `invalid-argument` with `details.errors[]`: one `{field, message}` per bad field, such as `name`, `mascot_accessory`, `settings.default_stop`, an unknown key, or `(root)`.
- **Writes, in one transaction.**
  - A new profile gets every `User` field. `settings` comes from the request or `DEFAULT_USER_SETTINGS`, `last_viewer_name` and `active_session_id` start null, and `created_at` and `updated_at` are server time.
  - An existing profile gets the fields sent and a new `updated_at`. The stored settings stay when none are sent. `created_at`, `last_viewer_name` and the function-owned `active_session_id` are never touched.
  - Two first saves that race create one profile.
  - The phone number is never written; only Firebase Authentication holds it.
- **Returns** the profile as stored, read back after the write, with `created_at` and `updated_at` in epoch ms. A stored doc that isn't a valid `User` is an `internal` error, never handed back.
- **A new phone.** After signing in, the app reads `users/{uid}`. If it exists, the app restores it and doesn't save the name typed at sign-up (FSD §4: the profile is restored). Only a missing profile is created through saveProfile.

## redeemLinkToken

A callable for the viewer page. The contract is `RedeemLinkTokenRequest` and `RedeemLinkTokenResponse` in the shared schema. Anyone may call it: the token is the credential.

- **Lookup.** SHA-256 of `link_token`, lowercase hex (`hashLinkToken` in `createSession.ts`), found with a collection-group query on `private.link_token_hash`, which uses the field override in `firestore.indexes.json`.
- **Roles, in one transaction.**
  - The first browser becomes the viewer: `private/meta.viewer_uid` gets its uid, and the session's `first_viewed_at` gets server time.
  - Every later browser is a watcher. When browsers race, exactly one becomes the viewer (tested with ten).
  - Each new uid gets `shareSessions/{id}/viewerSignIns/{uid}` = `{role, created_at}`. The 24 h cleanup reads it to delete the viewer Auth users (FSD §8).
  - A session takes at most `MAX_VIEWER_SIGN_INS` (10) browsers, the viewer included, counted from `viewerSignIns`. That way a leaked link can't keep creating Auth users. A new browser past that gets `resource-exhausted` with `details: {reason: "too_many_viewers"}`, and the page shows "This link can't be opened right now". A browser that already has a sign-in can always refresh.
  - The cap holds even when browsers race. A count inside a transaction locks only the docs it counted, not new ones. So every new browser's transaction also writes `private/meta.viewer_uid`: the first one sets it, the later ones write the same value back. That write makes new browsers commit one at a time. Tested: of four browsers racing for the last two places, exactly two get in.
  - Under contention the emulator aborts and retries those transactions with backoff, so several racing first opens can take a few seconds there. An uncontended open isn't affected.
- **Uids.**
  - A new browser gets `v_<sessionId>_<96 random bits, base64url>`.
  - The callable SDK sends the browser's current ID token. A browser that redeems again with its own sign-in for this session (a custom token whose `sid` matches) keeps its uid and its role.
  - So a refresh never turns the viewer into a watcher, adds a sign-in record, or counts as a new open.
  - Any other caller is a new browser: signed out, anonymous, the sharer's phone sign-in, or a sign-in for another session.
- **The custom token** carries exactly `{sid, role}`. Both possible tokens, viewer and watcher, are signed before the transaction, in parallel, and only the one for the role the transaction commits is returned; the other never leaves the function. So a token never goes out for a role that didn't commit, and a signing failure writes nothing. The page signs in with `signInWithCustomToken`, and the Auth user is created then.
- **Nothing slow in the transaction.** The sharer's pings update the session doc every few seconds, and a transaction that read it holds it until it commits. Signing inside it (an IAM `signBlob` round trip in production) once timed out those locks and answered `internal`. Now the transaction is Firestore reads and writes only, like every other session transaction (`sessions/transactions.ts`), and contention that outlasts the Admin SDK's retries answers `unavailable` with `details: {reason: "busy"}`, never `internal`; the page tries again. Tested with a pinger sending the real ping batch every second while six browsers open and refresh in parallel.
- **Returns** `{custom_token, session_id, role, can_share_back}`. `can_share_back` is true for the viewer while `share_back_allowed` and `call_active` are both true. The page follows the session doc for later changes.
- **Ended.** A session that has stopped, or passed `stop_at` or `expires_at` (even before the scheduled stop marks it), fails with `failed-precondition` and `details: {reason: "session_ended", sharer}`. Nothing is minted or written, so nothing can read pings. The page shows "This location is no longer being shared" with the sharer's name and mascot. A page that's already open keeps its sign-in and can still read the session doc for its ended state.
- **Bad tokens.** Every token that leads to no session gets the same `not-found` ("This link doesn't work.", no details): an unknown one, a malformed one (not 22 base64url characters), or one whose session is gone.
  - A malformed token is turned away before the lookup. The format is public, so that says nothing about which tokens exist.
  - Every well-formed token costs the same indexed query, found or not.
  - A request that isn't `{link_token: string}` is `invalid-argument`.
- **Rules it relies on** (Backend B's `firestore.rules`). The last block of `redeemLinkToken.test.ts` checks each one with real minted tokens over Firestore's REST API:
  - the viewer and watchers can read the session doc, also after it ends;
  - they can read pings only while the session is live (active, before `stop_at` and `expires_at`);
  - they can never read `private/meta`, `viewerSignIns`, `users` or another session;
  - only the viewer can write `viewerPings`.
- **Not built yet.**
  - App Check and per-caller rate limits (Open questions 5). The 10-browser cap above bounds what one link can cost.
- **The view alert** goes out from the viewer's `viewerSignIns` doc; see [Alerts](#alerts).

## Alerts

The view alert (FSD §4 "View notification"): when the link is first opened, the sharer's phones get "Mom opened your link". It lives in `src/alerts/`. The call-ended and expiry alerts (FSD §5) aren't built yet. They will plug into the same `deliverAlert`, each with its own `AlertSpec` (kind, setting, words).

- **Trigger.** `sendLinkOpenedAlert` is a Firestore trigger on the creation of `shareSessions/{id}/viewerSignIns/{uid}`, and it acts only on role `viewer`. redeemLinkToken creates exactly one such doc per session, in the transaction that sets `first_viewed_at`. So a refresh, a reopen, a watcher or a link preview never alerts. A trigger on the session doc would run on every ping.
- **When it isn't sent:**
  - the session is over (stopped, or past `stop_at` or `expires_at`);
  - `first_viewed_at` is null;
  - the session, its meta or the profile is gone;
  - the sharer's `settings.alert_link_opened` is off;
  - the open was more than 10 minutes ago (`LINK_OPENED_MAX_AGE_MS`), which matters for a retried trigger.
- **Words.** The prototype's, from `openLink` in `prototype/js/app.js`:
  - title: "Mom opened your link", from `private/meta.viewer_name`, or "They opened your link" without a name;
  - body: "You’re live on their map until your call ends." while `call_active`, otherwise "You’re live on their map."
- **Transport.** FCM HTTP v1 (firebase-admin messaging, `sendEach`) on both platforms. iOS goes through FCM's APNs link, which needs the APNs auth key uploaded to FCM (x-decisions Q-ALERT-PUSH).
- **On the emulators** and any `demo-` project, the sender only logs. Each alert appears in the functions log:
  - `alert (emulator: logged, not sent)` with its title, body, data and the token's last 6 characters;
  - then `alert sent` with the counts, and `sender: "log"`.
- **Once, under retries** (x-decisions Q-ALERT-ONCE). The trigger is deployed with `retry: true` and a 60 s timeout. Each alert has a function-only marker, `shareSessions/{id}/alerts/link_opened` (the shared `AlertDelivery`):
  - a claim transaction takes a 90 s lease before sending;
  - a duplicate delivery finds the marker `sent` or `skipped` and does nothing;
  - a delivery that finds the lease still running throws, so it's retried later;
  - a retry after a send that partly failed goes only to the devices not yet in `delivered`;
  - Android's `tag` and `collapseKey` and the APNs `apns-collapse-id` are all `link_opened:{sessionId}`, so a resend after a crash replaces the notification instead of stacking a second one.

  The claim and finish transactions read `users/{uid}`, and deleteAccount deletes that doc before it lists a session's subcollections, so no marker outlives the account. Otherwise the marker goes with its session (the purge, deleteAccount, discardSession).
- **What FCM's answer means** (`failureKind`):
  - `registration-token-not-registered` or `invalid-registration-token`: the device doc is deleted (FSD §8 "when the token stops working"). The delete has a `lastUpdateTime` precondition, so a token the app rewrote meanwhile stays;
  - `server-unavailable`, `internal-error`, the rate limits and `unknown-error`: that device is retried;
  - anything else (`invalid-argument`, `mismatched-credential`, `third-party-auth-error`, …) is logged as an error, and the device is kept. A bad payload or credential fails for every token, so it's never a reason to delete them all.
- **The device-token contract** for the apps (the shared `Device`; the rules check it):
  - **Register** once signed in and once the profile exists (the rules refuse a device before that). Set `users/{uid}/devices/{deviceId}` to exactly `{platform, push_token, live_activity_start_token, updated_at: serverTimestamp()}`:
    - `deviceId` is a UUID made once per install and kept in app storage;
    - `push_token` is the FCM registration token: on Android `FirebaseMessaging.getInstance().token`, on iOS `Messaging.messaging().token()` once the APNs token has been passed to Messaging;
    - `live_activity_start_token` is always null on Android.
  - **Refresh.** Rewrite the doc on every launch while signed in, and whenever FCM issues a new token (`onNewToken` on Android, `messaging(_:didReceiveRegistrationToken:)` on iOS). `sweepRetention` deletes devices not rewritten for 270 days.
  - **Sign out.** Delete the doc before signing out. Registering doesn't need the notification permission; without it, the phone just doesn't show the alert.
- **The payload** (`message.ts`):
  - `notification {title, body}`, and `data {type: "link_opened", session_id}`;
  - Android:
    - `priority: high`;
    - `channelId: "link_opened"`. The app creates this channel, named "Link opened", at default importance (it alerts);
    - `tag` and `collapseKey` `link_opened:{sessionId}`;
    - `ttl` = the time left in the session;
  - APNs:
    - `apns-push-type: alert` and `apns-priority: 10`;
    - `apns-expiration` = the session's end;
    - `apns-collapse-id`;
    - `aps.sound: default`, and `aps.thread-id` = the session id.
- **Tap.** The app opens the live screen for `data.session_id` if that's still the active share, otherwise home.
  - Android: in the background the system shows the notification, and the launcher activity gets `type` and `session_id` as intent extras. In the foreground, `onMessageReceived` gets the message and the app shows its own heads-up notification or snackbar.
  - iOS: the data keys are top-level keys of `userInfo`.

## deleteAccount

A callable for Settings › Delete account and all data. The contract is `DeleteAccountRequest` and `DeleteAccountResponse` in the shared schema. FSD §8: "deleting stops any active session and deletes everything at once", overriding the 30-day retention.

- **Caller.** Phone sign-in only (`unauthenticated` or `permission-denied` otherwise). The request has no fields: null, a missing payload and `{}` are fine, and anything else is `invalid-argument`.
  - It's the one sharer callable that uses plain `requireSharer`, not `requireCurrentSharer`. Its own Auth user goes last, so a repeat call with the same token must still get through to finish.
- **In order:**
  0. **Lock out.**
     - The Auth user is disabled and its refresh tokens are revoked, before anything is deleted.
     - From then on `requireCurrentSharer` refuses its tokens. So a saveProfile or createSession from a second phone, or a Settings toggle, can't recreate the profile or start a share mid-deletion. The tests race eight saves against a deletion, and no profile is left.
     - The token this call came with still passes deleteAccount's plain check, so a repeat call from a locked-out account still finishes.
  1. **Stop.** Every session the caller owns that's still active ends as Stop ends it. That's Backend B's `sharerStop` and `endSession`: end_reason `stopped`, or `timer` or `limit` if it was already due. An open viewer page sees the share end before it disappears. The test watches a listener on the session see `active`, then `stopped`, then deleted.
  2. **Profile.** `users/{uid}` and its subcollections (devices) go. With no profile, no new share can start.
  3. **Sessions.** The caller's sessions are found again through `private.user_id`, so one started during step 1 isn't missed. For each, deletion runs in this order:
     - its viewer Auth users, read from `viewerSignIns` before those docs go;
     - every subcollection except `private` (pings, viewerPings, viewerSignIns);
     - the session doc;
     - `private/meta`, last, because it's how a repeat run finds the session.
  4. **callLogs and a re-sweep.** Every entry with the caller's `user_id` goes. Then `users/{uid}` and its devices are deleted again.
     - This catches a save whose check passed just before the lock-out but that committed after step 2.
     - If the re-sweep found anything, it logs a warning, waits a second for any other save still in flight, and sweeps once more.
     - Tested by writing the profile back each time it disappears, twice. Both sweeps catch it, and none remains.
  5. **Auth user.** The caller's own Auth user goes last, so a run that fails earlier can be repeated with the same sign-in. It uses `deleteUser`, not the batch call, so it doesn't share the batch call's once-a-second limit with step 3.
- **Batched and idempotent.** Deletes go through one BulkWriter. Every step looks for what's left, so a repeat call finishes a failed run. After a run that worked, a repeat returns `{sessions_deleted: 0}`; the ID token still verifies for up to an hour after the Auth user is gone. The tests cover a full account (Bob's account beside it is untouched), a repeat call, and a retry after a partial run: the profile already gone, a session doc gone but its meta and pings left, a viewer's Auth user gone but its record left.
- **Returns** `{sessions_deleted}`.
- **The apps** sign out right after it succeeds.
  - The old token can't bring anything back, during the deletion or after it: every other sharer callable refuses it (`requireCurrentSharer`).
  - Device docs need `users/{uid}` to exist (Backend B's rules), so they can't come back either.
- **Index.** Finding sessions by owner is a collection-group query on `private.user_id`, which uses the field override in `firestore.indexes.json`.

## Rules

`firestore.rules` denies everything by default. Functions use the Admin SDK and bypass the rules; they alone create, end and delete sessions and write `users`, `call_active`, `call_ended_at`, `cleaned_at`, `callLogs` and `viewerSignIns`. Callers are a phone-signed-in sharer, or a viewer page's custom sign-in from `redeemLinkToken` with the claims `{sid, role}`: role `viewer` for the first browser (`private/meta.viewer_uid`), `watcher` for every later one.

Two terms the matrix uses:
- **Live** means status `active` and before both `stop_at` and `expires_at`. A session past either is over even before the stop job marks it stopped (x-decisions Q-SESSION-END).
- **Share back open** means live, plus `share_back_allowed`, `call_active`, `call_ended_at == null`, and `last_ping_at` under 2 minutes old.

| Path | Allowed | Everything else is refused, including |
| --- | --- | --- |
| `users/{uid}` | owner: get (and listen) | every client write: saveProfile and the session functions write it |
| `users/{uid}/devices/{id}` | owner: get, delete; create and update only while `users/{uid}` exists (a deleted account's still-valid token can't bring a device back), as exactly the shared `Device` with `updated_at` = server time (no Live Activity token on Android) | list, anyone else |
| `users/{uid}/trustedContacts/{id}` | nothing (v2) | |
| `shareSessions/{id}` | owner: get. Viewer and watcher of that session: get, live or ended (for the ended state). Owner, while live: update only `last_ping_at` (= server time), `last_fix_at` (a timestamp, only forward, at most 60 s ahead), `ping_interval_s` (0 < x ≤ 60), `precision` / `precision_next`, the stop rule fields (a timer is `min(now + stop_minutes, expires_at)` within 60 s, in the future, never past `expires_at`, and exactly `expires_at` when now plus the minutes would pass it; the limit is exactly `expires_at`; "when the call ends" only on a call share whose call hasn't ended) `share_back_requested_at` (once, = server time, during the call, after the link was opened, with share back allowed) and `place` (see Place below). The viewer: update only `viewer_sharing`, to true while share back is open, to false at any time | list, create, delete; `status`, `ended_at`, `end_reason`, `call_active`, `call_ended_at` and every other field; watchers' writes |
| `.../private/meta` | owner: get; while live, update only `activity_push_token` | viewer and watcher; any other doc under `private` |
| `.../pings/{id}` | owner: read at any time; create while live (judged as the batch leaves the session), in one batch with the check-in (`last_ping_at` = server time) and `last_fix_at` = its `recorded_at` (x-decisions Q-PING-WRITE): exactly `{lat, lng, recorded_at, accuracy_m}`, `lat` −90…90, `lng` −180…180, `0 ≤ accuracy_m ≤ 100 000` (≥ 500 while Approximate, so a batch applying `precision_next` counts), `recorded_at` at most 60 s ahead of the server, at least 2 s after the session's `last_fix_at` (the first: at most 5 min before `started_at`), and an id of 1–64 `[A-Za-z0-9_-]`. Viewer and watcher: get and list while live | update, delete; viewer reads once the session is over; a ping alone, out of order, or under 2 s after the last |
| `.../viewerPings/{id}` | owner: read. The viewer: create while share back is open and `viewer_sharing` is true as written in the same batch, exactly a ping with the same field and id bounds (no spacing yet) | watchers, the sharer writing, update, delete |
| `.../viewerSignIns/{uid}`, `callLogs/{id}` | nothing: function-only | |
| `mascots/{id}` | anyone, signed in or not: get and list | writes (seeded from the shared catalog) |

The rules can't check the 500 m rounding of `lat` and `lng`; that stays on the phone.

**Pings: order and rate** (x-decisions Q-PING-WRITE, constants in the shared schema). Each ping's `recorded_at` comes at least `MIN_PING_SPACING_SECONDS` (2) after the last, and at most `PING_CLOCK_SKEW_SECONDS` (60) ahead of the server. So pings arrive in order, a client can't write faster than one per 2 s beyond a 60 s burst (at most about 1 800 in a session's hour), and an offline backlog, which keeps its spacing, still lands. The FSD §7 cadence is 3–60 s. A retried batch that already landed is refused (its `recorded_at` isn't ahead of `last_fix_at` any more); the apps count that refusal as written when `last_fix_at` ≥ its `recorded_at`. The ping id is checked through `request.resource.id`: on a REST create that leaves the id to the server, the emulator can't evaluate the path's `{pingId}`.

**Place: where the sharer is, in words** (x-decisions Q-PLACE; owner decision Oct 19, no Google). The sharer's phone reverse-geocodes its own fix (Android `Geocoder`, iOS `CLGeocoder`) and writes `shareSessions/{id}.place` = `{name, street, area, city, at}`; the viewer reads it with the session and calls no geocoder. The phone looks up at most once per `PLACE_LOOKUP_MIN_SECONDS` (10) and only after moving `PLACE_LOOKUP_MIN_METERS` (25), at once on a precision change, and writes only when the place changed: in a ping's batch with `at` = that ping's `recorded_at`, or on its own with `at` no later than `last_fix_at`. The rules hold every write to exactly those five keys; each of `name`, `street`, `area`, `city` null or 1–`PLACE_PART_MAX_LENGTH` (80) characters (the rules' `size()` counts UTF-16 code units) with no control character, no bidi override or isolate (U+202A–U+202E, U+2066–U+2069) and no space at either end (the shared `PlacePart`); at least one part set; `at` a timestamp no later than `last_fix_at` as written (so never before the first ping) nor 60 s past the server's time; null clears it. Approximate: whenever the precision after the write (`precision_next` if set, else `precision`) is approximate, `name` and `street` must be null. That's checked on every sharer update, not only when `place` changes, so the write that turns Approximate on also drops them (keep `area`, `city` and `at`, or write null). Only the sharer writes it, only while live. Every end sets it to null (Session lifecycle below), so the ended doc the viewer still reads holds no place; between `stop_at` or `expires_at` and the stop job, readers already treat the session as ended and don't show it. createSession writes null; sessions from before it omit it (read as null). The shared schema's `PlacePart` counts code points, so it never refuses a part the rules took (a session read by the functions never turns malformed over its place).

**Reading an ended session** (x-decisions Q-READ-ENDED). From the earlier of `stop_at` and `expires_at`, every reader treats the session as ended, even while `status` still says `active`: `end_reason` `limit` when that time is `expires_at`, otherwise `timer`, and `ended_at` that time, which is what the stop job writes. At that moment the rules refuse the viewer's ping reads (a live listener gets permission-denied) and every sharer write, and redeemLinkToken answers `session_ended`. The viewer keeps reading the session doc (status, end, sharer) and never a location: its `place` is null from the end.

`rules.test.ts` has an allow test and a deny test for every path. Each kind of caller is covered: signed out, the sharer, another sharer, an anonymous sign-in with the sharer's uid, the viewer, a watcher, a viewer page of another session, a page posing as the viewer, and viewer claims on a non-custom sign-in. It also tests sessions that are stopped, past `expires_at` or past `stop_at`, and `place` at every boundary: its shape, each part's length and characters, `at` against `last_fix_at` and the clock, the Approximate rule through `precision_next` and in a ping's batch, and that the shared schema is never stricter. Its seed docs are checked against the shared schema. `sessions.test.ts`, `lifecycle.test.ts` and `createSession.test.ts` check that every end clears `place`: stopSession (now, past the timer, past the limit), reportCallEnded, the stop job at the timer and the limit and on a malformed session, the watchdog, and createSession ending a session behind a stale pointer. Backend A's `redeemLinkToken.test.ts` repeats the viewer checks with real minted tokens.

## Session lifecycle

Every path that ends a session goes through `sessions/end.ts`, which does three things in one transaction: it sets `status`, `ended_at` and `end_reason` (and `cleaned_at` null), turns `viewer_sharing` off, sets `place` to null (the viewer still reads the ended doc; x-decisions Q-PLACE), and clears `users.active_session_id` if it still points there. A session already past `stop_at` or `expires_at` always ends as `timer` at `stop_at` or `limit` at `expires_at`, whoever ends it. A session doc that fails the shared schema check is never left active: createSession (when the pointer names it) and the stop job (when it's due) end it from its raw fields, at the earliest of its `stop_at`, `expires_at` and now, as `timer` if the timer came first and otherwise `limit`, and log an error (x-decisions Q-MALFORMED-SESSION).

**Callables** (phone sign-in, the session's owner; not-found for anyone else's session; contracts in the shared schema):

| Callable | What it does | Refusals (failed-precondition `details.reason`) |
| --- | --- | --- |
| `stopSession {session_id}` | Stop: `end_reason` `stopped`. Idempotent; an ended session returns how it ended. | none |
| `reportCallEnded {session_id, call_id}` | Sets `call_ended_at`, `call_active` false, `viewer_sharing` false. With the call stop rule it also ends the session as `call`; with a timer it keeps going. Idempotent. | `no_call`, `call_mismatch` |
| `reportCallActive {session_id, call_id}` | After a signal gap, while the same call is connected: `call_active` true again and a check-in. Never once `call_ended_at` is set. Idempotent. | `session_ended`, `no_call`, `call_mismatch`, `call_ended` |
| `discardSession {session_id}` | The share sheet closed without a choice: deletes the session, meta, pings and the call log, and clears the pointer. If the final delete fails, what's left is an ended session the jobs remove. | `link_opened` |

**Scheduled functions.** Each one is idempotent, pages through its query 100 docs at a time with a cursor, and runs one transaction per session, so one failure doesn't stop the rest; a run with failures throws, and the next run retries. Each uses Cloud Scheduler's `scheduleTime` as its clock. The Functions emulator doesn't run them (there's no Pub/Sub emulator), so `lifecycle.test.ts` calls each handler directly with `.run({scheduleTime})`, and on the dev set the dev scheduler runs them.

| Function | Schedule | What it does |
| --- | --- | --- |
| `stopDueSessions` | every minute | Ends active sessions past `expires_at` (`limit`) or `stop_at` (`timer`), at that time. |
| `callWatchdog` | every 2 minutes | `last_ping_at` over 2 minutes old: `call_active` and `viewer_sharing` false. A call-rule session 10 minutes after that (12 minutes without a check-in): ends as `call`. |
| `cleanupEndedSessions` | every 15 minutes | 24 h after the end: deletes the viewer and watcher Auth users recorded in `viewerSignIns` (deleteUsers, 1000 a call, a second apart), then `pings`, `viewerPings` and `viewerSignIns`, and sets the session's `cleaned_at`. Each run takes stopped sessions with `cleaned_at` null and `ended_at` at least 24 h ago, so a session ended late, with `ended_at` set back to when it was due, is still cleaned on the next run (x-decisions Q-CLEANUP-MARK). It also clears `private/meta.activity_push_token`. |
| `purgeEndedSessions` | every hour | 30 days after the end: deletes the session with everything under it, and `callLogs/{id}`, plus any viewer Auth user still left. |
| `sweepRetention` | every 24 hours | The retention backstop; see [Retention](#retention). |

The queries use the composite indexes in `firestore.indexes.json`: `(status, expires_at)`, `(status, stop_at)`, `(status, call_active, last_ping_at)`, `(status, stop_rule, last_ping_at)`, `(status, cleaned_at, ended_at)` and `(status, ended_at)`.

### The dev scheduler

`scripts/dev-scheduler.sh` (`functions/scripts/dev-scheduler.mjs`) runs the scheduled functions against the dev set, so dev sessions end at their timer and at the 1-hour limit, as they will in production. `./run.sh` starts it with the dev emulators and stops it with them; to add it to a dev set that's already up, run `code/backend/scripts/dev-scheduler.sh`.

- It runs the compiled handlers from `functions/lib`, as `lifecycle.test.ts` does, with `scheduleTime` = now: `stopDueSessions` every tick (`--interval`, default 5 s, or `DEV_SCHEDULER_INTERVAL_S`), `callWatchdog` every 2 minutes, `cleanupEndedSessions` every 15, `purgeEndedSessions` every hour and `sweepRetention` every 24 hours, all of them on the first tick. `--once` runs one tick.
- It prints one line per change, such as `12:04:05 session <id> ended (end_reason: limit, the 1-hour limit)`; the jobs' info tallies are left out, their warnings and errors shortened.
- When `functions/lib/index.js` is rebuilt, it exits with status 75 once the build has settled, and the launcher starts it again on the new code. If lib doesn't load (a broken build), it waits for the next build.
- It refuses to start off the emulators: the project must be a `demo-` one, and `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` must be set. It refuses the test project too, whose tests run the handlers themselves; `--allow-test-project` is only for its own test.
- If Firestore stops answering, it says so once and carries on when it's back.

## Retention

FSD §8 Retention, rule by rule, and what enforces it. Audited in Sprint 2; `tests/src/retention.test.ts` tests each window exactly at its boundary and a millisecond short of it.

| FSD rule | Enforced by | Window |
| --- | --- | --- |
| Pings and viewer pings: deleted 24 h after the session ends | `cleanupEndedSessions`, through the session doc. `sweepRetention` deletes any left under a session doc that's gone | `ended_at` ≤ run − 24 h. Left behind: `recorded_at` ≤ run − 25 h |
| Viewer sign-ins (one Auth user per browser): deleted with the session's cleanup | The same two jobs. The Auth user goes before its `viewerSignIns` doc, the only record of its uid | As above. Left behind: `created_at` ≤ run − 25 h |
| Session metadata: kept 30 days, then purged | `purgeEndedSessions`: the session doc, `private/meta`, `alerts`, and everything else under it | `ended_at` ≤ run − 30 d |
| Call logs: kept 30 days | `purgeEndedSessions` deletes `callLogs/{id}` with its session. `sweepRetention` deletes one whose session is gone | Left behind: `call_time` ≤ run − 30 d − 1 h |
| Device push tokens: deleted at sign-out or when they stop working | The app deletes its doc at sign-out. An alert deletes a token FCM rejects. `sweepRetention` deletes devices not rewritten for 270 days, after which FCM treats a token as expired | `updated_at` ≤ run − 270 d |
| The session's Live Activity token (not in the FSD's list; it stops working when the session ends) | `cleanupEndedSessions` sets `private/meta.activity_push_token` to null | At the 24 h cleanup |
| Deleting the account overrides all of the above | `deleteAccount` | At once |

- **sweepRetention** runs every 24 hours, as the backstop. The cleanup and the purge find their work through session docs. This job finds what a deletion that stopped part way can leave, such as discardSession's last step or a deleteAccount run that wasn't repeated.
  - Its 25 h and 30 d + 1 h windows are the retention plus the 1-hour session limit, so nothing that's still within retention is old enough to match.
  - It still reads each parent session. It keeps data whose session is live or ended more recently, because a phone whose clock is behind writes old `recorded_at` values.
  - Its collection-group queries use the field overrides in `firestore.indexes.json`: `pings.recorded_at`, `viewerPings.recorded_at`, `viewerSignIns.created_at` and `devices.updated_at`. Each override keeps the collection-scope indexes.
  - Each of its four sweeps runs even if another fails, and the run then throws.
- **Overlap.** Every job is safe to run twice, or at the same time as another.
  - A write whose doc another job or the app already deleted or changed is skipped, not counted as a failure (`unlessGoneOrChanged` in `jobs/run.ts`). Examples: the cleanup marking a session the purge just deleted, or the sweep deleting a stale device the app just rewrote.
  - Deletes go through one BulkWriter per run, which batches and paces them under Firestore's limits, and pages are 100 docs.
- **Not location data, so kept until the 30-day purge:** the session doc (`last_ping_at` is a time, not a place), `private/meta`, and the alert marker.

## When the real project exists

The user creates it by Oct 27. Then:

1. **Project id.** `firebase use --add <project-id>` (it writes `.firebaserc`), and add `functions/.env.<project-id>` with `VIEWER_ORIGIN=https://trackme.live` (FSD §6), or `https://<site>.web.app` until the domain is connected. `.gitignore` here un-ignores only the demo file; add a matching `!functions/.env.<project-id>` line. Secrets go in Secret Manager (`defineSecret`), never in `.env` files.
2. **Billing.** Upgrade to the Blaze plan; Cloud Functions and phone Auth's SMS need it. Set a budget alert.
3. **Locations.** The user decides: `asia-south1` if most users are in India, otherwise `us-central1`. It must be settled before the first deploy, because the Firestore location can never change. The functions region goes next to it in `src/index.ts`, which uses `us-central1` today.
4. **Auth.** Enable the Phone provider, set the SMS region policy to the launch countries, and add test phone numbers for QA. Add App Check (App Attest, Play Integrity, reCAPTCHA Enterprise for the viewer), then turn on `enforceAppCheck` for the callables. redeemLinkToken's `createCustomToken` signs with the functions' service account through IAM `signBlob`. Grant that account the Service Account Token Creator role (`roles/iam.serviceAccountTokenCreator`) on itself, or every redeem fails as `internal`.
5. **Apps.** Register the iOS, Android and web apps. `GoogleService-Info.plist` and `google-services.json` stay out of git (the root `.gitignore` already ignores them). Upload the APNs auth key for FCM.
6. **Deploy.** Run `firebase deploy --only firestore:rules,firestore:indexes,functions,hosting`. The `predeploy` hooks lint and build the functions. Hosting serves `../viewer/dist`; the emulator accepts a public directory outside the project folder, but check it on the first real deploy.
7. **Tests stay on the emulators.** Keep `demo-trackmelive` for local work and CI; a `demo-` project id can never touch real resources.

## Open questions

The lead's Oct 18 decisions settled these: client creates (none), one session at a time (`users.active_session_id`), re-setting `call_active` (`call_ended_at`, and `reportCallActive` after a signal gap), `end_reason` at the limit (`limit`), the viewer sign-in (a custom token with `{sid, role}`), name length (graphemes) and characters, the first `ping_interval_s` (5), the Approximate accuracy floor (500 m), when viewer Auth users are deleted (the 24 h cleanup), and ending a stale session (createSession ends it on the spot). They're marked "(decided Oct 18; confirm)" in the FSD and in the schema's `x-decisions`. Still open:

1. **Region and data residency.** `asia-south1` or `us-central1`, before Oct 27. The Firestore location is permanent.
2. **Android name length.** Android must count graphemes too; a plain `maxLength` filter counts UTF-16 units.
3. **Abuse and cost.** The FSD doesn't cover SMS pumping, rate limits on `createSession` and `redeemLinkToken`, or App Check. These should be decided before launch.
