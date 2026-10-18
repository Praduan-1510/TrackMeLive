package live.trackme.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.TextUnit
import live.trackme.app.R
import live.trackme.app.ui.mascot.MascotImage
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.design.TmlRadius
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId

/** Who a row or a marker stands for. */
@Immutable
sealed interface Person {
    /** The sharer, drawn as their mascot. */
    data class Sharer(val look: MascotLook) : Person

    /** The viewer, who has no account: the initial of the name the sharer gave, or a person icon. */
    data class Viewer(val initial: String?) : Person
}

/** How a person's status word is colored. Neutral is for Waiting, Watching and Last seen. */
enum class StatusTone { Sharer, Viewer, Neutral }

/** Sizes from components/PersonRow. */
object PersonRowDefaults {
    /** The row's minimum height. */
    val MinHeight: Dp = 64.dp

    /** The avatar disc. */
    val Avatar: Dp = 40.dp

    /** The mascot inside the sharer's avatar (the 32dp avatar export). */
    val AvatarArt: Dp = 32.dp

    /** The sharer's lamplight ring, and the dashed ring when stale. */
    val AvatarRing: Dp = 2.dp

    /** The viewer's person icon inside the avatar. */
    val AvatarIcon: Dp = 22.dp

    /** The status dot. */
    val StatusDot: Dp = 8.dp

    /** The divider starts at the text: 16 + 40 + 12. */
    val DividerInset: Dp = 68.dp

    /** At this font scale and above, the status word moves under the text (accessibility sizes). */
    const val STACK_FONT_SCALE = 1.3f
}

/** The dashed `ink-tertiary` ring of a last-seen avatar or marker, [width] px wide, inside the bounds. */
internal fun DrawScope.drawLastSeenRing(color: Color, width: Float, dash: Float) {
    drawCircle(
        color = color,
        radius = size.minDimension / 2 - width / 2,
        style = Stroke(width = width, pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash))),
    )
}

/**
 * The 40dp avatar: the sharer's mascot in a `surface-raised` disc with a 2dp `lamplight` ring, or the
 * viewer's initial (or a person icon) in a `crossing` disc. [stale] draws the last-seen look: a dashed
 * `ink-tertiary` ring, the mascot faded, the viewer's mark in `ink-secondary`.
 */
@Composable
fun PersonAvatar(person: Person, modifier: Modifier = Modifier, stale: Boolean = false) {
    val c = TmlTheme.colors
    val d = PersonRowDefaults
    val dashPx = with(LocalDensity.current) { TmlSpacing.Space1.toPx() }
    val ringModifier = if (stale) {
        Modifier.drawBehind {
            drawLastSeenRing(c.inkTertiary, d.AvatarRing.toPx(), dashPx)
        }
    } else {
        Modifier
    }
    when (person) {
        is Person.Sharer -> Box(
            modifier
                .size(d.Avatar)
                .clip(CircleShape)
                .background(c.surfaceRaised)
                .then(if (stale) ringModifier else Modifier.border(d.AvatarRing, c.lamplight, CircleShape)),
            contentAlignment = Alignment.Center,
        ) {
            MascotImage(
                look = person.look,
                size = d.AvatarArt,
                alpha = if (stale) PersonMarkerDefaults.STALE_ALPHA else 1f,
                flatWhileLoading = true,
            )
        }
        is Person.Viewer -> Box(
            modifier
                .size(d.Avatar)
                .clip(CircleShape)
                .background(if (stale) c.surfaceRaised else c.crossing)
                .then(ringModifier),
            contentAlignment = Alignment.Center,
        ) {
            ViewerMark(
                initial = person.initial,
                color = if (stale) c.inkSecondary else c.onCrossing,
                iconSize = d.AvatarIcon,
                initialSize = PersonMarkerDefaults.AvatarInitial,
            )
        }
    }
}

