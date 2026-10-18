# Track Me Live: code

The v1 codebases. The spec is `../Track Me Live — FSD.md`; the screen reference is `../prototype/`; design tokens come from `../design-system/tokens.json`.

## Layout and owners

| Folder | What it is | Owner (Sprint 0) |
| --- | --- | --- |
| `shared/` | Contracts every codebase builds on: design tokens and the Firestore schema, generated for Swift, Kotlin, TypeScript and CSS. No dependencies. | Shared-contracts agent |
| `viewer/` | The web page a viewer opens from a share link: TypeScript + Vite, no UI framework. | Shared-contracts agent |
| `ios/` | The sharer app for iPhone: SwiftUI, iOS 26+. Shared Swift lives in the `TMLCore` package (`ios/Packages/TMLCore`). | iOS agent |
| `android/` | The sharer app for Android: Kotlin, Jetpack Compose, Material 3. | Android agent |
| `backend/` | Firebase: Cloud Functions, Firestore rules and indexes, Hosting. | Backend agent |
| `qa/` | The quality gate's checks (secrets, hidden characters, style, generated files, the Xcode build) plus the Sprint 2 sharing harness: simulated routes (`qa/routes`), a fake sharer (`qa/fake-sharer`) and the share → view → stop e2e (`qa/e2e-sharing`). | Quality-gate and QA agents |
| `spikes/` | Throwaway experiments that answer one question each (e.g. `android-call-detect`, the FSD §8 audio-mode check). Nothing ships from here. | Spike agent |

## Run each codebase

