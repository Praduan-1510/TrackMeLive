# Track Me Live for iOS

SwiftUI app for iOS 26 and later, in Swift 6, with a widget extension (the share session's Live Activity and the Share location control) and a local Swift package, TMLCore, for the models, tokens and type both targets share.

Sprint 1 status:
- Built: onboarding; sign-up with every error state; the new account's mascot picker; Home, Mascot and Settings; the Live Activity and control skeletons.
- It runs on fake services (`FakeAuthService`, `FakeProfileBackend`) that keep the sign-in and profile across relaunches.
- The Firebase implementations exist in their own target and wait for Xcode (see Xcode day).
- Calls, location, sessions and the map come next.

## Run it

Once Xcode 27 is installed:

```
./run.sh                # generate the project, build, boot an iPhone 17 Pro, install, launch, screenshot
./run.sh --fresh        # uninstall first, so it starts at onboarding
./run.sh --dark         # dark appearance before the screenshot
./run.sh --device "iPhone 17"   # another model when no simulator is booted
```

`run.sh` does this:
1. It finds Xcode: the selected one, or the newest `/Applications/Xcode*.app` through `DEVELOPER_DIR`, so it needs no `sudo xcode-select`. Without Xcode it says so and exits.
2. It downloads XcodeGen (checksum-verified) and generates `TrackMeLive.xcodeproj` from `project.yml`.
3. It uses the booted simulator. If none is booted, it boots an iPhone 17 Pro on the newest iOS runtime, creating one if needed.
4. It builds the `TrackMeLive` scheme, signed "to run locally". If that signing is refused, it falls back to an unsigned build.
5. It installs, launches, and saves a screenshot to `build/screenshots/`.

The full build log goes to `build/logs/xcodebuild.log`. Deep links can be tried with `xcrun simctl openurl booted trackmelive://share`.

Once Xcode exists, the **MobileBuildMCP** server (already configured) can run the same loop from an agent session: build, install, launch and screenshot, on `TrackMeLive.xcodeproj` and the `TrackMeLive` scheme.

### First time with Xcode 27

1. Install Xcode 27 and open it once.
2. Run `sudo xcodebuild -license accept && xcodebuild -runFirstLaunch`.
3. If Xcode came without the iOS Simulator, run `xcodebuild -downloadPlatform iOS`. That's several GB, and this Mac had 12 to 16 GB free during Sprint 0, so check `df -h /` first.
4. Run `./run.sh`.
5. Optional: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.

For device builds, set your team in `project.yml` (`DEVELOPMENT_TEAM`) or in Xcode's Signing & Capabilities. The bundle ID `live.trackme.app`, the App Group `group.live.trackme.app` and Push need registering in the developer account.

## Before Xcode: what runs with only the Command Line Tools

| Command | What it does |
| --- | --- |
| `scripts/test-core.sh` | Builds TMLCore and runs its Swift Testing tests (`swift test`). Other agents share `Packages/TMLCore/.build`, so run it as `code/scripts/with-lock.sh tmlcore code/ios/scripts/test-core.sh`. |
| `scripts/typecheck.sh` | Type-checks TMLCore, the app and the widget extension for Mac Catalyst (`arm64e-apple-ios26.0-macabi`), the closest the macOS SDK gets to iOS. See the notes in the script. |
| `scripts/typecheck-firebase.sh` | Until Xcode: type-checks `Firebase/` (the TrackMeLiveFirebase target) and the app's `-backend emulator` path in Swift 6, against signature stubs of Firebase 12.19.2 in `scripts/firebase-stubs/`. The stubs are copied from that tag's sources and headers, Swift modules in Swift 5 mode and Objective-C ones without Sendable blocks. They check our side (isolation, Sendable, typed throws, call shapes), not the SDK. Delete both once Xcode builds the real thing. |
| `tools/xcodegen/bin/xcodegen generate` | Generates the Xcode project. XcodeGen needs no Xcode. |
| `scripts/export-assets.sh` | Copies mascot renders, flat SVGs, the brand mark, the launch color and the app icon from the design system into the asset catalogs. It also exports each color render and accessory layer at the picker's 152pt size, and every render and layer at the 40pt avatar size, each at 2x and 3x (names and sizes in TMLCore's `MascotAssets`, which the tests check). |

## Layout

