# StatusPill

A capsule that names one person's or one session's state in words, with a small color mark: Live, Last seen, Sharing ended, On a call.

## States

- **Live, sharer**: `lamplight-text` on `lamplight-wash`, `lamplight` dot. "Live · updated 2 s ago".
- **Live, viewer**: `crossing-text` on `crossing-wash`, `crossing` dot. "Sharing back".
- **Last seen**: `ink-secondary` on `surface-raised`, hollow dot. "Last seen 9:41 pm".
- **Sharing ended**: `ink` on `surface-raised`, small square. "Sharing ended at 9:52 pm".
- **On a call**: `connected` on `connected-wash`, phone glyph. "On a call · 04:12".
- **Badge**: the `badge` style, the only uppercase text, for LIVE, LIVE TOGETHER, NO SIGNAL and NO CONNECTION next to a title.
- **No signal, No connection, Reconnecting**: the Last seen style. They're neutral, not alarming.

## The consumer provides

- The state and its words. Times and counts in tabular figures.

## Do

- Always include the word. The dot or glyph is a second signal, never the only one.
- Announce a change of state politely to screen readers. When sharing ends, the viewer's page announces its ended heading once, as an alert: "Alex stopped sharing" after Stop, otherwise "Sharing ended".
- Use `footnote` (13pt) semibold text, 30pt tall, `radius-pill`.

## Don't

- Don't use `flare` in a pill. Ended, stopped and error states are neutral, not alarming; `flare` is only for stopping and deleting.
- Don't invent new colors for new states; map them to these five.
