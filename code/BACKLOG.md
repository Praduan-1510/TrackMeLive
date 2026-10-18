# Engineering backlog

Known gaps and follow-ups that didn't block a sprint gate, each with where it came from. Open questions that need a decision are in `OPEN-DECISIONS.md`.

## From Sprint 2 (Oct 18)

| Area | Item | Planned |
| --- | --- | --- |
| Backend | Rate limit and spacing for `viewerPings` (share back). It needs a field the viewer writes, so it lands with the share-back screens. | Sprint 3 |
| Backend | Alerts for call ended and for expiry; they reuse `alerts/delivery.ts` with their own copy and setting. | Sprint 3 |
| Backend | In production a session's status flips to `stopped` up to about a minute after its end (the job runs every minute). Readers already treat it as ended at the due time (x-decisions Q-READ-ENDED); an exact flip would need Cloud Tasks. | When it matters |
| Backend | App Check and per-caller rate limits on the callables. | Before launch |
| iOS | Starting a new share while a previous Stop is still retrying gets "already sharing". | Sprint 3 |
| iOS | The live map's mascot uses the profile's current look; `LiveShare` doesn't carry the session's look snapshot. | Sprint 3 |
| iOS | AppModel's push and route glue lives in the app target, so it has no tests yet. | With the first Xcode simulator run |
| iOS | Type-check `#Preview` blocks in `ios/scripts/typecheck.sh`, by rewriting them to private functions the way iOS-UI did by hand. | Sprint 3 |
| iOS | First runs that only Xcode or a device can do: background location, the Core Location service sessions, the FCM token, the Firestore SDK at run time, and the app's writes against the real rules on the dev emulators. | Xcode day |
| iOS | Live Activity start and push updates. | Sprint 3 (planned) |
| Android | Google Maps has never run before the key existed; it needs a dark map style. | Sprint 2 follow-up |
| Android | When a Maps key is present but Google refuses it (billing off, API not enabled, wrong restriction), the live screen shows an empty map with no marker, which is worse than the keyless map. Fall back to the keyless map when the map hasn't loaded within a few seconds, and log why. Seen Oct 18: the first key's project had billing off ("REQUEST_DENIED: You must enable Billing"). | Sprint 3, early |
| Android | `maps-compose` is pinned at 8.3.0, because 8.3.1 and later need compileSdk 37. | With the compileSdk 37 move |
| Android | `DefaultPushRegistration.unregister()` has no caller, because v1 has no plain sign-out. If one is added, `AccountSession` calls it before signing out. | If sign-out is added |
| Viewer | A Google map view (the page draws a plain backdrop today) and the Google attribution wherever geocoded street names show. | Sprint 2 follow-up, now that a key exists |
| Tooling | The shared Gradle daemon was started without `-Djava.net.preferIPv4Stack=true`, so its downloads fail with "Broken pipe". Fetch new dependencies with `JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true ./gradlew --no-daemon …` under the gradle lock. | Note |
