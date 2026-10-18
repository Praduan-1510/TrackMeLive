package live.trackme.app.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import live.trackme.app.ui.Figtree
import live.trackme.app.ui.Gabarito
import live.trackme.design.TmlSpacing
import live.trackme.design.TmlTheme

/** Night mode for the dark previews. */
private const val NIGHT = Configuration.UI_MODE_NIGHT_YES or Configuration.UI_MODE_TYPE_NORMAL

/** Every component preview in light and dark, at 100% and 200% font size. */
@Preview(name = "Light", group = "100%")
@Preview(name = "Dark", group = "100%", uiMode = NIGHT)
@Preview(name = "Light 200%", group = "200%", fontScale = 2f)
@Preview(name = "Dark 200%", group = "200%", fontScale = 2f, uiMode = NIGHT)
annotation class ComponentPreviews

/** Whole screens in light and dark, at 100% and 200% font size, on a Pixel 9 sized canvas. */
@Preview(name = "Light", group = "100%", device = "id:pixel_9")
@Preview(name = "Dark", group = "100%", device = "id:pixel_9", uiMode = NIGHT)
@Preview(name = "Light 200%", group = "200%", device = "id:pixel_9", fontScale = 2f)
@Preview(name = "Dark 200%", group = "200%", device = "id:pixel_9", fontScale = 2f, uiMode = NIGHT)
annotation class ScreenPreviews

/** Our theme with the bundled fonts, following the preview's night mode. */
@Composable
fun PreviewTheme(content: @Composable () -> Unit) {
    TmlTheme(display = Gabarito, text = Figtree, content = content)
}

/** A component on the ground color, with the screen margin around it. */
@Composable
fun PreviewSurface(content: @Composable () -> Unit) {
    PreviewTheme {
        Box(Modifier.background(TmlTheme.colors.ground).padding(TmlSpacing.Space4)) { content() }
    }
}
