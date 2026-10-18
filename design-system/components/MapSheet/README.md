# MapSheet

The floating Liquid Glass sheet that sits over the map on every sharing screen and holds the session's title, people, numbers and actions.

## Anatomy

- Floats `space-2` in from the screen's sides and bottom, with `radius-sheet` corners so it follows the device's corners.
- iOS: a system sheet at a custom detent, so it gets iOS 27 glass and the user's clear-to-tinted setting. Web: `glass-fill` with a 1px inner `glass-edge` and a top `glass-highlight`, and no shadow.
- `space-5` padding. A grabber at the top, then a `title-2` title with an optional `badge`, a `callout` line in `ink-secondary`, the content, then the actions.
- Tiles inside are opaque `surface-raised` with `radius-md` corners (38 minus 20 padding, so the corners stay concentric). Values use `distance` or `metric`, labels `footnote`. Until the viewer shares back, the distance tile reads "Waiting" over "for Mom to share" ("for them to share" without a name).
- The map above it shows the markers at full size: 52pt for the sharer, 48pt for the viewer (see PersonMarker).

## Viewer page variant

The sheet on the browser page the viewer opens. Custom glass, since the browser has no system glass.

- The heading is one `h1` in `title-2` (Gabarito, as in the prototype): "Alex is sharing their location with you".
- Under it, where Alex is, in words: "Near Harbor Way · 1.2 km north-east of you", in `subheadline`. It names the nearest street or area, and adds the distance and direction only once the viewer shares back. While Alex is approximate it names only the area. The street name is looked up in the viewer's browser and never stored.
- Beside it, two neutral buttons: Show Alex (centers the map on Alex) and Open in Maps, at least `tap-target-lg` (48px) tall. If the map fails to load, Show Alex goes and Open in Maps stays.
- This line is the page's text alternative to the map, so it comes before the map in reading order. It isn't a live region; status changes are announced on their own (see Accessibility in the main README).
- When the sharer allows share back: the prominent viewer button, Share my location, with "Alex asked to see where you are" above it once Alex asks.
- At 150% text and above, the page is one column: the glass bar (sticky), a map band at least 160pt tall with every person framed inside it, then the sheet, and the column scrolls. The sheet keeps a solid `surface` background all the way down, so the map never shows through its content. When focus moves (after Allow, Stop or Deny), move it with `preventScroll` and then scroll so the heading sits just below the bar (`scroll-margin-top` equal to the bar's height). The heading must never end up under the bar or off screen.

## The consumer provides

- Title, one explanatory line, the content (stat tiles, PersonRows, the share-back card) and up to two actions.

## Do

- Keep the map's people visible above the sheet; move the map, never the people, when the sheet grows.
- End with the actions: a neutral button and the destructive Stop sharing, side by side.
- At accessibility text sizes, stack the tiles into one column and the two actions into two rows. Values never truncate or shrink. If the sheet outgrows the screen it scrolls, and Stop sharing stays pinned at its bottom.

## Don't

- Don't put glass buttons or glass tiles inside the sheet. Glass never stacks on glass.
- Don't let the sheet cover more than about half the screen at its default height.
- Don't give the sheet a shadow; glass separates with its edge.
