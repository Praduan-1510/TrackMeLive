package live.trackme.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import live.trackme.app.R
import live.trackme.app.ui.mascot.MascotImage
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.design.TmlShadows
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId

/** What the marker says about how fresh and how exact the location is. */
enum class MarkerState {
    /** A recent fix: halo and shadow. */
    Live,

    /** The sharer chose approximate: the area circle, drawn to the map's scale, in place of the halo. */
    Approximate,

    /** Stale: dashed ring, no halo, no shadow, a faded mascot. Never a live-looking marker. */
    LastSeen,
}

/** Sizes from components/PersonMarker. */
object PersonMarkerDefaults {
    /** The sharer's disc, its ring, the render inside and the halo behind. */
    val SharerDisc: Dp = 52.dp
    val SharerRing: Dp = 3.dp
    val SharerArt: Dp = 40.dp
    val SharerHalo: Dp = 80.dp

    /** The keyline outside the sharer's ring (1pt; 2pt under more contrast). */
    val Keyline: Dp = 1.dp

    /** The viewer's disc, its surface ring, the person icon and the halo. */
    val ViewerDisc: Dp = 48.dp
    val ViewerRing: Dp = 3.dp
    val ViewerIcon: Dp = 26.dp
    val ViewerHalo: Dp = 72.dp

    /** The viewer's initial on the map (Gabarito Bold, 18) and in a row's avatar (16). */
    val MarkerInitial: TextUnit = 18.sp
    val AvatarInitial: TextUnit = 16.sp

    /** The name capsule's top, below the marker's center. */
    val SharerCapsuleOffset: Dp = 34.dp
    val ViewerCapsuleOffset: Dp = 32.dp

    /** Half of the approximate area at the prototype's zoom; callers pass 500 m at the map's scale. */
    val ApproximateRadius: Dp = 83.dp

    /** The approximate area's faint `lamplight` edge, at 45%. */
    val AreaEdge: Dp = 1.5.dp
    const val AREA_EDGE_ALPHA = 0.45f

    /** A last-seen mascot is drawn at 55%. */
    const val STALE_ALPHA = 0.55f

    /** After a ping: one 3dp bob and one breath of the halo over 2.4 s, then rest. */
    val BobLift: Dp = 3.dp
    const val PING_HALF_MILLIS = 1200
    const val HALO_BREATH = 0.12f
}

/**
 * Where a person is on the map. The sharer is their mascot in a `lamplight` ring on a `surface` disc;
 * the viewer is a `crossing` disc with an initial or a person icon. Both carry a name capsule
 * ([label]: "You", the name, or "Last seen 9:41 pm"). The marker is one accessibility element read
 * as [contentDescription] ("Alex, live, 1.2 kilometers away, updated 2 seconds ago").
 *
 * The person's point is the center of the top halo-sized square ([haloSize]). Change [pingKey] after
 * each ping to bob the marker once and breathe its halo; Remove animations keeps it still.
 */
@Composable
fun PersonMarker(
    person: Person,
    label: String,
    contentDescription: String,
    modifier: Modifier = Modifier,
    state: MarkerState = MarkerState.Live,
    approximateRadius: Dp = PersonMarkerDefaults.ApproximateRadius,
    pingKey: Any? = null,
) {
    val d = PersonMarkerDefaults
    val sharer = person is Person.Sharer
    val halo = haloSize(person)
    val capsuleOffset = if (sharer) d.SharerCapsuleOffset else d.ViewerCapsuleOffset
    val reduceMotion = rememberReduceMotion()
    val bob = remember { Animatable(0f) }
    val breath = remember { Animatable(0f) }
    LaunchedEffect(pingKey, state, reduceMotion) {
        if (pingKey == null || reduceMotion || state == MarkerState.LastSeen) return@LaunchedEffect
        val spec = tween<Float>(d.PING_HALF_MILLIS, easing = FastOutSlowInEasing)
        launch { bob.animateTo(1f, spec); bob.animateTo(0f, spec) }
        launch { breath.animateTo(1f, spec); breath.animateTo(0f, spec) }
    }
    Layout(
        modifier = modifier.clearAndSetSemantics { this.contentDescription = contentDescription },
        content = {
            Box(Modifier.size(halo), contentAlignment = Alignment.Center) {
                MarkerBackdrop(sharer, state, halo, approximateRadius, breath = { breath.value })
                MarkerDisc(person, state, Modifier.graphicsLayer { translationY = -bob.value * d.BobLift.toPx() })
            }
            NameCapsule(label, stale = state == MarkerState.LastSeen)
        },
    ) { measurables, constraints ->
        val loose = Constraints(maxWidth = constraints.maxWidth, maxHeight = constraints.maxHeight)
        val marker = measurables[0].measure(loose)
        val capsule = measurables[1].measure(loose)
        val capsuleTop = marker.height / 2 + capsuleOffset.roundToPx()
        val width = maxOf(marker.width, capsule.width)
        val height = maxOf(marker.height, capsuleTop + capsule.height)
        layout(width, height) {
            marker.place((width - marker.width) / 2, 0)
            capsule.place((width - capsule.width) / 2, capsuleTop)
        }
    }
}

/** The square, centered on the person's point, that holds the halo and the disc. */
fun haloSize(person: Person): Dp =
    if (person is Person.Sharer) PersonMarkerDefaults.SharerHalo else PersonMarkerDefaults.ViewerHalo

