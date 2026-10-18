# Track Me Live — Functional Specification Document

Oct 15, 2026 · Revised Oct 18, 2026 · Prepared with @AI Team

## 1. Overview

Track Me Live lets a person share their real-time GPS location with a trusted contact for the duration of a phone call, or manually at any time, without requiring the recipient to install the app. The location appears as a customizable animated character (mascot) on a live map link. During the call, both people can watch the same live map, and the recipient can share their own location back (Live Together).

**Problem it solves**: existing live-location tools (WhatsApp, Messenger, Google Maps) require opening a separate sharing flow inside a messaging app. None tightly couple sharing to the act of being on a phone call, and none offer a personalized, non-generic tracking marker.

**Target users**: people walking alone at night, commuters checking in with family, solo travelers, and parents/partners who want a lightweight, low-friction safety check-in tool.

**Platforms**: the sharer app runs on iOS and Android; the viewer link works in any modern mobile or desktop browser.

**One-line pitch**: "Share where you are, the moment you're on the phone — with a character that feels like you."

## 2. Scope

| In v1 | Deferred to v2+ |
| --- | --- |
| Call-triggered sharing prompt | ETA calculation |
| Manual sharing (not tied to a call) | SOS / panic button |
| Live web-link map, no install required | Share history log |
| Auto-expiry on call end or timeout | Trusted contacts list for one-tap sharing outside calls |
| Mascot picker (12 characters in three sets) | Expanded mascot marketplace / custom uploads |
| Stop sharing anytime | Multi-recipient broadcast beyond the call participant |
| Notification when recipient opens the link |  |
| Live Together: both people on the call see one live map; the recipient can share back |  |

## 3. User roles

| Role | Can do |
| --- | --- |
| Sharer | Start/stop sharing, pick mascot, choose precise vs. approximate location, optionally name who the link is for, see when the link was viewed |
| Viewer (recipient) | Open the live map link, see the sharer's position update in real time, no account or app install required; during the call, optionally share their own location back |

## 4. Functional requirements

