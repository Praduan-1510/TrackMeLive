package live.trackme.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import live.trackme.app.Names
import live.trackme.app.di.AppContainer
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.domain.Clock
import live.trackme.app.domain.Greeting
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotCatalog
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId

/** Home before any call (prototype › viewHome): the greeting and the person's mascot. Nothing is shared yet. */
data class HomeUiState(
    val greeting: Greeting = Greeting.Morning,
    /** The person's name, or null while the profile loads (the line keeps its height meanwhile). */
    val name: String? = null,
    /** True once the profile has loaded, or turned out to be unavailable: "Hi there" then stands in. */
    val loaded: Boolean = false,
    val mascotId: MascotId = MascotCatalog.DEFAULT_MASCOT,
    val mascotColor: MascotColor = MascotCatalog.DEFAULT_COLOR,
    val mascotAccessory: MascotAccessory? = null,
)

class HomeViewModel(profiles: ProfileRepository, private val clock: Clock) : ViewModel() {

    /** The greeting, moving on at 5:00, 12:00 and 18:00 while Home stays open. */
    private val greeting = flow {
        while (true) {
            val now = clock.localTime()
            emit(Greeting.at(now))
            delay(Greeting.millisUntilNextChange(now))
        }
    }.distinctUntilChanged()

    val state: StateFlow<HomeUiState> = combine(greeting, profiles.profile) { greeting, profile ->
        val p = (profile as? ProfileState.Ready)?.profile
        HomeUiState(
            greeting = greeting,
            name = p?.name?.takeIf(Names::isValid)?.trim(),
            loaded = profile !is ProfileState.Loading,
            mascotId = p?.mascotId ?: MascotCatalog.DEFAULT_MASCOT,
            mascotColor = p?.mascotColor ?: MascotCatalog.DEFAULT_COLOR,
            mascotAccessory = p?.mascotAccessory,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), HomeUiState(greeting = Greeting.at(clock.localTime())))

    companion object {
        fun factory(container: AppContainer) = viewModelFactory {
            initializer {
                HomeViewModel(container.profiles, container.clock)
            }
        }
    }
}
