# Track Me Live for Android

Native Kotlin, Jetpack Compose and Material 3, drawn in our tokens. minSdk 29, targetSdk and compileSdk 36.

Sprint 1 has the foundations:
- the three onboarding pages;
- sign-up with a name and a mobile number, confirmed with a 6-digit code (Firebase phone auth), then the profile through the `saveProfile` callable;
- a new account's first mascot pick;
- Home, Mascot and Settings behind a bottom navigation bar, with the profile read live from `users/{uid}`.

Debug builds run against the local Firebase emulators. Where someone got to (onboarded, signed in, set up) and the appearance survive restarts. Light and dark follow the system, and Settings › Appearance can override that. The screens follow the Android mode of the prototype (`prototype/js/android.js`, `prototype/css/android.css`) and the Android section of `design-system/README.md`.

## Run it

```sh
code/android/run.sh                                # build, install, launch
code/android/run.sh --screenshot /tmp/tml.png      # ...and save a screenshot
```

`run.sh` uses the running emulator, or boots the `Pixel_9` AVD with a window if no emulator is running. Then it runs `./gradlew installDebug` and launches `live.trackme.app/.MainActivity`. You can override `JAVA_HOME`, `ANDROID_HOME`, `AVD` or `ANDROID_SERIAL`.

Other commands, all run from `code/android` with JDK 17:

```sh
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./gradlew assembleDebug           # APK in app/build/outputs/apk/debug/
./gradlew installDebug
```

Use `-v 17` because a bare `/usr/libexec/java_home` now returns JDK 21, which the backend installed for the Firebase emulators.

### Against the Firebase emulators

Sign-up and everything after it need the emulators: `code/scripts/with-lock.sh firebase code/backend/run.sh` (Auth 9099, Firestore 8080, Functions 5001, project `demo-trackmelive`). From the Android emulator the Mac is `10.0.2.2`; for a physical phone, build with `-Ptml.emulatorHost=<the Mac's LAN address>` and bind the emulators to `0.0.0.0`. Debug builds allow cleartext only to those hosts (`src/debug/res/xml/network_security_config.xml`).

- Any E.164 number works. No text is sent: the code is in the emulator's log, in the Emulator UI (http://127.0.0.1:4000) and at `GET http://127.0.0.1:9099/emulator/v1/projects/demo-trackmelive/verificationCodes`.
- `code/scripts/with-lock.sh emulator code/android/scripts/sign-in.sh` drives a fresh install from onboarding to Home over adb: Skip, a test number, the code from the REST API, then Continue on the mascot pick. Pass `--name` or `--number` to choose them.
- `adb shell pm clear live.trackme.app` puts the app back to a fresh install.

### Tests

```sh
./gradlew :app:lintDebug :app:testDebugUnitTest :app:assembleDebug   # all must pass with zero warnings
./gradlew :app:connectedDebugAndroidTest                             # on the emulator; skips without the Firebase emulators
```

- **Unit tests** (`src/test`, JUnit 4 on the JVM). They cover the rules: names in graphemes (`Names`), E.164 and countries (`PhoneNumbers`), the resend countdown and the greeting. They also cover every view model against fakes (`src/test/.../fakes`) and the profile repository's optimistic, serialized saves. The ones that need Android (android.icu, Compose) run on Robolectric, pinned to SDK 34 in `src/test/resources/robolectric.properties`: Robolectric needs JDK 21 for SDK 35 and up, and the build runs on JDK 17.
- **Compose UI tests**, also on Robolectric:
  - `SignUpScreenTest` covers the happy path from name to the mascot step, a wrong code, an incomplete number, an empty name, Back, and nothing cut at 200% font.
  - `AppFlowTest` runs the whole app on fakes (`FakeAppContainer`): the real Navigation 3 root and each screen's view model factory, from onboarding through sign-up and the mascot pick to Home.
  - `SignUpStatesScreenshotTest` writes PNGs of the sign-up states the emulators can't produce on demand (expired code, too many tries, profile save failed, interrupted sign-up), light and dark. It runs only with `-Ptml.screenshots=<dir>`.
- **Emulator test** (`src/androidTest`): `FirebaseEmulatorTest` runs the real data layer against the Firebase emulators. It covers phone sign-in with a wrong code first, `saveProfile` create and updates read back through the listener, a restore after signing out and back in, and `deleteAccount`. It's skipped when the emulators aren't reachable.
- Lint runs with `warningsAsErrors`. `app/lint.xml` turns off only the version-nag checks, which our pinning rules contradict, with the reason for each.

