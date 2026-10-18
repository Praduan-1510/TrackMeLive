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
import android.content.Intent
import live.trackme.app.data.location.LocationPermissions
import live.trackme.app.data.location.PermissionStatus
import live.trackme.app.data.location.PermissionsState
import live.trackme.app.di.AppContainer
import live.trackme.app.ui.settings.PermissionStatus as SettingsPermission
import live.trackme.app.data.auth.AccountRepository
import live.trackme.app.data.auth.DeleteAccountResult
import live.trackme.app.data.profile.ProfileFailure
import live.trackme.app.data.profile.SaveProfileResult
import live.trackme.app.data.settings.SettingsRepository
import live.trackme.app.ui.settings.PermissionsUiState
import live.trackme.app.ui.settings.SettingsEvent
import live.trackme.app.ui.settings.SettingsUiState
import live.trackme.schema.UserSettings

/** What a Permissions row asks the Settings route to do. */
sealed interface PermissionAction {
    /** Location was never asked: the location gate (the explainer, then the system dialog). */
    data object AskLocation : PermissionAction

    /** Notifications were never asked (Android 13+): our explainer, then the system dialog. */
    data class AskNotifications(val permission: String) : PermissionAction

    /** Already answered: the system page where it can be changed. */
    data class OpenSettings(val intent: Intent) : PermissionAction
}

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
    private val permissions: LocationPermissions,
) : ViewModel() {

    private val messages = Channel<SettingsMessage>(Channel.BUFFERED)
    val messageFlow: Flow<SettingsMessage> = messages.receiveAsFlow()

    private val actions = Channel<PermissionAction>(Channel.BUFFERED)
    val permissionActions: Flow<PermissionAction> = actions.receiveAsFlow()

    val state: StateFlow<SettingsUiState> = combine(
        settings.appearance,
        settings.synced,
        settings.updatesUnavailable,
        account.deleting,
        permissions.state,
    ) { appearance, synced, unavailable, deleting, granted ->
        (synced ?: UserSettings()).toUiState(appearance)
            .copy(updatesUnavailable = unavailable, deleting = deleting, permissions = granted.toUiState())
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), SettingsUiState())

    /** The app is in front again: the person may have changed a permission in system Settings. */
    fun onResume() = permissions.refresh()

    /** The notification dialog's answer, from the Notifications row. */
    fun onNotificationResult(granted: Boolean) = permissions.onNotificationRequestResult(granted)

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
            SettingsEvent.LocationPermissionTapped -> act(
                if (permissions.state.value.location == PermissionStatus.NotAsked) {
                    PermissionAction.AskLocation
                } else {
                    PermissionAction.OpenSettings(permissions.appSettingsIntent())
                },
            )
            SettingsEvent.NotificationsPermissionTapped -> {
                val ask = permissions.notificationPermissionToRequest
                act(
                    if (ask != null && permissions.state.value.notifications == PermissionStatus.NotAsked) {
                        PermissionAction.AskNotifications(ask)
                    } else {
                        PermissionAction.OpenSettings(permissions.notificationSettingsIntent())
                    },
                )
            }
        }
    }

    private fun act(action: PermissionAction) {
        viewModelScope.launch { actions.send(action) }
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
                SettingsViewModel(container.settings, container.account, container.locationPermissions)
            }
        }
    }
}

/** Where each permission stands, in Settings' words. Phone arrives with call sharing (Sprint 3). */
private fun PermissionsState.toUiState() = PermissionsUiState(
    location = location.toUi(),
    preciseLocation = preciseLocation,
    notifications = notifications.toUi(),
)

private fun PermissionStatus.toUi(): SettingsPermission = when (this) {
    PermissionStatus.NotAsked -> SettingsPermission.NotAsked
    PermissionStatus.Granted -> SettingsPermission.Allowed
    PermissionStatus.Denied, PermissionStatus.DeniedForever -> SettingsPermission.Denied
}


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
