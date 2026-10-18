package live.trackme.app.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp

/** Tabular figures, for anything that ticks: timers, "updated 2 s ago", distances. */
fun TextStyle.tabular(): TextStyle = copy(fontFeatureSettings = "tnum")

/**
 * [base] grown by the factor the system font size applies to [style] (Android's scaling is
 * non-linear, so the factor depends on the size), so an icon keeps pace with the text beside it,
 * as in the prototype. Never smaller than [base].
 */
@Composable
@ReadOnlyComposable
fun iconSizeFor(base: Dp, style: TextStyle): Dp {
    val size = style.fontSize
    if (!size.isSp || size.value <= 0f) return base
    val scale = with(LocalDensity.current) { size.toDp().value } / size.value
    return base * scale.coerceAtLeast(1f)
}