## Setup on a new Mac (Apple Silicon)

These are user-level installs, so no sudo or Homebrew is needed. Verify every download against its published checksum.

1. **JDK 17**: Temurin 17 for macOS aarch64, from the Adoptium API (`api.adoptium.net/v3/assets/latest/17/hotspot?architecture=aarch64&image_type=jdk&os=mac`). Check the SHA-256, then untar it into `~/Library/Java/JavaVirtualMachines/`. Confirm with `/usr/libexec/java_home -v 17`.
2. **Android SDK** at `~/Library/Android/sdk`, the default path of the VS Code "Android iOS Emulator" extension:
   - Get the command-line tools zip for mac_arm64 from `dl.google.com/android/repository`. Check its SHA-1 against `repository2-3.xml`, then unzip it to `~/Library/Android/sdk/cmdline-tools/latest`.
   - Install the rest:
     ```sh
     ~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=$HOME/Library/Android/sdk \
       platform-tools emulator "platforms;android-36" "build-tools;36.0.0" \
       "system-images;android-36;google_apis_playstore;arm64-v8a"
     ```
     The new `sdkmanager` is a wrapper around the Android CLI (`cmdline-tools/latest/bin/android sdk`). It accepts each package's license as it installs it and records the license in `sdk/licenses/`.
3. **AVD**:
   ```sh
   echo no | ~/Library/Android/sdk/cmdline-tools/latest/bin/avdmanager create avd -n Pixel_9 \
     -k "system-images;android-36;google_apis_playstore;arm64-v8a" -d pixel_9
   ```
   Our AVD settings, changed in `~/.android/avd/Pixel_9.avd/config.ini` to save disk and use the Mac's GPU: `hw.gpu.mode=host`, `hw.keyboard=yes`, `hw.sdCard=no`, `disk.dataPartition.size=4G`, `PlayStore.enabled=yes`, and no snapshots (`fastboot.forceColdBoot=yes`, `firstboot.saveToLocalSnapshot=no`). A cold boot takes about 50 to 90 seconds.

### What's installed (Oct 18 2026)

| Piece | Version | Size on disk |
| --- | --- | --- |
| Temurin JDK | 17.0.20.1+1 (`~/Library/Java/JavaVirtualMachines/jdk-17.0.20.1+1`) | 309 MB |
| Command-line tools | 23.0 (build 16111833); Android CLI 1.0.16625370 | 172 MB, plus about 150 to 250 MB for the CLI bundle in `~/.android/cli` |
| Platform tools | 37.0.1 | 37 MB |
| Emulator | 37.2.12 | 1.2 GB |
| SDK Platform | android-36, revision 2 | 134 MB |
| Build tools | 36.0.0 | 188 MB |
| System image | android-36 Google Play arm64-v8a, revision 7 (Android 16) | 2.3 GB |
| AVD `Pixel_9` | device `pixel_9`, 2 GB RAM, 4 GB data partition | about 1.6 GB after a session |
| Gradle cache | `~/.gradle` after the first builds | about 1.1 GB |

Licenses accepted while installing: `android-sdk-license` (cmdline-tools, platform-tools, emulator, platform, build-tools) and `android-sdk-arm-dbt-license` (the ARM system image).

## Versions

Every dependency is pinned to an exact version published before Oct 4, 2026. They're in `gradle/libs.versions.toml`.

