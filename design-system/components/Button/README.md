# Button

Capsule buttons for the few actions on each screen: one prominent action, glass controls over the map, the call action on Android, a neutral action inside sheets, a tinted destructive action and a plain text action.

## Variants

- **Prominent**: `lamplight` fill with an `on-lamplight` label. The one main action on a screen, such as "Share live location". iOS: `.buttonStyle(.glassProminent)` with the lamplight tint.
- **Prominent, viewer**: `crossing` fill with an `on-crossing` label. Only on the browser page: "Share my location".
- **Glass**: `glass-fill` with a 1px inner `glass-edge` and a top `glass-highlight`, `ink` label and glyph. Controls floating over the map: "Center the map", "Close". iOS: `.buttonStyle(.glass)`. An icon-only glass button is a 44pt circle with an accessibility label ("Close").
- **Call**: a `connected` label and phone glyph on `connected-wash`: "Back to call". Android only, and only with the Phone permission. iOS has no way for an app to open the call screen, so the iOS app never shows it.
- **Neutral**: `surface-raised` fill with an `ink` label. Secondary actions inside a sheet, where glass can't go: "Change timer".
- **Destructive**: `flare-wash` fill with a `flare-text` label. "Stop sharing", "Stop sharing my location", "Delete account and all data". Flare is only for stopping and deleting.
- **Plain**: no fill. In the app, an `ink` label: "Not now". Text and back buttons in the app are `ink` too. On the browser page only, a `crossing-text` label.

## The consumer provides

- A sentence-case label that starts with a verb, and an optional leading SF Symbol (Material Symbols Rounded on Android and the web).
- Width: full width inside sheets, hugging the label in bars.

## Do

- Use one prominent button per screen.
- Make buttons 50pt tall, with the `headline` style and `radius-pill` corners. Glass controls in a bar over the map and plain buttons can be 44pt; nothing goes under `tap-target` (44pt) on iOS or `tap-target-lg` (48 by 48) on Android and the browser page.
- Keep Stop easy to reach, but never in the same row as Share.
- Use the solid `flare` fill with `on-flare` only for the confirm button of a destructive alert.
- Stack side-by-side buttons at accessibility text sizes; labels wrap, they never truncate.

## Don't

- Don't tint glass buttons and don't give buttons shadows.
- Don't use a glass button inside a glass sheet; use a Neutral button there.
- Don't use `crossing-text` for plain or back buttons in the sharer's app. Blue is the viewer's color, not the app's tint.
- Don't use `flare` for anything that doesn't stop or delete, errors included.
