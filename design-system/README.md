Track Me Live lets someone share where they are while they're on a phone call. This system serves the iOS app first, then the Android app and the browser page the other person opens. It should feel like a calm, well-lit street at night: quiet neutrals, one warm light that means "you", one cool light that means "them", and red only when something stops.

## Voice and copy

- Write like a friend walking you home: short, plain and calm. Never alarmist.
- Use sentence case everywhere, buttons included: "Share live location", "Stop sharing", "Not now".
- Speak to the person as "you". Name the other person when the app knows who got the link: "Mom opened your link at 9:41 pm".
- Never guess a pronoun from a name. Use the name, or they and them: "Mom opened your link", "They opened your link".
- Give every state a word, not only a color: **Live**, **Last seen 9:41 pm**, **Sharing ended**, **No longer being shared**.
- Say what happens next before it happens: "Next, choose who gets the link." "Your browser will ask for permission first."
- No emoji, no exclamation marks, no "Oops".

### Times and distances

- Use the device's time format (examples show 9:41 pm).
- Show distances in the device's units.
  - Kilometers: under 1 km in meters rounded to 10 (340 m), from 1 to 10 km with one decimal (1.2 km), 10 km and up in whole numbers (12 km).
  - Miles: under 0.1 mi in feet (300 ft), otherwise one decimal under 10 mi (0.4 mi, 2.5 mi) and whole numbers from 10 mi (12 mi).
  - While the sharer is approximate, round to the nearest 0.5 km (0.5 mi): "about 1 km", "about 1.5 km" or "under 1 km".
- Write the short unit on screen ("1.2 km apart"). VoiceOver and TalkBack say the long unit: "1.2 kilometers".

## Color

The palette comes from a walk home at night.

| Role | Tokens | Means |
| --- | --- | --- |
| Lamplight | `lamplight`, `lamplight-text`, `lamplight-wash`, `lamplight-halo` | The sharer: their marker, their trail, the Share action. Sodium streetlight amber. |
| Crossing | `crossing`, `crossing-text`, `crossing-wash`, `crossing-halo` | The viewer, the person following along. The blue of a crossing signal. Never the app's tint. |
| Flare | `flare`, `flare-text`, `flare-wash` | Stopping and deleting. Nothing else (SOS joins it in v2). |
| Connected | `connected`, `connected-wash` | The phone call itself: On a call, and Back to call on Android. |
| Asphalt | `ground`, `surface`, `surface-raised`, `ink`, `ink-secondary`, `ink-tertiary`, `separator` | Everything else. A green-grey, like a road under streetlights. |

- Keep each screen about 90% neutral. Color goes on people and on the one action that matters.
- `lamplight` always means the sharer and `crossing` always means the viewer, on both people's screens. Never swap them and never use either as decoration.
- Crossing blue is never the sharer app's tint. In the app, plain, text and back buttons such as Not now are `ink`. Plain `crossing-text` buttons belong only to the browser page, where the viewer is the one acting.
- Set text on fills in the matching `on-` token: `on-lamplight` on `lamplight` (never white), `on-crossing` on `crossing`, `on-flare` on `flare`.
- For colored text on a neutral ground, use the `-text` tokens (`lamplight-text`, `crossing-text`, `flare-text`), never the fills.
- Tinted backgrounds pair a `-wash` with its `-text`: the Stop sharing button is `flare-text` on `flare-wash`.
- Use `flare` only for stopping and deleting. It never marks a person, never marks an error and never decorates.
- Use `connected` only for call state, never to mean "success".
- Draw the map only in `map-*` tokens, so people's colors are the only saturated things on it.
- No gradients, no purple, no neon glows.

## Light and dark

- Follow the system appearance. Never force dark, even though many walks happen at night.
- Treat both themes as first-class and check every pair in both.
- Dark is not inverted light: surfaces get lighter as they rise (`ground`, then `surface`, then `surface-raised`), and people's colors brighten a little to stay visible on the night map.

## Typography