| What | Version | Published | Why this one |
| --- | --- | --- | --- |
| Gradle wrapper | 9.8.0 (SHA-256 pinned in `gradle-wrapper.properties`) | Sep 24 2026 | Newest stable before the cutoff. AGP 9.4 needs 9.6 or later. |
| Android Gradle Plugin | 9.4.1 | Sep 18 2026 | Newest stable. It has built-in Kotlin, so there's no `org.jetbrains.kotlin.android` plugin. |
| Kotlin Compose compiler plugin | 2.4.20 (`org.jetbrains.kotlin.plugin.compose`) | Sep 7 2026 | Newest stable Kotlin before the cutoff. |
| Compose BOM | 2026.06.01 (Compose 1.11.4, Material 3 1.4.0) | Jul 1 2026 | Newest BOM that builds against compileSdk 36. Compose 1.12, from BOM 2026.08.00 on, requires compileSdk 37. |
| activity-compose | 1.13.0 | Mar 11 2026 | Pulls in androidx.core 1.18.0, the last core that accepts compileSdk 36. Core 1.19 needs 37. |
| build-tools | 36.0.0 | | The AGP 9.4 default. |
| Lifecycle (`viewmodel-compose`, `runtime-compose`, `viewmodel-navigation3`) | 2.10.0 | Nov 19 2025 | ViewModels, `collectAsStateWithLifecycle`, view models scoped to each screen. 2.11 needs compileSdk 37. |
| Navigation 3 (`navigation3-runtime`, `navigation3-ui`) | 1.1.7 | Aug 26 2026 | The back stack is plain state the app owns, which suits a root chosen from stored state. 1.2 needs compileSdk 37. |
| DataStore Preferences | 1.2.1 | Mar 11 2026 | The setup stage and the appearance. |
| Firebase BOM | 34.19.0 (Auth 24.2.0, Firestore 26.6.0, Functions 22.1.1) | Sep 9 2026 | Phone sign-in, `users/{uid}` and the callables. |
| kotlinx-coroutines (`android`, `play-services`, `test`) | 1.11.0 | May 7 2026 | `await()` on Firebase tasks; test dispatchers. |
| libphonenumber | 9.0.40 | Sep 23 2026 | Google's phone metadata: validity per country, E.164, as-you-type formatting, example numbers. |
| maps-compose | 8.3.0 (play-services-maps 20.0.0, maps-ktx 6.0.1) | Apr 10 2026 | Google Maps for the live map (architecture doc: the Maps API). 8.3.1 and later need compileSdk 37. |
| JUnit / Robolectric / androidx.test core, runner / ext-junit | 4.13.2 / 4.17 / 1.7.0 / 1.3.0 | / Sep 10 2026 / Jul 30 2025 / Jul 30 2025 | Tests only. Compose `ui-test-junit4`, `ui-test-manifest` and `ui-tooling(-preview)` come from the Compose BOM. |

Every artifact's date is its POM's publish date on Google Maven or Maven Central. `app/lint.xml` silences lint's "newer version available" checks, because staying behind is deliberate here.

## Layout

```
code/android/
  run.sh                       one command: build, install, launch
  scripts/sign-in.sh           drives a fresh install to Home on the emulator (Firebase emulators)
  tools/export_mascots.py      exports design-system/assets/Mascots into res/ (WebP renders, accessory layers,
                               flat vector heads) and generates ui/mascot/MascotArtTable.kt; --check verifies
  settings.gradle.kts, build.gradle.kts, gradle.properties
  gradle/libs.versions.toml    version catalog
  app/
    build.gradle.kts           :app, applicationId live.trackme.app; shared tokens and schema as source dirs
    lint.xml                   lint config (warnings are errors)
    src/main/java/live/trackme/app/
      TrackMeLiveApplication.kt  builds the AppContainer; tracks the resumed Activity for phone auth
      MainActivity.kt          edge to edge; holds the splash until the stored state has loaded
      Names.kt                 the shared name rule: 1 to 24 graphemes, a letter, no control or bidi characters
      di/AppContainer.kt       manual DI: one instance of each repository per process
      data/firebase/           FirebaseEnvironment (the demo project on the emulators; the seam for the real
                               project) and FirebaseServices (initializes Firebase from code, useEmulator)
      data/auth/               AuthRepository (phone sign-in), AccountRepository (deleteAccount), AccountSession
      data/profile/            ProfileRepository: users/{uid} live, saves through saveProfile, optimistic and serialized
      data/settings/           LocalPreferences (DataStore: setup stage, appearance) and SettingsRepository
      domain/                  PhoneNumbers (libphonenumber), ResendCountdown, Greeting, Clock
      ui/navigation/           AppViewModel (which root screen), TrackMeLiveApp (NavDisplay), MainShell (tabs)
      ui/onboarding/           the three pages, the Live Together map art, the brand mark
      ui/signup/               SignUpViewModel, the two steps, the code boxes, the country sheet, the text field
      ui/home/                 HomeViewModel and Home
      ui/routes/               view models and wiring for the mascot picker and Settings
      ui/components/, ui/mascot/, ui/settings/   shared components, the mascot picker and Settings (see their KDoc)
      ui/Type.kt               Gabarito and Figtree, and the Android type roles
    src/main/res/values/strings_*.xml   strings per feature
    src/main/res/drawable-nodpi/mascot_*.webp, drawable/mascot_flat_*.xml   mascot art (tools/export_mascots.py)
    src/debug/                 cleartext to the Firebase emulators, debug builds only
    src/test/                  unit and Robolectric tests, fakes
    src/androidTest/           the emulator test
```

