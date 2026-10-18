# Cover

The title card at the top of the Track Me Live design system. It isn't a product component: it never ships in the app or on the browser page, and nothing in the product is built from it.

## What it shows

- The system's name in `display` at banner size, with the one-line pitch under it in `ink-secondary`.
- The palette as plain blocks on `ground`: an `ink` slab bleeding off the right edge, a `lamplight` card, a `crossing` pill and a small `flare` disc. Their sizes come from the scales: `radius-sheet` and `radius-lg` corners, a pill at half its short side, `space-6` gaps and inset.
- The product's one literal motif: a trail of round `lamplight` ping dots ending in a halo, the way the sharer's trail and halo look on the map.

## Rules

- The Cover is the only place where the people colors and `flare` appear as swatches rather than meaning something. Don't copy it into product screens, where `lamplight` means the sharer, `crossing` the viewer and `flare` stopping or deleting.
- It follows the theme: every color is a token, so it works in light and dark.
- In the product the wordmark is never typed; use the logo files in the Brand asset group. The Cover's title is a heading for this documentation, not a logo.
