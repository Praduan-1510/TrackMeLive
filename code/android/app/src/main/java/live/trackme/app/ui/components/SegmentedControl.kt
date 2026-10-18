package live.trackme.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.design.TmlAndroidRadius
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** Sizes from the prototype's `.a-seg` (prototype/css/android.css). */
object SegmentedControlDefaults {
    /** The check before the selected label. */
    val IconSize: Dp = 18.dp

    /** Between the check and the label (Material 3's button icon spacing). */
    val IconGap: Dp = 8.dp

    /** Inside each segment, either side of its content (prototype `.a-seg button` padding). */
    val HorizontalPadding: Dp = TmlSpacing.Space2

    /** The outline of every segment. */
    val Border: Dp = 1.dp

    /** A selected segment is a 10% ink tint (design-system README › Android › Selection). */
    const val SelectedTintAlpha = 0.10f
}

/**
 * Material 3 segmented buttons in our tokens: one choice from two or three, a check on the selected
 * one. When the labels no longer fit side by side (large text, long translations), the segments
 * stack into one column instead of cutting a label short, like the prototype's `.a-seg` container
 * query. Whether they fit is measured from the labels themselves, so it holds in every language.
 */
@Composable
fun SegmentedControl(
    labels: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val style = AppType.button
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val d = SegmentedControlDefaults
    val icon = iconSizeFor(d.IconSize, style)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val segmentPx = remember(labels, style, density, measurer, icon) {
            val widest = labels.maxOf { measurer.measure(it, style, softWrap = false, maxLines = 1).size.width }
            with(density) { widest + (icon + d.IconGap + d.HorizontalPadding * 2 + d.Border * 2).roundToPx() }
        }
        if (segmentPx * labels.size <= constraints.maxWidth) {
            SegmentRow(labels, selectedIndex, onSelect)
        } else {
            SegmentColumn(labels, selectedIndex, onSelect)
        }
    }
}

@Composable
private fun SegmentRow(labels: List<String>, selectedIndex: Int, onSelect: (Int) -> Unit) {
    val c = TmlTheme.colors
    val d = SegmentedControlDefaults
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        labels.forEachIndexed { i, label ->
            val selected = i == selectedIndex
            SegmentedButton(
                selected = selected,
                onClick = { onSelect(i) },
                shape = SegmentedButtonDefaults.itemShape(index = i, count = labels.size),
                colors = SegmentedButtonDefaults.colors(
                    activeContainerColor = c.ink.copy(alpha = d.SelectedTintAlpha),
                    activeContentColor = c.ink,
                    activeBorderColor = c.inkTertiary,
                    inactiveContainerColor = Color.Transparent,
                    inactiveContentColor = c.ink,
                    inactiveBorderColor = c.inkTertiary,
                ),
                contentPadding = PaddingValues(horizontal = d.HorizontalPadding),
                icon = {
                    SegmentedButtonDefaults.Icon(active = selected, activeContent = {
                        Icon(
                            painter = painterResource(R.drawable.ic_check),
                            contentDescription = null,
                            modifier = Modifier.size(iconSizeFor(d.IconSize, AppType.button)),
                        )
                    })
                },
                label = { Text(label, style = AppType.button, textAlign = TextAlign.Center) },
            )
        }
    }
}

@Composable
private fun SegmentColumn(labels: List<String>, selectedIndex: Int, onSelect: (Int) -> Unit) {
    val c = TmlTheme.colors
    val d = SegmentedControlDefaults
    val outer = RoundedCornerShape(TmlAndroidRadius.ListOuter)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(outer)
            .border(d.Border, c.inkTertiary, outer)
            .selectableGroup(),
    ) {
        labels.forEachIndexed { i, label ->
            val selected = i == selectedIndex
            if (i > 0) Box(Modifier.fillMaxWidth().height(d.Border).background(c.inkTertiary))
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = TmlSpacing.TapTargetLg)
                    .background(if (selected) c.ink.copy(alpha = d.SelectedTintAlpha) else Color.Transparent)
                    .selectable(selected = selected, role = Role.RadioButton, onClick = { onSelect(i) })
                    .padding(horizontal = TmlSpacing.Space4, vertical = TmlSpacing.Space2),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(d.IconGap, Alignment.CenterHorizontally),
            ) {
                if (selected) {
                    Icon(
                        painter = painterResource(R.drawable.ic_check),
                        contentDescription = null,
                        tint = c.ink,
                        modifier = Modifier.size(iconSizeFor(d.IconSize, AppType.button)),
                    )
                }
                Text(label, style = AppType.button, color = c.ink, textAlign = TextAlign.Center)
            }
        }
    }
}

@ComponentPreviews
@Composable
private fun SegmentedControlPreview() {
    PreviewSurface {
        Column(verticalArrangement = Arrangement.spacedBy(TmlSpacing.Space4)) {
            SegmentedControl(
                labels = listOf(stringResource(R.string.settings_precise), stringResource(R.string.settings_approximate)),
                selectedIndex = 0,
                onSelect = {},
            )
            SegmentedControl(
                labels = listOf(
                    stringResource(R.string.settings_appearance_system),
                    stringResource(R.string.settings_appearance_light),
                    stringResource(R.string.settings_appearance_dark),
                ),
                selectedIndex = 2,
                onSelect = {},
            )
        }
    }
}
