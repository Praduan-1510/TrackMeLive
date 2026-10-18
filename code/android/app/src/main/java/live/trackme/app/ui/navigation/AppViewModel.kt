package live.trackme.app.ui.navigation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import live.trackme.app.di.AppContainer
import live.trackme.app.data.auth.AuthRepository
import live.trackme.app.data.settings.Appearance
import live.trackme.app.data.settings.LocalPreferences
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.data.sharing.ShareState
import live.trackme.app.data.sharing.SharingRepository

/** The app's top level: which root screen shows, and the appearance. */
data class AppUiState(
    /** False until the stored setup stage and appearance have loaded; the splash screen stays up until then. */
    val ready: Boolean = false,
    val root: RootScreen = RootScreen.Onboarding,
    val appearance: Appearance = Appearance.System,
    /** The onboarding page to open on: the last one when coming back from sign-up. */
    val onboardingPage: Int = 0,
    /** The sharing screen over Home, or null for Home itself. */
    val sharing: SharingScreen? = null,
    /** The live screen asks for notifications: the first link has just gone out. */
    val askAlerts: Boolean = false,
) {
    /** The Navigation 3 back stack: the root, and a sharing screen over Main. */
    val backStack: List<Any>
        get() = if (root == RootScreen.Main && sharing != null) listOf(root, sharing) else listOf(root)
}

/** Which sharing screen the person asked for; the share's state decides what can show (see [AppViewModel.sharingScreen]). */
private data class ShareNav(
    val share: SharingScreen.Share? = null,
    val live: Boolean = false,
    val askAlerts: Boolean = false,
)

/**
 * Decides the root screen from what's stored on the phone (the setup stage) and who is signed in, so
 * every launch resumes in the right place: onboarding, sign-up, the first mascot pick, or Home.
 */
class AppViewModel(
    private val preferences: LocalPreferences,
    auth: AuthRepository,
    private val sharing: SharingRepository,
) : ViewModel() {

    private val onboardingPage = MutableStateFlow(0)
    private val nav = MutableStateFlow(ShareNav())

    val state: StateFlow<AppUiState> = combine(
        combine(preferences.setupStage, auth.userId, ::Pair),
        preferences.appearance,
        onboardingPage,
        nav,
        sharing.state,
    ) { (stage, userId), appearance, page, nav, share ->
        AppUiState(
            ready = true,
            root = rootFor(stage, userId),
            appearance = appearance,
            onboardingPage = page,
            sharing = sharingScreen(nav, share),
            askAlerts = nav.askAlerts,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, AppUiState())

    init {
        // A share that ends (Stop, the timer, the limit) moves on to the ended screen by itself; once it's
        // dismissed, Back and Done land on Home.
        viewModelScope.launch {
            sharing.state.collect { share ->
                if (share is ShareState.Ended) nav.value = ShareNav()
            }
        }
        // The notification's Stop sharing opens the live screen, where the Stop dialog asks first.
        viewModelScope.launch {
            sharing.stopConfirmationRequested.collect { requested ->
                if (requested && sharing.state.value is ShareState.Live) nav.value = ShareNav(live = true)
            }
        }
        // Signed out behind our back (the account was deleted, or its sign-in revoked): sign up again.
        viewModelScope.launch {
            combine(preferences.setupStage, auth.userId) { stage, userId -> stage to userId }.collect { (stage, userId) ->
                if (userId == null && (stage == SetupStage.Mascot || stage == SetupStage.Done)) {
                    preferences.setSetupStage(SetupStage.SignUp)
                }
            }
        }
    }

    /** Continue on the last page, Get started, or Skip: on to sign-up. */
    fun finishOnboarding() {
        viewModelScope.launch { preferences.setSetupStage(SetupStage.SignUp) }
    }

    /** Back from sign-up's first step returns to the last onboarding page, as in the prototype. */
    fun reopenOnboarding() {
        onboardingPage.value = LAST_ONBOARDING_PAGE
        viewModelScope.launch { preferences.setSetupStage(SetupStage.Onboarding) }
    }

    /** Share live location (after the location gate): the share screen, or the live map while sharing. */
    fun openShare() {
        nav.value = if (sharing.state.value is ShareState.Live) ShareNav(live = true) else ShareNav(share = SharingScreen.Share())
    }

    /** The live map: Home's live card, or the ongoing notification. Shown once the share is live. */
    fun openLive() {
        nav.value = ShareNav(live = true)
    }

    /** The link went out: on to the live map, which asks for notifications the first time. */
    fun shared() {
        nav.value = ShareNav(live = true, askAlerts = true)
    }

    /** Done on the ended screen: back to Home. */
    fun done() {
        nav.value = ShareNav()
        sharing.dismissEnded()
    }

    /** Share again at the 1-hour limit (after the location gate): a new share with a new link, at once. */
    fun shareAgain() {
        sharing.dismissEnded()
        nav.value = ShareNav(share = SharingScreen.Share(autoShare = true))
    }

    /** System Back over a sharing screen: to Home (the ended screen's Back is Done). */
    fun back() {
        if (state.value.sharing == SharingScreen.Ended) done() else nav.value = ShareNav()
    }

    companion object {
        const val LAST_ONBOARDING_PAGE = 2

        /**
         * The sharing screen to show. An ended share shows the ended screen until it's dismissed. The live
         * map shows only while the share is live. The share screen stays while its share sheet is open,
         * even though the share is already live then.
         */
        private fun sharingScreen(nav: ShareNav, share: ShareState): SharingScreen? = when {
            share is ShareState.Ended -> SharingScreen.Ended
            nav.live && share is ShareState.Live -> SharingScreen.Live
            nav.share != null -> nav.share
            else -> null
        }

        fun rootFor(stage: SetupStage, userId: String?): RootScreen = when {
            stage == SetupStage.Onboarding -> RootScreen.Onboarding
            stage == SetupStage.SignUp || userId == null -> RootScreen.SignUp
            stage == SetupStage.Mascot -> RootScreen.MascotSetup
            else -> RootScreen.Main
        }

        fun factory(container: AppContainer) = viewModelFactory {
            initializer {
                AppViewModel(container.preferences, container.auth, container.sharing)
            }
        }
    }
}
