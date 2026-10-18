@file:OptIn(ExperimentalTextApi::class)

package live.trackme.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import live.trackme.app.R
import live.trackme.design.TmlTheme

// Gabarito (display) and Figtree (text) ship as variable TTFs in res/font, from the google/fonts
// repo under the SIL Open Font License (assets/licenses). Each weight sets the wght axis.
private fun variable(res: Int, vararg weights: Int) = FontFamily(
    weights.map { w ->
        Font(
            resId = res,
            weight = FontWeight(w),
            style = FontStyle.Normal,
            variationSettings = FontVariation.Settings(FontVariation.weight(w)),
        )
    },
)

val Gabarito: FontFamily = variable(R.font.gabarito_variable, 400, 500, 600, 700, 800)
val Figtree: FontFamily = variable(R.font.figtree_variable, 400, 500, 600, 700)

/**
 * Android type roles from the prototype (prototype/css/android.css). Sizes are sp, so every style
 * follows the system font size; nothing is fixed.
 */
object AppType {
    /** Onboarding headline: Gabarito 800, 30/38. */
    val obTitle: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.display, fontWeight = FontWeight.W800, fontSize = 30.sp, lineHeight = 38.sp, letterSpacing = (-0.3).sp)

    /** Top-level screen title in the app bar: Gabarito 700, 28/36. */
    val appBar: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.display, fontWeight = FontWeight.W700, fontSize = 28.sp, lineHeight = 36.sp, letterSpacing = (-0.2).sp)

    /** Home greeting name: Gabarito 700, 36/44. */
    val headlineBig: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.display, fontWeight = FontWeight.W700, fontSize = 36.sp, lineHeight = 44.sp, letterSpacing = (-0.4).sp)

    /** Card and hero titles: tokens title-2 (Gabarito 700, 22/28). */
    val title: TextStyle
        @Composable @ReadOnlyComposable get() = TmlTheme.type.title2

    /** Body copy: Figtree 400, 16/24. */
    val body: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W400, fontSize = 16.sp, lineHeight = 24.sp, letterSpacing = 0.1.sp)

    /** Card text: Figtree 400, 15/22. */
    val card: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W400, fontSize = 15.sp, lineHeight = 22.sp, letterSpacing = 0.1.sp)

    /** Card row label: Figtree 600, 15/20. */
    val cardRow: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W600, fontSize = 15.sp, lineHeight = 20.sp, letterSpacing = 0.1.sp)

    /** Supporting text: Figtree 400, 14/20. */
    val supporting: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W400, fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.2.sp)

    /** Section header over a grouped list: Figtree 600, 14/20. */
    val section: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W600, fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.1.sp)

    /** List item headline: Figtree 400, 16/24. */
    val listItem: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W400, fontSize = 16.sp, lineHeight = 24.sp, letterSpacing = 0.15.sp)

    /** Large button label (56dp buttons): Figtree 600, 16/24. */
    val buttonLarge: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W600, fontSize = 16.sp, lineHeight = 24.sp, letterSpacing = 0.15.sp)

    /** Button label (40dp buttons, segmented buttons): Figtree 600, 14/20. */
    val button: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W600, fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.1.sp)

    /** Navigation bar label: Figtree 600, 12/16. */
    val navLabel: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W600, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.4.sp)

    /** Small print under a main action: Figtree 400, 12/16 (prototype `.a-fine`). */
    val fine: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W400, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.3.sp)

    /** A sheet's or dialog's title: Gabarito 700, 24/32 (prototype `.a-bsheet h2`, `.a-explain h2`). */
    val sheetTitle: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.display, fontWeight = FontWeight.W700, fontSize = 24.sp, lineHeight = 32.sp, letterSpacing = (-0.1).sp)

    /** A quiet note: Figtree 400, 13/18 (prototype `.a-note`, `.a-prec-note`). */
    val note: TextStyle
        @Composable @ReadOnlyComposable get() = TextStyle(fontFamily = TmlTheme.type.text, fontWeight = FontWeight.W400, fontSize = 13.sp, lineHeight = 18.sp, letterSpacing = 0.2.sp)

    /** Status pill: tokens footnote at 600. */
    val pill: TextStyle
        @Composable @ReadOnlyComposable get() = TmlTheme.type.footnote.copy(fontWeight = FontWeight.W600)
}
