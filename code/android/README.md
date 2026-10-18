# Track Me Live for Android

Native Kotlin, Jetpack Compose and Material 3, drawn in our tokens. minSdk 29, targetSdk and compileSdk 36.

Sprint 0 has the app shell: onboarding page 1 (the fox, the headline and Continue), then Home, Mascot and Settings behind a bottom navigation bar. Light and dark follow the system, and Settings › Appearance can override that. The screens follow the Android mode of the prototype (`prototype/js/android.js`, `prototype/css/android.css`) and the Android section of `design-system/README.md`.

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

The whole dependency list is `activity-compose`, `compose-ui`, `compose-foundation` and `material3`. There are no icon packs and no navigation library yet.

## Layout

```
code/android/
  run.sh                       one command: build, install, launch
  settings.gradle.kts, build.gradle.kts, gradle.properties
  gradle/libs.versions.toml    version catalog
  gradle/wrapper/              Gradle 9.8.0 wrapper
  app/
    build.gradle.kts           :app, applicationId live.trackme.app
    src/main/java/live/trackme/app/
      MainActivity.kt          edge to edge, sets the Compose content
      Names.kt                 the 1 to 24 grapheme name rule
      ui/TrackMeLiveApp.kt     onboarding, then the shell; theme mode; system bar icons
      ui/Onboarding.kt         onboarding page 1
      ui/MainShell.kt          bottom navigation bar and tab switching
      ui/Screens.kt            Home, Mascot, Settings
      ui/Components.kt         primary button, mascot on halo, title, status pill
      ui/Type.kt               Gabarito and Figtree, and the Android type roles
    src/main/res/font/         gabarito_variable.ttf, figtree_variable.ttf
    src/main/res/drawable/     Material Symbols Rounded vectors, adaptive icon layers
    src/main/res/drawable-nodpi/mascot_fox.png   design-system/assets/Mascots/fox.png (512 px)
    src/main/assets/licenses/  OFL for both fonts, Apache 2.0 for Material Symbols
```

## Design tokens

Colors, type scale, spacing and radii come from `code/shared/tokens/generated/kotlin/TmlTokens.kt` (package `live.trackme.design`). The shared-contracts build generates that file from `design-system/tokens.json`. The app compiles it in place through a source directory in `app/build.gradle.kts` (`kotlin.directories += "../../shared/tokens/generated/kotlin"`) and never copies it. After you edit `tokens.json`, run `node code/shared/tokens/build.mjs`.

UI code reads tokens through `TmlTheme.colors` and `TmlTheme.type`. Android-only sizes from the prototype (for example the 30/38 onboarding headline and the 12/16 navigation label) are in `ui/Type.kt`. All text is in sp, so it scales with the system font size.

## Fonts and icons

- **Gabarito** (display) and **Figtree** (text) are the variable TTFs from the official Google Fonts repo, `github.com/google/fonts` at commit `a60a77e` (`ofl/gabarito/Gabarito[wght].ttf`, `ofl/figtree/Figtree[wght].ttf`). Each was checked against the repo's git blob SHA. They're licensed under the SIL Open Font License 1.1, and both `OFL.txt` files ship in `assets/licenses/`.
- **Icons** are Material Symbols Rounded SVGs from `github.com/google/material-design-icons`, converted to vector drawables: home, face, settings and call, each outlined and filled. They're licensed under Apache 2.0.
- **App icon** is an adaptive icon built from `brand/logo/android-icon-{background,foreground,monochrome}.svg`, including the themed (monochrome) layer.

## Accessibility notes

- Every touch target is at least 48 by 48dp. The navigation items are 80dp tall and announce as tabs, with their selected state.
- Headings are marked for TalkBack. The fox art is decorative because the text beside it says what it is.
- At large font sizes, onboarding text scrolls while the dots and Continue stay pinned at the bottom.
- When System / Light / Dark no longer fit side by side, they stack into one column, as in the prototype. Checked at 200% font size, in light and dark.
- The onboarding fox bobs 3dp. With Remove animations turned on, it stays still.

## Troubleshooting

- **`SSLHandshakeException: Remote host terminated the handshake`** from Gradle or `sdkmanager`: in some sandboxed shells, Java's dual-stack sockets fail TLS. `gradle.properties` and `run.sh` already pass `-Djava.net.preferIPv4Stack=true`. For `sdkmanager`, `export JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true`.
- **The emulator quits with "detected a hanging thread 'QEMU2 main loop'"**: the Mac ran out of memory. Close something and run `run.sh` again. Don't use the console's `gsm accept` to answer an incoming call. Use `adb shell input keyevent KEYCODE_CALL`.
- **Disk**: the JDK, SDK, AVD and Gradle cache come to about 7 GB. Snapshots are off to save about 2 GB more.
