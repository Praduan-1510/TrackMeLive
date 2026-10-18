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

/**
 * The sharing screens, one at a time over [RootScreen.Main] (FSD §11: Share screen, Live map, Sharing
 * ended). Back from each returns to Home; the share keeps going in the background.
 */
sealed interface SharingScreen {
    /** Share where you are. [autoShare]: Share again at the 1-hour limit shares at once. */
    data class Share(val autoShare: Boolean = false) : SharingScreen

    /** The live map, while sharing. */
    data object Live : SharingScreen

    /** Sharing ended, until Done or Share again. */
    data object Ended : SharingScreen
}
