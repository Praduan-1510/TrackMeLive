# PersonRow

A grouped-list row for one person in a session: avatar, name, a detail line and a status word on the right.

## Anatomy

- 64pt minimum height, `space-4` side padding, `space-3` between avatar and text.
- **Avatar**: 40pt. The sharer's mascot render at 32pt (the 32pt avatar export) in a `surface-raised` disc with a 2pt `lamplight` ring; the viewer's initial, or a person icon when the sharer gave no name, in a `crossing` disc with `on-crossing` text. If the render can't load, the flat SVG, then a plain `lamplight` disc.
- **Name** in `headline`, **detail** in `subheadline` with `ink-secondary` and tabular figures.
- **Status**: a dot and a word in the person's `-text` color (`lamplight-text` or `crossing-text`), or `ink-secondary` for a neutral state: Waiting before the viewer opens the link, Watching once they have.
- Rows sit in a `surface` group with `radius-lg` corners on `ground`; `separator` lines start at the text, 68pt in.

## The consumer provides

- Who the person is (sharer or viewer), the name ("You" for yourself; for the viewer, the name the sharer gave, or "Them" without one), the detail text and the status.

## Do

- Put the freshness of the data in the detail line: "updated 3 s ago".
- Before the viewer opens the link, their row reads "Link sent · not opened yet" with the status Waiting. Once they open it: "Opened your link at 9:40 pm" with Watching.
- Let the row grow with Dynamic Type; the status moves under the text at accessibility sizes. Names and details wrap, never truncate.
- Read the row as one element: "Mom, live, sharing back, updated 3 seconds ago".

## Don't

- Don't make rows glass, even inside a map sheet. Rows are content.
- Don't show more than the two people in a session in v1.