```
project.yml                 XcodeGen spec: targets, capabilities, Info.plist keys, scheme
run.sh                      generate → build → simulator → install → launch → screenshot
scripts/                    bootstrap-xcodegen, export-assets, test-core, typecheck, typecheck-firebase
                            (+ firebase-stubs/, until Xcode)
TrackMeLive/                the app
  App/                      TrackMeLiveApp (entry), AppDelegate (APNs and URLs for Firebase Auth),
                            AppDependencies (fakes or Firebase), AppModel (composition root, tabs,
                            deep links), RootView (launch, onboarding, sign-up, picker, tabs), MainTabView
  Features/Onboarding/      three pages (OnboardingModel): Share where you are, Live Together, Private by default
  Features/SignUp/          SignUpView (details, then the code pushed on one stack), the details and
                            code screens, OneTimeCodeField, CountryPickerView (SignUpModel)
  Features/Home/            the Home tab: greeting, not-on-a-call card, mascot card (+ the share stub)
  Features/Mascot/          the mascot picker (MascotPickerScreen; its model is TMLCore's MascotPickerModel)
  Features/Settings/        Settings (SettingsScreen; TMLCore's SettingsModel and permissions)
  Components/               the design-system components: buttons (.tmlProminent, .tmlNeutral,
                            .tmlDestructive, .tmlGlass), StatusPill and StatusBadge, PersonRow,
                            PersonMarker, MapSheet, StatTile, GlassBar, MascotImage (color, accessory
                            and fallbacks), ChoicePicker, FlowLayout. Each file ends with its previews
  DesignSystem/             Gabarito large navigation titles
  Resources/Assets.xcassets AppIcon (default, dark, tinted), mascot renders, brand mark, LaunchBackground
TrackMeLiveWidgets/         widget extension: ShareLiveActivity, ShareLocationControl, flat mascots
Shared/                     compiled into both targets: OpenShareIntent (the control's action)
Firebase/                   the TrackMeLiveFirebase target (needs the Firebase SDK, so Xcode): FirebaseServices
                            (emulator setup, app-delegate hooks), FirebaseAuthService, FirebaseProfileBackend
Packages/TMLCore/           the shared package
  Sources/TMLCore/Tokens    → ../../../../../shared/tokens/generated/swift   (symlink: TMLColor, TMLSpacing, TMLRadius, TMLShadow, TMLType)
  Sources/TMLCore/Contracts → ../../../../../shared/schema/generated/swift   (symlink: TMLShareSession, TMLUser, TMLUserSettings, TMLMascotId, …)
  Sources/TMLCore/Fonts     bundled Gabarito + DisplayStyle (UIFontMetrics scaling)
  Sources/TMLCore/Validation PersonName (graphemes, the schema's characters), PhoneNumber + PhoneRegion
                            (E.164), OneTimeCode + ResendCountdown
  Sources/TMLCore/Services  AuthService, ProfileService + ProfileBackend, SettingsStore (protocols),
                            ProfileStore (optimistic profile), AppLifecycleHooks, Fakes/
  Sources/TMLCore/SignUp    SignUpModel (the state machine) and its copy
  Sources/TMLCore/App       AccountModel (the route: launch, onboarding, sign-up, picker, tabs)
  Sources/TMLCore/…         ShareActivityAttributes, DistanceText, presentation names for schema enums
```

The tokens and the schema are generated by `code/shared` (`node code/shared/tokens/build.mjs`, `node code/shared/schema/build.mjs`). TMLCore links to them, never copies, and its tests check the colors, spacing, radii and Gabarito styles against `design-system/tokens.json`. They also check the mascot accessories against `mascots/model/accessories.mjs`.

## Sign-up, the profile and the services

The view models live in TMLCore, where the tests drive them; the views only bind fields and focus.

- **Flow** (`AccountModel.Route`):
  - First launch: onboarding, then sign-up (name and number, then the code).
  - A new account goes on to the mascot picker in onboarding mode (Continue), then the tabs.
  - A number that already has a profile restores it (FSD §4: name, mascot, color, accessory, settings; never a session), skips the picker and doesn't send the typed name.
  - Back from sign-up's first screen returns to onboarding's last page.
  - A relaunch while signed in routes from the server's profile, not the device's flags. A ready profile always has its mascot (Fox until one is picked), so it goes Home. Relaunch signed in without a profile (killed between the code and `saveProfile`): the details screen asks only for the name ("Continue"). Back there signs out.
  - First launch of an install: the Keychain, where Firebase keeps the sign-in, survives deleting the app, but UserDefaults doesn't. Without the `installMarker` default, any restored sign-in is signed out before anything routes on it.
  - If the code worked but the profile step failed, Back on the code screen signs that number out (keeping what was typed), so a different number can't orphan the first account.
  - A snapshot or save answer older than the confirmed profile (by `updated_at`) is ignored; they can arrive out of order.
  - Delete account forgets the account on the phone but keeps Appearance (a device preference), signs out, stops the listener, clears Firestore's cache, and starts over at onboarding.
  - When any service answers `unauthenticated` (the account was deleted, disabled or revoked elsewhere), the app signs out the same way, keeping Appearance. It returns to sign-up's details, even mid sign-up, and shows "Your sign-in has ended. Sign in again." in the error style until Send code. `permission-denied` stays a plain failure.
  - Sign-out and delete also clear the device's copy of the account: Firestore's cache, through terminate and clearPersistence.
