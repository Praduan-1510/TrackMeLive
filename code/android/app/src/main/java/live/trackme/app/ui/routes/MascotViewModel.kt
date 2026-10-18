package live.trackme.app.ui.routes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import live.trackme.app.di.AppContainer
import live.trackme.app.data.profile.ProfileRepository
import live.trackme.app.data.profile.ProfileState
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.app.data.settings.LocalPreferences
import live.trackme.app.data.settings.SetupStage
import live.trackme.app.ui.mascot.MascotLook
import live.trackme.app.ui.mascot.MascotPickerMode
import live.trackme.schema.MascotAccessory
import live.trackme.schema.MascotColor
import live.trackme.schema.MascotId

data class MascotUiState(
    /** Where the picker starts: the profile's mascot, or the pick being saved (or that failed to save). */
    val initial: MascotLook = MascotLook(),
    val saving: Boolean = false,
    /** The last save failed; the pick stays on screen so Continue or Save can try again. */
    val saveFailed: Boolean = false,
)

sealed interface MascotEvent {
    /** The Mascot tab saved: confirm it in the snackbar. */
    data object Saved : MascotEvent
}

/**
 * The mascot picker's data: the profile's mascot, and saving a new pick through saveProfile. In
 * [MascotPickerMode.Setup] a save finishes setup and opens Home; in [MascotPickerMode.Tab] it confirms
 * with a snackbar.
 */
class MascotViewModel(
    private val mode: MascotPickerMode,
    private val profiles: ProfileRepository,
    private val preferences: LocalPreferences,
) : ViewModel() {

    /** The pick being saved, kept after a failed save so the picker doesn't jump back. */
    private val pending = MutableStateFlow<MascotLook?>(null)
    private val saving = MutableStateFlow(false)
    private val saveFailed = MutableStateFlow(false)
    private val events = Channel<MascotEvent>(Channel.BUFFERED)

    /** One-off events for the screen: a snackbar after the Mascot tab saves. */
    val eventFlow: Flow<MascotEvent> = events.receiveAsFlow()

    val state: StateFlow<MascotUiState> = combine(profiles.profile, pending, saving, saveFailed) { profile, pick, isSaving, failed ->
        val p = (profile as? ProfileState.Ready)?.profile
        MascotUiState(
            initial = pick ?: p?.let { MascotLook(it.mascotId, it.mascotColor, it.mascotAccessory) } ?: MascotLook(),
            saving = isSaving,
            saveFailed = failed,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), MascotUiState())

    /** Saves the pick. An accessory the mascot can't wear is dropped (the astronaut takes none). */
    fun save(id: MascotId, color: MascotColor, accessory: MascotAccessory?) {
        if (saving.value) return
        val look = MascotLook(id, color, accessory).normalized()
        pending.value = look
        saving.value = true
        saveFailed.value = false
        viewModelScope.launch {
            val result = profiles.update { it.copy(mascotId = look.id, mascotColor = look.color, mascotAccessory = look.accessory) }
            when (result) {
                is SaveProfileResult.Saved -> {
                    pending.value = null
                    when (mode) {
                        MascotPickerMode.Setup -> preferences.setSetupStage(SetupStage.Done)
                        MascotPickerMode.Tab -> events.send(MascotEvent.Saved)
                    }
                }
                is SaveProfileResult.Failed -> saveFailed.value = true
            }
            saving.value = false
        }
    }

    companion object {
        private const val STOP_TIMEOUT_MS = 5_000L

        fun factory(container: AppContainer, mode: MascotPickerMode) = viewModelFactory {
            initializer {
                MascotViewModel(mode, container.profiles, container.preferences)
            }
        }
    }
}