- The brand typeface is **Gabarito**: round, open bowls with crisp terminals, friendly without looking childish. Use it for the wordmark, titles, numbers and badges (`display`).
- Read everything else in **SF Pro** on Apple platforms and **Figtree** elsewhere (`text`). Figtree shares Gabarito's geometric warmth and stays clear at small sizes.
- On iOS, bundle Gabarito (SIL Open Font License) and scale it with Dynamic Type through `UIFontMetrics`, so brand titles grow with the reader's text size. Keep body text, lists and controls in SF Pro so the app still feels native.
- Use the styles in `tokens.json`, sized to iOS's default (Large) Dynamic Type: `large-title`, `title-1`, `title-2` (display); `title-3`, `headline`, `body`, `callout`, `subheadline`, `footnote`, `caption-1`, `caption-2` (text); `distance`, `metric`, `badge` (display).
- Support every Dynamic Type size, including the accessibility sizes. Never fix text sizes in native code; let rows grow taller (see Large text).
- Use tabular figures for anything that ticks: timers, "updated 2 s ago", distances. On iOS, set those numbers in SF Pro with `.monospacedDigit()`.
- The wordmark is never typed. Use the logo files in the Brand asset group (`brand/logo/` in the repo).
- Only `badge` is uppercase (LIVE, LIVE TOGETHER, NO SIGNAL, NO CONNECTION). Everything else, map labels included, is sentence case or a place's own name: "Alder Park".
- `caption-2` is for map labels only, and is the smallest text anywhere.

## iOS 27 and Liquid Glass

- Build from standard components: navigation bars, toolbars, tab bars, sheets, menus, and buttons with the `.glass` and `.glassProminent` styles. They pick up iOS 27's Liquid Glass refinements without extra work.
- Apps built with Xcode 27 can't opt out of Liquid Glass on system components. Design every screen expecting glass controls to float over the content.
- Use glass for controls that float over content, mostly over the map: Center the map, Close. Never make content itself glass (lists, person rows, text blocks), and never stack glass on glass. Inside a glass sheet, use opaque `surface-raised` tiles.
- iOS 27 separates glass with a defined edge instead of a drop shadow. Custom glass (the browser page only) is `glass-fill` with a 1px inner `glass-edge` and a 1px top `glass-highlight`, with no shadow.
- Tint only the prominent action: Share (`lamplight`) in the app, Share my location (`crossing`) on the browser page. iOS 27 improves label contrast on orange and yellow prominent buttons; still set the label color to `on-lamplight`.
- People can set glass anywhere from clear to tinted in Settings. Check every floating control at both ends of that range, and with Reduce Transparency and Increase Contrast turned on.
- Keep iOS 27's default hard scroll edge under the top bar on scrolling lists such as Settings. Map screens don't scroll, so they don't need one.
- Use the prominent tab role only for a destination, never for an action like Share.
- Float sheets on the map: inset `space-2` from the screen edges, corner `radius-sheet`, so their corners follow the device's.
- Use the native `Picker` with the `.segmented` style and `Toggle` for choices and switches, never look-alikes, so VoiceOver reads their state.
- There is no Back to call on iOS: an app can't open the call screen. People go back through the system's green call indicator, and the Live Activity brings them back to the map.

## Android and Material 3

Android gets a Material 3 app in our tokens, never Material's default palette. The prototype's Android mode (`prototype/css/android.css`) is the reference.