- **Persisted.** In UserDefaults: onboarded, picked a mascot, Appearance and the install marker (`UserDefaultsSettingsStore`). The fakes also keep the sign-in and the profiles. With Firebase, Auth and the Firestore cache keep them.
- **Rules shared with Android and the server:**
  - Names are 1–24 grapheme clusters (`String.count`) after tidying, with the schema's character rule; typing stops at 24.
  - Numbers go to Auth in E.164.
  - Codes are 6 digits, with a new one after 30 s.
  - The words are the same on both apps (`SignUpModel+Copy.swift`). Android validates numbers with libphonenumber. iOS has exact rules for NANP and about 30 large countries, with libphonenumber's example numbers, and an E.164 length check elsewhere. Auth rejects what slips through, and both apps show the same message for it.
- **Services:**
  - `AuthService`: phone sign-in.
  - `ProfileService`: what the Mascot and Settings screens change.
  - `ProfileStore`: the app's profile. It applies each change at once, sends the whole profile to `saveProfile` and rolls back that change if the call fails.
    - A failed Firestore listener stops for good, so with a profile on screen the store listens again after 2, 4, 8, 16, 32, then every 60 s.
    - Once the first retry has failed too, Settings shows a quiet "Can't update your profile right now." note, announced politely, until a snapshot gets through.
  - `ProfileBackend`: the Firestore listener and the callables.
  - `SettingsStore`: per-device settings.
  - Fakes for each are in `TMLCore/Services/Fakes`.
- **The fakes' demo values** (the app runs on them until Xcode day):
  - The code is **482913**; **000000** acts as an expired code; any other code is wrong.
  - A national number ending in **0000** is refused as invalid. One ending in **9999** fails to send once, then works. One ending in **8888** hits the rate limit.
  - The same number signs in as the same account.

## Xcode day: turning on Firebase

The Firebase Apple SDK (`firebase-ios-sdk` **12.19.2**, Sep 15, 2026, the last release before the Oct 4 cutoff) is declared in `project.yml`. Only the `TrackMeLiveFirebase` static library uses it, and the app doesn't link it yet, so nothing that builds today depends on the SDK.

1. Install Xcode (see First time with Xcode 27). Run `./run.sh` once on the fakes. Sign-up, the picker and Home should work end to end with code 482913.
2. Resolve and build the SDK: `xcodebuild -project TrackMeLive.xcodeproj -scheme TrackMeLiveFirebase -destination 'generic/platform=iOS Simulator' build`. The first resolve downloads the SDK and its dependencies, including Firestore's binary framework from Google, so check `df -h /` first. Fix anything it reports in `Firebase/`. `scripts/typecheck-firebase.sh` only checked those files against stubs.
3. Link it into the app: in `project.yml`, uncomment `- target: TrackMeLiveFirebase` under the app's dependencies, then run `tools/xcodegen/bin/xcodegen generate`. If the link step can't find Firebase symbols, also add the three products (`FirebaseAuth`, `FirebaseFirestore`, `FirebaseFunctions` from package `Firebase`) to the app target.
4. Start the backend: `code/scripts/with-lock.sh firebase code/backend/run.sh`. That gives Auth on 9099, Firestore on 8080, Functions on 5001, project `demo-trackmelive`.
5. Run against it. Tick `-backend emulator` in the TrackMeLive scheme's Run arguments, or run `xcrun simctl launch booted live.trackme.app -backend emulator`. It works in debug builds only.
6. Sign up with any E.164 number. The emulator sends no text: read the code in the emulator log or at `http://127.0.0.1:9099/emulator/v1/projects/demo-trackmelive/verificationCodes`. In debug builds, `isAppVerificationDisabledForTesting` skips APNs and reCAPTCHA.
7. Check these against the emulator:
   - sign-up creates `users/{uid}` (Fox, original, no accessory);
   - the picker and Settings save through `saveProfile`;
   - a second simulator with the same number restores the profile and lands on Home;
   - Delete account removes the user and returns to onboarding;
   - wrong and expired codes show their messages (an old verification ID is expired).
   - signing out and deleting clear Firestore's cache (the next sign-in starts from the server);
   - a revoked sign-in returns to sign-up with "Your sign-in has ended. Sign in again.".