## Architecture

- **One direction.** Repositories own data and expose `StateFlow`/`Flow`. View models turn it into immutable UI state (`StateFlow`) and take events. Composables only draw state and send events; the rules (names, numbers, countdowns, greetings) live in `domain/` and the view models, never in a composable. The text fields are the exception that proves it: their values are Compose state in the view model, written synchronously from each keystroke, as Compose recommends, because a Flow round trip can drop keystrokes.
- **Dependencies.** `di/AppContainer` builds each repository once per process. View model factories take the container as a parameter (`XViewModel.factory(LocalContext.current.appContainer)`). They don't read `APPLICATION_KEY` from CreationExtras, because Navigation 3's per-screen owners don't supply it. Tests swap in fakes with `TrackMeLiveApplication.useContainer`.
- **Where to start.** `AppViewModel.rootFor(stage, userId)` picks the root screen from the stored setup stage (`Onboarding`, `SignUp`, `Mascot`, `Done`) and the Firebase sign-in, so each launch resumes where the person left off: onboarding, sign-up, the first mascot pick or Home. The splash stays up until DataStore answers, so the first frame is already the right screen. Signing out behind the app's back, or deleting the account, lands on sign-up or onboarding.
- **Navigation.** Navigation 3's `NavDisplay` shows one root at a time. Each root keeps its own view models and saved state (the saveable-state and view-model entry decorators), which are cleared when it's replaced. Tabs are saveable state inside `MainShell`. Back from Mascot or Settings goes to Home; Back from sign-up's first step returns to the last onboarding page.
- **Sign-up** (`SignUpViewModel`). Fields are checked when they're left after an edit, and all of them on Send code; focus moves to the first problem. The number is held as digits plus a country and drawn formatted as you type; a pasted `+44…` picks its country. The code submits itself at six digits, and a code the phone reads from the text fills in by itself. After the code, an existing profile (someone on a new phone) is restored untouched and the app goes to Home. A new account calls `saveProfile` with the name and Fox, then shows the mascot pick. A sign-up interrupted after the code asks only for the name.
- **Live profile** (`DefaultProfileRepository`). When the `users/{uid}` listener fails, it restarts after 2, 4, 8, 16 and 32 s, then every 60 s, and the last known profile stays on screen meanwhile. Once the first retry has failed too, `updatesUnavailable` turns on, and Settings shows a quiet, politely announced "Can't update your profile right now." until a snapshot gets through. Signing out stops the retries. An unauthenticated answer counts as signed out (`AccountSession`), whether it comes from the listener or from a callable.
- **Profile saves** (`DefaultProfileRepository`). `saveProfile` takes the whole profile, so saves run one at a time, each built on the one before. A save shows at once, stays shown until the live listener catches up, and goes back if it fails. Settings are sent only when they changed.
- **Leaving an account** (`data/auth/AccountSession`). Two things end an account on this phone: Delete account, or a callable answering unauthenticated ("Your sign-in has ended", for an account deleted elsewhere, disabled or revoked). Either way the app does the same clean-up:
  - clears the stored account data, keeping Appearance, which is a device preference;
  - signs out;
  - once the profile listener has stopped, deletes Firestore's on-device cache (terminate, `clearPersistence`, then a fresh instance).

  A deleted account starts again at onboarding. An ended sign-in goes to sign-up, which says "Your sign-in has ended. Sign in again." once.