- **Type**: Figtree for text and Gabarito for titles, numbers and badges. Scale both with the system font size.
- **Icons**: Material Symbols Rounded, filled for selected navigation items and outlined otherwise.
- **Navigation**: a bottom navigation bar with a 56 by 32dp pill indicator in `lamplight-wash` behind the selected icon, with labels on every item. Screens below the top level get a top app bar with a back arrow in `ink`. Never a "‹ Back" text link.
- **Actions**: the primary action is a filled `lamplight` button with `on-lamplight` text: 56dp tall when it is the screen's one main action, 40dp otherwise. Secondary actions are tonal (`surface-raised`) or text buttons in `ink`. Stop sharing is `flare-text` on `flare-wash`. Pressed buttons morph their corners, from round to 10dp.
- **Back to call**: a tonal button with a phone glyph and a `connected` label on `connected-wash`, shown only with the Phone permission. It opens the call screen with the picture-in-picture mini map over it.
- **Selection**: switches use a `lamplight` track (`crossing` for share back) with a check or cross on the thumb. Segmented buttons and chips show a check when selected, with `lamplight-wash` for the selected accessory chip and a 10% `ink` tint for other selected states.
- **Surfaces**: dialog and sheet surfaces are `surface` in light and `surface-raised` in dark. Grouped lists have 2dp gaps between rows. Snackbars are `ink` on `ground` and sit above sheets, the navigation bar or a pinned button.
- **Corners**: Android uses Material 3's shape scale, not the iOS radii. Documented in `tokens.json` under `radius.android` (not built into `tokens.css`).

  | Element | Corner |
  | --- | --- |
  | Cards | 24dp |
  | Dialogs and bottom sheets | 28dp |
  | Grouped lists | 20dp outer, 4dp inner |
  | Text fields | 4dp |
  | Pressed buttons | 10dp (round at rest) |

- **Touch**: every target is at least `tap-target-lg`, 48 by 48dp.
- **System stand-ins**: permission dialogs, Settings pages, Quick Settings, the keyboard and the sharesheet use a monochrome palette built from our neutrals, so they never borrow the people colors. They get a soft shadow, like the system's own (see Shadows).
- **While sharing**: a foreground-service notification ("Sharing your location with Mom", Open and Stop sharing), the location indicator in the status bar, and the picture-in-picture mini map over the call screen.

## Quick start

Neither platform tells a closed app that a call has started, so a system control opens the share screen in one tap during a call. Neither needs a permission. Tapping it opens the app on the share screen for this call, or on the live map if sharing is already on.

- **iOS**: a control for Control Center, the Lock Screen and the Action button. Title "Share location", SF Symbol `location.fill`, subtitle "Track Me Live". Apps can't add it themselves, so Home's Share faster during calls card offers Show me how, three short steps.
- **Android**: a Quick Settings tile. Label "Share location", subtitle "Track Me Live" ("Sharing now" while sharing), with the Callout mark as its icon. Home's card offers Add tile, which opens the system's "Add tile to Quick Settings?" dialog.

## Layout and spacing

- Work on an 8pt grid with 4pt half-steps: `space-1` to `space-6`, then `space-8`. There is no `space-7`; go from 24pt straight to 32pt.
- Use `space-4` (16pt) screen margins on standard phones and `space-5` (20pt) on larger ones.
- Make everything tappable at least `tap-target` (44pt) in both directions on iOS, and `tap-target-lg` (48 by 48) on Android and the browser page.
- Keep nested corners concentric: inner radius = outer radius minus the padding between them. A `radius-sheet` sheet with `space-5` padding holds `radius-md` tiles.
- Build grouped lists from `surface` rows on `ground`, corner `radius-lg`, with `separator` lines inset to the text.
- Make buttons, pills and capsules `radius-pill`. Use `radius-lg` for cards and `radius-xs` for small thumbnails.

### Shadows

- `shadow-marker` on markers, `shadow-float` on the mini map, a soft shadow on Android's system stand-ins, and nothing else.
- Never on glass. Glass separates with `glass-edge`.

## The map

- The map is the hero of every sharing screen. Draw it in `map-land`, `map-road`, `map-road-major`, `map-park` and `map-water`.
- Main roads are warm (`map-road-major`), like streets under sodium lights.
- Set street and place labels in `caption-2` with `map-label`, which holds 4.5:1 on every map color in both themes. They are never smaller than 11pt and grow with the text size. Hide them in mini maps and thumbnails, where they'd be too small to read.
- Draw the sharer's trail as round dots at their recent pings, always at full opacity: `lamplight-text` in light and `lamplight` in dark. Age shows by size, from about 8pt for the newest down to about 4pt for the oldest, and dots never touch. No trail while the sharer is approximate.
- Join two people with a dashed `ink` line at 60% opacity (at least 4.1:1 on every map color), with the distance in a capsule at its midpoint: `ink` fill, `ground` text, `metric` style.
- Markers, the connector line and trail dots hold 3:1 against every map color; labels hold 4.5:1.