| Feature | Trigger | Behavior | Edge case handling |
| --- | --- | --- | --- |
| Sign up | First launch, after onboarding | Name and mobile number, confirmed with a 6-digit code sent by text (filled in from Messages where the phone allows) | The same flow signs back in on a new phone and restores the name, mascot, color, accessory and settings from the profile; it never restores a session (decided Oct 18; confirm). A new code can be sent after 30 seconds. Names are 1–24 characters after trimming, and typing stops at 24 (decided Oct 18; confirm). Viewers see the name and mascot, never the number |
| Call-triggered sharing | A call starts while Track Me Live is open and not already sharing (CallKit's call observer on iOS; on Android, TelephonyManager with the Phone permission, or the audio mode until that permission is granted) | An in-app banner, "You're on a call · Share your live location with them?", with a Share button | If declined, no location data leaves the device. Without the Phone permission, neither platform tells an app about calls while it isn't running, so Quick start covers that case; with it, Android can wake the app when a call starts (seen in the Oct 18 spike), which would allow a notification offer in a later version. The app never knows who is on the call |
| Quick start | During a call, the sharer taps the Track Me Live control in Control Center, on the Lock Screen or on the Action button (iOS), or the Quick Settings tile (Android) | Opens the app on the share screen for this call, ready to send the link | Works without any extra permission. Android offers to add the tile with the system's own dialog; iOS shows how to add the control |
| Manual sharing | User taps share from home screen | Starts a session without needing a call | Only one session runs at a time. If a call starts during a manual share, no offer appears; the share keeps its own stop rule and never becomes Live Together |
| Live map link | Sharer taps Share live location | Creates the session and opens the system share sheet with its unique, expiring link (Messages, WhatsApp, Mail, Copy link); the app never sends texts itself. While sharing, Send link again reopens the share sheet with the same link | If the sheet closes without a choice, the session is deleted before anyone can see it. Copy link counts as sent. The link stops working once the session ends. Share links always open the web page, even when the recipient has the app: the app doesn't claim the `/s/` path for universal links or App Links (decided Oct 18; confirm) |
| Who it's for | Share screen, before sending | Optional name for the person getting the link, filled in with the last name used | Used only on the sharer's screens ("Mom opened your link", the viewer's row and marker initial). Without a name the app says "they" and shows a person icon. Copy never guesses a pronoun from a name. When given, the name is 1–24 characters after trimming, and typing stops at 24 (decided Oct 18; confirm). The viewer sees only the sharer's name |
| Location detail | Sharer picks Precise or Approximate in Settings or on the share screen | Approximate rounds each point to about 500 m on the phone, before it's written. Both maps (the sharer's own included) show the same soft circle, 1 km across, around the rounded point, with no trail | While the sharer is approximate, distances are rounded to the nearest 0.5 km (0.5 mi): "about 1 km", "about 1.5 km", or "under 1 km". Precision can be changed mid-session from the live screen and takes effect from the next ping; the viewer sees the circle appear or disappear and the status text change, and nothing else is announced (decided Oct 18; confirm) |
| Stop rule | Share screen (Stops) or the timer sheet while sharing | When the call ends (only during a call), In 15 min, In 30 min or In 1 hour. Picking or changing a timer sets `stop_at` to now plus the minutes, capped at `expires_at`; choices that would end after `expires_at` aren't offered. While sharing, once In 1 hour would pass the 1-hour limit, the sheet offers "At the 1-hour limit" instead (`stop_at` = `expires_at`) | The default comes from Settings. Without a call, or on Android without the Phone permission, the default is 30 min |
| Let them share back | Share screen, during a call | A switch, on by default (from Settings), that allows the viewer to share back for this session | When it's off, the viewer's page never offers Share my location |
| Auto-expiry | Call ends (if the stop rule is the call), `stop_at` passes, or the session reaches 1 hour | `status` becomes `stopped` with `ended_at` and an `end_reason` (`stopped`, `call`, `timer` or `limit`); last location frozen | 1 hour is a hard limit set as `expires_at` when the session starts. A scheduled function stops the session at the earlier of `stop_at` and `expires_at`, even if the app was killed. If the stop rule is the call and the app has stopped checking in, the session stops 10 minutes after the watchdog clears `call_active`. At the limit the sharer is told, and Share again makes a new link |
| 1-hour warning | 5 minutes before `expires_at` | A quiet line, "Sharing stops at 10:38 pm · 1-hour limit", in the app, the Live Activity and the Android notification | No sound and no way to extend; the sharer can share again after it ends (decided Oct 18; confirm). The line is announced once when it appears (a polite announcement in the app, and the Live Activity / notification text updates); the viewer's page shows "Sharing stops at 10:38 pm" too |
| Mascot marker | Live map loads | Animated character marks the sharer's position | Every account has a mascot; Fox is the default. If a render can't load, the marker shows the flat SVG, then a plain lamplight disc |
| Stop sharing | User taps Stop | Session ends immediately, pings stop writing | Viewer sees a "Sharing ended" state, not a frozen live indicator: "Alex stopped sharing at 9:52 pm" when the sharer tapped Stop, otherwise "Sharing ended at 9:52 pm". Announce the ended heading once as an alert: "Alex stopped sharing" after Stop, otherwise "Sharing ended" |
| View notification | Recipient opens link | Sharer gets a push notification | Fires once, on the first open; refreshes and later reopens don't notify again |
| Battery-aware pings | Ongoing session | Above 20% battery, a ping every 3-5 s; from 20% to 10%, every 15 s; under 10%, every 60 s. The session records the current `ping_interval_s` | Never drops below 1 ping per 60s while active. The sharer's row shows the real interval |
| Live Together view | Session active while its own call is still connected (`call_active`) | Sharer (in the app) and viewer (in the browser) see the same live map: each person's marker, live status and the straight-line distance between them | Until the viewer shares back, both maps show only the sharer |
| Where Alex is, in words | Viewer page, always while live | A text line above the map: the nearest street or area and, once the viewer shares back, the distance and direction ("Near Harbor Way · 1.2 km north-east of you"), plus Show Alex (recenter) and Open in Maps. Screen readers get this line and one phrase per marker ("Alex, live, 1.2 kilometers away, updated 2 seconds ago") | The street name is looked up in the viewer's browser with the Maps API and never stored. While Alex is approximate it names only the area, and Open in Maps opens the rounded point. Status changes are announced politely. Announce the ended heading once as an alert: "Alex stopped sharing" after Stop, otherwise "Sharing ended" |
| Share back | Viewer taps "Share my location" on the link page | Browser asks for location permission; the viewer's position then appears on both maps | Off by default, and only offered when the sharer allows it. Always stops when the call ends, even if the sharer's timer keeps their own sharing going, and never comes back on a later call. Only the first browser to open the link can share back. When share back isn't on offer (the share started outside a call, Android without Phone access, the switch is off, or the call ended), the sharer's live sheet says why in one line under the viewer's row |
| Ask to share back | Sharer taps "Ask to share" on the viewer's row, during the call, after the viewer has opened the link | The viewer's page shows "Alex asked to see where you are" above the Share my location button | Once per call: each session has at most one call, and Share again during the same call keeps it used. Nothing is shared until the viewer allows it. The sharer is never told if the viewer declines; their row just stays "Watching" |
| In-call mini map | Sharer leaves the app to go back to the call screen (iOS: through the system's green call indicator, since iOS has no way for an app to open the call screen; Android: Back to call, shown only with the Phone permission, or the call notification) | Android: picture-in-picture mini map with both markers and the distance; tapping it shows expand and close controls. Closing it keeps sharing on, and the ongoing notification stays. iOS: Live Activity on the lock screen and in the Dynamic Island. Compact, it shows the mascot and the distance (or "Live" until the viewer shares back). Expanded, it shows both people, the distance, when sharing stops, Open map and Stop sharing. The distance is worked out on the phone from the viewer's latest share-back ping (Live Together only); without a viewer location, the expanded view shows the viewer's status ("Mom is watching", or "They're watching" without a name) (decided Oct 18; confirm) | Tapping it reopens the full Live Together view. Stop sharing opens the app to confirm. With no GPS signal it shows "No signal" and a last-seen time. iPhones without a Dynamic Island get the Live Activity on the Lock Screen and in Notification Center, plus the in-app status bar call pill; nothing else changes (decided Oct 18; confirm) |
| Settings | Settings tab | Offer to share when I'm on a call (on; works while the app is open), Location detail, Default stop time, Let people share back (on), a switch for each of the three alerts, Appearance (System, Light, Dark), Permissions, Delete account and all data | Permissions shows each permission's state and how to change it |

## 5. System architecture

&#91;embedded content: system architecture · client, backend, delivery\]

The sharer's app captures GPS and writes pings to Firestore every 3-60 seconds, depending on battery (§7). Cloud Functions run the session logic: starting a session, the first open, expiry at `expires_at`, alerts and cleanup. Sessions start only through the `createSession` function; no client ever creates a session document itself (decided Oct 18; confirm). Firestore security rules decide who can read and write what. Firebase Authentication signs sharers in with their phone number and a text code. The viewer page and the mascot renders are served from Firebase Hosting. The page trades the link token for a short-lived viewer sign-in scoped to that one session (a custom token per browser from the `redeemLinkToken` function; decided Oct 18; confirm), then listens to the session and its pings. During Live Together it can also write the viewer's pings, which the sharer's app listens to. Push goes through APNs (alerts and Live Activity updates) and FCM (alerts): the first open, a call ending while sharing, and sharing expiring. The Maps API draws the map in the app and on the viewer page, and the viewer's browser looks up the nearest street name for the text line; nothing is geocoded or stored on the backend. The Firestore region is still open: asia-south1 (Mumbai) if most users are in India, otherwise us-central1. It can never be changed later, so it must be confirmed before Oct 27.

## 6. Database schema

Firestore (document-based), chosen for built-in real-time listeners over a self-built WebSocket layer.

| Collection | Key fields | Notes |
| --- | --- | --- |
| users/{userId} | name, mascot\_id (FK), mascot\_color, mascot\_accessory, last\_viewer\_name, settings, active\_session\_id, created\_at, updated\_at | Profile, the user's customized mascot, the last "who it's for" name and the app settings, restored when signing in on a new phone (decided Oct 18; confirm). There's no phone number here: Firebase Authentication alone holds it (decided Oct 18; confirm). `mascot_accessory` is null for none (decided Oct 18; confirm). `settings` holds offer\_on\_call, precision, default\_stop (`call`, 15, 30 or 60), share\_back, alert\_link\_opened, alert\_call\_ended and alert\_expiry; a new account starts with on, precise, call, on, on, on and on (decided Oct 18; confirm). Cloud Functions own `active_session_id`: they set it when a session starts and clear it when it ends, so only one session runs at a time (decided Oct 18; confirm). `created_at` and `updated_at` are server timestamps (decided Oct 18; confirm) |
| users/{userId}/devices/{deviceId} | platform, push\_token, live\_activity\_start\_token, updated\_at | One per signed-in phone, for alerts. `deviceId` is a per-install UUID, and `live_activity_start_token` is the iOS Live Activity push-to-start token, null on Android (decided Oct 18; confirm) |
| users/{userId}/trustedContacts/{id} | contact\_user\_id, relation | **v2.** Subcollection, scoped per user; unused in v1 |
| shareSessions/{sessionId} | status (`active` or `stopped`), started\_at, expires\_at, stop\_rule (`call`, `minutes` or `limit`), stop\_minutes, stop\_at, ended\_at, end\_reason, call\_id, call\_active, call\_ended\_at, share\_back\_allowed, last\_ping\_at, ping\_interval\_s, precision, precision\_next, sharer (name, mascot\_id, mascot\_color, mascot\_accessory, taken when the session starts), first\_viewed\_at, viewer\_sharing, share\_back\_requested\_at | One doc per active/past share, holding only what the viewer may see. It carries a snapshot of the sharer's name and mascot, so the viewer never reads `users`. The viewer has no account. Only the `createSession` function creates it (decided Oct 18; confirm). `stop_minutes` (15, 30 or 60) is set only when `stop_rule` is `minutes`, otherwise null. `stop_at` is null for the call rule and is set when a timer or the limit is chosen; `ended_at` records the actual end (decided Oct 18; confirm). When `stop_at` equals `expires_at`, `end_reason` is `limit` (decided Oct 18; confirm). `ping_interval_s` is in seconds and can be fractional (3.5): `createSession` writes 5, and the app overwrites it with the interval in use whenever that changes (decided Oct 18; confirm). `precision_next` holds a mid-session precision change until the next ping applies it (decided Oct 18; confirm). Every field is always written, and null means not set yet (decided Oct 18; confirm) |
| shareSessions/{sessionId}/private/meta | user\_id, link\_token\_hash, viewer\_uid, viewer\_name, activity\_push\_token | Sharer-only fields, readable by the sharer and Cloud Functions, never by the viewer. The link token is stored hashed: SHA-256, lowercase hex, no pepper (decided Oct 18; confirm). `activity_push_token` is this session's iOS Live Activity update token (decided Oct 18; confirm) |
| shareSessions/{sessionId}/pings/{id} | lat, lng, accuracy\_m, recorded\_at | Subcollection the recipient's map listens to live. `accuracy_m` is the fix's horizontal accuracy in meters; precision lives on the session, not on each ping (decided Oct 18; confirm). While the sharer is approximate, `accuracy_m` is the larger of the raw accuracy and 500, to match the rounded point (decided Oct 18; confirm) |
| shareSessions/{sessionId}/viewerPings/{id} | lat, lng, accuracy\_m, recorded\_at | Written only while the viewer shares back; the sharer's app listens to it. Same fields as pings, `accuracy_m` included (decided Oct 18; confirm) |
| mascots/{id} | character, set, default\_color, accessories | Base character library: the set it belongs to (Classics, Anime, Movie night) and the accessories each one supports. `character` is the mascot id (`fox`); display names live in the apps' strings. Set ids are `classics`, `anime` and `movie` (decided Oct 18; confirm) |
| callLogs/{id} | user\_id, session\_id, call\_id, call\_time | Links a call to the session it started with; kept 30 days like session metadata. `call_id` is a per-device unique id (the CallKit UUID on iOS, a generated UUID on Android), and the session stores it too. `call_time` is a server timestamp of when the call was first seen (decided Oct 18; confirm) |

**Design decisions**: ping subcollections auto-delete 24h after session end via a scheduled Cloud Function; GPS writes every 3-5 seconds above 20% battery, slowing to 15 and then 60 seconds (§7); `expires_at` auto-stops sharing even on app crash. **Viewer access**: links look like `https://trackme.live/s/{token}`, and the token is 128 random bits in base64url, 22 characters (decided Oct 18; confirm). The page sends the token to the `redeemLinkToken` function, the only way to look a token up: the function hashes it and finds the session with a collection-group query on `link_token_hash` (decided Oct 18; confirm). If it matches an active session, the function mints a custom token for that browser carrying the claims `sid` (that session only) and `role`, sets `first_viewed_at` on the first open and sends the view notification (decided Oct 18; confirm). The first browser to trade the token becomes the session's viewer (`viewer_uid`); later browsers, such as a forwarded link, can watch but never see the share-back card or the request. The first browser's `role` is `viewer` and later ones get `watcher`; the response returns `session_id`, `role` and `can_share_back`, so the page never reads `private` (decided Oct 18; confirm). Only the page's own script trades the token, so link previews fetched by messaging apps never count as an open; the preview shows only the sharer's name and "Live location · opens in your browser". Firestore rules then let the viewer read that session's document and pings, and nothing in `private`. After the session ends, the viewer can read only the session document, so an open page can show the ended state, and never its pings (decided Oct 18; confirm). Writes (`viewerPings` and `viewer_sharing`) must come from `viewer_uid` and need the session to be active, before `expires_at`, with `share_back_allowed` and `call_active` true and `last_ping_at` under 2 minutes old. `call_id` is the call that was connected when the session started (none for a manual share). `call_active` is true only while that call is connected; once it ends, it stays false for the rest of the session, and a later call never turns it back on. When the call ends, `call_ended_at` is set, and from then on `call_active` can never become true again for that session (decided Oct 18; confirm). `last_ping_at` is the app's last check-in, not the newest location: `createSession` sets it to `started_at` (decided Oct 18; confirm), and the app refreshes it with every ping, and every 30 seconds even without a GPS fix, so losing GPS alone never ends share back. Last seen always uses the newest ping's `recorded_at`. If the app is killed or offline for 2 minutes, a scheduled function clears `call_active`; if the app comes back while the same call is still connected it sets it again (never once `call_ended_at` is set), and Ask to share still counts as used. When `call_active` turns false, a Cloud Function sets `viewer_sharing` to false. Viewer pings follow the same 24h deletion.

## 7. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | Both maps (sharer's and viewer's) reflect a new ping within 5 seconds of capture |
| Battery | Every 3-5 s above 20% battery, every 15 s from 20% to 10%, every 60 s under 10%; never below 1 ping/60s while active |
| Security | Each session link carries an unguessable token that stops working when the session ends; until then the viewer can refresh or reopen it. Location data encrypted in transit and at rest |
| Privacy | Share back is off by default, starts only when the viewer taps it, and stops when the call ends. The sharer can ask once per call, and a decline is never reported back |
| Offline behavior | A person shows as Live while their newest ping is under 3 ping intervals old (at least 15 s), then as "Last seen 9:41 pm" (the newest ping's time), never as a frozen live marker. The sharer's app shows No GPS signal after 30 s without a fix better than 100 m |
| Accessibility | WCAG 2.2 AA on the viewer page; Apple HIG and Material 3 in the apps. The map is never the only way to learn where someone is (see "Where Alex is, in words"). Each marker reads as one phrase. Status changes are announced. Focus stays put or moves on purpose after every action. Every screen works at the largest text sizes (iOS accessibility sizes, Android 200% font, 200% browser zoom): tiles stack, rows grow, nothing that matters truncates, and Stop sharing is always reachable. Targets 44pt (iOS) / 48dp (Android, viewer page). Markers, trail and connector line hold 3:1 against every map color; map labels 4.5:1. Status never conveyed by color alone. Reduced motion stops bobbing and halos; live animations run only briefly after each ping |

## 8. Permissions and data handling

- **Location**: requested on the first share attempt, never at install, with an in-app explanation before the system prompt. "While using the app" is all either platform needs: sharing always starts in the app and keeps going in the background until it stops. The app never asks for "Always" or "Allow all the time". If location is off, the app explains how to turn it on in Settings. If the person turns the system's precise location off, shares are Approximate and the share screen offers the system's one-time precise request. Allow Once (iOS) and Only this time (Android) last for that share; the next share asks again.
- **Phone state (Android only)**: needed to know when a call ends, so sharing can stop with it, and to offer sharing when a call starts while the app is open. Requested at the first share started during a call (a share opened from Quick start counts), after location, and only on Android 12 and later: Android 10 and 11 report the call state without it, with an explanation that the app only checks whether a call is active and never makes, reads or records calls (the system dialog itself says "make and manage phone calls"). If it's denied, shares use a timer instead of the call, and share back is off for them. Until it's granted, the app tells a call is in progress from the audio mode (`MODE_IN_CALL`, or modes 4 and 5, no permission) while it's open or its sharing service runs, reading the mode again whenever the app resumes. The Oct 18 spike confirmed this on Android 10 to 16: the mode can't be faked by other apps, a call's start shows within about 0.5 s, and its end within about 3 s (with the permission, within 0.1 s). Real phones still need checking for carriers that report calls as VoIP audio (`code/spikes/android-call-detect/RESULTS.md`). iOS needs no extra permission for this.
- **Background sharing**: on iOS, sharing keeps going in the background with the system location indicator and the Live Activity. On Android it runs as a foreground service with an ongoing notification, "Sharing your location with Mom", with Open and Stop sharing (Stop sharing opens the app to confirm). Without notification permission, Android lists the share under active apps instead.
- **Quick start**: the iOS control and the Android Quick Settings tile need no permission. Android asks to add the tile with the system's own dialog.
- **Contacts**: optional, only needed for the trusted-contacts list (v2 feature).
- **Notifications**: requested right after the first link is sent, when the alert is useful ("Know when Mom opens it"), with an in-app explanation first. Used for view-confirmation, call-end and session-expiry alerts.
- **Phone number**: used only to sign in, confirmed with a one-time text code, and never shown to viewers. Only Firebase Authentication holds it, in E.164 format; it's never stored in Firestore (decided Oct 18; confirm).
- **Viewer location (browser)**: asked only when the viewer taps "Share my location", never on page load. Mobile browsers pause location while the page is in the background, so share back works while the page is open.
- **Live Activity / picture-in-picture**: no extra permission; the user can turn either off in system settings. If they do, sharing still works: iOS relies on the system location indicator and Android on its mandatory ongoing notification, and Settings shows a one-line note (decided Oct 18; confirm).
- **Retention**: ping data (the sharer's and any shared-back viewer pings) auto-deleted 24 hours after a session ends; session metadata and call logs (not location) retained for 30 days for support/debugging, then purged. Device push tokens are deleted when the person signs out or the token stops working. The viewer sign-ins (one Auth user per browser) are deleted with the session's cleanup (decided Oct 18; confirm).
- **Deletion**: users can delete their account and all associated data at any time from Settings. Deleting stops any active session and deletes everything at once, overriding the 30-day retention.

## 9. Error and edge cases

| Scenario | Handling |
| --- | --- |
| No GPS signal | After the thresholds in §7, the viewer sees "Last seen" with the time and place of the newest ping instead of a stale live marker |
| Call drops mid-share | Treated like any call end: if the sharer set a timer, sharing continues until it runs out; otherwise the session stops. The sharer gets a call-end alert either way |
| Recipient has no app | Link opens a browser-based map view, no install required |
| App killed in background | A scheduled function stops the session at `stop_at` or `expires_at` even without a check-in. A session tied to the call stops 10 minutes after the watchdog clears `call_active` |
| Recipient opens link after expiry | Shows "this location is no longer being shared" state, not a stale pin |
| Viewer denies browser location | View stays one-way; the page explains how to turn location on and try again |
| Viewer's page goes to the background | Their share back pauses; the sharer sees "last seen" for the viewer, not a frozen live marker |
| Call ends during Live Together | The viewer's share back stops right away; the sharer's own sharing follows the call-end rule above |
| Viewer ignores a request to share back | Nothing changes. The request stays on their page until they answer or the call ends |
| Viewer's page is in the background when asked | The request is waiting when they come back to the page; browsers can't receive a push without permission |
| Sharer closes the Android mini map | Sharing continues. The ongoing notification stays, with Open and Stop sharing, until sharing ends |
| The link is forwarded or opened on a second device | Anyone holding the link can watch until it ends, but only the first browser can share back or see Ask to share |
| A messaging app fetches a link preview | It doesn't count as an open and sends no alert; the preview shows only the sharer's name |
| A call starts during a manual share | No offer appears; the manual share keeps its own stop rule and never becomes Live Together |
| Share back after the call ended, on a later call | Never offered again in that session; a later call needs a new share |
| Sharer denies or turns off the Phone permission (Android) | Sharing can't follow the call, so shares use a timer (30 minutes by default) and share back is off for that share, since it must never outlive the call. Settings shows what's off and how to turn it back on |
| A call starts while the app isn't running | Without the Phone permission no offer appears, since neither platform reports calls to a closed app; Quick start opens the share screen in one tap. (Android with the Phone permission could wake the app here; a notification offer is a candidate for v2) |
| Sharing reaches 1 hour | Sharing stops. The sharer is told, and Share again makes a new link |

## 10. Competitive landscape

| App | Call-triggered | Custom tracking icon | Install required for recipient |
| --- | --- | --- | --- |
| Mapfia (historical) | Yes | No | Yes |
| WhatsApp Live Location | No | No | Yes |
| Messenger location | No | No | Yes |
| Life360 | No | No | Yes |
| bSafe | No | No | Yes |
| Noonlight | No | No | Yes |
| Strava Beacon | No | No | No |
| **Track Me Live** | **Yes** | **Yes** | **No** |

No major player combines a call-trigger with a no-install recipient link and a personalized marker — this is the identified gap.

## 11. UI and design system overview

**Screens (v1)**: Onboarding, Sign-up (name, number, text code), Home, Quick start (iOS control, Android Quick Settings tile), Call offer (an in-app banner), Share screen, Share sheet, Live map (Sharing live, or Live Together), Sharing ended, In-call mini map (Android picture-in-picture; a Live Activity on iOS), Mascot picker, Settings. The viewer's page: live, asked to share back, both live, last seen, ended, no longer shared. The Contacts and Share history screens arrive in v2 along with their features.

**Mascot system**: 12 base characters in three sets: Classics (fox, ghost, robot, astronaut), Anime (hero, star, ninja, neko) and Movie night (ace, detective, cowboy, agent). Every character is original; none is based on a real person or an existing anime or film character. Customizable by color (Original, Moss, Lagoon, Dusk, Rose; `default_color` is Original) and accessory. Color changes the fur, body or shell for the Classics and the hair or clothing for the Anime and Movie night sets, never skin, eyes, visors or lamps. Three accessories ship in v1: headphones, glasses and a headlamp with a lamplight lens. Each character takes only the ones that fit its gear: fox, ghost, star and agent take all three; robot the headlamp; hero, detective and cowboy glasses; ninja headphones; neko glasses and the headlamp; ace headphones and the headlamp; the astronaut's helmet takes none. Accessories keep their own colors and are drawn as a layer on top of the mascot, so every color works with every accessory. The mascot animates subtly (idle bounce) on the live map as the position marker; Fox is the default. A viewer who shares back has no account or mascot, so on the sharer's map they appear as a crossing-blue disc with the initial of the name the sharer gave, or a person icon without one. On the viewer's own page, their marker is always a person icon labelled You.

**Design system**: defined in `design-system/` (tokens in `tokens.json`, built into `tokens.css`), with the brand in `brand/`.

- **Type**: Gabarito for the wordmark, titles, numbers and badges. Body text is SF Pro on Apple devices (the app, and the web viewer in Safari) and Figtree everywhere else. Gabarito scales with the user's text size.
- **Color**: asphalt neutrals. Lamplight amber always marks the sharer, crossing blue always marks the viewer, connected green marks the phone call, and flare red is only for stopping and deleting (and SOS once it ships in v2). Status never relies on color alone.
- **Platforms**: iOS follows the iOS 27 guidelines, with Liquid Glass on bars, sheets and buttons. Android is a Material 3 app in the same tokens and type: a bottom navigation bar, top app bars, Material dialogs and sheets, 48dp touch targets, and Material Symbols Rounded where iOS uses SF Symbols; the web viewer uses Material Symbols Rounded too. Both support light and dark mode, and the prototype switches between them.
- **Logo**: the Callout, a map pin that is also a speech bubble.
- **Screens**: the click-through prototype (`prototype/`) of the sharer's app on iOS and Android and the viewer's page is the screen reference for v1. The low-fidelity wireframes and the Live Together screens on the design canvas are kept in sync with it.

## 12. Success metrics and glossary

**Success metrics**: time-to-share of 3 taps or fewer from the call offer (or Quick start) to choosing where to send the link, not counting first-run permission prompts; live map load time under 2 seconds; every session stops by its `expires_at` time (enforced server-side; any overrun is treated as a critical bug); a viewer can start sharing back in 2 taps or fewer.

**Glossary**

| Term | Meaning |
| --- | --- |
| Sharer | The user broadcasting their live location |
| Viewer | The recipient watching the live map link |
| Session | One instance of active location sharing, from start to expiry |
| Ping | A single GPS coordinate write to the active session |
| Mascot | The customizable character used as the live-location marker |
| Live Together | The in-call view where both people see the same live map |
| Share back | The viewer showing their own location to the sharer from the browser, only during the call |
| Ask to share | The sharer's one-time request, per call, for the viewer to share back |
| Quick start | The iOS control or Android Quick Settings tile that opens the share screen during a call |
| Who it's for | The optional name the sharer gives the person getting the link, shown only on the sharer's screens |
| Stop rule | When a session stops: with the call, or after 15, 30 or 60 minutes, never past the 1-hour limit. While sharing, once In 1 hour would pass the 1-hour limit, the sheet offers "At the 1-hour limit" instead (`stop_at` = `expires_at`) |
