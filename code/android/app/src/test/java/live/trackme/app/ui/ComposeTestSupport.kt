package live.trackme.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.FontScale
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import live.trackme.design.TmlTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue

/** Our theme with the bundled fonts, at [fontScale], in light or [dark]. */
fun ComposeContentTestRule.setTmlContent(
    fontScale: Float = 1f,
    dark: Boolean = false,
    content: @Composable () -> Unit,
) {
    setContent {
        DeviceConfigurationOverride(DeviceConfigurationOverride.FontScale(fontScale)) {
            TmlTheme(darkTheme = dark, display = Gabarito, text = Figtree) {
                Box(Modifier.background(TmlTheme.colors.ground)) { content() }
            }
        }
    }
}

/**
 * Fails if any text on screen is cut short: ellipsized, clipped by a height it can't fit, or a line
 * wider than the text's own box. Values and labels wrap; they never truncate.
 */
fun ComposeContentTestRule.assertNoTextIsCut() {
    val nodes = onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.GetTextLayoutResult), useUnmergedTree = true)
        .fetchSemanticsNodes()
    assertTrue("expected text on screen", nodes.isNotEmpty())
    nodes.forEach { node ->
        val layouts = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        val text = node.config.getOrElse(SemanticsProperties.Text) { emptyList() }.joinToString()
        layouts.forEach { r ->
            val cut = r.didOverflowHeight ||
                (0 until r.lineCount).any { line ->
                    r.isLineEllipsized(line) || r.getLineRight(line) - r.getLineLeft(line) > r.size.width + LINE_SLACK_PX
                }
            assertFalse("\"$text\" is cut short", cut)
        }
    }
}

/** Sub-pixel rounding between a line's measured width and its box. */
private const val LINE_SLACK_PX = 1f

/** The smallest touch target allowed on Android (design-system README › Touch). */
val MinTouch: Dp = 48.dp