## Mascots and markers

- Twelve mascots ship in three sets: Classics (fox, the default, then ghost, robot and astronaut), Anime (hero, star, ninja, neko) and Movie night (ace, detective, cowboy, agent). They are 3D models (the Mascot3D component) with matching renders in the Mascots asset group. Every account has a mascot, and people can change its color and add an accessory.
- Every mascot is an original. Never model a real person or someone else's character. Borrow the genre, not the face.
- Color changes the fur, body or shell for the Classics and the hair or clothing for the Anime and Movie night sets, never skin, eyes, visors or lamps. Skin tones are part of who a character is, and the cast spans five of them. Every color is its own render from the model, never a hue shift.
- Three accessories ship: headphones, glasses and a headlamp with a `lamplight` lens. They keep their own colors and sit on a separate layer over the mascot render (Mascot accessories asset group), so every color works with every accessory. Each character takes only the ones that fit its gear; the astronaut's helmet takes none. `mascots/model/accessories.mjs` holds the support list.
- In the mascot picker, the selected tile gets a check badge and a 2pt `lamplight-text` border (5.72:1 on `surface`), so the choice never rests on color alone.
- Use the renders for markers, avatars and the expanded Live Activity. Use live 3D only where the mascot is the subject: onboarding and the mascot picker. At 20pt and below, where the renders lose their features, use the flat SVGs: the compact Live Activity and notification icons.
- **Asset pipeline**: keep the 1024px masters as the source and export everything from them. Ship 512px renders only for onboarding and the picker. Export the marker and avatar sets at 40pt and 32pt, each at 1x, 2x and 3x, and as WebP or AVIF for the browser page. Accessory layers follow the same sizes. The cowboy and the detective read slightly small at marker size; tune their framing when those exports are made.
- **Sharer marker**: a 52pt `surface` disc with a 3pt `lamplight` ring, the mascot's render inside at 40pt, an 80pt `lamplight-halo` behind it and a name capsule below. A 1pt keyline runs outside the ring: `on-lamplight` in light, `ground` in dark (2pt under more contrast). In light it's what holds the marker at 3:1 on every map color (the ring alone reaches only 1.5 to 2.1:1); in dark the ring already holds 7:1 and the `ground` keyline keeps its edge against the night map.
- **Fallbacks**: if the render can't load, the marker shows the flat SVG, then a plain `lamplight` disc. Never an empty ring or a broken image.
- **Viewer marker**: a viewer has no account and no mascot. On the sharer's map, their marker is a 48pt `crossing` disc with the initial of the name the sharer gave, or a person icon when there is no name, in `on-crossing`, with a 3pt `surface` ring and a 72pt `crossing-halo`.
- **On the viewer's own page**, their marker is always a person icon with a capsule that reads "You". The viewer never sees the name the sharer gave.
- **Approximate**: the sharer's marker sits on the rounded point inside a soft `lamplight-halo` circle 1 km across with a faint `lamplight` edge, drawn to the map's scale in place of the 80pt halo, with no trail. Distances read "about 1 km", "about 1.5 km" or "under 1 km".
- **Last seen**: no halo and no shadow, and the capsule reads "Last seen 9:41 pm". The sharer's marker keeps its `surface` disc with a dashed `ink-tertiary` ring and the mascot at 55% opacity. The viewer's becomes a `surface-raised` disc with a dashed `ink-tertiary` ring and the initial or person icon in `ink-secondary`. Never leave a live-looking marker on a stale location.
- Show mascots only on the map, in the mascot picker, in avatars and in onboarding. Never as decoration.

## Iconography