8. Pin what you tested: commit the `Package.resolved` Xcode wrote (in `TrackMeLive.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/`) as `code/ios/Package.resolved`. `run.sh` and CI then copy it in and build with `-onlyUsePackageVersionsFromResolvedFile`, so Firebase's own dependencies (GoogleUtilities, gRPC, abseil, leveldb, nanopb…) resolve exactly as tested.
9. Phone numbers: add PhoneNumberKit **4.3.0** (May 25, 2026, the newest before the cutoff; github.com/marmelroy/PhoneNumberKit, `exactVersion`). Use it behind `PhoneNumberInput` for validation, formatting and the example numbers, so iOS accepts exactly what Android's libphonenumber does. The current tests describe the behavior to keep.
10. When push arrives: write `users/{uid}/devices/{deviceId}` only after the first `saveProfile` has created the profile. The rules refuse it before that; a returning account already has one.
11. Delete `scripts/typecheck-firebase.sh` and `scripts/firebase-stubs/`.
12. For the real project, add its `GoogleService-Info.plist` (git-ignored). Configure from it instead of `FirebaseServices.demoOptions`, and replace the `app-1-000000000000-ios-0000000000000000` URL scheme with its `REVERSED_CLIENT_ID`. Real phone sign-in also needs Push and an APNs key in the Firebase console.

## Targets and capabilities

| | App `TrackMeLive` | Extension `TrackMeLiveWidgets` |
| --- | --- | --- |
| Bundle ID | `live.trackme.app` | `live.trackme.app.widgets` |
| Deployment | iOS 26.0, iPhone | iOS 26.0 |
| Entitlements | `aps-environment` (development), App Group `group.live.trackme.app` | App Group |
| Info.plist | Background Modes: `location`; `NSLocationWhenInUseUsageDescription`; `NSSupportsLiveActivities` (+ frequent updates); URL schemes `trackmelive` and Firebase Auth's `app-1-000000000000-ios-0000000000000000`; `FirebaseAppDelegateProxyEnabled` NO (AppDelegate forwards APNs and URLs); `NSAllowsLocalNetworking` (the emulators on 127.0.0.1); launch screen color `LaunchBackground` (the `ground` token) | `com.apple.widgetkit-extension` |

- **Deep links.** The Live Activity, the control and later pushes open `trackmelive://share`, `trackmelive://live` or `trackmelive://stop` (`TMLCore.Route`).
- **The control.** It runs `OpenShareIntent` in the app (`openAppWhenRun`). The app gets the route directly. If the intent ran in the extension, it leaves the route in the App Group's defaults, and the app picks it up when it becomes active.

## Design notes

- **Type.** Titles, numbers and badges use Gabarito, the variable `Gabarito[wght].ttf` (400 to 900), bundled in TMLCore and registered at launch in both targets.
  - `.displayFont(.largeTitle)` resolves the style for the environment's Dynamic Type size through `UIFontMetrics`, with line height and tracking from the tokens. It goes one weight step heavier with Bold Text.
  - Large navigation titles use the same style through `UINavigationBar.appearance()`, refreshed when the text size changes.
  - Body text, lists and controls stay SF Pro.
- **Liquid Glass.**
  - Standard components throughout: the system tab bar, navigation bars, `Form`, the segmented `Picker` and `Toggle`.
  - The screen's one main action is `.buttonStyle(.glassProminent)` tinted `lamplight`, with an `on-lamplight` label.
  - Content (cards, rows, tiles) is never glass. Settings keeps the hard scroll edge under its bar.
- **Color.** Only tokens (`TMLColor.*`). Plain buttons are `ink`. The selected tab is `lamplight-text`. Switches are `lamplight`, as in the prototype. Crossing blue only marks the viewer.
- **Motion.** The mascot bobs only on onboarding and in the picker, where it is the subject. Nothing moves with Reduce Motion on.
- **Large text.**
  - At accessibility sizes, the Home mascot card stacks, the picker shows two characters per row instead of four (one from AX3, so names never break), segmented choices become menus, and onboarding art shrinks so the words fit.
  - Nothing that matters truncates.

## Versions

