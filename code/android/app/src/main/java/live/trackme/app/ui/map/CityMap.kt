package live.trackme.app.ui.map

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import live.trackme.design.TmlTheme

/**
 * The prototype's street map (prototype/js/map.js), drawn in the map tokens without street names: the
 * map for anyone without the Maps API (no key in this build, or the map failed to load) and the share
 * screen's preview. It draws the same picture wherever the person is, so it's decorative: the screen
 * says in words where things stand, and markers carry their own descriptions.
 *
 * The city point [focus] lands at [focusAt] (fractions of the canvas), at [unitPx] pixels per city
 * unit (the prototype's CSS px).
 */
@Composable
fun CityMap(
    modifier: Modifier = Modifier,
    focus: Offset = CityMapGeometry.Start,
    focusAt: Offset = Offset(0.5f, 0.5f),
    unitPx: Float? = null,
) {
    val c = TmlTheme.colors
    Canvas(modifier.clearAndSetSemantics { }) {
        val k = unitPx ?: density
        val ox = size.width * focusAt.x - focus.x * k
        val oy = size.height * focusAt.y - focus.y * k
        fun o(x: Float, y: Float) = Offset(ox + x * k, oy + y * k)

        drawRect(c.mapLand)
        val water = Path().apply {
            val w = CityMapGeometry.WATER
            moveTo(o(w[0], w[1]).x, o(w[0], w[1]).y)
            var i = 2
            while (i + 5 < w.size) {
                val a = o(w[i], w[i + 1])
                val b = o(w[i + 2], w[i + 3])
                val d = o(w[i + 4], w[i + 5])
                cubicTo(a.x, a.y, b.x, b.y, d.x, d.y)
                i += 6
            }
            close()
        }
        drawPath(water, c.mapWater)
        CityMapGeometry.PARKS.forEach { (x, y, w, h, r) ->
            drawRoundRect(c.mapPark, topLeft = o(x, y), size = Size(w * k, h * k), cornerRadius = CornerRadius(r * k))
        }
        CityMapGeometry.STREETS.forEach { (x1, y1, x2, y2) ->
            drawLine(c.mapRoad, o(x1, y1), o(x2, y2), strokeWidth = ROAD * k, cap = StrokeCap.Round)
        }
        val g = CityMapGeometry
        val main = Path().apply {
            val s = o(g.EXTENSION.x, g.EXTENSION.y)
            val p0 = o(g.P0.x, g.P0.y)
            val p1 = o(g.P1.x, g.P1.y)
            val p2 = o(g.P2.x, g.P2.y)
            val p3 = o(g.P3.x, g.P3.y)
            moveTo(s.x, s.y)
            lineTo(p0.x, p0.y)
            cubicTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
        }
        drawPath(main, c.mapRoadMajor, style = Stroke(width = MAJOR * k, cap = StrokeCap.Round))
    }
}

/** Road widths in city units (prototype `.m-road`, `.m-major`). */
private const val ROAD = 9f
private const val MAJOR = 16f

/** The prototype's city, in its CSS px (390 by 844). */
object CityMapGeometry {
    /** The main road, a cubic bezier from the lower left to the upper right. */
    val P0 = Offset(-20f, 560f)
    val P1 = Offset(120f, 470f)
    val P2 = Offset(200f, 330f)
    val P3 = Offset(410f, 170f)
    val EXTENSION = Offset(-40f, 590f)

    /** Where a walk starts on the main road (prototype `M.T_START`). */
    val Start: Offset = bezier(0.6f)

    /** A point on the main road. */
    fun bezier(t: Float): Offset {
        val u = 1 - t
        val a = u * u * u
        val b = 3 * u * u * t
        val c = 3 * u * t * t
        val d = t * t * t
        return Offset(a * P0.x + b * P1.x + c * P2.x + d * P3.x, a * P0.y + b * P1.y + c * P2.y + d * P3.y)
    }

    /** The harbor: a start point, then cubic segments (three points each). */
    internal val WATER = floatArrayOf(
        -30f, 610f,
        90f, 576f, 180f, 646f, 280f, 614f,
        340f, 596f, 380f, 588f, 430f, 594f,
        430f, 594f, 430f, 720f, 430f, 720f,
        330f, 712f, 250f, 744f, 160f, 728f,
        90f, 716f, 30f, 724f, -30f, 732f,
    )

    /** x, y, width, height, corner radius. */
    internal val PARKS = listOf(
        floatArrayOf(252f, 34f, 124f, 86f, 18f),
        floatArrayOf(22f, 176f, 112f, 92f, 18f),
        floatArrayOf(262f, 356f, 104f, 70f, 16f),
    )

    /** x1, y1, x2, y2. */
    internal val STREETS = listOf(
        floatArrayOf(-300f, 152f, 700f, 84f),
        floatArrayOf(-300f, 341f, 700f, 263f),
        floatArrayOf(-300f, 493f, 700f, 415f),
        floatArrayOf(-300f, 806f, 700f, 752f),
        floatArrayOf(86f, -300f, 138f, 1150f),
        floatArrayOf(218f, -300f, 256f, 1150f),
        floatArrayOf(330f, -300f, 358f, 1150f),
    )
}