| Codebase | One command | Notes |
| --- | --- | --- |
| Shared contracts | `npm --prefix code/shared run build` | Regenerates tokens and schema types. `npm --prefix code/shared run check` fails if anything generated is stale; run it in CI. |
| Viewer | `npm --prefix code/viewer run dev` | Serves http://localhost:5173. First time: `npm --prefix code/viewer ci`. Preview any state with `?state=<name>` (loading, offer, not-now, asked, denied, both, lost, call-ended, ended, expired, invalid, map-failed and the rest; the full list is in `viewer/src/sample/scenarios.ts`) plus `?theme=light` or `?theme=dark`. **A real session:** a share link `/s/<token>` talks to the Firebase emulators in every mode but a production build (the dev set by default, so start `code/backend/run.sh` first; another set with `VITE_TML_PROJECT_ID`, `VITE_TML_EMULATOR_HOST`, `VITE_TML_AUTH_PORT`, `VITE_TML_FIRESTORE_PORT`, `VITE_TML_FUNCTIONS_PORT`; see `viewer/src/session/firebase/config.ts`). So with `code/backend/run.sh` and `npm --prefix code/viewer run dev` running, open the link the apps share (the dev set's links point at http://localhost:5173), or the one `node code/qa/fake-sharer/src/cli.ts` prints (`--help` for routes, Last seen, Stop, timer and limit endings). A link that names another origin (the test set's say `http://127.0.0.1:5050`, the Hosting emulator, whose copy is a production build that never talks to the emulators): open `http://localhost:5173/s/<token>` with the same token, the dev server started with that set's `VITE_TML_*` values. Street names need a Maps key in `code/viewer/.env.local` (`VITE_MAPS_API_KEY=…`, git-ignored); without one the page says where in coordinates. A production build takes the real project from `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` (and `VITE_FIREBASE_AUTH_DOMAIN`); without them a share link can't be opened. Tests: `npm --prefix code/viewer test`, `npm --prefix code/viewer run test:e2e` (the sample), and real sessions on the test emulators (JDK 21): `code/backend/scripts/with-test-emulators.sh npm --prefix code/viewer run test:e2e:live`. |
| iOS | `code/ios/run.sh` | Needs Xcode 27 (not installed yet; it stops with setup steps until then). Generates the project from `ios/project.yml` with XcodeGen, builds for an iPhone 17 Pro Simulator, installs, launches and screenshots. `TMLCore` links `shared/` by symlink. Without Xcode: `code/ios/scripts/test-core.sh` and `code/ios/scripts/typecheck.sh`. See `ios/README.md`. |
| Android | `code/android/run.sh` | JDK 17, compile/target SDK 36, min SDK 29. Builds, installs and launches on the running Pixel_9 emulator, booting it with a window if needed. Sign-up talks to the Firebase emulators (start the backend's `run.sh` first); `code/android/scripts/sign-in.sh` drives a fresh install to Home. See `android/README.md`. |
| Backend | `code/backend/run.sh` (emulators) and `code/backend/test.sh` (tests) | JDK 21 for the Firebase emulators, Node 22 runtime, demo project `demo-trackmelive`. Emulator UI on http://127.0.0.1:4000. `run.sh` also starts the dev scheduler, which ends sessions at their timer and the 1-hour limit (the Functions emulator never runs scheduled functions); next to a dev set that's already up, run `code/backend/scripts/dev-scheduler.sh`. Tests never touch the dev set: they run on their own emulators (project `demo-trackmelive-test`, Auth 9199, Firestore 8180, Functions 5101), and `code/backend/scripts/with-test-emulators.sh <command>` lends that set to any suite. The functions build syncs `shared/schema` into `functions/src/shared/`. See `backend/README.md`. |
| QA harness | `node code/qa/fake-sharer/src/cli.ts` | A stand-in for Alex's phone on the dev emulators: signs in a test user, starts a real session, pings along a route and prints the viewer link (`--help` for routes, Last seen, Stop, timer and 1-hour endings). The Gate G2 e2e: `code/backend/scripts/with-test-emulators.sh npm --prefix code/qa/e2e-sharing test` (Chrome follows a route; the ping rules), and `npm --prefix code/qa/e2e-sharing run test:android` on the Pixel_9 emulator. Checklist and details in `qa/e2e-sharing/README.md`. |
| Spikes | `code/spikes/android-call-detect/scripts/emulator-run.sh` | Android call detection. Results and the real-device test plan are in `spikes/android-call-detect/RESULTS.md`. |

All commands run from the repo root unless noted.

## Shared contracts

Never edit the generated files by hand: change the source, then run the build.

### Design tokens: `shared/tokens/`

Source: `design-system/tokens.json`. Generator: `node code/shared/tokens/build.mjs`; `--check` to verify.

| Output | For | Main names |
| --- | --- | --- |
| `generated/swift/TMLTokens.swift` | iOS (`TMLCore`) | `TMLColor.<token>` (SwiftUI `Color`, switches light/dark through a dynamic `UIColor`), `TMLColorToken` (raw `.light`/`.dark`, `.lightHex`/`.darkHex`, `.usage`), `TMLSpacing`, `TMLRadius`, `TMLShadow`, `TMLType.<style>` + `.tmlTextStyle(_:)` (Gabarito for display styles, SF Pro for text, both scaled with Dynamic Type) |
| `generated/kotlin/TmlTokens.kt` | Android, package `live.trackme.design` | `TmlColorTokens`, `TmlColors` / `TmlLightColors` / `TmlDarkColors`, `TmlLightColorScheme` / `TmlDarkColorScheme` (Material 3 roles), `TmlSpacing`, `TmlRadius`, `TmlAndroidRadius`, `TmlShadows`, `TmlTypeScale`, `tmlTypography()`, `TmlTheme { }` |
| `generated/css/tokens.css` | Viewer | Same rules as `design-system/tokens.css` (from `design-system/tools/build-tokens.mjs`) plus a usage comment per token |

Every token keeps its `usage` note as a doc comment. `--check` also fails when `design-system/tokens.css` no longer matches `tokens.json` (run `node design-system/tools/build-tokens.mjs`).

### Firestore schema: `shared/schema/`

Source: `shared/schema/schema.json`, JSON Schema 2020-12 for every FSD §6 collection, field by field, with enums for `status`, `stop_rule`, `end_reason`, `precision` and the mascot ids, sets, colors and accessories, plus the `createSession` callable payloads. Its `x-open-questions` lists what the FSD leaves undecided. Generator: `node code/shared/schema/build.mjs`; `--check` to verify.

| Output | For | Main names |
| --- | --- | --- |
| `generated/ts/schema.ts` | Backend and viewer | `ShareSession<TTime>`, `SessionPrivateMeta`, `User`, `Device`, `Ping` / `ViewerPing`, `Mascot`, `CallLog`, `CreateSessionRequest` / `CreateSessionResponse`, enum value lists and guards, `docPaths` / `collectionPaths`, FSD constants, `MASCOT_CATALOG`, `validate()` / `assertValid()` (no dependencies). Erasable syntax only, so it runs under Node type stripping. |
| `generated/swift/TMLSchema.swift` | iOS (`TMLCore`) | `TMLShareSession`, `TMLSessionPrivateMeta`, `TMLUser`, `TMLDevice`, `TMLPing`, `TMLMascot`, `TMLCallLog`, `TMLCreateSessionRequest` / `Response`: Codable + Sendable, timestamps as `Date`, `Field` coding keys, plus `TMLPaths`, `TMLSchemaConstants`, `TMLMascotCatalog` |
| `generated/kotlin/TmlSchema.kt` | Android, package `live.trackme.schema` | Firestore data classes (`ShareSession`, `SessionPrivateMeta`, `User`, `Device`, `Ping`, `Mascot`, `CallLog`) with `@PropertyName` snake_case fields and `Fields` constants, wire-value enums, `CreateSessionRequest.toMap()` / `CreateSessionResponse.fromMap()`, `TmlPaths`, `TmlSchemaConstants`, `MascotCatalog` |

The Swift folders under `shared/` hold only `.swift` files, because `ios/Packages/TMLCore` links them as sources.

## Conventions

- Firestore field names are exactly as written in FSD §6 (snake_case) on every platform. Every field is written, and "not set yet" is `null`.
- Exact dependency versions only (no `^` or `~`), each published at least two weeks before it's added.
- No secrets in the repo: `GoogleService-Info.plist`, `google-services.json`, `.env*` and keystores are git-ignored (see `../.gitignore`).
