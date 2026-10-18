package live.trackme.app.ui.components

import android.provider.Settings
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/** Material 3 emphasized easing, used for shape and indicator changes. */
val Emphasized = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/** Durations for state changes: within the 150 to 300 ms band for micro-interactions. */
object MotionDurations {
    /** Press feedback and color changes. */
    const val Short = 150

    /** Shape morphs and selection changes. */
    const val Medium = 250

    /** A button's corner morph, from round to 10dp (prototype `.a-btn` transition). */
    const val Long = 300
}

/** True when the person turned animations off (Settings › Accessibility › Remove animations). */
@Composable
fun rememberReduceMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember(resolver) {
        Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}

/** An emphasized tween of [durationMillis], or a snap when [reduceMotion] is on. */
fun <T> emphasizedSpec(durationMillis: Int, reduceMotion: Boolean): AnimationSpec<T> =
    if (reduceMotion) snap() else tween(durationMillis = durationMillis, easing = Emphasized)
