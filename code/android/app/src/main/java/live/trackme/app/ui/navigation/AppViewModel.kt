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

/** The app's top level: which root screen shows, and the appearance. */
data class AppUiState(
    /** False until the stored setup stage and appearance have loaded; the splash screen stays up until then. */
    val ready: Boolean = false,
    val root: RootScreen = RootScreen.Onboarding,
    val appearance: Appearance = Appearance.System,
    /** The onboarding page to open on: the last one when coming back from sign-up. */
    val onboardingPage: Int = 0,
)

/**
 * Decides the root screen from what's stored on the phone (the setup stage) and who is signed in, so
 * every launch resumes in the right place: onboarding, sign-up, the first mascot pick, or Home.
 */
class AppViewModel(
    private val preferences: LocalPreferences,
    auth: AuthRepository,
) : ViewModel() {

    private val onboardingPage = MutableStateFlow(0)

    val state: StateFlow<AppUiState> = combine(
        preferences.setupStage,
        auth.userId,
        preferences.appearance,
        onboardingPage,
    ) { stage, userId, appearance, page ->
        AppUiState(ready = true, root = rootFor(stage, userId), appearance = appearance, onboardingPage = page)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, AppUiState())

    init {
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

    companion object {
        const val LAST_ONBOARDING_PAGE = 2

        fun rootFor(stage: SetupStage, userId: String?): RootScreen = when {
            stage == SetupStage.Onboarding -> RootScreen.Onboarding
            stage == SetupStage.SignUp || userId == null -> RootScreen.SignUp
            stage == SetupStage.Mascot -> RootScreen.MascotSetup
            else -> RootScreen.Main
        }

        fun factory(container: AppContainer) = viewModelFactory {
            initializer {
                AppViewModel(container.preferences, container.auth)
            }
        }
    }
}
