package live.trackme.app.ui.components

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import live.trackme.design.TmlTheme

/** Heights of the large app bar (Material 3 `LargeTopAppBar`). */
object TmlTopAppBarDefaults {
    /** Collapsed: one 64dp band under the status bar. */
    val CollapsedHeight: Dp = 64.dp

    /** Room under the expanded title (Material 3 large app bar bottom padding). */
    val TitleBottomPadding: Dp = 28.dp
}

/**
 * The top app bar of a top-level scrolling screen (Mascot, Settings): a Material 3 large app bar on
 * `ground` with the title in Gabarito, which collapses to one line as the content scrolls under it
 * and takes `surface-raised` then (prototype `.a-appbar` and `.a-scrolled`). The expanded height
 * follows the title's line height at the current font size, so large text never clips.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TmlLargeTopAppBar(
    title: String,
    scrollBehavior: TopAppBarScrollBehavior,
    modifier: Modifier = Modifier,
) {
    val c = TmlTheme.colors
    val lineHeight = with(LocalDensity.current) { TmlTheme.type.title1.lineHeight.toDp() }
    // The collapsed row, then the expanded title and the room under it: 126dp at 100% font size,
    // as compact as the prototype's band, and taller as the title's line grows with the font size.
    val expanded = TmlTopAppBarDefaults.CollapsedHeight + lineHeight + TmlTopAppBarDefaults.TitleBottomPadding
    LargeTopAppBar(
        title = { Text(title, modifier = Modifier.semantics { heading() }) },
        modifier = modifier,
        collapsedHeight = TmlTopAppBarDefaults.CollapsedHeight,
        expandedHeight = expanded,
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = c.ground,
            scrolledContainerColor = c.surfaceRaised,
            titleContentColor = c.ink,
            navigationIconContentColor = c.ink,
            actionIconContentColor = c.ink,
        ),
        scrollBehavior = scrollBehavior,
    )
}
