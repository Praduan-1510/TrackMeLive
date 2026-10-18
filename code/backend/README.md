# Track Me Live backend

Firebase: Firestore, Cloud Functions, phone-number Auth, and Hosting for the viewer page (FSD §5, §6, §8). Sprint 0 runs entirely on the local emulators against the offline demo project `demo-trackmelive`. No real Firebase project exists yet; see [When the real project exists](#when-the-real-project-exists).

```
code/backend/
  firebase.json            emulators, functions, Firestore and Hosting config
  .firebaserc              default project: demo-trackmelive
  firestore.rules          deny by default, plus the commented Sprint 1 plan
  firestore.indexes.json   composite indexes for the scheduled functions, and the token-hash lookup
  run.sh                   start the emulators
  test.sh                  lint, build, then run every test against the emulators
  scripts/env.sh           shared setup: JDK 21+, ports, the pinned Firebase CLI
  functions/               Cloud Functions (TypeScript, Node 22 runtime)
    src/index.ts           global options, exports
    src/createSession.ts   the createSession callable
    src/contracts.ts       request parsing and the sharer snapshot, on top of the shared schema
    src/shared/schema.ts   copy of code/shared/schema/generated/ts/schema.ts (gitignored; made by the build)
    scripts/sync-schema.mjs  makes that copy
    .env.demo-trackmelive  params for the demo project (VIEWER_ORIGIN)
  tests/                   emulator tests (node:test, run as TypeScript by Node's type stripping)
    src/rules.test.ts         Firestore rules
    src/createSession.test.ts createSession over the callable protocol
    src/contract.test.ts      the functions build against the shared schema
    src/emulators.ts          emulator hosts, Auth REST helpers, callable helper
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
| `./run.sh` | Builds the functions and starts Auth, Firestore, Functions and the Emulator UI. It adds Hosting when `code/viewer/dist/index.html` exists. Extra arguments go to `firebase emulators:start`, e.g. `./run.sh --import .emulator-data --export-on-exit`. Stop with Ctrl-C. |
| `./test.sh` | Lints and builds the functions, type-checks the tests, then runs every test. It reuses the emulators if `./run.sh` is running; otherwise it starts Auth, Firestore and Functions just for the run (`emulators:exec`) and stops them afterwards. |
| `./test.sh src/rules.test.ts` | Runs one test file (paths are relative to `tests/`). |
| `npm --prefix functions run build:watch` | Rebuilds on save. The running Functions emulator reloads `lib/` by itself. |
| `npm --prefix functions run lint` | ESLint (type-aware typescript-eslint) plus `tsc --noEmit`. |
| `npm --prefix functions run sync:schema` | Refreshes `src/shared/schema.ts` from the shared schema. `build` and `lint` already run it. |

The Firestore emulator reloads `firestore.rules` on save, and the rules tests load the file fresh on each run.

## Emulator ports

All emulators listen on `127.0.0.1`.

| Emulator | Port |
| --- | --- |
| Emulator UI | 4000 |
| Auth | 9099 |
| Firestore | 8080 (UI websocket 9150) |
| Functions | 5001 (`http://127.0.0.1:5001/demo-trackmelive/us-central1/createSession`) |
| Hosting | 5050. The default, 5000, is taken by macOS AirPlay Receiver (and 7000 too). |
| Hub, Logging, Eventarc, Cloud Tasks | 4400, 4500, 9299, 9499 |

To reach the emulators from the apps: the iOS simulator uses `127.0.0.1`, and the Android emulator uses `10.0.2.2`, which maps to the host's loopback. A physical phone needs the emulators bound to `0.0.0.0` in `firebase.json` plus the Mac's LAN address in the app. On a demo project the Auth emulator prints each phone sign-in code in the terminal and the UI, and `tests/src/emulators.ts` reads it from the emulator REST API.

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
- **Input.** `stop_rule` (`call`, `minutes` or `limit`), `stop_minutes` (15, 30 or 60 with `minutes`, otherwise null), `call_id` (null for a manual share), `share_back_allowed` (forced to false without a call), `precision`, and an optional `viewer_name`. The name is trimmed and may be 1–24 grapheme clusters (characters as people see them, as in the shared `PersonName`); a blank name means none. Unknown keys are rejected, so the request can never name an owner. Errors come back as `invalid-argument` with `details.errors[]` listing each `{field, message}`.
- **One session at a time.** If `users/{uid}.active_session_id` points at a session that is still active and before its `expires_at`, the call fails with `already-exists` and `details: {reason: "active_session", session_id}`. A stale pointer doesn't block: the session stopped, passed its limit, or is gone. The check and the writes are one transaction, so of two simultaneous calls exactly one wins.
- **Writes, in that transaction:**
  - `shareSessions/{id}`: every `ShareSession` field. That's `status: "active"`, `started_at` = server now, `expires_at` = `started_at` + 1 h, `stop_rule` and `stop_minutes`, `stop_at` (now plus the minutes, capped at `expires_at`; `expires_at` for `limit`; null for `call`), `call_active` = whether there's a call, `last_ping_at` = `started_at`, `ping_interval_s` = `INITIAL_PING_INTERVAL_SECONDS` (5) until the first ping, and the `sharer` snapshot from `users/{uid}`. Every other field, `call_ended_at` and `precision_next` included, is null or false.
  - `shareSessions/{id}/private/meta`: `user_id` = the caller's uid, `link_token_hash` = SHA-256 (lowercase hex) of the token, `viewer_name`, and `viewer_uid` and `activity_push_token` as null.
  - `users/{uid}`: `active_session_id` = the new session, `updated_at` = server time, and `last_viewer_name` when a name is given.
- **Returns** `{session_id, link_token, link_url, started_at, expires_at}`, with times in epoch ms. `link_token` is 128 random bits in base64url (22 characters, the shared `LinkToken`). It's returned once and never stored. `link_url` is `VIEWER_ORIGIN` + `/s/` + the token.
- **Sprint 1 TODO:** the stop function that clears `active_session_id`, `redeemLinkToken`, App Check, and a `callLogs` entry for call-triggered shares.

## Rules (Sprint 0)

Everything is denied by default. Sessions are created only by `createSession`, which uses the Admin SDK and so bypasses the rules; no client creates, changes or deletes a session. Two things are allowed:

1. **Reading your own session.** A phone-signed-in sharer can `get` their own `shareSessions/{id}` and its `private/meta`. Ownership is read from `private/meta.user_id` (FSD §6: "readable by the sharer").
2. **Writing pings.** A sharer can create `pings` in their own live session: status active and before `expires_at`. A ping is exactly `lat`, `lng`, `recorded_at` and `accuracy_m`, all in range, with `recorded_at` no more than a minute ahead of server time. **While the session is Approximate, `accuracy_m` must be at least 500** (decided Oct 18), so a ping never reveals more than the viewer sees. The app writes `max(raw GPS accuracy, 500)`; the rules refuse anything below. The rule reads the session with `getAfter()`, so in Sprint 1 a batch that applies `precision_next` together with a ping is judged by the precision it sets. The rules can't check the 500 m rounding of `lat` and `lng` itself; that stays on the phone.

The tests prove:

- every collection denies reads and writes, whether signed out, signed in as a sharer, or signed in as a viewer;
- nobody can list sessions;
- a sharer can't create a session directly, not even their own, and can't change, delete or take over one;
- a sharer can read their own session and meta but not someone else's;
- an anonymous sign-in with the same uid isn't a sharer;
- ping writes:
  - a precise session takes any accuracy;
  - an Approximate session refuses 4.7, 100, 499 and 499.99 m and takes 500 and 850 m;
  - the floor applies from the ping after a switch to Approximate;
  - a ping with a bad shape or out-of-range values is refused;
  - pings are refused on a stopped or expired session, and from another sharer, a viewer or a stranger.

`createSession.test.ts` covers the other half of "a sharer can create only their own session": the owner always comes from the auth token. The seed docs the rules tests use are checked against the shared schema too.

The Sprint 1 rules for each collection in §6, with §8's retention and deletion, are written out as comments at the bottom of `firestore.rules`.

## When the real project exists

The user creates it by Oct 27. Then:

1. **Project id.** `firebase use --add <project-id>` (it writes `.firebaserc`), and add `functions/.env.<project-id>` with `VIEWER_ORIGIN=https://trackme.live` (FSD §6), or `https://<site>.web.app` until the domain is connected. `.gitignore` here un-ignores only the demo file; add a matching `!functions/.env.<project-id>` line. Secrets go in Secret Manager (`defineSecret`), never in `.env` files.
2. **Billing.** Upgrade to the Blaze plan; Cloud Functions and phone Auth's SMS need it. Set a budget alert.
3. **Locations.** The user decides: `asia-south1` if most users are in India, otherwise `us-central1`. It must be settled before the first deploy, because the Firestore location can never change. The functions region goes next to it in `src/index.ts`, which uses `us-central1` today.
4. **Auth.** Enable the Phone provider, set the SMS region policy to the launch countries, and add test phone numbers for QA. Add App Check (App Attest, Play Integrity, reCAPTCHA Enterprise for the viewer), then turn on `enforceAppCheck` for the callables.
5. **Apps.** Register the iOS, Android and web apps. `GoogleService-Info.plist` and `google-services.json` stay out of git (the root `.gitignore` already ignores them). Upload the APNs auth key for FCM.
6. **Deploy.** Run `firebase deploy --only firestore:rules,firestore:indexes,functions,hosting`. The `predeploy` hooks lint and build the functions. Hosting serves `../viewer/dist`; the emulator accepts a public directory outside the project folder, but check it on the first real deploy.
7. **Tests stay on the emulators.** Keep `demo-trackmelive` for local work and CI; a `demo-` project id can never touch real resources.

## Open questions

The lead's Oct 18 decisions settled these: client creates (none), one session at a time (`users.active_session_id`), re-setting `call_active` (`call_ended_at`), `end_reason` at the limit (`limit`), the viewer sign-in (a custom token with `{sid, role}`), name length (graphemes), the first `ping_interval_s` (5), and the Approximate accuracy floor (500 m). They're marked "(decided Oct 18; confirm)" in the FSD. Still open:

1. **Region and data residency.** `asia-south1` or `us-central1`, before Oct 27. The Firestore location is permanent.
2. **When viewer Auth users are deleted.** §8 says "with the session's cleanup". That could be the 24 h ping cleanup or the 30-day metadata purge; the 24 h pass seems the better fit, since after the end the viewer reads only the session doc.
3. **Android name length.** Android must count graphemes too; a plain `maxLength` filter counts UTF-16 units.
4. **Ending a stale session.** A session past `expires_at` that the scheduled stop hasn't reached yet doesn't block a new share. Should createSession also stop it on the spot, so `end_reason` and the alerts aren't late?
5. **Abuse and cost.** The FSD doesn't cover SMS pumping, rate limits on `createSession` and `redeemLinkToken`, or App Check. These should be decided before launch.
