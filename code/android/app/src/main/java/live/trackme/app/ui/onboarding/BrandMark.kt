package live.trackme.app.ui.onboarding

import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp
import live.trackme.design.TmlTheme

/**
 * The Callout mark (brand/logo/mark.svg, mark-on-dark.svg): a lamplight speech bubble around a ring and
 * a dot. Its body is the theme's lamplight, which is exactly the logo's amber in each theme; the ring
 * and dot are the logo's fixed colors. Built in code so it follows the in-app theme, which can differ
 * from the system's. Decorative.
 */
@Composable
fun BrandMark(modifier: Modifier = Modifier) {
    val body = TmlTheme.colors.lamplight
    val mark = remember(body) { brandMark(body) }
    Image(mark, contentDescription = null, modifier = modifier)
}

private val RING = Color(0xFFFFE3BA)
private val DOT = Color(0xFFFFFFFF)

private fun brandMark(body: Color): ImageVector =
    ImageVector.Builder(name = "BrandMark", defaultWidth = 84.5.dp, defaultHeight = 98.5.dp, viewportWidth = 84.5f, viewportHeight = 98.5f)
        // The SVG's translate(-23.5 -12.5), applied to the path coordinates.
        .addGroup(translationX = -23.5f, translationY = -12.5f)
        .addPath(
            pathData = PathParser().parsePathString(
                "M52.32 91.59 A40 40 0 1 0 29.75 70.9 Q32.39 88.89 29.1 104 Q29 109 33.01 106.01 Q41.61 97.24 52.32 91.59 Z",
            ).toNodes(),
            fill = SolidColor(body),
            stroke = SolidColor(body),
            strokeLineWidth = 3f,
            strokeLineJoin = StrokeJoin.Round,
        )
        .addPath(
            pathData = PathParser().parsePathString("M45 54 A21 21 0 1 0 87 54 A21 21 0 1 0 45 54 Z").toNodes(),
            stroke = SolidColor(RING),
            strokeLineWidth = 6.5f,
        )
        .addPath(
            pathData = PathParser().parsePathString("M55.5 54 A10.5 10.5 0 1 0 76.5 54 A10.5 10.5 0 1 0 55.5 54 Z").toNodes(),
            fill = SolidColor(DOT),
        )
        .clearGroup()
        .build()
