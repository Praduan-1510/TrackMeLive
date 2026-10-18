package live.trackme.app.ui.components

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Screen-level sizes shared by the screens built from these components. */
object LayoutDefaults {
    /** Content stops growing here on tablets and in landscape, so lines stay readable. */
    val ContentMaxWidth: Dp = 640.dp

    /** Separator lines and edges. */
    val Hairline: Dp = 1.dp

    /** An icon set inline with supporting text, such as the one before an error. */
    val InlineIcon: Dp = 20.dp
}
