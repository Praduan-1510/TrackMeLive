package live.trackme.app.ui

import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.LocalActivity
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import live.trackme.design.TmlTheme

/**
 * The app shell: onboarding first, then Home, Mascot and Settings behind the bottom navigation bar.
 * Light and dark follow the system unless Settings › Appearance picks one.
 */
@Composable
fun TrackMeLiveApp() {
    var onboarded by rememberSaveable { mutableStateOf(false) }
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var themeMode by rememberSaveable { mutableStateOf(ThemeMode.System) }

    val dark = when (themeMode) {
        ThemeMode.System -> isSystemInDarkTheme()
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
    }

    // Keep the status and navigation bar icons readable when the app's theme differs from the system's.
    val activity = LocalActivity.current as? ComponentActivity
    LaunchedEffect(dark, activity) {
        val style = if (dark) {
            SystemBarStyle.dark(Color.TRANSPARENT)
        } else {
            SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        }
        activity?.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }

    TmlTheme(darkTheme = dark, display = Gabarito, text = Figtree) {
        AnimatedContent(
            targetState = onboarded,
            transitionSpec = { fadeIn(tween(220, delayMillis = 90)) togetherWith fadeOut(tween(90)) },
            label = "onboarding",
        ) { done ->
            if (!done) {
                OnboardingScreen(onContinue = { onboarded = true }, onSkip = { onboarded = true })
            } else {
                MainShell(
                    tab = tab,
                    onTab = { tab = it },
                    themeMode = themeMode,
                    onThemeMode = { themeMode = it },
                )
            }
        }
    }
}