@Composable
private fun MarkerBackdrop(sharer: Boolean, state: MarkerState, halo: Dp, approximateRadius: Dp, breath: () -> Float) {
    val c = TmlTheme.colors
    val d = PersonMarkerDefaults
    when {
        state == MarkerState.LastSeen -> Unit
        state == MarkerState.Approximate && sharer -> Box(
            Modifier.size(halo).drawBehind {
                val r = approximateRadius.toPx()
                drawCircle(c.lamplightHalo, radius = r)
                val edge = d.AreaEdge.toPx()
                drawCircle(c.lamplight.copy(alpha = d.AREA_EDGE_ALPHA), radius = r - edge / 2, style = Stroke(edge))
            },
        )
        else -> Box(
            Modifier
                .size(halo)
                .graphicsLayer {
                    val s = 1f + breath() * d.HALO_BREATH
                    scaleX = s
                    scaleY = s
                }
                .clip(CircleShape)
                .background(if (sharer) c.lamplightHalo else c.crossingHalo),
        )
    }
}

@Composable
private fun MarkerDisc(person: Person, state: MarkerState, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val d = PersonMarkerDefaults
    val stale = state == MarkerState.LastSeen
    val shadowToken = if (c.isDark) TmlShadows.MarkerDark else TmlShadows.MarkerLight
    val shadow = Modifier.dropShadow(
        CircleShape,
        Shadow(radius = shadowToken.blur, color = shadowToken.color, offset = DpOffset(shadowToken.offsetX, shadowToken.offsetY)),
    )
    val dashPx = with(LocalDensity.current) { TmlSpacing.Space1.toPx() }
    when (person) {
        is Person.Sharer -> {
            val ring = if (stale) {
                Modifier.drawBehind {
                    drawLastSeenRing(c.inkTertiary, d.SharerRing.toPx(), dashPx)
                }
            } else {
                Modifier.border(d.SharerRing, c.lamplight, CircleShape)
            }
            // The keyline holds the marker at 3:1 on light map colors; in dark it keeps the edge on the night map.
            val keyline = if (c.isDark) c.ground else c.onLamplight
            Box(
                modifier
                    .size(d.SharerDisc)
                    .then(if (stale) Modifier else shadow)
                    .then(
                        if (stale) {
                            Modifier
                        } else {
                            Modifier.drawBehind {
                                val w = d.Keyline.toPx()
                                drawCircle(keyline, radius = size.minDimension / 2 + w / 2, style = Stroke(w))
                            }
                        },
                    )
                    .clip(CircleShape)
                    .background(c.surface)
                    .then(ring),
                contentAlignment = Alignment.Center,
            ) {
                MascotImage(
                    look = person.look,
                    size = d.SharerArt,
                    alpha = if (stale) d.STALE_ALPHA else 1f,
                    flatWhileLoading = true,
                )
            }
        }
        is Person.Viewer -> Box(
            modifier
                .size(d.ViewerDisc)
                .then(if (stale) Modifier else shadow)
                .clip(CircleShape)
                .background(if (stale) c.surfaceRaised else c.crossing)
                .then(
                    if (stale) {
                        Modifier.drawBehind {
                            drawLastSeenRing(c.inkTertiary, d.ViewerRing.toPx(), dashPx)
                        }
                    } else {
                        Modifier.border(d.ViewerRing, c.surface, CircleShape)
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            ViewerMark(
                initial = person.initial,
                color = if (stale) c.inkSecondary else c.onCrossing,
                iconSize = d.ViewerIcon,
                initialSize = d.MarkerInitial,
            )
        }
    }
}

/** "You", the person's name, or "Last seen 9:41 pm": `caption-1` on `surface` with a `separator` edge. */
@Composable
private fun NameCapsule(text: String, stale: Boolean) {
    val c = TmlTheme.colors
    val shape = RoundedCornerShape(percent = 50)
    Row(
        Modifier
            .clip(shape)
            .background(c.surface)
            .border(LayoutDefaults.Hairline, c.separator, shape)
            .padding(horizontal = TmlSpacing.Space2, vertical = MarkerCapsulePadding),
        horizontalArrangement = Arrangement.Center,
    ) {
        Text(text, style = TmlTheme.type.caption1.tabular(), color = if (stale) c.inkSecondary else c.ink)
    }
}

/** The capsule's vertical padding (prototype `.mk .name span`). */
private val MarkerCapsulePadding: Dp = 2.dp

@ComponentPreviews
@Composable
private fun PersonMarkerPreview() {
    PreviewSurface {
        Row(
            Modifier.background(TmlTheme.colors.mapLand).padding(TmlSpacing.Space4),
            horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space4),
        ) {
            val you = stringResource(R.string.preview_name_you)
            val look = MascotLook(MascotId.FOX, MascotColor.ORIGINAL, MascotAccessory.GLASSES)
            PersonMarker(Person.Sharer(look), label = you, contentDescription = you)
            val mom = stringResource(R.string.preview_name_mom)
            PersonMarker(Person.Viewer(mom.take(1)), label = mom, contentDescription = mom)
            PersonMarker(Person.Viewer(null), label = stringResource(R.string.preview_name_them), contentDescription = you)
            val lastSeen = stringResource(R.string.preview_pill_last_seen)
            PersonMarker(Person.Sharer(look), label = lastSeen, contentDescription = lastSeen, state = MarkerState.LastSeen)
        }
    }
}
