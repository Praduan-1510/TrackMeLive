# Work in progress: free open maps (branch `wip/free-maps`)

Stopped on Oct 19 at the owner's request, mid-task. `main` stays at the green Sprint 2 commit (5a876ee);
this branch holds the unfinished switch from Google Maps to free open maps. **Parts of it don't compile
yet** (Android and the viewer). Finish each lane below, run `code/check-all.sh`, then merge to `main`.

The decision is in `OPEN-DECISIONS.md` (Oct 19, owner): no Google; MapLibre + OpenFreeMap tiles on Android
and the viewer; MapKit on iOS; the street name looked up on the sharer's phone and sent as `session.place`
(x-decisions Q-PLACE).

## Backend and QA tools: done, gate not yet run
- Done: `place` in the schema (TS `Place`, Swift `TMLPlace`, Kotlin `Place`; constants PLACE_*; Q-PLACE);
  the rules (`validPlace`, five keys, 1–80 UTF-16 units, no control or bidi characters, `at` ≤ last_fix_at,
  Approximate drops name and street on every sharer update, live sessions only); `place: null` at every end
  (`functions/src/sessions/end.ts`) and in createSession; ~30 rules cases plus end-path tests (244/244 in
  the files run); the fake sharer writes `place` from new per-segment SF labels in `code/qa/routes`
  (`--no-place` turns it off; 49/49 QA unit tests).
