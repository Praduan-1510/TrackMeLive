package live.trackme.app.ui.navigation

import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.LocalActivity
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import live.trackme.app.ui.Figtree
import live.trackme.app.ui.Gabarito
import live.trackme.app.ui.ended.EndedRoute
import live.trackme.app.ui.live.LiveRoute
import live.trackme.app.ui.onboarding.OnboardingScreen
import live.trackme.app.ui.routes.MascotSetupRoute
import live.trackme.app.ui.share.ShareRoute
import live.trackme.app.ui.signup.SignUpRoute
import live.trackme.design.TmlTheme

/**
 * The app: onboarding, sign-up and a new account's first mascot pick, then Home, Mascot and Settings
 * behind the navigation bar, with the sharing screens (share, live map, ended) over them. [AppViewModel] picks the root screen from the stored setup stage and the
 * sign-in, so each launch resumes where the person left off. Light and dark follow the system unless
 * Settings › Appearance picks one.
 */
@Composable
fun TrackMeLiveApp(app: AppViewModel) {
    val state by app.state.collectAsStateWithLifecycle()
    val dark = state.appearance.isDark(isSystemInDarkTheme())
    SystemBarIcons(dark)

    TmlTheme(darkTheme = dark, display = Gabarito, text = Figtree) {
        // One root at a time: replacing it clears the old screen's view models and saved state.
        NavDisplay(
            backStack = state.backStack,
            modifier = Modifier.fillMaxSize().background(TmlTheme.colors.ground),
            // Back over a sharing screen returns to Home; at a root, the screens handle it themselves.
            onBack = app::back,
            entryDecorators = listOf(
                rememberSaveableStateHolderNavEntryDecorator(),
                rememberViewModelStoreNavEntryDecorator(),
            ),
            // Material fade-through between root screens.
            transitionSpec = { fadeIn(tween(220, delayMillis = 90)) togetherWith fadeOut(tween(90)) },
            popTransitionSpec = { fadeIn(tween(220, delayMillis = 90)) togetherWith fadeOut(tween(90)) },
            entryProvider = entryProvider {
                entry<RootScreen.Onboarding> {
                    OnboardingScreen(initialPage = state.onboardingPage, onFinish = app::finishOnboarding)
                }
                entry<RootScreen.SignUp> {
                    SignUpRoute(onBackToOnboarding = app::reopenOnboarding)
                }
                entry<RootScreen.MascotSetup> {
                    MascotSetupRoute()
                }
                entry<RootScreen.Main> {
                    MainShell(onShare = app::openShare, onOpenLive = app::openLive)
                }
                entry<SharingScreen.Share> { key ->
                    ShareRoute(autoShare = key.autoShare, onBack = app::back, onShared = app::shared)
                }
                entry<SharingScreen.Live> {
                    LiveRoute(askAlerts = state.askAlerts, onBack = app::back)
                }
                entry<SharingScreen.Ended> {
                    EndedRoute(onDone = app::done, onShareAgain = app::shareAgain)
                }
            },
        )
    }
}

/** Keeps the status and navigation bar icons readable when the app's theme differs from the system's. */
@Composable
private fun SystemBarIcons(dark: Boolean) {
    val activity = LocalActivity.current as? ComponentActivity
    LaunchedEffect(dark, activity) {
        val style = if (dark) {
            SystemBarStyle.dark(Color.TRANSPARENT)
        } else {
            SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        }
        activity?.enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }
}
