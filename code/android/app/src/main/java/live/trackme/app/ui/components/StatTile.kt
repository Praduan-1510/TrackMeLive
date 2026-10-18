package live.trackme.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.IntrinsicMeasurable
import androidx.compose.ui.layout.IntrinsicMeasureScope
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.Measurable
import androidx.compose.ui.layout.MeasurePolicy
import androidx.compose.ui.layout.MeasureResult
import androidx.compose.ui.layout.MeasureScope
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** Sizes from the prototype's `.tile` inside the Android sheet (`.a-bsheet .tile`). */
object StatTileDefaults {
    /** Corners of a tile in the Android sheet. */
    val Corner: Dp = 16.dp
}

/**
 * One number in a map sheet: the value in `metric` (tabular figures) over its label in `footnote`,
 * on an opaque `surface-raised` tile. Values never truncate or shrink; they wrap. Until the viewer
 * shares back, the distance tile reads "Waiting" over "for Mom to share", never "0 km". Pass
 * [spokenDescription] with long units ("1.2 kilometers apart") for TalkBack.
 */
@Composable
fun StatTile(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    spokenDescription: String? = null,
) {
    val c = TmlTheme.colors
    Layout(
        content = {
            Text(value, style = TmlTheme.type.metric.tabular(), color = c.ink)
            Text(label, style = TmlTheme.type.footnote, color = c.inkSecondary)
        },
        modifier = modifier
            .clip(RoundedCornerShape(StatTileDefaults.Corner))
            .background(c.surfaceRaised)
            .then(
                if (spokenDescription != null) {
                    Modifier.clearAndSetSemantics { contentDescription = spokenDescription }
                } else {
                    Modifier.semantics(mergeDescendants = true) {}
                },
            )
            .padding(horizontal = TmlSpacing.Space3, vertical = TmlSpacing.Space2),
        measurePolicy = StatTileMeasurePolicy,
    )
}

/**
 * The value over its label. A tile is no narrower than its whole value and its label's longest
 * word, so in a row of tiles the label may wrap but the value never does.
 */
private object StatTileMeasurePolicy : MeasurePolicy {
    override fun MeasureScope.measure(measurables: List<Measurable>, constraints: Constraints): MeasureResult {
        val loose = constraints.copy(minWidth = 0, minHeight = 0, maxHeight = Constraints.Infinity)
        val value = measurables[0].measure(loose)
        val label = measurables[1].measure(loose)
        val width = maxOf(value.width, label.width).coerceIn(constraints.minWidth, constraints.maxWidth)
        val height = maxOf(constraints.minHeight, value.height + label.height)
        return layout(width, height) {
            value.place(0, 0)
            label.place(0, value.height)
        }
    }

    override fun IntrinsicMeasureScope.minIntrinsicWidth(measurables: List<IntrinsicMeasurable>, height: Int): Int =
        maxOf(measurables[0].maxIntrinsicWidth(height), measurables[1].minIntrinsicWidth(height))

    override fun IntrinsicMeasureScope.maxIntrinsicWidth(measurables: List<IntrinsicMeasurable>, height: Int): Int =
        measurables.maxOf { it.maxIntrinsicWidth(height) }

    override fun IntrinsicMeasureScope.minIntrinsicHeight(measurables: List<IntrinsicMeasurable>, width: Int): Int =
        measurables.sumOf { it.minIntrinsicHeight(width) }

    override fun IntrinsicMeasureScope.maxIntrinsicHeight(measurables: List<IntrinsicMeasurable>, width: Int): Int =
        measurables.sumOf { it.maxIntrinsicHeight(width) }
}

/** Tiles side by side while each value fits whole; stacked into one column at large text. */
@Composable
fun StatTileRow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    AdaptiveRow(
        modifier = modifier,
        horizontalGap = TmlSpacing.Space2,
        verticalGap = TmlSpacing.Space2,
        fit = AdaptiveFit.Minimum,
        content = content,
    )
}

@ComponentPreviews
@Composable
private fun StatTilePreview() {
    PreviewSurface {
        StatTileRow {
            StatTile(stringResource(R.string.preview_stat_distance), stringResource(R.string.preview_stat_distance_label))
            StatTile(stringResource(R.string.preview_stat_call), stringResource(R.string.preview_stat_call_label))
            StatTile(stringResource(R.string.preview_stat_waiting), stringResource(R.string.preview_stat_waiting_label))
        }
    }
}