- Next:
  1. `TML_MIN_FREE_GB=6 code/check-all.sh --only backend,shared,qa` (the full backend suite and the qa
     sharing e2e haven't run; the e2e needs the viewer to compile).
  2. `code/qa/e2e-sharing/README.md` and `code/README.md`'s QA row: mention `places` in the routes and
     `--no-place`.
- Backlog: a precision switch option in the fake sharer CLI; a "checked at" stamp on `place` so the viewer
  can tell a confirmed place from a stale one (the viewer agent's request).

## Android: written, doesn't compile yet
- Done (untested): `data/place/` (PlaceParts and PlaceText.clean, PlaceLookup, AddressNames,
  AndroidPlaceLookup with API 33+ and older paths, PlaceCadence); place writes in the ping uploader and
  `setPrecision` (Approximate drops name and street in the same write); MapLibre
  `org.maplibre.gl:android-sdk-opengl:13.6.1` in the catalog (Google maps-compose and the key removed;
  `tml.mapStyles` → `BuildConfig.MAP_STYLES`); `ui/map/TileMapLoad.kt` (fallback state machine),
  `MapPaint.kt` (positron light, dark dark, recolored), `MapAttribution.kt`, `strings_map.xml`.
- Doesn't compile: `ui/map/LiveMap.kt` (still Google; `TileLiveMap` not written), `ComposeTestSupport.kt`
  (`LocalUseGoogleMap`), `FakeSessionDataSource.setPrecisionNext` (new `place` parameter),
  `DefaultPingUploaderTest` (new `places` parameter), `MapAttribution.kt`'s `TmlTheme.type.subheadline`
  (check it exists).
- Not fetched: `android-sdk-opengl:13.6.1`. From code/android:
  `JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true ../scripts/with-lock.sh gradle ./gradlew --no-daemon :app:assembleDebug`
- Next:
  1. Write `ui/map/TileLiveMap.kt`: MapView with logo, attribution, compass, rotate and tilt off; lifecycle
     forwarding; style from `MapStyles.url(dark)` then `MapPaint.paint`; camera padding to the open band;
     zoom 16 precise / 13.5 approximate on the first point or a precision change, `moveCamera` under
     reduced motion; PersonMarker from `projection.toScreenLocation`; load listeners feeding `TileMapLoad`
     (8 s timeout, connectivity callback, log tag `TmlMap`); `KeylessLiveMap` on fallback;
     `MapAttribution` at the bottom start of the open band.
  2. Rewrite `LiveMap.kt`; rename `LocalUseGoogleMap` to `LocalUseTileMap` (tests provide false).
  3. Fakes: `FakePlaceLookup`, place updates in `FakeSessionDataSource`.
  4. Tests: PlaceText cleaning (controls, bidi, NBSP, 80-unit cut on an emoji), AddressNames, both
     AndroidPlaceLookup paths (isPresent false, error, empty, timeout, late answer), PlaceCadence, the
     uploader's place behavior, setPrecision reducing the place, placeOf / placeValueOf, TileMapLoad,
     MapAttribution semantics.
  5. Docs: android README (versions, map, place), code/README Android row, BACKLOG (close the refused-key
     and maps-compose items).
  6. `code/check-all.sh --only android`; APK size against the 51.9 MB baseline; an emulator share checking
     `place` in the dev Firestore, with light and dark screenshots. If OpenGL fails on the Pixel_9 emulator,
     try the Vulkan artifact (MapLibre 13.7.1 fixed an emulator OpenGL issue).
- Decisions: OpenFreeMap serves positron, bright, liberty, dark and fiord (`/styles/` itself is 404);
  OpenGL ES over Vulkan (Vulkan isn't guaranteed on minSdk 29 phones; the AAR is 2.8 MB smaller); the
  approximate lookup uses the rounded point; a drawn map stays when the connection drops later; a place
  change may go in an immediate check-in; a batch queued with a street just as Approximate starts is
  refused once and retried with the corrected place.

## Viewer: written, doesn't compile yet
- Done (untested): `maplibre-gl` 6.12.0 (exact; lockfile matches); `src/places/place.ts` and
  `session-place.ts` (`placeFor`, `placeIsStale`: drop the words only when the place's fix is over 120 s
  older than the shown position and the sharer moved over 300 m from it, 1.5 km while approximate);
  `src/format/bidi.ts`; `where.ts` ("At X", "Near X", "In the X area"); `view.ts`, `model.ts`,
  `controller.ts`, `decode.ts` (malformed `place` becomes null); the sample source writes `place` like a
  phone; the Google geocoder and place-asker deleted; `projection.ts` (Web Mercator), `svg-map-view.ts`
  (layers, z9–z15.5); `src/map/open/` (config, style recolor, the lazy `streets.ts` chunk,
  `open-map-view.ts` with fallback after 6 s and the attribution).
- Doesn't compile: `src/main.ts` (imports the deleted places files), `src/format/where.test.ts`,
  `src/map/open/streets.ts` (`__MAPLIBRE_BASE__` undeclared; the `map.on('error')` type),
  `src/sample/sample-session-source.ts:87` (`place ?? null`), and probably `state/model.test.ts`,
  `state/view.test.ts`, `session/decode.test.ts`.
- Next:
  1. `vite.config.ts`: define `__MAPLIBRE_BASE__` as `/assets/maplibre-gl-<version>/`, serve
     `maplibre-gl.mjs`, `-shared.mjs`, `-worker.mjs` from node_modules in dev and emit them unhashed at
     build; declare it in `vite-env.d.ts`; drop `VITE_MAPS_API_KEY`; add `VITE_TML_MAP_STYLE_LIGHT` and
     `_DARK`.
  2. `main.ts`: the sample keeps `SvgMapView('sample-city')`; real sessions get `OpenMapView` (lazy
     `streets`, theme from `data-theme` or `prefers-color-scheme`, palette from the CSS `--map-*` tokens,
     text scale from the root font size).
  3. `map.css`: `.m-streets`, the canvas, the fade (off under Reduce Motion), `.m-credit` (48 px link
     targets, a visible focus ring).
  4. Fix the compile errors, then lint.
  5. Unit tests: session-place (every case, stale vs fresh), the style transform, Mercator, OpenMapView
     with a fake loader (ready, error, timeout, late success, theme change), decode of `place`, and the
     updated where, view and model tests.
  6. Live e2e: replace `maps-stub.ts` with a tile-fixture router for tiles.openfreemap.org (style, the
     `/planet` TileJSON, small MVT tiles, empty glyphs) plus an abort mode; tests for streets loading with
     the attribution, the fallback when blocked or hanging, the where line from `place`, no `place` after
     the end, axe in light and dark; check headless Chrome's WebGL 2 (may need
     `--enable-unsafe-swiftshader`).
  7. A sample e2e: `?state=` pages never request the tiles or the MapLibre files.
  8. Docs: the viewer row in code/README.md (no key needed), the `index.html` comment, the Maps-key lines
     in both e2e global setups.
  9. `code/check-all.sh --only viewer`; page weight after (about +305 kB gzip expected, only on `/s/`
     links); light and dark screenshots with the fake sharer. Check maplibre-gl's transitive dependencies
     against the two-week rule.
- Decisions: "At X" / "Near X" / "In the X area"; coordinates after the end; both styles recolored to the
  design tokens; the SVG camera drives MapLibre, so markers, glide and Reduce Motion stay as they were; no
  gestures; no CSP change needed; OpenFreeMap sees the viewed tile area, the token never leaves the page.

## iOS: written, not compiled or tested
- Baseline before the change: `test-core.sh` 413 tests in 47 suites, all passing.
- Done (untested; probably builds, since every `requestPrecision` caller has the new `place:` parameter):
  `Services/Place/Place.swift` (PlaceParts with `.approximate`, `PlacePart.clean` by scalar value with the
  80-UTF-16 cut at a grapheme boundary, the placemark mapping, `PlaceLookup`, `PlaceUpdate`,
  `Date.wholeMillisecondBefore`); `LivePlaceLookup.swift` on `MKReverseGeocodingRequest`;
  `Fakes/FakePlaceLookup.swift`; `PingWrite.place` and `requestPrecision(…place:)` in SessionBackend;
  PingUploader's lookup cadence (a fresh ping looks up its own point, waits up to 3 s; 10 s / 25 m;
  failures back off 10, 20, 40, 60 s; Approximate looks up the rounded point and strips name and street);
  a Sprint 2 fix so a fresh fix clears a pending failed retry.
- Next:
  1. `ShareController`: a `places` init parameter passed to PingUploader; `changePrecision` passes
     `uploader.placeUpdate(forPrecisionRequest:)` to `requestPrecision` and calls
     `precisionRequestWritten` on success; `Run.stopUploading` carries `placeOnServer` to the next uploader.
  2. `FakeSessionBackend`: enforce the place rules in `writePing`, `requestPrecision`, `checkIn` and
     `updateStopRule`; clear `place` at every end.
  3. `FirebaseSessionBackend`: write `place` (all five keys, NSNull for empty parts, `at` as the batch's
     Timestamp) or NSNull to clear, in `writePing` and `requestPrecision`.
  4. `AppDependencies`: `LivePlaceLookup()` on the emulator path, `FakePlaceLookup.demo` on the fakes.
  5. Tests: the mapping (probe answers: Yerba Buena, 2335 Folsom St, Jinnan, the flyover, the ocean,
     Eiffel Tower), cleaning (emoji and flags at the cut), cadence, change detection, backoff, empty
     results, the 3 s timeout, Approximate on the rounded point, precision changes both ways and Precise
     Location turned off, stop during a lookup, each fake-backend refusal, an opt-in live test behind
     `TML_LIVE_GEOCODER=1`.
  6. The README "Place" note, an OPEN-DECISIONS row on the `MKMapItem.placemark` deprecation, then
     `test-core.sh`, `typecheck.sh`, `typecheck-firebase.sh`, `check-all.sh --only ios`, the unicode scan,
     and a real Xcode build on a `ci/**` branch.
- Decisions: `MKReverseGeocodingRequest`, not `CLGeocoder` (iOS 26 deprecates
  `CLGeocoder.reverseGeocodeLocation`); the parts still come from the deprecated `MKMapItem.placemark`,
  because the newer address API has no thoroughfare, subLocality or areas of interest, so one
  deprecation warning remains; a strip written on its own keeps area, city and the original `at`, one
  millisecond earlier, to survive Firestore's microsecond truncation of `last_fix_at`.
- Only CI or a device can verify: the Xcode 27 compile, the deprecation warning, cancelling a reverse
  geocoding request, and real lookup latency and throttling.

## Also to do
- The FSD still says the viewer looks the street up with the Maps API (§4's "Where Alex is" row and §5);
  update it to the phone-side lookup and free maps, then rebuild the PDF.
- Before merging: push the iOS changes to a `ci/**` branch for a real Xcode build.
