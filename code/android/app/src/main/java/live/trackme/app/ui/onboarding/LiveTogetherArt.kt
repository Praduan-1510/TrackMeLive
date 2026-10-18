package live.trackme.app.ui.onboarding

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import live.trackme.app.ui.mascot.MascotImage
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.design.TmlTheme

/**
 * Onboarding page 2's picture (prototype `.a-ob-map`): a corner of the prototype's street map, drawn
 * in the map tokens, with the sharer's fox marker on the main road and the viewer's "M" marker near
 * home. Decorative: the title and text below say what it shows.
 */
@Composable
fun LiveTogetherArt(modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val frame = RoundedCornerShape(28.dp)
    val land = c.mapLand
    val park = c.mapPark
    val road = c.mapRoad
    val major = c.mapRoadMajor
    BoxWithConstraints(
        modifier
            .size(width = 330.dp, height = 280.dp)
            .clip(frame)
            .border(1.dp, c.separator, frame),
    ) {
        // The prototype's viewBox (120 120 300 255) fills the frame like SVG's xMidYMid slice.
        val unit = maxOf(maxWidth / VIEW_W, maxHeight / VIEW_H)
        val originX = (maxWidth - unit * VIEW_W) / 2
        val originY = (maxHeight - unit * VIEW_H) / 2
        fun x(v: Float): Dp = originX + unit * (v - VIEW_X)
        fun y(v: Float): Dp = originY + unit * (v - VIEW_Y)

        Canvas(Modifier.fillMaxSize()) {
            val k = unit.toPx()
            val ox = originX.toPx()
            val oy = originY.toPx()
            fun o(px: Float, py: Float) = Offset(ox + (px - VIEW_X) * k, oy + (py - VIEW_Y) * k)

            drawRect(land)
            PARKS.forEach { (px, py, w, h, r) ->
                drawRoundRect(park, topLeft = o(px, py), size = Size(w * k, h * k), cornerRadius = CornerRadius(r * k))
            }
            STREETS.forEach { (x1, y1, x2, y2) ->
                drawLine(road, o(x1, y1), o(x2, y2), strokeWidth = 9f * k, cap = StrokeCap.Round)
            }
            val main = Path().apply {
                val p0 = o(P0.x, P0.y)
                val p1 = o(P1.x, P1.y)
                val p2 = o(P2.x, P2.y)
                val p3 = o(P3.x, P3.y)
                moveTo(p0.x, p0.y)
                cubicTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
            }
            drawPath(main, major, style = Stroke(width = 14f * k, cap = StrokeCap.Round))
        }

        val sharer = bezier(SHARER_T)
        Centered(x(sharer.x), y(sharer.y)) { SharerMarker() }
        // As in the prototype, the viewer sits 30dp below home so the two markers don't touch.
        Centered(x(HOME.x), y(HOME.y) + 30.dp) { ViewerMarker() }
    }
}

/** Centers [content] on (x, y) in an 80dp box, the size of the sharer's halo. */
@Composable
private fun Centered(x: Dp, y: Dp, content: @Composable () -> Unit) {
    Box(Modifier.offset(x - 40.dp, y - 40.dp).size(80.dp), contentAlignment = Alignment.Center) { content() }
}

/**
 * The sharer's marker (design-system README › Mascots and markers): a 52dp surface disc with a 3dp
 * lamplight ring, the mascot inside, an 80dp lamplight halo, and a 1dp keyline outside the ring
 * (on-lamplight in light, ground in dark).
 */
@Composable
private fun SharerMarker() {
    val c = TmlTheme.colors
    val keyline = if (c.ground.isDark()) c.ground else c.onLamplight
    Box(Modifier.size(80.dp).clip(CircleShape).background(c.lamplightHalo))
    Box(
        Modifier
            .size(54.dp)
            .shadow(6.dp, CircleShape)
            .background(keyline, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(52.dp)
                .background(c.surface, CircleShape)
                .border(3.dp, c.lamplight, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            MascotImage(look = MascotLook(), size = 42.dp, flatWhileLoading = true)
        }
    }
}

/** The viewer's marker: a 48dp crossing disc with the initial, a 3dp surface ring and a 72dp crossing halo. */
@Composable
private fun ViewerMarker() {
    val c = TmlTheme.colors
    Box(Modifier.size(72.dp).clip(CircleShape).background(c.crossingHalo))
    Box(
        Modifier
            .size(48.dp)
            .shadow(6.dp, CircleShape)
            .background(c.crossing, CircleShape)
            .border(3.dp, c.surface, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "M",
            style = TextStyle(fontFamily = TmlTheme.type.display, fontWeight = FontWeight.W800, fontSize = 18.sp),
            color = c.onCrossing,
        )
    }
}

private fun Color.isDark(): Boolean = luminance() < 0.5f

/** The prototype's main road (prototype/js/map.js): a cubic bezier from the lower left to the upper right. */
private fun bezier(t: Float): Offset {
    val u = 1 - t
    val a = u * u * u
    val b = 3 * u * u * t
    val c = 3 * u * t * t
    val d = t * t * t
    return Offset(a * P0.x + b * P1.x + c * P2.x + d * P3.x, a * P0.y + b * P1.y + c * P2.y + d * P3.y)
}

private const val VIEW_X = 120f
private const val VIEW_Y = 120f
private const val VIEW_W = 300f
private const val VIEW_H = 255f
private const val SHARER_T = 0.66f
private val P0 = Offset(-20f, 560f)
private val P1 = Offset(120f, 470f)
private val P2 = Offset(200f, 330f)
private val P3 = Offset(410f, 170f)
private val HOME = Offset(326f, 150f)

/** x, y, width, height, corner radius. */
private val PARKS = listOf(
    floatArrayOf(252f, 34f, 124f, 86f, 18f),
    floatArrayOf(22f, 176f, 112f, 92f, 18f),
    floatArrayOf(262f, 356f, 104f, 70f, 16f),
)

/** x1, y1, x2, y2. */
private val STREETS = listOf(
    floatArrayOf(-300f, 152f, 700f, 84f),
    floatArrayOf(-300f, 341f, 700f, 263f),
    floatArrayOf(-300f, 493f, 700f, 415f),
    floatArrayOf(86f, -300f, 138f, 1150f),
    floatArrayOf(218f, -300f, 256f, 1150f),
    floatArrayOf(330f, -300f, 358f, 1150f),
)
