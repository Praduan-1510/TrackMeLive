package live.trackme.app.ui.routes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import live.trackme.app.di.AppContainer
import live.trackme.app.data.auth.AccountRepository
import live.trackme.app.data.auth.DeleteAccountResult
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.app.data.settings.SettingsRepository
import live.trackme.app.ui.settings.SettingsEvent
import live.trackme.app.ui.settings.SettingsUiState
import live.trackme.schema.UserSettings

sealed interface SettingsMessage {
    /** A synced setting didn't save; its control has gone back. */
    data object SaveFailed : SettingsMessage

    /** Delete account didn't go through; nothing was deleted, or it can be finished by trying again. */
    data class DeleteFailed(val offline: Boolean) : SettingsMessage
}

/**
 * Settings (FSD §4 Settings). Appearance applies at once and stays on this phone. Every other setting
 * saves with the profile: it shows its new value while saving and goes back, with a snackbar, if the
 * save fails. Delete account deletes everything on the server and signs out, which takes the app back
 * to sign-up.
 */
class SettingsViewModel(
    private val settings: SettingsRepository,
    private val account: AccountRepository,
) : ViewModel() {

    private val messages = Channel<SettingsMessage>(Channel.BUFFERED)
    val messageFlow: Flow<SettingsMessage> = messages.receiveAsFlow()

    val state: StateFlow<SettingsUiState> = combine(
        settings.appearance,
        settings.synced,
        settings.updatesUnavailable,
        account.deleting,
    ) { appearance, synced, unavailable, deleting ->
        (synced ?: UserSettings()).toUiState(appearance).copy(updatesUnavailable = unavailable, deleting = deleting)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    fun onEvent(event: SettingsEvent) {
        when (event) {
            is SettingsEvent.AppearanceChanged -> viewModelScope.launch { settings.setAppearance(event.appearance) }
            is SettingsEvent.OfferOnCallChanged -> sync { it.copy(offerOnCall = event.on) }
            is SettingsEvent.PrecisionChanged -> sync { it.copy(precision = event.precision) }
            is SettingsEvent.DefaultStopChanged -> sync { it.copy(defaultStopWire = event.stop.wire) }
            is SettingsEvent.ShareBackChanged -> sync { it.copy(shareBack = event.on) }
            is SettingsEvent.AlertLinkOpenedChanged -> sync { it.copy(alertLinkOpened = event.on) }
            is SettingsEvent.AlertCallEndedChanged -> sync { it.copy(alertCallEnded = event.on) }
            is SettingsEvent.AlertExpiryChanged -> sync { it.copy(alertExpiry = event.on) }
            SettingsEvent.DeleteAccountConfirmed -> deleteAccount()
        }
    }

    private fun sync(change: (UserSettings) -> UserSettings) {
        // Mid-delete nothing is saved (the repository refuses too); the control stays as it was.
        if (account.deleting.value) return
        viewModelScope.launch {
            val result = settings.updateSynced(change)
            if (result is SaveProfileResult.Failed && result.reason != ProfileFailure.AccountDeleting) messages.send(SettingsMessage.SaveFailed)
        }
    }

    private fun deleteAccount() {
        // A second confirm while the first runs is ignored (the repository guards too).
        if (account.deleting.value) return
        viewModelScope.launch {
            when (account.deleteAccount()) {
                // Both leave the shell: deleted goes to onboarding, an ended sign-in to sign-up.
                DeleteAccountResult.Deleted, DeleteAccountResult.SignInEnded, DeleteAccountResult.InProgress -> Unit
                DeleteAccountResult.Network -> messages.send(SettingsMessage.DeleteFailed(offline = true))
                DeleteAccountResult.Failed -> messages.send(SettingsMessage.DeleteFailed(offline = false))
            }
        }
    }

    companion object {
        fun factory(container: AppContainer) = viewModelFactory {
            initializer {
                SettingsViewModel(container.settings, container.account)
            }
        }
    }
}

/** Permissions show "not asked yet" until the permission flows arrive (sharing, a later sprint). */
private fun UserSettings.toUiState(appearance: live.trackme.app.data.settings.Appearance) = SettingsUiState(
    offerOnCall = offerOnCall,
    precision = precision,
    defaultStop = defaultStop,
    shareBack = shareBack,
    alertLinkOpened = alertLinkOpened,
    alertCallEnded = alertCallEnded,
    alertExpiry = alertExpiry,
    appearance = appearance,
)
