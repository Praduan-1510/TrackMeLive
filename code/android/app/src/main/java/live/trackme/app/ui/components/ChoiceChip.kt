package live.trackme.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import live.trackme.app.R
import live.trackme.app.ui.AppType
import live.trackme.design.TmlRadius
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** Sizes from the prototype's `.a-chip`. */
object ChoiceChipDefaults {
    /** The chip itself; the touch target around it is 48dp. */
    val Height: Dp = 32.dp

    /** The check on the selected chip. */
    val IconSize: Dp = 18.dp

    /** The unselected outline. */
    val Border: Dp = 1.dp
}

/**
 * A single-choice chip (Material 3 filter chip look): outlined when off, `lamplight-wash` with a check
 * when on (design-system README › Android › Selection). Reads as a radio button, so put a group of
 * them in a [Modifier.selectableGroup].
 */
@Composable
fun ChoiceChip(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = TmlTheme.colors
    val shape = RoundedCornerShape(TmlRadius.Xs)
    Row(
        modifier = modifier
            .minimumInteractiveComponentSize()
            .heightIn(min = ChoiceChipDefaults.Height)
            .clip(shape)
            .then(
                if (selected) {
                    Modifier.background(c.lamplightWash)
                } else {
                    Modifier.border(ChoiceChipDefaults.Border, c.inkTertiary, shape).background(Color.Transparent)
                },
            )
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(
                start = if (selected) TmlSpacing.Space2 else TmlSpacing.Space4,
                end = TmlSpacing.Space4,
                top = TmlSpacing.Space1,
                bottom = TmlSpacing.Space1,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
    ) {
        if (selected) {
            Icon(
                painter = painterResource(R.drawable.ic_check),
                contentDescription = null,
                tint = c.lamplightText,
                modifier = Modifier.size(iconSizeFor(ChoiceChipDefaults.IconSize, AppType.button)),
            )
        }
        Text(text, style = AppType.button, color = c.ink)
    }
}

/**
 * One choice from a few, as chips that wrap onto more lines instead of scrolling sideways, so every
 * option stays visible at any text size.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChoiceChipGroup(
    labels: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier.selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(TmlSpacing.Space2),
    ) {
        labels.forEachIndexed { i, label ->
            ChoiceChip(text = label, selected = i == selectedIndex, onClick = { onSelect(i) })
        }
    }
}

@ComponentPreviews
@Composable
private fun ChoiceChipPreview() {
    PreviewSurface {
        ChoiceChipGroup(
            labels = listOf(
                stringResource(R.string.mascot_accessory_none),
                stringResource(R.string.mascot_accessory_headphones),
                stringResource(R.string.mascot_accessory_glasses),
                stringResource(R.string.mascot_accessory_headlamp),
            ),
            selectedIndex = 1,
            onSelect = {},
        )
    }
}
