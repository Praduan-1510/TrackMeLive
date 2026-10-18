package live.trackme.app.ui.navigation

/**
 * The root screens, one at a time (the Navigation 3 back stack holds just the current one). Each keeps
 * its own view models and saved state, which are cleared when it's replaced.
 */
sealed interface RootScreen {
    data object Onboarding : RootScreen

    data object SignUp : RootScreen

    /** A new account's first mascot pick, before Home. */
    data object MascotSetup : RootScreen

    /** Home, Mascot and Settings behind the navigation bar. */
    data object Main : RootScreen
}
