# PersonMarker

The pin that shows where a person is on the map: the sharer's mascot in a lamplight ring, the viewer's initial or a person icon in a crossing disc, and the approximate and last-seen versions of each.

## Anatomy

- **Sharer**: 52pt `surface` disc, 3pt `lamplight` ring with a 1pt keyline outside it (`on-lamplight` in light, `ground` in dark; 2pt under more contrast), the mascot's render at 40pt, 80pt `lamplight-halo`, `shadow-marker`, name capsule 34pt below the center. The keyline is what holds the marker at 3:1 on light map colors; in dark the ring alone holds 7:1 and the `ground` keyline keeps its edge against the night map.
- **Sharer fallbacks**: every account has a mascot, and Fox is the default. If the render can't load, show the flat SVG; if that fails too, a plain `lamplight` disc. Never an empty ring or a broken image.
- **Viewer, on the sharer's map**: 48pt `crossing` disc with the initial of the name the sharer gave (Gabarito Bold, 18pt), or a person icon when there is no name, in `on-crossing`. 3pt `surface` ring, 72pt `crossing-halo`, `shadow-marker`, name capsule.
- **Viewer, on their own page**: always the person icon, never an initial, with a capsule that reads "You". The viewer never sees the name the sharer gave.
- **Sharer, approximate**: the marker sits on the rounded point inside a soft `lamplight-halo` circle 1 km across with a faint `lamplight` edge (45%), drawn to the map's scale in place of the 80pt halo. No trail. Distances read "about 1 km", "about 1.5 km" or "under 1 km".
- **Sharer, last seen**: same size, `surface` disc with a dashed `ink-tertiary` ring, mascot at 55% opacity, no halo, no shadow, no keyline.
- **Viewer, last seen**: same size, `surface-raised` disc with a dashed `ink-tertiary` ring, the initial or person icon in `ink-secondary`, no halo, no shadow.
- **Last-seen capsule**: "Last seen 9:41 pm" in `ink-secondary`.
- **Name capsule**: `caption-1` in `ink` on `surface`, `radius-pill`, with a `separator` edge. It reads "You" on your own screen and the person's name on the other screen.
- **Distance**: a dashed `ink` line at 60% opacity between two markers, and a capsule at its midpoint in `ink` with `ground` text in the `metric` style.
- **Trail**: round dots at the sharer's recent pings, always at full opacity, `lamplight-text` in light and `lamplight` in dark. Age shows by size, from about 8pt for the newest down to about 4pt for the oldest; dots never touch. None while approximate.

## The consumer provides

- Who the person is, the mascot render (from the Mascots asset group, with its accessory layer) or the viewer's initial, the name for the capsule, the state (live, approximate, last seen), and the position.

## Do

- After each ping, glide the marker to its new spot over 600 ms, bob it 3pt once over 2.4 seconds and breathe the halo once, then rest until the next ping. Nothing moves with Reduce Motion; markers cross-fade instead.
- Make each marker one accessibility element with one phrase, built with locale formatters and long units: "Alex, live, 1.2 kilometers away, updated 2 seconds ago".
- Keep markers, the connector line and trail dots at 3:1 against every map color in both themes.

## Don't

- Don't leave a live-looking marker on a stale location; switch to last seen.
- Don't recolor the ring per mascot. The ring is the person's color, not the mascot's.
- Don't show a viewer's initial on their own page, or guess anything about them from the name.
