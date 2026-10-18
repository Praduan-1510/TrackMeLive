package live.trackme.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.design.TmlColors
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** The five pill looks (components/StatusPill). New states map onto these; never a new color. */
enum class PillKind {
    /** Live, sharer: `lamplight-text` on `lamplight-wash`, `lamplight` dot. */
    Sharer,

    /** Live, viewer: `crossing-text` on `crossing-wash`, `crossing` dot. */
    Viewer,

    /** Last seen, Not sharing, No signal, No connection, Reconnecting: neutral, hollow dot. */
    Neutral,

    /** Sharing ended: `ink` on `surface-raised`, small square. */
    Ended,

    /** On a call: `connected` on `connected-wash`, phone glyph. */
    Call,
}

/** The three badge looks next to a title (components/StatusPill › Badge). */
enum class BadgeKind { Live, Together, Neutral }

/** Sizes from components/StatusPill and the prototype's `.pill` and `.badge`. */
object StatusPillDefaults {
    /** Pill height: footnote semibold, 30 tall. */
    val MinHeight: Dp = 30.dp

    /** The color mark before the word. */
    val Dot: Dp = 8.dp

    /** The ring of the hollow (neutral) dot. */
    val DotRing: Dp = 2.dp

    /** The ended square's corner. */
    val SquareCorner: Dp = 1.dp

    /** The phone glyph of the call pill. */
    val Glyph: Dp = 14.dp

    /** Badge height. */
    val BadgeMinHeight: Dp = 22.dp

    /** The badge's dot. */
    val BadgeDot: Dp = 6.dp
}

/**
 * A capsule that names one person's or one session's state in words, with a small color mark as a
 * second signal: Live, Last seen, Sharing ended, On a call. With [announceChanges], TalkBack reads
 * a new word politely when the state changes; leave it off for anything that ticks.
 */
@Composable
fun StatusPill(
    text: String,
    modifier: Modifier = Modifier,
    kind: PillKind = PillKind.Neutral,
    announceChanges: Boolean = false,
) {
    val (container, content, mark) = kind.colors(TmlTheme.colors)
    Row(
        modifier = modifier
            .heightIn(min = StatusPillDefaults.MinHeight)
            .clip(RoundedCornerShape(percent = 50))
            .background(container)
            .padding(horizontal = TmlSpacing.Space3, vertical = TmlSpacing.Space1)
            .then(if (announceChanges) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
    ) {
        PillMark(kind, mark)
        Text(text = text, style = AppType.pill.tabular(), color = content)
    }
}

@Composable
private fun PillMark(kind: PillKind, color: Color) {
    val d = StatusPillDefaults
    when (kind) {
        PillKind.Sharer, PillKind.Viewer -> Box(Modifier.size(d.Dot).clip(CircleShape).background(color))
        PillKind.Neutral -> Box(Modifier.size(d.Dot).border(d.DotRing, color, CircleShape))
        PillKind.Ended -> Box(Modifier.size(d.Dot).clip(RoundedCornerShape(d.SquareCorner)).background(color))
        PillKind.Call -> Icon(
            painter = painterResource(R.drawable.ic_call_filled),
            contentDescription = null,
            tint = color,
            modifier = Modifier.size(d.Glyph),
        )
    }
}

/**
 * The uppercase badge beside a title: LIVE, LIVE TOGETHER, NO SIGNAL, NO CONNECTION. The only
 * uppercase text anywhere, in the `badge` style; [text] comes from resources already uppercase.
 */
@Composable
fun StatusBadge(text: String, modifier: Modifier = Modifier, kind: BadgeKind = BadgeKind.Live, spoken: String? = null) {
    val c = TmlTheme.colors
    val (container, content) = when (kind) {
        BadgeKind.Live -> c.lamplightWash to c.lamplightText
        BadgeKind.Together -> c.crossingWash to c.crossingText
        BadgeKind.Neutral -> c.surfaceRaised to c.inkSecondary
    }
    Row(
        modifier = modifier
            .heightIn(min = StatusPillDefaults.BadgeMinHeight)
            .clip(RoundedCornerShape(percent = 50))
            .background(container)
            // Uppercase to the eye, a plain phrase to TalkBack ("Sharing live", not spelled-out letters).
            .then(if (spoken != null) Modifier.clearAndSetSemantics { contentDescription = spoken } else Modifier)
            .padding(horizontal = TmlSpacing.Space2, vertical = TmlSpacing.Space1),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
    ) {
        if (kind == BadgeKind.Live) {
            Box(Modifier.size(StatusPillDefaults.BadgeDot).clip(CircleShape).background(c.lamplight))
        }
        Text(text = text, style = TmlTheme.type.badge, color = content)
    }
}

private data class PillColors(val container: Color, val content: Color, val mark: Color)

private fun PillKind.colors(c: TmlColors): PillColors = when (this) {
    PillKind.Sharer -> PillColors(c.lamplightWash, c.lamplightText, c.lamplight)
    PillKind.Viewer -> PillColors(c.crossingWash, c.crossingText, c.crossing)
    PillKind.Neutral -> PillColors(c.surfaceRaised, c.inkSecondary, c.inkSecondary)
    PillKind.Ended -> PillColors(c.surfaceRaised, c.ink, c.ink)
    PillKind.Call -> PillColors(c.connectedWash, c.connected, c.connected)
}

@ComponentPreviews
@Composable
private fun StatusPillPreview() {
    PreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space2)) {
            StatusPill(stringResource(R.string.preview_pill_live), kind = PillKind.Sharer)
            StatusPill(stringResource(R.string.preview_pill_sharing_back), kind = PillKind.Viewer)
            StatusPill(stringResource(R.string.preview_pill_last_seen), kind = PillKind.Neutral)
            StatusPill(stringResource(R.string.preview_pill_ended), kind = PillKind.Ended)
            StatusPill(stringResource(R.string.preview_pill_call), kind = PillKind.Call)
            StatusBadge(stringResource(R.string.preview_badge_live))
            StatusBadge(stringResource(R.string.preview_badge_together), kind = BadgeKind.Together)
            StatusBadge(stringResource(R.string.preview_badge_no_signal), kind = BadgeKind.Neutral)
        }
    }
}
