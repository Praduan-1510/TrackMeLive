# Track Me Live: click-through prototype

Open `index.html` in a browser (double-click it; no server or build needed). Two phones run side by side and share one session: **Alex's phone** runs the app, **Mom's phone** opens the link in a browser. On narrow windows, one phone shows at a time with a switch at the top.

## iPhone or Android

The **iPhone | Android** switch in the header changes both phones' device and system UI. App content, state and flows stay the same, so you can switch in the middle of a session. The choice is remembered, and **Restart** keeps it.

- **iPhone**: iOS 27 with Liquid Glass, SF Pro for text, Gabarito for titles and numbers. Mom's page opens in Safari.
- **Android**: a Material 3 (Expressive) app in the same tokens and brand, Figtree for text, Gabarito for titles and numbers, Material Symbols Rounded for icons. Mom's page opens in Chrome.

## The story

The panel on the left tracks progress and highlights the next step:

1. Alex goes through onboarding, signs up and picks a mascot, a color and, if the character takes one, an accessory.
2. Start a call with Mom (Simulate panel).
3. Alex taps **Share live location** and allows location. On Android, the first share during a call also asks for Phone, so sharing can stop when the call ends.
4. Alex sends the link to Mom and decides about alerts.
5. Mom taps the message and the browser page opens. Alex is told the link was opened.
6. Optionally, Alex taps **Ask to share** on Mom's row. Mom taps **Share my location**, then allows it in the browser. Both maps now show both people and the distance.
7. Try going back to the call (the green call pill in the iPhone status bar, or **Back to call** and the picture-in-picture mini map on Android when Phone is allowed), **Change timer**, **Send link again**, **Lose Alex's GPS signal**, **Lose Alex's connection**, **Jump to the 1-hour limit**, ending the call, or **Stop sharing**.
8. After it ends, **Mom opens the link later** shows the expired page.
9. Back on Home, **Share faster during calls** shows how to add the quick-start control. Start another call and use **Open Control Center** (iPhone) or **Open Quick Settings** (Android), then tap **Share location**.

The Simulate panel's controls stay pinned at the bottom of the story panel. **Text size** switches both phones between default, 150% and 200% text (about iOS's AX1 and AX3, Android's 1.5 and 2.0 font scale). **More states** holds the states the story doesn't reach on its own: a wrong number, a code that fails to send, an expired code, a broken link, a map that fails to load, and a browser without location.

Everything on either phone is clickable: tabs, settings switches, the mascot picker, the timer sheet, the stop confirmation, every permission prompt (allow or refuse), Not now, and the red end-call buttons.

A few details worth trying:

- **Sign-up name**: the Name field is editable (1 to 24 characters, trimmed). Mom's page, the Messages notification and the call screen use it.
- **Precise on iPhone's location prompt**: tap **Precise: On** to turn it off. The share then starts approximate, the share screen's Location menu can't choose Precise, and Settings shows "Precise: Off".
- **Precision while sharing**: the live screen's **Location** control switches between Precise and Approximate from the next update.
- **Delete account and all data** (Settings): stops any share (Mom's open page shows it ended), clears the profile and starts over at onboarding.
- **Notifications off** (Settings): the row explains how to turn them on.
- On a call screen, if a timer or the 1-hour limit ends sharing, Alex stays on the call; only the alert says so.

## Who it's for, Approximate, and the 1-hour limit

- **Who it's for**: the share screen has an optional name, filled in with the last one used ("Mom"). Only Alex's screens use it: alerts ("Mom opened your link"), the viewer's row, the initial on the viewer's marker, and the Live Activity, mini map and notification ("Sharing your location with Mom"). Cleared, the copy says they and them ("They opened your link", "Sharing your location") and the viewer's disc shows a person icon. Mom's page never shows it: her own marker is "You" with a person icon. The copy never guesses a pronoun from the name.
- **Approximate** (the share screen's Location row, or the default in Settings): the phone rounds each point to about 500 m before it's written, so both maps get the rounded point, drawn with a soft lamplight circle and no exact trail. Every distance is rounded to the nearest 0.5 km and says so ("under 1 km", "about 1 km", "about 1.5 km"): the map chip, the tiles, the Live Activity and the mini map. Mom's page says "approximate" and names only the area. While sharing, the live screen's **Location** control switches between Precise and Approximate; the change takes effect from the next update.
- **The 1-hour limit**: every session stops 1 hour after it starts, whatever its stop rule. Timers are capped by it: options that would run past the limit are hidden, and while sharing the timer sheet adds an "At the 1-hour limit" row. Every surface shows the real end time, the earlier of the timer and the limit. Alex sees "Sharing stopped after 1 hour" (alert and ended screen) with **Share again**, which opens the share sheet for a new session with a new link. A page Mom still has open shows the old link's ended state, and the new link arrives as a new message. **Jump to the 1-hour limit** in the Simulate panel (on while sharing) moves the session's start back so the limit arrives in a moment.

## Quick start during a call

Neither iOS nor Android lets an app notice a call starting while it isn't running, so the share offer appears only when Track Me Live is open. To make sharing one tap away during a call:

- **iPhone**: a Track Me Live control for Control Center, the Lock Screen or the Action button. iOS doesn't let apps add it, so the Home card's **Show me how** sheet gives three short steps.
- **Android**: a **Share location** Quick Settings tile. The Home card's **Add tile** opens Android's own dialog (Add tile to Quick Settings?).

The **Open Control Center** / **Open Quick Settings** control in the Simulate panel works only during a call. Tapping the Track Me Live control or tile opens the app on the share screen (through the location prompt if needed), or on the live map if Alex is already sharing. The prototype shows the control and tile as already in place.

Sharing starts in the app and keeps going in the background (a Live Activity on iPhone; a foreground service with an ongoing notification on Android). Location "While using the app" is all either platform needs.

## Android specifics

- **Device**: a Pixel-like frame with a centered punch-hole camera, the Android status bar and the gesture handle. While Alex shares, the status bar shows the location indicator and the app's notification icon; during a call outside the Phone app, the green call chip.
- **Navigation**: a Material 3 navigation bar (Home, Mascot, Settings) with the active pill; top app bars with a back arrow.
- **Components**: filled, tonal and text buttons (the corners tighten on press), switches with thumb icons, segmented buttons, filter chips, grouped list items, modal bottom sheets with drag handles, basic dialogs, snackbars for things the app says while it's open, heads-up notifications for pushes. Touch targets are at least 48dp.
- **Sign-up**: outlined text fields, then Gboard's number pad with the SMS code suggestion chip.
- **Permissions**, each after our own explainer:
  - Location on the first share: Precise or Approximate, **While using the app**, **Only this time** or **Don't allow**. Don't allow leads to an explainer with **Open settings** and Android's Settings page (Allow only while using the app, Ask every time, Don't allow, Use precise location). Only this time shows as Ask every time after the session, and the next share goes straight to the system dialog. Approximate can be upgraded from the share screen with Android's own precise-location dialog.
  - Phone, at the first share started during a call, after location: "Allow Track Me Live to make and manage phone calls?" Our explainer says plainly that the app only checks whether you're on a call and never makes, reads or records calls. Refused (or Not now), the share runs on a timer (30 min by default) instead of ending with the call, share back is off for that share, and the share screen says why in one line.
  - Notifications right after the first link is sent. Without them, pushes become snackbars while the app is open, and the running share shows under "1 app is active" in the shade.
- **Share sheet**: Android's sharesheet: the link preview, Copy, direct-share people, then apps.
- **In-call mini map**: Back to call opens Google Phone's call screen with a picture-in-picture window: both markers and the distance, live. Tap it for the controls: expand (back to the map), close (sharing continues; the ongoing notification stays) and Stop sharing (opens the app to confirm).
- **Notification shade**: tap Alex's status bar to pull it down: the ongoing call and "Sharing your location with Mom" with Open and Stop sharing.
- **Mom**: the Android lock screen with a Google Messages notification, Chrome's toolbar, and Chrome's location dialog (While visiting the site, This time only, Never allow).
- **Settings**: Location shows "While using the app"; Phone shows Allowed or Not allowed; notification categories map to the app's own alert switches.

## Accessories

Under Color, the picker offers **Accessory** chips: None plus the ones the character takes (Headphones, Glasses, Headlamp). The astronaut's helmet takes none, and the picker says so. Switching to a character that can't wear the current accessory resets it to None.

Wherever the mascot appears (the picker, Home, map markers, avatars, the viewer's page, the ask line, the expired page, the Dynamic Island, Android's mini map and notification), the accessory is a second image from `../design-system/assets/Mascots/accessories/<mascot>-<accessory>.png` stacked on the render in the same box, never tinted. A render that fails to load is hidden and not asked for again.

## Accessibility

Mom's page is a real web page, so its HTML is what a screen reader gets:

- **Structure**: a `<main>` with one `h1` per state ("Alex is sharing their location with you", "You're both live", "Alex's signal dropped", "Alex stopped sharing at 9:52 pm"), the map as a region labelled Map, and a document title per state. Both phones share one document here, so the title is kept on the screen as `data-doc-title`.
- **Where Alex is, in words**: a line in the sheet's head names the nearest street or park ("Near Market Street"), and once Mom shares back, how far and which way ("Near Market Street · 1.4 km south-west of you"). The prototype picks the nearest labelled street or park on its map; the real page asks the Maps API in the browser and never stores the answer. While Alex is approximate it names only the area ("In the Market area"). **Show Alex** frames Alex on the map; **Open in Maps** is a link (the prototype stops at a stand-in "Open in Maps?" question). The map keeps Alex, and Mom once she shares back, in the open band between the bar and the sheet, zooming out if it must.
- **Markers**: each reads as one phrase ("Alex, live, 1.4 kilometers away, updated 2 seconds ago"; "Alex, last seen at 9:41 pm, about 1.4 kilometers away"). Initials, name capsules, the trail, the line and the distance chip are hidden from screen readers. Alex's map works the same way.
- **Announcements**: one polite status region gets only changes (signal dropped, back again, asked to share, location off, both live, stopped sharing back), never ticking times. "Alex stopped sharing" (after Stop) or "Sharing ended" (timer, call or limit) is said once, as an alert. In the app, in-app messages are announced politely.
- **Focus** never drops to the page: Not now goes to Share my location with Alex, Allow to Stop sharing my location, Stop to the status heading, a refusal to Try again. Dialogs and sheets (both phones, both platforms) take focus, keep Tab inside, close with Escape (system prompts that need an answer don't), and hand focus back to what opened them.
- **Size**: buttons on Mom's page are 48px or more and type is in rem, so it follows the browser's text size. At 200% text or zoom the sheet scrolls, lines wrap and the bar folds onto the sheet.
- **In the app**: tiles, badges and recency read as phrases ("Distance, 1.4 kilometers", "Sharing for less than a minute", "Stops when the call ends", "Sharing live"). At 150% and 200%, tiles go one per row, the status sits under the name, actions stack, and the sheets and the ended screen scroll, so Stop sharing and Done are always reachable. These layouts switch on the text's own size, so they follow the system's text size too.
- **Motion and contrast**: a marker pulses for about 2.6 seconds after each ping and then rests; a stale marker is still. The sharer's lamplight ring has a 1pt keyline outside it (on-lamplight in light, the ground color in dark), so it holds 3:1 on every map fill. Trail dots are all full strength (lamplight-text in light, lamplight in dark) and show their age by size, 8px for the newest down to 4px. More contrast, reduced transparency and forced colors each have their own rules for the glass and the markers.

## What's simulated

- No backend. One JavaScript state object stands in for Firestore and Cloud Functions, so both phones update together.
- Alex sends a ping every 3.5 seconds and walks along the main road toward Mom; 1 map pixel is 6 meters.
- The clock starts at 9:38 pm on Saturday, October 17 and runs in real time.
- The status bars are stand-ins too. While Alex shares, the iPhone status bar shows iOS's location arrow next to the time, on every screen (Mom's does while she shares back).
- Not simulated: restoring an account on a new phone (the same sign-up signs back in), and iPhones without a Dynamic Island (they show the Live Activity on the Lock Screen only).
- Call screens (labelled only by their content), keyboards, permission dialogs, Settings, Control Center, Quick Settings, the share sheets and the browsers are stand-ins for the phones' own UI. Android's stand-ins use a monochrome system palette built from the same neutrals, so they never borrow the brand's people colors.
- The picker has twelve mascots in three sets: Classics, Anime and Movie night. Every color loads its own render, so only hair, clothes or the key color change. The Original swatch shows each character's own key color. The Dusk swatch (#7A91C5) is measured from the dusk renders, which keeps it clear of crossing blue.
- Android's views and styles (`js/android.js`, `css/android.css`) load when Android is first chosen, or right after the first iPhone view has painted.

## Rules it follows

- Sharing stops when the call ends unless a timer is set. Share back always stops with the call. On Android without the Phone permission, sharing runs on a timer and share back is off. Whenever share back isn't on offer, Alex's live sheet says why in one line under Mom's row, and step 6 of the story panel says how to get it (start a call first, or allow Phone access).
- Sharing never runs longer than 1 hour: the limit is set when a session starts, and a timer can only end it sooner. Share again makes a new link.
- The "opened your link" alert fires only on the first open. Copy link counts as sent. While sharing, **Send link again** opens the share sheet for the same link.
- A session belongs to the call it started on. Ending a different call doesn't stop it, share back never comes back on a later call, and Share again during the same call keeps Ask to share used. A share started without a call never becomes Live Together, and a call that starts during it shows no offer.
- Alex can ask Mom to share once per call. If Mom says no or ignores it, Alex just sees "Watching".
- A session that ends shows someone already watching "Alex stopped sharing at 9:52 pm" when Alex tapped Stop, and "Sharing ended at 9:52 pm" when the timer, the call or the 1-hour limit ended it. Anyone opening the link afterwards sees "This location is no longer being shared".
- Five minutes before the 1-hour limit, a quiet line says when sharing stops ("Sharing stops at 10:38 pm · 1-hour limit") on the live screen, in the Live Activity and in Android's notification. There's no sound and no way to extend.
- A share keeps the mascot, color and accessory it started with, on both maps and Mom's page, so Alex sees what Mom sees. Home, the picker and Settings show a new choice at once (the picker says "Your new mascot shows from your next share"), and the next share uses it.
- Losing signal shows "Last seen" with a dashed marker, never a live-looking pin. Mom's page says so in its heading, also while she is sharing back.
- Mom's page has its own states: loading, a map that fails (with Try again), a broken link, an expired link, and a browser without location.
- With Reduce Motion on, nothing bobs or breathes, screens don't slide in, and markers cross-fade to each new position. Without it, markers move only for a moment after each ping.

## Tests

The browser tests live in `tests/` and run against this folder:

```
cd prototype/tests && npm i && ./run-suite.sh
```

They need Google Chrome installed (Playwright drives it with `channel: 'chrome'`) and run two browsers at a time, retrying a failed test once. Results and screenshots go to `tests/out/suite/`, with a summary at the end. `SNAP=1 ./run-suite.sh` tests a copy taken at the start, so editing can go on while it runs.

| Test | What it checks |
| --- | --- |
| `walk.mjs`, `walk-android.mjs`, `narrow.mjs` | The story end to end on iPhone and Android, light and dark, and at narrow widths |
| `walk-sharing-rules.mjs` | Who it's for, Approximate, the 1-hour limit and its warning, Share again |
| `walk-fixes.mjs` | The review fixes: timers, call identity, sign-up and viewer states, larger text |
| `walk-r3.mjs` | Round 3 fixes: name, session mascot, location arrow, precision mid-session, the 1-hour warning, Control Center, scroll edge, Save, overlays |
| `walk-a11y.mjs` | Accessibility: axe on every key state, focus, announcements, marker phrases, 200% text and zoom, contrast settings |
| `picker.mjs` | Every mascot in every color loads its own render; accessory chips follow the matrix |
| `reduced-motion.mjs` | Nothing bobs, breathes or slides in with Reduce Motion |
| `icons.mjs` | Every icon is in the Material Symbols subset and renders as one glyph |
| `accessories.mjs` | `ACC_FOR` in `js/app.js` equals `ACCESSORY_SUPPORT` in `../mascots/model/accessories.mjs` |

## Files

| Path | What it does |
| --- | --- |
| `index.html` | The stage: header, story panel, the two phones |
| `css/stage.css` | The night-street stage around the phones, and both device frames |
| `css/app.css` | Everything inside the phones, built only from `../design-system/tokens.css` |
| `css/android.css` | The Android app and system UI, scoped to Android phones |
| `js/map.js` | The city map, the walking route, markers (with the accessory layer), trail, distance |
| `js/app.js` | State, every iPhone screen, the viewer page, actions, the live tick |
| `js/android.js` | Every Android screen and overlay, drawn from the same state |
| `tests/` | The browser test suite (see Tests) |
| `fonts/` | Vendored fonts, the icon subset and its icon list |

It reads colors and type from `../design-system/tokens.css`, mascot renders from `../design-system/assets/Mascots/`, and logos from `../brand/logo/`. Fonts are vendored in `fonts/` (Gabarito, Figtree and a Material Symbols Rounded subset, with their licenses), so the prototype makes no network requests. `fonts/material-symbols-icons.txt` lists the icons in the subset; a new icon in `js/android.js` needs a rebuilt subset.
