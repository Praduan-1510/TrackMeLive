package live.trackme.app.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.IntrinsicMeasurable
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp

/** What a child must fit for [AdaptiveRow] to keep the children side by side. */
enum class AdaptiveFit {
    /** Its whole content on one line (buttons: labels never wrap beside each other). */
    Natural,

    /** Its minimum width (stat tiles: the value whole, the label wrapping between words). */
    Minimum,
}

/**
 * Side by side in equal widths while every child fits by [fit]; otherwise one column, each child
 * full width. For tiles and paired buttons whose values and labels must never truncate or shrink at
 * large text (design-system README › Large text).
 */
@Composable
fun AdaptiveRow(
    modifier: Modifier = Modifier,
    horizontalGap: Dp,
    verticalGap: Dp,
    fit: AdaptiveFit = AdaptiveFit.Natural,
    content: @Composable () -> Unit,
) {
    Layout(content = content, modifier = modifier) { measurables, constraints ->
        val hGap = horizontalGap.roundToPx()
        val vGap = verticalGap.roundToPx()
        val count = measurables.size
        if (count == 0) return@Layout layout(constraints.minWidth, constraints.minHeight) {}
        val width = constraints.maxWidth
        val cell = if (count > 1) (width - hGap * (count - 1)) / count else width
        val needs: (IntrinsicMeasurable) -> Int = when (fit) {
            AdaptiveFit.Natural -> { m -> m.maxIntrinsicWidth(Constraints.Infinity) }
            AdaptiveFit.Minimum -> { m -> m.minIntrinsicWidth(Constraints.Infinity) }
        }
        val fits = constraints.hasBoundedWidth && measurables.all { needs(it) <= cell }
        if (fits) {
            // One row: equal widths, equal heights (the tallest child's).
            val tallest = measurables.maxOf { it.minIntrinsicHeight(cell) }
            val placeables = measurables.map { it.measure(Constraints.fixed(cell, tallest)) }
            layout(width, tallest) {
                placeables.forEachIndexed { i, p -> p.place(i * (cell + hGap), 0) }
            }
        } else {
            val full = if (constraints.hasBoundedWidth) width else measurables.maxOf { it.maxIntrinsicWidth(Constraints.Infinity) }
            val placeables = measurables.map { it.measure(Constraints(minWidth = full, maxWidth = full)) }
            val height = placeables.sumOf { it.height } + vGap * (count - 1)
            layout(full, height) {
                var y = 0
                placeables.forEach { p ->
                    p.place(0, y)
                    y += p.height + vGap
                }
            }
        }
    }
}