- **Sharing screens** (Sprint 2, `ui/share`, `ui/live`, `ui/ended`, `ui/permission`). Home's Share live location goes through the location gate (`LocationGateViewModel`): our explainer the first time, then the system dialog (fine and coarse together; never background), straight to the system dialog after one refusal, and "Location is off for Track Me Live" with Open settings after a refusal or when it's denied for good (the phone's Location switch gets the same, for location settings). Settings › Permissions shows each permission as the system reports it and opens its system page. The share screen (`ShareViewModel`) creates the session, then opens the system share sheet (ACTION_SEND through the chooser) with "I'm sharing my live location with you." and the link. The chooser reports the chosen app to the app; its Copy button doesn't, so a clip put on the clipboard while the sheet was open counts as sent (only the clip's timestamp is read). A sheet closed without a choice takes the session back. The live map (`LiveViewModel`) ticks on the server's clock; Stop always asks first, the notification's Stop sharing opens the same question (`MainActivity` hands its intents to `service/SharingIntents`), and a share that ends by Stop, its timer or the 1-hour limit moves on to the ended screen by itself, wherever the person is. The sharing screens sit over Home in the Navigation 3 back stack (`AppViewModel`, `SharingScreen`); Back from each is Home, and Back on the ended screen is Done. Every Sprint 2 share is manual: the call stop rule, share back and Phone permission arrive with call sharing.
- **The map.** The live map is Google Maps (maps-compose) when the build has a key: put `MAPS_API_KEY=...` in `code/android/local.properties` (git-ignored) and rebuild; it reaches the manifest through a placeholder and is never committed. Without a key, and in every test, the live screen draws the prototype's street map (`ui/map/CityMap.kt`) with the person's marker in the middle of the open band, so the screen works the same either way.
- **Firebase.** It's initialized from code (`FirebaseEnvironment`); there's no `google-services.json`. Debug builds call `useEmulator` and disable app verification for the Auth emulator only. Release builds stop with a clear error until the real project is added in `FirebaseEnvironment`, the one place that changes.

## Sharing (Sprint 2)

The layer under the sharing screens:

- `data/location/`: `LocationUpdates` (the fused location provider) and `LocationPermissions` (fine and coarse, precise or approximate, the Location switch and notifications on Android 13+; a refusal the system won't ask about again reads as `DeniedForever`). It never asks for background location.
- `data/sharing/`: `SharingRepository` (createSession, the session doc live, Stop, discard, the timer and precision changes, the link), `PingUploader`, the Firestore and callable data source, the kept share (`ShareStore`), and the device doc for alerts (`DevicePush.kt`).
- `domain/`: `ServerClock`, `PingCadence` and `ApproximateLocation`.
- `service/`: `LocationSharingService` (a foreground service of type location) with its ongoing notification, `SharingIntents` (taps on the notification and the alerts) and `TmlMessagingService` (FCM).

How a share runs:

1. `createSession` calls the callable, starts the location service (only while the app is in front) and starts the pings. The share is kept on the phone, so it picks up again after the process is killed.
2. The service runs only while the share is live, and keeps going when the app is swiped away. Its notification reads "Sharing your location with Mom" and "Until 10:08 pm", with Open and Stop sharing; Stop sharing opens the app to confirm.
3. Pings and the session's check-in go in one batch: `last_ping_at` is the server's time, and `last_fix_at` is the ping's `recorded_at`. Pings are at least 2 s apart, and only one write is in flight at a time, so offline the newest fix replaces a waiting one. Approximate snaps each point to a fixed grid of about 500 m.
4. The share ends with Stop (at once, before the server answers), its timer or the 1-hour limit (on time, even offline), or the server's own end, which always wins. Nothing is written after the end.

Every time is the server's. `ServerClock` learns the offset from createSession's `started_at` and the monotonic clock, keeps it for the boot, and leans late, so the phone stops a moment early rather than late. After a reboot, the first write is a check-in to learn it again; until then only the session doc can end a share.

| Battery | Ping every |
| --- | --- |
| Above 20% | 3 s moving, 5 s still, with a poor fix or Approximate |
| 20% to 10% | 15 s |
| Under 10% | 60 s |

A check-in goes out every 30 s even without a fix.

The on-device check feeds a short walk to the emulator's GPS (`adb emu geo fix`, once a second) while `SharingRouteTest` shares from the real app. It checks that the pings reach the dev Firestore, at least 2 s apart, that a timer change is accepted, and that nothing is written after Stop:

```sh
code/scripts/with-lock.sh emulator code/android/scripts/route-check.sh   # needs the Firebase emulators
```

It installs without uninstalling anything, and it signs in a fresh test account and deletes it at the end, so the app is left at onboarding. From `connectedDebugAndroidTest` the test is skipped.

On the emulators' demo project FCM can't issue a push token, so FirebaseMessaging logs errors. The app treats that as "no token yet": it writes nothing, tries again on the next launch, and never blocks sharing.

## Design tokens

Colors, type scale, spacing and radii come from `code/shared/tokens/generated/kotlin/TmlTokens.kt` (package `live.trackme.design`). The shared-contracts build generates that file from `design-system/tokens.json`. The app compiles it in place through a source directory in `app/build.gradle.kts` (`kotlin.directories += "../../shared/tokens/generated/kotlin"`) and never copies it. After you edit `tokens.json`, run `node code/shared/tokens/build.mjs`.

UI code reads tokens through `TmlTheme.colors` and `TmlTheme.type`. Android-only sizes from the prototype (for example the 30/38 onboarding headline and the 12/16 navigation label) are in `ui/Type.kt`. All text is in sp, so it scales with the system font size.

## Fonts and icons

- **Gabarito** (display) and **Figtree** (text) are the variable TTFs from the official Google Fonts repo, `github.com/google/fonts` at commit `a60a77e` (`ofl/gabarito/Gabarito[wght].ttf`, `ofl/figtree/Figtree[wght].ttf`). Each was checked against the repo's git blob SHA. They're licensed under the SIL Open Font License 1.1, and both `OFL.txt` files ship in `assets/licenses/`.
- **Icons** are Material Symbols Rounded SVGs from `github.com/google/material-design-icons`, converted to vector drawables: home, face, settings and call, each outlined and filled, plus arrow_back (mirrored in right-to-left), error (filled), arrow_drop_down, shield, schedule, delete, search and close, and for Settings location_on, notifications and person (filled). They're licensed under Apache 2.0.
- **Brand mark** on onboarding page 3 is `brand/logo/mark.svg`, built as an `ImageVector` in code so its amber follows the in-app theme.
- **App icon** is an adaptive icon built from `brand/logo/android-icon-{background,foreground,monochrome}.svg`, including the themed (monochrome) layer.

## Accessibility notes

- Every touch target is at least 48 by 48dp. The navigation items are 80dp tall and announce as tabs, with their selected state.
- Headings are marked for TalkBack. The fox art is decorative because the text beside it says what it is.
- At large font sizes, onboarding text scrolls while the dots and Continue stay pinned at the bottom.
- When System / Light / Dark no longer fit side by side, they stack into one column, as in the prototype. Checked at 200% font size, in light and dark.
- The onboarding fox bobs 3dp. With Remove animations turned on, it stays still, and so do the code boxes' caret and digit pop.
- Onboarding's page dots read as "Page 2 of 3". Back steps back a page.
- Sign-up fields have visible labels, helper text, and errors under the field. Errors are ink with an icon, never flare. Each error is a polite live region and is also set on the field, so TalkBack reads it there. Autofill hints: given name, phone number, SMS code. IME actions: Next, then Send (or Done).
- The 6-digit code is one field for TalkBack ("6-digit code, 3 of 6 digits"). The countdown isn't announced every second; Send a new code appears in its place.
- The country button reads "Country: United States, +1" and opens a searchable sheet; the current country has a check, so the choice never rests on color alone.
- Names and the phone number are direction-isolated in right-to-left text. Sign-up and Home were checked at 200% font size.

## Troubleshooting

- **`SSLHandshakeException: Remote host terminated the handshake`** from Gradle or `sdkmanager`: in some sandboxed shells, Java's dual-stack sockets fail TLS. `gradle.properties` and `run.sh` already pass `-Djava.net.preferIPv4Stack=true`. For `sdkmanager`, `export JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true`.
- **`Broken pipe` from Gradle while downloading a new dependency**: the shared Gradle daemon was started without the IPv4 setting. Fetch the dependency once with a fresh JVM, under the gradle lock: `JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true code/scripts/with-lock.sh gradle ./gradlew --no-daemon <task>`. After that, the usual `--offline` builds find it in the cache.
- **The emulator quits with "detected a hanging thread 'QEMU2 main loop'"**: the Mac ran out of memory. Close something and run `run.sh` again. Don't use the console's `gsm accept` to answer an incoming call. Use `adb shell input keyevent KEYCODE_CALL`.
- **Disk**: the JDK, SDK, AVD and Gradle cache come to about 7 GB. Snapshots are off to save about 2 GB more.