/** The viewer's initial in Gabarito, or the person icon when the sharer gave no name. */
@Composable
internal fun ViewerMark(initial: String?, color: Color, iconSize: Dp, initialSize: TextUnit) {
    if (initial.isNullOrBlank()) {
        Icon(painterResource(R.drawable.ic_person_filled), contentDescription = null, tint = color, modifier = Modifier.size(iconSize))
    } else {
        Text(
            text = initial,
            style = TmlTheme.type.metric.copy(fontWeight = FontWeight.W800, fontSize = initialSize, lineHeight = initialSize),
            color = color,
        )
    }
}

/**
 * One person in a session, as a grouped-list row: avatar, name, a detail line and a status word with
 * a dot. Names and details wrap; at accessibility sizes the status moves under the text. The row
 * reads as one element: pass [spokenDescription] ("Mom, live, sharing back, updated 3 seconds ago",
 * built with long units) or TalkBack reads the visible text in order.
 */
@Composable
fun PersonRow(
    person: Person,
    name: String,
    detail: String,
    modifier: Modifier = Modifier,
    status: String? = null,
    statusTone: StatusTone = StatusTone.Neutral,
    stale: Boolean = false,
    spokenDescription: String? = null,
) {
    val d = PersonRowDefaults
    val stack = LocalDensity.current.fontScale >= d.STACK_FONT_SCALE
    val semantics = if (spokenDescription != null) {
        Modifier.clearAndSetSemantics { contentDescription = spokenDescription }
    } else {
        Modifier.semantics(mergeDescendants = true) {}
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = d.MinHeight)
            .then(semantics)
            .padding(horizontal = TmlSpacing.Space4, vertical = TmlSpacing.Space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space3),
    ) {
        PersonAvatar(person, stale = stale)
        Column(Modifier.weight(1f)) {
            Text(name, style = TmlTheme.type.headline, color = TmlTheme.colors.ink)
            Text(detail, style = TmlTheme.type.subheadline.tabular(), color = TmlTheme.colors.inkSecondary)
            if (stack && status != null) PersonStatus(status, statusTone, Modifier.padding(top = TmlSpacing.Space1))
        }
        if (!stack && status != null) PersonStatus(status, statusTone)
    }
}

@Composable
private fun PersonStatus(text: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val (dot, ink) = when (tone) {
        StatusTone.Sharer -> c.lamplight to c.lamplightText
        StatusTone.Viewer -> c.crossing to c.crossingText
        StatusTone.Neutral -> c.inkSecondary to c.inkSecondary
    }
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2)) {
        if (tone == StatusTone.Neutral) {
            Box(Modifier.size(PersonRowDefaults.StatusDot).border(StatusPillDefaults.DotRing, dot, CircleShape))
        } else {
            Box(Modifier.size(PersonRowDefaults.StatusDot).clip(CircleShape).background(dot))
        }
        Text(text, style = TmlTheme.type.subheadline.copy(fontWeight = FontWeight.W600), color = ink)
    }
}

/** The `separator` line between person rows, starting at the text. */
@Composable
fun PersonRowDivider(modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .padding(start = PersonRowDefaults.DividerInset)
            .height(LayoutDefaults.Hairline)
            .background(TmlTheme.colors.separator),
    )
}

@ComponentPreviews
@Composable
private fun PersonRowPreview() {
    PreviewSurface {
        Column(Modifier.clip(RoundedCornerShape(TmlRadius.Lg)).background(TmlTheme.colors.surface)) {
            PersonRow(
                person = Person.Sharer(MascotLook(MascotId.FOX, MascotColor.ORIGINAL)),
                name = stringResource(R.string.preview_name_you),
                detail = stringResource(R.string.preview_detail_updated),
                status = stringResource(R.string.preview_status_live),
                statusTone = StatusTone.Sharer,
            )
            PersonRowDivider()
            PersonRow(
                person = Person.Viewer(stringResource(R.string.preview_name_mom).take(1)),
                name = stringResource(R.string.preview_name_mom),
                detail = stringResource(R.string.preview_detail_link_sent),
                status = stringResource(R.string.preview_status_waiting),
            )
            PersonRowDivider()
            PersonRow(
                person = Person.Viewer(null),
                name = stringResource(R.string.preview_name_them),
                detail = stringResource(R.string.preview_pill_last_seen),
                status = stringResource(R.string.preview_status_watching),
                stale = true,
            )
        }
    }
}