- On iOS, use SF Symbols in hierarchical rendering, at the weight of the text beside them: `location.fill` (share, quick start), `phone.fill` (call), `eye` (link viewed), `timer` (stop time), `stop.fill` (stop sharing), `person.2.fill` (Live Together), `person.fill` (a viewer with no name, and You), `scope` (center the map), `xmark` (close), `slider.horizontal.3` (settings).
- On Android and the web, use Material Symbols Rounded, which suits Gabarito's round forms. They stand in for SF Symbols and are not exact matches.
- Never use emoji.

## Motion

- After each ping, a live marker glides to its new spot over 600 ms, bobs 3pt once over 2.4 seconds, and its halo breathes once. Then everything rests until the next ping: live animation runs only for about 2 to 3 seconds after each ping, never continuously.
- A marker never jumps.
- With Reduce Motion on, nothing bobs or breathes, and markers cross-fade to their new position.

## Errors, loading and empty states

Say what happened and what to do next, in the same calm voice. Errors are neutral: `ink` text with an icon, next to what went wrong. Never `flare`, which is only for stopping and deleting.

- **Sign-up code**: a wrong code says "That code didn't work. Check the text and try again." under the field, and keeps the field focused. An old code says "That code has expired. Send a new one." While checking, the field says "Checking the code…". "You can send a new code in 0:30." counts down in tabular figures until a Send a new code button replaces it. If the text can't be sent: "We couldn't send the code. Check your connection, then try again."
- **Viewer page loading**: show a skeleton until the session and its first ping arrive: the map in `map-land` without a pin, and the bar and sheet with `surface-raised` bars where the name, status and buttons go. The page is `aria-busy` with a hidden heading, "Loading Alex's location". Never show a pin, a name or a distance before real data, and never a spinner on a blank page. The target is under 2 seconds. With Reduce Motion on, the skeleton doesn't shimmer.
- **Map fails to load** (viewer page): "The map didn't load" with "Alex is still sharing. Where they are is written below." and Try again. The where-in-words line stays, so the page still says where Alex is.
- **Invalid or expired link**: they look different because they mean different things.
  - Expired (the session has ended): "This location is no longer being shared", with the sharer's name and dimmed mascot and "Ask Alex to share again if you still need it." No map and no last location.
  - Ended while the page was open: "Alex stopped sharing at 9:52 pm" when the sharer tapped Stop, otherwise "Sharing ended at 9:52 pm".
  - Invalid (the link matches no session, often because it was mistyped or cut off): "This link doesn't work" and "Check that you have the whole link, or ask the person who sent it to send it again." No name and no mascot, since the page can't tell whose link it was.
- **GPS loss or network loss**:
  - GPS loss on the sharer's phone: after 30 seconds without a fix better than 100 m, the sharer's sheet shows the NO SIGNAL badge and "No GPS signal right now. Mom sees where you were last seen." Their row reads "No GPS signal". The viewer's page says "Alex's signal dropped" with "Last seen 9:41 pm" and the dashed marker. Sharing carries on and recovers by itself ("Alex is live again").
  - Network loss on the sharer's phone: the phone knows where it is but can't send it. The sheet shows the NO CONNECTION badge and "No connection right now. Mom sees where you were last seen." Their row reads "No connection". The viewer sees the same as for GPS loss. After 2 minutes offline, share back stops.
  - Network loss on the viewer's page: keep the last state on screen with a neutral "Reconnecting" pill, and switch people to Last seen as their newest ping ages. Never a frozen live marker.
- **Empty states**: before the viewer opens the link, their row reads "Link sent · not opened yet" with the status Waiting, and the map shows only the sharer. Once they open it, the status is Watching. Until they share back, the distance tile reads "Waiting" over "for Mom to share" ("for them to share" without a name), never "0 km".

## Large text