| | |
| --- | --- |
| Swift | 6 language mode (`SWIFT_VERSION 6.0`); developed with Swift 6.4 (Command Line Tools for macOS 27) |
| Xcode | 27 (expected; any Xcode 26+ with the iOS 26 SDK should do) |
| iOS | 26.0 deployment target |
| TMLCore | `swift-tools-version: 6.2`, platforms iOS 26 / macOS 26 |
| Firebase Apple SDK | 12.19.2, published 2026-09-15 (`exactVersion` in `project.yml`): FirebaseAuth, FirebaseFirestore, FirebaseFunctions, used only by the TrackMeLiveFirebase target. 13.0.0 (Oct 7) is past the cutoff. |
| XcodeGen | 2.46.0, published 2026-07-16; zip SHA-256 `4d9e34b6…c0196806`, checked by `scripts/bootstrap-xcodegen.sh` |
| Gabarito | `ofl/gabarito/Gabarito[wght].ttf` from github.com/google/fonts at commit `a60a77e`. Git blob `f048f3b6…`, SHA-256 `8650e2bd…4833b67ca5`. SIL OFL 1.1, license in `Resources/OFL-Gabarito.txt` |

## Not verified until Xcode is installed

These are written but have never been compiled for iOS or run:
- **The iOS build itself.** The app and widget sources type-check only against Mac Catalyst. That stand-in can't check:
  - asset catalogs, the app icon, Info.plist processing, signing and entitlements;
  - the `@State` and `#Preview` macros (their plugins ship only with Xcode);
  - anything iOS-only that Catalyst marks unavailable beyond the Live Activity APIs.
- **TMLCore's tests for iOS.** `scripts/test-core.sh` compiles and runs them for macOS, and `scripts/typecheck.sh` checks only TMLCore's sources for Catalyst (Swift Testing isn't available for Catalyst with the Command Line Tools). So a test that calls an API whose signature differs between its `#if os(iOS)` and `#else` branches compiles here and fails only in CI's Xcode build, as `DisplayStyle.resolve()` did in Sprint 1. Give both branches the same signature, defaults included.
- **Liquid Glass and layout.**
  - Whether the glass prominent button, tab bar and navigation bars look like the prototype.
  - Spacing and the art sizes on an iPhone 17 Pro.
  - Dark mode and the accessibility text sizes.
- **Gabarito on iOS.** Whether `UIFontDescriptor` picks the right point on the weight axis, the large-title appearance, and the line spacing. The same descriptor is verified on macOS.
- **The Live Activity and the control.** The `#Preview(as: .dynamicIsland…)` previews, the control in Control Center, and the route handoff from `OpenShareIntent`.
- **The local package.**
  - Xcode resolving TMLCore's directory symlinks into `code/shared` (SwiftPM on the command line does).
  - The resource bundle for Gabarito landing in both the app and the extension.
- **Sign-up on a device.**
  - Focus moving between the fields and to the first problem.
  - The six-box code field: taps, paste, the "From Messages" suggestion with `.oneTimeCode`, and VoiceOver reading it as one field.
  - The details screen's button staying above the keyboard.
  - The country sheet's search.
  - Error announcements.
- **The Firebase target.** Everything in Xcode day, steps 2 to 7: the SDK resolving, the static library linking into the app, phone sign-in through the emulator (including the notification-forwarding check through `@UIApplicationDelegateAdaptor`), the snapshot listener's decoding of `users/{uid}`, and the callables' error codes.
- **Simulator signing.** "Sign to run locally" with these entitlements. `run.sh` falls back to an unsigned build if Xcode refuses.
- **run.sh** past the Xcode check: the `simctl` steps, which were tested only against sample JSON.

## Known quirks

- With the Command Line Tools' `swiftbuild` backend, `swift test` can fail with "plugin for module 'TestingMacros' not found": some compile batches of the test target come out without Swift Testing's macro plugin. It happens after a source change (the symlinked shared files included), and sometimes from clean.
  - `scripts/test-core.sh` passes the plugin explicitly (`-Xswiftc -load-plugin-library` with the toolchain's `libTestingMacros.dylib`), which has stopped it in every run since.
  - It also clears the cached build description first.
  - If the error still appears, it rebuilds from clean once (about 40 s) and shows only that run. The broken attempt also printed spurious "no calls to throwing functions occur within 'try'" warnings on `try #require`, since the macros never expanded.
  - By hand, `rm -rf Packages/TMLCore/.build` fixes it.
- Whether `xcodebuild test` hits the same issue is unknown until Xcode is here. The scheme's test action runs TMLCoreTests.