- Support every text size: iOS's accessibility sizes up to AX5, Android's 200% font scale and 200% browser zoom. Test at those sizes in both themes.
- Stat tiles in a map sheet stack into one column at accessibility sizes. Their values never truncate or shrink.
- Rows grow taller, and a row's status word moves under its text.
- Side-by-side buttons stack. When a sheet's content outgrows the screen, the sheet scrolls and Stop sharing stays pinned at its bottom, always reachable.
- Names and values wrap; nothing that matters truncates.
- Glass controls over the map that can't grow (Center the map, Close) show the Large Content Viewer on iOS when held.

## Accessibility

The viewer page meets WCAG 2.2 AA; the apps follow the Apple HIG and Material 3.

- **Contrast**: text holds 4.5:1 on the grounds named in each token's usage note, in both themes; large text and meaningful icons hold 3:1. On the map, markers, the connector line and trail dots hold 3:1 against every map color, and labels 4.5:1 (see The map).
- **Color**: every status has a word next to its color.
- **Where, in words**: the map is never the only way to learn where someone is. The viewer page leads with a text line ("Near Harbor Way · 1.2 km north-east of you", see MapSheet), and the sharer's sheet gives the distance in its tiles.
- **Markers**: each marker is one accessibility element read as one phrase: "Alex, live, 1.2 kilometers away, updated 2 seconds ago." Build it with the platform's locale formatters and long unit names (`MeasurementFormatter` with the `.long` unit style on iOS, ICU `MeasureFormat` with the wide width on Android, `Intl.NumberFormat` with `unitDisplay: 'long'` and `Intl.RelativeTimeFormat` on the web), never by joining strings.
- **Announcements**: announce status changes politely: Mom opened your link, Live to Last seen ("Alex's signal dropped. Last seen 9:41 pm."), sharing back started or stopped. When sharing ends, the viewer's page announces its ended heading once, as an alert: "Alex stopped sharing" after Stop, otherwise "Sharing ended". Never announce each ping or the ticking "updated" time. On the web, use an `aria-live="polite"` region, and a `role="alert"` region for the ended heading.
- **Focus**: after every action, focus stays where it was or moves on purpose. Closing a sheet returns focus to the control that opened it. Confirming Stop sharing moves focus to the Sharing ended title. On the browser page, once location is allowed, focus stays on the button, now Stop sharing my location. Never reset focus to the top of the page.
- **Large text**: see Large text. Stop sharing is always reachable.
- **Viewer page**: one `h1` ("Alex is sharing their location with you"), a `main` landmark, and the map as a labelled region (`role="region"`, `aria-label="Map"`) with one focusable element per marker. Every target is at least `tap-target-lg`, 48 by 48px.
  - `prefers-contrast: more`: double `glass-edge` to 2px and make `separator` lines `ink-tertiary`.
  - `prefers-reduced-transparency: reduce`: glass becomes opaque `surface`, keeping its edge.
  - `forced-colors: active`: text, controls, capsules and sheets take the system colors with a `CanvasText` border, since backgrounds drop out; the map layer keeps its own colors (`forced-color-adjust: none`) so people stay told apart.
- **Motion**: Reduce Motion stops bobbing and halos. Live animations run only for about 2 to 3 seconds after each ping, so nothing on the map moves continuously.
- `focus-ring` is a 3pt solid ring, 2pt outside the control, for keyboard and Switch Control on iPad and the web.
- Liquid Glass adapts to Increase Contrast on iOS 27.

## Files and tools

- `tokens.json` is the source of every token. Run `node design-system/tools/build-tokens.mjs` to regenerate `tokens.css`; never edit `tokens.css` by hand.
- `design-system.json` registers every asset: the Brand group from `brand/logo/`, and the Mascots, Mascot colors and Mascot accessories groups from `assets/Mascots/`. After adding or changing an asset, update its entry and run `node design-system/tools/check-registry.mjs`. It compares every entry's file and size with the disk, checks each group's order, the README path and that every image in those folders is registered, and exits 1 on any mismatch. A changed or new file also needs uploading, which gives it a new blob id; the check warns while an entry has none.
- `tools/build-mascot-preview.mjs` regenerates `components/Mascot3D/preview.html` from the models.
